// Écriture idempotente dans un graphe FalkorDB de la couche L2. Réutilisé par le
// seeder L2 (données déclaratives) et par le miroir de dépôt (overlay runtime).
// Tous les nœuds portent le label `MindNode` et sont mergés par `id` ; les
// relations sont mergées par (source, type, target). Aucun effacement global :
// la couche L2 est peuplée par accumulation, le miroir se nettoie par révision.
import { toFalkorProperties } from "./falkor-properties.js";

const REL_TYPE = /^[A-Z][A-Z_]*$/;

export async function ensureIndex(graph) {
  await graph.query("CREATE INDEX FOR (n:MindNode) ON (n.id)").catch(() => {});
}

/** Merge une liste de nœuds. Chaque nœud doit porter un `id`. Retourne le compte. */
export async function upsertNodes(graph, nodes) {
  if (!nodes.length) return 0;
  const rows = nodes.map(node => {
    if (!node.id) throw new Error("upsertNodes: nœud sans id.");
    return { id: node.id, props: toFalkorProperties(node) };
  });
  await graph.query(
    "UNWIND $rows AS row MERGE (n:MindNode {id: row.id}) SET n = row.props",
    { params: { rows } }
  );
  return rows.length;
}

/**
 * Merge une liste de relations. Le type de relation ne pouvant pas être un
 * paramètre Cypher, il est validé puis interpolé. Les deux extrémités doivent
 * déjà exister ; un MATCH qui ne trouve rien ne crée rien silencieusement, donc
 * l'appelant est responsable de vérifier l'intégrité des extrémités en amont.
 */
export async function upsertLinks(graph, links) {
  let count = 0;
  for (const link of links) {
    if (!REL_TYPE.test(link.type || "")) throw new Error(`upsertLinks: type de relation invalide "${link.type}".`);
    if (!link.source || !link.target) throw new Error(`upsertLinks: relation sans extrémité (${link.source} -> ${link.target}).`);
    await graph.query(
      `MATCH (a:MindNode {id:$source}), (b:MindNode {id:$target})
       MERGE (a)-[r:${link.type}]->(b) SET r = $props`,
      { params: { source: link.source, target: link.target, props: toFalkorProperties(link) } }
    );
    count += 1;
  }
  return count;
}

/**
 * Merge des relations groupées par type via UNWIND — un aller-retour par type au
 * lieu d'un par relation. Réservé aux lots homogènes (ex. l'arbre miroir, tout en
 * CONVERGES_IN) où la performance compte. Mêmes préconditions que `upsertLinks`.
 */
export async function upsertLinksBatched(graph, links) {
  const byType = new Map();
  for (const link of links) {
    if (!REL_TYPE.test(link.type || "")) throw new Error(`upsertLinksBatched: type de relation invalide "${link.type}".`);
    if (!link.source || !link.target) throw new Error(`upsertLinksBatched: relation sans extrémité (${link.source} -> ${link.target}).`);
    if (!byType.has(link.type)) byType.set(link.type, []);
    byType.get(link.type).push({ source: link.source, target: link.target, props: toFalkorProperties(link) });
  }
  let count = 0;
  for (const [type, rows] of byType) {
    await graph.query(
      `UNWIND $rows AS row
       MATCH (a:MindNode {id: row.source}), (b:MindNode {id: row.target})
       MERGE (a)-[r:${type}]->(b) SET r = row.props`,
      { params: { rows } }
    );
    count += rows.length;
  }
  return count;
}

/** Supprime les nœuds runtime d'un préfixe de `runtimeKind` dont la révision est périmée. */
export async function deleteStaleRuntime(graph, kindPrefix, revision) {
  await graph.query(
    `MATCH (n:MindNode)
     WHERE n.runtimeManaged = true AND n.runtimeKind STARTS WITH $prefix AND n.runtimeRevision < $revision
     DETACH DELETE n`,
    { params: { prefix: kindPrefix, revision } }
  );
}
