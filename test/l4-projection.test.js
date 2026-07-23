import test from "node:test";
import assert from "node:assert/strict";
import { projectGraph } from "../src/l4-projection.js";

const projection = await projectGraph("design");

test("tout le corpus reçoit un rôle physique et une signature de lien", () => {
  assert.deepEqual(projection.summary.unmappedNodeTypes, []);
  assert.deepEqual(projection.summary.unmappedPredicates, []);
  for (const node of projection.nodes) {
    assert.ok(["actor", "moment", "narrative", "space", "thing"].includes(node.role), node.id);
  }
  for (const link of projection.links) assert.equal(link.projected, true);
});

// Une traduction ne vaut que ce que vaut son retour. Ce test refuse une
// régression silencieuse du décodage : si un prototype est retouché au point de
// noyer un prédicat dans un voisin, le taux tombe et la suite le dit.
test("le décodage retrouve la grande majorité des prédicats sans leur étiquette", () => {
  const { roundTrip, recoveryRatePct } = projection.summary;
  assert.equal(roundTrip.wrong, 0, "aucun lien ne doit être décodé en un prédicat faux");
  assert.equal(roundTrip.no_candidate, 0, "aucun prototype ne doit sortir de sa propre tolérance");
  assert.ok(recoveryRatePct >= 90, `taux de retour arrière tombé à ${recoveryRatePct}%`);
});

// La perte doit rester là où le dictionnaire l'a déclarée. Un lien annoncé
// décodable par ses seuls axes et qui devient ambigu est un mensonge du contrat,
// pas une imprécision tolérable.
test("la perte reste confinée aux profils qui se déclarent non décodables par les nombres", () => {
  const { lossByMode } = projection.summary;
  assert.equal(lossByMode.composite.recoveryRatePct, 100);
  assert.equal(lossByMode.axis_dominant.recoveryRatePct, 100);
  assert.ok(lossByMode.semantic_required.recoveryRatePct < 100,
    "un mode semantic_required qui décode à 100% ne justifie plus son étiquette");
  for (const link of projection.links) {
    if (link.decode.verdict !== "decoded") assert.equal(link.mode, "semantic_required", link.legacyPredicate);
  }
});

test("un lien ambigu nomme ses concurrents au lieu d élire un gagnant", () => {
  const ambiguous = projection.links.filter(link => link.decode.verdict === "ambiguous");
  assert.ok(ambiguous.length > 0, "la projection prétendrait être sans perte");
  for (const link of ambiguous) assert.ok(link.decode.candidates.length > 1, link.legacyPredicate);
});

// Les overrides dépendent de ce que fait l'instance, pas de son type. Les
// appliquer automatiquement ferait passer un arbitrage humain pour un calcul.
test("les overrides de type sont signalés, jamais appliqués en silence", () => {
  const flagged = projection.nodes.filter(node => node.needsArbitration);
  assert.equal(flagged.length, projection.summary.nodesNeedingArbitration);
  for (const node of flagged) assert.ok(node.overrideRule?.trim(), node.id);
});

test("la projection porte la version du mapping qui l a produite", () => {
  assert.equal(projection.mappingVersion, "0.4.0");
  assert.equal(projection.ontologyDimensions.includes("friction"), false);
});
