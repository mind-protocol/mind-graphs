// Observe un journal append-only de ticks integres et simule leurs effets.
// Ce processus n'importe aucune fonction d'ecriture Falkor : il lit le L1,
// puis n'ecrit que l'etat shadow local.
import fs from "node:fs/promises";
import path from "node:path";
import { getClient, getL1Graph } from "../src/db.js";
import { projectDir } from "../src/graph-manifest.js";
import { readFalkorSubentityState } from "../src/l1-subentity-falkor.js";
import { parseShadowEventLog, processShadowEventBatch } from "../src/l1-shadow-scheduler.js";
import { readL1ShadowState, writeL1ShadowStateAtomic } from "../src/l1-shadow-runtime.js";

const args = process.argv.slice(2);
const valueOf = (name, fallback) => args.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const watch = args.includes("--watch");
const once = args.includes("--once");
if (watch === once) throw new Error("Choose exactly one mode: --once or --watch.");
const periodMs = Number(valueOf("period-ms", "5000"));
const maxEvents = Number(valueOf("max-events", "1000"));
if (!Number.isFinite(periodMs) || periodMs < 250) throw new Error("--period-ms must be at least 250.");
if (!Number.isInteger(maxEvents) || maxEvents < 1) throw new Error("--max-events must be a positive integer.");
const eventsPath = path.resolve(projectDir, valueOf("events", "artifacts/l1/integrated-events.jsonl"));
const statePath = path.resolve(projectDir, valueOf("state", "artifacts/l1/subentity-shadow-state.json"));
const graph = await getL1Graph();
let running = false;

async function cycle() {
  if (running) return { status: "busy" };
  running = true;
  try {
    const raw = await fs.readFile(eventsPath, "utf8").catch(error => error.code === "ENOENT" ? "" : Promise.reject(error));
    const parsed = parseShadowEventLog(raw);
    const [shadowState, authoritative] = await Promise.all([readL1ShadowState(statePath), readFalkorSubentityState(graph)]);
    const batch = processShadowEventBatch({ shadowState, authoritativeState: authoritative.state, events: parsed.events, maxEvents });
    if (batch.applied > 0) await writeL1ShadowStateAtomic(statePath, batch.state);
    const report = { status: "observed", scanned: batch.scanned, simulated: batch.applied, alreadyProcessed: batch.skipped, invalidLines: parsed.errors, shadowRevision: batch.state.revision, authoritativeRevision: authoritative.revision };
    console.log(JSON.stringify(report));
    return report;
  } finally {
    running = false;
  }
}

if (once) {
  try { await cycle(); } finally { await (await getClient()).close(); }
} else {
  await cycle();
  const timer = setInterval(() => cycle().catch(error => console.error(error)), periodMs);
  const shutdown = async () => {
    clearInterval(timer);
    await (await getClient()).close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
