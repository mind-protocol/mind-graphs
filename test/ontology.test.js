import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ontology = JSON.parse(await readFile(new URL("../data/graph-ontology.json", import.meta.url), "utf8"));

test("every active relation has a valid endpoint contract", () => {
  const universalTypes = new Set(ontology.nodeTypes.map(type => type.id));
  const semanticTypes = new Set((ontology.semanticTypes || []).map(type => type.id));
  const allKnownTypes = new Set([...universalTypes, ...semanticTypes]);
  const groups = new Map(Object.entries(ontology.typeGroups || {}));

  for (const relation of ontology.relationTypes.filter(type => type.status === "active")) {
    const constraint = ontology.relationConstraints[relation.id];
    assert.ok(constraint, `${relation.id} has no constraint`);
    if (constraint.allowAny) continue;

    for (const side of ["source", "target"]) {
      const sideObj = constraint[side];
      const types = constraint[`${side}Types`] || [
        ...(sideObj?.nodeTypes || []),
        ...(sideObj?.semanticTypes || [])
      ];
      const groupNames = constraint[`${side}Groups`] || sideObj?.groups || [];
      assert.ok(types.length || groupNames.length, `${relation.id} has no ${side} contract`);
      types.forEach(type => assert.ok(type && typeof type === "string", `${relation.id} references unknown type ${type}`));
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
