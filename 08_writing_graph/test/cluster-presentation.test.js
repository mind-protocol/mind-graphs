import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { auditPresentationNomenclature, transformClusterToPresentation } from "../public/cluster-presentation.js";

const ontology = JSON.parse(await readFile(new URL("../data/graph-ontology.json", import.meta.url), "utf8"));

test("the presentation algorithm covers the complete current nomenclature", () => {
  const audit = auditPresentationNomenclature(ontology);
  assert.equal(audit.ok, true, audit.errors.join("\n"));
  assert.equal(audit.schemaVersion, ontology.schemaVersion);
  assert.equal(audit.nodeTypeCount, ontology.nodeTypes.length);
  assert.equal(audit.relationTypeCount, ontology.relationTypes.length);
  assert.equal(audit.relationFamilyCount, ontology.relationFamilies.length);
  assert.equal(audit.epistemicStatusCount, ontology.epistemicStatuses.length);
});

test("provenance is separated from semantic importance and rendered last", () => {
  const nodes = [
    { id: "risk", name: "Risque · Accumulation", phrase: "Les claims s’accumulent sans critique.", nodeType: "open_question", epistemicStatus: "unresolved", clusterId: "science" },
    { id: "thesis", name: "Thèse · Connaissance calculable", phrase: "Le claim devient l’unité de connaissance.", nodeType: "working_hypothesis", epistemicStatus: "working_hypothesis", clusterId: "science" },
    { id: "primitive", name: "Primitive · Claim évalué", phrase: "Chaque proposition est évaluée séparément.", nodeType: "mechanism", epistemicStatus: "design_proposal", clusterId: "science" },
    { id: "pilot", name: "Pilote · Vingt articles", phrase: "Une verticale teste la boucle.", nodeType: "working_hypothesis", epistemicStatus: "working_hypothesis", clusterId: "science" },
    { id: "target", name: "Cible · Prochain test", phrase: "Le graphe organise son prochain test.", nodeType: "system_state", epistemicStatus: "test_target", clusterId: "science" },
    { id: "doc", name: "Document · Science", phrase: "Document source.", nodeType: "source_document", epistemicStatus: "documented", clusterId: "science" }
  ];
  const links = [
    { source: "risk", target: "thesis", type: "BLOCKS", relationFamily: "design_reasoning", traversalWeight: 0.85 },
    { source: "primitive", target: "thesis", type: "IMPLEMENTS", relationFamily: "normative", traversalWeight: 0.8 },
    { source: "pilot", target: "target", type: "TESTS", relationFamily: "validation", traversalWeight: 0.8 },
    ...["risk", "thesis", "primitive", "pilot", "target"].map(source => ({ source, target: "doc", type: "DERIVED_FROM", relationFamily: "evidence", relationScope: "provenance", traversalWeight: 0.95 }))
  ];

  const plan = transformClusterToPresentation({ nodes, links }, { focusNode: nodes[1] });
  const thesis = plan.rankedNodes.find(node => node.id === "thesis");
  const document = plan.rankedNodes.find(node => node.id === "doc");
  assert.ok(thesis.importance > document.importance);
  assert.equal(plan.meta.semanticRelationCount, 3);
  assert.equal(plan.meta.provenanceRelationCount, 5);
  assert.equal(plan.sections.at(-1).id, "source");
  assert.notEqual(plan.patterns[0].type, "provenance");
  assert.ok(plan.orderedNodeIds.indexOf("risk") < plan.orderedNodeIds.indexOf("thesis"));
  assert.ok(plan.orderedNodeIds.indexOf("target") < plan.orderedNodeIds.indexOf("pilot"));
  assert.match(plan.markdown, /## Provenance/);
});

test("typed relations produce explicit emergent patterns", () => {
  const nodes = [
    { id: "method", name: "Méthode", phrase: "La méthode borne l’inférence.", nodeType: "method", clusterId: "c" },
    { id: "critique", name: "Critique", phrase: "La critique reste multidimensionnelle.", nodeType: "mechanism", clusterId: "c" },
    { id: "pilot", name: "Pilote", phrase: "Le pilote teste.", nodeType: "experiment", clusterId: "c" },
    { id: "claim", name: "Claim", phrase: "Le claim est testable.", nodeType: "claim", clusterId: "c" }
  ];
  const links = [
    { source: "method", target: "critique", type: "GROUNDS", relationFamily: "normative" },
    { source: "pilot", target: "claim", type: "TESTS", relationFamily: "validation" }
  ];
  const plan = transformClusterToPresentation({ nodes, links });
  assert.ok(plan.patterns.some(pattern => pattern.type === "foundation"));
  assert.ok(plan.patterns.some(pattern => pattern.type === "validation"));
  assert.deepEqual(plan.patterns.find(pattern => pattern.type === "validation").relationTypes, ["TESTS"]);
  assert.equal(plan.relationNarratives[0].sentence, "Méthode fonde Critique.");
  assert.match(plan.markdown, /\*fonde\*/);
  assert.match(plan.markdown, /- \*\*Méthode\*\*/);
});

test("sections and links follow causal narrative order rather than relation types", () => {
  const nodes = [
    { id: "context", name: "Contexte · Ville", phrase: "La ville sert de terrain.", nodeType: "context", clusterId: "c" },
    { id: "problem", name: "Tension · Fragmentation", phrase: "Les services sont fragmentés.", nodeType: "open_question", clusterId: "c" },
    { id: "goal", name: "Cible · Continuité", phrase: "La continuité est recherchée.", nodeType: "system_state", epistemicStatus: "target", clusterId: "c" },
    { id: "mechanism", name: "Mécanisme · Coordination", phrase: "La coordination relie les services.", nodeType: "mechanism", clusterId: "c" },
    { id: "effect", name: "Effet · Accès", phrase: "L’accès devient continu.", nodeType: "design_effect", clusterId: "c" }
  ];
  const links = [
    { source: "mechanism", target: "effect", type: "LEADS_TO" },
    { source: "problem", target: "goal", type: "MOTIVATES" },
    { source: "context", target: "mechanism", type: "APPLIES_IN" }
  ];
  const plan = transformClusterToPresentation({ nodes, links });
  assert.deepEqual(plan.sections.map(section => section.id), ["context", "problem", "target", "mechanism", "effect"]);
  assert.equal(plan.relationNarratives.at(-1).sentence, "Coordination conduit à Accès.");
  assert.ok(plan.sections.find(section => section.id === "effect").relations.some(relation => relation.type === "LEADS_TO"));
});
