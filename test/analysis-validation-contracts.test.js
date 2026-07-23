import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const contracts = JSON.parse(await readFile(new URL("../data/analysis-validation-contracts.json", import.meta.url), "utf8"));

test("every remediation experiment has a falsifiable operational contract", () => {
  const experiments = contracts.nodes.filter(node => (node.semanticType || node.nodeType) === "experiment");
  assert.equal(experiments.length, 5);
  for (const experiment of experiments) {
    assert.ok(experiment.testObjective);
    assert.ok(experiment.methodSummary);
    assert.ok(experiment.failureCondition);
    assert.ok(experiment.minimumSample);
    assert.ok(experiment.metricIds.length >= 2);
    assert.equal(experiment.responseStatus, "planned_not_run");
    assert.ok(contracts.links.some(link => link.source === experiment.id && link.type === "USES_METHOD"));
    assert.ok(contracts.links.some(link => link.source === experiment.id && link.type === "MEASURES"));
  }
});

test("the thirteen low-priority remediation gaps receive an explicit test", () => {
  const expectedTargets = new Set([
    "response-csg-phased-migration", "response-democracy-manipulation-controls",
    "response-child-autonomy-safeguards", "response-postwork-social-transition",
    "response-trust-circuit-breakers", "response-wallet-recovery-mpc",
    "response-sybil-private-personhood", "response-upgrade-constitution",
    "response-merchant-settlement-model", "response-convertibility-gated-bridge",
    "response-future-needs-reserves", "response-wellbeing-constitutional-objectives",
    "response-offline-risk-budgets"
  ]);
  const actualTargets = new Set(contracts.links.filter(link => link.type === "TESTS").map(link => link.target));
  for (const target of expectedTargets) assert.ok(actualTargets.has(target), `missing remediation test for ${target}`);
});

test("every validation relation explains why it exists", () => {
  assert.ok(contracts.links.every(link => link.justification?.trim()));
});
