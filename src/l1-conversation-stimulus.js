import { createHash } from "node:crypto";
import { getGraphByName } from "./db.js";
import { loadManifest, selectGraph } from "./graph-manifest.js";
import {
  applyFalkorIntegratedL1UntilStable,
  runIntegratedL1UntilStable
} from "./l1-integrated-runtime.js";
import { createLocalEmbedder, embedNodes } from "./local-embedding.js";
import { routeSensoryEnergy } from "./l1-sensory-runtime.js";
import { readFalkorSubentityState } from "./l1-subentity-falkor.js";

export const CONVERSATION_STIMULUS_DEFAULTS = Object.freeze({
  graphId: "l1-nlr-ai",
  citizenId: "self-nlr-ai",
  sensoryEnergyBudget: 1,
  minSimilarity: 0.15,
  topK: 5,
  characterBudget: 1200,
  maxMicroTicks: 12,
  requiredQuietTicks: 1
});

const digest = value => createHash("sha256").update(value).digest("hex");
const trimmed = (value, field) => {
  const result = String(value || "").trim();
  if (!result) throw new Error(`${field} is required.`);
  return result;
};
const isoOrNull = (value, field) => {
  if (value === undefined || value === null || value === "") return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${field} must be an ISO date-time.`);
  return new Date(time).toISOString();
};

export async function readEmbeddableL1Nodes(graph) {
  const result = await graph.roQuery(`
    MATCH (node:L1Node)
    WHERE node.id IS NOT NULL
    RETURN properties(node) AS node
  `);
  return (result.data || [])
    .map(row => row.node || row)
    .filter(node => node.id && node.id !== "subentity-runtime");
}

export async function resolveConversationStimulusGraph({
  graphId = CONVERSATION_STIMULUS_DEFAULTS.graphId,
  manifest = null,
  selectGraphByName = getGraphByName
} = {}) {
  const resolvedManifest = manifest || await loadManifest();
  const config = selectGraph(resolvedManifest, graphId);
  if (config.status !== "active" || !config.falkorGraph) {
    throw new Error(`Graph "${graphId}" is not an active FalkorDB graph.`);
  }
  return { config, graph: await selectGraphByName(config.falkorGraph) };
}

export async function buildConversationStimulus({
  conversationId,
  blockId,
  content,
  sourceArtifact = null,
  sourceLocator = null,
  consentId = null,
  speakerRole = "unknown",
  occurredAt = null,
  timestampBasis = "unknown",
  citizenId = CONVERSATION_STIMULUS_DEFAULTS.citizenId,
  sensoryEnergyBudget = CONVERSATION_STIMULUS_DEFAULTS.sensoryEnergyBudget,
  minSimilarity = CONVERSATION_STIMULUS_DEFAULTS.minSimilarity,
  topK = CONVERSATION_STIMULUS_DEFAULTS.topK,
  characterBudget = CONVERSATION_STIMULUS_DEFAULTS.characterBudget,
  recordedAt = new Date().toISOString()
}, {
  l1Nodes,
  embed = createLocalEmbedder()
}) {
  const normalizedConversationId = trimmed(conversationId, "conversationId");
  const normalizedBlockId = trimmed(blockId, "blockId");
  const normalizedContent = trimmed(content, "content");
  const normalizedRecordedAt = isoOrNull(recordedAt, "recordedAt");
  const normalizedOccurredAt = isoOrNull(occurredAt, "occurredAt");
  const sourceFingerprint = digest([
    normalizedConversationId,
    normalizedBlockId,
    normalizedContent
  ].join("\u0000"));
  const stimulusId = `stimulus-conversation-block-${sourceFingerprint.slice(0, 24)}`;
  const tickId = `conversation-stimulus-${sourceFingerprint.slice(0, 24)}`;
  const sensoryLineHash = digest([
    sourceArtifact || "",
    sourceLocator || "",
    normalizedContent
  ].join("\u0000"));
  const embeddedTargets = await embedNodes(l1Nodes || [], embed);
  const embeddedLine = {
    graphId: `conversation:${normalizedConversationId}`,
    source: stimulusId,
    target: citizenId,
    link: { type: "STIMULUS_FOR" },
    sensoryLine: normalizedContent,
    sensoryLineHash,
    embedding: await embed(normalizedContent)
  };
  const routing = routeSensoryEnergy([embeddedLine], embeddedTargets, {
    sensoryEnergyBudget,
    minSimilarity,
    topK,
    citizenId,
    tickId
  });
  const activeNodeIds = [...new Set(routing.transfers.map(transfer => transfer.targetNodeId))];
  const stimulus = {
    id: stimulusId,
    conversationId: normalizedConversationId,
    blockId: normalizedBlockId,
    content: normalizedContent,
    sourceArtifact,
    sourceLocator,
    consentId,
    speakerRole,
    occurredAt: normalizedOccurredAt,
    timestampBasis,
    recordedAt: normalizedRecordedAt,
    epistemicStatus: "reported",
    sourceFingerprint
  };
  return {
    stimulus,
    routing: {
      ...routing,
      totalBudget: Number(sensoryEnergyBudget),
      minSimilarity: Number(minSimilarity),
      topK: Number(topK)
    },
    input: {
      tickId,
      observationId: stimulusId,
      recordedAt: normalizedRecordedAt,
      evidenceMomentIds: [],
      sensory: {
        citizenId,
        totalBudget: Number(sensoryEnergyBudget),
        ...routing
      },
      affect: { availability: "not_provided", vector: {} },
      workspace: {
        id: `workspace-${tickId}`,
        actorId: citizenId,
        characterBudget: Number(characterBudget),
        activeNodeIds,
        goalIds: []
      }
    },
    embedding: {
      ...embed.metadata,
      use: "contextual_activation_only",
      identityInferenceAllowed: false
    }
  };
}

function workspaceView(workspace) {
  const slots = workspace?.slots || [];
  return {
    id: workspace?.id || null,
    controllerId: workspace?.controllerId || null,
    characterBudget: workspace?.characterBudget ?? null,
    usedCharacters: workspace?.characterUsed ?? workspace?.usedCharacters ?? 0,
    activeNodeIds: [...new Set(slots.flatMap(slot => slot.nodeIds || []))],
    activeGoalIds: [...new Set(slots.flatMap(slot => slot.goalIds || []))],
    slots,
    bids: workspace?.bids || [],
    selectionReasons: workspace?.selectionReasons || []
  };
}

export async function stimulateConversationBlock(args, dependencies = {}) {
  const resolver = dependencies.resolveGraph || resolveConversationStimulusGraph;
  const readState = dependencies.readState || readFalkorSubentityState;
  const readNodes = dependencies.readNodes || readEmbeddableL1Nodes;
  const embed = dependencies.embed || createLocalEmbedder();
  const runDry = dependencies.runDry || runIntegratedL1UntilStable;
  const applyStable = dependencies.applyStable || applyFalkorIntegratedL1UntilStable;
  const graphId = args.graphId || CONVERSATION_STIMULUS_DEFAULTS.graphId;
  const { config, graph } = await resolver({ graphId });
  const [runtime, l1Nodes] = await Promise.all([readState(graph), readNodes(graph)]);
  const built = await buildConversationStimulus(args, { l1Nodes, embed });
  const executionOptions = {
    maxMicroTicks: args.maxMicroTicks ?? CONVERSATION_STIMULUS_DEFAULTS.maxMicroTicks,
    requiredQuietTicks: args.requiredQuietTicks ?? CONVERSATION_STIMULUS_DEFAULTS.requiredQuietTicks
  };
  const result = args.apply
    ? await applyStable({ graph, input: built.input, ...executionOptions })
    : runDry(runtime.state, built.input, executionOptions);
  return {
    graphId: config.id,
    falkorGraph: config.falkorGraph,
    persisted: Boolean(result.persisted),
    stimulus: built.stimulus,
    routing: built.routing,
    workspace: workspaceView(result.workspace),
    stabilization: result.stabilization,
    runtimeReport: result.report,
    embedding: built.embedding,
    safeguards: {
      directSemanticLinksCreated: 0,
      runtimeRelationsOnly: true,
      embeddingCannotEstablishIdentity: true,
      affectStatus: "not_provided"
    }
  };
}

/**
 * Réveille le Citizen par un stimulus qu'il s'adresse à lui-même.
 * Contrairement à stimulateConversationBlock, think n'accepte aucun destinataire
 * ni mode dry-run : penser remet réellement le sujet sous attention dans le
 * runtime personnel, sans créer pour autant un lien sémantique durable.
 */
export async function think(message, options = {}, dependencies = {}) {
  const content = trimmed(message, "message");
  const citizenId = options.citizenId || CONVERSATION_STIMULUS_DEFAULTS.citizenId;
  const messageFingerprint = digest(content);
  const recordedAt = options.recordedAt
    || dependencies.now?.()
    || new Date().toISOString();
  return stimulateConversationBlock({
    graphId: options.graphId || CONVERSATION_STIMULUS_DEFAULTS.graphId,
    conversationId: `self-thought:${citizenId}`,
    blockId: `thought-${messageFingerprint.slice(0, 24)}`,
    content,
    sourceArtifact: "mcp:think",
    sourceLocator: "self-addressed",
    speakerRole: "citizen_ai",
    occurredAt: recordedAt,
    timestampBasis: "source",
    recordedAt,
    citizenId,
    sensoryEnergyBudget: options.sensoryEnergyBudget ?? CONVERSATION_STIMULUS_DEFAULTS.sensoryEnergyBudget,
    minSimilarity: options.minSimilarity ?? CONVERSATION_STIMULUS_DEFAULTS.minSimilarity,
    topK: options.topK ?? CONVERSATION_STIMULUS_DEFAULTS.topK,
    characterBudget: options.characterBudget ?? CONVERSATION_STIMULUS_DEFAULTS.characterBudget,
    maxMicroTicks: options.maxMicroTicks ?? CONVERSATION_STIMULUS_DEFAULTS.maxMicroTicks,
    requiredQuietTicks: options.requiredQuietTicks ?? CONVERSATION_STIMULUS_DEFAULTS.requiredQuietTicks,
    apply: true
  }, dependencies);
}

export function formatConversationStimulus(result) {
  const routed = result.routing.transfers.length;
  const workspaceNodes = result.workspace.activeNodeIds.length;
  return [
    `Bloc ${result.stimulus.blockId} injecté comme stimulus dans ${result.graphId}.`,
    `${routed} activation(s) contextuelle(s), ${workspaceNodes} nœud(s) dans le Global Workspace.`,
    `Micro-ticks : ${result.runtimeReport.microTickCount}; arrêt : ${result.runtimeReport.stopReason}.`,
    result.persisted
      ? "Le tick cognitif a été persisté."
      : "Simulation seulement : aucun état runtime n'a été persisté.",
    "Aucun lien sémantique direct ni identité de personne n'a été créé par l'embedding."
  ].join("\n");
}

export function formatThought(result) {
  return [
    `Pensée auto-adressée injectée dans ${result.graphId}.`,
    `Stimulus : ${result.stimulus.id}.`,
    `Global Workspace : ${result.workspace.id || "indisponible"}; contrôleur : ${result.workspace.controllerId || "inconnu"}.`,
    `Nœuds actifs : ${result.workspace.activeNodeIds.join(", ") || "aucun"}.`,
    `Micro-ticks : ${result.runtimeReport.microTickCount}; arrêt : ${result.runtimeReport.stopReason}.`,
    result.persisted
      ? "Le nouvel état d'attention a été persisté."
      : "Le runtime n'a pas nécessité de nouvelle persistance (rejeu idempotent possible).",
    "La pensée n'a créé aucun lien sémantique durable : une délibération séparée reste nécessaire."
  ].join("\n");
}
