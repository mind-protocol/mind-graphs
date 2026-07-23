import test from "node:test";
import assert from "node:assert/strict";
import { deriveSubentityCandidates } from "../src/l1-coalition-detector.js";

const signals = {
  sensory: { citizenId: "actor-nlr", totalBudget: 1, allocatedEnergy: 0.8, transfers: [{ targetNodeId: "goal-create", energy: 0.6, sourceCitizenId: "actor-nlr" }, { targetNodeId: "prototype", energy: 0.2, sourceCitizenId: "actor-nlr" }] },
  affect: { dominant: { affect: "curiosity", intensity: 0.7 } },
  workspace: { id: "ws-1", actorId: "actor-nlr", activeNodeIds: ["workspace-active"], goalIds: ["goal-create"], cortexState: "state-execution", activeEntity: { id: "citizen", focusIntensity: 0.6 } },
  memory: { id: "moment-1" },
  tickId: "sensory-1",
  recordedAt: "2026-07-23T15:00:00Z"
};

test("sensory, affect and workspace form one deterministic provisional coalition", () => {
  const first = deriveSubentityCandidates({ state: {}, ...signals });
  const second = deriveSubentityCandidates({ state: {}, ...signals });
  assert.equal(first.candidates.length, 1);
  assert.equal(first.candidates[0].id, second.candidates[0].id);
  assert.equal(first.candidates[0].level, "low");
  assert.equal(first.candidates[0].nodeType, "actor");
  assert.deepEqual(first.candidates[0].evidenceMomentIds, ["moment-1"]);
  assert.equal(first.workspaceSnapshot.controllers.length, 0, "salience alone must not invent a controller");
  assert.equal(first.perception.actor.id, "actor-nlr");
  assert.equal(first.perception.space.nodeType, "space");
  assert.equal(first.perception.moment.nodeType, "moment");
  assert.deepEqual(first.perception.activeNodeIds.sort(), ["citizen", "goal-create", "prototype", "workspace-active"]);
  assert.equal(first.perception.relations.filter(relation => relation.type === "ACTIVATES").length, 4);
  assert.ok(first.perception.relations.some(relation => relation.type === "PERCEIVED_BY" && relation.target === "actor-nlr"));
  assert.ok(first.perception.relations.some(relation => relation.type === "OCCURS_IN" && relation.target === first.perception.space.id));
});

test("recurrence grows weight, stability and certainty", () => {
  const first = deriveSubentityCandidates({ state: {}, ...signals }).candidates[0];
  const second = deriveSubentityCandidates({ state: { subentities: [first] }, ...signals, memory: { id: "moment-2" } }).candidates[0];
  assert.ok(second.weight > first.weight);
  assert.ok(second.stability > first.stability);
  assert.ok(second.certainty > first.certainty);
  assert.equal(second.observationCount, 2);
});

test("replaying one observation cannot manufacture recurrence", () => {
  const firstResult = deriveSubentityCandidates({ state: {}, ...signals });
  const first = firstResult.candidates[0];
  const replay = deriveSubentityCandidates({
    state: { subentities: [first] },
    ...signals,
    tickId: "sensory-replay"
  });
  const second = replay.candidates[0];
  assert.equal(replay.observation.novelObservation, false);
  assert.equal(second.observationCount, 1);
  assert.equal(second.weight, first.weight);
  assert.equal(second.stability, first.stability);
  assert.equal(second.certainty, first.certainty);
  assert.equal(replay.perception, null, "a replay must not fabricate a second perceptual Moment");
});

test("an explicit known subentity is captured as the controller", () => {
  const existing = { id: "protector", level: "high", status: "active", weight: 5, stability: 0.8, certainty: 0.8, evidenceMomentIds: [] };
  const result = deriveSubentityCandidates({
    state: { subentities: [existing] },
    ...signals,
    workspace: { ...signals.workspace, activeEntity: { id: "protector", semanticType: "subentity", focusIntensity: 0.9, confidence: 0.84 } }
  });
  assert.equal(result.candidates[0].id, "protector");
  assert.deepEqual(result.workspaceSnapshot.controllers, [{ subentityId: "protector", confidence: 0.84, active: true }]);
});

test("no signal produces no psychological entity", () => {
  const result = deriveSubentityCandidates({ state: {}, sensory: {}, affect: {}, workspace: {} });
  assert.deepEqual(result.candidates, []);
  assert.equal(result.perception, null);
});
