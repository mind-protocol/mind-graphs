export const MOMENT_OUTCOME_DIMENSIONS = Object.freeze([
  "humanValenceDelta",
  "positiveAffectDelta",
  "subentityEnergyDelta",
  "completenessDelta",
  "goalProgressDelta"
]);

export const POSITIVE_AFFECT_KEYS = Object.freeze([
  "joy", "relief", "pride", "curiosity", "desire", "care"
]);

const finite = value => typeof value === "number" && Number.isFinite(value);
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const bounded = (value, name, minimum, maximum) => {
  if (!finite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be in [${minimum},${maximum}]`);
  }
  return value;
};

/**
 * Moyenne des affects positifs effectivement présents. Les dimensions absentes
 * restent inconnues : elles ne sont ni ajoutées au dénominateur ni remplacées
 * par zéro. Le runtime peut ainsi accueillir joie, soulagement et fierté sans
 * prétendre qu'elles sont déjà calculées par son noyau affectif actuel.
 */
export function positiveAffectLevel(vector = {}) {
  const observed = POSITIVE_AFFECT_KEYS
    .filter(key => finite(vector[key]))
    .map(key => bounded(vector[key], `affect.${key}`, 0, 1));
  return observed.length ? observed.reduce((sum, value) => sum + value, 0) / observed.length : null;
}

export function deriveMomentOutcome(input = {}) {
  const vector = {};
  if (finite(input.humanValenceDelta)) {
    vector.humanValenceDelta = bounded(input.humanValenceDelta, "humanValenceDelta", -2, 2) / 2;
  }
  if (finite(input.positiveAffectDelta)) {
    vector.positiveAffectDelta = bounded(input.positiveAffectDelta, "positiveAffectDelta", -1, 1);
  } else {
    const before = positiveAffectLevel(input.positiveAffectBefore);
    const after = positiveAffectLevel(input.positiveAffectAfter);
    if (before !== null && after !== null) vector.positiveAffectDelta = clamp(after - before, -1, 1);
  }
  for (const dimension of ["subentityEnergyDelta", "completenessDelta", "goalProgressDelta"]) {
    if (finite(input[dimension])) vector[dimension] = bounded(input[dimension], dimension, -1, 1);
  }
  if (!Object.keys(vector).length) throw new Error("A Moment outcome requires at least one observed dimension");
  return vector;
}

/**
 * Agrège seulement les dimensions observées et renormalise leurs poids. Le
 * choix normatif des poids appartient au citoyen/runtime appelant ; aucun jeu
 * de coefficients universel n'est caché dans ce module.
 */
export function scoreMomentOutcome(outcome, outcomeWeights) {
  if (!outcomeWeights || typeof outcomeWeights !== "object") {
    throw new Error("Moment reinforcement requires explicit outcomeWeights");
  }
  const vector = deriveMomentOutcome(outcome);
  const observed = Object.entries(vector).map(([dimension, value]) => {
    const weight = Number(outcomeWeights[dimension]);
    if (!finite(weight) || weight < 0) throw new Error(`Missing non-negative outcome weight for ${dimension}`);
    return { dimension, value, weight };
  });
  const totalWeight = observed.reduce((sum, item) => sum + item.weight, 0);
  if (!(totalWeight > 0)) throw new Error("Observed Moment outcome weights must sum above zero");
  const contributions = Object.fromEntries(observed.map(item => [
    item.dimension,
    item.value * item.weight / totalWeight
  ]));
  return {
    vector,
    normalizedWeights: Object.fromEntries(observed.map(item => [item.dimension, item.weight / totalWeight])),
    contributions,
    score: clamp(Object.values(contributions).reduce((sum, value) => sum + value, 0), -1, 1)
  };
}

const requirePolicy = policy => {
  if (!policy || typeof policy !== "object") throw new Error("Moment reinforcement requires an explicit policy");
  return {
    outcomeWeights: policy.outcomeWeights,
    learningRate: bounded(policy.learningRate, "learningRate", 0, 1),
    minimumWeight: bounded(policy.minimumWeight, "minimumWeight", 0, Number.MAX_SAFE_INTEGER),
    maximumWeight: bounded(policy.maximumWeight, "maximumWeight", 0, Number.MAX_SAFE_INTEGER)
  };
};

/**
 * Tous les Moments conservent le même schéma de renforcement. Un résultat ne
 * crédite toutefois que ceux dont l'éligibilité est explicitement positive :
 * universel décrit la capacité d'apprendre, pas une causalité globale fictive.
 */
export function reinforceMoments(moments, outcome, {
  policy,
  eligibilityByMoment = {},
  observedAt = null,
  outcomeId = null
} = {}) {
  if (!Array.isArray(moments)) throw new Error("reinforceMoments requires a moments array");
  const resolved = requirePolicy(policy);
  if (resolved.maximumWeight < resolved.minimumWeight) throw new Error("maximumWeight must be >= minimumWeight");
  const scored = scoreMomentOutcome(outcome, resolved.outcomeWeights);
  const updates = [];
  const nextMoments = moments.map(moment => {
    if (!moment?.id) throw new Error("Every reinforced Moment requires an id");
    const rawEligibility = Object.hasOwn(eligibilityByMoment, moment.id)
      ? eligibilityByMoment[moment.id]
      : 0;
    const eligibility = bounded(rawEligibility, `eligibility.${moment.id}`, 0, 1);
    const previous = moment.reinforcement || {};
    const previousWeight = finite(previous.weight) ? previous.weight : 1;
    const delta = resolved.learningRate * scored.score * eligibility;
    const weight = clamp(previousWeight + delta, resolved.minimumWeight, resolved.maximumWeight);
    const reinforcement = {
      weight,
      updateCount: Number(previous.updateCount || 0) + (eligibility > 0 ? 1 : 0),
      lastEligibility: eligibility,
      lastScore: eligibility > 0 ? scored.score : (previous.lastScore ?? null),
      lastOutcomeVector: eligibility > 0 ? scored.vector : (previous.lastOutcomeVector ?? null),
      lastOutcomeContributions: eligibility > 0 ? scored.contributions : (previous.lastOutcomeContributions ?? null),
      lastOutcomeId: eligibility > 0 ? outcomeId : (previous.lastOutcomeId ?? null),
      lastObservedAt: eligibility > 0 ? observedAt : (previous.lastObservedAt ?? null)
    };
    if (eligibility > 0) updates.push({ momentId: moment.id, previousWeight, weight, delta, eligibility });
    return { ...moment, reinforcement };
  });
  return { moments: nextMoments, score: scored, updates };
}
