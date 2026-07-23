import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ontology = JSON.parse(await readFile(new URL("../data/graph-ontology.json", import.meta.url), "utf8"));
const markup = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

const declaredFilters = new Set(
  [...markup.matchAll(/data-node-type="([^"]+)"/g)].map(match => match[1])
);

// Un type sans case à cocher est invisible : `visibleNodeTypes()` ne retient que les cases
// cochées, si bien qu'un nœud d'un type oublié disparaît du canvas sans erreur ni message. Le
// cluster des consultations s'est affiché vide pour cette seule raison.
test("chaque type de nœud de l'ontologie a un filtre dans l'interface", () => {
  for (const type of (ontology.semanticTypes || ontology.nodeTypes)) {
    assert.ok(declaredFilters.has(type.id), `aucun filtre data-node-type pour ${type.id}`);
  }
});

test("aucun filtre ne vise un type absent de l'ontologie", () => {
  const allTypes = new Set([...ontology.nodeTypes, ...(ontology.semanticTypes || [])].map(type => type.id));
  for (const filter of declaredFilters) {
    assert.ok(allTypes.has(filter), `le filtre ${filter} ne correspond à aucun type`);
  }
});
