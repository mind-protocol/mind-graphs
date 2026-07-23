const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
const clone = value => structuredClone(value);
const unique = values => [...new Set((values || []).filter(Boolean))];

export const DEFAULT_GLOBAL_WORKSPACE_POLICY = Object.freeze({
  maxSupportingSlots: 3,
  minimumLeadShare: 0.4,
  weights: Object.freeze({
    heat: 1,
    goalSalience: 0.9,
    affect: 0.7,
    unresolvedness: 0.65,
    novelty: 0.45,
    continuity: 0.35
  }),
  penalties: Object.freeze({
    residence: 0.12,
    monopolization: 0.35,
    repetitionWithoutOutcome: 0.25
  })
});

const finiteNonnegative = (value, name) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${name} must be a finite non-negative number.`);
  return number;
};

function normalizeCandidate(candidate) {
  if (!candidate?.id) throw new Error("A workspace candidate requires an id.");
  return {
    ...clone(candidate),
    controllerId: candidate.controllerId || candidate.subentityId || null,
    nodeIds: unique(candidate.nodeIds),
    goalIds: unique(candidate.goalIds),
    heat: clamp01(candidate.heat),
    goalSalience: clamp01(candidate.goalSalience),
    affect: clamp01(candidate.affect),
    unresolvedness: clamp01(candidate.unresolvedness),
    novelty: clamp01(candidate.novelty),
    continuity: clamp01(candidate.continuity),
    residenceTicks: Math.max(0, Number(candidate.residenceTicks) || 0),
    monopolization: clamp01(candidate.monopolization),
    repetitionWithoutOutcome: clamp01(candidate.repetitionWithoutOutcome)
  };
}

export function scoreWorkspaceCandidate(candidate, policy = {}) {
  const normalized = normalizeCandidate(candidate);
  const config = {
    ...DEFAULT_GLOBAL_WORKSPACE_POLICY,
    ...policy,
    weights: { ...DEFAULT_GLOBAL_WORKSPACE_POLICY.weights, ...(policy.weights || {}) },
    penalties: { ...DEFAULT_GLOBAL_WORKSPACE_POLICY.penalties, ...(policy.penalties || {}) }
  };
  const positiveWeight = Object.values(config.weights).reduce((sum, weight) => sum + finiteNonnegative(weight, "workspace weight"), 0);
  const positive = positiveWeight
    ? Object.entries(config.weights).reduce((sum, [key, weight]) => sum + normalized[key] * weight, 0) / positiveWeight
    : 0;
  const penalty = config.penalties.residence * normalized.residenceTicks
    + config.penalties.monopolization * normalized.monopolization
    + config.penalties.repetitionWithoutOutcome * normalized.repetitionWithoutOutcome;
  return {
    candidate: normalized,
    positiveScore: clamp01(positive),
    penalty,
    score: Math.max(0, positive - penalty)
  };
}

function allocateCharacters(scored, characterBudget, minimumLeadShare) {
  if (!scored.length) return [];
  const totalScore = scored.reduce((sum, item) => sum + item.score, 0);
  const raw = scored.map((item, index) => {
    const share = totalScore > 0 ? item.score / totalScore : (index === 0 ? 1 : 0);
    return {
      ...item,
      share: index === 0 ? Math.max(minimumLeadShare, share) : share
    };
  });
  const shareTotal = raw.reduce((sum, item) => sum + item.share, 0);
  let remaining = characterBudget;
  return raw.map((item, index) => {
    const allocation = index === raw.length - 1
      ? remaining
      : Math.min(remaining, Math.floor(characterBudget * item.share / shareTotal));
    remaining -= allocation;
    return { ...item, characterAllocation: allocation };
  });
}

export function selectGlobalWorkspace({
  tickId,
  recordedAt = null,
  candidates = [],
  characterBudget,
  previousSnapshot = null,
  policy = {}
}) {
  if (!tickId) throw new Error("Global workspace selection requires a stable tickId.");
  const budget = Math.floor(finiteNonnegative(characterBudget, "characterBudget"));
  if (budget < 1) throw new Error("characterBudget must be at least 1.");
  const config = {
    ...DEFAULT_GLOBAL_WORKSPACE_POLICY,
    ...policy,
    weights: { ...DEFAULT_GLOBAL_WORKSPACE_POLICY.weights, ...(policy.weights || {}) },
    penalties: { ...DEFAULT_GLOBAL_WORKSPACE_POLICY.penalties, ...(policy.penalties || {}) }
  };
  const ranked = candidates
    .map(candidate => scoreWorkspaceCandidate(candidate, config))
    .sort((left, right) => right.score - left.score || left.candidate.id.localeCompare(right.candidate.id));
  const selected = ranked.slice(0, 1 + Math.max(0, Number(config.maxSupportingSlots) || 0));
  const allocated = allocateCharacters(selected, budget, clamp01(config.minimumLeadShare));
  const lead = allocated[0] || null;
  const slots = allocated.map((item, index) => ({
    rank: index + 1,
    role: index === 0 ? "lead" : "support",
    candidateId: item.candidate.id,
    controllerId: item.candidate.controllerId,
    nodeIds: item.candidate.nodeIds,
    goalIds: item.candidate.goalIds,
    score: item.score,
    positiveScore: item.positiveScore,
    penalty: item.penalty,
    characterAllocation: item.characterAllocation,
    summary: item.candidate.summary || null,
    epistemicStatus: item.candidate.epistemicStatus || "inferred"
  }));
  const controllerAlternatives = allocated
    .filter(item => item.candidate.controllerId)
    .map((item, index) => ({
      subentityId: item.candidate.controllerId,
      confidence: clamp01(item.score),
      active: true,
      rank: index + 1
    }));
  const controller = lead?.candidate.controllerId || null;
  return {
    id: `workspace-snapshot-${String(tickId).replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}`,
    nodeType: "Moment",
    semanticType: "WorkspaceSnapshot",
    tickId,
    occurredAt: recordedAt,
    version: Number(previousSnapshot?.version || 0) + 1,
    previousSnapshotId: previousSnapshot?.id || null,
    characterBudget: budget,
    characterUsed: slots.reduce((sum, slot) => sum + slot.characterAllocation, 0),
    controllerId: controller,
    controllerStatus: controller ? "attributed_live" : "unknown",
    controllers: controllerAlternatives,
    activeEntity: controller ? {
      id: controller,
      semanticType: "subentity",
      focusIntensity: clamp01(lead.score),
      confidence: clamp01(lead.score)
    } : null,
    slots,
    bids: ranked.map((item, index) => ({
      candidateId: item.candidate.id,
      controllerId: item.candidate.controllerId,
      rank: index + 1,
      score: item.score,
      positiveScore: item.positiveScore,
      penalty: item.penalty
    })),
    audit: {
      empty: slots.length === 0,
      monopolizationRisk: Boolean(lead && lead.candidate.monopolization >= 0.75),
      repetitionRisk: Boolean(lead && lead.candidate.repetitionWithoutOutcome >= 0.75),
      controllerUnknown: !controller
    }
  };
}

export function workspaceCandidateFromSubentity(entity, context = {}) {
  return {
    id: `workspace-candidate-${entity.id}`,
    controllerId: entity.id,
    nodeIds: unique([entity.id, ...(context.nodeIds || [])]),
    goalIds: unique([...(entity.goals || []).map(goal => typeof goal === "string" ? goal : goal.key), ...(context.goalIds || [])]),
    summary: entity.name || entity.id,
    heat: context.heat ?? entity.lastActivation ?? 0,
    goalSalience: context.goalSalience ?? (entity.goals?.length ? 0.7 : 0),
    affect: context.affect ?? entity.affectIntensity ?? 0,
    unresolvedness: context.unresolvedness ?? 0,
    novelty: context.novelty ?? 0,
    continuity: context.continuity ?? (entity.status === "active" ? 0.6 : 0.2),
    residenceTicks: context.residenceTicks ?? entity.workspaceResidenceTicks ?? 0,
    monopolization: context.monopolization ?? entity.workspaceCaptureShare ?? 0,
    repetitionWithoutOutcome: context.repetitionWithoutOutcome ?? entity.repetitionWithoutOutcome ?? 0,
    epistemicStatus: entity.level === "high" ? "inferred" : "provisional"
  };
}
