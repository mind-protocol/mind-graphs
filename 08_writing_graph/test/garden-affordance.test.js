import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AFFORD, CAUSAL_MATERIALS, CORROBORATING_PREDICATES, VITALITY,
  affordOf, causalMateriality, isCausalPredicate, vitalityOf
} from "../public/garden-affordance.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ontology = JSON.parse(await fs.readFile(path.resolve(__dirname, "../data/graph-ontology.json"), "utf8"));

test("affordance mapping only names predicates the ontology still activates", () => {
  const active = new Set(ontology.relationTypes.filter(type => type.status === "active").map(type => type.id));
  for (const predicate of Object.keys(AFFORD)) assert.ok(active.has(predicate), `${predicate} is not an active relation`);
  for (const predicate of CORROBORATING_PREDICATES) assert.ok(active.has(predicate), `${predicate} is not an active relation`);
});

test("provenance scope wins over the predicate table", () => {
  assert.equal(affordOf({ type: "CAUSES" }).kind, "causal");
  assert.equal(affordOf({ type: "CAUSES", relationScope: "provenance" }).kind, "root");
  assert.equal(affordOf({ type: "UNKNOWN_PREDICATE" }).kind, "road");
});

test("the canonical causal predicates are the ones governed by edge quantification", () => {
  const canonical = ontology.causalContract.canonicalCause.predicate;
  assert.ok(isCausalPredicate({ type: canonical }));
  assert.ok(isCausalPredicate({ type: "LEADS_TO" }));
  assert.ok(!isCausalPredicate({ type: "FEEDS" }), "FEEDS is a channel, not an asserted effect");
});

test("a bare causal claim stays a rope bridge", () => {
  const bare = causalMateriality({ type: "CAUSES" });
  assert.equal(bare.material, CAUSAL_MATERIALS.rope);
  assert.equal(bare.quantified, false);
  assert.equal(bare.confidence, 0);
  assert.equal(bare.confidenceKnown, false);
});

test("evidence basis cannot promote an edge that carries no effect size", () => {
  const claimed = causalMateriality({ type: "CAUSES", evidenceBasis: "real_world" });
  assert.equal(claimed.material, CAUSAL_MATERIALS.rope);
  assert.match(claimed.reason, /sans effectSizePct/);
});

test("the material ladder follows the evidence basis of a quantified edge", () => {
  const ladder = [
    [undefined, CAUSAL_MATERIALS.rope],
    ["assertion", CAUSAL_MATERIALS.taut_rope],
    ["simulation", CAUSAL_MATERIALS.plank],
    ["real_world", CAUSAL_MATERIALS.stone]
  ];
  for (const [evidenceBasis, expected] of ladder) {
    const result = causalMateriality({ type: "CAUSES", effectSizePct: 12, confidenceScore: 0.4, evidenceBasis });
    assert.equal(result.material, expected, `basis ${evidenceBasis}`);
  }
  const ranks = ladder.map(([, material]) => material.rank);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  const sags = ladder.map(([, material]) => material.sag);
  assert.deepEqual(sags, [...sags].sort((a, b) => b - a), "a firmer material must sag less");
});

test("every evidence basis admitted on a causal edge has a material", () => {
  for (const basis of ontology.linkQuantification.admittedRungs) {
    const result = causalMateriality({ type: "CAUSES", effectSizePct: 5, evidenceBasis: basis });
    assert.notEqual(result.material, CAUSAL_MATERIALS.rope, `basis ${basis} has no material`);
  }
});

// L'échelle de preuve est générale (elle vaut aussi pour les paramètres du code)
// alors que les matières de la cité-jardin sont calées sur quatre rangs. Un
// barreau admis sur une arête sans matière correspondante retomberait en silence
// sur la corde, faisant passer une preuve pour une affirmation nue.
test("a rung admitted on causal edges is a rung of the general ladder", () => {
  const rungs = new Set(ontology.evidenceLadder.rungs.map(rung => rung.id));
  for (const basis of ontology.linkQuantification.admittedRungs) {
    assert.ok(rungs.has(basis), `admitted rung ${basis} is absent from evidenceLadder`);
  }
});

test("corroboration is an anchor, never a promotion of the material", () => {
  const anchored = causalMateriality({ type: "CAUSES" }, { corroborated: true });
  assert.equal(anchored.material, CAUSAL_MATERIALS.rope);
  assert.equal(anchored.corroborated, true);
});

test("epistemic status governs the plot material and never lies by default", () => {
  assert.equal(vitalityOf({ epistemicStatus: "documented" }).plot, "solid");
  assert.equal(vitalityOf({ epistemicStatus: "design_proposal" }).plot, "scaffold");
  assert.equal(vitalityOf({ epistemicStatus: "unresolved" }).plot, "chasm");
  assert.equal(vitalityOf({ epistemicStatus: "test_target" }).plot, "foundation");
  assert.equal(vitalityOf({}).plot, "scaffold", "an unknown status must not be rendered as finished masonry");
});

test("only a documented status earns the material of a finished building", () => {
  const solid = Object.values(VITALITY).filter(v => v.plot === "solid").map(v => v.key);
  assert.deepEqual([...new Set(solid)], ["documented"]);
});

// Le garde-fou anti-mensonge ne tient que si AUCUN statut ne retombe en silence
// sur le défaut : un `refuted` rendu en chantier annoncerait un ouvrage en cours.
test("the vitality table covers the ontology statuses exactly", () => {
  const declared = ontology.epistemicStatuses.map(status => status.id).sort();
  assert.deepEqual(Object.keys(VITALITY).sort(), declared);
});

test("every epistemic status maps to a known plot material", () => {
  const materials = new Set(["solid", "sprout", "scaffold", "foundation", "mirage", "chasm", "ruin"]);
  for (const status of ontology.epistemicStatuses) {
    assert.ok(materials.has(vitalityOf({ epistemicStatus: status.id }).plot), `status ${status.id}`);
  }
});

test("a refuted or superseded claim is a ruin, never a construction site", () => {
  for (const status of ["refuted", "superseded"]) {
    assert.equal(vitalityOf({ epistemicStatus: status }).plot, "ruin", status);
  }
});
