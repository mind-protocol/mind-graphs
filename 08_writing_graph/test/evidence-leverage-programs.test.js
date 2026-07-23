import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const data = JSON.parse(await readFile(new URL("../data/evidence-leverage-programs.json", import.meta.url), "utf8"));

test("all seven evidence-leverage targets have a planned protocol", () => {
  const expected = new Set([
    "forecast-social-contract-pressure", "forecast-compute-blocs", "forecast-agent-economy",
    "forecast-cyber-conflict-escalation", "forecast-employment-wave-one",
    "forecast-continuous-health-companion", "forecast-agi-threshold"
  ]);
  const actual = new Set(data.links.filter(link => link.type === "TESTS").map(link => link.target));
  assert.deepEqual(actual, expected);
});

test("research programs declare falsification before results", () => {
  const experiments = data.nodes.filter(node => (node.semanticType || node.nodeType) === "experiment");
  assert.equal(experiments.length, 4);
  for (const experiment of experiments) {
    assert.equal(experiment.responseStatus, "planned_not_run");
    assert.ok(experiment.failureCondition);
    assert.ok(experiment.minimumSample);
    assert.ok(experiment.metricIds.length >= 3);
  }
  assert.equal(data.links.some(link => link.type === "SUPPORTS_ESTIMATE"), false);
});
