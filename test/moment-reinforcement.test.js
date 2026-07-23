import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveMomentOutcome,
  positiveAffectLevel,
  reinforceMoments,
  scoreMomentOutcome
} from "../src/moment-reinforcement.js";
import {
  applyMomentOutcome,
  buildPhysicsIndex,
  createState,
  injectAtNode,
  propagate
} from "../src/l4-physics.js";
import { runSubentityLifecycleTick } from "../src/l1-subentity-runtime.js";

const policy = {
  outcomeWeights: {
    humanValenceDelta: 4,
    positiveAffectDelta: 2,
    subentityEnergyDelta: 1,
    completenessDelta: 2,
    goalProgressDelta: 3
  },
  learningRate: 0.2,
  minimumWeight: 0.1,
  maximumWeight: 3
};

test("les dimensions inconnues sont omises et les poids observés sont renormalisés", () => {
  const scored = scoreMomentOutcome({ humanValenceDelta: 1, completenessDelta: 0.5 }, policy.outcomeWeights);
  assert.deepEqual(scored.vector, { humanValenceDelta: 0.5, completenessDelta: 0.5 });
  assert.equal(scored.normalizedWeights.humanValenceDelta, 2 / 3);
  assert.equal(scored.normalizedWeights.completenessDelta, 1 / 3);
  assert.equal(scored.score, 0.5);
  assert.equal(Object.hasOwn(scored.vector, "goalProgressDelta"), false);
});

test("les affects positifs descriptifs et runtime alimentent le même delta", () => {
  assert.equal(positiveAffectLevel({ joy: 0.8, relief: 0.6, frustration: 1 }), 0.7);
  const outcome = deriveMomentOutcome({
    positiveAffectBefore: { curiosity: 0.2, joy: 0.4 },
    positiveAffectAfter: { curiosity: 0.8, joy: 0.6 }
  });
  assert.ok(Math.abs(outcome.positiveAffectDelta - 0.4) < 1e-12);
});

test("tous les Moments portent le ledger mais seuls les Moments éligibles reçoivent le crédit", () => {
  const result = reinforceMoments([
    { id: "m-active" },
    { id: "m-inactive" }
  ], {
    humanValenceDelta: 1,
    positiveAffectDelta: 0.5,
    subentityEnergyDelta: 0.25,
    completenessDelta: 0.5,
    goalProgressDelta: 0.75
  }, {
    policy,
    eligibilityByMoment: { "m-active": 0.8 },
    observedAt: "2026-07-23T12:00:00.000Z",
    outcomeId: "outcome-1"
  });
  const active = result.moments.find(moment => moment.id === "m-active");
  const inactive = result.moments.find(moment => moment.id === "m-inactive");
  assert.ok(active.reinforcement.weight > 1);
  assert.equal(active.reinforcement.updateCount, 1);
  assert.equal(inactive.reinforcement.weight, 1);
  assert.equal(inactive.reinforcement.updateCount, 0);
  assert.equal(result.updates.length, 1);
});

test("un résultat négatif affaiblit sans supprimer le Moment", () => {
  const result = reinforceMoments([{ id: "m", reinforcement: { weight: 1, updateCount: 2 } }], {
    humanValenceDelta: -2,
    positiveAffectDelta: -1,
    completenessDelta: -0.5
  }, {
    policy,
    eligibilityByMoment: { m: 1 }
  });
  assert.ok(result.moments[0].reinforcement.weight < 1);
  assert.ok(result.moments[0].reinforcement.weight >= policy.minimumWeight);
  assert.equal(result.moments[0].reinforcement.updateCount, 3);
});

test("le cycle L1 renforce directement les Moments autobiographiques sans créer un type stratégie", () => {
  const result = runSubentityLifecycleTick({
    moments: [{ id: "m-old", nodeType: "Moment", semanticType: "AutobiographicalMemory" }]
  }, {
    tickId: "tick-reinforcement",
    recordedAt: "2026-07-23T12:00:00.000Z",
    candidates: [],
    memory: { id: "m-new", content: "Résultat utile" },
    outcome: { humanValenceDelta: 1, completenessDelta: 0.5 },
    momentEligibility: { "m-old": 0.4, "m-new": 1 }
  }, { momentReinforcementPolicy: policy });
  assert.equal(result.state.moments.length, 2);
  assert.ok(result.state.moments.every(moment => moment.nodeType === "Moment"));
  assert.equal(result.report.reinforcedMomentCount, 2);
  assert.ok(result.state.moments.find(moment => moment.id === "m-new").reinforcement.weight
    > result.state.moments.find(moment => moment.id === "m-old").reinforcement.weight);
});

test("le poids acquis par un Moment biaise la répartition sans créer d'énergie", () => {
  const nodes = [
    { id: "C", nodeType: "Actor", citizen: true },
    { id: "J", nodeType: "Thing" },
    { id: "M-win", nodeType: "Moment" },
    { id: "M-other", nodeType: "Moment" }
  ];
  const links = [
    { source: "C", target: "J", type: "FEEDS" },
    { source: "J", target: "M-win", type: "FEEDS" },
    { source: "J", target: "M-other", type: "FEEDS" }
  ];
  const profiles = [{ source: "FEEDS", polarity: [1, 0], permanence: 1 }];
  const index = buildPhysicsIndex(nodes, links, profiles);
  const state = createState(index);
  applyMomentOutcome(state, index, { humanValenceDelta: 2, goalProgressDelta: 1 }, {
    policy,
    eligibilityByMoment: { "M-win": 1 },
    outcomeId: "win"
  });
  injectAtNode(state, index, "C", 1);
  const before = [...state.energy.values()].reduce((sum, value) => sum + value, 0);
  propagate(state, index, {
    propagationFloor: 0,
    propagationGain: 0.1,
    semanticGuidanceBeta: 0,
    semanticTemperature: 1,
    explorationRate: 0
  }, { citizenId: "C" });
  const after = [...state.energy.values()].reduce((sum, value) => sum + value, 0);
  assert.ok(state.energy.get("J|FEEDS|M-win") > state.energy.get("J|FEEDS|M-other"));
  assert.ok(Math.abs(before - after) < 1e-12);
});
