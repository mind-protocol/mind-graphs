import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRelationJustification } from "../public/relation-justification.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "../data");
const filenames = (await fs.readdir(dataDir))
  .filter(filename => filename.endsWith(".json") && !["graph-ontology.json", "mind-root.json"].includes(filename));
const readJson = async filename => JSON.parse(await fs.readFile(path.join(dataDir, filename), "utf8"));
const ontology = await readJson("graph-ontology.json");
const root = await readJson("mind-root.json");
const datasets = await Promise.all(filenames.map(async filename => ({ filename, data: await readJson(filename) })));
const relationTypes = new Map(ontology.relationTypes.map(type => [type.id, type]));
const names = new Map([[root.node.id, root.node.name]]);
for (const { data } of datasets) for (const node of data.nodes || []) names.set(node.id, node.name);

let changed = 0;
for (const { filename, data } of datasets) {
  for (const link of data.links || []) {
    if (String(link.justification || "").trim()) continue;
    const type = filename === "forecast-influences.json" ? "AFFECTS_SCENARIO" : link.type;
    link.justification = buildRelationJustification(
      { ...link, type },
      names.get(link.source) || link.source,
      names.get(link.target) || link.target,
      relationTypes.get(type)
    );
    changed += 1;
  }
  await fs.writeFile(path.join(dataDir, filename), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

console.log(`Added explicit justifications to ${changed} relations.`);
