// Projette l'arbre du dépôt dans le graphe L2, une fois, sans watch ni commit.
// Sert à peupler ou reconcilier le miroir à la demande.
import { getL2MindGraph, getClient } from "../src/db.js";
import { projectDir } from "../src/graph-manifest.js";
import { projectFullTree } from "../src/repo-tree-mirror.js";

const revision = Date.now();
const graph = await getL2MindGraph();
const result = await projectFullTree(graph, projectDir, revision);
console.log(`Miroir dépôt→L2 : ${result.files} fichiers, ${result.nodes} nœuds, ${result.links} relations (révision ${revision}).`);

const client = await getClient();
client.close();
