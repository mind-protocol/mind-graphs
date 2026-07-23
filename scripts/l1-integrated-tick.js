// Pipeline automatique : signaux sensoriels + affect + workspace -> coalition
// -> cycle des sous-entites. Le backend doit etre explicite pour qu'un exemple
// ne puisse jamais entrer accidentellement dans le L1 souverain.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getClient, getL1Graph } from "../src/db.js";
import { runIntegratedL1Tick, runIntegratedL1UntilStable, applyFalkorIntegratedL1Tick, applyFalkorIntegratedL1UntilStable } from "../src/l1-integrated-runtime.js";
import { readFalkorSubentityState } from "../src/l1-subentity-falkor.js";
import { readSubentityRuntimeState, writeSubentityRuntimeStateAtomic } from "../src/l1-subentity-runtime.js";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const valueOf = name => process.argv.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const inputArgument = valueOf("input");
const backend = valueOf("backend");
const dryRun = process.argv.includes("--dry-run");
const untilStable = process.argv.includes("--until-stable");
if (!inputArgument || !new Set(["file", "falkor"]).has(backend)) {
  throw new Error("Usage: node scripts/l1-integrated-tick.js --input=<signals.json> --backend=file|falkor [--dry-run]");
}

const input = JSON.parse(await fs.readFile(path.resolve(projectDir, inputArgument), "utf8"));
let result;
if (backend === "file") {
  const statePath = path.resolve(projectDir, valueOf("state") || "artifacts/l1/subentity-runtime-state.json");
  const previous = await readSubentityRuntimeState(statePath);
  result = untilStable ? runIntegratedL1UntilStable(previous, input) : runIntegratedL1Tick(previous, input);
  if (!dryRun && result.report.changed) await writeSubentityRuntimeStateAtomic(statePath, result.state);
  result.persisted = !dryRun && result.report.changed;
  result.projectionStatus = "not_applicable";
} else {
  const graph = await getL1Graph();
  try {
    if (dryRun) {
      const current = await readFalkorSubentityState(graph);
      result = untilStable ? runIntegratedL1UntilStable(current.state, input) : runIntegratedL1Tick(current.state, input);
      result.persisted = false;
      result.projectionStatus = current.revision === current.projectionRevision ? "current" : "repair_required";
    } else {
      result = untilStable
        ? await applyFalkorIntegratedL1UntilStable({ graph, input })
        : await applyFalkorIntegratedL1Tick({ graph, input });
    }
  } finally {
    await (await getClient()).close();
  }
}

console.log(JSON.stringify({
  ...result.report,
  detection: result.detection?.observation || null,
  stabilization: result.stabilization || null,
  persisted: result.persisted,
  projectionStatus: result.projectionStatus,
  backend
}, null, 2));
