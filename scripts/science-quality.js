import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateIngestionQuality } from "../src/science-ingestion-quality.js";
import { loadScienceCandidate } from "../src/science-candidate.js";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidatePath = process.argv.find(arg => arg.startsWith("--candidate="))?.split("=")[1]
  || "science/staging/satopaa-2014-information-diversity.json";
const outputPath = process.argv.find(arg => arg.startsWith("--output="))?.split("=")[1]
  || "artifacts/science/satopaa-ingestion-quality.json";
const candidate = await loadScienceCandidate(projectDir, candidatePath);
const report = await evaluateIngestionQuality(candidate, projectDir);
const target = path.resolve(projectDir, outputPath);
await fs.mkdir(path.dirname(target), { recursive: true });
await fs.writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`Ingestion quality: ${report.status} · readiness ${report.overallReadinessScore} (minimum ${report.minimumOverall})`);
for (const [dimension, score] of Object.entries(report.scores)) console.log(`- ${dimension}: ${score}`);
for (const failure of report.failedFloors) console.log(`  FAIL ${failure.dimension}: ${failure.score} < ${failure.floor}`);
console.log(`Report: ${path.relative(projectDir, target)}`);

if (process.argv.includes("--require-ready") && !report.ready) process.exitCode = 2;
