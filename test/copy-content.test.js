import test from "node:test";
import assert from "node:assert/strict";
import { serializeClusterContent, serializeNodeContent } from "../public/copy-content.js";

test("serializeNodeContent keeps domain content and removes visualization state", () => {
  const output = serializeNodeContent({
    id: "n-1", name: "Nœud exemple", phrase: "Une idée.", summary: "Le détail.", x: 42, titleLines: ["Nœud exemple"]
  });

  assert.match(output, /^# Nœud exemple/);
  assert.match(output, /\*\*Phrase :\*\* Une idée\./);
  assert.match(output, /\*\*Résumé :\*\* Le détail\./);
  assert.doesNotMatch(output, /42|titleLines/);
});

test("serializeClusterContent includes every node and relation", () => {
  const output = serializeClusterContent({
    nodes: [{ id: "a", name: "Alpha" }, { id: "b", name: "Bêta" }],
    links: [{ source: { id: "a" }, target: { id: "b" }, type: "CAUSES", relationStory: "Alpha produit Bêta." }]
  });

  assert.match(output, /2 nœuds, 1 relations/);
  assert.match(output, /## Alpha/);
  assert.match(output, /## Bêta/);
  assert.match(output, /### Alpha → Bêta/);
  assert.match(output, /Alpha produit Bêta\./);
});
