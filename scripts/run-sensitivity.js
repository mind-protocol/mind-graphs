import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSensitivity } from "../src/simulation/sensitivity.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const [key, ...rest] = value.replace(/^--/, "").split("=");
  return [key, rest.join("=") || true];
}));
const config = JSON.parse(await fs.readFile(path.resolve(root, String(args.config || "simulation/default-config.json")), "utf8"));
const spec = JSON.parse(await fs.readFile(path.resolve(root, String(args.sensitivity || "simulation/sensitivity-config.json")), "utf8"));
if (args.population) config.population = Number(args.population);
if (args.days) config.days = Number(args.days);
if (args.seed) config.seed = Number(args.seed);

const result = runSensitivity(config, spec);
const outputPath = path.resolve(root, String(args.output || "artifacts/simulation/sensitivity-latest.json"));
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  output: path.relative(root, outputPath),
  modelVersion: result.metadata.modelVersion,
  population: result.metadata.population,
  days: result.metadata.days,
  baselineRanking: result.baseline.ranking,
  casesRun: result.summary.casesRun,
  parametersChangingRanking: result.summary.parametersChangingRanking,
  parameters: result.parameters.map(parameter => ({
    path: parameter.path,
    changesRanking: parameter.changesRanking,
    rankingVariants: parameter.rankingVariants
  }))
}, null, 2));
