import test from "node:test";
import assert from "node:assert/strict";
import {
  CORE_AFFECTS,
  describeAffectState,
  edgeAffectSignal,
  learnLinkAffectProfile,
  runAffectiveHomeostasisTick,
  selectDominantAffect,
  subentityAffectiveGate
} from "../src/l1-affective-runtime.js";

const negativeEdge = { physics: { W: 1, P: -1, G: 1 }, affectVector: {} };
const config = { decay: 0.2, integrationGain: 1, dominanceThreshold: 0.4, minimumMargin: 0.1 };

test("negative polarity becomes surprise for contradiction, not automatic anger", () => {
  const signal = edgeAffectSignal(negativeEdge, { contradiction: true, uncertainty: 0.8 });
  assert.ok(signal.surprise > 0.7);
  assert.equal(signal.frustration, 0);
  assert.equal(signal.anger, 0);
});

test("a repeated blocked goal becomes frustration", () => {
  const signal = edgeAffectSignal(negativeEdge, { blockedGoal: true, repeatedFailure: 0.8 });
  assert.ok(signal.frustration > 0.7);
  assert.equal(signal.surprise, 0);
});

test("dominant frustration proposes resolution and pivot without executing", () => {
  const result = runAffectiveHomeostasisTick({
    activeLinks: [{ edge: negativeEdge, energy: 1, context: { blockedGoal: true, repeatedFailure: 1 } }],
    config
  });
  assert.equal(result.dominant.affect, "frustration");
  assert.ok(result.behavior.proposals.includes("RESOLVE_BLOCKING_QUESTION"));
  assert.ok(result.behavior.proposals.includes("PIVOT_STRATEGY"));
  assert.equal(result.behavior.executesAction, false);
});

test("dominant surprise proposes similarity search and a hypothesis node", () => {
  const result = runAffectiveHomeostasisTick({
    activeLinks: [{ edge: negativeEdge, energy: 1, context: { contradiction: true, uncertainty: 1 } }],
    config
  });
  assert.equal(result.dominant.affect, "surprise");
  assert.deepEqual(result.behavior.proposals.slice(0, 2), ["SEARCH_SIMILAR_NODES", "PROPOSE_HYPOTHESIS_NODE"]);
});

test("no dominant affect exists without an explicit threshold and margin", () => {
  assert.equal(selectDominantAffect({ surprise: 0.6, curiosity: 0.55 }, config), null);
  assert.throws(() => runAffectiveHomeostasisTick({ activeLinks: [] }), /explicit config/);
});

test("subentity compatibility changes a gate but never creates energy", () => {
  const gate = subentityAffectiveGate({
    affectState: { curiosity: 0.9, surprise: 0.2 },
    compatibility: { curiosity: 1 },
    metabolicAvailability: 0.8,
    safetyGate: 1,
    permissionGate: 1
  });
  assert.ok(gate > 0.7 && gate < 0.8);
});

test("a link profile learns only after repeated observations", () => {
  const initial = {};
  const first = learnLinkAffectProfile(initial, { surprise: 1 }, { observationCount: 0, learningRate: 0.2, minimumObservations: 3 });
  const second = learnLinkAffectProfile(first.vector, { surprise: 1 }, { observationCount: first.observationCount, learningRate: 0.2, minimumObservations: 3 });
  const third = learnLinkAffectProfile(second.vector, { surprise: 1 }, { observationCount: second.observationCount, learningRate: 0.2, minimumObservations: 3 });
  assert.equal(first.learned, false);
  assert.equal(second.learned, false);
  assert.equal(third.learned, true);
  assert.equal(third.vector.surprise, 0.2);
});

test("the core affect vector is explicit and extensible", () => {
  assert.deepEqual(CORE_AFFECTS, ["curiosity", "desire", "care", "fearOfError", "frustration", "surprise", "anger"]);
});

test("the current affect vector becomes a short graded French sentence", () => {
  assert.equal(
    describeAffectState({ curiosity: 0.6, surprise: 0.3 }),
    "Mon système est curieux et un peu surpris."
  );
  assert.equal(
    describeAffectState({ anger: 0.8, care: 0.5, frustration: 0.2 }),
    "Mon système est très en colère, attentionné et un peu frustré."
  );
});

test("an empty affect vector is not mislabeled as calm", () => {
  assert.equal(describeAffectState({}), "Mon système ne présente pas d'affect saillant détecté.");
  assert.throws(() => describeAffectState({}, { maximumAffects: 0 }), /positive integer/);
});

test("the affective tick exposes its current state description", () => {
  const result = runAffectiveHomeostasisTick({
    activeLinks: [{ edge: negativeEdge, energy: 1, context: { contradiction: true, uncertainty: 1 } }],
    config
  });
  assert.match(result.description, /^Mon système est /u);
  assert.match(result.description, /surpris/u);
});
