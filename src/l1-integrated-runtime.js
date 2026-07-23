import { deriveSubentityCandidates } from "./l1-coalition-detector.js";
import { runSubentityLifecycleTick } from "./l1-subentity-runtime.js";
import { runMetacognitiveStateTick } from "./l1-metacognitive-runtime.js";
import {
  RuntimeRevisionConflictError,
  persistFalkorSubentityState,
  readFalkorSubentityState
} from "./l1-subentity-falkor.js";

export function buildIntegratedLifecycleInput(state, input, options = {}) {
  if (!input?.tickId) throw new Error("An integrated L1 tick requires a stable tickId.");
  const recordedAt = input.recordedAt || new Date().toISOString();
  const detection = deriveSubentityCandidates({
    state,
    sensory: input.sensory,
    affect: input.affect,
    workspace: input.workspace,
    memory: input.memory,
    observationId: input.observationId,
    evidenceMomentIds: input.evidenceMomentIds,
    tickId: input.tickId,
    recordedAt,
    policy: options.coalitionPolicy
  });
  return {
    detection,
    lifecycleInput: {
      tickId: input.tickId,
      recordedAt,
      candidates: detection.candidates,
      perception: detection.perception,
      workspaceSnapshot: detection.workspaceSnapshot,
      memory: input.memory || null,
      outcome: input.outcome || null,
      outcomeId: input.outcomeId || null,
      momentEligibility: input.momentEligibility || {}
    }
  };
}

export function runIntegratedL1Tick(state, input, options = {}) {
  const built = buildIntegratedLifecycleInput(state, input, options);
  const lifecycle = runSubentityLifecycleTick(state, built.lifecycleInput, {
    policy: options.subentityPolicy,
    momentReinforcementPolicy: options.momentReinforcementPolicy
  });
  if (!input.traversal) return { ...lifecycle, detection: built.detection, metacognition: null };
  const metacognition = runMetacognitiveStateTick({
    previousState: state.metacognitive,
    traversal: input.traversal,
    workspace: input.workspace,
    subentities: state.subentities || [],
    config: options.metacognitivePolicy
  });
  const nextState = {
    ...lifecycle.state,
    metacognitive: metacognition.nextState,
    subentities: lifecycle.state.subentities.map(entity => {
      const adaptation = metacognition.adaptations[entity.id];
      return adaptation ? { ...entity, behavioralState: adaptation } : entity;
    })
  };
  return {
    ...lifecycle,
    state: nextState,
    report: {
      ...lifecycle.report,
      metacognitiveMode: metacognition.mode,
      scenarioCount: metacognition.evaluation.scenarios.length,
      stateAwareness: metacognition.nextState.awareness,
      behavioralAdaptations: Object.keys(metacognition.adaptations).length
    },
    detection: built.detection,
    metacognition
  };
}

const meaningfulStateFingerprint = state => JSON.stringify(Object.fromEntries(
  Object.entries(state || {}).filter(([key]) => !["revision", "updatedAt", "processedTickIds"].includes(key))
));

const positiveInteger = (value, name) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${name} must be a positive integer.`);
  return number;
};

/**
 * Propage une observation en mémoire jusqu'à équilibre, puis laisse l'appelant
 * persister une seule révision finale. L'observationId reste identique pendant
 * tous les micro-ticks : une preuve ne peut donc renforcer la structure qu'une fois.
 */
export function runIntegratedL1UntilStable(state, input, options = {}) {
  if (!input?.tickId) throw new Error("An automatic L1 run requires a stable tickId.");
  if (!String(input.observationId || "").trim()) throw new Error("An automatic L1 run requires an observationId.");
  const maxMicroTicks = positiveInteger(options.maxMicroTicks ?? 12, "maxMicroTicks");
  const requiredQuietTicks = positiveInteger(options.requiredQuietTicks ?? 1, "requiredQuietTicks");
  let currentState = state;
  let quietTicks = 0;
  let stopReason = "max_micro_ticks";
  let representativeDetection = null;
  let finalMetacognition = null;
  const history = [];
  const merges = [];
  const promotions = [];

  for (let index = 1; index <= maxMicroTicks; index += 1) {
    const before = meaningfulStateFingerprint(currentState);
    const microInput = {
      ...input,
      tickId: `${input.tickId}:micro:${index}`,
      memory: index === 1 ? (input.memory || null) : null,
      outcome: index === 1 ? (input.outcome || null) : null,
      outcomeId: index === 1 ? (input.outcomeId || null) : null
    };
    const result = runIntegratedL1Tick(currentState, microInput, options);
    const meaningfulChanged = meaningfulStateFingerprint(result.state) !== before;
    currentState = result.state;
    if (result.detection?.observation?.novelObservation && !representativeDetection) representativeDetection = result.detection;
    finalMetacognition = result.metacognition || finalMetacognition;
    merges.push(...(result.report.merges || []));
    promotions.push(...(result.report.promotions || []));
    quietTicks = meaningfulChanged ? 0 : quietTicks + 1;
    history.push({
      microTick: index,
      tickId: microInput.tickId,
      status: result.report.status,
      meaningfulChanged,
      novelObservation: result.detection?.observation?.novelObservation ?? null,
      candidateId: result.detection?.observation?.candidateId || null,
      merges: (result.report.merges || []).length,
      promotions: (result.report.promotions || []).length
    });
    if (merges.length || promotions.length) {
      stopReason = "material_event";
      break;
    }
    if (quietTicks >= requiredQuietTicks) {
      stopReason = "stable";
      break;
    }
  }

  const active = (currentState.subentities || []).filter(entity => entity.status !== "merged");
  const changed = history.some(entry => entry.status !== "already_processed");
  return {
    state: currentState,
    report: {
      tickId: input.tickId,
      status: changed ? "applied" : "already_processed",
      changed,
      meaningfulChanged: history.some(entry => entry.meaningfulChanged),
      revision: Number(currentState.revision || 0),
      merges,
      promotions,
      activeSubentityCount: active.length,
      highLevelSubentityCount: active.filter(entity => entity.level === "high").length,
      microTickCount: history.length,
      stopReason,
      stable: stopReason === "stable"
    },
    detection: representativeDetection,
    metacognition: finalMetacognition,
    stabilization: { maxMicroTicks, requiredQuietTicks, quietTicks, stopReason, history }
  };
}

export async function applyFalkorIntegratedL1Tick({ graph, input, coalitionPolicy, subentityPolicy, maxRetries = 3 }) {
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const current = await readFalkorSubentityState(graph);
    const integrated = runIntegratedL1Tick(current.state, input, { coalitionPolicy, subentityPolicy });
    if (!integrated.report.changed) return { ...integrated, persisted: false, attempts: attempt, projectionStatus: current.projectionRevision === current.revision ? "current" : "repair_required" };
    try {
      const persistence = await persistFalkorSubentityState(graph, integrated.state, current.revision);
      return { ...integrated, ...persistence, attempts: attempt };
    } catch (error) {
      if (!(error instanceof RuntimeRevisionConflictError) || attempt === maxRetries) throw error;
    }
  }
  throw new Error("Unreachable integrated L1 retry state.");
}

export async function applyFalkorIntegratedL1UntilStable({ graph, input, coalitionPolicy, subentityPolicy, metacognitivePolicy, maxMicroTicks, requiredQuietTicks, maxRetries = 3 }) {
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const current = await readFalkorSubentityState(graph);
    const integrated = runIntegratedL1UntilStable(current.state, input, {
      coalitionPolicy,
      subentityPolicy,
      metacognitivePolicy,
      maxMicroTicks,
      requiredQuietTicks
    });
    if (!integrated.report.changed) return { ...integrated, persisted: false, attempts: attempt, projectionStatus: current.projectionRevision === current.revision ? "current" : "repair_required" };
    try {
      const persistence = await persistFalkorSubentityState(graph, integrated.state, current.revision);
      return { ...integrated, ...persistence, attempts: attempt };
    } catch (error) {
      if (!(error instanceof RuntimeRevisionConflictError) || attempt === maxRetries) throw error;
    }
  }
  throw new Error("Unreachable automatic integrated L1 retry state.");
}

export function summarizeSubentityRuntime(state, { recentLimit = 20 } = {}) {
  const active = (state.subentities || []).filter(entity => entity.status !== "merged");
  const latestMoment = [...(state.moments || [])].sort((a, b) => String(b.occurredAt || "").localeCompare(String(a.occurredAt || "")))[0] || null;
  const controllerEdges = latestMoment ? (state.relations || []).filter(edge => edge.type === "CONTROLLED_WORKSPACE_DURING" && edge.target === latestMoment.id).sort((a, b) => a.rank - b.rank) : [];
  return {
    revision: Number(state.revision || 0),
    updatedAt: state.updatedAt || null,
    counts: {
      actors: (state.actors || []).length,
      stimulusSpaces: (state.spaces || []).length,
      stimulusMoments: (state.perceptualMoments || []).length,
      active: active.length,
      highLevel: active.filter(entity => entity.level === "high").length,
      candidates: active.filter(entity => entity.level !== "high").length,
      merged: (state.subentities || []).filter(entity => entity.status === "merged").length,
      narratives: (state.narratives || []).length,
      moments: (state.moments || []).length
    },
    activeSubentities: active.sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0)),
    latestMoment,
    controllers: controllerEdges.map(edge => ({ subentityId: edge.source, confidence: edge.confidence, attribution: edge.attribution })),
    recentEvents: (state.events || []).slice(-recentLimit).reverse(),
    narratives: state.narratives || []
  };
}
