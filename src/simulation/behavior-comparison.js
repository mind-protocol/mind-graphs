import { runSimulation } from "./model.js";

const clone = value => structuredClone(value);

function validateProfile(profile) {
  if (!profile.id || !profile.label || !profile.assumptions || !profile.parameters) throw new Error("Each behavior profile requires id, label, assumptions and parameters");
  const parameters = profile.parameters;
  const checks = [
    ["priceElasticity", 0, 2, false],
    ["spendPropensity", 0, 1, true],
    ["shortageSubstitution", 0, 1, false],
    ["sybilParticipationMultiplier", 0, 3, false]
  ];
  for (const [key, minimum, maximum, exclusiveMinimum] of checks) {
    const value = parameters[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value > maximum || (exclusiveMinimum ? value <= minimum : value < minimum)) {
      throw new Error(`Invalid behavior parameter ${key} for ${profile.id}`);
    }
  }
}

function rank(values, direction) {
  const multiplier = direction === "maximize" ? -1 : 1;
  return Object.entries(values).sort((a, b) => multiplier * (a[1] - b[1]) || a[0].localeCompare(b[0])).map(([arm]) => arm);
}

function rankingSignature(values, direction) {
  const ordered = rank(values, direction);
  const groups = [];
  for (const arm of ordered) {
    const previous = groups.at(-1);
    if (previous && Math.abs(values[previous[0]] - values[arm]) <= 1e-9) previous.push(arm);
    else groups.push([arm]);
  }
  return groups.map(group => group.join(" = ")).join(" > ");
}

function variance(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}

function armPairs(arms) {
  const pairs = [];
  for (let left = 0; left < arms.length; left += 1) {
    for (let right = left + 1; right < arms.length; right += 1) pairs.push([arms[left], arms[right]]);
  }
  return pairs;
}

function diagnosticsByArm(result) {
  return Object.fromEntries(result.arms.map(arm => {
    if (!arm.caseDiagnostics?.coverageRates || !arm.caseDiagnostics?.faults) {
      throw new Error(`Missing case diagnostics for arm: ${arm.arm}`);
    }
    return [arm.arm, arm.caseDiagnostics];
  }));
}

function doubleFaultMetrics(result) {
  const diagnostics = diagnosticsByArm(result);
  return armPairs(Object.keys(diagnostics)).map(([left, right]) => {
    const leftFaults = diagnostics[left].faults;
    const rightFaults = diagnostics[right].faults;
    const sharedFaults = leftFaults.reduce((sum, fault, index) => sum + (fault && rightFaults[index] ? 1 : 0), 0);
    return { arms: [left, right], value: sharedFaults / leftFaults.length, sharedFaults, cases: leftFaults.length };
  });
}

function fixedPreferencePermutation(result) {
  const diagnostics = diagnosticsByArm(result);
  const arms = Object.keys(diagnostics);
  const population = diagnostics[arms[0]].coverageRates.length;
  const pairwise = armPairs(arms).map(([left, right]) => ({
    arms: [left, right],
    value: Array.from({ length: population }, (_, index) => variance([
      diagnostics[left].coverageRates[index],
      diagnostics[right].coverageRates[index]
    ])).reduce((sum, value) => sum + value, 0) / population
  }));
  const perPersonVariance = Array.from({ length: population }, (_, index) =>
    variance(arms.map(arm => diagnostics[arm].coverageRates[index])));
  return {
    arms,
    value: perPersonVariance.reduce((sum, value) => sum + value, 0) / population,
    pairwise
  };
}

function selfConsistencyVariance(results) {
  const arms = results[0].arms.map(arm => arm.arm);
  return arms.map(arm => {
    const values = results.map(result => result.arms.find(item => item.arm === arm).metrics.coverageRate);
    return { arm, value: variance(values), values };
  });
}

export function runBehaviorComparison(baseConfig, spec) {
  if (spec.schemaVersion !== "1.0.0") throw new Error("Behavior comparison schemaVersion must be 1.0.0");
  if (!Array.isArray(spec.profiles) || spec.profiles.length < 3) throw new Error("At least three behavior profiles are required");
  if (new Set(spec.profiles.map(profile => profile.id)).size !== spec.profiles.length) throw new Error("Behavior profile ids must be unique");
  if (!Array.isArray(spec.metrics) || spec.metrics.length === 0) throw new Error("Behavior comparison metrics are required");
  spec.profiles.forEach(validateProfile);
  const seedOffsets = spec.protocol?.seedOffsets || [0, 1, 2];
  if (!Array.isArray(seedOffsets) || seedOffsets.length < 2 || seedOffsets.some(offset => !Number.isInteger(offset)) || new Set(seedOffsets).size !== seedOffsets.length) {
    throw new Error("Behavior comparison protocol.seedOffsets must contain at least two distinct integers");
  }

  const profiles = spec.profiles.map(profile => {
    const config = clone(baseConfig);
    config.behavior = { id: profile.id, ...profile.parameters };
    const seedResults = seedOffsets.map(offset => runSimulation({ ...config, seed: baseConfig.seed + offset }, { includeCaseDiagnostics: offset === seedOffsets[0] }));
    const result = seedResults[0];
    const metrics = Object.fromEntries(spec.metrics.map(metric => {
      const values = Object.fromEntries(result.arms.map(arm => [arm.arm, arm.metrics[metric.id]]));
      if (Object.values(values).some(value => typeof value !== "number" || !Number.isFinite(value))) throw new Error(`Unknown numeric arm metric: ${metric.id}`);
      return [metric.id, { values, ranking: rank(values, metric.direction), rankingSignature: rankingSignature(values, metric.direction) }];
    }));
    return {
      id: profile.id,
      label: profile.label,
      assumptions: profile.assumptions,
      parameters: profile.parameters,
      metrics,
      doubleFault: doubleFaultMetrics(result),
      fixedPreferencePermutation: fixedPreferencePermutation(result),
      selfConsistency: selfConsistencyVariance(seedResults)
    };
  });

  const stability = spec.metrics.map(metric => {
    const rankings = profiles.map(profile => ({
      profile: profile.id,
      ranking: profile.metrics[metric.id].ranking,
      signature: profile.metrics[metric.id].rankingSignature
    }));
    const variants = [...new Set(profiles.map(profile => profile.metrics[metric.id].rankingSignature))];
    return { metric: metric.id, direction: metric.direction, stable: variants.length === 1, rankingVariants: variants, rankings };
  });

  return {
    metadata: {
      modelVersion: "0.4.0-p4-deliberation-variance",
      generatedAt: new Date().toISOString(),
      status: "exploratory_behavior_comparison_not_empirical_evidence",
      seed: baseConfig.seed,
      population: baseConfig.population,
      days: baseConfig.days,
      comparablePopulationAndShocks: true,
      evidenceBasis: "simulation",
      warnings: [
        "Behavior profiles are explicit scenarios, not calibrated population estimates.",
        "Each profile bundles assumptions; differences cannot be attributed to one parameter alone.",
        "Stable rankings within these profiles do not establish real-world robustness.",
        "Double-fault and variance outputs are exploratory until the synthetic population is calibrated.",
        "No effect size or decision threshold is inferred from these simulation runs."
      ]
    },
    metricDefinitions: {
      doubleFaultRate: {
        name: "double_fault_rate",
        unit: "proportion_of_synthetic_people",
        method: "For each arm pair, count synthetic people whose cumulative need coverage is below 0.8 in both arms, then divide by the shared population size."
      },
      fixedPreferenceModelSwapVariance: {
        name: "fixed_preference_model_swap_variance",
        unit: "coverage_rate_squared",
        method: "Hold each synthetic person's generated needs and preferences fixed, swap the three simulation arms, compute the population variance of that person's cumulative coverage rates, then average across people."
      },
      armSelfConsistencyVariance: {
        name: "arm_self_consistency_variance_between_seeds",
        unit: "coverage_rate_squared",
        method: "For each arm under one behavior profile, rerun the simulation with the declared random seeds and compute the population variance of aggregate coverageRate between seeds.",
        seeds: seedOffsets.map(offset => baseConfig.seed + offset)
      }
    },
    summary: {
      profilesRun: profiles.length,
      metricsCompared: stability.length,
      stableMetrics: stability.filter(item => item.stable).map(item => item.metric),
      unstableMetrics: stability.filter(item => !item.stable).map(item => item.metric),
      thresholdEvaluation: "not_evaluable_without_calibration_and_preregistered_threshold"
    },
    stability,
    profiles
  };
}
