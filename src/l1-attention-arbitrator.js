const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));

const bounded = (value, name) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`${name} must be in [0,1]`);
  return number;
};

const signed = (value, name) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < -1 || number > 1) throw new Error(`${name} must be in [-1,1]`);
  return number;
};

const nonnegative = (value, name) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${name} must be non-negative`);
  return number;
};

export const DEFAULT_ATTENTION_CONFIG = Object.freeze({
  minimumSensoryShare: 0.05,
  maximumSensoryShare: 0.8,
  intensityWeight: 0.45,
  noveltyWeight: 0.55,
  orientationGain: 0.8,
  tonicInternalDemand: 0.35,
  internalStateGain: 0.65,
  focusAdaptationRate: 0.25,
  habituationRate: 0.65,
  noveltyRecoveryMs: 6 * 60 * 60 * 1000
});

export const createAttentionState = ({ innerOuterFocus = 0 } = {}) => ({
  schemaVersion: "0.2.0",
  exposures: {},
  innerOuterFocus: signed(innerOuterFocus, "innerOuterFocus")
});

function timestampOf(connection, now) {
  return Number.isFinite(connection.timestamp) ? connection.timestamp : now;
}

function connectionIntensity(connection, recentWindowMs, now) {
  const strength = clamp01(connection.weight);
  const age = Math.max(0, now - timestampOf(connection, now));
  const recency = recentWindowMs > 0 && Number.isFinite(connection.timestamp)
    ? Math.exp(-age / recentWindowMs)
    : 0;
  return 1 - (1 - strength) * (1 - recency);
}

/**
 * La familiarité augmente à chaque exposition et s'efface lentement lorsque le
 * signal disparaît. La nouveauté n'est donc ni un booléen ni la seule récence.
 */
export function measureExternalDemand(connections, embeddedLines, previousState, {
  now, recentWindowMs, habituationRate, noveltyRecoveryMs
}) {
  const clock = nonnegative(now, "now");
  const window = nonnegative(recentWindowMs, "recentWindowMs");
  const learning = bounded(habituationRate, "habituationRate");
  const recovery = nonnegative(noveltyRecoveryMs, "noveltyRecoveryMs");
  const prior = previousState?.exposures || {};
  const exposures = { ...prior };
  const byConnection = [];

  for (const line of embeddedLines) {
    const previous = prior[line.sensoryLineHash];
    const elapsed = previous ? Math.max(0, clock - previous.lastSeenAt) : Infinity;
    const recoveredFamiliarity = previous
      ? previous.familiarity * (recovery === 0 ? 1 : Math.exp(-elapsed / recovery))
      : 0;
    const novelty = 1 - clamp01(recoveredFamiliarity);
    const familiarity = clamp01(recoveredFamiliarity + learning * (1 - recoveredFamiliarity));
    const intensity = connectionIntensity(line, window, clock);
    exposures[line.sensoryLineHash] = {
      familiarity,
      lastSeenAt: clock,
      exposureCount: (previous?.exposureCount || 0) + 1
    };
    byConnection.push({ sensoryLineHash: line.sensoryLineHash, intensity, novelty, familiarity });
  }

  const intensity = byConnection.length ? Math.max(...byConnection.map(item => item.intensity)) : 0;
  const intensityTotal = byConnection.reduce((sum, item) => sum + item.intensity, 0);
  const novelty = intensityTotal
    ? byConnection.reduce((sum, item) => sum + item.novelty * item.intensity, 0) / intensityTotal
    : 0;
  return {
    intensity,
    novelty,
    byConnection,
    nextState: { schemaVersion: "0.1.0", exposures }
  };
}

function activeEntityOf(workspaceState = {}) {
  return workspaceState.activeEntity || workspaceState.broadcastEntity || workspaceState.entity || {};
}

export function innerOuterFocusOf(entity = {}) {
  if (entity.innerOuterFocus !== undefined) return signed(entity.innerOuterFocus, "innerOuterFocus");
  const orientation = String(entity.attentionalOrientation || entity.orientation || "balanced").toLowerCase();
  if (!new Set(["internal", "external", "balanced"]).has(orientation)) {
    throw new Error("workspace entity orientation must be internal, external or balanced");
  }
  const intensity = bounded(entity.focusIntensity ?? 0, "focusIntensity");
  if (orientation === "internal") return -intensity;
  if (orientation === "external") return intensity;
  return 0;
}

export function measureWorkspaceDemand(workspaceState = {}, fallbackInnerOuterFocus = 0) {
  const entity = activeEntityOf(workspaceState);
  const hasAuthoredFocus = entity.innerOuterFocus !== undefined
    || entity.attentionalOrientation !== undefined
    || entity.orientation !== undefined
    || entity.focusIntensity !== undefined;
  const innerOuterFocus = hasAuthoredFocus
    ? innerOuterFocusOf(entity)
    : signed(fallbackInnerOuterFocus, "fallbackInnerOuterFocus");
  const orientation = innerOuterFocus < 0 ? "internal" : innerOuterFocus > 0 ? "external" : "balanced";
  const focusIntensity = Math.abs(innerOuterFocus);
  const internalSignals = [
    entity.homeostaticError,
    entity.affectIntensity,
    entity.goalPressure,
    entity.cognitiveLoad
  ].filter(value => value !== undefined).map(value => bounded(value, "workspace internal signal"));
  const internalDemand = internalSignals.length
    ? internalSignals.reduce((sum, value) => sum + value, 0) / internalSignals.length
    : 0;
  return {
    entityId: entity.id || null,
    orientation,
    focusIntensity,
    innerOuterFocus,
    internalDemand,
    externalOrientation: Math.max(0, innerOuterFocus),
    internalOrientation: Math.max(0, -innerOuterFocus)
  };
}

export function updateInnerOuterFocus({
  previousFocus,
  externalDemand,
  internalDemand,
  adaptationRate
}) {
  const previous = signed(previousFocus, "previousFocus");
  const external = nonnegative(externalDemand, "externalDemand");
  const internal = nonnegative(internalDemand, "internalDemand");
  const rate = bounded(adaptationRate, "focusAdaptationRate");
  const target = Math.max(-1, Math.min(1, external - internal));
  const nextFocus = previous + rate * (target - previous);
  return {
    previousFocus: previous,
    target: Number(target.toFixed(12)),
    nextFocus: Number(nextFocus.toFixed(12)),
    adaptationRate: rate,
    externalDemand: external,
    internalDemand: internal
  };
}

/**
 * Met en compétition la demande externe et la demande interne sans créer
 * d'énergie. Les bornes sont des garde-fous configurables, pas des constantes
 * biologiques. Un plafond absolu optionnel sert uniquement au debug/à la sûreté.
 */
export function allocateAttentionBudget({
  totalBudget,
  connections,
  embeddedLines,
  workspaceState = {},
  previousState = createAttentionState(),
  now,
  recentWindowMs,
  config = {},
  absoluteSensoryCap
}) {
  const budget = nonnegative(totalBudget, "totalBudget");
  const policy = { ...DEFAULT_ATTENTION_CONFIG, ...config };
  const minimum = bounded(policy.minimumSensoryShare, "minimumSensoryShare");
  const maximum = bounded(policy.maximumSensoryShare, "maximumSensoryShare");
  if (minimum > maximum) throw new Error("minimumSensoryShare cannot exceed maximumSensoryShare");
  for (const name of ["intensityWeight", "noveltyWeight", "orientationGain", "tonicInternalDemand", "internalStateGain"]) {
    policy[name] = nonnegative(policy[name], name);
  }

  const external = measureExternalDemand(connections, embeddedLines, previousState, {
    now,
    recentWindowMs,
    habituationRate: policy.habituationRate,
    noveltyRecoveryMs: policy.noveltyRecoveryMs
  });
  const previousFocus = previousState?.innerOuterFocus ?? 0;
  const workspace = measureWorkspaceDemand(workspaceState, previousFocus);
  const unorientatedExternalDemand = policy.intensityWeight * external.intensity
    + policy.noveltyWeight * external.novelty;
  const unorientatedInternalDemand = policy.internalStateGain * workspace.internalDemand;
  const focusDynamics = updateInnerOuterFocus({
    previousFocus: workspace.innerOuterFocus,
    externalDemand: unorientatedExternalDemand,
    internalDemand: unorientatedInternalDemand,
    adaptationRate: policy.focusAdaptationRate
  });
  const externalScore = unorientatedExternalDemand
    + policy.orientationGain * workspace.externalOrientation;
  const internalScore = policy.tonicInternalDemand
    + policy.internalStateGain * workspace.internalDemand
    + policy.orientationGain * workspace.internalOrientation;
  const competitiveShare = externalScore + internalScore > 0
    ? externalScore / (externalScore + internalScore)
    : 0;
  const sensoryShare = embeddedLines.length ? Math.max(minimum, Math.min(maximum, competitiveShare)) : 0;
  let sensoryBudget = budget * sensoryShare;
  if (absoluteSensoryCap !== undefined) sensoryBudget = Math.min(sensoryBudget, nonnegative(absoluteSensoryCap, "absoluteSensoryCap"));

  return {
    sensoryBudget,
    reservedLocalBudget: budget - sensoryBudget,
    sensoryShare: budget ? sensoryBudget / budget : 0,
    scores: { external: externalScore, internal: internalScore },
    external: { intensity: external.intensity, novelty: external.novelty, byConnection: external.byConnection },
    workspace,
    focusDynamics,
    nextState: { ...external.nextState, schemaVersion: "0.2.0", innerOuterFocus: focusDynamics.nextFocus },
    policy
  };
}
