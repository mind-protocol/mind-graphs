import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getGraphByName } from "./db.js";
import { loadManifest, projectDir as defaultProjectDir } from "./graph-manifest.js";

const scalar = value => value === null || ["string", "number", "boolean"].includes(typeof value);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

const stableJson = value => JSON.stringify(canonical(value));
const hash = value => crypto.createHash("sha256").update(stableJson(value)).digest("hex");

function graphProperties(value) {
  const properties = {};
  for (const [key, entry] of Object.entries(value || {})) {
    if (entry === undefined) continue;
    if (scalar(entry) || (Array.isArray(entry) && entry.every(scalar))) properties[key] = entry;
    else properties[`${key}Json`] = stableJson(entry);
  }
  return properties;
}

export function projectL1Blueprint(blueprint, { scopeFacet = null } = {}) {
  if (!blueprint?.graphId || !blueprint?.schemaVersion) throw new Error("Blueprint graphId and schemaVersion are required.");
  const selected = (blueprint.nodes || []).filter(node => !scopeFacet || node.facets?.includes(scopeFacet));
  const selectedIds = new Set(selected.map(node => node.id));
  if (selectedIds.size !== selected.length || selectedIds.has(undefined)) throw new Error("Blueprint node IDs must be present and unique.");
  const relations = (blueprint.relations || []).filter(relation => selectedIds.has(relation.source) && selectedIds.has(relation.target));
  const releaseBody = { graphId: blueprint.graphId, schemaVersion: blueprint.schemaVersion, scopeFacet, nodes: selected, relations };
  const releaseHash = hash(releaseBody);
  const common = {
    blueprintManaged: true,
    blueprintSource: blueprint.graphId,
    blueprintVersion: blueprint.schemaVersion,
    blueprintReleaseHash: releaseHash
  };
  return {
    source: blueprint.graphId,
    version: blueprint.schemaVersion,
    scopeFacet,
    releaseHash,
    nodes: selected.map(node => ({
      id: node.id,
      entityHash: hash(node),
      props: graphProperties({ ...node, ...common, blueprintEntityHash: hash(node), blueprintRetired: false })
    })),
    relations: relations.map(relation => ({
      id: relation.id,
      source: relation.source,
      target: relation.target,
      entityHash: hash(relation),
      props: graphProperties({ ...relation, ...common, blueprintEntityHash: hash(relation) })
    }))
  };
}

const emptyState = () => ({ releaseHash: null, status: "absent", nodes: [], relations: [], collisions: [] });

export async function readL1BlueprintState(graph, projection) {
  try {
    const [stateResult, nodesResult, relationsResult, occupiedResult] = await Promise.all([
      graph.roQuery(`
        MATCH (state:L1BlueprintState {id:$source})
        RETURN state.releaseHash AS releaseHash, state.status AS status, state.version AS version,
               state.projectionError AS projectionError
      `, { params: { source: projection.source } }),
      graph.roQuery(`
        MATCH (node:L1BlueprintNode)
        WHERE node.blueprintSource = $source
        RETURN node.id AS id, node.blueprintEntityHash AS entityHash, node.blueprintRetired AS retired
      `, { params: { source: projection.source } }),
      graph.roQuery(`
        MATCH ()-[relation:REL]->()
        WHERE relation.blueprintManaged = true AND relation.blueprintSource = $source
        RETURN relation.id AS id, relation.blueprintEntityHash AS entityHash
      `, { params: { source: projection.source } }),
      graph.roQuery(`
        MATCH (node)
        WHERE node.id IN $ids
        RETURN node.id AS id, labels(node) AS labels, node.blueprintManaged AS blueprintManaged,
               node.blueprintSource AS blueprintSource
      `, { params: { ids: projection.nodes.map(node => node.id) } })
    ]);
    const occupied = occupiedResult.data || [];
    const collisions = occupied.filter(row => row.blueprintManaged !== true || row.blueprintSource !== projection.source)
      .map(row => ({ id: row.id, labels: row.labels || [], blueprintSource: row.blueprintSource || null }));
    return {
      releaseHash: stateResult.data?.[0]?.releaseHash || null,
      status: stateResult.data?.[0]?.status || "absent",
      version: stateResult.data?.[0]?.version || null,
      projectionError: stateResult.data?.[0]?.projectionError || null,
      nodes: nodesResult.data || [],
      relations: relationsResult.data || [],
      collisions
    };
  } catch (error) {
    if (/empty key/i.test(error.message)) return emptyState();
    throw error;
  }
}

function entityDiff(desired, existing, { retired = false } = {}) {
  const current = new Map(existing.map(item => [item.id, item]));
  const wanted = new Set(desired.map(item => item.id));
  const create = desired.filter(item => !current.has(item.id)).map(item => item.id);
  const update = desired.filter(item => current.has(item.id) && (current.get(item.id).entityHash !== item.entityHash || (retired && current.get(item.id).retired === true))).map(item => item.id);
  const unchanged = desired.filter(item => current.has(item.id) && !update.includes(item.id)).map(item => item.id);
  const stale = existing.filter(item => !wanted.has(item.id) && (!retired || item.retired !== true)).map(item => item.id);
  return { create, update, unchanged, stale };
}

export function planL1BlueprintSync(projection, current) {
  const nodes = entityDiff(projection.nodes, current.nodes || [], { retired: true });
  const relations = entityDiff(projection.relations, current.relations || []);
  const collisions = current.collisions || [];
  return {
    source: projection.source,
    fromVersion: current.version || null,
    toVersion: projection.version,
    fromReleaseHash: current.releaseHash || null,
    toReleaseHash: projection.releaseHash,
    status: collisions.length ? "blocked" : current.releaseHash === projection.releaseHash && !nodes.update.length && !nodes.stale.length && !relations.update.length && !relations.stale.length ? "current" : "proposed",
    collisions,
    nodes,
    relations,
    counts: {
      desiredNodes: projection.nodes.length,
      desiredRelations: projection.relations.length,
      nodeCreates: nodes.create.length,
      nodeUpdates: nodes.update.length,
      nodeRetirements: nodes.stale.length,
      relationCreates: relations.create.length,
      relationUpdates: relations.update.length,
      relationRemovals: relations.stale.length
    }
  };
}

async function inChunks(items, run, size = 100) {
  for (let index = 0; index < items.length; index += size) await run(items.slice(index, index + size));
}

export async function applyL1BlueprintProjection(graph, projection, plan, { now = () => new Date().toISOString() } = {}) {
  if (plan.collisions.length) throw new Error(`Blueprint sync blocked by occupied IDs: ${plan.collisions.map(item => item.id).join(", ")}`);
  if (plan.status === "current") return { applied: false, status: "current", plan };
  const appliedAt = now();
  await graph.query(`
    MERGE (state:L1BlueprintState {id:$source})
    SET state.status = 'applying', state.targetReleaseHash = $releaseHash,
        state.previousReleaseHash = state.releaseHash, state.updatedAt = $appliedAt,
        state.projectionError = null
  `, { params: { source: projection.source, releaseHash: projection.releaseHash, appliedAt } });
  try {
    await inChunks(projection.nodes, items => graph.query(`
      UNWIND $items AS item
      MERGE (node:L1BlueprintNode {id:item.id})
      SET node = item.props
    `, { params: { items } }));
    await graph.query(`
      MATCH ()-[relation:REL]->()
      WHERE relation.blueprintManaged = true AND relation.blueprintSource = $source
      DELETE relation
    `, { params: { source: projection.source } });
    await inChunks(projection.relations, items => graph.query(`
      UNWIND $items AS item
      MATCH (source:L1BlueprintNode {id:item.source}), (target:L1BlueprintNode {id:item.target})
      CREATE (source)-[relation:REL]->(target)
      SET relation = item.props
    `, { params: { items } }));
    await graph.query(`
      MATCH (node:L1BlueprintNode)
      WHERE node.blueprintSource = $source AND NOT node.id IN $activeIds
      SET node.blueprintRetired = true, node.blueprintRetiredAt = $appliedAt
    `, { params: { source: projection.source, activeIds: projection.nodes.map(node => node.id), appliedAt } });
    await graph.query(`
      MATCH (state:L1BlueprintState {id:$source})
      SET state.status = 'current', state.version = $version, state.releaseHash = $releaseHash,
          state.appliedAt = $appliedAt, state.nodeCount = $nodeCount,
          state.relationCount = $relationCount, state.projectionError = null
    `, { params: {
      source: projection.source, version: projection.version, releaseHash: projection.releaseHash,
      appliedAt, nodeCount: projection.nodes.length, relationCount: projection.relations.length
    } });
    return { applied: true, status: "current", appliedAt, plan };
  } catch (error) {
    await graph.query(`
      MATCH (state:L1BlueprintState {id:$source})
      SET state.status = 'repair_required', state.projectionError = $message, state.updatedAt = $appliedAt
    `, { params: { source: projection.source, message: error.message, appliedAt } }).catch(() => {});
    throw error;
  }
}

export async function syncL1Blueprint({ graph, blueprint, scopeFacet = null, apply = false }) {
  const projection = projectL1Blueprint(blueprint, { scopeFacet });
  const current = await readL1BlueprintState(graph, projection);
  const plan = planL1BlueprintSync(projection, current);
  if (!apply) return { applied: false, status: plan.status, plan };
  return applyL1BlueprintProjection(graph, projection, plan);
}

export async function syncDeclaredL1Blueprints({ graphId = null, apply = false, manifest = null, projectDir = defaultProjectDir, selectGraphByName = getGraphByName } = {}) {
  const loadedManifest = manifest || await loadManifest();
  const targets = loadedManifest.graphs.filter(graph => graph.status === "active" && graph.blueprintSync?.enabled && (!graphId || graph.id === graphId));
  if (!targets.length) throw new Error(graphId ? `No active blueprint sync configured for ${graphId}.` : "No active L1 blueprint sync is configured.");
  const reports = [];
  for (const target of targets) {
    const sourcePath = path.resolve(projectDir, target.blueprintSync.source);
    const blueprint = JSON.parse(await fs.readFile(sourcePath, "utf8"));
    const graph = await selectGraphByName(target.falkorGraph);
    const result = await syncL1Blueprint({ graph, blueprint, scopeFacet: target.blueprintSync.scopeFacet || null, apply });
    reports.push({ graphId: target.id, falkorGraph: target.falkorGraph, sourcePath, ...result });
  }
  return { mode: apply ? "apply" : "dry-run", reports };
}

export function formatL1BlueprintSync(result) {
  return result.reports.map(report => {
    const counts = report.plan.counts;
    const action = report.applied ? "appliquée" : report.status === "current" ? "déjà à jour" : report.status === "blocked" ? "bloquée" : "proposée (dry-run)";
    return `${report.graphId}: sync ${action} vers ${report.plan.toVersion} · ${counts.desiredNodes} nœuds/${counts.desiredRelations} relations · `
      + `+${counts.nodeCreates}/~${counts.nodeUpdates}/retirés ${counts.nodeRetirements} · collisions ${report.plan.collisions.length}`;
  }).join("\n");
}
