import test from "node:test";
import assert from "node:assert/strict";
import {
  admitRecallOpportunity,
  createLatentConversationEpisode,
  createRecallOpportunity,
  createReinterpretationMoment,
  decideRecallCommunication,
  scoreRecallOpportunity
} from "../src/l1-autobiographical-recall.js";

const episode = createLatentConversationEpisode({
  episodeId: "episode:042:7",
  conversationId: "conversation:042",
  utteranceIds: ["utterance:042:18", "utterance:042:21"],
  startTimestamp: "2025-06-01T10:00:00.000Z",
  endTimestamp: "2025-06-01T10:04:00.000Z",
  boundary: { confidence: 0.76, method: "hybrid_semantic_temporal" },
  candidateThemes: ["departure"],
  candidateEntities: ["actor:person:camille"],
  candidateImportance: 0.58,
  provenance: { sourceArtifactId: "artifact:chatgpt-export", sourceLocator: "conversation:042" }
});

test("automatic indexing creates a latent episode rather than an assimilated memory", () => {
  assert.equal(episode.nodeType, "Moment");
  assert.equal(episode.semanticType, "ConversationEpisode");
  assert.equal(episode.memoryState, "indexed");
  assert.equal(episode.assimilationStatus, "latent");
  assert.equal(episode.experiencedByCitizen, false);
  assert.equal(episode.epistemicStatus, "provisional");
});

test("recall scoring is deterministic and exposes every contribution", () => {
  const input = {
    episode,
    factors: {
      semanticRelevance: 0.9,
      personRelevance: 0.95,
      goalRelevance: 0.8,
      unresolvedness: 0.73,
      curiosityPotential: 0.64,
      novelty: 0.7,
      repetitionPenalty: 0.1,
      workspaceLoadCost: 0.05
    },
    context: { mode: "ENGAGE", observedAt: "2026-07-23T20:00:00.000Z" },
    explorationSample: 0.4
  };
  const first = scoreRecallOpportunity(input);
  const second = scoreRecallOpportunity(input);
  assert.deepEqual(first, second);
  assert.equal(first.status, "candidate");
  assert.ok(first.finalScore >= first.threshold);
  assert.equal(first.factors.semanticRelevance, 0.9);
  assert.equal(first.factors.repetitionPenalty, 0.1);
});

test("overload and sensitivity suppress non-essential spontaneous recall", () => {
  const overloaded = scoreRecallOpportunity({
    episode,
    factors: { semanticRelevance: 1, personRelevance: 1, novelty: 1 },
    context: { mode: "OVERLOADED" }
  });
  assert.equal(overloaded.status, "suppressed");
  assert.ok(overloaded.gates.includes("workspace_overloaded"));

  const sensitive = scoreRecallOpportunity({
    episode: { ...episode, sensitivity: "sensitive" },
    factors: { semanticRelevance: 1, personRelevance: 1, novelty: 1 },
    context: { mode: "ENGAGE" }
  });
  assert.equal(sensitive.status, "suppressed");
  assert.ok(sensitive.gates.includes("sensitivity_permission_missing"));
});

test("a candidate cannot become a Recall Moment until source utterances are verified", () => {
  const score = scoreRecallOpportunity({
    episode,
    factors: { semanticRelevance: 1, personRelevance: 1, goalRelevance: 1, unresolvedness: 1, novelty: 1 }
  });
  const opportunity = createRecallOpportunity({ episode, score, createdAt: "2026-07-23T20:00:00.000Z" });
  const rejected = admitRecallOpportunity({
    opportunity,
    episode,
    recalledAt: "2026-07-23T20:01:00.000Z",
    workspaceSnapshotId: "workspace:50"
  });
  assert.equal(rejected.admitted, false);
  assert.equal(rejected.reason, "source_utterances_not_verified");
});

test("admission creates a new grounded Recall Moment and leaves the episode latent", () => {
  const original = structuredClone(episode);
  const score = scoreRecallOpportunity({
    episode,
    factors: { semanticRelevance: 1, personRelevance: 1, goalRelevance: 1, unresolvedness: 1, novelty: 1 }
  });
  const opportunity = createRecallOpportunity({ episode, score, createdAt: "2026-07-23T20:00:00.000Z" });
  const admitted = admitRecallOpportunity({
    opportunity,
    episode,
    recalledAt: "2026-07-23T20:01:00.000Z",
    workspaceSnapshotId: "workspace:50",
    triggerMomentIds: ["moment:current"],
    sourceUtterancesVerified: true,
    attribution: { controller: "subentity:captain", confidence: 0.84, contributors: ["subentity:senex"] }
  });
  assert.equal(admitted.admitted, true);
  assert.equal(admitted.recallMoment.semanticType, "AutobiographicalRecall");
  assert.equal(admitted.recallMoment.experiencedByCitizen, true);
  assert.deepEqual(episode, original);
  assert.ok(admitted.relations.some(relation => relation.type === "RECALLS" && relation.target === episode.id));
  assert.ok(admitted.relations.some(relation => relation.type === "INTERPRETED_UNDER" && relation.target === "subentity:captain"));
  assert.ok(admitted.relations.some(relation => relation.type === "INVOLVES" && relation.target === "subentity:senex"));
});

test("reinterpretation is additive and never overwrites the historical episode", () => {
  const score = scoreRecallOpportunity({
    episode,
    factors: { semanticRelevance: 1, personRelevance: 1, goalRelevance: 1, unresolvedness: 1, novelty: 1 }
  });
  const opportunity = createRecallOpportunity({ episode, score, createdAt: "2026-07-23T20:00:00.000Z" });
  const { recallMoment } = admitRecallOpportunity({
    opportunity,
    episode,
    recalledAt: "2026-07-23T20:01:00.000Z",
    workspaceSnapshotId: "workspace:50",
    sourceUtterancesVerified: true
  });
  const result = createReinterpretationMoment({
    recallMoment,
    episode,
    interpretation: "La lecture présente reste ambiguë.",
    createdAt: "2026-07-23T20:02:00.000Z"
  });
  assert.equal(result.moment.additiveOnly, true);
  assert.equal(result.moment.epistemicStatus, "provisional");
  assert.ok(result.relations.some(relation => relation.type === "REINTERPRETS"));
});

test("communication stays inner-only by default and requires positive value to cross a gate", () => {
  assert.equal(decideRecallCommunication().decision, "inner_only");
  assert.equal(decideRecallCommunication({
    importance: 1,
    actionability: 1,
    confirmationNeed: 1,
    misunderstandingRisk: 0.8,
    urgency: 1
  }).decision, "communicate_now");
});
