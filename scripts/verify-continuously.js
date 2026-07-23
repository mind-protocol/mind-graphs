import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadCorpus } from "../src/corpus.js";
import { getClient, getGraphByName } from "../src/db.js";
import { aggregateHealthStatuses, discoverContinuousProbes, executeProbe, healthTasksForPartial, healthThingEnergyEvents, structuralStatuses, syncHealthTasks, writeHealthRuntime } from "../src/continuous-verification.js";

const projectDir = fileURLToPath(new URL("../", import.meta.url));
const packageManifest = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));
const declaredScripts = Object.keys(packageManifest.scripts || {});
const watch = process.argv.includes("--watch");
const intervalSeconds = Number(process.argv.find(arg => arg.startsWith("--interval="))?.split("=")[1] || 60);
const lastProbeRun = new Map();
const thingEnergyLedgerUrl = new URL("../artifacts/l4/thing-energy-ledger.json", import.meta.url);
const l4EventsUrl = new URL("../artifacts/l4/injections.jsonl", import.meta.url);

async function readJson(url, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(url, "utf8"));
  } catch {
    return fallback;
  }
}

async function emitThingEnergy(aggregated, now) {
  const previousLedger = await readJson(thingEnergyLedgerUrl);
  const result = healthThingEnergyEvents(aggregated, previousLedger, now);
  await fs.mkdir(new URL("../artifacts/l4/", import.meta.url), { recursive: true });
  if (result.events.length) {
    await fs.appendFile(l4EventsUrl, `${result.events.map(event => JSON.stringify(event)).join("\n")}\n`, "utf8");
  }
  await fs.writeFile(thingEnergyLedgerUrl, `${JSON.stringify(result.ledger, null, 2)}\n`, "utf8");
  return result.events.length;
}

async function cycle() {
  const now = new Date();
  const corpus = await loadCorpus("design");
  const probes = discoverContinuousProbes(corpus.nodes, corpus.links);
  const dueProbes = probes.filter(probe => !watch || !lastProbeRun.has(probe.id)
    || now.getTime() - lastProbeRun.get(probe.id) >= Number(probe.probeIntervalSeconds || intervalSeconds) * 1000);
  const statuses = structuralStatuses(corpus.nodes, corpus.links, { now, freshnessSeconds: Math.max(180, intervalSeconds * 3) });
  for (const probe of dueProbes) {
    try {
      statuses.push(...await executeProbe(probe, { declaredScripts, cwd: projectDir, now }));
    } catch (error) {
      statuses.push(...(probe.probeTargetIds || []).map(targetId => ({
        id: `${targetId}::${probe.id}`, targetId, probeId: probe.id, dimension: "functional",
        state: "failing", value: 0, checkedAt: now.toISOString(),
        freshUntil: new Date(now.getTime() + Number(probe.probeFreshnessSeconds || 180) * 1000).toISOString(),
        message: error.message
      })));
    }
    lastProbeRun.set(probe.id, now.getTime());
  }
  const graph = await getGraphByName("mind_causal");
  await writeHealthRuntime(graph, statuses, {
    runId: `health-run-${now.toISOString()}`,
    checkedAt: now.toISOString(),
    activeTargetIds: corpus.nodes.map(node => node.id),
    activeProbeIds: ["builtin-structural-contract", ...probes.map(probe => probe.id)]
  });
  const runtimeResult = await graph.roQuery("MATCH (s:HealthStatus) RETURN s.targetId AS targetId, s.dimension AS dimension, s.state AS state, s.checkedAt AS checkedAt, s.freshUntil AS freshUntil, s.message AS message");
  const aggregated = aggregateHealthStatuses(runtimeResult.data, now);
  const tasks = healthTasksForPartial(aggregated, corpus.nodes, now);
  await syncHealthTasks(graph, tasks);
  const thingEnergyInjections = await emitThingEnergy(aggregated, now);
  const counts = statuses.reduce((acc, item) => (acc[item.state] = (acc[item.state] || 0) + 1, acc), {});
  console.log(JSON.stringify({ checkedAt: now.toISOString(), probesDeclared: probes.length, probesRun: dueProbes.length, statuses: statuses.length, counts, generatedTasks: tasks.length, thingEnergyInjections }));
}

await cycle();
if (watch) setInterval(() => cycle().catch(error => console.error(error)), intervalSeconds * 1000);
else await (await getClient()).close();
