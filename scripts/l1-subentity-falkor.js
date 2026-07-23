// Applique un tick au graphe personnel L1 ou repare sa projection runtime.
// La cible est fixee par FALKORDB_L1_GRAPH (defaut l1_nlr_graph), jamais par
// FALKORDB_GRAPH afin d'eviter une ecriture accidentelle dans le graphe design.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getClient, getL1Graph } from "../src/db.js";
import { applyFalkorSubentityLifecycleTick, repairFalkorSubentityProjection } from "../src/l1-subentity-falkor.js";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const valueOf = name => process.argv.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const repair = process.argv.includes("--repair");
const inputArgument = valueOf("input");
if (!repair && !inputArgument) throw new Error("Usage: node scripts/l1-subentity-falkor.js --input=<tick.json> | --repair");

const graph = await getL1Graph();
try {
  if (repair) {
    console.log(JSON.stringify(await repairFalkorSubentityProjection(graph), null, 2));
  } else {
    const input = JSON.parse(await fs.readFile(path.resolve(projectDir, inputArgument), "utf8"));
    const result = await applyFalkorSubentityLifecycleTick({ graph, input });
    console.log(JSON.stringify({ ...result.report, persisted: result.persisted, projectionStatus: result.projectionStatus, attempts: result.attempts }, null, 2));
  }
} finally {
  await (await getClient()).close();
}
