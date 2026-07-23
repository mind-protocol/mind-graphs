// Seeder de la couche L2. `seed.js` (design) attend une ontologie riche
// (relationTypes, traversal, epistemicStatuses) que `l2/ontology.json` n'a pas ;
// la couche L2 a donc son propre chargement, déclaratif et idempotent, qui merge
// les datasets déclarés pour le graphe dans `graphs.json` sans effacer la base.
import { getGraphByName, getClient } from "../src/db.js";
import { loadManifest, selectGraph, readDatasets } from "../src/graph-manifest.js";
import { ensureIndex, upsertNodes, upsertLinks } from "../src/l2-graph-writer.js";

const graphId = process.argv.find(arg => arg.startsWith("--graph="))?.split("=")[1] || "l2-mind-graphs";
const manifest = await loadManifest();
const spec = selectGraph(manifest, graphId);
if (spec.status !== "active") throw new Error(`Le graphe "${graphId}" est déclaré mais inactif.`);

const datasets = await readDatasets(spec);
const nodes = [];
const links = [];
for (const entry of datasets) {
  for (const node of entry.data.nodes || []) nodes.push(node);
  for (const link of entry.data.links || []) links.push(link);
}

// Intégrité des extrémités : un lien dont une extrémité manque serait fabriqué.
// On refuse plutôt que d'écrire un MATCH qui ne crée rien en silence.
const ids = new Set(nodes.map(node => node.id));
const orphans = links.filter(link => !ids.has(link.source) || !ids.has(link.target));
if (orphans.length) {
  const detail = orphans.map(link => `${link.source} -> ${link.target} (${link.type})`).join("; ");
  throw new Error(`FIX: ${orphans.length} lien(s) orphelin(s) dans les datasets L2 : ${detail}.`);
}

const graph = await getGraphByName(spec.falkorGraph);
await ensureIndex(graph);
const nodeCount = await upsertNodes(graph, nodes);
const linkCount = await upsertLinks(graph, links);
console.log(`L2 seed: ${nodeCount} nœuds et ${linkCount} relations mergés dans ${spec.falkorGraph}.`);

const client = await getClient();
client.close();
