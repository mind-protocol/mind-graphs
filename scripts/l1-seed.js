// Writer dédié du graphe personnel L1. Le seed principal est taillé pour l'ontologie
// de design (il exige startYear, forecast*, etc.) ; comme le graphe scientifique a son
// propre script d'ingestion, un L1 à ontologie étrangère a le sien. Il écrit exactement
// les champs que la donnée déclare, sans imposer la forme d'un autre graphe.
//
//   node scripts/l1-seed.js --graph=l1-nlr
//
// La cible FalkorDB est déduite du manifeste ; refuse d'écrire ailleurs.

import { FalkorDB } from "falkordb";
import fs from "node:fs/promises";
import path from "node:path";
import { loadManifest, selectGraph, loadOntology, readDatasets, projectDir } from "../src/graph-manifest.js";
import { seedL1Graph } from "../src/l1-seed.js";

const graphId = process.argv.find(arg => arg.startsWith("--graph="))?.split("=")[1] || "l1-nlr-ai";
const manifest = await loadManifest();
const graphConfig = selectGraph(manifest, graphId);
if (graphConfig.status !== "active") throw new Error(`Le graphe "${graphId}" n'est pas actif.`);
if (graphConfig.blueprintSync?.enabled !== true || !graphConfig.blueprintSync.source) {
  throw new Error(`Le graphe "${graphId}" doit déclarer une source Blueprint obligatoire.`);
}

const ontology = await loadOntology(graphConfig);
const datasets = await readDatasets(graphConfig);
const blueprint = JSON.parse(await fs.readFile(path.resolve(projectDir, graphConfig.blueprintSync.source), "utf8"));

const host = process.env.FALKORDB_HOST || "127.0.0.1";
const port = Number(process.env.FALKORDB_PORT || 6379);
const client = await FalkorDB.connect({ socket: { host, port } });
const graph = client.selectGraph(graphConfig.falkorGraph);

const report = await seedL1Graph({ graph, graphConfig, ontology, datasets, blueprint });
console.log(
  `L1 semé dans ${graphConfig.falkorGraph} : ${report.personalNodes} nodes/${report.personalRelations} relations personnelles`
  + ` + ${report.blueprintNodes} nodes/${report.blueprintRelations} relations Blueprint.`
);
await client.close();
