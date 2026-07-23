import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runIntegratedL1Tick } from "./l1-integrated-runtime.js";
import { capacityPressure, DEFAULT_SUBENTITY_POLICY } from "./l1-subentities.js";

export const EMPTY_L1_SHADOW_STATE = Object.freeze({
  schemaVersion: "0.1.0",
  mode: "shadow",
  revision: 0,
  authoritativeRevision: 0,
  processedTickIds: [],
  simulatedState: null,
  proposals: [],
  observations: [],
  metrics: null
});

const clone = value => structuredClone(value);
const unique = values => [...new Set(values || [])];

function normalizeShadowState(state = {}) {
  return {
    ...clone(EMPTY_L1_SHADOW_STATE),
    ...clone(state),
    processedTickIds: unique(state.processedTickIds),
    proposals: clone(state.proposals || []),
    observations: clone(state.observations || [])
  };
}

function proposalId(tickId, type, subject) {
  return `shadow-${tickId}-${type.toLowerCase()}-${String(subject || "none").replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`;
}

function proposalsFromTransition(before, integrated, input) {
  const proposals = [];
  const newEvents = integrated.state.events.slice((before.events || []).length);
  for (const event of newEvents) {
    if (event.type === "SUBENTITY_MERGED") {
      proposals.push({
        id: proposalId(input.tickId, "merge", `${event.survivorId}-${event.absorbedId}`),
        type: "MERGE_SUBENTITIES",
        tickId: input.tickId,
        createdAt: input.recordedAt || null,
        subjectIds: [event.survivorId, event.absorbedId],
        rationale: event.reason,
        evidence: { similarity: event.similarity, contradiction: event.contradiction },
        reviewStatus: "unreviewed"
      });
    }
    if (event.type === "SUBENTITY_PROMOTED") {
      proposals.push({
        id: proposalId(input.tickId, "promote", event.subentityId),
        type: "PROMOTE_SUBENTITY",
        tickId: input.tickId,
        createdAt: input.recordedAt || null,
        subjectIds: [event.subentityId],
        rationale: "Le score de poids, recurrence, stabilite et certitude depasse le cout de promotion courant.",
        evidence: { score: event.score, threshold: event.threshold },
        reviewStatus: "unreviewed"
      });
    }
  }

  const beforeRelations = new Set((before.relations || []).map(relation => relation.id));
  for (const relation of integrated.state.relations.filter(relation => !beforeRelations.has(relation.id) && relation.type === "CONTROLLED_WORKSPACE_DURING")) {
    proposals.push({
      id: proposalId(input.tickId, "controller", `${relation.source}-${relation.target}`),
      type: "ATTRIBUTE_CONTROLLER",
      tickId: input.tickId,
      createdAt: input.recordedAt || null,
      subjectIds: [relation.source, relation.target],
      rationale: "Le controleur etait explicitement present dans le snapshot du workspace lors de la creation du Moment.",
      evidence: { confidence: relation.confidence, attribution: relation.attribution, workspaceSnapshotId: relation.evidenceSnapshotId },
      reviewStatus: "unreviewed"
    });
  }

  const beforeNarratives = new Set((before.narratives || []).map(narrative => narrative.id));
  for (const narrative of integrated.state.narratives.filter(item => !beforeNarratives.has(item.id))) {
    proposals.push({
      id: proposalId(input.tickId, "narrative", narrative.id),
      type: "MATERIALIZE_NARRATIVE",
      tickId: input.tickId,
      createdAt: input.recordedAt || null,
      subjectIds: [narrative.subentityId, narrative.id].filter(Boolean),
      rationale: "Narratif infere depuis une sous-entite promue et ses Moments sources.",
      evidence: { evidenceMomentIds: narrative.evidenceMomentIds || [], epistemicStatus: narrative.epistemicStatus },
      preview: { name: narrative.name, description: narrative.description },
      reviewStatus: "unreviewed"
    });
  }
  return proposals;
}

export function computeShadowMetrics(shadowState, reviews = []) {
  const proposals = shadowState.proposals || [];
  const reviewByProposal = new Map(reviews.map(review => [review.proposalId, review]));
  const reviewed = proposals.filter(proposal => reviewByProposal.has(proposal.id));
  const accepted = reviewed.filter(proposal => reviewByProposal.get(proposal.id).verdict === "accepted");
  const simulated = shadowState.simulatedState || {};
  const active = (simulated.subentities || []).filter(entity => entity.status !== "merged");
  const highLevelCount = active.filter(entity => entity.level === "high").length;
  const ticksWithMemory = (shadowState.observations || []).filter(observation => observation.hasMemory).length;
  const controllerProposals = proposals.filter(proposal => proposal.type === "ATTRIBUTE_CONTROLLER");
  const candidateIds = new Set((shadowState.observations || []).map(observation => observation.candidateId).filter(Boolean));
  const totalTicks = shadowState.processedTickIds?.length || 0;
  const count = type => proposals.filter(proposal => proposal.type === type).length;
  return {
    totalTicks,
    proposals: proposals.length,
    mergesProposed: count("MERGE_SUBENTITIES"),
    promotionsProposed: count("PROMOTE_SUBENTITY"),
    narrativesProposed: count("MATERIALIZE_NARRATIVE"),
    controllerAttributionsProposed: controllerProposals.length,
    controllerCoverage: ticksWithMemory ? controllerProposals.length / ticksWithMemory : 0,
    distinctCandidateCoalitions: candidateIds.size,
    candidateChurnPerTick: totalTicks ? candidateIds.size / totalTicks : 0,
    simulatedActiveCount: active.length,
    simulatedHighLevelCount: highLevelCount,
    simulatedCandidateCount: active.filter(entity => entity.level !== "high").length,
    fragmentationPressure: capacityPressure(highLevelCount, DEFAULT_SUBENTITY_POLICY),
    reviewed: reviewed.length,
    accepted: accepted.length,
    reviewAcceptanceRate: reviewed.length ? accepted.length / reviewed.length : null
  };
}

export function runL1ShadowTick(previousShadowState, authoritativeState, input, options = {}) {
  if (!input?.tickId) throw new Error("A shadow tick requires a stable tickId.");
  const shadow = normalizeShadowState(previousShadowState);
  if (shadow.processedTickIds.includes(input.tickId)) {
    return { state: shadow, report: { tickId: input.tickId, status: "already_processed", changed: false, appliedToAuthoritativeState: false } };
  }
  const simulatedBefore = clone(shadow.simulatedState || authoritativeState);
  const authoritativeBefore = JSON.stringify(authoritativeState);
  const integrated = runIntegratedL1Tick(simulatedBefore, input, options);
  if (JSON.stringify(authoritativeState) !== authoritativeBefore) throw new Error("Shadow invariant violated: authoritative state was mutated.");
  const proposals = proposalsFromTransition(simulatedBefore, integrated, input);
  const observation = {
    tickId: input.tickId,
    recordedAt: input.recordedAt || null,
    candidateId: integrated.detection?.observation?.candidateId || null,
    coalitionKey: integrated.detection?.observation?.coalitionKey || null,
    activation: integrated.detection?.observation?.activation || 0,
    recurrence: integrated.detection?.observation?.recurrence || 0,
    coherence: integrated.detection?.observation?.coherence || 0,
    explicitController: integrated.detection?.observation?.explicitController || false,
    hasMemory: Boolean(input.memory?.id),
    proposalIds: proposals.map(proposal => proposal.id)
  };
  const next = {
    ...shadow,
    revision: Number(shadow.revision || 0) + 1,
    authoritativeRevision: Number(authoritativeState.revision || 0),
    updatedAt: input.recordedAt || new Date().toISOString(),
    processedTickIds: [...shadow.processedTickIds, input.tickId],
    simulatedState: integrated.state,
    proposals: [...shadow.proposals, ...proposals],
    observations: [...shadow.observations, observation]
  };
  next.metrics = computeShadowMetrics(next);
  return {
    state: next,
    report: {
      tickId: input.tickId,
      status: "simulated",
      changed: true,
      appliedToAuthoritativeState: false,
      authoritativeRevision: next.authoritativeRevision,
      shadowRevision: next.revision,
      proposals: proposals.map(proposal => ({ id: proposal.id, type: proposal.type, subjectIds: proposal.subjectIds })),
      metrics: next.metrics
    }
  };
}

export async function readL1ShadowState(filePath) {
  try {
    return normalizeShadowState(JSON.parse(await fs.readFile(filePath, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return clone(EMPTY_L1_SHADOW_STATE);
    throw error;
  }
}

export async function writeL1ShadowStateAtomic(filePath, state) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(normalizeShadowState(state), null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function readShadowReviews(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw.split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function appendShadowReview(filePath, review) {
  if (!review?.proposalId) throw new Error("A shadow review requires proposalId.");
  if (!new Set(["accepted", "rejected", "uncertain"]).has(review.verdict)) throw new Error("Shadow review verdict must be accepted, rejected or uncertain.");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const normalized = { proposalId: review.proposalId, verdict: review.verdict, note: review.note || "", reviewedAt: review.reviewedAt || new Date().toISOString() };
  await fs.appendFile(filePath, `${JSON.stringify(normalized)}\n`, "utf8");
  return normalized;
}

export function shadowView(state, reviews = []) {
  const latestReviews = new Map(reviews.map(review => [review.proposalId, review]));
  const proposals = (state.proposals || []).map(proposal => ({ ...proposal, review: latestReviews.get(proposal.id) || null }));
  return {
    mode: "shadow",
    revision: Number(state.revision || 0),
    authoritativeRevision: Number(state.authoritativeRevision || 0),
    updatedAt: state.updatedAt || null,
    metrics: computeShadowMetrics(state, reviews),
    proposals: proposals.slice(-100).reverse(),
    observations: (state.observations || []).slice(-100).reverse()
  };
}
