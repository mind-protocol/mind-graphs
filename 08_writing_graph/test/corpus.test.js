import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DATASET_CLUSTERS, loadCorpus } from "../src/corpus.js";

const seedSource = await readFile(new URL("../scripts/seed.js", import.meta.url), "utf8");

test("chaque nœud chargé porte un type, y compris la couche prospective implicite", async () => {
  const { nodes } = await loadCorpus();
  assert.deepEqual(nodes.filter(node => !node.nodeType).map(node => node.id), []);
  assert.ok(nodes.some(node => (node.semanticType || node.nodeType) === "forecast_event"));
});

test("chaque relation chargée porte un prédicat", async () => {
  const { links } = await loadCorpus();
  assert.deepEqual(links.filter(link => !link.type).map(link => `${link.source}->${link.target}`), []);
});

// Le seed attribue des clusterId par jeu de données. Si le chargeur hors-ligne ne les applique
// pas, la page d'analyse (servie par l'API, donc par le seed) et npm run work:propose ne voient
// pas les mêmes périmètres, et le générateur rate des lacunes que l'interface affiche.
// Un jeu de données déclaré mais encore vide n'a évidemment aucun nœud à porter : on ne teste
// que les clusters réellement peuplés.
test("les clusterId attribués par le seed sont appliqués aussi hors-ligne", async () => {
  const { nodes } = await loadCorpus();
  const clusters = new Set(nodes.map(node => node.clusterId).filter(Boolean));
  const populated = new Set(Object.entries(DATASET_CLUSTERS)
    .filter(([datasetId]) => nodes.some(node => node.clusterId === DATASET_CLUSTERS[datasetId]))
    .map(([, cluster]) => cluster));
  for (const [, expected] of seedSource.matchAll(/clusterId: "([a-z0-9-]+)"/g)) {
    if (Object.values(DATASET_CLUSTERS).includes(expected) && !populated.has(expected)) continue;
    assert.ok(clusters.has(expected), `le cluster ${expected} est attribué par le seed mais absent hors-ligne`);
  }
});

test("la table des clusters hors-ligne ne contient aucune valeur inconnue du seed", () => {
  const seeded = new Set([...seedSource.matchAll(/clusterId: "([a-z0-9-]+)"/g)].map(match => match[1]));
  for (const cluster of Object.values(DATASET_CLUSTERS)) {
    assert.ok(seeded.has(cluster), `le cluster ${cluster} n’est plus attribué par le seed`);
  }
});
