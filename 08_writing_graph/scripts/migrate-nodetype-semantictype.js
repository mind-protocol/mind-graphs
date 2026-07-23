import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { projectDir, loadManifest, selectGraph, readDatasets } from "../src/graph-manifest.js";

const manifest = await loadManifest();
const graphConfig = selectGraph(manifest, "design");
const datasets = await readDatasets(graphConfig);

let totalNodes = 0;
let migratedNodes = 0;

for (const entry of datasets) {
  const filePath = path.join(projectDir, graphConfig.dataDir, entry.filename);
  const data = JSON.parse(await readFile(filePath, "utf8"));
  let touched = false;

  const defaultType = entry.spec?.defaultNodeType || "protocol";
  if (Array.isArray(data.nodes)) {
    for (const node of data.nodes) {
      totalNodes++;
      const currentRole = node.role || (node.nodeType === "forecast_event" || entry.spec?.defaultNodeType === "forecast_event" ? "moment" : "narrative");
      const currentSemantic = node.nodeType || defaultType;

      node.semanticType = currentSemantic;
      node.nodeType = currentRole;

      delete node.role;
      delete node.roleArbitration;
      touched = true;
      migratedNodes++;
    }
  }

  if (touched) {
    await writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
    console.log(`Migré : ${entry.filename}`);
  }
}

console.log(`Migration terminée : ${migratedNodes}/${totalNodes} nœuds migrés.`);
