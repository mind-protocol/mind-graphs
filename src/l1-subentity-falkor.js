import { EMPTY_SUBENTITY_RUNTIME_STATE, runSubentityLifecycleTick } from "./l1-subentity-runtime.js";

export class RuntimeRevisionConflictError extends Error {
  constructor(expectedRevision) {
    super(`L1 subentity runtime revision conflict at ${expectedRevision}.`);
    this.name = "RuntimeRevisionConflictError";
    this.expectedRevision = expectedRevision;
  }
}

const clone = value => structuredClone(value);
const scalar = value => value === null || ["string", "number", "boolean"].includes(typeof value);

function graphProperties(value) {
  const properties = {};
  for (const [key, entry] of Object.entries(value || {})) {
    if (entry === undefined) continue;
    if (scalar(entry) || (Array.isArray(entry) && entry.every(scalar))) properties[key] = entry;
    else properties[`${key}Json`] = JSON.stringify(entry);
  }
  return properties;
}

export function projectSubentityRuntimeState(state) {
  const revision = Number(state.revision || 0);
  const runtimeNodes = [
    ...(state.actors || []).map(actor => ({
      ...actor,
      nodeType: "actor",
      semanticType: actor.semanticType || "actor",
      epistemicStatus: actor.epistemicStatus || "observed",
      runtimeKind: actor.runtimeKind || "perceiving_actor"
    })),
    ...(state.spaces || []).map(space => ({
      ...space,
      nodeType: "space",
      semanticType: space.semanticType || "context",
      epistemicStatus: space.epistemicStatus || "observed",
      runtimeKind: "stimulus_space"
    })),
    ...(state.perceptualMoments || []).map(moment => ({
      ...moment,
      nodeType: "moment",
      semanticType: moment.semanticType || "observation",
      epistemicStatus: moment.epistemicStatus || "observed",
      runtimeKind: "stimulus_moment"
    })),
    ...(state.workspaceSnapshots || []).map(moment => ({
      ...moment,
      nodeType: "moment",
      semanticType: "workspace_snapshot",
      epistemicStatus: moment.epistemicStatus || "observed",
      runtimeKind: "workspace_snapshot"
    })),
    ...(state.memoryAttributions || []).map(moment => ({
      ...moment,
      nodeType: "moment",
      semanticType: "memory_attribution",
      epistemicStatus: moment.correctedByHuman ? "confirmed" : "inferred",
      runtimeKind: "memory_attribution"
    })),
    ...(state.subentities || []).map(entity => ({
      id: entity.id,
      nodeType: "actor",
      semanticType: "subentity",
      subentity: true,
      actorStatus: entity.level === "high" ? "active" : "candidate",
      epistemicStatus: "inferred",
      runtimeKind: "subentity",
      ...entity
    })),
    ...(state.narratives || []).map(narrative => ({
      ...narrative,
      nodeType: "subentity_narrative",
      epistemicStatus: narrative.epistemicStatus || "inferred",
      runtimeKind: "subentity_narrative"
    })),
    ...(state.moments || []).map(moment => ({
      ...moment,
      nodeType: "memory",
      epistemicStatus: moment.epistemicStatus || "observed",
      claimNature: moment.claimNature || "runtime_memory",
      runtimeKind: "memory_moment"
    })),
    ...(state.events || []).filter(event => event.id).map(event => ({
      ...event,
      nodeType: "lifecycle_event",
      epistemicStatus: "observed",
      runtimeKind: "lifecycle_event"
    }))
  ];
  const byId = new Map();
  for (const node of runtimeNodes) byId.set(node.id, { ...(byId.get(node.id) || {}), ...node });
  const nodes = [...byId.values()].map(node => ({
    id: node.id,
    props: graphProperties({ ...node, runtimeManaged: true, runtimeRevision: revision })
  }));
  const relations = (state.relations || []).map(relation => ({
    id: relation.id,
    source: relation.source,
    target: relation.target,
    props: graphProperties({ ...relation, runtimeManaged: true, runtimeRevision: revision })
  }));
  return { revision, nodes, relations };
}

export async function readFalkorSubentityState(graph) {
  let result;
  try {
    result = await graph.roQuery(`
      MATCH (root:L1RuntimeState {id:'subentity-runtime'})
      RETURN root.stateJson AS stateJson, root.revision AS revision,
             root.projectionRevision AS projectionRevision, root.projectionError AS projectionError
    `);
  } catch (error) {
    if (/empty key/i.test(error.message)) return { state: clone(EMPTY_SUBENTITY_RUNTIME_STATE), revision: 0, projectionRevision: 0, projectionError: null };
    throw error;
  }
  const row = result.data?.[0];
  if (!row?.stateJson) return { state: clone(EMPTY_SUBENTITY_RUNTIME_STATE), revision: 0, projectionRevision: 0, projectionError: null };
  const state = JSON.parse(row.stateJson);
  return {
    state,
    revision: Number(row.revision ?? state.revision ?? 0),
    projectionRevision: Number(row.projectionRevision ?? 0),
    projectionError: row.projectionError || null
  };
}

async function commitSnapshot(graph, state, expectedRevision) {
  const result = await graph.query(`
    MERGE (root:L1RuntimeState {id:'subentity-runtime'})
    ON CREATE SET root.revision = 0, root.projectionRevision = 0
    WITH root
    WHERE root.revision = $expectedRevision
    SET root.stateJson = $stateJson,
        root.revision = $nextRevision,
        root.updatedAt = $updatedAt,
        root.projectionError = null
    RETURN root.revision AS revision
  `, { params: {
    expectedRevision,
    nextRevision: Number(state.revision),
    updatedAt: state.updatedAt || null,
    stateJson: JSON.stringify(state)
  } });
  if (!result.data?.length) throw new RuntimeRevisionConflictError(expectedRevision);
}

export async function projectSubentityStateToFalkor(graph, state) {
  const projection = projectSubentityRuntimeState(state);
  for (const node of projection.nodes) {
    await graph.query(`
      MERGE (n:L1Node {id:$id})
      SET n:L1RuntimeNode
      SET n += $props
    `, { params: node });
    const roleLabel = node.props.nodeType === "actor" ? "L1Actor"
      : node.props.nodeType === "moment" ? "L1Moment"
        : node.props.nodeType === "space" ? "L1Space" : null;
    if (roleLabel) await graph.query(`MATCH (n:L1Node {id:$id}) SET n:${roleLabel}`, { params: { id: node.id } });
  }
  for (const relation of projection.relations) {
    await graph.query(`
      MATCH (source {id:$source}), (target {id:$target})
      MERGE (source)-[relation:REL {id:$id}]->(target)
      SET relation += $props
    `, { params: relation });
  }
  await graph.query(`
    MATCH ()-[relation:REL]->()
    WHERE relation.runtimeManaged = true AND relation.runtimeRevision < $revision
    DELETE relation
  `, { params: { revision: projection.revision } });
  await graph.query(`
    MATCH (node:L1RuntimeNode)
    WHERE node.runtimeManaged = true AND node.runtimeRevision < $revision
    DETACH DELETE node
  `, { params: { revision: projection.revision } });
  await graph.query(`
    MATCH (root:L1RuntimeState {id:'subentity-runtime'})
    WHERE root.revision = $revision
    SET root.projectionRevision = $revision, root.projectionError = null
  `, { params: { revision: projection.revision } });
  return { revision: projection.revision, nodeCount: projection.nodes.length, relationCount: projection.relations.length };
}

export async function persistFalkorSubentityState(graph, state, expectedRevision) {
  await commitSnapshot(graph, state, expectedRevision);
  try {
    const projection = await projectSubentityStateToFalkor(graph, state);
    return { persisted: true, projectionStatus: "current", projection };
  } catch (error) {
    await graph.query(`
      MATCH (root:L1RuntimeState {id:'subentity-runtime'})
      WHERE root.revision = $revision
      SET root.projectionError = $message
    `, { params: { revision: Number(state.revision), message: error.message } }).catch(() => {});
    return { persisted: true, projectionStatus: "repair_required", projectionError: error.message };
  }
}

export async function repairFalkorSubentityProjection(graph) {
  const current = await readFalkorSubentityState(graph);
  const projection = await projectSubentityStateToFalkor(graph, current.state);
  return { repaired: true, projection };
}

export async function applyFalkorSubentityLifecycleTick({ graph, input, policy, maxRetries = 3 }) {
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const current = await readFalkorSubentityState(graph);
    const lifecycle = runSubentityLifecycleTick(current.state, input, { policy });
    if (!lifecycle.report.changed) return { ...lifecycle, persisted: false, projectionStatus: current.projectionRevision === current.revision ? "current" : "repair_required", attempts: attempt };
    try {
      const persistence = await persistFalkorSubentityState(graph, lifecycle.state, current.revision);
      return { ...lifecycle, ...persistence, attempts: attempt };
    } catch (error) {
      if (!(error instanceof RuntimeRevisionConflictError) || attempt === maxRetries) throw error;
    }
  }
  throw new Error("Unreachable lifecycle retry state.");
}
