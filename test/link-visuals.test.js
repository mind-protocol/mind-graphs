import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LINK_FAMILY_STYLES, TYPE_FAMILIES, linkFamily, linkVisualStyle } from "../public/link-visuals.js";

const ontology = JSON.parse(await readFile(new URL("../data/graph-ontology.json", import.meta.url), "utf8"));

test("every ontology relation family has a distinct visual style", () => {
  for (const family of ontology.relationFamilies) {
    assert.ok(LINK_FAMILY_STYLES[family.id], `missing visual style for family ${family.id}`);
  }
  const signatures = Object.values(LINK_FAMILY_STYLES).map(style => JSON.stringify(style));
  assert.equal(new Set(signatures).size, signatures.length, "two families share the same visual signature");
});

// La couche visuelle a le droit de raffiner une famille d'ontologie, mais pas d'inventer un style
// mort : toute famille visuelle supplémentaire doit être atteinte par au moins un prédicat.
test("every extra visual family is reached by at least one predicate", () => {
  const ontologyFamilies = new Set(ontology.relationFamilies.map(family => family.id));
  const mapped = new Set(Object.values(TYPE_FAMILIES));
  for (const family of Object.keys(LINK_FAMILY_STYLES)) {
    if (ontologyFamilies.has(family)) continue;
    assert.ok(mapped.has(family), `visual family ${family} is defined but never used by a predicate`);
  }
});

test("every active predicate resolves to a defined visual style", () => {
  for (const relation of ontology.relationTypes.filter(item => item.status === "active")) {
    const family = linkFamily({ type: relation.id });
    assert.ok(LINK_FAMILY_STYLES[family], `predicate ${relation.id} resolves to unknown family ${family}`);
  }
});

test("relation metadata wins and relation types have a family fallback", () => {
  assert.equal(linkFamily({ type: "CAUSES" }), "causal");
  assert.equal(linkFamily({ type: "FEEDS" }), "flow");
  assert.equal(linkFamily({ type: "MEASURED_BY" }), "validation");
  assert.equal(linkFamily({ type: "CAUSES", relationFamily: "evidence" }), "evidence");
  assert.equal(linkVisualStyle({ type: "PART_OF" }), LINK_FAMILY_STYLES.hierarchy);
});
