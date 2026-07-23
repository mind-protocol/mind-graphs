import test from "node:test";
import assert from "node:assert/strict";
import { runIntegratedL1Tick, runIntegratedL1UntilStable, summarizeSubentityRuntime } from "../src/l1-integrated-runtime.js";
import { EMPTY_SUBENTITY_RUNTIME_STATE } from "../src/l1-subentity-runtime.js";

test("integrated tick detects a coalition and creates its attributed memory only with explicit control", () => {
  const result = runIntegratedL1Tick(EMPTY_SUBENTITY_RUNTIME_STATE, {
    tickId: "integrated-1", recordedAt: "2026-07-23T16:00:00Z",
    sensory: { citizenId: "actor-nlr", totalBudget: 1, allocatedEnergy: 0.8, transfers: [{ targetNodeId: "repair", energy: 0.8, sourceCitizenId: "actor-nlr" }] },
    affect: { dominant: { affect: "curiosity", intensity: 0.7 } },
    workspace: { id: "ws", actorId: "actor-nlr", activeNodeIds: ["repair", "plan"], cortexState: "state-execution", activeEntity: { id: "new-pattern", semanticType: "subentity", focusIntensity: 0.8, confidence: 0.75 } },
    memory: { id: "integrated-moment-1", occurredAt: "2026-07-23T15:59:59Z", content: "Repair path selected" }
  });
  assert.equal(result.detection.candidates.length, 1);
  assert.ok(result.state.subentities.some(entity => entity.id === "new-pattern"));
  assert.equal(result.state.actors[0].id, "actor-nlr");
  assert.equal(result.state.spaces.length, 1);
  assert.equal(result.state.perceptualMoments.length, 1);
  assert.ok(result.state.relations.some(edge => edge.type === "PERCEIVED_BY" && edge.target === "actor-nlr"));
  assert.equal(result.state.relations.filter(edge => edge.type === "ACTIVATES").length, 3);
  assert.ok(result.state.relations.some(edge => edge.type === "CONTROLLED_WORKSPACE_DURING" && edge.source === "new-pattern"));
});

test("integrated traversal persists state awareness and bounded behavioral adaptation", () => {
  const previous = {
    ...EMPTY_SUBENTITY_RUNTIME_STATE,
    subentities: [{ id: "explorer", level: "low", status: "active", weight: 0.8, stability: 0.5, certainty: 0.6, signature: {}, behavioralState: { gate: 0.5 } }]
  };
  const result = runIntegratedL1Tick(previous, {
    tickId: "integrated-meta-1",
    recordedAt: "2026-07-23T12:00:00.000Z",
    sensory: { transfers: [], allocatedEnergy: 0, totalBudget: 1 },
    affect: { vector: {} },
    workspace: { id: "ws-meta", activeEntity: { id: "explorer", semanticType: "subentity", focusIntensity: 0.7 } },
    traversal: {
      tickId: "integrated-meta-1",
      scenarios: [
        { id: "inspect", subentityId: "explorer", prior: 0.5, support: 0.6, evidence: 0.6, controllability: 0.9, reversibility: 1 },
        { id: "pause", prior: 0.5, support: 0.6, evidence: 0.6, controllability: 1, reversibility: 1 }
      ]
    }
  });
  assert.equal(result.metacognition.mode, "VERIFY");
  assert.equal(result.state.metacognitive.lastTickId, "integrated-meta-1");
  assert.equal(result.report.scenarioCount, 2);
  assert.ok(result.state.subentities.find(entity => entity.id === "explorer").behavioralState.strategies.includes("COMPARE_SCENARIOS"));
});

test("automatic micro-ticks stop at equilibrium without repeating evidence", () => {
  const input = {
    tickId: "auto-stable-1",
    observationId: "moment-observation-1",
    evidenceMomentIds: ["moment-observation-1"],
    recordedAt: "2026-07-23T17:00:00Z",
    sensory: { citizenId: "actor-nlr", totalBudget: 1, allocatedEnergy: 1, transfers: [{ targetNodeId: "moment-observation-1", energy: 1, sourceCitizenId: "actor-nlr" }] },
    affect: { vector: {} },
    workspace: { id: "ws-auto", actorId: "actor-nlr", cortexState: "state-execution", activeEntity: { id: "moment-observation-1", semanticType: "Moment", focusIntensity: 1 } }
  };
  const result = runIntegratedL1UntilStable(EMPTY_SUBENTITY_RUNTIME_STATE, input);
  const candidate = result.state.subentities[0];
  assert.equal(result.report.stopReason, "stable");
  assert.equal(result.report.microTickCount, 2);
  assert.equal(result.stabilization.history[0].novelObservation, true);
  assert.equal(result.stabilization.history[1].novelObservation, false);
  assert.equal(candidate.observationCount, 1);
  assert.deepEqual(candidate.observationIds, ["moment-observation-1"]);
  assert.deepEqual(candidate.evidenceMomentIds, ["moment-observation-1"]);
  assert.equal(result.state.perceptualMoments.length, 1);

  const replay = runIntegratedL1UntilStable(result.state, input);
  assert.equal(replay.report.status, "already_processed");
  assert.equal(replay.report.changed, false);
  assert.equal(replay.state.subentities[0].weight, candidate.weight);
});

test("automatic micro-ticks require an explicit observation identity and a bounded budget", () => {
  assert.throws(() => runIntegratedL1UntilStable(EMPTY_SUBENTITY_RUNTIME_STATE, { tickId: "missing-observation" }), /observationId/);
  assert.throws(() => runIntegratedL1UntilStable(EMPTY_SUBENTITY_RUNTIME_STATE, { tickId: "bad-budget", observationId: "o1" }, { maxMicroTicks: 0 }), /positive integer/);
});

test("runtime summary exposes active entities, latest controllers and recent events", () => {
  const summary = summarizeSubentityRuntime({
    revision: 4, updatedAt: "now",
    subentities: [{ id: "protector", status: "active", level: "high", weight: 8 }, { id: "old", status: "merged", level: "low" }],
    moments: [{ id: "m1", occurredAt: "2026-07-23T10:00:00Z" }],
    relations: [{ id: "control", source: "protector", type: "CONTROLLED_WORKSPACE_DURING", target: "m1", rank: 1, confidence: 0.8, attribution: "primary" }],
    narratives: [{ id: "n1" }], events: [{ id: "e1", type: "SUBENTITY_PROMOTED" }]
  });
  assert.deepEqual(summary.counts, { actors: 0, stimulusSpaces: 0, stimulusMoments: 0, active: 1, highLevel: 1, candidates: 0, merged: 1, narratives: 1, moments: 1 });
  assert.equal(summary.controllers[0].subentityId, "protector");
  assert.equal(summary.recentEvents[0].id, "e1");
});
