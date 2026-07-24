import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = async (p) => JSON.parse(await fs.readFile(path.resolve(__dirname, p), "utf8"));

const vocab = await read("../l1/data/l1-behavior-vocabulary.json");
const design = await read("../data/l1-design.json");
const designById = new Map(design.nodes.map(n => [n.id, n]));

const UNIVERSAL = ["Actor", "Moment", "Narrative", "Space", "Thing"];

// Ce test est la couture entre la doctrine des sous-entités et le vocabulaire
// actif : il refuse silencieusement toute réification d'un terme d'usage
// (cluster, coalition) ou d'une propriété de statut (confirmedByHuman) en
// catégorie d'être, et vérifie que chaque terme métier se projette vers l'un
// des cinq types universels.

test("les cinq types universels sont exactement déclarés", () => {
  assert.deepEqual([...vocab.universalTypes].sort(), [...UNIVERSAL].sort());
});

test("chaque semanticType comportemental se projette vers un type universel", () => {
  for (const entry of vocab.behaviorSemanticTypes) {
    assert.ok(UNIVERSAL.includes(entry.universalNodeType), `${entry.semanticType} → ${entry.universalNodeType} n'est pas universel`);
  }
});

test("les douze semanticTypes comportementaux sont présents et alignés sur l1-design.json", () => {
  assert.equal(vocab.behaviorSemanticTypes.length, 12);
  for (const entry of vocab.behaviorSemanticTypes) {
    const source = designById.get(entry.sourceDesignId);
    assert.ok(source, `sourceDesignId inconnu dans l1-design.json: ${entry.sourceDesignId}`);
    assert.equal(source.semanticType, entry.semanticType, `${entry.sourceDesignId}: semanticType diverge de la source`);
    const expectedUniversal = source.nodeType[0].toUpperCase() + source.nodeType.slice(1);
    assert.equal(entry.universalNodeType, expectedUniversal, `${entry.sourceDesignId}: projection ${entry.universalNodeType} ≠ nodeType source ${expectedUniversal}`);
  }
});

test("aucun nodeType subentity, cluster ou coalition n'est introduit comme type", () => {
  const raw = JSON.stringify(vocab);
  for (const forbidden of ['"universalNodeType":"subentity"', '"universalNodeType": "subentity"', '"universalNodeType":"Cluster"', '"universalNodeType":"Coalition"']) {
    assert.ok(!raw.includes(forbidden), `type interdit présent: ${forbidden}`);
  }
  for (const entry of vocab.behaviorSemanticTypes) {
    assert.notEqual(entry.semanticType, "Cluster");
    assert.notEqual(entry.semanticType, "Coalition");
  }
});

test("confirmedByHuman et ses variantes sont retirés et remplacés par un Moment RATIFIED_IN", () => {
  const raw = JSON.stringify(vocab.behaviorSemanticTypes) + JSON.stringify(vocab.ephemeralRuntimeObjects) + JSON.stringify(vocab.predicateFamilies);
  for (const forbidden of ["confirmedByHuman", "humanConfirmed", "isRatified", "humanValidated"]) {
    assert.ok(!raw.includes(forbidden), `propriété interdite portée par une entité: ${forbidden}`);
  }
  assert.deepEqual(vocab.ratification.removedProperties.sort(), ["confirmedByHuman", "humanConfirmed", "humanValidated", "isRatified"]);
  assert.match(vocab.ratification.canonicalForm, /RATIFIED_IN/);
  assert.match(vocab.ratification.canonicalForm, /AUTHORED_BY/);
  assert.equal(vocab.ratification.absenceMeaning, "ratification humaine non observée");
});

test("les quatre familles de prédicats du spec sont séparées et enregistrées", () => {
  for (const family of ["policy_modulation", "gating", "salience", "attention_recruitment"]) {
    assert.ok(vocab.predicateFamilies[family], `famille de prédicats absente: ${family}`);
  }
  const byFamily = {
    policy_modulation: ["INCREASES_PROPENSITY", "DECREASES_PROPENSITY"],
    gating: ["INHIBITS"],
    salience: ["MAKES_SALIENT"],
    attention_recruitment: ["RECRUITS"]
  };
  for (const [family, ids] of Object.entries(byFamily)) {
    const present = vocab.predicateFamilies[family].predicates.map(p => p.id).sort();
    assert.deepEqual(present, [...ids].sort(), `famille ${family} mal peuplée`);
  }
});

test("chaque prédicat déclare les six dimensions de physique exigées", () => {
  const required = ["id", "meaning", "endpoints", "runtimeEffect", "energyTransport", "attentionEffect", "causalClaim"];
  for (const family of Object.values(vocab.predicateFamilies)) {
    for (const predicate of family.predicates) {
      for (const key of required) {
        assert.ok(key in predicate, `${predicate.id} n'a pas déclaré ${key}`);
      }
      assert.ok("sourceSemanticTypes" in predicate.endpoints && "targetSemanticTypes" in predicate.endpoints, `${predicate.id}: contrat d'extrémités incomplet`);
    }
  }
});

test("aucune physique commune abusive : seul PULSE transporte de l'énergie", () => {
  for (const family of Object.values(vocab.predicateFamilies)) {
    for (const predicate of family.predicates) {
      assert.equal(predicate.energyTransport, "none", `${predicate.id} ne doit transporter aucune énergie`);
    }
  }
  const pulse = vocab.cortexPrimitives.primitives.find(p => p.name === "PULSE");
  assert.equal(pulse.energyTransport, "finite_conserved");
  for (const primitive of vocab.cortexPrimitives.primitives) {
    if (primitive.name !== "PULSE") assert.equal(primitive.energyTransport, "none", `${primitive.name} ne doit pas transporter d'énergie`);
  }
});

test("huit CortexState, aucun ne force une ActionExecution", () => {
  assert.equal(vocab.cortexStates.count, 8);
  assert.equal(vocab.cortexStates.states.length, 8);
  assert.equal(vocab.cortexStates.producesActionExecution, false);
  assert.equal(vocab.cortexStates.universalNodeType, "Thing");
  for (const state of vocab.cortexStates.states) {
    assert.ok(designById.get(state.sourceDesignId), `état cortex inconnu dans l1-design.json: ${state.sourceDesignId}`);
  }
});

test("les objets runtime éphémères ne deviennent jamais Actor ni ne portent énergie ou attention", () => {
  const expected = ["NodeSelection", "SubentityFieldSnapshot", "AttentionFieldSnapshot", "WorkspaceBid", "PatternObservation", "SubentityHypothesis", "VisualRegion"];
  assert.deepEqual(vocab.ephemeralRuntimeObjects.map(o => o.id).sort(), [...expected].sort());
  for (const obj of vocab.ephemeralRuntimeObjects) {
    assert.equal(obj.becomesActor, false, `${obj.id} ne doit jamais devenir Actor`);
    assert.equal(obj.carriesEnergy, false, `${obj.id} ne doit porter aucune énergie`);
    assert.equal(obj.carriesAttention, false, `${obj.id} ne doit porter aucune attention`);
  }
});

test("la reclassification couvre tous les usages de cluster et coalition du spec", () => {
  const coalition = vocab.reclassification.coalition;
  for (const key of ["temporaryNodeGroup", "subentityCurrentField", "workspaceProposal", "recurringUnattributedGroup", "identityHypothesis"]) {
    assert.ok(coalition[key], `usage coalition non reclassé: ${key}`);
  }
  const cluster = vocab.reclassification.cluster;
  for (const key of ["semanticCluster", "blueprintCluster", "mapCluster", "subentityMembership", "subentityAttention", "recurringCluster"]) {
    assert.ok(cluster[key], `usage cluster non reclassé: ${key}`);
  }
});
