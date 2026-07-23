import { activeGraphs, loadManifest } from "./graph-manifest.js";
import { getGraphByName } from "./db.js";
import { moveToSpace } from "./graph-move.js";

function firstRow(result) {
  return result?.data?.[0] || null;
}

export async function resolveContainingSpace(graph, subjectId, { maxDepth = 4 } = {}) {
  const direct = firstRow(await graph.roQuery(`
    MATCH (subject {id:$subjectId})-[relation]->(space)
    WHERE toLower(space.nodeType) = 'space'
    RETURN space.id AS id, space.name AS name, type(relation) AS via, 1 AS depth
    ORDER BY CASE type(relation) WHEN 'LOCATED_IN' THEN 0 ELSE 1 END, space.id
    LIMIT 1
  `, { params: { subjectId } }));
  if (direct) return direct;

  const sameCluster = firstRow(await graph.roQuery(`
    MATCH (subject {id:$subjectId}), (space)
    WHERE subject.clusterId <> '' AND subject.clusterId = space.clusterId
      AND toLower(space.nodeType) = 'space'
    RETURN space.id AS id, space.name AS name, 'clusterId' AS via, 0 AS depth
    ORDER BY space.id
    LIMIT 1
  `, { params: { subjectId } }));
  if (sameCluster) return sameCluster;

  const depth = Math.max(1, Math.min(8, Math.trunc(Number(maxDepth) || 4)));
  return firstRow(await graph.roQuery(`
    MATCH path=(subject {id:$subjectId})-[*1..${depth}]-(space)
    WHERE toLower(space.nodeType) = 'space'
    RETURN space.id AS id, space.name AS name, 'nearest' AS via, min(length(path)) AS depth
    ORDER BY depth, space.id
    LIMIT 1
  `, { params: { subjectId } }));
}

export async function resolveActorId(graph, preferredActorId = "actor-nlr") {
  return firstRow(await graph.roQuery(`
    MATCH (actor)
    WHERE actor.id = $actorId OR actor.correspondsTo = $actorId
    RETURN actor.id AS id, actor.name AS name
    ORDER BY CASE actor.id WHEN $actorId THEN 0 ELSE 1 END
    LIMIT 1
  `, { params: { actorId: preferredActorId } }));
}

export async function relocateActorToSubjectSpace({
  graphId,
  subjectId,
  actorId = "actor-nlr",
  dryRun = false,
  manifest,
  selectGraph = getGraphByName
}) {
  const resolvedManifest = manifest || await loadManifest();
  const graphConfig = activeGraphs(resolvedManifest).find(candidate => candidate.id === graphId);
  if (!graphConfig) throw new Error(`Unknown or inactive graph: ${graphId}`);
  const graph = await selectGraph(graphConfig.falkorGraph);
  const [actor, space] = await Promise.all([
    resolveActorId(graph, actorId),
    resolveContainingSpace(graph, subjectId)
  ]);
  if (!actor) return { graphId, subjectId, moved: false, reason: "actor_not_found" };
  if (!space) return { graphId, subjectId, actorId: actor.id, moved: false, reason: "space_not_found" };

  const result = await moveToSpace({
    nodeId: actor.id,
    newSpaceId: space.id,
    graphId,
    dryRun,
    createIfMissing: true,
    manifest: resolvedManifest,
    selectGraph
  });
  return { graphId, subjectId, actorId: actor.id, space, moved: result.movedLinks > 0, move: result };
}
