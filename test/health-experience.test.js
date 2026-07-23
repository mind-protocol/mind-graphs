import test from "node:test";
import assert from "node:assert/strict";
import { filterExecutions, healthViewHref, normalizeHealthView } from "../public/health-experience.js";

test("health views reject unknown states", () => {
  assert.equal(normalizeHealthView("logs"), "logs");
  assert.equal(normalizeHealthView("anything"), "overview");
});

test("health views stay shareable", () => {
  assert.equal(healthViewHref("http://localhost:4173/analysis.html", "diagnostic"), "/analysis.html?view=diagnostic");
});

test("execution filters combine type and human text search", () => {
  const executions = [
    { kind: "traversal", label: "Boucles", description: "Cherche les cycles", inspected: "relations", limitation: "signe absent" },
    { kind: "repair", label: "Provenance", description: "Propose des sources", inspected: "nœuds", limitation: "revue humaine" }
  ];
  assert.deepEqual(filterExecutions(executions, { kind: "repair" }).map((item) => item.label), ["Provenance"]);
  assert.deepEqual(filterExecutions(executions, { query: "cycles" }).map((item) => item.label), ["Boucles"]);
  assert.deepEqual(filterExecutions(executions, { kind: "traversal", query: "revue" }), []);
});
