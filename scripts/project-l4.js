// Passe le graphe dans la forme L4 et écrit la projection complète.
// Par défaut le rapport seul est affiché : la projection ne remplace rien tant
// que le taux de retour arrière n'est pas jugé acceptable par un humain.
import fs from "node:fs/promises";
import path from "node:path";
import { projectGraph } from "../src/l4-projection.js";
import { projectDir } from "../src/graph-manifest.js";

const args = process.argv.slice(2);
const valueOf = (flag, fallback) => {
  const found = args.find(arg => arg.startsWith(`--${flag}=`));
  return found ? found.slice(flag.length + 3) : fallback;
};

const graphId = valueOf("graph", "design");
const output = valueOf("output", `artifacts/l4/${graphId}-projection.json`);
const projection = await projectGraph(graphId);

if (!args.includes("--summary-only")) {
  const target = path.resolve(projectDir, output);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(projection, null, 2)}\n`, "utf8");
  console.log(`Projection écrite dans ${output}`);
}

console.log(JSON.stringify({ mappingVersion: projection.mappingVersion, ...projection.summary }, null, 2));
