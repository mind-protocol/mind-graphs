// Exécute un tick de cycle de vie L1 depuis une entrée JSON auditée.
// Exemple : node scripts/l1-subentity-tick.js --input=artifacts/l1/tick.json
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applySubentityLifecycleTick } from "../src/l1-subentity-runtime.js";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const valueOf = name => process.argv.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const inputArgument = valueOf("input");
if (!inputArgument) throw new Error("Usage: node scripts/l1-subentity-tick.js --input=<tick.json> [--state=<state.json>] [--dry-run]");

const inputPath = path.resolve(projectDir, inputArgument);
const statePath = path.resolve(projectDir, valueOf("state") || "artifacts/l1/subentity-runtime-state.json");
const input = JSON.parse(await fs.readFile(inputPath, "utf8"));
const result = await applySubentityLifecycleTick({ statePath, input, dryRun: process.argv.includes("--dry-run") });
console.log(JSON.stringify({ ...result.report, persisted: result.persisted, statePath }, null, 2));
