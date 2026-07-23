import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSimulation } from "../src/simulation/model.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const [key, ...rest] = value.replace(/^--/, "").split("=");
  return [key, rest.join("=") || true];
}));
const configPath = path.resolve(root, String(args.config || "simulation/default-config.json"));
const config = JSON.parse(await fs.readFile(configPath, "utf8"));
if (args.population) config.population = Number(args.population);
if (args.days) config.days = Number(args.days);
if (args.seed) config.seed = Number(args.seed);

const result = runSimulation(config);
const outputPath = path.resolve(root, String(args.output || "artifacts/simulation/latest.json"));
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  output: path.relative(root, outputPath),
  modelVersion: result.metadata.modelVersion,
  population: result.metadata.population,
  days: result.metadata.days,
  arms: result.arms.map(({ arm, metrics }) => ({
    arm,
    coverageRate: metrics.coverageRate,
    unmetNeedPersonDays: metrics.unmetNeedPersonDays,
    merchantSurvivalRate: metrics.merchantSurvivalRate,
    exclusionRate: metrics.exclusionRate,
    stockoutDays: metrics.stockoutDays
  }))
}, null, 2));
