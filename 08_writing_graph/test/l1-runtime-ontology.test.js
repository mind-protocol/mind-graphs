import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const ontology = JSON.parse(await fs.readFile(new URL("../l1/ontology.json", import.meta.url), "utf8"));
const nodeTypes = new Set(ontology.nodeTypes.map(type => type.id));
const relationTypes = new Set(ontology.relationTypes.map(type => type.id));

test("personal L1 ontology admits the minimal subentity runtime projection", () => {
  for (const type of ["subentity", "subentity_narrative", "lifecycle_event", "memory"]) assert.ok(nodeTypes.has(type), type);
  for (const type of ["CONTROLLED_WORKSPACE_DURING", "DESCRIBES_SUBENTITY", "SUPPORTS", "SUPERSEDES"]) {
    assert.ok(relationTypes.has(type), type);
    assert.ok(ontology.relationConstraints[type], `${type} has no endpoint contract`);
  }
});

test("runtime narratives remain inferred and memories remain evidence", () => {
  assert.equal(ontology.nodeTypes.find(type => type.id === "subentity_narrative").epistemicStatus, "inferred");
  assert.deepEqual(ontology.relationConstraints.SUPPORTS.sourceGroups, ["runtime_evidence"]);
  assert.ok(ontology.typeGroups.runtime_evidence.includes("memory"));
});
