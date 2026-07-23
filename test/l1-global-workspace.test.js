import test from "node:test";
import assert from "node:assert/strict";
import {
  scoreWorkspaceCandidate,
  selectGlobalWorkspace,
  workspaceCandidateFromSubentity
} from "../src/l1-global-workspace.js";

const candidate = (id, overrides = {}) => ({
  id,
  controllerId: id,
  nodeIds: [`node-${id}`],
  heat: 0.5,
  goalSalience: 0.5,
  affect: 0.5,
  unresolvedness: 0.5,
  novelty: 0.5,
  continuity: 0.5,
  ...overrides
});

test("workspace selection chooses one lead and bounded supporting slots", () => {
  const snapshot = selectGlobalWorkspace({
    tickId: "tick-1",
    recordedAt: "2026-07-23T18:00:00Z",
    characterBudget: 1000,
    candidates: [
      candidate("protector", { heat: 1, goalSalience: 1 }),
      candidate("explorer", { novelty: 1 }),
      candidate("planner"),
      candidate("critic"),
      candidate("fifth")
    ]
  });
  assert.equal(snapshot.controllerId, "protector");
  assert.equal(snapshot.slots[0].role, "lead");
  assert.equal(snapshot.slots.length, 4);
  assert.equal(snapshot.characterUsed, 1000);
  assert.deepEqual(snapshot.slots.map(slot => slot.rank), [1, 2, 3, 4]);
  assert.equal(snapshot.previousSnapshotId, null);
});

test("residence and monopolization can release a captured workspace", () => {
  const captured = candidate("captured", { heat: 1, goalSalience: 1, residenceTicks: 5, monopolization: 1 });
  const fresh = candidate("fresh", { heat: 0.7, novelty: 1 });
  assert.ok(scoreWorkspaceCandidate(captured).penalty > scoreWorkspaceCandidate(fresh).penalty);
  const snapshot = selectGlobalWorkspace({ tickId: "release", characterBudget: 500, candidates: [captured, fresh] });
  assert.equal(snapshot.controllerId, "fresh");
});

test("unknown controller is valid and no candidate means an empty workspace", () => {
  const unknown = selectGlobalWorkspace({
    tickId: "unknown",
    characterBudget: 128,
    candidates: [candidate("content", { controllerId: null })]
  });
  assert.equal(unknown.controllerStatus, "unknown");
  assert.equal(unknown.activeEntity, null);
  const empty = selectGlobalWorkspace({ tickId: "empty", characterBudget: 128, candidates: [] });
  assert.equal(empty.audit.empty, true);
  assert.equal(empty.controllerId, null);
});

test("subentity candidates expose goals but never create energy", () => {
  const result = workspaceCandidateFromSubentity({
    id: "builder",
    status: "active",
    level: "high",
    goals: [{ key: "goal-build" }],
    lastActivation: 0.8
  });
  assert.equal(result.controllerId, "builder");
  assert.deepEqual(result.goalIds, ["goal-build"]);
  assert.equal(result.energy, undefined);
});

test("character budget is explicit and cannot be silently invented", () => {
  assert.throws(() => selectGlobalWorkspace({ tickId: "missing", candidates: [] }), /characterBudget/);
  assert.throws(() => selectGlobalWorkspace({ tickId: "zero", characterBudget: 0, candidates: [] }), /at least 1/);
});
