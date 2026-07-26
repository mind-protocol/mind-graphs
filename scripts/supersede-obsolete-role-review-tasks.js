import fs from "node:fs/promises";
import path from "node:path";
import { getClient, getGraphByName } from "../src/db.js";
import { loadManifest, projectDir } from "../src/graph-manifest.js";

const atArg = process.argv.find(arg => arg.startsWith("--at="));
const resolvedAt = new Date(atArg ? atArg.slice(5) : Date.now()).toISOString();
const syncRuntime = process.argv.includes("--sync-runtime");
const reason = "Le corpus courant utilise directement les cinq types universels dans nodeType et conserve la précision dans semanticType. La migration ultérieure migrate-nodetype-semantictype supprime role et roleArbitration ; ces anciennes tâches de revue ne doivent pas réintroduire ce champ.";

const manifest = await loadManifest();
const design = manifest.graphs.find(graph => graph.id === "design" && graph.status === "active");
if (!design) throw new Error("Active design graph not found.");

const loaded = [];
for (const dataset of design.datasets || []) {
  const filePath = path.resolve(projectDir, design.dataDir, dataset.file);
  const data = JSON.parse(await fs.readFile(filePath, "utf8"));
  loaded.push({ dataset, filePath, data });
}

const remainingArbitrations = loaded.flatMap(({ dataset, data }) =>
  (data.nodes || [])
    .filter(node => node.roleArbitration !== undefined)
    .map(node => ({ dataset: dataset.id, id: node.id, roleArbitration: node.roleArbitration }))
);
if (remainingArbitrations.length) {
  throw new Error(`Refusing cleanup: ${remainingArbitrations.length} node(s) still carry roleArbitration.`);
}

const workEntry = loaded.find(entry => entry.dataset.id === "project-work");
if (!workEntry) throw new Error("project-work dataset not found.");

const changedIds = [];
for (const task of workEntry.data.nodes || []) {
  const obsoleteReview = task.id?.startsWith("task-role-review-")
    && String(task.summary || "").includes("roleArbitration=default-pending-review")
    && task.workStatus === "ready";
  if (!obsoleteReview) continue;
  task.workStatus = "superseded";
  task.autonomyMode = "review_required";
  task.supersededReason = reason;
  task.resolvedAt = resolvedAt;
  changedIds.push(task.id);
}

if (changedIds.length) {
  await fs.writeFile(workEntry.filePath, `${JSON.stringify(workEntry.data, null, 2)}\n`, "utf8");
}

let runtimeUpdated = 0;
if (syncRuntime && changedIds.length) {
  const graph = await getGraphByName(design.falkorGraph);
  const result = await graph.query(`
    MATCH (task)
    WHERE task.id IN $ids
    SET task.workStatus = 'superseded',
        task.autonomyMode = 'review_required',
        task.supersededReason = $reason,
        task.resolvedAt = $resolvedAt
    RETURN count(task) AS updated
  `, { params: { ids: changedIds, reason, resolvedAt } });
  runtimeUpdated = Number(result.data?.[0]?.updated || 0);
  const client = await getClient();
  client.close();
}

console.log(JSON.stringify({
  resolvedAt,
  guard: { remainingRoleArbitrations: remainingArbitrations.length },
  canonicalUpdated: changedIds.length,
  runtimeUpdated,
  changedIds
}, null, 2));
