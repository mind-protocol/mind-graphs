import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { runSimulation, validateSimulationConfig } from "../src/simulation/model.js";

const base = JSON.parse(await fs.readFile(new URL("../simulation/default-config.json", import.meta.url), "utf8"));

test("the simulation is deterministic apart from generatedAt", () => {
  const config = { ...base, population: 500, days: 20 };
  const first = runSimulation(config);
  const second = runSimulation(config);
  assert.deepEqual(first.arms, second.arms);
});

test("all arms share the same horizon and return bounded rates", () => {
  const result = runSimulation({ ...base, population: 500, days: 20 });
  assert.deepEqual(result.arms.map(arm => arm.daily.length), [20, 20, 20]);
  for (const arm of result.arms) {
    assert.ok(arm.metrics.coverageRate >= 0 && arm.metrics.coverageRate <= 1);
    assert.ok(arm.metrics.merchantSurvivalRate >= 0 && arm.metrics.merchantSurvivalRate <= 1);
    assert.ok(arm.metrics.exclusionRate >= 0 && arm.metrics.exclusionRate <= 1);
  }
});

test("invalid configs fail before execution", () => {
  assert.throws(() => validateSimulationConfig({ ...base, population: 10 }), /population/);
  assert.throws(() => validateSimulationConfig({ ...base, arms: { current: base.arms.current } }), /missing arm/);
});
