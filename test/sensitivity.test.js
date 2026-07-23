import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { runSensitivity } from "../src/simulation/sensitivity.js";

const base = JSON.parse(await fs.readFile(new URL("../simulation/default-config.json", import.meta.url), "utf8"));
const spec = {
  schemaVersion: "1.0.0",
  primaryMetric: "coverageRate",
  direction: "maximize",
  parameters: [
    { path: "arms.mind.dailyTransfer", values: [0.2, 0.72, 1] },
    { path: "economy.supplyPerPerson", values: [0.8, 1.08] }
  ]
};

test("sensitivity analysis is deterministic apart from generatedAt", () => {
  const config = { ...base, population: 300, days: 14 };
  const first = runSensitivity(config, spec);
  const second = runSensitivity(config, spec);
  delete first.metadata.generatedAt;
  delete second.metadata.generatedAt;
  assert.deepEqual(first, second);
});

test("sensitivity output has bounded metrics and a complete case matrix", () => {
  const result = runSensitivity({ ...base, population: 300, days: 14 }, spec);
  assert.equal(result.summary.parametersTested, 2);
  assert.equal(result.summary.casesRun, 5);
  assert.equal(result.cases.length, 5);
  for (const item of result.cases) {
    assert.equal(item.ranking.length, 3);
    assert.equal(new Set(item.ranking).size, 3);
    for (const value of Object.values(item.values)) assert.ok(value >= 0 && value <= 1);
  }
});

test("invalid sensitivity paths fail before the matrix runs", () => {
  assert.throws(() => runSensitivity({ ...base, population: 300, days: 14 }, {
    ...spec,
    parameters: [{ path: "economy.unknown", values: [1, 2] }]
  }), /not numeric/);
});
