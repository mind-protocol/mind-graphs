import test from "node:test";
import assert from "node:assert/strict";
import { analyzeGraph } from "../public/graph-analysis.js";
import { semanticTypeOf } from "../public/node-semantics.js";

test("L4 roles stay physical while open semantic types drive the causal audit", () => {
  const nodes = [
    { id: "mechanism", name: "Mécanisme", nodeType: "narrative", semanticType: "mechanism", clusterId: "alpha" },
    { id: "state", name: "État", nodeType: "narrative", semanticType: "system_state", stateOrientation: "desirable", clusterId: "alpha" },
    { id: "metric", name: "Métrique", nodeType: "thing", semanticType: "metric", clusterId: "alpha" }
  ];
  const links = [
    { source: "mechanism", target: "state", type: "CAUSES", effectSizePct: 1, confidenceScore: .2, evidenceBasis: "argumented_assertion" },
    { source: "state", target: "metric", type: "MEASURED_BY" }
  ];
  const report = analyzeGraph(nodes, links);
  assert.equal(report.causalSaturation.mechanisms, 1);
  assert.equal(report.causalSaturation.satisfied, 1);
  assert.equal(report.observability.states, 1);
  assert.equal(report.observability.measuredStates, 1);
  assert.equal(report.observability.metrics, 1);
  assert.equal(report.observability.anchoredMetrics, 1);
  assert.equal(semanticTypeOf({ nodeType: "thing", semanticType: "domain_specific_free_label" }), "domain_specific_free_label");
});

test("a fully qualified causal link is not reported as fragile", () => {
  const nodes = [
    { id: "hypothesis", name: "Hypothèse", nodeType: "working_hypothesis" },
    { id: "state", name: "État", nodeType: "system_state", stateOrientation: "désirable" },
    { id: "evidence", name: "Observation", nodeType: "observation", populationOrSystem: "pilot" }
  ];
  const links = [
    { source: "hypothesis", target: "state", type: "CAUSES", causalClaim: true, quantificationStatus: "model_estimate", contextId: "pilot", supportingNodes: ["evidence"] },
    { source: "evidence", target: "state", type: "SUPPORTS_ESTIMATE" }
  ];
  const report = analyzeGraph(nodes, links);
  assert.equal(report.findings.filter(item => item.category === "fragile_claim").length, 0);
});

test("provenance or rationale counts as justification for a design solution", () => {
  const nodes = [
    { id: "problem", name: "Problème", nodeType: "design_rationale" },
    { id: "solution", name: "Solution", nodeType: "mechanism" },
    { id: "test", name: "Test", nodeType: "working_hypothesis" },
    { id: "implementation", name: "Implémentation", nodeType: "protocol" },
    { id: "document", name: "Document", nodeType: "source_document" }
  ];
  const links = [
    { source: "problem", target: "solution", type: "MOTIVATES" },
    { source: "test", target: "solution", type: "TESTS" },
    { source: "solution", target: "implementation", type: "IMPLEMENTS" },
    { source: "solution", target: "document", type: "DERIVED_FROM" }
  ];
  const report = analyzeGraph(nodes, links);
  assert.equal(report.findings.filter(item => item.category === "underspecified_solution" && item.nodeId === "solution").length, 0);
});

test("answering an open question counts as specification of a candidate solution", () => {
  const nodes = [
    { id: "question", name: "Question", nodeType: "open_question" },
    { id: "solution", name: "Réponse candidate", nodeType: "mechanism" },
    { id: "test", name: "Test", nodeType: "experiment" },
    { id: "document", name: "Rapport", nodeType: "source_document" }
  ];
  const links = [
    { source: "solution", target: "question", type: "ADDRESSES" },
    { source: "test", target: "solution", type: "TESTS" },
    { source: "solution", target: "document", type: "DERIVED_FROM" }
  ];
  const report = analyzeGraph(nodes, links);
  assert.equal(report.findings.filter(item => item.category === "underspecified_solution" && item.nodeId === "solution").length, 0);
});

test("a specified solution blocked by a question receives a non-empty action", () => {
  const nodes = [
    { id: "question", name: "Question", nodeType: "narrative", semanticType: "open_question" },
    { id: "solution", name: "Solution", nodeType: "narrative", semanticType: "mechanism" },
    { id: "test", name: "Test", nodeType: "moment", semanticType: "experiment" },
    { id: "reason", name: "Raison", nodeType: "narrative", semanticType: "design_rationale" },
    { id: "implementation", name: "Implémentation", nodeType: "thing", semanticType: "protocol" }
  ];
  const report = analyzeGraph(nodes, [
    { source: "question", target: "solution", type: "BLOCKS" },
    { source: "test", target: "solution", type: "TESTS" },
    { source: "reason", target: "solution", type: "MOTIVATES" },
    { source: "solution", target: "implementation", type: "IMPLEMENTS" }
  ]);
  const finding = report.findings.find(item => item.category === "underspecified_solution" && item.nodeId === "solution");
  assert.match(finding.action, /Traiter les questions bloquantes/);
  assert.doesNotMatch(finding.action, /Ajouter\s*,/);
});

test("a fully qualified scenario loop asks for calibration instead of missing metadata", () => {
  const nodes = [
    { id: "a", name: "A", nodeType: "forecast_event" },
    { id: "b", name: "B", nodeType: "forecast_event" }
  ];
  const metadata = { type: "AFFECTS_SCENARIO", causalClaim: true, forecastPolarity: "mixte", forecastDelay: "1–3 ans", forecastStrength: 3 };
  const report = analyzeGraph(nodes, [
    { ...metadata, source: "a", target: "b" },
    { ...metadata, source: "b", target: "a" }
  ]);
  const loop = report.findings.find(item => item.category === "feedback_loop");
  assert.equal(loop.metrics.find(item => item.label === "Qualification").value, "100 %");
  assert.match(loop.action, /Tester les gains et délais/);
});

test("evidence leverage distinguishes a planned protocol from an observed result", () => {
  const nodes = [
    { id: "cause", name: "Cause", nodeType: "forecast_event" },
    { id: "target", name: "Cible", nodeType: "forecast_event" },
    { id: "protocol", name: "Protocole", nodeType: "experiment" }
  ];
  const report = analyzeGraph(nodes, [
    { source: "cause", target: "target", type: "AFFECTS_SCENARIO", causalClaim: true },
    { source: "protocol", target: "target", type: "TESTS" }
  ]);
  const leverage = report.findings.find(item => item.category === "evidence_leverage" && item.nodeId === "target");
  assert.equal(leverage.metrics.find(item => item.label === "Protocoles planifiés").value, "1");
  assert.match(leverage.diagnosis, /aucun résultat SUPPORTS_ESTIMATE/);
  assert.match(leverage.action, /Exécuter le protocole préenregistré/);
});

test("a fragile causal claim exposes its planned test without treating it as proof", () => {
  const nodes = [
    { id: "cause", name: "Cause", nodeType: "working_hypothesis" },
    { id: "target", name: "Cible", nodeType: "system_state" },
    { id: "protocol", name: "Protocole", nodeType: "experiment" }
  ];
  const report = analyzeGraph(nodes, [
    { source: "cause", target: "target", type: "CAUSES", causalClaim: true, contextId: "pilot" },
    { source: "protocol", target: "target", type: "TESTS" }
  ]);
  const claim = report.findings.find(item => item.category === "fragile_claim");
  assert.equal(claim.metrics.find(item => item.label === "Protocoles planifiés").value, "1");
  assert.match(claim.diagnosis, /non exécutés/);
  assert.match(claim.action, /avant SUPPORTS_ESTIMATE/);
});
