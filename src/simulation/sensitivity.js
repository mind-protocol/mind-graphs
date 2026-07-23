import { runSimulation } from "./model.js";

const clone = value => structuredClone(value);
const round = (value, digits = 6) => Number(value.toFixed(digits));

function valueAt(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function setValueAt(object, path, value) {
  const keys = path.split(".");
  const finalKey = keys.pop();
  const parent = keys.reduce((current, key) => current?.[key], object);
  if (!parent || !(finalKey in parent)) throw new Error(`Unknown sensitivity path: ${path}`);
  parent[finalKey] = value;
}

function validateSpec(config, spec) {
  if (spec.schemaVersion !== "1.0.0") throw new Error("Sensitivity schemaVersion must be 1.0.0");
  if (!spec.primaryMetric) throw new Error("Sensitivity primaryMetric is required");
  if (!["maximize", "minimize"].includes(spec.direction)) throw new Error("Sensitivity direction must be maximize or minimize");
  if (!Array.isArray(spec.parameters) || spec.parameters.length === 0) throw new Error("Sensitivity parameters are required");
  for (const parameter of spec.parameters) {
    if (!parameter.path || !Array.isArray(parameter.values) || parameter.values.length < 2) throw new Error("Each sensitivity parameter needs a path and at least two values");
    if (typeof valueAt(config, parameter.path) !== "number") throw new Error(`Sensitivity path is not numeric: ${parameter.path}`);
    if (parameter.values.some(value => typeof value !== "number" || !Number.isFinite(value))) throw new Error(`Sensitivity values must be finite numbers: ${parameter.path}`);
  }
}

function metricSnapshot(result, metric) {
  return Object.fromEntries(result.arms.map(arm => {
    const value = arm.metrics[metric];
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Unknown numeric arm metric: ${metric}`);
    return [arm.arm, value];
  }));
}

function ranking(values, direction) {
  const multiplier = direction === "maximize" ? -1 : 1;
  return Object.entries(values)
    .sort((a, b) => multiplier * (a[1] - b[1]) || a[0].localeCompare(b[0]))
    .map(([arm]) => arm);
}

function pairwiseOrder(rank) {
  const order = new Map(rank.map((arm, index) => [arm, index]));
  const pairs = [];
  for (let left = 0; left < rank.length; left += 1) {
    for (let right = left + 1; right < rank.length; right += 1) pairs.push(`${rank[left]}>${rank[right]}`);
  }
  return { order, pairs };
}

function changedPairs(baselineRanking, candidateRanking) {
  const baseline = pairwiseOrder(baselineRanking).order;
  const candidate = pairwiseOrder(candidateRanking).order;
  const arms = [...baseline.keys()];
  const changed = [];
  for (let left = 0; left < arms.length; left += 1) {
    for (let right = left + 1; right < arms.length; right += 1) {
      const a = arms[left];
      const b = arms[right];
      if (Math.sign(baseline.get(a) - baseline.get(b)) !== Math.sign(candidate.get(a) - candidate.get(b))) changed.push(`${a}/${b}`);
    }
  }
  return changed;
}

export function runSensitivity(baseConfig, spec) {
  validateSpec(baseConfig, spec);
  const baselineResult = runSimulation(baseConfig);
  const baselineValues = metricSnapshot(baselineResult, spec.primaryMetric);
  const baselineRanking = ranking(baselineValues, spec.direction);
  const cases = [];

  for (const parameter of spec.parameters) {
    const baselineValue = valueAt(baseConfig, parameter.path);
    for (const value of parameter.values) {
      const config = clone(baseConfig);
      setValueAt(config, parameter.path, value);
      const result = runSimulation(config);
      const values = metricSnapshot(result, spec.primaryMetric);
      const candidateRanking = ranking(values, spec.direction);
      cases.push({
        parameter: parameter.path,
        label: parameter.label || parameter.path,
        baselineValue,
        value,
        values,
        deltasFromBaseline: Object.fromEntries(Object.keys(values).map(arm => [arm, round(values[arm] - baselineValues[arm])])),
        ranking: candidateRanking,
        rankingChanged: candidateRanking.join(">") !== baselineRanking.join(">"),
        changedPairs: changedPairs(baselineRanking, candidateRanking)
      });
    }
  }

  const parameters = spec.parameters.map(parameter => {
    const parameterCases = cases.filter(item => item.parameter === parameter.path);
    const rankingVariants = [...new Set(parameterCases.map(item => item.ranking.join(" > ")))];
    return {
      path: parameter.path,
      label: parameter.label || parameter.path,
      baselineValue: valueAt(baseConfig, parameter.path),
      testedValues: parameter.values,
      changesRanking: parameterCases.some(item => item.rankingChanged),
      rankingVariants,
      changedPairs: [...new Set(parameterCases.flatMap(item => item.changedPairs))]
    };
  });

  return {
    metadata: {
      modelVersion: "0.2.0-p2-sensitivity",
      generatedAt: new Date().toISOString(),
      status: "exploratory_sensitivity_output_not_empirical_evidence",
      seed: baseConfig.seed,
      population: baseConfig.population,
      days: baseConfig.days,
      method: "one_parameter_at_a_time",
      primaryMetric: spec.primaryMetric,
      direction: spec.direction,
      warnings: [
        "Tested ranges are working assumptions, not empirical uncertainty intervals.",
        "One-at-a-time analysis does not identify interactions between parameters.",
        "A ranking reversal describes this model configuration, not a real-world causal effect."
      ]
    },
    baseline: { values: baselineValues, ranking: baselineRanking },
    summary: {
      parametersTested: parameters.length,
      casesRun: cases.length,
      parametersChangingRanking: parameters.filter(parameter => parameter.changesRanking).map(parameter => parameter.path)
    },
    parameters,
    cases
  };
}
