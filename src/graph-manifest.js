// Chargeur du manifeste `graphs.json`. Il est la seule source de vérité de la
// composition des graphes : quels fichiers, dans quel ordre, pour quelle base et
// quelle ontologie. `seed.js`, `validate-data.js` et `docs-stats.js` le lisent au
// lieu de maintenir chacun leur liste, qui divergeait silencieusement.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(projectDir, "graphs.json");

const readJson = async filePath => JSON.parse(await fs.readFile(filePath, "utf8"));

export async function loadManifest() {
  return readJson(manifestPath);
}

/** Configuration d'un graphe déclaré. Lève si l'identifiant est inconnu. */
export function selectGraph(manifest, graphId) {
  const graph = manifest.graphs.find(candidate => candidate.id === graphId);
  if (!graph) {
    const known = manifest.graphs.map(candidate => candidate.id).join(", ");
    throw new Error(`Unknown graph "${graphId}" in graphs.json (known: ${known})`);
  }
  return graph;
}

export function activeGraphs(manifest) {
  return manifest.graphs.filter(graph => graph.status === "active");
}

export async function loadOntology(graph) {
  return readJson(path.resolve(projectDir, graph.ontology));
}

/**
 * Lit les jeux de données d'un graphe dans l'ordre déclaré.
 * Retourne des entrées brutes : la normalisation reste à la charge de l'appelant.
 */
export async function readDatasets(graph) {
  const dataDir = path.resolve(projectDir, graph.dataDir);
  return Promise.all(graph.datasets.map(async spec => ({
    id: spec.id,
    spec,
    filename: spec.file,
    relativePath: path.posix.join(graph.dataDir, spec.file),
    data: await readJson(path.join(dataDir, spec.file))
  })));
}

/**
 * Nœuds bruts d'un jeu de données, avec les seules particularités déclarées dans
 * le manifeste : forme racine (`node` au singulier) et type par défaut.
 */
export function datasetNodes(entry) {
  const { spec, data } = entry;
  const raw = spec.shape === "root" ? (data.node ? [data.node] : []) : (data.nodes || []);
  if (!spec.defaultNodeType) return raw;
  const L4_ROLES = new Set(["actor", "moment", "narrative", "space", "thing"]);
  return raw.map(node => {
    const isL4 = L4_ROLES.has(spec.defaultNodeType);
    return {
      ...node,
      nodeType: node.nodeType || (isL4 ? spec.defaultNodeType : "moment"),
      semanticType: node.semanticType || spec.defaultNodeType
    };
  });
}

/** Relations brutes d'un jeu de données, prédicat forcé compris. */
export function datasetLinks(entry) {
  const raw = entry.data.links || [];
  if (!entry.spec.forcedLinkType) return raw;
  return raw.map(link => ({ ...link, type: entry.spec.forcedLinkType }));
}
