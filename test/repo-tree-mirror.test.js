import test from "node:test";
import assert from "node:assert/strict";
import { buildGraphElements, REPO_ROOT_NODE_ID } from "../src/repo-tree-mirror.js";

test("un fichier racine converge dans le nœud dépôt", () => {
  const { nodes, links } = buildGraphElements(["package.json"]);
  const file = nodes.find(n => n.id === "repo:package.json");
  assert.ok(file);
  assert.equal(file.semanticType, "thing");
  assert.equal(file.ext, "json");
  const link = links.find(l => l.source === "repo:package.json");
  assert.equal(link.target, REPO_ROOT_NODE_ID);
  assert.equal(link.type, "CONVERGES_IN");
});

test("un fichier imbriqué crée ses dossiers ancêtres en spaces", () => {
  const { nodes, links } = buildGraphElements(["src/sub/thing.js"]);

  const dirSrc = nodes.find(n => n.id === "repo:src");
  const dirSub = nodes.find(n => n.id === "repo:src/sub");
  const file = nodes.find(n => n.id === "repo:src/sub/thing.js");
  assert.equal(dirSrc.semanticType, "space");
  assert.equal(dirSub.semanticType, "space");
  assert.equal(file.semanticType, "thing");
  assert.equal(file.depth, 3);

  // src -> racine, src/sub -> src, fichier -> src/sub
  assert.equal(links.find(l => l.source === "repo:src").target, REPO_ROOT_NODE_ID);
  assert.equal(links.find(l => l.source === "repo:src/sub").target, "repo:src");
  assert.equal(links.find(l => l.source === "repo:src/sub/thing.js").target, "repo:src/sub");
});

test("les dossiers partagés ne sont pas dupliqués", () => {
  const { nodes } = buildGraphElements(["src/a.js", "src/b.js", "src/deep/c.js"]);
  const srcNodes = nodes.filter(n => n.id === "repo:src");
  assert.equal(srcNodes.length, 1);
  const dirs = nodes.filter(n => n.semanticType === "space").map(n => n.id).sort();
  assert.deepEqual(dirs, ["repo:src", "repo:src/deep"]);
});

test("chaque relation porte source, cible et type valides (pas de lien fabriqué)", () => {
  const { nodes, links } = buildGraphElements(["src/a.js", "data/x.json"]);
  const ids = new Set(nodes.map(n => n.id));
  ids.add(REPO_ROOT_NODE_ID);
  for (const link of links) {
    assert.ok(ids.has(link.source), `source connue: ${link.source}`);
    assert.ok(ids.has(link.target), `cible connue: ${link.target}`);
    assert.match(link.type, /^[A-Z][A-Z_]*$/);
  }
});
