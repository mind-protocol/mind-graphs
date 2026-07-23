import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const SOURCE_PATH = new URL(
  "l1/data/conversation-choix-de-vie-complexe-blocks-001-003.json",
  ROOT
);
const CLUSTER_PATHS = [1, 2, 3].map(index => new URL(
  `l1/data/conversation-choix-de-vie-complexe-block-${String(index).padStart(3, "0")}-citizen-cluster.json`,
  ROOT
));

const LEGACY_METADATA = Object.freeze({
  ingestionGeneration: "encounter_first_legacy",
  assimilationStatus: "legacy_assimilated",
  experiencedByCitizen: true,
  supersededBy: "decision-ci-latent-memory-first"
});

const CHATGPT_ACTOR_ID = "actor-source-chatgpt-pro";
const NLR_ACTOR_ID = "self-nlr-ai";
const CONTROLLER_CONFIDENCE = 0.128395;

const EXTRACTION_SOURCES = new Set([
  "memory-citizen-block-001-operational-contract",
  "memory-citizen-block-001-sharing-proposal",
  "memory-citizen-block-002-epistemic-map",
  "memory-citizen-block-002-symbiotic-thesis",
  "memory-citizen-block-002-subentity-model",
  "memory-citizen-block-002-research-program",
  "memory-citizen-block-002-architecture-and-guards",
  "memory-citizen-block-003-source-gaps",
  "memory-citizen-block-003-persistent-world",
  "memory-citizen-block-003-actor-taxonomy",
  "memory-citizen-block-003-agency-boundary",
  "memory-citizen-block-003-epistemic-envelope",
  "memory-citizen-block-003-lagoon",
  "memory-citizen-block-003-claim-merge-protocol"
]);

const DERIVATION_PATTERNS = [
  /atomise/i,
  /extra(?:it|ite|ction)/i,
  /sépar(?:é|ée)/i,
  /conserve (?:quel|le stimulus|son contexte)/i,
  /porte précisément sur/i,
  /évaluée uniquement à partir/i,
  /vérifiée sur le bloc/i,
  /observation conservatrice/i,
  /contrôle existant/i,
  /tient compte/i
];

const TRIGGER_PATTERNS = [
  /réaction .*workspace/i,
  /trace du workspace/i,
  /répond au bloc/i,
  /développe la curiosité/i,
  /clôture reste ouverte/i
];

const uniqueLink = (links, candidate) => {
  if (!links.some(link =>
    link.source === candidate.source
    && link.target === candidate.target
    && link.type === candidate.type
  )) links.push(candidate);
};

function classifyLegacyRelation(link) {
  if (link.type === "RECALLS") {
    if (["memory-skills-sailing", "memory-question-subentity-boundaries"].includes(link.target)) {
      return link;
    }
    const type = TRIGGER_PATTERNS.some(pattern => pattern.test(link.justification || ""))
      ? "TRIGGERED_BY"
      : "DERIVED_FROM";
    return { ...link, type };
  }
  if (link.type !== "REINTERPRETS") return link;
  if (
    EXTRACTION_SOURCES.has(link.source)
    || DERIVATION_PATTERNS.some(pattern => pattern.test(link.justification || ""))
  ) return { ...link, type: "DERIVED_FROM" };
  return link;
}

function markLegacyMemory(node) {
  if (node.nodeType !== "memory") return node;
  const migrated = {
    ...node,
    ...LEGACY_METADATA,
    memoryState: "encountered"
  };
  if (migrated.controllerId && migrated.controllerConfidence === undefined) {
    migrated.controllerConfidence = CONTROLLER_CONFIDENCE;
  }
  return migrated;
}

function controllerNode(controllerId, blockId, workspaceSnapshotId) {
  return {
    id: controllerId,
    name: `Sous-entité runtime provisoire · contrôleur du ${blockId}`,
    nodeType: "subentity",
    phrase: `Coalition provisoire observée comme contrôleur du workspace pendant la rencontre legacy du ${blockId}.`,
    family: "Cognition runtime · attribution historique",
    summary: "Cette sous-entité matérialise une coalition runtime faiblement activée afin que l'attribution du Moment reste requêtable. Elle ne constitue ni une identité stable, ni une source causale exclusive, ni une propriété de NLR.",
    lifecycleStatus: "candidate",
    identityStatus: "provisional",
    workspaceSnapshotId,
    controllerConfidence: CONTROLLER_CONFIDENCE,
    attributionMode: "live",
    confirmedByHuman: false,
    epistemicStatus: "inferred"
  };
}

async function load(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function save(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function migrateSourceCluster(source) {
  source.provenance = {
    ...source.provenance,
    declaredParticipantIds: [CHATGPT_ACTOR_ID, NLR_ACTOR_ID],
    participantEvidence: "NLR a confirmé que les participants sont ChatGPT et nlr_ai ; seuls les tours ChatGPT sont présents dans cet export partiel.",
    ...LEGACY_METADATA
  };

  if (!source.nodes.some(node => node.id === CHATGPT_ACTOR_ID)) {
    source.nodes.push({
      id: CHATGPT_ACTOR_ID,
      name: "ChatGPT Pro · IA source de la conversation",
      nodeType: "citizen_ai",
      phrase: "Instance ChatGPT identifiée comme auteur des trois réponses présentes dans l'export partiel.",
      family: "Provenance · acteur conversationnel externe",
      summary: "Acteur source déclaré par NLR et corroboré par le libellé ChatGPT Pro dans l'export. Cette instance n'est pas le Citizen AI du L1 et ses productions ne deviennent pas des déclarations de NLR.",
      provider: "OpenAI",
      sourceLabel: "ChatGPT Pro",
      actorScope: "source_conversation_only",
      confirmedByHuman: true,
      epistemicStatus: "declared"
    });
  }

  source.nodes = source.nodes.map(node => {
    if (node.claimNature !== "message_moment") return node;
    return {
      ...node,
      authorId: CHATGPT_ACTOR_ID,
      conversationParticipantIds: [CHATGPT_ACTOR_ID, NLR_ACTOR_ID],
      ...LEGACY_METADATA,
      memoryState: "encountered"
    };
  });

  for (const index of [1, 2, 3]) {
    const block = String(index).padStart(3, "0");
    uniqueLink(source.links, {
      source: `memory-conversation-choix-de-vie-complexe-block-${block}`,
      target: CHATGPT_ACTOR_ID,
      type: "AUTHORED_BY",
      justification: "NLR a confirmé ChatGPT comme auteur de ce tour assistant ; le prompt de nlr_ai correspondant reste absent de l'export."
    });
  }
  return source;
}

export function migrateCitizenCluster(cluster) {
  const sourceBlockId = cluster.provenance.sourceBlockId;
  const blockId = sourceBlockId.match(/block-(\d{3})$/)?.[0] || "bloc inconnu";
  const controllerId = cluster.provenance.controllerId
    || cluster.nodes.find(node => node.controllerId)?.controllerId;
  const workspaceSnapshotId = cluster.provenance.workspaceSnapshotId;

  cluster.provenance = {
    ...cluster.provenance,
    ...LEGACY_METADATA,
    migrationStatus: "preserved_historical_encounter"
  };
  cluster.nodes = cluster.nodes.map(markLegacyMemory);
  cluster.links = cluster.links.map(classifyLegacyRelation);

  if (controllerId) {
    if (!cluster.nodes.some(node => node.id === controllerId)) {
      cluster.nodes.push(controllerNode(controllerId, blockId, workspaceSnapshotId));
    }
    for (const node of cluster.nodes.filter(node =>
      node.nodeType === "memory" && node.controllerId === controllerId
    )) {
      const confidence = node.controllerConfidence ?? CONTROLLER_CONFIDENCE;
      uniqueLink(cluster.links, {
        source: node.id,
        target: controllerId,
        type: "ENCODED_UNDER",
        confidence,
        epistemicStatus: "inferred",
        mode: "live",
        workspaceSnapshotId,
        justification: "Le Moment conserve le contrôleur observé lors de son encodage ; cette attribution faible ne transfère ni propriété ni causalité."
      });
      uniqueLink(cluster.links, {
        source: controllerId,
        target: node.id,
        type: "CONTROLLED_WORKSPACE_DURING",
        confidence,
        epistemicStatus: "inferred",
        mode: "live",
        workspaceSnapshotId,
        justification: "Projection inverse du même snapshot runtime pour les requêtes de contrôle ; elle ne vaut pas GENERATED_BY."
      });
    }
  }

  for (const node of cluster.nodes.filter(node => node.nodeType === "memory")) {
    if (cluster.links.some(link => link.source === node.id && link.type === "REINTERPRETS")) {
      node.interpretationVersion ??= 1;
      node.reinterpretationMode ??= "legacy_additive";
    }
  }
  return cluster;
}

export async function migrateLegacyConversationCluster() {
  const source = migrateSourceCluster(await load(SOURCE_PATH));
  await save(SOURCE_PATH, source);
  for (const path of CLUSTER_PATHS) {
    await save(path, migrateCitizenCluster(await load(path)));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await migrateLegacyConversationCluster();
}
