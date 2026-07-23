import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  EMPTY_SUBENTITY_RUNTIME_STATE,
  applySubentityLifecycleTick,
  readSubentityRuntimeState,
  runSubentityLifecycleTick
} from "../src/l1-subentity-runtime.js";

const strongCandidate = id => ({
  id, level: "low", status: "candidate", weight: 30, stability: 1, certainty: 1, coherence: 1,
  signature: { create: 1 }, goals: [{ key: "create", score: 1 }], strategies: [{ key: "prototype", score: 0.9 }],
  preferences: [{ key: "novelty", score: 0.9, evidenceMomentIds: ["moment-1"] }], beliefs: [],
  evidenceMomentIds: Array.from({ length: 20 }, (_, index) => `evidence-${index}`)
});

const tick = {
  tickId: "tick-1",
  recordedAt: "2026-07-23T12:00:00.000Z",
  candidates: [strongCandidate("creator")],
  workspaceSnapshot: { id: "workspace-1", controllers: [{ subentityId: "creator", confidence: 0.82, active: true }] },
  memory: { id: "moment-1", occurredAt: "2026-07-23T11:59:59.000Z", content: "A prototype was chosen." }
};

test("one lifecycle transaction promotes, narrates and attributes its Moment", () => {
  const result = runSubentityLifecycleTick(EMPTY_SUBENTITY_RUNTIME_STATE, tick);
  assert.equal(result.report.status, "applied");
  assert.equal(result.state.revision, 1);
  assert.equal(result.state.subentities.find(entity => entity.id === "creator").level, "high");
  assert.ok(result.state.narratives.length >= 2);
  assert.ok(result.state.relations.some(edge => edge.type === "CONTROLLED_WORKSPACE_DURING" && edge.target === "moment-1"));
  assert.ok(result.state.relations.some(edge => edge.type === "SUPPORTS"));
});

test("replaying a stable tick id is idempotent", () => {
  const first = runSubentityLifecycleTick(EMPTY_SUBENTITY_RUNTIME_STATE, tick);
  const replay = runSubentityLifecycleTick(first.state, tick);
  assert.equal(replay.report.status, "already_processed");
  assert.equal(replay.state.revision, 1);
  assert.equal(replay.state.moments.length, 1);
  assert.deepEqual(replay.state, first.state);
});

test("a different tick cannot silently overwrite an existing Moment", () => {
  const first = runSubentityLifecycleTick(EMPTY_SUBENTITY_RUNTIME_STATE, tick);
  assert.throws(() => runSubentityLifecycleTick(first.state, { ...tick, tickId: "tick-2" }), /already exists/);
});

test("atomic file adapter persists complete state and dry-run leaves it untouched", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "l1-subentity-runtime-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, "state.json");
  const applied = await applySubentityLifecycleTick({ statePath, input: tick });
  assert.equal(applied.persisted, true);
  const stored = await readSubentityRuntimeState(statePath);
  assert.equal(stored.revision, 1);

  const dryInput = { tickId: "tick-dry", recordedAt: "2026-07-23T13:00:00.000Z", candidates: [] };
  const dry = await applySubentityLifecycleTick({ statePath, input: dryInput, dryRun: true });
  assert.equal(dry.state.revision, 2);
  assert.equal((await readSubentityRuntimeState(statePath)).revision, 1);
});
