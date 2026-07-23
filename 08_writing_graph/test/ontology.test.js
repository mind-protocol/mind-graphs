import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ontology = JSON.parse(await readFile(new URL("../data/graph-ontology.json", import.meta.url), "utf8"));

test("every active relation has a valid endpoint contract", () => {
  const nodeTypes = new Set((ontology.semanticTypes || ontology.nodeTypes).map(type => type.id));
  const groups = new Map(Object.entries(ontology.typeGroups));

  for (const relation of ontology.relationTypes.filter(type => type.status === "active")) {
    const constraint = ontology.relationConstraints[relation.id];
    assert.ok(constraint, `${relation.id} has no constraint`);
    if (constraint.allowAny) continue;
    for (const side of ["source", "target"]) {
      const types = constraint[`${side}Types`] || [];
      const groupNames = constraint[`${side}Groups`] || [];
      assert.ok(types.length || groupNames.length, `${relation.id} has no ${side} contract`);
      types.forEach(type => assert.ok(nodeTypes.has(type), `${relation.id} references unknown type ${type}`));
      groupNames.forEach(group => assert.ok(groups.has(group), `${relation.id} references unknown group ${group}`));
    }
  }
});

test("epistemic defaults and node hierarchy reference declared terms", () => {
  const allTypes = new Set([...ontology.nodeTypes, ...(ontology.semanticTypes || [])].map(type => type.id));
  const statuses = new Set(ontology.epistemicStatuses.map(status => status.id));
  (ontology.semanticTypes || ontology.nodeTypes).forEach(type => assert.ok(statuses.has(type.epistemicStatus)));
  Object.entries(ontology.nodeTypeHierarchy).forEach(([child, parent]) => {
    assert.ok(allTypes.has(child));
    assert.ok(allTypes.has(parent));
  });
});
