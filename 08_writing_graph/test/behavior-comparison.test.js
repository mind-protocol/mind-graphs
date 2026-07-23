import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { runBehaviorComparison } from "../src/simulation/behavior-comparison.js";

const base = JSON.parse(await fs.readFile(new URL("../simulation/default-config.json", import.meta.url), "utf8"));
const spec = JSON.parse(await fs.readFile(new URL("../simulation/behavior-profiles.json", import.meta.url), "utf8"));

test("three documented behavior profiles share seed, population and shocks", () => {
  const result = runBehaviorComparison({ ...base, population: 300, days: 14 }, spec);
  assert.equal(result.profiles.length, 3);
  assert.ok(result.profiles.every(profile => profile.assumptions && profile.parameters));
  assert.equal(result.metadata.seed, base.seed);
  assert.equal(result.metadata.population, 300);
  assert.equal(result.metadata.days, 14);
  assert.equal(result.metadata.comparablePopulationAndShocks, true);
  assert.equal(result.metadata.evidenceBasis, "simulation");
  assert.equal(result.summary.thresholdEvaluation, "not_evaluable_without_calibration_and_preregistered_threshold");
});

test("behavior comparison is deterministic and reports ranking stability", () => {
  const config = { ...base, population: 300, days: 14 };
  const first = runBehaviorComparison(config, spec);
  const second = runBehaviorComparison(config, spec);
  delete first.metadata.generatedAt;
  delete second.metadata.generatedAt;
  assert.deepEqual(first, second);
  assert.equal(first.stability.length, spec.metrics.length);
  assert.ok(first.stability.every(item => typeof item.stable === "boolean" && item.rankings.length === 3));
  const merchant = first.stability.find(item => item.metric === "merchantSurvivalRate");
  assert.ok(merchant.rankings.every(item => item.signature.includes(" = ")));
});

test("double fault, fixed-preference permutation and between-seed self-consistency are measurable", () => {
  const result = runBehaviorComparison({ ...base, population: 300, days: 14 }, spec);
  assert.equal(result.metricDefinitions.doubleFaultRate.unit, "proportion_of_synthetic_people");
  assert.equal(result.metricDefinitions.fixedPreferenceModelSwapVariance.unit, "coverage_rate_squared");
  assert.equal(result.metricDefinitions.armSelfConsistencyVariance.unit, "coverage_rate_squared");
  assert.deepEqual(result.metricDefinitions.armSelfConsistencyVariance.seeds, [base.seed, base.seed + 1, base.seed + 2]);
  for (const profile of result.profiles) {
    assert.equal(profile.doubleFault.length, 3);
    assert.ok(profile.doubleFault.every(item => item.value >= 0 && item.value <= 1 && item.cases === 300));
    assert.equal(profile.fixedPreferencePermutation.pairwise.length, 3);
    assert.ok(profile.fixedPreferencePermutation.value >= 0);
    assert.equal(profile.selfConsistency.length, 3);
    assert.ok(profile.selfConsistency.every(item => item.value >= 0 && item.values.length === 3));
  }
});

test("invalid or incomplete behavior profiles are rejected", () => {
  assert.throws(() => runBehaviorComparison({ ...base, population: 300, days: 14 }, { ...spec, profiles: spec.profiles.slice(0, 2) }), /At least three/);
  const invalid = structuredClone(spec);
  invalid.profiles[0].parameters.spendPropensity = 0;
  assert.throws(() => runBehaviorComparison({ ...base, population: 300, days: 14 }, invalid), /spendPropensity/);
  assert.throws(() => runBehaviorComparison({ ...base, population: 300, days: 14 }, { ...spec, protocol: { seedOffsets: [0, 0] } }), /seedOffsets/);
});
