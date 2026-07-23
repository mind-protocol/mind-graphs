import test from "node:test";
import assert from "node:assert/strict";
import {
  createMetacognitiveState, evaluateTraversalScenarios, runMetacognitiveStateTick
} from "../src/l1-metacognitive-runtime.js";

const ambiguous = [
  { id: "repair", prior: 0.5, support: 0.6, evidence: 0.6, controllability: 0.8, reversibility: 0.9, goalAlignment: 0.7, expectedValence: 0.5 },
  { id: "wait", prior: 0.5, support: 0.6, evidence: 0.6, controllability: 0.8, reversibility: 1, goalAlignment: 0.4, expectedValence: 0.2 }
];

test("parallel scenarios remain normalized and high ambiguity produces verification", () => {
  const evaluation = evaluateTraversalScenarios(ambiguous);
  assert.ok(Math.abs(evaluation.scenarios.reduce((sum, scenario) => sum + scenario.probability, 0) - 1) < 1e-12);
  assert.ok(evaluation.entropy > 0.95);
  const tick = runMetacognitiveStateTick({
    traversal: { tickId: "meta-1", scenarios: ambiguous },
    workspace: { activeEntity: { id: "explorer", arousal: 0.3 } }
  });
  assert.equal(tick.mode, "VERIFY");
  assert.equal(tick.safety.panicStateExists, false);
  assert.equal(tick.safety.irreversibleActionAllowed, false);
});

test("utility does not bias belief toward pleasant scenarios", () => {
  const evaluation = evaluateTraversalScenarios([
    { id: "pleasant", prior: 0.5, support: 0.5, evidence: 0.8, expectedValence: 1, threat: 0 },
    { id: "unpleasant", prior: 0.5, support: 0.5, evidence: 0.8, expectedValence: -1, threat: 1 }
  ]);
  assert.ok(Math.abs(evaluation.scenarios[0].probability - 0.5) < 1e-12);
  assert.ok(Math.abs(evaluation.scenarios[1].probability - 0.5) < 1e-12);
});

test("verified threat must persist before protection and subentity gates change gradually", () => {
  const scenarios = [
    { id: "threat", subentityId: "protector", prior: 0.95, support: 1, evidence: 1, threat: 1, controllability: 0, reversibility: 1 },
    { id: "safe", subentityId: "explorer", prior: 0.05, support: 0.3, evidence: 0.4, threat: 0, controllability: 1, reversibility: 1 }
  ];
  const subentities = [
    { id: "protector", behavioralState: { gate: 0.5 } },
    { id: "explorer", behavioralState: { gate: 0.5 } }
  ];
  let state = createMetacognitiveState();
  const modes = [];
  for (let tick = 1; tick <= 3; tick += 1) {
    const result = runMetacognitiveStateTick({ previousState: state, traversal: { tickId: `threat-${tick}`, scenarios }, subentities });
    modes.push(result.mode);
    for (const adaptation of Object.values(result.adaptations)) {
      assert.ok(Math.abs(adaptation.gateDelta) <= 0.1200000001);
      assert.equal(adaptation.allowIrreversibleAction, false);
    }
    state = result.nextState;
  }
  assert.equal(modes[0], "STABILIZE");
  assert.equal(modes[1], "STABILIZE");
  assert.equal(modes[2], "PROTECT");
});

test("an explicitly corroborated hard-safety signal may protect immediately", () => {
  const result = runMetacognitiveStateTick({
    traversal: {
      tickId: "hard-safety",
      hardSafety: true,
      hardSafetyEvidence: 0.9,
      scenarios: [{ id: "danger", prior: 1, support: 1, evidence: 1, threat: 1, controllability: 0 }]
    }
  });
  assert.equal(result.mode, "PROTECT");
  assert.equal(result.safety.hardSafetyAccepted, true);
  assert.deepEqual(result.adaptedSubentities, []);
});

test("positive controllable evidence engages only reversible monitored behavior", () => {
  const scenario = [{ id: "step", prior: 1, support: 0.9, evidence: 0.9, expectedValence: 0.7, controllability: 0.9, reversibility: 1, goalAlignment: 0.8 }];
  let state = createMetacognitiveState();
  let result;
  for (let tick = 1; tick <= 3; tick += 1) {
    result = runMetacognitiveStateTick({
      previousState: state,
      traversal: { tickId: `positive-${tick}`, scenarios: scenario },
      subentities: [{ id: "builder", behavioralState: { gate: 0.4 } }]
    });
    if (tick === 1) assert.equal(result.mode, "VERIFY");
    state = result.nextState;
  }
  assert.equal(result.mode, "ENGAGE");
  assert.ok(result.adaptations.builder.strategies.includes("TAKE_SMALLEST_USEFUL_STEP"));
  assert.ok(result.adaptations.builder.strategies.includes("PRESERVE_ROLLBACK"));
  assert.equal(result.adaptations.builder.allowIrreversibleAction, false);
});

test("replaying a stable tick id is idempotent", () => {
  const first = runMetacognitiveStateTick({
    traversal: { tickId: "same-tick", scenarios: [{ id: "path", prior: 1, support: 0.8, evidence: 0.8 }] },
    subentities: [{ id: "explorer" }]
  });
  const replay = runMetacognitiveStateTick({
    previousState: first.nextState,
    traversal: { tickId: "same-tick", scenarios: [{ id: "changed-input", prior: 1, support: 1, evidence: 1 }] },
    subentities: [{ id: "explorer" }]
  });
  assert.equal(replay.status, "already_processed");
  assert.equal(replay.nextState.revision, first.nextState.revision);
  assert.deepEqual(replay.nextState.scenarios, first.nextState.scenarios);
});
