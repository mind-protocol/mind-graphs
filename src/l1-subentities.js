// Cycle de vie runtime des sous-entites L1.
// equilibriumTarget est un attracteur : il augmente progressivement le cout de
// promotion, mais n'interdit jamais une sous-entite distincte et bien etayee.
export const DEFAULT_SUBENTITY_POLICY = Object.freeze({
  equilibriumTarget: 10,
  capacitySoftness: 2.5,
  lowSimilarityThreshold: 0.72,
  highSimilarityThreshold: 0.94,
  highSimilarityFloorUnderPressure: 0.89,
  contradictionThreshold: 0.65,
  certaintyDominance: 0.25,
  basePromotionThreshold: 0.58,
  capacityPromotionCost: 0.24
});

const clamp01 = value => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));
const copy = value => structuredClone(value);
const itemKey = item => String(typeof item === "string" ? item : item?.key ?? item?.id ?? item?.name ?? "").trim().toLowerCase();
const itemScore = item => clamp01(typeof item === "object" ? item.score ?? item.confidence ?? 0.5 : 0.5);
const evidenceIds = entity => [...new Set(entity.evidenceMomentIds || [])];

function vectorOf(signature = {}) {
  if (Array.isArray(signature)) return Object.fromEntries(signature.map((value, index) => [String(index), Number(value) || 0]));
  return Object.fromEntries(Object.entries(signature || {}).map(([key, value]) => [key, Number(value) || 0]));
}

export function cosineSimilarity(left, right) {
  const a = vectorOf(left);
  const b = vectorOf(right);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const key of keys) {
    dot += (a[key] || 0) * (b[key] || 0);
    normA += (a[key] || 0) ** 2;
    normB += (b[key] || 0) ** 2;
  }
  return normA && normB ? clamp01((dot / Math.sqrt(normA * normB) + 1) / 2) : 0;
}

function jaccard(left = [], right = []) {
  const a = new Set(left.map(itemKey).filter(Boolean));
  const b = new Set(right.map(itemKey).filter(Boolean));
  const union = new Set([...a, ...b]);
  if (!union.size) return 0;
  return [...a].filter(key => b.has(key)).length / union.size;
}

export function subentitySimilarity(left, right) {
  return clamp01(0.65 * cosineSimilarity(left.signature, right.signature)
    + 0.15 * jaccard(left.goals, right.goals)
    + 0.1 * jaccard(left.strategies, right.strategies)
    + 0.1 * jaccard(left.preferences, right.preferences));
}

export function beliefContradiction(left, right) {
  const otherBeliefs = new Map((right.beliefs || []).map(belief => [itemKey(belief), belief]));
  let conflict = 0;
  let compared = 0;
  for (const belief of left.beliefs || []) {
    const other = otherBeliefs.get(itemKey(belief));
    if (!other) continue;
    const a = Math.max(-1, Math.min(1, Number(belief.stance) || 0));
    const b = Math.max(-1, Math.min(1, Number(other.stance) || 0));
    const weight = Math.sqrt(itemScore(belief) * itemScore(other));
    compared += weight;
    if (a * b < 0) conflict += Math.min(Math.abs(a), Math.abs(b)) * weight;
  }
  return compared ? clamp01(conflict / compared) : 0;
}

// Pression continue : aucune branche ne fait "count >= target => refus".
export function capacityPressure(highLevelCount, policy = DEFAULT_SUBENTITY_POLICY) {
  const x = (Number(highLevelCount) - policy.equilibriumTarget) / policy.capacitySoftness;
  return clamp01(1 / (1 + Math.exp(-x)));
}

function structuralStrength(entity) {
  const weight = 1 - Math.exp(-Math.max(0, Number(entity.weight) || 0) / 4);
  return clamp01(0.45 * weight + 0.35 * clamp01(entity.stability) + 0.2 * clamp01(entity.certainty));
}

export function decideSubentityMerge(left, right, options = {}) {
  const policy = { ...DEFAULT_SUBENTITY_POLICY, ...(options.policy || {}) };
  const similarity = subentitySimilarity(left, right);
  const contradiction = beliefContradiction(left, right);
  const bothHigh = left.level === "high" && right.level === "high";
  const bothLow = left.level !== "high" && right.level !== "high";
  const protection = Math.max(structuralStrength(left), structuralStrength(right));
  const pressure = capacityPressure(options.highLevelCount ?? 0, policy);
  const highThreshold = Math.max(policy.highSimilarityFloorUnderPressure, policy.highSimilarityThreshold + 0.035 * protection - 0.05 * pressure);
  const threshold = bothHigh ? highThreshold : policy.lowSimilarityThreshold;
  const certaintyGap = Math.abs(clamp01(left.certainty) - clamp01(right.certainty));
  const dominant = clamp01(left.certainty) >= clamp01(right.certainty) ? left : right;
  if (similarity >= threshold) return { action: "merge", reason: bothHigh ? "near_duplicate_high_level" : "similar_low_level", survivorId: dominant.id, similarity, contradiction, threshold };
  if (bothLow && contradiction >= policy.contradictionThreshold && certaintyGap >= policy.certaintyDominance) return { action: "merge", reason: "certainty_dominates_low_level_conflict", survivorId: dominant.id, similarity, contradiction, threshold: policy.contradictionThreshold };
  if (!bothHigh && !bothLow && contradiction >= policy.contradictionThreshold && certaintyGap >= policy.certaintyDominance && dominant.level === "high") return { action: "merge", reason: "high_level_model_absorbs_uncertain_belief", survivorId: dominant.id, similarity, contradiction, threshold: policy.contradictionThreshold };
  return { action: "keep_distinct", reason: bothHigh && contradiction > 0 ? "protected_high_level_conflict" : "insufficient_evidence", similarity, contradiction, threshold };
}

function mergeItems(left = [], right = []) {
  const result = new Map();
  for (const item of [...left, ...right]) {
    const key = itemKey(item);
    if (!key) continue;
    const current = result.get(key);
    if (!current || itemScore(item) > itemScore(current)) result.set(key, copy(item));
  }
  return [...result.values()];
}

export function mergeSubentities(left, right, decision = decideSubentityMerge(left, right)) {
  if (decision.action !== "merge") return { entities: [copy(left), copy(right)], event: null };
  const survivor = decision.survivorId === right.id ? right : left;
  const absorbed = survivor === left ? right : left;
  const a = Math.max(0.01, structuralStrength(survivor));
  const b = Math.max(0.01, structuralStrength(absorbed));
  const merged = {
    ...copy(survivor),
    weight: Math.max(0, Number(survivor.weight) || 0) + Math.max(0, Number(absorbed.weight) || 0),
    stability: clamp01((clamp01(survivor.stability) * a + clamp01(absorbed.stability) * b) / (a + b)),
    certainty: Math.max(clamp01(survivor.certainty), clamp01(absorbed.certainty)),
    goals: mergeItems(survivor.goals, absorbed.goals),
    strategies: mergeItems(survivor.strategies, absorbed.strategies),
    preferences: mergeItems(survivor.preferences, absorbed.preferences),
    beliefs: mergeItems(survivor.beliefs, absorbed.beliefs),
    evidenceMomentIds: [...new Set([...evidenceIds(survivor), ...evidenceIds(absorbed)])],
    observationIds: [...new Set([...(survivor.observationIds || []), ...(absorbed.observationIds || [])])],
    aliases: [...new Set([...(survivor.aliases || []), absorbed.name, ...(absorbed.aliases || [])].filter(Boolean))],
    mergedFrom: [...new Set([...(survivor.mergedFrom || []), absorbed.id, ...(absorbed.mergedFrom || [])])],
    conflicts: [...(survivor.conflicts || []), ...(absorbed.conflicts || []), ...(decision.contradiction > 0 ? [{ with: absorbed.id, score: decision.contradiction, resolution: decision.reason, preservedEvidenceMomentIds: evidenceIds(absorbed) }] : [])]
  };
  return {
    entities: [merged, { ...copy(absorbed), status: "merged", supersededBy: survivor.id }],
    event: { type: "SUBENTITY_MERGED", survivorId: survivor.id, absorbedId: absorbed.id, reason: decision.reason, similarity: decision.similarity, contradiction: decision.contradiction }
  };
}

export function reconcileSubentities(subentities, options = {}) {
  const active = new Map(subentities.filter(entity => entity.status !== "merged").map(entity => [entity.id, copy(entity)]));
  const retired = subentities.filter(entity => entity.status === "merged").map(copy);
  const events = [];
  let changed = true;
  while (changed) {
    changed = false;
    const current = [...active.values()];
    const highLevelCount = current.filter(entity => entity.level === "high").length;
    for (let i = 0; i < current.length && !changed; i += 1) {
      for (let j = i + 1; j < current.length; j += 1) {
        const decision = decideSubentityMerge(current[i], current[j], { ...options, highLevelCount });
        if (decision.action !== "merge") continue;
        const result = mergeSubentities(current[i], current[j], decision);
        const survivor = result.entities.find(entity => entity.status !== "merged");
        const absorbed = result.entities.find(entity => entity.status === "merged");
        active.delete(current[i].id);
        active.delete(current[j].id);
        active.set(survivor.id, survivor);
        retired.push(absorbed);
        events.push(result.event);
        changed = true;
        break;
      }
    }
  }
  return { entities: [...active.values(), ...retired], active: [...active.values()], retired, events };
}

export function promotionScore(entity) {
  const recurrence = 1 - Math.exp(-evidenceIds(entity).length / 4);
  const weight = 1 - Math.exp(-Math.max(0, Number(entity.weight) || 0) / 4);
  return clamp01(0.3 * weight + 0.25 * clamp01(entity.stability) + 0.2 * clamp01(entity.certainty) + 0.15 * recurrence + 0.1 * clamp01(entity.coherence ?? 0.5));
}

export function promotionThreshold(highLevelCount, policy = DEFAULT_SUBENTITY_POLICY) {
  return clamp01(policy.basePromotionThreshold + policy.capacityPromotionCost * capacityPressure(highLevelCount, policy));
}

const humanize = value => String(value || "orientation emergente").replace(/[-_]+/g, " ").replace(/^./, c => c.toUpperCase());
const strongest = items => [...(items || [])].sort((a, b) => itemScore(b) - itemScore(a))[0];

export function materializeSubentityNarratives(entity) {
  const anchor = strongest(entity.goals) || strongest(entity.strategies) || strongest(entity.preferences);
  const name = entity.preferredName || entity.name || `Partie - ${humanize(itemKey(anchor))}`;
  const baseId = String(entity.id).replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const observations = evidenceIds(entity);
  const personality = {
    id: `narrative-runtime-${baseId}-personality`, nodeType: "Narrative", semanticType: "SubentityPersonalityNarrative", subentityId: entity.id, name,
    description: `Tendance observee sur ${observations.length} moment(s) : ${humanize(itemKey(strongest(entity.strategies)) || "strategie encore indeterminee")}. Stabilite ${clamp01(entity.stability).toFixed(2)}, certitude ${clamp01(entity.certainty).toFixed(2)}.`,
    epistemicStatus: "inferred", evidenceMomentIds: observations
  };
  const preferences = (entity.preferences || []).filter(itemKey).map((preference, index) => ({
    id: `narrative-runtime-${baseId}-preference-${index + 1}`, nodeType: "Narrative", semanticType: "SubentityPreferenceNarrative", subentityId: entity.id,
    name: `Preference observee - ${humanize(itemKey(preference))}`, description: `Preference inferee depuis les traces disponibles, confiance ${itemScore(preference).toFixed(2)}.`,
    epistemicStatus: "inferred", evidenceMomentIds: preference.evidenceMomentIds || observations
  }));
  const narratives = [personality, ...preferences];
  const relations = narratives.flatMap(narrative => [
    { id: `${narrative.id}-describes-${entity.id}`, source: narrative.id, type: "DESCRIBES_SUBENTITY", target: entity.id },
    ...narrative.evidenceMomentIds.map(momentId => ({ id: `${momentId}-supports-${narrative.id}`, source: momentId, type: "SUPPORTS", target: narrative.id }))
  ]);
  return { name, narratives, relations };
}

export function promoteSubentity(entity, highLevelCount, options = {}) {
  const policy = { ...DEFAULT_SUBENTITY_POLICY, ...(options.policy || {}) };
  const score = promotionScore(entity);
  const threshold = promotionThreshold(highLevelCount, policy);
  if (score < threshold) return { promoted: false, entity: copy(entity), score, threshold, narratives: [], relations: [] };
  const materialized = materializeSubentityNarratives(entity);
  return { promoted: true, entity: { ...copy(entity), nodeType: "actor", semanticType: "subentity", subentity: true, actorStatus: "active", level: "high", status: "active", name: materialized.name, narrativeIds: materialized.narratives.map(n => n.id) }, score, threshold, narratives: materialized.narratives, relations: materialized.relations };
}

export function createMemoryMoment({ id, occurredAt, content, workspaceSnapshot = {}, metadata = {} }) {
  if (!id) throw new Error("A memory Moment requires an id.");
  const controllers = [...(workspaceSnapshot.controllers || [])].filter(controller => controller?.subentityId && controller.active !== false).sort((a, b) => clamp01(b.confidence) - clamp01(a.confidence));
  const moment = { id, nodeType: "Moment", semanticType: "AutobiographicalMemory", occurredAt: occurredAt || new Date().toISOString(), content, ...copy(metadata), controllerAttributionStatus: controllers.length ? "captured_at_creation" : "unknown" };
  const relations = controllers.map((controller, rank) => ({
    id: `${controller.subentityId}-controlled-${id}`, source: controller.subentityId, type: "CONTROLLED_WORKSPACE_DURING", target: id,
    confidence: clamp01(controller.confidence), rank: rank + 1, attribution: rank === 0 ? "primary" : "alternative", capturedAt: moment.occurredAt, evidenceSnapshotId: workspaceSnapshot.id || null
  }));
  if (metadata.authorNodeId) relations.push({
    id: `${id}-authored-by-${metadata.authorNodeId}`,
    source: id,
    type: "AUTHORED_BY",
    target: metadata.authorNodeId,
    capturedAt: moment.occurredAt
  });
  if (metadata.previousMomentId) relations.push({
    id: `${id}-follows-${metadata.previousMomentId}`,
    source: id,
    type: "FOLLOWS_IN_CONVERSATION",
    target: metadata.previousMomentId,
    conversationId: metadata.conversationId || null,
    position: metadata.conversationPosition ?? null
  });
  return { moment, relations };
}
