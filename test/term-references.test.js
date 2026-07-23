import test from "node:test";
import assert from "node:assert/strict";
import { buildTermIndex, buildTermPattern } from "../public/term-references.js";

test("indexes only complete terme nodes and prefers the longest name", () => {
  const terms = buildTermIndex([
    { id: "short", name: "preuve", nodeType: "terme", context: "science", definition: "Justification." },
    { id: "long", name: "preuve causale", nodeType: "terme", context: "science", definition: "Justification causale." },
    { id: "missing", name: "incomplet", nodeType: "terme", context: "science" },
    { id: "other", name: "preuve", nodeType: "claim", context: "science", definition: "Non." }
  ]);

  assert.deepEqual(terms.map(term => term.id), ["long", "short"]);
});

test("matches complete term names without matching inside other words", () => {
  const terms = buildTermIndex([
    { id: "term", name: "agent", nodeType: "terme", context: "simulation", definition: "Acteur autonome." }
  ]);
  const pattern = buildTermPattern(terms);

  assert.deepEqual([..."Un agent agit avec une agence.".matchAll(pattern)].map(match => match[0]), ["agent"]);
});
