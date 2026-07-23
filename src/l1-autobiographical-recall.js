import { createHash } from "node:crypto";

const POSITIVE_FACTORS = Object.freeze([
  "semanticRelevance",
  "personRelevance",
  "goalRelevance",
  "affectiveResonance",
  "subentityResonance",
  "unresolvedness",
  "structuralSalience",
  "temporalOpportunity",
  "curiosityPotential",
  "novelty"
]);

const PENALTY_FACTORS = Object.freeze([
  "repetitionPenalty",
  "ruminationPenalty",
  "sensitivityCost",
  "workspaceLoadCost"
]);

export const DEFAULT_RECALL_POLICY = Object.freeze({
  admissionThreshold: 0.62,
  explorationShare: 0.1,
  maxSpontaneousPerDay: 3,
  negativeRecallLimit: 2,
  overloadModes: ["OVERLOADED"],
  sourceVerificationRequired: true,
  communicationThresholds: {
    mentionWhenRelevant: 0.45,
    communicateNow: 0.75
  },
  positiveWeights: Object.freeze({
    semanticRelevance: 1.2,
    personRelevance: 1,
    goalRelevance: 1,
    affectiveResonance: 0.8,
    subentityResonance: 0.7,
    unresolvedness: 0.9,
    structuralSalience: 0.8,
    temporalOpportunity: 0.6,
    curiosityPotential: 0.7,
    novelty: 0.5
  }),
  penaltyWeights: Object.freeze({
    repetitionPenalty: 0.8,
    ruminationPenalty: 1.2,
    sensitivityCost: 1,
    workspaceLoadCost: 1
  })
});

const clamp01 = value => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0;
};

const requiredText = (value, field) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
};

const stableId = (prefix, ...parts) => {
  const digest = createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex").slice(0, 24);
  return `${prefix}-${digest}`;
};

const weightedMean = (values, weights) => {
  const entries = Object.entries(values);
  const weightTotal = entries.reduce((sum, [key]) => sum + Number(weights[key] || 0), 0);
  if (!weightTotal) return 0;
  return entries.reduce((sum, [key, value]) => sum + value * Number(weights[key] || 0), 0) / weightTotal;
};

const normalizeFactors = (names, provided = {}) =>
  Object.fromEntries(names.map(name => [name, clamp01(provided[name])]));

const currentMode = context => String(context.mode || context.cognitiveMode || "").toUpperCase();

function policyWith(overrides = {}) {
  return {
    ...DEFAULT_RECALL_POLICY,
    ...overrides,
    communicationThresholds: {
      ...DEFAULT_RECALL_POLICY.communicationThresholds,
      ...(overrides.communicationThresholds || {})
    },
    positiveWeights: {
      ...DEFAULT_RECALL_POLICY.positiveWeights,
      ...(overrides.positiveWeights || {})
    },
    penaltyWeights: {
      ...DEFAULT_RECALL_POLICY.penaltyWeights,
      ...(overrides.penaltyWeights || {})
    }
  };
}

export function createLatentConversationEpisode({
  episodeId,
  conversationId,
  utteranceIds,
  startTimestamp,
  endTimestamp,
  boundary = {},
  candidateThemes = [],
  candidateEntities = [],
  candidateImportance = null,
  sensitivity = "personal",
  embeddingRef = null,
  provenance = {}
} = {}) {
  requiredText(episodeId, "episodeId");
  requiredText(conversationId, "conversationId");
  if (!Array.isArray(utteranceIds) || !utteranceIds.length) throw new Error("utteranceIds must contain at least one source utterance.");
  utteranceIds.forEach((id, index) => requiredText(id, `utteranceIds[${index}]`));
  requiredText(provenance.sourceArtifactId, "provenance.sourceArtifactId");
  return {
    id: episodeId,
    nodeType: "Moment",
    semanticType: "ConversationEpisode",
    epistemicStatus: "provisional",
    indexingStatus: "indexed",
    assimilationStatus: "latent",
    memoryState: "indexed",
    experiencedByCitizen: false,
    conversationId,
    sourceUtteranceIds: [...new Set(utteranceIds)],
    startTimestamp: startTimestamp || null,
    endTimestamp: endTimestamp || null,
    episodeBoundary: {
      confidence: boundary.confidence === undefined ? null : clamp01(boundary.confidence),
      method: boundary.method || "unspecified"
    },
    candidateThemes: [...new Set(candidateThemes)],
    candidateEntities: [...new Set(candidateEntities)],
    candidateImportance: candidateImportance === null ? null : clamp01(candidateImportance),
    sensitivity,
    embeddingRef,
    provenance: {
      sourceArtifactId: provenance.sourceArtifactId,
      sourceLocator: provenance.sourceLocator || null,
      contentHash: provenance.contentHash || null,
      ingestionMethod: provenance.ingestionMethod || "deterministic_archive_ingestion"
    }
  };
}

export function scoreRecallOpportunity({
  episode,
  factors = {},
  context = {},
  history = {},
  policy = {},
  explorationSample = 0.5
} = {}) {
  if (!episode?.id) throw new Error("episode.id is required.");
  const config = policyWith(policy);
  const positive = normalizeFactors(POSITIVE_FACTORS, factors);
  const penalties = normalizeFactors(PENALTY_FACTORS, factors);
  const relevanceScore = weightedMean(positive, config.positiveWeights);
  const penaltyScore = weightedMean(penalties, config.penaltyWeights);
  const explorationBonus = clamp01(explorationSample) * clamp01(config.explorationShare);
  const finalScore = clamp01(
    relevanceScore * (1 - clamp01(config.explorationShare))
    + explorationBonus
    - penaltyScore
  );

  const gates = [];
  if (config.overloadModes.includes(currentMode(context)) && !context.necessaryRecall) gates.push("workspace_overloaded");
  if (history.cooldownUntil && Date.parse(history.cooldownUntil) > Date.parse(context.observedAt || new Date(0).toISOString())) gates.push("episode_cooldown");
  if (Number(history.spontaneousRecallCountToday || 0) >= config.maxSpontaneousPerDay) gates.push("daily_budget_exhausted");
  if (Number(history.consecutiveNegativeRecalls || 0) >= config.negativeRecallLimit && factors.novelty < 0.5) gates.push("negative_recall_limit");
  if (episode.sensitivity === "sensitive" && context.sensitiveRecallAllowed !== true) gates.push("sensitivity_permission_missing");

  const status = gates.some(gate => ["workspace_overloaded", "sensitivity_permission_missing"].includes(gate))
    ? "suppressed"
    : gates.length
      ? "deferred"
      : finalScore >= config.admissionThreshold
        ? "candidate"
        : "deferred";

  return {
    episodeId: episode.id,
    status,
    finalScore,
    threshold: config.admissionThreshold,
    factors: { ...positive, ...penalties },
    calculation: {
      relevanceScore,
      penaltyScore,
      explorationBonus,
      explorationShare: config.explorationShare
    },
    gates,
    reasons: [
      ...Object.entries(positive).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name]) => name),
      ...gates
    ]
  };
}

export function createRecallOpportunity({ episode, score, createdAt, communicationLikelihood = null } = {}) {
  if (!episode?.id) throw new Error("episode.id is required.");
  if (!score || score.episodeId !== episode.id) throw new Error("score must target episode.id.");
  const observedAt = requiredText(createdAt, "createdAt");
  return {
    id: stableId("recall-opportunity", episode.id, observedAt),
    nodeType: "Narrative",
    semanticType: "RecallOpportunity",
    epistemicStatus: "provisional",
    episodeId: episode.id,
    createdAt: observedAt,
    score: score.finalScore,
    threshold: score.threshold,
    reasons: score.reasons,
    factors: score.factors,
    gates: score.gates,
    sensitivity: episode.sensitivity,
    expectedValue: score.calculation.relevanceScore,
    communicationLikelihood: communicationLikelihood === null ? null : clamp01(communicationLikelihood),
    status: score.status
  };
}

export function admitRecallOpportunity({
  opportunity,
  episode,
  recalledAt,
  workspaceSnapshotId,
  triggerMomentIds = [],
  sourceUtterancesVerified = false,
  attribution = {},
  policy = {}
} = {}) {
  if (!opportunity?.id || opportunity.episodeId !== episode?.id) throw new Error("opportunity and episode must refer to the same episode.");
  const config = policyWith(policy);
  if (opportunity.status !== "candidate") {
    return { admitted: false, reason: `opportunity_${opportunity.status}`, recallMoment: null, relations: [] };
  }
  if (config.sourceVerificationRequired && !sourceUtterancesVerified) {
    return { admitted: false, reason: "source_utterances_not_verified", recallMoment: null, relations: [] };
  }
  const observedAt = requiredText(recalledAt, "recalledAt");
  const snapshotId = requiredText(workspaceSnapshotId, "workspaceSnapshotId");
  const recallMoment = {
    id: stableId("recall-moment", episode.id, observedAt, snapshotId),
    nodeType: "Moment",
    semanticType: "AutobiographicalRecall",
    epistemicStatus: "observed",
    originalEpisodeId: episode.id,
    recalledAt: observedAt,
    workspaceSnapshotId: snapshotId,
    triggerContext: {
      momentIds: [...new Set(triggerMomentIds)],
      opportunityId: opportunity.id,
      reasons: opportunity.reasons
    },
    activeSubentityId: attribution.controller || null,
    controllerConfidence: attribution.confidence === undefined ? null : clamp01(attribution.confidence),
    contributors: [...new Set(attribution.contributors || [])],
    recallScore: opportunity.score,
    sourceUtteranceIds: episode.sourceUtteranceIds,
    sourceUtterancesVerified: true,
    experiencedByCitizen: true,
    memoryState: "recalled"
  };
  const relations = [
    { source: recallMoment.id, target: episode.id, type: "RECALLS" },
    { source: recallMoment.id, target: snapshotId, type: "ENTERED_DURING" },
    ...recallMoment.triggerContext.momentIds.map(target => ({ source: recallMoment.id, target, type: "TRIGGERED_BY" }))
  ];
  if (recallMoment.activeSubentityId) {
    relations.push({ source: recallMoment.id, target: recallMoment.activeSubentityId, type: "INTERPRETED_UNDER", confidence: recallMoment.controllerConfidence });
  }
  recallMoment.contributors.forEach(target => relations.push({ source: recallMoment.id, target, type: "INVOLVES" }));
  return { admitted: true, reason: "admitted", recallMoment, relations };
}

export function decideRecallCommunication({
  importance = 0,
  actionability = 0,
  confirmationNeed = 0,
  misunderstandingRisk = 0,
  sensitivity = 0,
  urgency = 0,
  interruptionCost = 0,
  repetition = 0,
  speculative = 0,
  policy = {}
} = {}) {
  const config = policyWith(policy);
  const positive = [importance, actionability, confirmationNeed, misunderstandingRisk, urgency].map(clamp01);
  const negative = [sensitivity, interruptionCost, repetition, speculative].map(clamp01);
  const score = clamp01(
    positive.reduce((sum, value) => sum + value, 0) / positive.length
    - negative.reduce((sum, value) => sum + value, 0) / negative.length
  );
  const decision = score >= config.communicationThresholds.communicateNow
    ? "communicate_now"
    : score >= config.communicationThresholds.mentionWhenRelevant
      ? "mention_when_relevant"
      : "inner_only";
  return {
    decision,
    score,
    defaultPolicy: "inner_only",
    reasons: {
      importance: clamp01(importance),
      actionability: clamp01(actionability),
      confirmationNeed: clamp01(confirmationNeed),
      misunderstandingRisk: clamp01(misunderstandingRisk),
      sensitivity: clamp01(sensitivity),
      urgency: clamp01(urgency),
      interruptionCost: clamp01(interruptionCost),
      repetition: clamp01(repetition),
      speculative: clamp01(speculative)
    }
  };
}

export function createReinterpretationMoment({
  recallMoment,
  episode,
  interpretation,
  createdAt,
  epistemicStatus = "provisional"
} = {}) {
  if (!recallMoment?.id || recallMoment.originalEpisodeId !== episode?.id) throw new Error("recallMoment must recall episode.");
  const content = requiredText(interpretation, "interpretation");
  const observedAt = requiredText(createdAt, "createdAt");
  const moment = {
    id: stableId("reinterpretation-moment", recallMoment.id, observedAt, content),
    nodeType: "Moment",
    semanticType: "AutobiographicalReinterpretation",
    epistemicStatus,
    content,
    createdAt: observedAt,
    originalEpisodeId: episode.id,
    recallMomentId: recallMoment.id,
    additiveOnly: true
  };
  return {
    moment,
    relations: [
      { source: moment.id, target: episode.id, type: "REINTERPRETS" },
      { source: moment.id, target: recallMoment.id, type: "TRIGGERED_BY" }
    ]
  };
}
