import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBehaviorComparison } from "../src/simulation/behavior-comparison.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const [key, ...rest] = value.replace(/^--/, "").split("=");
  return [key, rest.join("=") || true];
}));
const config = JSON.parse(await fs.readFile(path.resolve(root, String(args.config || "simulation/default-config.json")), "utf8"));
const profiles = JSON.parse(await fs.readFile(path.resolve(root, String(args.profiles || "simulation/behavior-profiles.json")), "utf8"));
if (args.population) config.population = Number(args.population);
if (args.days) config.days = Number(args.days);
if (args.seed) config.seed = Number(args.seed);

const result = runBehaviorComparison(config, profiles);
const outputPath = path.resolve(root, String(args.output || "artifacts/simulation/behavior-comparison-latest.json"));
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  output: path.relative(root, outputPath),
  modelVersion: result.metadata.modelVersion,
  population: result.metadata.population,
  days: result.metadata.days,
  profiles: result.profiles.map(profile => profile.id),
  stableMetrics: result.summary.stableMetrics,
  unstableMetrics: result.summary.unstableMetrics,
  deliberationMetrics: result.metricDefinitions,
  thresholdEvaluation: result.summary.thresholdEvaluation,
  doubleFault: Object.fromEntries(result.profiles.map(profile => [profile.id, profile.doubleFault])),
  fixedPreferenceModelSwapVariance: Object.fromEntries(result.profiles.map(profile => [profile.id, profile.fixedPreferencePermutation])),
  armSelfConsistencyVariance: Object.fromEntries(result.profiles.map(profile => [profile.id, profile.selfConsistency])),
  rankings: Object.fromEntries(result.stability.map(item => [item.metric, item.rankings]))
}, null, 2));
