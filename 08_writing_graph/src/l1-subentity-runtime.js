import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_SUBENTITY_POLICY,
  createMemoryMoment,
  promoteSubentity,
  reconcileSubentities
} from "./l1-subentities.js";
import { reinforceMoments } from "./moment-reinforcement.js";

export const EMPTY_SUBENTITY_RUNTIME_STATE = Object.freeze({
  schemaVersion: "0.1.0",
  revision: 0,
  subentities: [],
  narratives: [],
  moments: [],
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
    subentities: clone(state.subentities || []),
    narratives: clone(state.narratives || []),
    moments: clone(state.moments || []),
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
      mergedFrom: unique([...(previous.mergedFrom || []), ...(candidate.mergedFrom || [])]),
      aliases: unique([...(previous.aliases || []), ...(candidate.aliases || [])])
    } : clone(candidate));
  }
  return [...byId.values()];
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

  let memoryResult = null;
  if (input.memory) {
    memoryResult = createMemoryMoment({ ...input.memory, workspaceSnapshot: input.workspaceSnapshot || {} });
    newRelations.push(...memoryResult.relations);
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
  const nextState = {
    ...state,
    revision: Number(state.revision || 0) + 1,
    updatedAt: input.recordedAt || new Date().toISOString(),
    subentities: [...active, ...reconciliation.retired],
    narratives: upsertById(state.narratives, newNarratives),
    moments: momentReinforcement?.moments || momentsBeforeReinforcement,
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
      memoryMomentId: memoryResult?.moment.id || null,
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
