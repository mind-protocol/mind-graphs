import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { selectCitizenConnections } from "../src/l1-sensory-runtime.js";

const readJson = async relativePath => JSON.parse(
  await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")
);

test("L3 est un graphe actif, autonome et sans arête inter-graphe", async () => {
  const manifest = await readJson("graphs.json");
  const graph = manifest.graphs.find(candidate => candidate.id === "l3-ecosystem");

  assert.equal(graph?.status, "active");
  assert.equal(graph?.falkorGraph, "l3_ecosystem_graph");
  assert.equal(graph?.ontology, "l3/ontology.json");
  assert.match(graph?.frontier?.rule || "", /Aucune arête/);
});

test("le message coucou est attribué, adressé et contextualisé avec justification", async () => {
  const ontology = await readJson("l3/ontology.json");
  const dataset = await readJson("l3/data/ecosystem.json");
  const message = dataset.nodes.find(node => node.id === "l3-message-nlr-coucou-001");

  assert.equal(message?.content, "coucou");
  assert.equal(message?.sourceMessageId, "nlr-coucou-wake-001");
  assert.equal(dataset.nodes.some(node => node.nodeType === "action"), false);

  const relationTypes = new Set(ontology.relationTypes.map(relation => relation.id));
  for (const link of dataset.links) {
    assert.equal(relationTypes.has(link.type), true, `relation L3 inconnue: ${link.type}`);
    assert.ok(link.justification?.trim(), `justification absente: ${link.type}`);
    assert.ok(dataset.nodes.some(node => node.id === link.source));
    assert.ok(dataset.nodes.some(node => node.id === link.target));
  }

  assert.deepEqual(
    new Set(dataset.links.map(link => link.type)),
    new Set(["AUTHORED_BY", "ADDRESSED_TO", "OCCURS_IN"])
  );
});

test("le contrat sensoriel L1 détecte les liens L3 du citoyen", async () => {
  const dataset = await readJson("l3/data/ecosystem.json");
  const selected = selectCitizenConnections(
    [{ id: "l3-ecosystem", readAllowed: true, ...dataset }],
    {
      citizenIds: ["self-nlr", "actor-nlr"],
      minWeight: 0.8,
      recentWindowMs: 0,
      now: Date.parse("2026-07-23T04:00:00.000Z")
    }
  );

  assert.deepEqual(
    new Set(selected.map(connection => connection.link.type)),
    new Set(["AUTHORED_BY", "ADDRESSED_TO"])
  );
  assert.equal(selected.every(connection => connection.selectedBecause.strong), true);
});

test("le seed FalkorDB conserve les propriétés nécessaires à la perception L3", async () => {
  const seedSource = await readFile(new URL("../scripts/seed.js", import.meta.url), "utf8");

  for (const property of [
    "content:$content",
    "sourceMessageId:$sourceMessageId",
    "correspondsTo:$correspondsTo",
    "citizenId:$citizenId",
    "justification:$justification",
    "weight:$weight"
  ]) {
    assert.match(seedSource, new RegExp(property.replace("$", "\\$")));
  }
});
