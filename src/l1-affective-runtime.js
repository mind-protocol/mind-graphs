export const CORE_AFFECTS = Object.freeze([
  "curiosity", "desire", "care", "fearOfError", "frustration", "surprise", "anger"
]);

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
const bounded = (value, name) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`${name} must be in [0,1]`);
  return number;
};
const nonnegative = (value, name) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${name} must be non-negative`);
  return number;
};

export const emptyAffectVector = () => Object.fromEntries(CORE_AFFECTS.map(affect => [affect, 0]));

export function normalizeAffectVector(vector = {}) {
  const normalized = emptyAffectVector();
  for (const affect of CORE_AFFECTS) normalized[affect] = clamp01(vector[affect]);
  return normalized;
}

export const FRENCH_AFFECT_PHRASES = Object.freeze({
  curiosity: "curieux",
  desire: "désireux d'avancer",
  care: "attentionné",
  fearOfError: "inquiet de se tromper",
  frustration: "frustré",
  surprise: "surpris",
  anger: "en colère"
});

const joinFrench = parts => parts.length < 2
  ? (parts[0] || "")
  : `${parts.slice(0, -1).join(", ")} et ${parts.at(-1)}`;

/** Traduit un vecteur affectif courant en une phrase française courte. */
export function describeAffectState(vector = {}, { subject = "Mon système", minimumIntensity = 0.15, maximumAffects = 3 } = {}) {
  const minimum = bounded(minimumIntensity, "minimumIntensity");
  if (!Number.isInteger(maximumAffects) || maximumAffects < 1) throw new Error("maximumAffects must be a positive integer");
  const normalized = normalizeAffectVector(vector);
  const phrases = CORE_AFFECTS
    .map((affect, order) => ({ affect, order, intensity: normalized[affect] }))
    .filter(entry => entry.intensity >= minimum)
    .sort((left, right) => right.intensity - left.intensity || left.order - right.order)
    .slice(0, maximumAffects)
    .map(({ affect, intensity }) => {
      const qualifier = intensity >= 0.75 ? "très " : intensity < 0.4 ? "un peu " : "";
      return `${qualifier}${FRENCH_AFFECT_PHRASES[affect]}`;
    });
  return phrases.length
    ? `${subject} est ${joinFrench(phrases)}.`
    : `${subject} ne présente pas d'affect saillant détecté.`;
}

function add(target, affect, amount) {
  target[affect] = clamp01(target[affect] + amount);
}

/**
 * Traduit une relation active en signal affectif. La polarité ne choisit jamais
 * seule une émotion : contradiction, blocage, menace et contrôle restent des
 * variables de contexte séparées et auditables.
 */
export function edgeAffectSignal(edge, context = {}) {
  const signal = normalizeAffectVector(edge.affectVector);
  const physics = edge.physics || {};
  const polarity = Number(physics.P ?? physics.polarity ?? 1);
  const negative = Math.max(0, -polarity);
  const positive = Math.max(0, polarity);
  const uncertainty = clamp01(context.uncertainty);
  const novelty = clamp01(context.novelty);
  const repeatedFailure = clamp01(context.repeatedFailure);
  const threat = clamp01(context.threat);
  const controlDeficit = 1 - clamp01(context.perceivedControl ?? 1);
  const reward = clamp01(context.rewardExpectation);
  const careSalience = clamp01(context.careSalience);

  if (negative > 0 && context.contradiction) add(signal, "surprise", negative * (0.35 + 0.45 * uncertainty));
  if (negative > 0 && context.blockedGoal) add(signal, "frustration", negative * (0.3 + 0.55 * repeatedFailure));
  if (negative > 0 && threat > 0) add(signal, "fearOfError", negative * threat * (0.35 + 0.45 * controlDeficit));
  if (negative > 0 && context.boundaryViolation) add(signal, "anger", negative * (0.3 + 0.5 * clamp01(context.agencyAvailable)));
  if (negative > 0 && !context.contradiction && !context.blockedGoal && threat === 0 && !context.boundaryViolation) {
    add(signal, "surprise", negative * 0.15);
  }
  if (positive > 0 && novelty > 0) add(signal, "curiosity", positive * novelty * (0.25 + 0.35 * uncertainty));
  if (positive > 0 && reward > 0) add(signal, "desire", positive * reward * 0.55);
  if (careSalience > 0) add(signal, "care", careSalience * 0.6);
  return signal;
}

export function aggregateAffectSignals(activeLinks, context = {}) {
  const total = emptyAffectVector();
  for (const activation of activeLinks) {
    const edge = activation.edge || activation;
    const physics = edge.physics || {};
    const energy = nonnegative(activation.energy ?? 1, "energy");
    const weight = bounded(physics.W ?? physics.weight ?? 1, "W");
    const gate = bounded(physics.G ?? physics.gate ?? 1, "G");
    const intensity = energy * weight * gate;
    const signal = edgeAffectSignal(edge, { ...context, ...(activation.context || {}) });
    for (const affect of CORE_AFFECTS) add(total, affect, signal[affect] * intensity);
  }
  return total;
}

export function selectDominantAffect(vector, { dominanceThreshold, minimumMargin }) {
  const threshold = bounded(dominanceThreshold, "dominanceThreshold");
  const marginRequired = bounded(minimumMargin, "minimumMargin");
  const ranked = Object.entries(normalizeAffectVector(vector)).sort((a, b) => b[1] - a[1]);
  const [first, second] = ranked;
  if (!first || first[1] < threshold || first[1] - (second?.[1] || 0) < marginRequired) return null;
  return { affect: first[0], intensity: first[1], margin: first[1] - (second?.[1] || 0) };
}

const HOMEOSTATIC_POLICIES = Object.freeze({
  surprise: ["SEARCH_SIMILAR_NODES", "PROPOSE_HYPOTHESIS_NODE", "REQUEST_REAPPRAISAL"],
  frustration: ["RESOLVE_BLOCKING_QUESTION", "PIVOT_STRATEGY", "RELEASE_FAILED_PATH"],
  anger: ["CHECK_BOUNDARY", "PROPOSE_LIMIT", "PIVOT_STRATEGY"],
  fearOfError: ["VERIFY_EVIDENCE", "SIMULATE_MORE", "REQUEST_HUMAN_REVIEW"],
  curiosity: ["EXPLORE_NEIGHBORHOOD", "SEARCH_NOVEL_EVIDENCE"],
  desire: ["PLAN_TOWARD_GOAL", "KEEP_OPEN_LOOP_SALIENT"],
  care: ["ASSESS_VULNERABILITY", "PROPOSE_PROTECTIVE_ACTION"]
});

export function proposeHomeostaticBehavior(dominant) {
  if (!dominant) return { mode: "NO_DOMINANT_AFFECT", proposals: [], executesAction: false };
  return {
    mode: "REDUCE_AFFECTIVE_ERROR",
    targetAffect: dominant.affect,
    targetIntensity: dominant.intensity,
    proposals: [...HOMEOSTATIC_POLICIES[dominant.affect]],
    executesAction: false
  };
}

export function runAffectiveHomeostasisTick({ previousState = {}, activeLinks = [], context = {}, config }) {
  if (!config) throw new Error("Affective tick requires explicit config; no universal threshold is allowed");
  const decay = bounded(config.decay, "decay");
  const integrationGain = bounded(config.integrationGain, "integrationGain");
  const previous = normalizeAffectVector(previousState);
  const incoming = aggregateAffectSignals(activeLinks, context);
  const next = emptyAffectVector();
  for (const affect of CORE_AFFECTS) next[affect] = clamp01(previous[affect] * (1 - decay) + incoming[affect] * integrationGain);
  const dominant = selectDominantAffect(next, config);
  return { previous, incoming, next, description: describeAffectState(next), dominant, behavior: proposeHomeostaticBehavior(dominant) };
}

export function subentityAffectiveGate({ affectState, compatibility, metabolicAvailability, safetyGate, permissionGate }) {
  const state = normalizeAffectVector(affectState);
  const profile = normalizeAffectVector(compatibility);
  const dot = CORE_AFFECTS.reduce((sum, affect) => sum + state[affect] * profile[affect], 0);
  const declaredCompatibility = CORE_AFFECTS.reduce((sum, affect) => sum + profile[affect], 0);
  const compatibilityGate = declaredCompatibility ? clamp01(dot / declaredCompatibility) : 0;
  return clamp01(
    compatibilityGate
    * bounded(metabolicAvailability, "metabolicAvailability")
    * bounded(safetyGate, "safetyGate")
    * bounded(permissionGate, "permissionGate")
  );
}

export function learnLinkAffectProfile(profile, observedVector, { observationCount, learningRate, minimumObservations }) {
  if (!Number.isInteger(observationCount) || observationCount < 0) throw new Error("observationCount must be a non-negative integer");
  if (!Number.isInteger(minimumObservations) || minimumObservations < 1) throw new Error("minimumObservations must be positive");
  const current = normalizeAffectVector(profile);
  if (observationCount + 1 < minimumObservations) return { vector: current, observationCount: observationCount + 1, learned: false };
  const rate = bounded(learningRate, "learningRate");
  const observed = normalizeAffectVector(observedVector);
  const vector = emptyAffectVector();
  for (const affect of CORE_AFFECTS) vector[affect] = clamp01(current[affect] + rate * (observed[affect] - current[affect]));
  return { vector, observationCount: observationCount + 1, learned: true };
}
