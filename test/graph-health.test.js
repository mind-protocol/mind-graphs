import test from "node:test";
import assert from "node:assert/strict";
import { buildAlgorithmExecutions, buildWorkstreams, calculateGraphHealth, enrichRecommendation } from "../public/graph-health.js";

test("health indicators expose transparent numerators and denominators", () => {
  const nodes = [
    { id: "q", name: "Question", nodeType: "open_question", epistemicStatus: "unresolved", schemaVersion: "1.4.0" },
    { id: "m", name: "Mécanisme", nodeType: "mechanism", epistemicStatus: "design_proposal", schemaVersion: "1.4.0" }
  ];
  const links = [{ source: "m", target: "q", type: "ADDRESSES", relationFamily: "design_reasoning", relationScope: "design_proposal", canonicalPredicate: "ADDRESSES", schemaVersion: "1.4.0" }];
  const health = calculateGraphHealth(nodes, links);
  const questions = health.indicators.find(item => item.id === "questions");
  assert.equal(questions.numerator, 1);
  assert.equal(questions.denominator, 1);
  assert.equal(questions.score, 100);
  assert.ok(health.indicators.every(item => item.explanation && item.whyItMatters && item.limitation && item.action));
  assert.ok(health.indicators.every(item => item.numeratorLabel && item.denominatorLabel));
  assert.ok(health.drivers.every(item => Number.isFinite(item.lostPoints)));
});

test("health reads open semantic types without confusing them with L4 roles", () => {
  const nodes = [
    { id: "q", name: "Question", nodeType: "narrative", semanticType: "open_question", epistemicStatus: "unresolved", schemaVersion: "1.17.0" },
    { id: "m", name: "Mécanisme", nodeType: "narrative", semanticType: "mechanism", epistemicStatus: "design_proposal", schemaVersion: "1.17.0" },
    { id: "x", name: "Extension", nodeType: "thing", semanticType: "free_domain_extension", epistemicStatus: "documented", schemaVersion: "1.17.0" }
  ];
  const links = [{ source: "m", target: "q", type: "ADDRESSES", relationFamily: "design_reasoning", relationScope: "design_proposal", canonicalPredicate: "ADDRESSES", schemaVersion: "1.17.0" }];
  const health = calculateGraphHealth(nodes, links);
  const questions = health.indicators.find(item => item.id === "questions");
  assert.equal(questions.denominator, 1);
  assert.equal(questions.numerator, 1);
  assert.equal(health.totals.solutions, 1);
});

test("algorithm ledger separates completed traversals from repair dry-runs", () => {
  const health = { indicators: [
    { id: "provenance", numerator: 2, denominator: 3 },
    { id: "questions", numerator: 1, denominator: 2 },
    { id: "quantification", numerator: 0, denominator: 4 },
    { id: "causal_context", numerator: 1, denominator: 4 }
  ] };
  const report = { categoryCounts: { fragile_claim: 4, consolidation: 1 } };
  const executions = buildAlgorithmExecutions(report, health, { traversalContract: {} }, [{ id: "a" }], []);
  assert.equal(executions.filter(item => item.kind === "traversal").length, 8);
  assert.equal(executions.filter(item => item.kind === "repair").length, 5);
  assert.ok(executions.filter(item => item.kind === "repair").every(item => item.status === "dry_run" && item.mutations === 0));
});

test("recommendations gain reasons, context and concrete steps", () => {
  const enriched = enrichRecommendation({ category: "fragile_claim", action: "Tester", nodeId: "a", path: ["A", "B"] }, [{ id: "a", nodeTypeLabel: "hypothèse" }]);
  assert.ok(enriched.why);
  assert.ok(enriched.risk);
  assert.match(enriched.context, /2 éléments/);
  assert.ok(enriched.probableCauses.length >= 3);
  assert.ok(enriched.steps.length >= 4);
  assert.ok(enriched.problem);
  assert.ok(enriched.graphPatch);
  assert.ok(enriched.closureCriteria.length >= 2);
});

test("workstreams turn findings into contextualized action areas", () => {
  const health = calculateGraphHealth([], []);
  const report = { categoryCounts: { fragile_claim: 4, unanswered_question: 2, underspecified_solution: 3, consolidation: 1, feedback_loop: 2, causal_gap: 5, observability_gap: 2 }, causalSaturation: { satisfied: 1, mechanisms: 9 }, observability: { measuredStates: 0, states: 4, blindClusters: ["alpha", "beta"] } };
  const workstreams = buildWorkstreams(report, health);
  assert.equal(workstreams.length, 7);
  assert.equal(workstreams[0].id, "completeness");
  assert.match(workstreams[0].problem, /1\/9 mécanismes/);
  assert.ok(workstreams.every(item => item.title && item.problem && item.action && item.icon));
});
