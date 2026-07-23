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
    recordedAt,
    policy: options.coalitionPolicy
  });
  return {
    detection,
    lifecycleInput: {
      tickId: input.tickId,
      recordedAt,
      candidates: detection.candidates,
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

export function summarizeSubentityRuntime(state, { recentLimit = 20 } = {}) {
  const active = (state.subentities || []).filter(entity => entity.status !== "merged");
  const latestMoment = [...(state.moments || [])].sort((a, b) => String(b.occurredAt || "").localeCompare(String(a.occurredAt || "")))[0] || null;
  const controllerEdges = latestMoment ? (state.relations || []).filter(edge => edge.type === "CONTROLLED_WORKSPACE_DURING" && edge.target === latestMoment.id).sort((a, b) => a.rank - b.rank) : [];
  return {
    revision: Number(state.revision || 0),
    updatedAt: state.updatedAt || null,
    counts: {
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
