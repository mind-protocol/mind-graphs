import { createHash } from "node:crypto";

const idOf = endpoint => typeof endpoint === "object" ? endpoint?.id : endpoint;
const finite = (value, name) => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} must be finite`);
  return number;
};
const unit = (value, name) => {
  const number = finite(value, name);
  if (number < 0 || number > 1) throw new Error(`${name} must be in [0,1]`);
  return number;
};
const nonnegative = (value, name) => {
  const number = finite(value, name);
  if (number < 0) throw new Error(`${name} must be non-negative`);
  return number;
};

function timestampOf(link) {
  const raw = link.lastTraversedAt ?? link.last_traversed_at ?? link.observedAt ?? link.updatedAt ?? link.createdAt;
  if (raw === undefined || raw === null) return null;
  const time = typeof raw === "number" ? raw : Date.parse(raw);
  return Number.isFinite(time) ? time : null;
}

function weightOf(link) {
  return Number(link.physics?.W ?? link.weight ?? link.W ?? 0);
}

function citizenAliases(nodes, configuredIds) {
  const aliases = new Set(configuredIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      const references = [node.id, node.correspondsTo, node.identityRef, node.citizenId].filter(Boolean);
      if ((node.citizen === true || references.some(reference => aliases.has(reference))) && references.some(reference => !aliases.has(reference))) {
        references.forEach(reference => aliases.add(reference));
        changed = true;
      }
    }
  }
  return aliases;
}

/** Sélectionne les relations incidentes fortes OU récentes dans chaque graphe autorisé. */
export function selectCitizenConnections(graphs, {
  citizenIds, minWeight, recentWindowMs, now
}) {
  if (!Array.isArray(citizenIds) || !citizenIds.length) throw new Error("citizenIds must be non-empty");
  const threshold = unit(minWeight, "minWeight");
  const window = nonnegative(recentWindowMs, "recentWindowMs");
  const clock = finite(now, "now");
  const selected = [];

  for (const graph of graphs) {
    if (graph.readAllowed === false) continue;
    const nodes = graph.nodes || [];
    const byId = new Map(nodes.map(node => [node.id, node]));
    const aliases = citizenAliases(nodes, citizenIds);
    for (const link of graph.links || graph.relations || []) {
      if (link.sensoryAllowed === false || link.permission === "denied") continue;
      const source = idOf(link.source);
      const target = idOf(link.target);
      if (!aliases.has(source) && !aliases.has(target)) continue;
      const weight = weightOf(link);
      const timestamp = timestampOf(link);
      const ageMs = timestamp === null ? null : Math.max(0, clock - timestamp);
      const strong = weight >= threshold;
      const recent = ageMs !== null && ageMs <= window;
      if (!strong && !recent) continue;
      selected.push({
        graphId: graph.id,
        source,
        target,
        sourceNode: byId.get(source) || { id: source, name: source },
        targetNode: byId.get(target) || { id: target, name: target },
        link,
        selectedBecause: { strong, recent },
        weight,
        timestamp,
        ageMs
      });
    }
  }
  return selected;
}

export function serializeSensoryConnection(connection) {
  const source = connection.sourceNode.name || connection.source;
  const target = connection.targetNode.name || connection.target;
  const predicate = connection.link.type || "RELATED_TO";
  const justification = connection.link.justification?.trim();
  return [
    `[${connection.graphId}] ${source} —${predicate}→ ${target}`,
    justification ? `raison: ${justification}` : null
  ].filter(Boolean).join(" | ");
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) throw new Error("Embeddings must be non-empty vectors of equal length");
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] ** 2;
    normB += b[index] ** 2;
  }
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}

export async function embedSensoryLines(connections, { embed, cache = new Map() }) {
  if (typeof embed !== "function") throw new Error("embed must be a function");
  const embedded = [];
  for (const connection of connections) {
    const line = serializeSensoryConnection(connection);
    const key = createHash("sha256").update(line).digest("hex");
    let embedding = cache.get(key);
    if (!embedding) {
      embedding = await embed(line);
      cache.set(key, embedding);
    }
    embedded.push({ ...connection, sensoryLine: line, sensoryLineHash: key, embedding });
  }
  return embedded;
}

/**
 * Distribue un budget fini entre les nœuds L1 similaires. Chaque ligne reçoit
 * une part égale du budget, puis la répartit proportionnellement aux similarités.
 */
export function routeSensoryEnergy(embeddedLines, l1Nodes, {
  sensoryEnergyBudget, minSimilarity, topK, citizenId, tickId
}) {
  const budget = nonnegative(sensoryEnergyBudget, "sensoryEnergyBudget");
  const threshold = unit(minSimilarity, "minSimilarity");
  if (!Number.isInteger(topK) || topK < 1) throw new Error("topK must be a positive integer");
  if (!citizenId) throw new Error("citizenId is required for energy attribution");
  if (!tickId) throw new Error("tickId is required for auditability");
  if (!embeddedLines.length || budget === 0) return { transfers: [], unallocatedEnergy: budget, allocatedEnergy: 0 };

  const perLineBudget = budget / embeddedLines.length;
  const transfers = [];
  for (const line of embeddedLines) {
    const candidates = l1Nodes
      .filter(node => Array.isArray(node.embedding))
      .map(node => ({ node, similarity: cosineSimilarity(line.embedding, node.embedding) }))
      .filter(candidate => candidate.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity || a.node.id.localeCompare(b.node.id))
      .slice(0, topK);
    const similarityTotal = candidates.reduce((sum, candidate) => sum + candidate.similarity, 0);
    for (const candidate of candidates) {
      transfers.push({
        sourceCitizenId: citizenId,
        targetNodeId: candidate.node.id,
        energy: perLineBudget * candidate.similarity / similarityTotal,
        similarity: candidate.similarity,
        sensoryLine: line.sensoryLine,
        sensoryLineHash: line.sensoryLineHash,
        sourceGraphId: line.graphId,
        sourceRelation: { source: line.source, type: line.link.type, target: line.target },
        tickId
      });
    }
  }
  const allocatedEnergy = transfers.reduce((sum, transfer) => sum + transfer.energy, 0);
  return { transfers, allocatedEnergy, unallocatedEnergy: Math.max(0, budget - allocatedEnergy) };
}

export async function runSensoryTick({ graphs, l1Nodes, embed, cache, config }) {
  if (!config) throw new Error("Sensory tick requires explicit config");
  const connections = selectCitizenConnections(graphs, config);
  const embeddedLines = await embedSensoryLines(connections, { embed, cache });
  const routing = routeSensoryEnergy(embeddedLines, l1Nodes, config);
  return {
    tickId: config.tickId,
    citizenId: config.citizenId,
    selectedConnections: connections,
    embeddedLines,
    ...routing
  };
}
