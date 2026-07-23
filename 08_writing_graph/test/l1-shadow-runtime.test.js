import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  EMPTY_L1_SHADOW_STATE,
  appendShadowReview,
  computeShadowMetrics,
  readShadowReviews,
  runL1ShadowTick,
  shadowView
} from "../src/l1-shadow-runtime.js";
import { EMPTY_SUBENTITY_RUNTIME_STATE } from "../src/l1-subentity-runtime.js";

const input = {
  tickId: "shadow-1", recordedAt: "2026-07-23T17:00:00Z",
  sensory: { totalBudget: 1, allocatedEnergy: 0.8, transfers: [{ targetNodeId: "repair", energy: 0.8 }] },
  affect: { dominant: { affect: "curiosity", intensity: 0.8 } },
  workspace: { id: "ws-shadow", activeEntity: { id: "candidate-shadow", semanticType: "subentity", focusIntensity: 0.8, confidence: 0.7 } },
  memory: { id: "shadow-memory-1", occurredAt: "2026-07-23T16:59:59Z", content: "Observed only" }
};

test("shadow tick never mutates or applies to the authoritative state", () => {
  const authoritative = structuredClone(EMPTY_SUBENTITY_RUNTIME_STATE);
  const before = structuredClone(authoritative);
  const result = runL1ShadowTick(EMPTY_L1_SHADOW_STATE, authoritative, input);
  assert.deepEqual(authoritative, before);
  assert.equal(result.report.appliedToAuthoritativeState, false);
  assert.equal(result.state.simulatedState.revision, 1);
  assert.equal(authoritative.revision, 0);
});

test("shadow replay is idempotent", () => {
  const first = runL1ShadowTick(EMPTY_L1_SHADOW_STATE, EMPTY_SUBENTITY_RUNTIME_STATE, input);
  const replay = runL1ShadowTick(first.state, EMPTY_SUBENTITY_RUNTIME_STATE, input);
  assert.equal(replay.report.status, "already_processed");
  assert.deepEqual(replay.state, first.state);
});

test("explicit workspace control becomes a reviewable proposal, not a real relation", () => {
  const result = runL1ShadowTick(EMPTY_L1_SHADOW_STATE, EMPTY_SUBENTITY_RUNTIME_STATE, input);
  const proposal = result.state.proposals.find(item => item.type === "ATTRIBUTE_CONTROLLER");
  assert.ok(proposal);
  assert.equal(proposal.reviewStatus, "unreviewed");
  assert.equal(result.state.metrics.controllerCoverage, 1);
});

test("reviews calibrate acceptance without changing proposals", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "l1-shadow-review-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "reviews.jsonl");
  const result = runL1ShadowTick(EMPTY_L1_SHADOW_STATE, EMPTY_SUBENTITY_RUNTIME_STATE, input);
  const proposal = result.state.proposals[0];
  await appendShadowReview(filePath, { proposalId: proposal.id, verdict: "accepted", reviewedAt: "2026-07-23T18:00:00Z" });
  const reviews = await readShadowReviews(filePath);
  const view = shadowView(result.state, reviews);
  assert.equal(view.proposals.find(item => item.id === proposal.id).review.verdict, "accepted");
  assert.equal(view.metrics.reviewAcceptanceRate, 1);
  assert.deepEqual(result.state.proposals[0], proposal);
});

test("fragmentation metrics expose soft pressure, not a hard rejection", () => {
  const metrics = computeShadowMetrics({
    processedTickIds: ["a"], proposals: [], observations: [],
    simulatedState: { subentities: Array.from({ length: 12 }, (_, index) => ({ id: `p${index}`, level: "high", status: "active" })) }
  });
  assert.equal(metrics.simulatedHighLevelCount, 12);
  assert.ok(metrics.fragmentationPressure > 0.5);
});
