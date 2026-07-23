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
const safeId = value => String(value || "tick").replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();

function perceptualSubgraph({ key, tickId, recordedAt, actorId, candidate, targets, sensory, workspace, dominantAffect }) {
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 16);
  const spaceId = `stimulus-space-${hash}`;
  const momentId = `stimulus-moment-${safeId(tickId)}-${hash}`;
  const entity = activeWorkspaceEntity(workspace);
  const activeNodeIds = [...new Set([
    ...targets.filter(target => target.energy > 0).map(target => target.id),
    ...(workspace.activeNodeIds || []),
    ...(workspace.goalIds || []),
    entity?.id
  ].filter(Boolean))];
  const targetById = new Map(targets.map((target, rank) => [target.id, { ...target, rank: rank + 1 }]));
  const actor = {
    id: actorId,
    nodeType: "actor",
    semanticType: String(entity?.id) === String(actorId) && String(entity?.semanticType || "").toLowerCase() === "subentity" ? "subentity" : "actor",
    subentity: String(entity?.id) === String(actorId) && String(entity?.semanticType || "").toLowerCase() === "subentity",
    runtimeKind: "perceiving_actor"
  };
  const space = {
    id: spaceId,
    nodeType: "space",
    semanticType: "context",
    runtimeKind: "stimulus_space",
    coalitionKey: key,
    actorId,
    activeNodeIds,
    firstObservedAt: recordedAt || null,
    lastObservedAt: recordedAt || null
  };
  const moment = {
    id: momentId,
    nodeType: "moment",
    semanticType: "observation",
    runtimeKind: "stimulus_moment",
    tickId,
    occurredAt: recordedAt || null,
    coalitionKey: key,
    actorId,
    spaceId,
    candidateId: candidate.id,
    activeNodeIds,
    allocatedEnergy: Math.max(0, Number(sensory.allocatedEnergy) || 0),
    dominantAffect: dominantAffect?.key || null
  };
  const relations = [
    { id: `${momentId}-perceived-by-${actorId}`, source: momentId, type: "PERCEIVED_BY", target: actorId, tickId, justification: "Le Moment sensoriel conserve l’Actor auquel le flux perceptif était attribué lors de ce tick." },
    { id: `${momentId}-occurs-in-${spaceId}`, source: momentId, type: "OCCURS_IN", target: spaceId, tickId, justification: "L’occurrence perceptive appartient au Space stable défini par la coalition sensorielle récurrente." },
    { id: `${momentId}-supports-emergence-${candidate.id}`, source: momentId, type: "SUPPORTS_EMERGENCE", target: candidate.id, tickId, justification: "Cette occurrence constitue une trace en faveur du candidat persistant sans suffire seule à le promouvoir." },
    { id: `${candidate.id}-occupies-${spaceId}`, source: candidate.id, type: "OCCUPIES", target: spaceId, tickId, justification: "Le candidat de sous-entité est maintenu dans le champ perceptif dont les occurrences renforcent sa signature." },
    ...activeNodeIds.map((nodeId, index) => {
      const sensoryTarget = targetById.get(nodeId);
      return {
        id: `${momentId}-activates-${safeId(nodeId)}`,
        source: momentId,
        type: "ACTIVATES",
        target: nodeId,
        tickId,
        energy: sensoryTarget?.energy || 0,
        share: sensoryTarget?.share || 0,
        rank: sensoryTarget?.rank || index + 1,
        sourceKind: sensoryTarget ? "sensory_transfer" : "workspace_activation",
        justification: sensoryTarget
          ? "Le transfert sensoriel attribué à cette cible était positif pendant le tick."
          : "La node appartenait explicitement à l’ensemble actif du workspace pendant le tick."
      };
    })
  ];
  return { actor, space, moment, activeNodeIds, relations };
}

export function deriveSubentityCandidates({ state = {}, sensory = {}, affect = {}, workspace = {}, memory = null, observationId = null, evidenceMomentIds = [], tickId, recordedAt, policy = {} }) {
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
  if (activation === 0 || (!targets.length && !dominantAffect && !entity)) return { candidates: [], workspaceSnapshot: { id: workspace.id || null, controllers: [] }, observation: null, perception: null };

  const existing = state.subentities || [];
  const existingIds = new Set(existing.filter(item => item.status !== "merged").map(item => item.id));
  const explicitControllerId = controllerId(workspace, existingIds);
  const key = stableCoalitionKey({ targets, affect: dominantAffect, workspace });
  if (!key) return { candidates: [], workspaceSnapshot: { id: workspace.id || null, controllers: [] }, observation: null, perception: null };
  const actorId = sensory.citizenId
    || (sensory.transfers || []).find(transfer => transfer.sourceCitizenId)?.sourceCitizenId
    || workspace.actorId
    || entity?.actorId
    || entity?.id;
  if (!actorId) throw new Error("A perceptual coalition requires an attributed Actor.");
  if (!tickId) throw new Error("A perceptual coalition requires a stable tickId.");
  const id = explicitControllerId || candidateIdFor(key);
  const previous = existing.find(item => item.id === id || item.coalitionKey === key);
  const normalizedObservationId = String(observationId || sensory.observationId || memory?.id || "").trim() || null;
  const previousObservationIds = new Set(previous?.observationIds || []);
  // Deux notions distinctes, qu'un seul booléen confondait.
  //
  // `novelObservation` — le motif s'est-il formé une fois de plus ? Un tic sans
  // identifiant ne peut pas être dédupliqué : il compte comme une occurrence à
  // part entière. C'est la récurrence, et elle nourrit légitimement l'attention.
  //
  // `evidenceBacked` — cette occurrence apporte-t-elle une preuve identifiée et
  // jamais vue ? Elle seule a le droit de faire monter poids, stabilité et
  // certitude. Sans cette séparation, une coalition devenait « certaine » à
  // force d'être regardée : cinq tics dont trois sans la moindre preuve
  // faisaient passer weight de 2,2 à 3,26 et certainty de 0,73 à 0,81. La
  // répétition stérile fabriquait de la conviction — exactement ce que
  // « l'absence de mesure reste inconnue » interdit.
  const novelObservation = normalizedObservationId
    ? !previousObservationIds.has(normalizedObservationId)
    : true;
  const evidenceBacked = Boolean(normalizedObservationId) && novelObservation;
  const observationIds = normalizedObservationId && novelObservation
    ? [...previousObservationIds, normalizedObservationId]
    : [...previousObservationIds];
  const observationCount = (previous?.observationCount || 0) + (novelObservation ? 1 : 0);
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
  const observedMomentIds = evidenceBacked ? [...evidenceMomentIds, ...(memory?.id ? [memory.id] : [])] : [];
  const accumulatedEvidenceMomentIds = [...new Set([...(previous?.evidenceMomentIds || []), ...observedMomentIds])];
  const candidate = {
    ...(previous || {}),
    id,
    nodeType: "actor",
    semanticType: "subentity",
    subentity: true,
    actorStatus: previous?.level === "high" ? "active" : "candidate",
    level: previous?.level || "low",
    status: previous?.status === "active" ? "active" : "candidate",
    coalitionKey: key,
    signature,
    weight: Math.max(0, Number(previous?.weight) || 0) + (evidenceBacked ? activation : 0),
    stability: evidenceBacked
      ? clamp01((previous?.stability || 0) * (1 - tuning.stabilityLearningRate) + recurrence * tuning.stabilityLearningRate)
      : clamp01(previous?.stability),
    certainty: evidenceBacked
      ? Math.max(clamp01(previous?.certainty), clamp01(0.45 * recurrence + 0.35 * coherence + 0.2 * attributionConfidence))
      : clamp01(previous?.certainty),
    coherence,
    goals: (workspace.goalIds || []).map(goalId => ({ key: goalId, score: 1 })),
    strategies: workspace.cortexState ? [{ key: workspace.cortexState, score: clamp01(0.5 + 0.5 * activation) }] : (previous?.strategies || []),
    preferences: previous?.preferences || [],
    beliefs: previous?.beliefs || [],
    evidenceMomentIds: accumulatedEvidenceMomentIds,
    observationIds,
    mergedFrom: previous?.mergedFrom || [],
    aliases: previous?.aliases || [],
    observationCount,
    lastObservedAt: novelObservation ? (recordedAt || null) : (previous?.lastObservedAt || null),
    lastActivation: activation,
    dominantAffect: dominantAffect?.key || null
  };
  const controllers = explicitControllerId ? [{ subentityId: explicitControllerId, confidence: attributionConfidence, active: true }] : [];
  const perception = novelObservation
    ? perceptualSubgraph({ key, tickId, recordedAt, actorId, candidate, targets, sensory, workspace, dominantAffect })
    : null;
  return {
    candidates: [candidate],
    workspaceSnapshot: { id: workspace.id || null, controllers },
    observation: {
      coalitionKey: key,
      candidateId: id,
      observationId: normalizedObservationId,
      novelObservation,
      activation,
      recurrence,
      coherence,
      explicitController: Boolean(explicitControllerId),
      actorId,
      spaceId: perception?.space.id || null,
      momentId: perception?.moment.id || null,
      targets,
      dominantAffect
    },
    perception
  };
}
