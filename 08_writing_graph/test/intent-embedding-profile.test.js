import test from "node:test";
import assert from "node:assert/strict";
import {
  AFFECT_SEARCH_PROFILES,
  CORTEX_SEARCH_PROFILES,
  buildClusterEmbeddingProfiles,
  composeDynamicSearchIntent,
  rankClusterEmbeddingProfiles
} from "../src/intent-embedding-profile.js";
import { createLocalEmbedder, embedLinks, embedNodes, embedWorkspace } from "../src/local-embedding.js";
import { buildPhysicsIndex, semanticRoutingShares } from "../src/l4-physics.js";

test("les huit états Cortex et les sept affects runtime ont une intention de recherche", () => {
  assert.equal(Object.keys(CORTEX_SEARCH_PROFILES).length, 8);
  assert.equal(Object.keys(AFFECT_SEARCH_PROFILES).length, 7);
  for (const definition of Object.values(CORTEX_SEARCH_PROFILES)) {
    assert.ok(definition.question);
    assert.ok(definition.searchText);
    assert.ok(Object.values(definition.componentWeights).reduce((sum, value) => sum + value, 0) > 0);
    assert.ok(definition.predicates.length > 0);
  }
});

test("planning avec frustration compose une requête orientée manque et alternatives", async () => {
  const embed = createLocalEmbedder({ dimensions: 64 });
  const nodes = await embedNodes([
    { id: "goal", name: "Réparer le graphe", semanticType: "subentity_goal", clusterId: "work" }
  ], embed, { force: true });
  const intent = await composeDynamicSearchIntent({
    text: "Atteindre l'objectif mesurable",
    goalIds: ["goal"],
    cortexState: "state-targeting-planning",
    affectVector: { frustration: 0.9 },
    activeSubentity: { name: "Réparateur", identity: "Cherche les capacités absentes" }
  }, nodes, embed);
  assert.equal(intent.embedding.length, 64);
  assert.equal(intent.cortexState, "state-targeting-planning");
  assert.ok(intent.componentWeights.frontier > intent.componentWeights.semantic);
  assert.ok(intent.componentWeights.risk > 0);
  assert.equal(intent.predicateBoosts.DEPENDS_ON, 1.35);
  assert.equal(intent.predicateBoosts.BLOCKS, 1.35);
  assert.ok(intent.activeAffects.some(item => item.affect === "frustration"));
});

test("le workspace dynamique utilise l'intention composée comme embedding de propagation", async () => {
  const embed = createLocalEmbedder({ dimensions: 64 });
  const nodes = await embedNodes([
    { id: "goal", name: "Objectif vérifiable", semanticType: "subentity_goal", clusterId: "work" }
  ], embed, { force: true });
  const workspace = await embedWorkspace({
    id: "w",
    text: "Améliorer le système",
    goalIds: ["goal"],
    cortexState: "state-feedback-monitoring",
    affectVector: { surprise: 0.8 },
    predictionResidual: "Le test attendu vert reste rouge"
  }, nodes, embed, { force: true });
  assert.deepEqual(workspace.embedding, workspace.intentProfile.embedding);
  assert.equal(workspace.intentProfile.question, "Le résultat correspond-il à la prédiction ?");
  assert.ok(workspace.intentProfile.componentWeights.evidence > workspace.intentProfile.componentWeights.goal);
});

test("un profil de cluster sépare contenu, physique interne, frontière, buts, risques et preuves", async () => {
  const embed = createLocalEmbedder({ dimensions: 64 });
  const nodes = await embedNodes([
    { id: "goal", name: "État cible", semanticType: "system_state", stateOrientation: "desirable", clusterId: "A" },
    { id: "risk", name: "Risque de blocage", semanticType: "system_state", stateOrientation: "undesirable", clusterId: "A" },
    { id: "obs", name: "Observation du résultat", semanticType: "observation", clusterId: "A" },
    { id: "outside", name: "Capacité externe", semanticType: "method", clusterId: "B" }
  ], embed, { force: true });
  const links = await embedLinks([
    { source: "obs", target: "goal", type: "OBSERVES", physics: { W: 0.9, G: 1, P: 1, S: 0.8 } },
    { source: "risk", target: "outside", type: "BLOCKS", physics: { W: 0.7, G: 1, P: -1, S: 0.9 } }
  ], nodes, embed, { force: true });
  const [cluster] = buildClusterEmbeddingProfiles(nodes, links, { activeEnergyByNode: { risk: 2 } })
    .filter(item => item.clusterId === "A");
  for (const component of ["semantic", "structure", "goal", "frontier", "risk", "evidence", "active"]) {
    assert.equal(cluster.components[component].length, 64, component);
  }
  assert.deepEqual(cluster.counts, { nodes: 3, internalLinks: 1, frontierLinks: 1 });
  assert.ok(cluster.components.structure.some(value => value !== 0));
  assert.ok(cluster.components.frontier.some(value => value !== 0));
});

test("les poids de composantes rendent le classement de clusters explicable", () => {
  const profiles = [
    { clusterId: "goal", components: { semantic: [0, 0], structure: [0, 0], goal: [1, 0], frontier: [0, 1], risk: [0, 0], evidence: [0, 0], active: [0, 0] } },
    { clusterId: "frontier", components: { semantic: [0, 0], structure: [0, 0], goal: [0, 1], frontier: [1, 0], risk: [0, 0], evidence: [0, 0], active: [0, 0] } }
  ];
  const goalFirst = rankClusterEmbeddingProfiles([1, 0], profiles, { goal: 0.8, frontier: 0.2 });
  const frontierFirst = rankClusterEmbeddingProfiles([1, 0], profiles, { goal: 0.2, frontier: 0.8 });
  assert.equal(goalFirst[0].clusterId, "goal");
  assert.equal(frontierFirst[0].clusterId, "frontier");
  assert.ok(Object.hasOwn(goalFirst[0].contributions, "goal"));
});

test("le profil d'état favorise ses prédicats sans modifier le budget distribué", () => {
  const nodes = [
    { id: "J", embedding: [1, 0], embeddingModel: "m", embeddingModelVersion: "1" },
    { id: "A", embedding: [1, 0], embeddingModel: "m", embeddingModelVersion: "1" },
    { id: "B", embedding: [1, 0], embeddingModel: "m", embeddingModelVersion: "1" }
  ];
  const links = [
    { source: "J", target: "A", type: "DEPENDS_ON", embedding: [1, 0], embeddingModel: "m", embeddingModelVersion: "1" },
    { source: "J", target: "B", type: "FEEDS", embedding: [1, 0], embeddingModel: "m", embeddingModelVersion: "1" }
  ];
  const index = buildPhysicsIndex(nodes, links, [
    { source: "DEPENDS_ON", polarity: [1, 0], permanence: 1 },
    { source: "FEEDS", polarity: [1, 0], permanence: 1 }
  ]);
  const candidates = index.entries.map(entry => ({ entry, weight: 1, magnitude: 1, junctionNode: "J" }));
  const shares = semanticRoutingShares(candidates, index, {
    workspaceEmbedding: [1, 0],
    embeddingModel: "m",
    embeddingModelVersion: "1",
    predicateBoosts: { DEPENDS_ON: 1.35 },
    routingTuning: { semanticGuidanceMultiplier: 1, explorationRate: 0 }
  }, { semanticGuidanceBeta: 0, semanticTemperature: 1, explorationRate: 0 });
  const byType = Object.fromEntries(shares.map(item => [item.entry.type, item.share]));
  assert.ok(byType.DEPENDS_ON > byType.FEEDS);
  assert.ok(Math.abs(Object.values(byType).reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
});
