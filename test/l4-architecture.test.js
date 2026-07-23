import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadManifest, selectGraph, readDatasets } from "../src/graph-manifest.js";

test("l4-registry est déclaré et contient les 5 types canoniques", async () => {
  const manifest = await loadManifest();
  const graphSpec = selectGraph(manifest, "l4-registry");
  assert.equal(graphSpec.falkorGraph, "mind_l4_registry");

  const datasets = await readDatasets(graphSpec);
  assert.equal(datasets.length, 1);
  const registryData = datasets[0].data;

  assert.equal(registryData.schemaVersion, "1.9.1");
  const typeRoles = new Set(registryData.canonicalTypes.map(t => t.role));
  assert.deepEqual(typeRoles, new Set(["actor", "moment", "narrative", "space", "thing"]));
});

test("l4-kernel est déclaré et contient l'équation de propagation", async () => {
  const manifest = await loadManifest();
  const graphSpec = selectGraph(manifest, "l4-kernel");
  assert.equal(graphSpec.falkorGraph, "mind_l4_kernel");

  const datasets = await readDatasets(graphSpec);
  assert.equal(datasets.length, 1);
  const physicsData = datasets[0].data;

  assert.equal(physicsData.kernelVersion, "1.0.0");
  const impulseLaw = physicsData.laws.find(law => law.id === "law-impulse-propagation");
  assert.ok(impulseLaw);
  assert.equal(impulseLaw.equation, "I = E * W * P * G");
});
