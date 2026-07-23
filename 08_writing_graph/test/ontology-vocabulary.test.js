import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = async (p) => JSON.parse(await fs.readFile(path.resolve(__dirname, p), "utf8"));
const ontology = await read("../data/graph-ontology.json");
const vocabulary = await read("../data/ontology-vocabulary.json");

const terms = vocabulary.nodes.filter(n => (n.semanticType || n.nodeType) === "terme");
const byId = new Map(terms.map(n => [n.id, n]));
const idFor = (kind, el) => `terme-${kind}-${el}`;

// Le schéma reste exécutable, mais son sens vit dans le graphe. Ce test est la
// couture entre les deux : sans lui, l'ontologie et son vocabulaire dérivent en
// silence et le miroir devient un mensonge.
test("every element of the ontology owns a term in the graph", () => {
  const expected = [
    ...(ontology.semanticTypes || ontology.nodeTypes).map(t => idFor("type", t.id)),
    ...ontology.relationTypes.map(r => idFor("predicat", r.id)),
    ...ontology.epistemicStatuses.map(s => idFor("statut", s.id)),
    ...ontology.relationFamilies.map(f => idFor("famille", f.id))
  ].sort();
  assert.deepEqual(terms.map(t => t.id).sort(), expected);
});

test("no term claims to define something the ontology does not declare", () => {
  const declared = new Set([
    ...(ontology.semanticTypes || ontology.nodeTypes).map(t => idFor("type", t.id)),
    ...ontology.relationTypes.map(r => idFor("predicat", r.id)),
    ...ontology.epistemicStatuses.map(s => idFor("statut", s.id)),
    ...ontology.relationFamilies.map(f => idFor("famille", f.id))
  ]);
  for (const t of terms) assert.ok(declared.has(t.id), `${t.id} defines nothing declared`);
});

test("a term either carries its definition or says out loud that it is missing", () => {
  for (const t of terms) {
    assert.ok(["defined", "to_define"].includes(t.definitionStatus), `${t.id} has no definitionStatus`);
    if (t.definitionStatus === "defined") assert.ok(t.definition?.trim(), `${t.id} claims to be defined`);
    else assert.equal(t.definition, "", `${t.id} is pending yet carries a definition`);
    assert.ok(t.context?.trim(), `${t.id} has no context of use`);
  }
});

// Une définition relocalisée doit être la prose que l'ontologie porte déjà, pas
// une reformulation : sinon la doctrine se met à exister en deux versions.
test("a relocated definition is verbatim the prose the ontology already carried", () => {
  for (const type of (ontology.semanticTypes || ontology.nodeTypes)) {
    const term = byId.get(idFor("type", type.id));
    assert.equal(term.definition, type.description.trim(), `type ${type.id} drifted`);
  }
  for (const family of ontology.relationFamilies) {
    assert.equal(byId.get(idFor("famille", family.id)).definition, family.description.trim());
  }
});

test("an undefined term is an open question, not a documented fact", () => {
  for (const t of terms) {
    const expected = t.definitionStatus === "defined" ? "documented" : "unresolved";
    assert.equal(t.epistemicStatus, expected, `${t.id} misstates what is known about it`);
  }
});

// La revue doctrinale du 22 juillet 2026 a fermé le dernier trou du miroir :
// aucun élément actif de l'ontologie ne peut désormais rester un mot sans sens.
test("every ontology term, including every predicate, is defined", () => {
  for (const t of terms) {
    assert.equal(t.definitionStatus, "defined", `${t.id} still lacks doctrine`);
    assert.equal(t.epistemicStatus, "documented", `${t.id} hides its authored definition`);
  }
});

test("flow, proposed causality and observable causality remain distinct", () => {
  const definitionOf = predicate => byId.get(idFor("predicat", predicate)).definition;
  assert.match(definitionOf("FEEDS"), /canal de circulation/);
  assert.match(definitionOf("FEEDS"), /exige un CAUSES parallèle/);
  assert.match(definitionOf("LEADS_TO"), /transition causale est plausible/);
  assert.match(definitionOf("LEADS_TO"), /CAUSES est le prédicat canonique/);
  assert.match(definitionOf("CAUSES"), /état ou une métrique observable/);
  assert.match(definitionOf("CAUSES"), /ampleur de l'effet et la confiance/);
});

test("DEFINES is active and only a term may define", () => {
  const defines = ontology.relationTypes.find(r => r.id === "DEFINES");
  assert.ok(defines, "DEFINES is missing from the ontology");
  assert.equal(defines.status, "active");
  assert.deepEqual(ontology.relationConstraints.DEFINES.sourceTypes, ["terme"]);
});

test("every vocabulary link carries a justification, like any other relation", () => {
  for (const link of vocabulary.links) {
    assert.ok(String(link.justification || "").trim(), `${link.source} -> ${link.target} has none`);
  }
});

test("the mirror lives in its own cluster, apart from the project corpus", () => {
  for (const t of terms) assert.equal(t.clusterId, "ontology-vocabulary");
});
