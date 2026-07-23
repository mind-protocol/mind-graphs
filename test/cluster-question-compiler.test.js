import test from "node:test";
import assert from "node:assert/strict";
import {
  CLUSTER_GAP_DEFINITIONS, compileClusterQuestions
} from "../src/cluster-question-compiler.js";

const policy = {
  maxQuestions: 10,
  totalEnergyBudget: 2,
  minimumPriority: 0,
  factors: { gap: 0.5, clusterEnergy: 0.2, cortex: 0.2, affect: 0.1 }
};

const goal = {
  id: "goal-a",
  name: "Réparer le graphe",
  nodeType: "narrative",
  semanticType: "system_state",
  stateOrientation: "desirable",
  clusterId: "active"
};

test("an objective gap asks for its metric and its remembered origin", () => {
  const questions = compileClusterQuestions({ nodes: [goal], policy });
  const metric = questions.find(question => question.gapType === "objective_without_measure");
  const origin = questions.find(question => question.gapType === "objective_without_origin");
  assert.equal(metric.expectedNodeType, "thing");
  assert.deepEqual(metric.expectedSemanticTypes, ["metric"]);
  assert.ok(metric.allowedRelations.includes("MEASURED_BY"));
  assert.equal(origin.expectedNodeType, "moment");
  assert.match(origin.evidenceRequirement, /ne pas fabriquer de souvenir/);
});

test("existing structural answers suppress the corresponding questions", () => {
  const nodes = [goal, { id: "metric", semanticType: "metric", clusterId: "active" }, { id: "memory", semanticType: "memory", clusterId: "active" }];
  const links = [
    { source: "goal-a", target: "metric", type: "MEASURED_BY" },
    { source: "memory", target: "goal-a", type: "MOTIVATES" }
  ];
  const questions = compileClusterQuestions({ nodes, links, policy });
  assert.equal(questions.some(question => question.sourceNodeIds.includes("goal-a")), false);
});

test("an unresolved blocker asks for a testable capability, not a free mutation", () => {
  const nodes = [
    { id: "blocker", name: "Dépendance absente", semanticType: "open_question", clusterId: "active" },
    { id: "target", name: "Exécution autonome", semanticType: "mechanism", clusterId: "active" }
  ];
  const links = [{ source: "blocker", target: "target", type: "BLOCKS" }];
  const questions = compileClusterQuestions({ nodes, links, policy, cortexState: "state-frustration-pivot", affectVector: { frustration: 0.8 } });
  const blocked = questions.find(question => question.gapType === "blocked_target");
  assert.deepEqual(blocked.sourceNodeIds, ["target", "blocker"]);
  assert.ok(blocked.allowedRelations.includes("UNLOCKS"));
  assert.match(blocked.creationPolicy, /testable_missing_capability/);
  assert.deepEqual(blocked.affectContext.map(item => item.affect), ["frustration"]);
});

test("Cortex state and affect contribute explicitly to priority", () => {
  const nodes = [{ id: "q", name: "Pourquoi ?", semanticType: "open_question", clusterId: "active" }];
  const [question] = compileClusterQuestions({
    nodes,
    policy,
    cortexState: "state-feedback-monitoring",
    affectVector: { fearOfError: 1 },
    energyByCluster: { active: 3 }
  });
  assert.ok(question.priorityContributions.clusterEnergy > 0);
  assert.ok(question.priorityContributions.cortex > 0);
  assert.ok(question.priorityContributions.affect > 0);
  assert.match(question.reason, /state-feedback-monitoring/);
});

test("question ids and the conservative energy allocation are deterministic", () => {
  const input = { nodes: [goal, { id: "q", semanticType: "open_question", clusterId: "active" }], policy };
  const first = compileClusterQuestions(input);
  const second = compileClusterQuestions(input);
  assert.deepEqual(first, second);
  assert.equal(Number(first.reduce((sum, question) => sum + question.energyBudget, 0).toFixed(9)), 2);
});

test("rounding cannot create energy across a six-question agenda", () => {
  const nodes = Array.from({ length: 6 }, (_, index) => ({
    ...goal,
    id: `goal-${index}`
  }));
  const questions = compileClusterQuestions({ nodes, policy: { ...policy, maxQuestions: 6, totalEnergyBudget: 1 } });
  assert.equal(Number(questions.reduce((sum, question) => sum + question.energyBudget, 0).toFixed(9)), 1);
});

test("cluster selection prevents an inactive cluster from writing the agenda", () => {
  const questions = compileClusterQuestions({
    nodes: [goal, { ...goal, id: "goal-b", clusterId: "inactive" }],
    selectedClusterIds: ["active"],
    policy
  });
  assert.equal(questions.some(question => question.sourceNodeIds.includes("goal-b")), false);
});

test("every gap contract types both creation and relations", () => {
  const designSemanticTypes = new Set([
    "metric", "observation", "decision", "change", "working_hypothesis", "idea",
    "unlock", "method", "mechanism", "experiment"
  ]);
  for (const definition of Object.values(CLUSTER_GAP_DEFINITIONS)) {
    assert.ok(definition.expectedNodeType);
    assert.ok(definition.expectedSemanticTypes.length);
    assert.ok(definition.allowedRelations.length);
    assert.ok(definition.creationPolicy);
    assert.ok(definition.evidenceRequirement);
    for (const semanticType of definition.expectedSemanticTypes) {
      assert.ok(designSemanticTypes.has(semanticType), `unknown design semantic type: ${semanticType}`);
    }
  }
});
