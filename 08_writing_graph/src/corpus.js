// Chargement hors-ligne du corpus causal, sans FalkorDB ni API.
//
// La composition du graphe n'est pas redéclarée ici : elle vient de `graphs.json` via
// `graph-manifest.js`, seule source de vérité. Ce module se limite à appliquer les mêmes
// normalisations que le seed, pour que `npm run work:propose` et la page d'analyse (servie par
// l'API, donc par le seed) voient exactement le même graphe.

import { datasetLinks, datasetNodes, loadManifest, readDatasets, selectGraph } from "./graph-manifest.js";

// Le seed attribue un clusterId par jeu de données quand les nœuds ne le portent pas eux-mêmes
// (scripts/seed.js). Tant que `graphs.json` ne déclare pas ce défaut, la table est dupliquée ici et
// test/corpus.test.js vérifie qu'elle ne diverge pas du seed.
export const DATASET_CLUSTERS = {
  "mind-protocol-repository": "mind-protocol-github-l4",
  "mind-strategic-feedback": "strategic-feedback-decisions",
  "analysis-remediation": "analysis-remediation-2026-07",
  "analysis-validation-contracts": "analysis-validation-contracts",
  "evidence-leverage-programs": "evidence-leverage-programs",
  "reddit-ai-democracy": "reddit-ai-democracy-2026-07-22",
  "consultations": "consultations",
  "graph-architecture-decisions": "graph-architecture",
  "project-work": "project-work"
};

/**
 * Charge un graphe déclaré dans graphs.json, nœuds et relations normalisés.
 * @param {string} graphId identifiant du graphe (défaut : "design")
 */
export async function loadCorpus(graphId = "design") {
  const manifest = await loadManifest();
  const graph = selectGraph(manifest, graphId);
  const datasets = await readDatasets(graph);
  const nodes = [];
  const links = [];
  for (const entry of datasets) {
    const cluster = DATASET_CLUSTERS[entry.id];
    for (const node of datasetNodes(entry)) {
      nodes.push({ ...node, clusterId: node.clusterId || cluster || "" });
    }
    links.push(...datasetLinks(entry));
  }
  return { graph, nodes, links };
}
