const COMPONENTS = Object.freeze([
  "semantic", "structure", "goal", "frontier", "risk", "evidence", "active"
]);

const profile = (question, searchText, componentWeights, predicates, routing) => Object.freeze({
  question,
  searchText,
  componentWeights: Object.freeze(componentWeights),
  predicates: Object.freeze(predicates),
  routing: Object.freeze(routing)
});

/**
 * Chaque état Cortex change une opération de recherche observable. Les poids
 * ne créent pas d'énergie : ils composent la requête et biaisent les sorties
 * admissibles au moment où la physique répartit son budget local.
 */
export const CORTEX_SEARCH_PROFILES = Object.freeze({
  "state-monitoring": profile(
    "Qu'est-ce qui résonne avec mes motivations ?",
    "détecter une perception, une narration, une nouveauté ou une opportunité pertinente",
    { semantic: 0.45, frontier: 0.35, active: 0.2 },
    ["FEEDS", "MOTIVATES", "READ_BY"],
    { semanticGuidanceMultiplier: 0.75, explorationRate: 0.2 }
  ),
  "state-activation-evaluation": profile(
    "Est-ce important, faisable et observable ?",
    "évaluer utilité attendue, coût, menace, preuve, métrique et capacité de contrôle",
    { goal: 0.3, risk: 0.3, evidence: 0.25, semantic: 0.15 },
    ["MOTIVATES", "BLOCKS", "MEASURED_BY", "CAUSES"],
    { semanticGuidanceMultiplier: 1, explorationRate: 0.1 }
  ),
  "state-workspace-bidding": profile(
    "Pourquoi cette intention mérite-t-elle le workspace ?",
    "comparer écart mesuré, urgence, opportunité, risque et activité concurrente",
    { goal: 0.4, risk: 0.25, active: 0.2, evidence: 0.15 },
    ["TARGETS", "MEASURED_BY", "MOTIVATES", "BLOCKS"],
    { semanticGuidanceMultiplier: 1.1, explorationRate: 0.08 }
  ),
  "state-targeting-planning": profile(
    "Qu'est-ce qui manque pour atteindre la cible ?",
    "chercher prérequis absent, question bloquante, méthode, mécanisme, capacité et chemin qui débloque",
    { goal: 0.35, frontier: 0.3, structure: 0.15, risk: 0.15, evidence: 0.05 },
    ["DEPENDS_ON", "BLOCKS", "IMPLEMENTS", "USES_METHOD", "UNLOCKS"],
    { semanticGuidanceMultiplier: 1.35, explorationRate: 0.08 }
  ),
  "state-execution": profile(
    "Quel opérateur concret transforme maintenant l'état ?",
    "atteindre une action, un outil, une méthode et sa cible immédiate dans le plan sélectionné",
    { active: 0.35, goal: 0.3, structure: 0.2, frontier: 0.1, semantic: 0.05 },
    ["IMPLEMENTS", "FEEDS", "UNLOCKS", "USES"],
    { semanticGuidanceMultiplier: 1.6, explorationRate: 0.03 }
  ),
  "state-feedback-monitoring": profile(
    "Le résultat correspond-il à la prédiction ?",
    "chercher observation, métrique, contradiction, cause d'écart et correction locale",
    { evidence: 0.4, risk: 0.25, active: 0.2, goal: 0.15 },
    ["OBSERVES", "MEASURES", "PRODUCES", "TESTS", "CONTRADICTS"],
    { semanticGuidanceMultiplier: 1.2, explorationRate: 0.08 }
  ),
  "state-closure-consolidation": profile(
    "Quelle trajectoire a réellement réussi ?",
    "retrouver le chemin exécuté, son observation, sa mesure et le progrès effectivement attribuable",
    { evidence: 0.4, active: 0.3, structure: 0.15, goal: 0.15 },
    ["OBSERVES", "MEASURES", "PRODUCES", "DOCUMENTS_PROGRESS"],
    { semanticGuidanceMultiplier: 1, explorationRate: 0.02 }
  ),
  "state-frustration-pivot": profile(
    "Pourquoi cela bloque et quelles alternatives n'ai-je pas essayées ?",
    "chercher obstacle persistant, question non résolue, option différente, détour et capacité absente",
    { frontier: 0.35, risk: 0.3, evidence: 0.2, semantic: 0.1, structure: 0.05 },
    ["BLOCKS", "CONTRADICTS", "OPTION_FOR", "ADDRESSES", "UNLOCKS"],
    { semanticGuidanceMultiplier: 0.7, explorationRate: 0.3 }
  )
});

export const AFFECT_SEARCH_PROFILES = Object.freeze({
  curiosity: { searchText: "information nouvelle qui réduit l'incertitude", componentBoosts: { frontier: 0.5, evidence: 0.35 } },
  desire: { searchText: "chemin réalisable vers l'objectif et sa récompense attendue", componentBoosts: { goal: 0.55, active: 0.25 } },
  care: { searchText: "vulnérabilité importante, dépendance et protection possible", componentBoosts: { risk: 0.4, goal: 0.25, evidence: 0.2 } },
  fearOfError: { searchText: "preuve falsifiante, incertitude, test et condition d'échec", componentBoosts: { evidence: 0.55, risk: 0.35 } },
  frustration: { searchText: "blocage, prérequis absent, stratégie alternative et chemin non essayé", componentBoosts: { risk: 0.45, frontier: 0.45 } },
  surprise: { searchText: "explication de l'écart prédictif, anomalie analogue et nouvelle hypothèse", componentBoosts: { evidence: 0.5, frontier: 0.35 } },
  anger: { searchText: "violation de frontière, contrainte, protection et capacité d'agence", componentBoosts: { risk: 0.5, frontier: 0.25 } }
});

const finiteVector = value => Array.isArray(value) && value.length > 0 && value.every(Number.isFinite);
const normalize = vector => {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm ? vector.map(value => value / norm) : vector;
};
const weightedMean = (vectors, dimensions) => {
  const total = vectors.reduce((sum, item) => sum + item.weight, 0);
  if (!total) return Array(dimensions).fill(0);
  const result = Array(dimensions).fill(0);
  for (const { vector, weight } of vectors) {
    if (!finiteVector(vector) || vector.length !== dimensions || weight <= 0) continue;
    for (let index = 0; index < dimensions; index += 1) result[index] += vector[index] * weight;
  }
  return normalize(result.map(value => value / total));
};
const normalizeWeights = weights => {
  const clean = Object.fromEntries(COMPONENTS.map(key => [key, Math.max(0, Number(weights[key]) || 0)]));
  const total = Object.values(clean).reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(Object.entries(clean).map(([key, value]) => [key, value / total]));
};
const idOf = endpoint => typeof endpoint === "object" ? endpoint?.id : endpoint;
const nodeText = node => [node?.name, node?.phrase, node?.summary, node?.description, node?.semanticType].filter(Boolean).join(" | ");

export async function composeDynamicSearchIntent(workspace, nodes, embed) {
  const cortexState = workspace.cortexState || workspace.activeSubentity?.cortexState || "state-monitoring";
  const cortex = CORTEX_SEARCH_PROFILES[cortexState];
  if (!cortex) throw new Error(`Unknown Cortex state: ${cortexState}`);
  const affectVector = workspace.affectVector || workspace.activeSubentity?.affectVector || {};
  const weights = { ...cortex.componentWeights };
  const activeAffects = [];
  for (const [affect, definition] of Object.entries(AFFECT_SEARCH_PROFILES)) {
    const intensity = Math.max(0, Math.min(1, Number(affectVector[affect]) || 0));
    if (!intensity) continue;
    activeAffects.push({ affect, intensity, searchText: definition.searchText });
    for (const [component, boost] of Object.entries(definition.componentBoosts)) {
      weights[component] = (weights[component] || 0) + boost * intensity;
    }
  }
  const componentWeights = normalizeWeights(weights);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const goals = (workspace.goalIds || []).map(id => byId.get(id)).filter(Boolean);
  const identityText = [
    workspace.activeSubentity?.name,
    workspace.activeSubentity?.identity,
    ...(workspace.activeSubentity?.motivations || []),
    ...(workspace.activeSubentity?.strategies || [])
  ].filter(Boolean).join(" | ");
  const texts = [
    { role: "workspace", weight: 1, text: [workspace.name, workspace.text, workspace.summary].filter(Boolean).join(" | ") },
    { role: "identity", weight: identityText ? 0.8 : 0, text: identityText },
    { role: "goal", weight: goals.length ? 1.2 : 0, text: goals.map(nodeText).join(" | ") },
    { role: "cortex", weight: 1, text: `${cortex.question} ${cortex.searchText}` },
    { role: "affect", weight: activeAffects.reduce((sum, item) => sum + item.intensity, 0), text: activeAffects.map(item => item.searchText).join(" | ") },
    { role: "predictionResidual", weight: workspace.predictionResidual ? 1.1 : 0, text: workspace.predictionResidual || "" }
  ].filter(item => item.weight > 0 && item.text);
  const embedded = await Promise.all(texts.map(async item => ({ ...item, vector: await embed(item.text) })));
  const dimensions = embed.metadata?.dimensions || embedded[0]?.vector.length || 0;
  const embedding = weightedMean(embedded, dimensions);
  const predicateBoosts = Object.fromEntries(cortex.predicates.map(predicate => [predicate, 1.35]));
  return {
    cortexState,
    question: cortex.question,
    activeAffects,
    componentWeights,
    predicateBoosts,
    routing: { ...cortex.routing },
    embedding,
    embeddingParts: embedded.map(({ role, weight, text }) => ({ role, weight, text }))
  };
}

const semanticKind = node => String(node.semanticType || node.nodeType || "").toLowerCase();
const isGoal = node => semanticKind(node).includes("goal") || (semanticKind(node) === "system_state" && node.stateOrientation === "desirable");
const isRisk = node => node.stateOrientation === "undesirable" || /risk|threat|block|error/.test(`${semanticKind(node)} ${node.name || ""}`.toLowerCase());
const isEvidence = node => /observation|experiment|metric|estimate|dataset|evidence/.test(semanticKind(node));
const linkPhysicsWeight = link => {
  const physics = link.physics || {};
  const weight = Number(physics.W ?? link.W ?? 1);
  const gate = Number(physics.G ?? link.G ?? 1);
  const polarity = Math.abs(Number(physics.P ?? link.P ?? 1));
  const stability = Number(physics.S ?? link.S ?? 1);
  return Math.max(0, weight) * Math.max(0, gate) * polarity * Math.max(0, stability);
};

export function buildClusterEmbeddingProfiles(nodes, links, { activeEnergyByNode = {} } = {}) {
  const dimensions = nodes.find(node => finiteVector(node.embedding))?.embedding.length || 0;
  const byId = new Map(nodes.map(node => [node.id, node]));
  const clusters = new Map();
  const ensure = clusterId => {
    if (!clusters.has(clusterId)) clusters.set(clusterId, { nodes: [], internalLinks: [], frontierLinks: [] });
    return clusters.get(clusterId);
  };
  for (const node of nodes) ensure(node.clusterId || "(hors cluster)").nodes.push(node);
  for (const link of links) {
    const source = byId.get(idOf(link.source));
    const target = byId.get(idOf(link.target));
    if (!source || !target || !finiteVector(link.embedding)) continue;
    const sourceCluster = source.clusterId || "(hors cluster)";
    const targetCluster = target.clusterId || "(hors cluster)";
    if (sourceCluster === targetCluster) ensure(sourceCluster).internalLinks.push(link);
    else {
      ensure(sourceCluster).frontierLinks.push(link);
      ensure(targetCluster).frontierLinks.push(link);
    }
  }
  return [...clusters].map(([clusterId, cluster]) => {
    const nodeVectors = selector => cluster.nodes.filter(selector).map(node => ({ vector: node.embedding, weight: 1 }));
    const linkVectors = collection => collection.map(link => ({ vector: link.embedding, weight: linkPhysicsWeight(link) }));
    const activeVectors = cluster.nodes.map(node => ({
      vector: node.embedding,
      weight: Math.max(0, Number(activeEnergyByNode[node.id]) || 0)
    }));
    return {
      clusterId,
      embeddingModel: cluster.nodes.find(node => node.embeddingModel)?.embeddingModel || null,
      embeddingModelVersion: cluster.nodes.find(node => node.embeddingModelVersion)?.embeddingModelVersion || null,
      components: {
        semantic: weightedMean(nodeVectors(() => true), dimensions),
        structure: weightedMean(linkVectors(cluster.internalLinks), dimensions),
        goal: weightedMean(nodeVectors(isGoal), dimensions),
        frontier: weightedMean(linkVectors(cluster.frontierLinks), dimensions),
        risk: weightedMean(nodeVectors(isRisk), dimensions),
        evidence: weightedMean(nodeVectors(isEvidence), dimensions),
        active: weightedMean(activeVectors, dimensions)
      },
      counts: {
        nodes: cluster.nodes.length,
        internalLinks: cluster.internalLinks.length,
        frontierLinks: cluster.frontierLinks.length
      }
    };
  });
}

const cosine = (left, right) => {
  if (!finiteVector(left) || !finiteVector(right) || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
};

export function rankClusterEmbeddingProfiles(queryEmbedding, profiles, componentWeights, { limit = 10 } = {}) {
  const weights = normalizeWeights(componentWeights || { semantic: 1 });
  return profiles.map(profile => {
    const contributions = Object.fromEntries(COMPONENTS.map(component => [
      component,
      weights[component] * cosine(queryEmbedding, profile.components[component])
    ]));
    return {
      clusterId: profile.clusterId,
      score: Object.values(contributions).reduce((sum, value) => sum + value, 0),
      contributions
    };
  }).sort((left, right) => right.score - left.score).slice(0, limit);
}

export { COMPONENTS as CLUSTER_EMBEDDING_COMPONENTS };
