import { cosineSimilarity } from "./l1-subentities.js";

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
const clone = value => structuredClone(value);
const unique = values => [...new Set((values || []).filter(Boolean))];
const safeId = value => String(value).replace(/[^a-z0-9-]+/gi, "-").toLowerCase();

export const MEMORY_ATTRIBUTION_RELATIONS = Object.freeze([
  "ENCODED_UNDER",
  "GENERATED_BY",
  "INVOLVES",
  "RESONATES_WITH",
  "RECALLS",
  "REINTERPRETS"
]);

function normalizedEvidence(evidenceIds, momentId, attributionId) {
  return unique(evidenceIds).filter(id =>
    id !== momentId
    && id !== attributionId
    && !String(id).startsWith(`${attributionId}-`)
  );
}

function relation(attribution, type, target, properties = {}) {
  return {
    id: `${attribution.id}-${type.toLowerCase()}-${safeId(target)}`,
    source: attribution.momentId,
    type,
    target,
    attributionId: attribution.id,
    attributionVersion: attribution.version,
    epistemicStatus: properties.epistemicStatus || "inferred",
    ...properties
  };
}

export function attributeMemoryMoment({
  moment,
  workspaceSnapshot = {},
  subentities = [],
  functionalSources = [],
  involvedSubentityIds = [],
  semanticProfile = {},
  affectProfile = {},
  recalls = [],
  reinterprets = [],
  mode,
  previousAttributions = [],
  recordedAt = null,
  resonanceThreshold = 0.68
}) {
  if (!moment?.id) throw new Error("Memory attribution requires a Moment id.");
  const existing = previousAttributions.filter(item => item.momentId === moment.id);
  const version = existing.reduce((max, item) => Math.max(max, Number(item.version) || 0), 0) + 1;
  const id = `memory-attribution-${safeId(moment.id)}-v${version}`;
  const controllers = (workspaceSnapshot.controllers || [])
    .filter(item => item?.subentityId && item.active !== false)
    .sort((a, b) => clamp01(b.confidence) - clamp01(a.confidence));
  const controllerId = workspaceSnapshot.controllerId || controllers[0]?.subentityId || null;
  const contributors = unique([
    ...involvedSubentityIds,
    ...(workspaceSnapshot.slots || []).slice(1).map(slot => slot.controllerId)
  ]).filter(id => id !== controllerId);
  const inferredMode = mode || (functionalSources.length > 1
    ? "collective"
    : controllerId && controllers.length > 1
      ? "ambiguous"
      : controllerId
        ? "live"
        : "unknown");
  if (!new Set(["live", "retrospective", "ambiguous", "collective", "unknown"]).has(inferredMode)) {
    throw new Error(`Unsupported memory attribution mode: ${inferredMode}`);
  }
  const attribution = {
    id,
    nodeType: "Moment",
    semanticType: "MemoryAttribution",
    momentId: moment.id,
    version,
    status: "active",
    mode: inferredMode,
    recordedAt: recordedAt || moment.occurredAt || null,
    workspaceSnapshotId: workspaceSnapshot.id || null,
    controllerId,
    contributorIds: contributors,
    correctedByHuman: false,
    warnings: []
  };
  const relations = [];
  if (controllerId) {
    relations.push(relation(attribution, "ENCODED_UNDER", controllerId, {
      confidence: clamp01(controllers.find(item => item.subentityId === controllerId)?.confidence ?? workspaceSnapshot.activeEntity?.confidence ?? 0.5),
      epistemicStatus: "observed",
      evidenceSnapshotId: workspaceSnapshot.id || null
    }));
  }
  for (const source of functionalSources) {
    if (!source?.subentityId) continue;
    const evidenceIds = normalizedEvidence(source.evidenceIds, moment.id, attribution.id);
    if (!evidenceIds.length) {
      attribution.warnings.push(`GENERATED_BY skipped for ${source.subentityId}: no independent evidence.`);
      continue;
    }
    relations.push(relation(attribution, "GENERATED_BY", source.subentityId, {
      confidence: clamp01(source.confidence),
      evidenceIds,
      epistemicStatus: source.confirmedByHuman ? "confirmed" : "inferred"
    }));
  }
  for (const subentityId of contributors) {
    relations.push(relation(attribution, "INVOLVES", subentityId, {
      confidence: clamp01((workspaceSnapshot.controllers || []).find(item => item.subentityId === subentityId)?.confidence ?? 0.5)
    }));
  }
  const momentSignature = { ...semanticProfile, ...Object.fromEntries(Object.entries(affectProfile).map(([key, value]) => [`affect:${key}`, value])) };
  for (const entity of subentities.filter(item => item.status !== "merged")) {
    const similarity = cosineSimilarity(momentSignature, entity.signature || {});
    if (similarity < resonanceThreshold) continue;
    relations.push(relation(attribution, "RESONATES_WITH", entity.id, {
      confidence: similarity,
      causal: false,
      maySupportIdentity: false,
      epistemicStatus: "inferred"
    }));
  }
  for (const priorMomentId of unique(recalls)) {
    if (priorMomentId !== moment.id) relations.push(relation(attribution, "RECALLS", priorMomentId, { epistemicStatus: "reported" }));
  }
  for (const priorMomentId of unique(reinterprets)) {
    if (priorMomentId !== moment.id) relations.push(relation(attribution, "REINTERPRETS", priorMomentId, { epistemicStatus: "reported" }));
  }
  if (!relations.some(item => ["ENCODED_UNDER", "GENERATED_BY", "INVOLVES"].includes(item.type))) {
    attribution.mode = "unknown";
    attribution.controllerId = null;
  }
  return { attribution, relations };
}

export function correctMemoryAttribution(previous, {
  correctedBy,
  controllerId = null,
  involvedSubentityIds = [],
  note = "",
  recordedAt = null
}) {
  if (!previous?.id || !previous?.momentId) throw new Error("A correction requires a previous attribution.");
  if (!correctedBy) throw new Error("A correction requires the correcting Actor id.");
  const attribution = {
    ...clone(previous),
    id: `memory-attribution-${safeId(previous.momentId)}-v${Number(previous.version || 0) + 1}`,
    version: Number(previous.version || 0) + 1,
    status: "active",
    mode: controllerId ? "retrospective" : "unknown",
    controllerId,
    contributorIds: unique(involvedSubentityIds).filter(id => id !== controllerId),
    correctedByHuman: true,
    correctedBy,
    correctionNote: note,
    recordedAt
  };
  const superseded = { ...clone(previous), status: "superseded", supersededBy: attribution.id };
  const relations = [
    ...(controllerId ? [relation(attribution, "ENCODED_UNDER", controllerId, { confidence: 1, epistemicStatus: "confirmed" })] : []),
    ...attribution.contributorIds.map(id => relation(attribution, "INVOLVES", id, { confidence: 1, epistemicStatus: "confirmed" }))
  ];
  return { attribution, superseded, relations };
}
