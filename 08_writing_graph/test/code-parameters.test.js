import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { QUERY_TUNING } from "../public/graph-query.js";
import { listCodeParameters, parameterCoverage, unjustifiedDecisiveParameters } from "../src/code-parameters.js";

const ontology = JSON.parse(await readFile(new URL("../data/graph-ontology.json", import.meta.url), "utf8"));
const decisions = JSON.parse(await readFile(new URL("../data/code-parameter-decisions.json", import.meta.url), "utf8"));
const querySource = await readFile(new URL("../public/graph-query.js", import.meta.url), "utf8");

test("chaque paramètre déclaré porte un rôle, une valeur et un verdict de décisivité", () => {
  for (const parameter of listCodeParameters()) {
    assert.equal(typeof parameter.value, "number", `${parameter.ref} sans valeur numérique`);
    assert.ok(parameter.role?.trim(), `${parameter.ref} sans rôle`);
    assert.equal(typeof parameter.decisive, "boolean", `${parameter.ref} sans verdict de décisivité`);
  }
});

// Le dispositif entier repose sur l'unicité de la valeur : si l'algorithme lit un
// littéral au lieu de sa déclaration, la doc décrit un moteur que le code
// n'exécute pas. C'est exactement le drift que l'instrumentation ferme.
test("l'algorithme n'exécute aucun littéral de réglage hors de sa déclaration", () => {
  const body = querySource.slice(querySource.indexOf("const STOP_WORDS"));
  const literals = body.match(/[^\w.]0\.\d+/g) || [];
  assert.deepEqual(literals, [], `littéraux de réglage encore exécutés : ${literals.join(", ")}`);
});

test("les deux parts d'un mélange se complètent", () => {
  const { lexicalWeight, vectorWeight, semanticScore, graphScore } = QUERY_TUNING.parameters;
  assert.equal(lexicalWeight.value + vectorWeight.value, 1);
  assert.equal(Math.round((semanticScore.value + graphScore.value) * 10) / 10, 1);
});

test("toute décision de paramètre déclare un barreau, fût-il nul", () => {
  const parameterDecisions = decisions.nodes.filter(node => Array.isArray(node.codeParameters));
  assert.ok(parameterDecisions.length > 0);
  for (const decision of parameterDecisions) {
    assert.ok("evidenceRung" in decision, `${decision.id} ne déclare aucun barreau`);
    for (const field of ontology.parameterContract.requiredOnDecision) {
      assert.ok(field in decision, `${decision.id} : champ ${field} manquant`);
    }
  }
});

// Garde-fou anti-fabrication. Un barreau nul dit « ce choix tourne sans qu'aucune
// raison n'ait été enregistrée » ; l'accompagner d'un decisionRationale ferait
// passer une reconstruction rétrospective pour la raison d'origine.
test("un barreau nul n'est jamais accompagné d'une justification rétrospective", () => {
  for (const decision of decisions.nodes.filter(node => node.evidenceRung === null)) {
    assert.equal(decision.decisionRationale, undefined, `${decision.id} invente une raison sous un barreau nul`);
    assert.notEqual(decision.decisionStatus, "approved", `${decision.id} est approuvée sans aucune preuve déclarée`);
    assert.ok(decision.evidenceRungNote?.trim(), `${decision.id} doit dire pourquoi le barreau est nul`);
  }
});

test("la couverture mesure la déclaration, pas l'altitude du barreau", () => {
  const coverage = parameterCoverage();
  assert.equal(coverage.decisive, listCodeParameters().filter(parameter => parameter.decisive).length);
  assert.equal(coverage.justified + unjustifiedDecisiveParameters().length, coverage.decisive);
  assert.ok(coverage.ratio >= 0 && coverage.ratio <= 1);
});
