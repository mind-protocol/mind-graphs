import { toFalkorProperties } from "./falkor-properties.js";
import { datasetLinks, datasetNodes } from "./graph-manifest.js";
import { syncL1Blueprint } from "./l1-blueprint-sync.js";

const relationshipType = value => {
  const type = String(value || "");
  if (!/^[A-Z][A-Z0-9_]*$/.test(type)) {
    throw new Error(`Prédicat L1 impossible à matérialiser : ${type || "(vide)"}`);
  }
  return type;
};

export function prepareL1Seed({ graphConfig, ontology, datasets, blueprint }) {
  if (graphConfig?.blueprintSync?.enabled !== true) {
    throw new Error(`Le graphe L1 "${graphConfig?.id || "unknown"}" doit déclarer blueprintSync.enabled=true.`);
  }
  if (!blueprint?.graphId || !blueprint?.schemaVersion || !Array.isArray(blueprint.nodes) || !Array.isArray(blueprint.relations)) {
    throw new Error("Le Blueprint L1 complet doit être chargé et validé avant toute suppression du graphe personnel.");
  }
  const nodeTypeIds = new Set((ontology.nodeTypes || []).map(type => type.id));
  const relationTypeIds = new Set((ontology.relationTypes || []).map(type => type.id));
  const nodes = datasets.flatMap(entry => datasetNodes(entry));
  const links = datasets.flatMap(entry => datasetLinks(entry));
  for (const node of nodes) {
    if (!nodeTypeIds.has(node.nodeType)) throw new Error(`Type de nœud inconnu dans ${graphConfig.id} : ${node.nodeType}`);
  }
  for (const link of links) {
    if (!relationTypeIds.has(link.type)) throw new Error(`Prédicat inconnu dans ${graphConfig.id} : ${link.type}`);
  }
  return { nodes, links };
}

export async function seedL1Graph({
  graph,
  graphConfig,
  ontology,
  datasets,
  blueprint,
  syncBlueprint = syncL1Blueprint
}) {
  const { nodes, links } = prepareL1Seed({ graphConfig, ontology, datasets, blueprint });

  // Le Blueprint est validé avant la table rase. Une source absente ou invalide
  // ne peut donc jamais laisser le graphe personnel vide.
  try { await graph.query("MATCH ()-[r]->() DELETE r"); } catch { /* base peut être absente */ }
  try { await graph.query("MATCH (n) DETACH DELETE n"); } catch { /* base peut être absente */ }
  await graph.query("CREATE INDEX FOR (n:L1Node) ON (n.id)").catch(() => {});

  for (const node of nodes) {
    await graph.query(
      "CREATE (n:L1Node) SET n = $props, n.epistemicStatus = coalesce($props.epistemicStatus, $fallback)",
      { params: {
        props: toFalkorProperties(node),
        fallback: ontology.nodeTypes.find(type => type.id === node.nodeType).epistemicStatus
      } }
    );
  }
  for (const link of links) {
    const type = relationshipType(link.type);
    await graph.query(
      `MATCH (s:L1Node {id:$source}), (t:L1Node {id:$target}) CREATE (s)-[r:${type}]->(t) SET r.justification=$justification`,
      { params: { source: link.source, target: link.target, justification: link.justification || "" } }
    );
  }

  // Invariant de seed : chaque reconstruction du L1 se termine par la copie de
  // tous les clusters Blueprint. La sync reste collision-safe et n'écrit que
  // des L1BlueprintNode gérés, distincts du contenu personnel L1Node.
  const blueprintSync = await syncBlueprint({
    graph,
    blueprint,
    scopeFacet: graphConfig.blueprintSync.scopeFacet || null,
    apply: true
  });
  if (blueprintSync.status !== "current") {
    throw new Error(`La synchronisation Blueprint L1 n'a pas atteint l'état current (${blueprintSync.status}).`);
  }
  return {
    personalNodes: nodes.length,
    personalRelations: links.length,
    blueprintNodes: blueprintSync.plan.counts.desiredNodes,
    blueprintRelations: blueprintSync.plan.counts.desiredRelations,
    blueprintApplied: blueprintSync.applied
  };
}
