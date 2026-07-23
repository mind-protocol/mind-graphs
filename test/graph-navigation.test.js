import test from "node:test";
import assert from "node:assert/strict";
import { buildClusterRepresentatives, buildHierarchyChildren, navigationNodeIds, neighborhoodNodeIds } from "../public/graph-navigation.js";

const nodes = [
  { id: "thesis", name: "Thèse · Domaine", nodeType: "working_hypothesis", clusterId: "domain" },
  { id: "doc", name: "Document · Domaine", nodeType: "source_document", clusterId: "domain" },
  { id: "detail", name: "Couche · Détail", nodeType: "mechanism", clusterId: "domain" },
  { id: "root", name: "Racine", nodeType: "protocol" },
  { id: "child", name: "Enfant", nodeType: "mechanism" }
];
const links = [
  { source: "detail", target: "thesis", type: "IMPLEMENTS" },
  { source: "thesis", target: "doc", type: "DERIVED_FROM", relationScope: "provenance" },
  { source: "child", target: "root", type: "PART_OF" }
];

test("overview keeps one stable representative per cluster and collapses hierarchy children", () => {
  const representatives = buildClusterRepresentatives(nodes, links);
  const children = buildHierarchyChildren(links);
  const overviewIds = new Set(["root", "thesis", "child"]);
  const visible = navigationNodeIds(nodes, links, { representatives, hierarchyChildren: children, overviewIds });
  assert.equal(representatives.get("domain"), "thesis");
  assert.deepEqual([...visible].sort(), ["root", "thesis"]);
  assert.deepEqual([...overviewIds].sort(), ["child", "root", "thesis"], "navigation must not mutate the cached overview");
});

test("opening a cluster reveals all its members", () => {
  const visible = navigationNodeIds(nodes, links, { scope: "cluster", clusterId: "domain" });
  assert.deepEqual([...visible].sort(), ["detail", "doc", "thesis"]);
});

test("clicking a hierarchy parent can reveal its direct children", () => {
  const children = buildHierarchyChildren(links);
  const visible = navigationNodeIds(nodes, links, { hierarchyChildren: children, expandedIds: new Set(["root"]) });
  assert.ok(visible.has("child"));
});

test("a principal node opens a bounded semantic neighborhood without provenance", () => {
  const visible = neighborhoodNodeIds(nodes, links, "root", 10, 2);
  assert.ok(visible.has("root"));
  assert.ok(visible.has("child"));
  assert.ok(!visible.has("doc"));
});
