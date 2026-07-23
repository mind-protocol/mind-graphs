import { createHash } from "node:crypto";

export const DEFAULT_COALITION_POLICY = Object.freeze({
  sensoryContribution: 0.45,
  affectContribution: 0.35,
  workspaceContribution: 0.2,
  recurrenceScale: 4,
  stabilityLearningRate: 0.2
});

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
const strongestAffect = affect => {
  if (affect?.dominant?.affect) return { key: affect.dominant.affect, intensity: clamp01(affect.dominant.intensity) };
  const entries = Object.entries(affect?.next || affect?.vector || {}).sort((a, b) => Number(b[1]) - Number(a[1]));
  return entries.length && Number(entries[0][1]) > 0 ? { key: entries[0][0], intensity: clamp01(entries[0][1]) } : null;
};

function sensoryFeatures(sensory = {}) {
  const energyByTarget = new Map();
  for (const transfer of sensory.transfers || []) {
    energyByTarget.set(transfer.targetNodeId, (energyByTarget.get(transfer.targetNodeId) || 0) + Math.max(0, Number(transfer.energy) || 0));
  }
  const total = [...energyByTarget.values()].reduce((sum, value) => sum + value, 0);
  return [...energyByTarget].map(([id, energy]) => ({ id, energy, share: total ? energy / total : 0 })).sort((a, b) => b.energy - a.energy || a.id.localeCompare(b.id));
}

function activeWorkspaceEntity(workspace = {}) {
  return workspace.activeEntity || workspace.activeSubentity || workspace.broadcastEntity || null;
}

function controllerId(workspace, existingIds) {
  const entity = activeWorkspaceEntity(workspace);
  const id = entity?.subentityId || entity?.id;
  const declaredSubentity = entity?.subentity === true || String(entity?.semanticType || entity?.nodeType || "").toLowerCase() === "subentity";
  return id && (declaredSubentity || existingIds.has(id)) ? id : null;
}

function stableCoalitionKey({ targets, affect, workspace }) {
  const parts = [
    ...targets.slice(0, 3).map(target => `node:${target.id}`),
    ...(affect ? [`affect:${affect.key}`] : []),
    ...(workspace.goalIds || []).map(id => `goal:${id}`).sort(),
    workspace.cortexState ? `cortex:${workspace.cortexState}` : null
  ].filter(Boolean);
  return parts.sort().join("|");
}

const candidateIdFor = key => `candidate-coalition-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;

export function deriveSubentityCandidates({ state = {}, sensory = {}, affect = {}, workspace = {}, memory = null, recordedAt, policy = {} }) {
  const tuning = { ...DEFAULT_COALITION_POLICY, ...policy };
  const targets = sensoryFeatures(sensory);
  const dominantAffect = strongestAffect(affect);
  const entity = activeWorkspaceEntity(workspace);
  const sensoryStrength = clamp01(
    sensory.allocatedEnergy !== undefined && sensory.totalBudget
      ? sensory.allocatedEnergy / sensory.totalBudget
      : targets.reduce((sum, target) => sum + target.energy, 0) / (1 + targets.reduce((sum, target) => sum + target.energy, 0))
  );
  const affectStrength = dominantAffect?.intensity || 0;
  const workspaceStrength = clamp01(entity?.focusIntensity ?? workspace.focusIntensity ?? 0);
  const activation = clamp01(tuning.sensoryContribution * sensoryStrength + tuning.affectContribution * affectStrength + tuning.workspaceContribution * workspaceStrength);
  if (activation === 0 || (!targets.length && !dominantAffect && !entity)) return { candidates: [], workspaceSnapshot: { id: workspace.id || null, controllers: [] }, observation: null };

  const existing = state.subentities || [];
  const existingIds = new Set(existing.filter(item => item.status !== "merged").map(item => item.id));
  const explicitControllerId = controllerId(workspace, existingIds);
  const key = stableCoalitionKey({ targets, affect: dominantAffect, workspace });
  if (!key) return { candidates: [], workspaceSnapshot: { id: workspace.id || null, controllers: [] }, observation: null };
  const id = explicitControllerId || candidateIdFor(key);
  const previous = existing.find(item => item.id === id || item.coalitionKey === key);
  const observationCount = (previous?.observationCount || 0) + 1;
  const recurrence = 1 - Math.exp(-observationCount / tuning.recurrenceScale);
  const concentration = targets.length ? targets.reduce((sum, target) => sum + target.share ** 2, 0) : 0.5;
  const coherence = clamp01(0.65 * concentration + 0.35 * (dominantAffect ? 1 : 0.5));
  const attributionConfidence = explicitControllerId ? clamp01(entity?.confidence ?? entity?.controlConfidence ?? entity?.focusIntensity ?? 0.5) : 0;
  const signature = Object.fromEntries([
    ...targets.slice(0, 8).map(target => [`node:${target.id}`, target.share]),
    ...(dominantAffect ? [[`affect:${dominantAffect.key}`, dominantAffect.intensity]] : []),
    ...(workspace.goalIds || []).map(goalId => [`goal:${goalId}`, 1]),
    ...(workspace.cortexState ? [[`cortex:${workspace.cortexState}`, 1]] : [])
  ]);
  const evidenceMomentIds = [...new Set([...(previous?.evidenceMomentIds || []), ...(memory?.id ? [memory.id] : [])])];
  const candidate = {
    ...(previous || {}),
    id,
    level: previous?.level || "low",
    status: previous?.status === "active" ? "active" : "candidate",
    coalitionKey: key,
    signature,
    weight: Math.max(0, Number(previous?.weight) || 0) + activation,
    stability: clamp01((previous?.stability || 0) * (1 - tuning.stabilityLearningRate) + recurrence * tuning.stabilityLearningRate),
    certainty: Math.max(clamp01(previous?.certainty), clamp01(0.45 * recurrence + 0.35 * coherence + 0.2 * attributionConfidence)),
    coherence,
    goals: (workspace.goalIds || []).map(goalId => ({ key: goalId, score: 1 })),
    strategies: workspace.cortexState ? [{ key: workspace.cortexState, score: clamp01(0.5 + 0.5 * activation) }] : (previous?.strategies || []),
    preferences: previous?.preferences || [],
    beliefs: previous?.beliefs || [],
    evidenceMomentIds,
    observationCount,
    lastObservedAt: recordedAt || null,
    lastActivation: activation,
    dominantAffect: dominantAffect?.key || null
  };
  const controllers = explicitControllerId ? [{ subentityId: explicitControllerId, confidence: attributionConfidence, active: true }] : [];
  return {
    candidates: [candidate],
    workspaceSnapshot: { id: workspace.id || null, controllers },
    observation: { coalitionKey: key, candidateId: id, activation, recurrence, coherence, explicitController: Boolean(explicitControllerId), targets: targets.slice(0, 8), dominantAffect }
  };
}
