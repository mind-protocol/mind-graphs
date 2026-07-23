export const METACOGNITIVE_FORMULAS = Object.freeze({
  scenarioLogWeight: "L_i = ln(prior_i) + evidenceGain × (support_i - contradiction_i) + noveltyGain × novelty_i",
  scenarioUtility: "U_i = w_goal × goalAlignment_i + w_valence × expectedValence_i + w_control × controllability_i + w_reversible × reversibility_i - w_threat × threat_i - w_cost × cost_i",
  posterior: "p_i = exp(L_i / temperature) / Σ_j exp(L_j / temperature)",
  normalizedEntropy: "H = -Σ_i p_i ln(p_i) / ln(N)",
  calibratedConfidence: "C = meanEvidence × (1 - H)",
  verifiedUncontrollableThreat: "T_v = Σ_i p_i × threat_i × evidence_i × (1 - controllability_i)",
  gateSlew: "G(t+1) = G(t) + clip(G_target - G(t), -maxGateDelta, +maxGateDelta)"
});

export const DEFAULT_METACOGNITIVE_POLICY = Object.freeze({
  temperature: 0.7,
  evidenceGain: 1.4,
  noveltyGain: 0.15,
  utilityWeights: Object.freeze({
    goalAlignment: 0.3,
    expectedValence: 0.2,
    controllability: 0.2,
    reversibility: 0.15,
    threat: 0.3,
    cost: 0.15
  }),
  awarenessSmoothing: 0.35,
  uncertaintyThreshold: 0.58,
  minimumEvidenceForCommitment: 0.55,
  protectThreshold: 0.62,
  hardSafetyEvidenceThreshold: 0.85,
  protectPersistenceTicks: 3,
  recoveryThreshold: 0.28,
  recoveryPersistenceTicks: 2,
  overloadArousalThreshold: 0.85,
  depletedEnergyThreshold: 0.2,
  maxGateDelta: 0.12,
  maximumSubentityGate: 0.85,
  captainReserve: 0.15,
  maxScenarios: 12
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const clamp01 = value => clamp(value, 0, 1);
const signed = value => clamp(value, -1, 1);
const finite = (value, name) => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} must be finite`);
  return number;
};
const bounded = (value, name) => {
  const number = finite(value, name);
  if (number < 0 || number > 1) throw new Error(`${name} must be in [0,1]`);
  return number;
};

export const createMetacognitiveState = () => ({
  schemaVersion: "0.1.0",
  revision: 0,
  mode: "OBSERVE",
  threatPersistence: 0,
  recoveryPersistence: 0,
  awareness: {
    arousal: 0,
    energyAvailability: 1,
    uncertainty: 0,
    controllability: 1,
    expectedValence: 0,
    verifiedThreat: 0,
    calibratedConfidence: 0
  },
  scenarios: [],
  subentityAdaptations: {},
  lastTickId: null
});

function normalizeScenario(scenario, position) {
  if (!scenario?.id) throw new Error(`scenario ${position} requires an id`);
  return {
    id: scenario.id,
    label: scenario.label || scenario.name || scenario.id,
    subentityId: scenario.subentityId || null,
    pathNodeIds: [...new Set(scenario.pathNodeIds || scenario.nodeIds || [])],
    prior: bounded(scenario.prior ?? 0.5, `${scenario.id}.prior`),
    support: bounded(scenario.support ?? scenario.evidence ?? 0.5, `${scenario.id}.support`),
    contradiction: bounded(scenario.contradiction ?? 0, `${scenario.id}.contradiction`),
    evidence: bounded(scenario.evidence ?? scenario.support ?? 0.5, `${scenario.id}.evidence`),
    novelty: bounded(scenario.novelty ?? 0, `${scenario.id}.novelty`),
    threat: bounded(scenario.threat ?? 0, `${scenario.id}.threat`),
    controllability: bounded(scenario.controllability ?? 0.5, `${scenario.id}.controllability`),
    reversibility: bounded(scenario.reversibility ?? 0.5, `${scenario.id}.reversibility`),
    cost: bounded(scenario.cost ?? 0, `${scenario.id}.cost`),
    goalAlignment: signed(scenario.goalAlignment ?? 0),
    expectedValence: signed(scenario.expectedValence ?? 0),
    proposedStrategy: scenario.proposedStrategy || null,
    provenance: scenario.provenance || null
  };
}

function scenarioUtility(scenario, weights) {
  return weights.goalAlignment * scenario.goalAlignment
    + weights.expectedValence * scenario.expectedValence
    + weights.controllability * scenario.controllability
    + weights.reversibility * scenario.reversibility
    - weights.threat * scenario.threat
    - weights.cost * scenario.cost;
}

export function evaluateTraversalScenarios(rawScenarios, config = {}) {
  const policy = { ...DEFAULT_METACOGNITIVE_POLICY, ...config, utilityWeights: { ...DEFAULT_METACOGNITIVE_POLICY.utilityWeights, ...(config.utilityWeights || {}) } };
  if (!Array.isArray(rawScenarios)) throw new Error("traversal scenarios must be an array");
  const scenarios = rawScenarios.slice(0, policy.maxScenarios).map(normalizeScenario);
  if (!scenarios.length) return { scenarios: [], entropy: 0, meanEvidence: 0, calibratedConfidence: 0 };
  const temperature = Math.max(0.05, finite(policy.temperature, "temperature"));
  const logits = scenarios.map(scenario => {
    const utility = scenarioUtility(scenario, policy.utilityWeights);
    const logWeight = Math.log(Math.max(1e-9, scenario.prior))
      + policy.evidenceGain * (scenario.support - scenario.contradiction)
      + policy.noveltyGain * scenario.novelty;
    return { scenario, utility, logWeight };
  });
  const maxLogit = Math.max(...logits.map(item => item.logWeight / temperature));
  const masses = logits.map(item => Math.exp(item.logWeight / temperature - maxLogit));
  const total = masses.reduce((sum, value) => sum + value, 0);
  const evaluated = logits.map((item, index) => ({
    ...item.scenario,
    utility: item.utility,
    logWeight: item.logWeight,
    probability: masses[index] / total
  })).sort((a, b) => b.probability - a.probability || a.id.localeCompare(b.id));
  const entropy = evaluated.length > 1
    ? -evaluated.reduce((sum, item) => sum + item.probability * Math.log(Math.max(item.probability, 1e-12)), 0) / Math.log(evaluated.length)
    : 0;
  const meanEvidence = evaluated.reduce((sum, item) => sum + item.probability * item.evidence, 0);
  return {
    scenarios: evaluated,
    entropy: clamp01(entropy),
    meanEvidence: clamp01(meanEvidence),
    calibratedConfidence: clamp01(meanEvidence * (1 - entropy))
  };
}

function posteriorMean(scenarios, field) {
  return scenarios.reduce((sum, scenario) => sum + scenario.probability * scenario[field], 0);
}

function smooth(previous, observed, alpha) {
  return previous * (1 - alpha) + observed * alpha;
}

function observedState(traversal, workspace, evaluation) {
  const entity = workspace.activeEntity || workspace.broadcastEntity || {};
  const scenarios = evaluation.scenarios;
  return {
    arousal: clamp01(traversal.arousal ?? entity.arousal ?? entity.affectIntensity ?? 0),
    energyAvailability: clamp01(traversal.energyAvailability ?? entity.energyAvailability ?? 1),
    uncertainty: evaluation.entropy,
    controllability: scenarios.length ? posteriorMean(scenarios, "controllability") : 1,
    expectedValence: scenarios.length ? posteriorMean(scenarios, "expectedValence") : 0,
    verifiedThreat: scenarios.reduce((sum, scenario) =>
      sum + scenario.probability * scenario.threat * scenario.evidence * (1 - scenario.controllability), 0),
    calibratedConfidence: evaluation.calibratedConfidence
  };
}

function selectMode(previous, awareness, traversal, policy) {
  const hardSafety = traversal.hardSafety === true
    && bounded(traversal.hardSafetyEvidence ?? 0, "hardSafetyEvidence") >= policy.hardSafetyEvidenceThreshold;
  const threatAbove = awareness.verifiedThreat >= policy.protectThreshold;
  const threatPersistence = threatAbove ? previous.threatPersistence + 1 : Math.max(0, previous.threatPersistence - 1);
  const recovering = awareness.verifiedThreat <= policy.recoveryThreshold;
  const recoveryPersistence = recovering ? previous.recoveryPersistence + 1 : 0;

  let mode;
  if (previous.mode === "PROTECT" && recoveryPersistence < policy.recoveryPersistenceTicks) mode = "PROTECT";
  else if (previous.mode === "PROTECT") mode = "RECOVER";
  else if (hardSafety || threatPersistence >= policy.protectPersistenceTicks) mode = "PROTECT";
  else if (threatAbove) mode = "STABILIZE";
  else if (awareness.arousal >= policy.overloadArousalThreshold || awareness.energyAvailability <= policy.depletedEnergyThreshold) mode = "STABILIZE";
  else if (awareness.uncertainty >= policy.uncertaintyThreshold || awareness.calibratedConfidence < policy.minimumEvidenceForCommitment) mode = "VERIFY";
  else if (awareness.expectedValence > 0 && awareness.controllability >= 0.5) mode = "ENGAGE";
  else mode = "OBSERVE";
  return { mode, hardSafety, threatPersistence, recoveryPersistence };
}

const MODE_POLICIES = Object.freeze({
  OBSERVE: { strategies: ["MONITOR_STATE", "KEEP_ALTERNATIVES_VISIBLE"], horizon: "medium", targetBase: 0.4 },
  VERIFY: { strategies: ["SEEK_DISCRIMINATING_EVIDENCE", "COMPARE_SCENARIOS", "KEEP_ACTION_REVERSIBLE"], horizon: "short", targetBase: 0.35 },
  STABILIZE: { strategies: ["REDUCE_SCOPE", "RESTORE_RESOURCES", "PRESERVE_OPTIONALITY"], horizon: "immediate", targetBase: 0.25 },
  PROTECT: { strategies: ["PAUSE_IRREVERSIBLE_ACTION", "REQUEST_SUPPORT", "MOVE_TO_SAFER_STATE"], horizon: "immediate", targetBase: 0.2 },
  RECOVER: { strategies: ["RESTORE_GATES_GRADUALLY", "RECHECK_SAFETY_CONTEXT", "RESUME_SMALLEST_SAFE_STEP"], horizon: "short", targetBase: 0.3 },
  ENGAGE: { strategies: ["TAKE_SMALLEST_USEFUL_STEP", "MONITOR_OUTCOME", "PRESERVE_ROLLBACK"], horizon: "medium", targetBase: 0.5 }
});

function adaptSubentities(subentities, evaluation, mode, policy, previousAdaptations = {}) {
  const scenarioSupport = new Map();
  for (const scenario of evaluation.scenarios) {
    if (!scenario.subentityId) continue;
    const useful = scenario.probability * (0.5 + 0.5 * scenario.controllability) * (1 - 0.7 * scenario.threat);
    scenarioSupport.set(scenario.subentityId, (scenarioSupport.get(scenario.subentityId) || 0) + useful);
  }
  const modePolicy = MODE_POLICIES[mode];
  const rawTargets = subentities.map(entity => ({
    entity,
    support: clamp01(scenarioSupport.get(entity.id) || 0),
    previousGate: clamp01(previousAdaptations[entity.id]?.gate ?? entity.behavioralState?.gate ?? 0.5)
  }));
  const available = 1 - policy.captainReserve;
  const targetSum = rawTargets.reduce((sum, item) => sum + modePolicy.targetBase + 0.45 * item.support, 0) || 1;
  const adaptations = {};
  const adaptedSubentities = rawTargets.map(item => {
    const normalizedTarget = Math.min(policy.maximumSubentityGate, available * (modePolicy.targetBase + 0.45 * item.support) / targetSum);
    const delta = clamp(normalizedTarget - item.previousGate, -policy.maxGateDelta, policy.maxGateDelta);
    const gate = clamp01(item.previousGate + delta);
    const preferred = evaluation.scenarios.find(scenario => scenario.subentityId === item.entity.id)?.proposedStrategy;
    const adaptation = {
      mode,
      gate,
      gateDelta: delta,
      scenarioSupport: item.support,
      strategies: [...new Set([preferred, ...modePolicy.strategies].filter(Boolean))],
      planningHorizon: modePolicy.horizon,
      allowIrreversibleAction: false,
      requiresHumanApprovalForHighStakes: true
    };
    adaptations[item.entity.id] = adaptation;
    return { ...item.entity, behavioralState: adaptation };
  });
  return { adaptations, adaptedSubentities };
}

export function runMetacognitiveStateTick({
  previousState = createMetacognitiveState(), traversal, workspace = {}, subentities = [], config = {}
}) {
  if (!traversal?.tickId) throw new Error("a metacognitive traversal requires a stable tickId");
  if (previousState.lastTickId === traversal.tickId) {
    const adaptations = previousState.subentityAdaptations || {};
    return {
      status: "already_processed",
      previousState,
      observed: previousState.awareness,
      evaluation: { scenarios: previousState.scenarios || [], entropy: previousState.awareness?.uncertainty || 0, calibratedConfidence: previousState.awareness?.calibratedConfidence || 0 },
      mode: previousState.mode,
      safety: {
        hardSafetyAccepted: false,
        threatPersistence: previousState.threatPersistence || 0,
        recoveryPersistence: previousState.recoveryPersistence || 0,
        panicStateExists: false,
        irreversibleActionAllowed: false
      },
      adaptations,
      adaptedSubentities: subentities.map(entity => ({ ...entity, behavioralState: adaptations[entity.id] || entity.behavioralState })),
      nextState: structuredClone(previousState),
      policy: { ...DEFAULT_METACOGNITIVE_POLICY, ...config }
    };
  }
  const policy = { ...DEFAULT_METACOGNITIVE_POLICY, ...config, utilityWeights: { ...DEFAULT_METACOGNITIVE_POLICY.utilityWeights, ...(config.utilityWeights || {}) } };
  const evaluation = evaluateTraversalScenarios(traversal.scenarios || traversal.paths || [], policy);
  const observed = observedState(traversal, workspace, evaluation);
  const previousAwareness = { ...createMetacognitiveState().awareness, ...(previousState.awareness || {}) };
  const alpha = bounded(policy.awarenessSmoothing, "awarenessSmoothing");
  const awareness = Object.fromEntries(Object.entries(observed).map(([key, value]) => [
    key,
    key === "expectedValence"
      ? signed(smooth(previousAwareness[key] || 0, value, alpha))
      : clamp01(smooth(previousAwareness[key] ?? value, value, alpha))
  ]));
  // La menace vérifiée doit rester réactive ; le lissage sert à la conscience
  // d'état, pas à masquer une observation de sécurité corroborée.
  awareness.verifiedThreat = Math.max(awareness.verifiedThreat, observed.verifiedThreat);
  const selected = selectMode(previousState, awareness, traversal, policy);
  const adaptation = adaptSubentities(subentities, evaluation, selected.mode, policy, previousState.subentityAdaptations);
  const nextState = {
    schemaVersion: "0.1.0",
    revision: (previousState.revision || 0) + 1,
    mode: selected.mode,
    threatPersistence: selected.threatPersistence,
    recoveryPersistence: selected.recoveryPersistence,
    awareness,
    scenarios: evaluation.scenarios,
    subentityAdaptations: adaptation.adaptations,
    lastTickId: traversal.tickId
  };
  return {
    status: "processed",
    previousState,
    observed,
    evaluation,
    mode: selected.mode,
    safety: {
      hardSafetyAccepted: selected.hardSafety,
      threatPersistence: selected.threatPersistence,
      recoveryPersistence: selected.recoveryPersistence,
      panicStateExists: false,
      irreversibleActionAllowed: false
    },
    adaptations: adaptation.adaptations,
    adaptedSubentities: adaptation.adaptedSubentities,
    nextState,
    policy
  };
}
