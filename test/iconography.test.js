import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { NODE_TYPE_ICONS, RELATION_TYPE_ICONS, iconForNode, iconForRelation } from "../public/iconography.js";

const ontology = JSON.parse(await readFile(new URL("../data/graph-ontology.json", import.meta.url), "utf8"));

test("every ontology node type has a visible icon", () => {
  for (const type of (ontology.semanticTypes || ontology.nodeTypes)) {
    assert.ok(NODE_TYPE_ICONS[type.id], `missing node icon for ${type.id}`);
    assert.notEqual(iconForNode(type.id), "•");
  }
});

test("every active relation type has a visible icon", () => {
  for (const relation of ontology.relationTypes.filter(item => item.status === "active")) {
    assert.ok(RELATION_TYPE_ICONS[relation.id], `missing relation icon for ${relation.id}`);
    assert.notEqual(iconForRelation(relation.id), "—");
  }
});
