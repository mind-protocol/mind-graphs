// Writer dédié du graphe personnel L1. Le seed principal est taillé pour l'ontologie
// de design (il exige startYear, forecast*, etc.) ; comme le graphe scientifique a son
// propre script d'ingestion, un L1 à ontologie étrangère a le sien. Il écrit exactement
// les champs que la donnée déclare, sans imposer la forme d'un autre graphe.
//
//   node scripts/l1-seed.js --graph=l1-nlr
//
// La cible FalkorDB est déduite du manifeste ; refuse d'écrire ailleurs.

import { FalkorDB } from "falkordb";
import { loadManifest, selectGraph, loadOntology, readDatasets, datasetNodes, datasetLinks } from "../src/graph-manifest.js";

const graphId = process.argv.find(arg => arg.startsWith("--graph="))?.split("=")[1] || "l1-nlr";
const manifest = await loadManifest();
const graphConfig = selectGraph(manifest, graphId);
if (graphConfig.status !== "active") throw new Error(`Le graphe "${graphId}" n'est pas actif.`);

const ontology = await loadOntology(graphConfig);
const nodeTypeIds = new Set(ontology.nodeTypes.map(type => type.id));
const relationTypeIds = new Set(ontology.relationTypes.map(type => type.id));

const datasets = await readDatasets(graphConfig);
const nodes = datasets.flatMap(entry => datasetNodes(entry));
const links = datasets.flatMap(entry => datasetLinks(entry));

for (const node of nodes) if (!nodeTypeIds.has(node.nodeType)) throw new Error(`Type de nœud inconnu dans ${graphId} : ${node.nodeType}`);
for (const link of links) if (!relationTypeIds.has(link.type)) throw new Error(`Prédicat inconnu dans ${graphId} : ${link.type}`);

const host = process.env.FALKORDB_HOST || "127.0.0.1";
const port = Number(process.env.FALKORDB_PORT || 6379);
const client = await FalkorDB.connect({ socket: { host, port } });
const graph = client.selectGraph(graphConfig.falkorGraph);

// Table rase puis recharge, comme le seed de design, mais borné à cette base.
try { await graph.query("MATCH ()-[r]->() DELETE r"); } catch { /* base peut-être absente */ }
try { await graph.query("MATCH (n) DETACH DELETE n"); } catch { /* base peut-être absente */ }
await graph.query("CREATE INDEX FOR (n:L1Node) ON (n.id)").catch(() => {});

// On écrit chaque nœud comme une carte de propriétés : seuls les champs présents dans
// la donnée sont posés. Rien n'est inventé, aucun champ d'un autre graphe n'est imposé.
for (const node of nodes) {
  await graph.query(
    "CREATE (n:L1Node) SET n = $props, n.epistemicStatus = coalesce($props.epistemicStatus, $fallback)",
    { params: { props: node, fallback: ontology.nodeTypes.find(type => type.id === node.nodeType).epistemicStatus } }
  );
}
for (const link of links) {
  await graph.query(
    "MATCH (s:L1Node {id:$source}), (t:L1Node {id:$target}) CREATE (s)-[:REL {type:$type, justification:$justification}]->(t)",
    { params: { source: link.source, target: link.target, type: link.type, justification: link.justification || "" } }
  );
}

console.log(`L1 semé : ${nodes.length} nœuds et ${links.length} relations dans ${graphConfig.falkorGraph}.`);
await client.close();
