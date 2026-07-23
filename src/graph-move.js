import { activeGraphs, loadManifest } from "./graph-manifest.js";
import { getGraphByName } from "./db.js";

function requiredId(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function mutationQuery(relationTypes) {
  const stages = relationTypes.map((relationType, index) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(relationType)) {
      throw new Error(`Unsafe relationship type returned by FalkorDB: ${relationType}`);
    }
    return `
      OPTIONAL MATCH (node)-[old${index}:${relationType}]->(space${index})
      WHERE toLower(space${index}.nodeType) = 'space'
      WITH node, newSpace${index ? `, ${relationTypes.slice(0, index).map((_, i) => `moved${i}`).join(", ")}` : ""}, collect(old${index}) AS oldLinks${index}
      FOREACH (old IN oldLinks${index} |
        CREATE (node)-[replacement:${relationType}]->(newSpace)
        SET replacement = properties(old)
        DELETE old
      )
      WITH node, newSpace${index ? `, ${relationTypes.slice(0, index).map((_, i) => `moved${i}`).join(", ")}` : ""}, size(oldLinks${index}) AS moved${index}`;
  }).join("\n");
  const total = relationTypes.map((_, index) => `moved${index}`).join(" + ");
  return `
    MATCH (node), (newSpace)
    WHERE node.id = $nodeId AND newSpace.id = $newSpaceId
    WITH node, newSpace
    ${stages}
    RETURN ${total} AS movedLinks
  `;
}

export async function moveToSpace({
  nodeId,
  newSpaceId,
  graphId = "design",
  dryRun = false,
  createIfMissing = false,
  manifest,
  selectGraph = getGraphByName
}) {
  const sourceId = requiredId(nodeId, "nodeId");
  const targetId = requiredId(newSpaceId, "newSpaceId");
  if (sourceId === targetId) throw new Error("A node cannot be moved into itself");

  const resolvedManifest = manifest || await loadManifest();
  const graphConfig = activeGraphs(resolvedManifest).find(candidate => candidate.id === graphId);
  if (!graphConfig) throw new Error(`Unknown or inactive graph: ${graphId}`);
  const graph = await selectGraph(graphConfig.falkorGraph);

  const candidates = await graph.roQuery(`
    MATCH (candidate)
    WHERE candidate.id IN $ids
    RETURN candidate.id AS id, candidate.name AS name, candidate.nodeType AS nodeType
  `, { params: { ids: [sourceId, targetId] } });
  const source = candidates.data.find(node => node.id === sourceId);
  const newSpace = candidates.data.find(node => node.id === targetId);
  if (!source) throw new Error(`Node not found in ${graphId}: ${sourceId}`);
  if (!newSpace) throw new Error(`New Space not found in ${graphId}: ${targetId}`);
  if (String(newSpace.nodeType).toLowerCase() !== "space") {
    throw new Error(`Target ${targetId} is ${newSpace.nodeType || "untyped"}, not Space`);
  }

  const linksResult = await graph.roQuery(`
    MATCH (node {id:$nodeId})-[link]->(oldSpace)
    WHERE toLower(oldSpace.nodeType) = 'space'
    RETURN type(link) AS relationType, link.type AS semanticType,
           oldSpace.id AS oldSpaceId, oldSpace.name AS oldSpaceName
    ORDER BY relationType, oldSpaceId
  `, { params: { nodeId: sourceId } });
  const links = linksResult.data;
  const preview = {
    graphId,
    database: graphConfig.falkorGraph,
    node: source,
    newSpace,
    links,
    movedLinks: dryRun ? 0 : (links.length || (createIfMissing ? 1 : 0)),
    createdLocation: Boolean(createIfMissing && !links.length),
    dryRun: Boolean(dryRun)
  };
  if (dryRun) return preview;
  if (!links.length && createIfMissing) {
    const created = await graph.query(`
      MATCH (node {id:$nodeId}), (newSpace {id:$newSpaceId})
      MERGE (node)-[location:LOCATED_IN]->(newSpace)
      ON CREATE SET location.type = 'LOCATED_IN',
                    location.justification = $justification,
                    location.updatedAt = $updatedAt
      ON MATCH SET location.updatedAt = $updatedAt
      RETURN 1 AS movedLinks
    `, { params: {
      nodeId: sourceId,
      newSpaceId: targetId,
      justification: "La location runtime de l'acteur suit le Space du travail courant.",
      updatedAt: new Date().toISOString()
    } });
    return { ...preview, movedLinks: Number(created.data[0]?.movedLinks || 1) };
  }
  if (!links.length) return preview;

  const relationTypes = [...new Set(links.map(link => link.relationType))].sort();
  const moved = await graph.query(mutationQuery(relationTypes), {
    params: { nodeId: sourceId, newSpaceId: targetId }
  });
  return { ...preview, movedLinks: Number(moved.data[0]?.movedLinks || 0) };
}

export function formatMoveResult(result) {
  if (result.createdLocation && !result.dryRun) {
    return `Lien LOCATED_IN créé de ${result.node.name || result.node.id} vers ${result.newSpace.name || result.newSpace.id}.`;
  }
  if (!result.links.length) return `${result.node.name || result.node.id} n'avait aucun lien sortant vers un Space.`;
  const oldSpaces = [...new Set(result.links.map(link => link.oldSpaceName || link.oldSpaceId))].join(", ");
  if (result.dryRun) {
    return `Prévisualisation : ${result.links.length} lien(s) de ${result.node.name || result.node.id} seraient déplacés depuis ${oldSpaces} vers ${result.newSpace.name || result.newSpace.id}.`;
  }
  return `${result.movedLinks} lien(s) de ${result.node.name || result.node.id} déplacés depuis ${oldSpaces} vers ${result.newSpace.name || result.newSpace.id}.`;
}
