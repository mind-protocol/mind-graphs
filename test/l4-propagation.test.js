import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  L4_EQUATION, L4_FACTORS, negativePredicates, ORIGINS, STIPULATIONS,
  evidenceBlindness, influence, readFactors, step, walk
} from "../public/l4-propagation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = async (file) =>
  JSON.parse(await fs.readFile(path.resolve(__dirname, "../data", file), "utf8"));
const mapping = await read("l4-ontology-mapping.json");
const ontology = await read("graph-ontology.json");

const rule = mapping.nodes.find((node) => node.id === "l4-physical-propagation-rule");
const dictionary = mapping.nodes.find((node) => node.id === "l4-predicate-translation-dictionary");
const negatives = negativePredicates(dictionary);

test("l'équation implémentée est celle écrite dans le graphe, caractère pour caractère", () => {
  // Si la loi change dans les données, l'implémentation doit échouer bruyamment
  // plutôt que continuer à mesurer une loi que le graphe n'affirme plus.
  assert.equal(L4_EQUATION, rule.equation);
});

test("chaque facteur non mesuré déclare ce qu'il a fallu stipuler", () => {
  const link = { type: "CAUSES", traversalWeight: 0.9 };
  const factors = readFactors(link, { energy: 1 });
  for (const key of L4_FACTORS) {
    assert.ok(factors[key], `le facteur ${key} de l'équation n'est pas lu`);
    assert.ok(ORIGINS.includes(factors[key].origin), `origine inconnue pour ${key}`);
    if (factors[key].origin === "stipulated") {
      assert.ok(STIPULATIONS[key], `${key} est stipulé sans justification écrite`);
    }
  }
});

test("aucune stipulation orpheline : ce qui est justifié est bien un facteur de la loi", () => {
  for (const key of Object.keys(STIPULATIONS)) {
    assert.ok(L4_FACTORS.includes(key), `${key} n'est pas un facteur de l'équation`);
  }
});

test("la polarité négative est exactement l'inhibition que la loi revendique", () => {
  // Le nœud de la loi dit : « P négatif permet l inhibition et donc la
  // distinction physique de BLOCKS. »
  assert.ok(rule.whyItWorks.some((line) => line.includes("BLOCKS")));
  // Les prédicats inhibiteurs viennent du dictionnaire, seule source de vérité,
  // et non d'une liste tenue à la main. Le dictionnaire en marque quatre —
  // dont PRESSURES et MITIGATES, que l'ancienne liste en dur oubliait.
  assert.ok(negatives.has("BLOCKS") && negatives.has("CONTRADICTS"));
  assert.ok(negatives.has("PRESSURES") && negatives.has("MITIGATES"));
  for (const predicate of negatives) {
    assert.equal(readFactors({ type: predicate, traversalWeight: 0.5 }, { negatives }).P.value, -1);
  }
  assert.equal(readFactors({ type: "CAUSES", traversalWeight: 0.9 }, { negatives }).P.value, 1);
});

test("un verrou traité mais non validé n'a pas de valeur dans la loi", () => {
  // ADDRESSES signifie « traité, jamais validé ». La loi ne connaît que la part
  // d'influence autorisée : elle n'a aucun vocabulaire pour cet entre-deux.
  const link = { type: "CAUSES", traversalWeight: 0.9 };
  assert.equal(readFactors(link, { gateState: "blocked" }).G.value, 0);
  assert.equal(readFactors(link, { gateState: "open" }).G.value, 1);
  const addressed = readFactors(link, { gateState: "addressed" });
  assert.equal(addressed.G.value, null);
  assert.equal(addressed.G.origin, "undefined_by_law");
  assert.equal(step(link, { gateState: "addressed" }).influence, null);
});

test("un facteur indéterminé ne devient jamais une valeur commode", () => {
  assert.equal(influence({ E: 1, W: null, P: 1, G: 1, K: 1 }), null);
  assert.equal(influence({ E: 1, W: 0.9, P: 1, G: 1, K: 1 }), 0.9);
});

test("l'indétermination se propage en aval au lieu d'être maquillée en zéro", () => {
  const chain = [
    { type: "CAUSES", traversalWeight: 0.9 },
    { type: "CAUSES", traversalWeight: 0.9 },
    { type: "CAUSES", traversalWeight: 0.9 }
  ];
  const run = walk(chain, { gateStateOf: (l) => (l === chain[0] ? "addressed" : "open") });
  assert.equal(run.steps.length, 3, "la marche rend compte de chaque arête du chemin");
  assert.ok(run.steps.every((s) => s.indeterminate));
  assert.equal(run.arrival, null);
});

test("la loi est monotone décroissante : elle prédit sa propre extinction", () => {
  // Limite écrite dans le nœud : « Un produit de facteurs positifs reste
  // monotone : sans seuil, la loi ne peut pas construire de porte AND. »
  assert.ok(rule.limits.some((line) => line.includes("monotone")));
  const hop = { type: "CAUSES", traversalWeight: 0.9 };
  const run = walk([hop, hop, hop, hop, hop, hop]);
  const values = run.steps.map((s) => s.influence);
  for (let i = 1; i < values.length; i++) {
    assert.ok(values[i] < values[i - 1], "l'influence doit décroître à chaque pas");
  }
  assert.ok(run.arrival < 0.6, "six sauts suffisent à éteindre une chaîne pourtant canonique");
});

test("RÉSULTAT : la loi ne distingue pas un pont de pierre d'un pont de corde", () => {
  // Aucun des trois champs qui portent la preuve dans le corpus n'est une
  // dimension de la loi. La ville rend la différence visible ; la loi est aveugle.
  const dimensions = Object.keys(
    mapping.nodes.find((n) => n.id === "l4-signed-conditional-temporal-physics").dimensions
  );
  for (const field of ["effectSizePct", "confidenceScore", "evidenceBasis"]) {
    assert.ok(!dimensions.includes(field), `${field} serait une dimension de la loi`);
  }
  const stone = { type: "CAUSES", traversalWeight: 0.9, effectSizePct: 42, confidenceScore: 0.9, evidenceBasis: "real_world" };
  const rope = { type: "CAUSES", traversalWeight: 0.9 };
  assert.equal(step(stone).influence, step(rope).influence);

  const verdict = evidenceBlindness([stone, rope]);
  assert.equal(verdict.lawReadsEvidence, false);
  assert.equal(verdict.meanQuantified, verdict.meanBare);
});

test("le poids substitué est bien la force sémantique déclarée par l'ontologie", () => {
  // Substitution assumée : ce n'est ni une probabilité ni une confiance, et
  // l'ontologie le dit. Le test verrouille la provenance de la substitution.
  assert.match(ontology.traversal.definition, /ni une probabilité ni une confiance/);
  const causal = ontology.traversal.familyDefaults.causal;
  assert.equal(readFactors({ type: "CAUSES", traversalWeight: causal }).W.value, causal);
  assert.equal(readFactors({ type: "CAUSES" }).W.origin, "undefined_by_law");
});

test("la loi est muette sur une polarité « mixte », que le corpus écrit pourtant", async () => {
  const forecast = await read("forecast-influences.json");
  const mixed = forecast.links.filter((l) => String(l.polarity).startsWith("mixte"));
  assert.ok(mixed.length > 0, "le corpus porte bien des polarités mixtes");
  const factors = readFactors({ ...mixed[0], traversalWeight: 0.7 });
  assert.equal(factors.P.value, null);
  assert.equal(factors.P.origin, "undefined_by_law");
});
