import test from "node:test";
import assert from "node:assert/strict";
import { clusterLabel, clusterOptions } from "../public/garden-clusters.js";

test("cluster options are derived exhaustively from graph nodes", () => {
  const nodes = [
    { id: "root", nodeType: "protocol", name: "Mind Protocol" },
    { id: "a", clusterId: "science-endgame" },
    { id: "b", clusterId: "science-endgame" },
    { id: "c", clusterId: "future-cluster" }
  ];

  assert.deepEqual(clusterOptions(nodes), [
    { value: "", count: 1, label: "Mind Protocol" },
    { value: "future-cluster", count: 1, label: "Future cluster" },
    { value: "science-endgame", count: 2, label: "Science endgame" }
  ]);
});

test("cluster labels require no identifier registry", () => {
  assert.equal(clusterLabel("brand-new_cluster"), "Brand new cluster");
  assert.equal(clusterLabel("", []), "Vision globale de Mind Protocol");
  assert.equal(clusterLabel("", [{ semanticType: "protocol", name: "Mind Protocol" }]), "Mind Protocol");
});
