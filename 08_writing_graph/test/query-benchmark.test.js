import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadCorpus } from "../src/corpus.js";

const set = JSON.parse(await readFile(new URL("../benchmark/query-reference-questions.json", import.meta.url), "utf8"));
const { nodes, links } = await loadCorpus("design");
const byId = new Map(nodes.map(node => [node.id, node]));
const idOf = value => (typeof value === "object" ? value.id : value);

function expectedFor(question) {
  let frontier = [question.anchor];
  const steps = [];
  for (const step of question.path) {
    frontier = links
      .filter(link => link.type === step.predicate)
      .filter(link => frontier.includes(step.direction === "incoming" ? idOf(link.target) : idOf(link.source)))
      .map(link => (step.direction === "incoming" ? idOf(link.source) : idOf(link.target)));
    steps.push(frontier.length);
  }
  return steps;
}

// Un ancrage renommé ou un prédicat disparu viderait silencieusement l'attente :
// le benchmark afficherait alors un rappel parfait sur un ensemble vide. Ce test
// est le garde-fou qui transforme cette dérive en échec visible.
test("chaque question de référence s'ancre sur un nœud existant", () => {
  for (const question of set.questions) {
    assert.ok(byId.has(question.anchor), `${question.id} : ancrage introuvable ${question.anchor}`);
  }
});

test("chaque chemin déclaré produit une attente non vide à chaque étape", () => {
  for (const question of set.questions) {
    const steps = expectedFor(question);
    assert.equal(steps.length, question.path.length, `${question.id} : chemin incomplet`);
    for (const [index, count] of steps.entries()) {
      assert.ok(count > 0, `${question.id} : étape ${index + 1} (${question.path[index].predicate}) sans attendu`);
    }
  }
});

test("le jeu sépare les formulations verbatim et paraphrasées", () => {
  const phrasings = new Set(set.questions.map(question => question.phrasing));
  for (const phrasing of phrasings) assert.ok(["verbatim", "paraphrase"].includes(phrasing), `formulation inconnue ${phrasing}`);
  assert.ok(set.questions.some(question => question.phrasing === "verbatim"));
  assert.ok(set.questions.some(question => question.phrasing === "paraphrase"), "sans paraphrase, le jeu favorise mécaniquement l'appariement lexical");
});

test("au moins une question exige une traversée à deux sauts", () => {
  assert.ok(set.questions.some(question => question.path.length >= 2), "sans chaîne à deux sauts, le jeu ne peut rien dire de la profondeur");
});

test("le jeu déclare ses limites", () => {
  assert.ok(set.limits?.length >= 3);
  assert.ok(set.groundTruthPrinciple?.trim());
});
