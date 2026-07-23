import test from "node:test";
import assert from "node:assert/strict";
import { analyzeGraph } from "../public/graph-analysis.js";
import { buildGapProposals, buildObservableScaffold, groupProposals } from "../src/gap-proposals.js";

const blindCluster = () => ({
  nodes: [
    { id: "mech-a", name: "Mécanisme A", nodeType: "mechanism", clusterId: "alpha" },
    { id: "mech-b", name: "Mécanisme B", nodeType: "mechanism", clusterId: "alpha" },
    { id: "other", name: "Autre", nodeType: "institution", clusterId: "alpha" }
  ],
  links: [
    { source: "mech-a", target: "mech-b", type: "FEEDS" },
    { source: "mech-b", target: "other", type: "IMPLEMENTS" }
  ]
});

const measuredCluster = () => ({
  nodes: [
    { id: "mech-c", name: "Mécanisme C", nodeType: "mechanism", clusterId: "beta" },
    { id: "state-c", name: "État C", nodeType: "system_state", clusterId: "beta", stateOrientation: "desirable", stateIndicator: "part de la population couverte" },
    { id: "metric-c", name: "Métrique C", nodeType: "metric", clusterId: "beta" }
  ],
  links: [
    { source: "state-c", target: "metric-c", type: "MEASURED_BY" },
    { source: "mech-c", target: "state-c", type: "CAUSES", effectSizePct: 12, confidenceScore: .3, evidenceBasis: "assertion" }
  ]
});

test("un périmètre sans état ni métrique est signalé comme lacune d’observabilité", () => {
  const { nodes, links } = blindCluster();
  const report = analyzeGraph(nodes, links);
  const gaps = report.findings.filter(item => item.category === "observability_gap");
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].proposal.clusterId, "alpha");
  assert.deepEqual(report.observability.blindClusters, ["alpha"]);
});

test("un mécanisme d’un périmètre aveugle est diagnostiqué effect_unobservable, pas effect_unencoded", () => {
  const { nodes, links } = blindCluster();
  const report = analyzeGraph(nodes, links);
  const gap = report.findings.find(item => item.category === "causal_gap" && item.nodeId === "mech-a");
  assert.equal(gap.metrics.find(entry => entry.label === "Lacune").value, "effect_unobservable");
  assert.equal(gap.proposal.kind, "create_observable");
});

test("la chaîne d’ancrage complète ne produit ni lacune d’observabilité ni arête non chiffrée", () => {
  const { nodes, links } = measuredCluster();
  const report = analyzeGraph(nodes, links);
  assert.equal(report.findings.filter(item => item.category === "observability_gap").length, 0);
  assert.equal(report.findings.filter(item => item.category === "unmeasured_state").length, 0);
  assert.equal(report.findings.filter(item => item.category === "orphan_metric").length, 0);
  assert.equal(report.findings.filter(item => item.category === "unquantified_causal").length, 0);
  assert.equal(report.observability.stateRatio, 1);
  assert.equal(report.observability.metricRatio, 1);
});

test("une arête causale sans les trois champs est signalée, avec la mesurabilité de sa cible", () => {
  const nodes = [
    { id: "mech", name: "Mécanisme", nodeType: "mechanism" },
    { id: "state", name: "État", nodeType: "system_state" },
    { id: "metric", name: "Métrique", nodeType: "metric" }
  ];
  const links = [
    { source: "state", target: "metric", type: "MEASURED_BY" },
    { source: "mech", target: "state", type: "CAUSES" }
  ];
  const report = analyzeGraph(nodes, links);
  const finding = report.findings.find(item => item.category === "unquantified_causal");
  assert.equal(finding.metrics.find(entry => entry.label === "Cible mesurable").value, "oui");
  assert.deepEqual(finding.proposal.missing, ["effectSizePct", "confidenceScore", "evidenceBasis"]);
});

test("CAUSES vers un effet recherché et LEADS_TO entre capacités sont signalés comme mal typés", () => {
  const nodes = [
    { id: "mech", name: "Mécanisme", nodeType: "mechanism" },
    { id: "effect", name: "Effet visé", nodeType: "design_effect" },
    { id: "unlock-a", name: "Capacité A", nodeType: "unlock" },
    { id: "horizon-a", name: "Horizon A", nodeType: "horizon" }
  ];
  const links = [
    { source: "mech", target: "effect", type: "CAUSES" },
    { source: "unlock-a", target: "horizon-a", type: "LEADS_TO" }
  ];
  const report = analyzeGraph(nodes, links);
  const mistyped = report.findings.filter(item => item.category === "mistyped_causal");
  assert.equal(mistyped.length, 2);
  assert.deepEqual(
    mistyped.map(item => item.proposal.suggestedPredicate).sort(),
    ["MOTIVATES", "UNLOCKS"]
  );
});

test("les lacunes sont regroupées par nature puis par périmètre, jamais une tâche par finding", () => {
  const nodes = [
    { id: "state-1", name: "État 1", nodeType: "system_state", clusterId: "gamma", stateIndicator: "a" },
    { id: "state-2", name: "État 2", nodeType: "system_state", clusterId: "gamma", stateIndicator: "b" },
    { id: "state-3", name: "État 3", nodeType: "system_state", clusterId: "delta", stateIndicator: "c" }
  ];
  const report = analyzeGraph(nodes, []);
  const groups = groupProposals(report.findings).filter(group => group.kind === "link_state_metric");
  assert.deepEqual(groups.map(group => [group.clusterId, group.findings.length]), [["delta", 1], ["gamma", 2]]);
});

test("les candidats générés restent proposés et soumis à revue", () => {
  const { nodes, links } = blindCluster();
  const report = analyzeGraph(nodes, links);
  const proposals = buildGapProposals(report, { nodes: [], links: [] }, { today: "2026-07-22" });
  assert.ok(proposals.nodes.length > 0);
  for (const node of proposals.nodes) {
    assert.equal(node.workStatus, "proposed");
    assert.equal(node.autonomyMode, "review_required");
    assert.equal(node.updatedAt, "2026-07-22");
    assert.ok(node.priority >= 0 && node.priority <= 100);
  }
  for (const task of proposals.nodes.filter(node => node.nodeType === "task")) {
    assert.ok(task.acceptanceCriteria.length >= 3);
    assert.equal(task.verificationCommand, "npm run validate && npm test");
  }
});

test("la génération est idempotente : un candidat déjà présent est signalé, pas dupliqué", () => {
  const { nodes, links } = blindCluster();
  const report = analyzeGraph(nodes, links);
  const first = buildGapProposals(report, { nodes: [], links: [] }, { today: "2026-07-22" });
  const second = buildGapProposals(report, { nodes: first.nodes, links: first.links }, { today: "2026-07-22" });
  assert.equal(second.nodes.length, 0);
  assert.equal(second.links.length, 0);
  assert.equal(second.skipped.length, first.nodes.length);
});

test("les tâches ne ciblent que des nœuds réellement présents dans le corpus", () => {
  const { nodes, links } = blindCluster();
  const report = analyzeGraph(nodes, links);
  const proposals = buildGapProposals(report, { nodes: [], links: [] }, {
    today: "2026-07-22",
    knownNodeIds: nodes.map(node => node.id)
  });
  const known = new Set(nodes.map(node => node.id));
  const generated = new Set(proposals.nodes.map(node => node.id));
  for (const link of proposals.links.filter(item => item.type === "TARGETS")) {
    assert.ok(known.has(link.target), `cible inconnue ${link.target}`);
    assert.ok(generated.has(link.source), `source non générée ${link.source}`);
  }
});

test("l’ébauche d’observables porte des marqueurs TODO explicites et n’est jamais prête à seeder", () => {
  const { nodes, links } = blindCluster();
  const report = analyzeGraph(nodes, links);
  const scaffold = buildObservableScaffold(report, { today: "2026-07-22" });
  assert.ok(scaffold.nodes.length >= 2);
  assert.ok(scaffold.warning.includes("TODO"));
  for (const node of scaffold.nodes) {
    assert.ok(JSON.stringify(node).includes("TODO"), `${node.id} devrait porter un marqueur TODO`);
  }
  const orientations = scaffold.nodes.filter(node => node.nodeType === "system_state").map(node => node.stateOrientation);
  assert.ok(orientations.includes("desirable") && orientations.includes("undesirable"));
});

test("une date explicite est exigée pour garder la génération déterministe", () => {
  const report = analyzeGraph([], []);
  assert.throws(() => buildGapProposals(report, { nodes: [], links: [] }, {}), /today/);
  assert.throws(() => buildObservableScaffold(report, {}), /today/);
});
