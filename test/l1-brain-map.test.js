import test from "node:test";
import assert from "node:assert/strict";
import { buildProjectionBasis, projectVector, projectWeightedCentroid } from "../src/embedding-projection.js";
import { CONSTELLATION_POLICY, MAXIMUM_FIELD_SIZE, buildAttentionField, computeBarycentre } from "../src/l1-attention-field.js";
import { compileLiveTickInput } from "../src/l1-live-signals.js";
import { deriveSubentityState, describeFeeling } from "../src/l1-subentity-semantics.js";

const reference = [
  [1, 0, 0, 0], [0.9, 0.1, 0, 0], [0, 1, 0, 0], [0, 0.9, 0.1, 0], [0, 0, 1, 0], [0, 0, 0, 1]
];

test("la base de projection est déterministe : deux constructions donnent la même carte", () => {
  const first = buildProjectionBasis(reference);
  const second = buildProjectionBasis(reference);
  assert.deepEqual(first.axes, second.axes);
  const sample = [0.3, 0.6, 0.1, 0];
  assert.deepEqual(projectVector(first, sample), projectVector(second, sample));
});

test("un vecteur de dimension étrangère n'est pas projeté plutôt que projeté de travers", () => {
  const basis = buildProjectionBasis(reference);
  assert.equal(projectVector(basis, [1, 0]), null);
  assert.equal(projectVector(basis, null), null);
});

test("le barycentre pondéré se déplace vers le vecteur qui pèse le plus", () => {
  const basis = buildProjectionBasis(reference);
  const near = projectWeightedCentroid(basis, [
    { vector: [1, 0, 0, 0], weight: 0.95 },
    { vector: [0, 1, 0, 0], weight: 0.05 }
  ]);
  const far = projectWeightedCentroid(basis, [
    { vector: [1, 0, 0, 0], weight: 0.05 },
    { vector: [0, 1, 0, 0], weight: 0.95 }
  ]);
  const anchorA = projectVector(basis, [1, 0, 0, 0]);
  const distance = (left, right) => Math.hypot(left.x - right.x, left.y - right.y);
  assert.ok(distance(near, anchorA) < distance(far, anchorA));
});

test("le champ attentionnel applique le seuil d'admission et la capacité 7±2", () => {
  const nodes = Array.from({ length: 14 }, (_, index) => ({ id: `node-${index}`, share: 1 - index * 0.02 }));
  const field = buildAttentionField(nodes, new Map());
  assert.equal(field.measurementStatus, "derived");
  assert.ok(field.admitted.length <= MAXIMUM_FIELD_SIZE);
  assert.ok(field.admitted.every(node => node.alignment >= CONSTELLATION_POLICY.admissionThreshold));
  assert.equal(field.capacity.maximum, 9);
});

test("un nœud sous le seuil de rétention est élagué, pas gardé en périphérie", () => {
  const field = buildAttentionField([
    { id: "fort", share: 1 },
    { id: "moyen", share: 0.6 },
    { id: "faible", share: 0.2 }
  ], new Map());
  assert.deepEqual(field.admitted.map(node => node.id), ["fort"]);
  assert.deepEqual(field.periphery.map(node => node.id), ["moyen"]);
  assert.deepEqual(field.pruned.map(node => node.id), ["faible"]);
});

test("l'alignement se mesure contre le centre sémantique dès que les vecteurs existent", () => {
  const metadata = new Map([
    ["proche-a", { embedding: [1, 0, 0, 0] }],
    ["proche-b", { embedding: [0.95, 0.31, 0, 0] }],
    ["loin", { embedding: [-1, 0, 0, 0] }]
  ]);
  const field = buildAttentionField([
    { id: "proche-a", share: 0.4 },
    { id: "proche-b", share: 0.35 },
    { id: "loin", share: 0.25 }
  ], metadata);
  assert.equal(field.alignmentScale, "embedding_cosine");
  // Le nœud opposé au centre du champ tombe sous le seuil de rétention ; avec
  // la part d'activation relative il aurait été admis à 0,62.
  assert.ok(field.admitted.some(node => node.id === "proche-a"));
  assert.ok(field.pruned.some(node => node.id === "loin"));
});

test("sans vecteur, le repli sur la part relative est déclaré et non silencieux", () => {
  const field = buildAttentionField([{ id: "a", share: 1 }, { id: "b", share: 0.6 }], new Map());
  assert.equal(field.alignmentScale, "relative_share");
  assert.match(field.alignmentNote, /part d'activation relative/);
});

test("un champ sans cluster ne reçoit pas de centre de gravité fabriqué", () => {
  const barycentre = computeBarycentre([
    { id: "a", alignment: 1, clusterId: null },
    { id: "b", alignment: 0.9, clusterId: null }
  ]);
  assert.equal(barycentre.measurementStatus, "unavailable");
  assert.equal(barycentre.hue, null);
});

test("le centre de gravité suit le cluster qui concentre le plus de masse", () => {
  const barycentre = computeBarycentre([
    { id: "a", alignment: 1, clusterId: "temporal-membrane" },
    { id: "b", alignment: 0.9, clusterId: "temporal-membrane" },
    { id: "c", alignment: 0.75, clusterId: "project-work" }
  ]);
  assert.equal(barycentre.clusterId, "temporal-membrane");
  assert.ok(barycentre.concentration > 0.5);
  assert.equal(typeof barycentre.hue, "number");
});

const workspace = {
  id: "workspace-actor-nlr",
  version: 12,
  observedAt: "2026-07-23T22:36:04.228Z",
  contentHash: "abc123",
  activeNodeIds: ["node-a"],
  goalIds: ["goal-a"],
  cortexState: "state-monitoring",
  affectVector: {},
  consciousState: { attention: { measurementStatus: "carryover", intensity: 0 } }
};
const physics = {
  summary: { tick: 42, totalEnergy: 10, liveLinks: 3, byCitizen: [{ citizenId: "actor-nlr", energy: 4 }] },
  energy: { "node-a|GROUNDS|node-b": 2, "node-b|IMPLEMENTS|node-c": 1 }
};

test("l'entrée de tick est déterministe et ancre la preuve sur l'empreinte du workspace", () => {
  const first = compileLiveTickInput({ citizenId: "actor-nlr", workspace, physics });
  const second = compileLiveTickInput({ citizenId: "actor-nlr", workspace, physics });
  assert.equal(first.tickId, second.tickId);
  assert.equal(first.tickId, "live-actor-nlr-ws12-l4t42");
  assert.equal(first.observationId, "actor-nlr:abc123");
  assert.equal(first.recordedAt, workspace.observedAt);
});

test("l'acteur percevant est retiré de ses propres cibles sensorielles", () => {
  const input = compileLiveTickInput({
    citizenId: "actor-nlr",
    workspace,
    physics: { ...physics, energy: { ...physics.energy, "node-a|AUTHORED_BY|actor-nlr": 5 } }
  });
  assert.ok(!input.sensory.transfers.some(transfer => transfer.targetNodeId === "actor-nlr"));
});

test("un affect absent est déclaré non mesuré, jamais transmis comme neutre", () => {
  const input = compileLiveTickInput({ citizenId: "actor-nlr", workspace, physics });
  assert.deepEqual(input.affect, {});
  assert.ok(input.provenance.unavailable.includes("affect.vector"));
  assert.ok(input.provenance.unavailable.includes("workspace.focusIntensity"));
});

test("un workspace sans empreinte est refusé plutôt que daté au hasard", () => {
  assert.throws(
    () => compileLiveTickInput({ citizenId: "actor-nlr", workspace: { ...workspace, contentHash: null }, physics }),
    /evidence identity is undefined/
  );
  assert.throws(
    () => compileLiveTickInput({ citizenId: "actor-nlr", workspace: { ...workspace, observedAt: null }, physics }),
    /cannot be dated/
  );
});

test("l'état dérivé distingue conduire, soutenir et être écrasé par ses pénalités", () => {
  assert.equal(deriveSubentityState({ place: { role: "lead", admitted: true }, goals: ["g"] }).id, "state-execution");
  assert.equal(deriveSubentityState({ place: { role: "lead", admitted: true }, goals: [] }).id, "state-targeting-planning");
  assert.equal(deriveSubentityState({ place: { role: "support", admitted: true, rank: 2 } }).id, "state-workspace-bidding");
  assert.equal(deriveSubentityState({ place: { role: "silent", score: 0.2 } }).id, "state-activation-evaluation");
  assert.equal(deriveSubentityState({ place: { role: "silent", score: 0 } }).id, "state-monitoring");
  assert.equal(
    deriveSubentityState({ place: { role: "silent", positiveScore: 0.4, penalty: 0.5 } }).id,
    "state-frustration-pivot"
  );
  assert.equal(deriveSubentityState({ place: {}, promotedThisTick: true }).id, "state-closure-consolidation");
});

test("un affect non mesuré ne reçoit pas de visage neutre", () => {
  const silent = describeFeeling({ measurementStatus: "unavailable", reason: "aucune mesure" });
  assert.equal(silent.smiley, null);
  const measured = describeFeeling({ measurementStatus: "inferred", affect: "curiosity" });
  assert.equal(typeof measured.smiley, "string");
});
