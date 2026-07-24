import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_SUBENTITY_POLICY,
  createMemoryMoment,
  promoteSubentity,
  reconcileSubentities
} from "./l1-subentities.js";
import { remapWorkspaceSnapshotControllers } from "./l1-global-workspace.js";
import { attributeMemoryMoment } from "./l1-subentity-memory-attribution.js";
import { reinforceMoments } from "./moment-reinforcement.js";

export const EMPTY_SUBENTITY_RUNTIME_STATE = Object.freeze({
  schemaVersion: "0.1.0",
  revision: 0,
  actors: [],
  spaces: [],
  perceptualMoments: [],
  subentities: [],
  narratives: [],
  moments: [],
  workspaceSnapshots: [],
  memoryAttributions: [],
  relations: [],
  events: [],
  processedTickIds: []
});

const clone = value => structuredClone(value);
const unique = values => [...new Set(values || [])];
const upsertById = (existing, incoming) => {
  const map = new Map(existing.map(item => [item.id, clone(item)]));
  for (const item of incoming) map.set(item.id, clone(item));
  return [...map.values()];
};

function normalizeState(state = {}) {
  return {
    ...clone(EMPTY_SUBENTITY_RUNTIME_STATE),
    ...clone(state),
    actors: clone(state.actors || []),
    spaces: clone(state.spaces || []),
    perceptualMoments: clone(state.perceptualMoments || []),
    subentities: clone(state.subentities || []),
    narratives: clone(state.narratives || []),
    moments: clone(state.moments || []),
    workspaceSnapshots: clone(state.workspaceSnapshots || []),
    memoryAttributions: clone(state.memoryAttributions || []),
    relations: clone(state.relations || []),
    events: clone(state.events || []),
    processedTickIds: unique(state.processedTickIds)
  };
}

function upsertCandidates(existing, candidates) {
  const byId = new Map(existing.map(entity => [entity.id, clone(entity)]));
  for (const candidate of candidates) {
    if (!candidate?.id) throw new Error("Each subentity candidate requires an id.");
    const previous = byId.get(candidate.id);
    byId.set(candidate.id, previous ? {
      ...previous,
      ...clone(candidate),
      evidenceMomentIds: unique([...(previous.evidenceMomentIds || []), ...(candidate.evidenceMomentIds || [])]),
      observationIds: unique([...(previous.observationIds || []), ...(candidate.observationIds || [])]),
      mergedFrom: unique([...(previous.mergedFrom || []), ...(candidate.mergedFrom || [])]),
      aliases: unique([...(previous.aliases || []), ...(candidate.aliases || [])])
    } : clone(candidate));
  }
  return [...byId.values()];
}

/**
 * Suit la chaîne `supersededBy` d'une coalition fusionnée jusqu'à son survivant
 * encore actif. Une entité non fusionnée se résout en elle-même.
 */
function buildSurvivorResolver(population) {
  const byId = new Map(population.map(entity => [entity.id, entity]));
  const cache = new Map();
  const resolve = (id, seen = new Set()) => {
    if (cache.has(id)) return cache.get(id);
    const entity = byId.get(id);
    if (!entity || entity.status !== "merged" || !entity.supersededBy || seen.has(id)) return id;
    seen.add(id);
    const survivor = resolve(entity.supersededBy, seen);
    cache.set(id, survivor);
    return survivor;
  };
  return id => resolve(id);
}

function previousConversationMoment(moments, memory) {
  const metadata = memory?.metadata || {};
  if (metadata.previousMomentId || !metadata.conversationId) return metadata.previousMomentId || null;
  const position = Number(metadata.conversationPosition);
  if (!Number.isFinite(position)) return null;
  return [...moments]
    .filter(moment => moment.conversationId === metadata.conversationId
      && Number.isFinite(Number(moment.conversationPosition))
      && Number(moment.conversationPosition) < position)
    .sort((left, right) => Number(right.conversationPosition) - Number(left.conversationPosition))[0]?.id || null;
}

/**
 * Exécute une transaction logique pure. L'appelant ne persiste le résultat
 * qu'après succès complet : aucune fusion partielle ne peut devenir visible.
 */
export function runSubentityLifecycleTick(previousState, input, options = {}) {
  if (!input?.tickId) throw new Error("A lifecycle tick requires a stable tickId.");
  const state = normalizeState(previousState);
  if (state.processedTickIds.includes(input.tickId)) {
    return { state, report: { tickId: input.tickId, status: "already_processed", changed: false } };
  }
  if (!Array.isArray(input.candidates)) throw new Error("A lifecycle tick requires a candidates array.");
  if (input.memory && state.moments.some(moment => moment.id === input.memory.id)) {
    throw new Error(`Memory Moment ${input.memory.id} already exists under another tick.`);
  }

  const policy = { ...DEFAULT_SUBENTITY_POLICY, ...(options.policy || {}) };
  const population = upsertCandidates(state.subentities, input.candidates);
  const reconciliation = reconcileSubentities(population, { policy });
  let active = reconciliation.active;
  const promotions = [];
  const newNarratives = [];
  const newRelations = [];

  // L'ordre est stable pour qu'un replay du même état donne le même résultat.
  for (const candidate of [...active].filter(entity => entity.level !== "high").sort((a, b) => a.id.localeCompare(b.id))) {
    const highLevelCount = active.filter(entity => entity.level === "high").length;
    const promotion = promoteSubentity(candidate, highLevelCount, { policy });
    if (!promotion.promoted) continue;
    active = active.map(entity => entity.id === candidate.id ? promotion.entity : entity);
    promotions.push({ subentityId: candidate.id, score: promotion.score, threshold: promotion.threshold });
    newNarratives.push(...promotion.narratives);
    newRelations.push(...promotion.relations);
  }

  // Le snapshot est arbitré sur les candidats d'avant la fusion : une coalition
  // meneuse peut avoir été absorbée dans ce tick. On réancre son identité sur le
  // survivant actif avant toute persistance ou attribution, pour qu'aucun
  // consommateur ne voie un contrôleur fantôme.
  const resolveSurvivor = buildSurvivorResolver([...active, ...reconciliation.retired]);
  const workspaceSnapshot = input.workspaceSnapshot?.semanticType === "WorkspaceSnapshot"
    ? remapWorkspaceSnapshotControllers(input.workspaceSnapshot, resolveSurvivor)
    : input.workspaceSnapshot;

  let memoryResult = null;
  let attributionResult = null;
  if (input.memory) {
    const inferredPreviousMomentId = previousConversationMoment(state.moments, input.memory);
    const memory = inferredPreviousMomentId && !input.memory.metadata?.previousMomentId
      ? {
          ...input.memory,
          metadata: { ...(input.memory.metadata || {}), previousMomentId: inferredPreviousMomentId }
        }
      : input.memory;
    memoryResult = createMemoryMoment({ ...memory, workspaceSnapshot: workspaceSnapshot || {} });
    newRelations.push(...memoryResult.relations);
    attributionResult = attributeMemoryMoment({
      moment: memoryResult.moment,
      workspaceSnapshot: input.workspaceSnapshot || {},
      subentities: active,
      previousAttributions: state.memoryAttributions,
      recordedAt: input.recordedAt || null,
      ...(input.memoryAttribution || {})
    });
    newRelations.push(...attributionResult.relations);
  }

  const momentsBeforeReinforcement = memoryResult
    ? upsertById(state.moments, [memoryResult.moment])
    : state.moments;
  const momentReinforcement = input.outcome
    ? reinforceMoments(momentsBeforeReinforcement, input.outcome, {
      policy: options.momentReinforcementPolicy,
      eligibilityByMoment: input.momentEligibility,
      observedAt: input.recordedAt || null,
      outcomeId: input.outcomeId || input.tickId
    })
    : null;

  const lifecycleEvents = [
    ...reconciliation.events.map(event => ({ id: `event-${input.tickId}-merge-${event.survivorId}-${event.absorbedId}`, ...event, tickId: input.tickId, recordedAt: input.recordedAt || null })),
    ...promotions.map(promotion => ({ id: `event-${input.tickId}-promotion-${promotion.subentityId}`, type: "SUBENTITY_PROMOTED", ...promotion, tickId: input.tickId, recordedAt: input.recordedAt || null }))
  ];
  newRelations.push(...reconciliation.events.map(event => ({
    id: `${event.survivorId}-supersedes-${event.absorbedId}`,
    source: event.survivorId,
    type: "SUPERSEDES",
    target: event.absorbedId,
    reason: event.reason,
    tickId: input.tickId
  })));
  const perception = input.perception || null;
  const previousSpace = perception?.space ? state.spaces.find(space => space.id === perception.space.id) : null;
  const nextActors = perception?.actor ? upsertById(state.actors, [perception.actor]) : state.actors;
  const incomingSpaces = perception?.space ? [{
    ...perception.space,
    firstObservedAt: previousSpace?.firstObservedAt || perception.space.firstObservedAt,
    observationCount: Number(previousSpace?.observationCount || 0) + 1
  }] : [];
  const conversationSpaceId = memoryResult?.moment.conversationSpaceId;
  if (conversationSpaceId) {
    const previousConversationSpace = state.spaces.find(space => space.id === conversationSpaceId);
    incomingSpaces.push({
      id: conversationSpaceId,
      nodeType: "Space",
      semanticType: "Conversation",
      name: `Conversation · ${memoryResult.moment.conversationId}`,
      conversationId: memoryResult.moment.conversationId,
      channel: memoryResult.moment.channel || null,
      firstObservedAt: previousConversationSpace?.firstObservedAt || memoryResult.moment.occurredAt,
      lastObservedAt: memoryResult.moment.occurredAt,
      observationCount: Number(previousConversationSpace?.observationCount || 0) + 1
    });
  }
  const nextSpaces = incomingSpaces.length ? upsertById(state.spaces, incomingSpaces) : state.spaces;
  const nextPerceptualMoments = perception?.moment
    ? upsertById(state.perceptualMoments, [perception.moment])
    : state.perceptualMoments;
  if (perception?.relations?.length) newRelations.push(...perception.relations);
  const nextState = {
    ...state,
    revision: Number(state.revision || 0) + 1,
    updatedAt: input.recordedAt || new Date().toISOString(),
    actors: nextActors,
    spaces: nextSpaces,
    perceptualMoments: nextPerceptualMoments,
    subentities: [...active, ...reconciliation.retired],
    narratives: upsertById(state.narratives, newNarratives),
    moments: momentReinforcement?.moments || momentsBeforeReinforcement,
    workspaceSnapshots: input.workspaceSnapshot?.semanticType === "WorkspaceSnapshot"
      ? upsertById(state.workspaceSnapshots, [input.workspaceSnapshot])
      : state.workspaceSnapshots,
    memoryAttributions: attributionResult
      ? upsertById(state.memoryAttributions, [attributionResult.attribution])
      : state.memoryAttributions,
    relations: upsertById(state.relations, newRelations),
    events: [...state.events, ...lifecycleEvents],
    processedTickIds: [...state.processedTickIds, input.tickId]
  };
  return {
    state: nextState,
    report: {
      tickId: input.tickId,
      status: "applied",
      changed: true,
      revision: nextState.revision,
      merges: reconciliation.events,
      promotions,
      perceptualActorId: perception?.actor?.id || null,
      perceptualSpaceId: perception?.space?.id || null,
      perceptualMomentId: perception?.moment?.id || null,
      memoryMomentId: memoryResult?.moment.id || null,
      memoryAttributionId: attributionResult?.attribution.id || null,
      workspaceSnapshotId: input.workspaceSnapshot?.semanticType === "WorkspaceSnapshot"
        ? input.workspaceSnapshot.id
        : null,
      reinforcedMomentCount: momentReinforcement?.updates.length || 0,
      reinforcementScore: momentReinforcement?.score.score ?? null,
      activeSubentityCount: active.length,
      highLevelSubentityCount: active.filter(entity => entity.level === "high").length
    }
  };
}

export async function readSubentityRuntimeState(filePath) {
  try {
    return normalizeState(JSON.parse(await fs.readFile(filePath, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return clone(EMPTY_SUBENTITY_RUNTIME_STATE);
    throw error;
  }
}

export async function writeSubentityRuntimeStateAtomic(filePath, state) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(normalizeState(state), null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function applySubentityLifecycleTick({ statePath, input, dryRun = false, policy }) {
  const previous = await readSubentityRuntimeState(statePath);
  const result = runSubentityLifecycleTick(previous, input, { policy });
  if (!dryRun && result.report.changed) await writeSubentityRuntimeStateAtomic(statePath, result.state);
  return { ...result, persisted: !dryRun && result.report.changed };
}
