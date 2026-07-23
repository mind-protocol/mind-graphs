import test from "node:test";
import assert from "node:assert/strict";
import {
  SCOPED_TYPES, definedVocabulary, undefinedTerms, unscopedClaims, vocabularyGapReport
} from "../public/vocabulary-gaps.js";

const node = (id, nodeType, extra = {}) => ({ id, name: id, nodeType, ...extra });
const term = (name, extra = {}) => ({
  id: `terme-${name}`, name, nodeType: "terme",
  definition: "une définition", context: "un contexte", ...extra
});

test("a term only counts as defined when it actually carries a definition", () => {
  const defined = definedVocabulary([
    term("claim atomique"),
    { id: "t2", name: "graphe causal", nodeType: "terme", context: "c" } // sans definition
  ]);
  assert.ok(defined.has("claim"));
  assert.ok(defined.has("atomique"));
  assert.ok(!defined.has("graphe"), "a term without a definition defines nothing");
});

test("an undefined word is only reported once per node, however often it repeats", () => {
  const nodes = [
    node("a", "claim", { name: "connaissance connaissance", phrase: "connaissance encore" }),
    node("b", "claim", { name: "connaissance", phrase: "" })
  ];
  const [found] = undefinedTerms(nodes, { minOccurrences: 1 });
  assert.equal(found.word, "connaissance");
  assert.equal(found.occurrences, 2, "two nodes, not four occurrences");
});

test("defining a word removes it from the gap list", () => {
  const nodes = [
    node("a", "claim", { phrase: "le graphe organise le test" }),
    node("b", "claim", { phrase: "le graphe détecte un gap" })
  ];
  assert.ok(undefinedTerms(nodes, { minOccurrences: 2 }).some(t => t.word === "graphe"));
  const withTerm = [...nodes, term("graphe")];
  assert.ok(!undefinedTerms(withTerm, { minOccurrences: 2 }).some(t => t.word === "graphe"));
});

// Un mot qui traverse plusieurs clusters porte une ambiguïté partagée : il coûte
// plus cher que le même mot répété dans un seul périmètre.
test("reach across clusters outranks raw repetition", () => {
  const nodes = [
    node("a", "claim", { phrase: "large", clusterId: "x" }),
    node("b", "claim", { phrase: "large", clusterId: "y" }),
    node("c", "claim", { phrase: "narrow", clusterId: "x" }),
    node("d", "claim", { phrase: "narrow", clusterId: "x" }),
    node("e", "claim", { phrase: "narrow", clusterId: "x" })
  ];
  const ranked = undefinedTerms(nodes, { minOccurrences: 2 });
  assert.equal(ranked[0].word, "large");
  assert.equal(ranked[0].reach, 2);
});

test("stopwords and short words are never reported as missing vocabulary", () => {
  const nodes = Array.from({ length: 6 }, (_, i) =>
    node(`n${i}`, "claim", { name: "", phrase: "le the de of et and dans" }));
  assert.deepEqual(undefinedTerms(nodes, { minOccurrences: 1 }), []);
});

test("a claim is scoped by an APPLIES_IN link or by its own perimeter fields", () => {
  const nodes = [
    node("linked", "claim"), node("fielded", "claim", { contextId: "ctx" }),
    node("population", "claim", { populationOrSystem: "cohorte" }), node("bare", "claim")
  ];
  const links = [{ source: "linked", target: "ctx", type: "APPLIES_IN" }];
  assert.deepEqual(unscopedClaims(nodes, links).map(n => n.id), ["bare"]);
});

test("only types whose validity depends on a perimeter are audited", () => {
  const nodes = [node("m", "mechanism"), node("a", "axiom"), node("c", "claim")];
  assert.deepEqual(unscopedClaims(nodes, []).map(n => n.id), ["c"]);
  assert.ok(!SCOPED_TYPES.has("mechanism"), "a mechanism is not an assertion about a population");
  assert.ok(!SCOPED_TYPES.has("axiom"), "an axiom is chosen, not valid somewhere");
});

test("the report measures the deficit without ever refusing anything", () => {
  const nodes = [node("a", "claim"), node("b", "claim", { contextId: "ctx" }), term("claim")];
  const report = vocabularyGapReport(nodes, [], { minOccurrences: 99 });
  assert.equal(report.scopedTotal, 2);
  assert.equal(report.unscoped, 1);
  assert.ok(Math.abs(report.scopeSaturation - 0.5) < 1e-9);
  assert.equal(report.definedTerms, 1);
  assert.ok(report.findings.every(f => f.remedy), "every finding proposes a remedy");
});

test("a corpus with nothing to scope is saturated rather than divided by zero", () => {
  const report = vocabularyGapReport([node("m", "mechanism")], []);
  assert.equal(report.scopedTotal, 0);
  assert.equal(report.scopeSaturation, 1);
});

test("findings name the nodes that carry the gap, so the work is actionable", () => {
  const nodes = Array.from({ length: 5 }, (_, i) =>
    node(`n${i}`, "claim", { phrase: "connaissance calculable", clusterId: `c${i}` }));
  const report = vocabularyGapReport(nodes, [], { minOccurrences: 3 });
  const vocab = report.findings.find(f => f.category === "undefined_vocabulary");
  assert.ok(vocab.samples.length, "a finding without samples cannot be acted on");
  assert.equal(vocab.severity, "high", "a word spread over many clusters is the costlier ambiguity");
});
