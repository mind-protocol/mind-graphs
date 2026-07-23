import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CONSULTABLE_CATEGORIES, CONSULTATION_FRAMES, buildConsultationNode, buildHarvestScaffold,
  consultationKey, parseThread, renderConsultationPost, selectConsultationCandidates
} from "../src/consultation.js";

const ontology = JSON.parse(await readFile(new URL("../data/graph-ontology.json", import.meta.url), "utf8"));

const nodes = [
  { id: "mech-a", name: "Mécanisme A", nodeType: "mechanism", phrase: "Fait quelque chose.", summary: "Résumé A." },
  { id: "state-b", name: "État B", nodeType: "system_state", phrase: "Un état.", summary: "Résumé B." },
  { id: "q-1", name: "Question 1", nodeType: "open_question", phrase: "Une question.", summary: "Résumé Q.", decisionNeeded: "Trancher X." },
  { id: "claim-x", name: "Claim X", nodeType: "claim", phrase: "X tient.", summary: "Résumé X." },
  { id: "claim-y", name: "Claim Y", nodeType: "claim", phrase: "Y tient.", summary: "Résumé Y." },
  { id: "obs-1", name: "Observation 1", nodeType: "observation", phrase: "On a mesuré.", summary: "Résumé O." },
  { id: "metric-1", name: "Métrique 1", nodeType: "metric", phrase: "Une unité.", summary: "Résumé M." }
];

const finding = (category, extra) => ({
  id: `${category}:x`, category, priority: 60, title: "T", summary: "S", diagnosis: "D",
  metrics: [], path: [], action: "A", ...extra
});

const report = findings => ({ findings });

test("seules les catégories du contrat de consultation sont soumises", () => {
  const candidates = selectConsultationCandidates(report([
    finding("unanswered_question", { nodeId: "q-1", relatedNodeIds: ["mech-a"] }),
    finding("orphan_metric", { nodeId: "metric-1", relatedNodeIds: ["metric-1"] }),
    finding("observability_gap", { nodeId: "mech-a", relatedNodeIds: ["mech-a"] })
  ]), { nodes, limit: 10 });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].finding.category, "unanswered_question");
});

test("les catégories du code et celles de l'ontologie ne divergent pas", () => {
  assert.deepEqual(
    [...CONSULTABLE_CATEGORIES].sort(),
    [...ontology.consultationContract.eligibleFindingCategories].sort()
  );
});

// Une observation qui contredit une hypothèse contient déjà sa réponse : la soumettre dépenserait
// l'attention d'une audience sur un travail interne.
test("une contradiction tranchée par une observation n'est pas soumise", () => {
  const candidates = selectConsultationCandidates(report([
    finding("contradiction", { nodeId: "claim-x", relatedNodeIds: ["obs-1", "claim-x"] })
  ]), { nodes, limit: 10 });

  assert.deepEqual(candidates, []);
});

test("un lot couvre plusieurs catégories au lieu de saturer la mieux notée", () => {
  const findings = [
    finding("contradiction", { id: "c1", priority: 95, nodeId: "claim-x", relatedNodeIds: ["claim-x", "claim-y"] }),
    finding("contradiction", { id: "c2", priority: 94, nodeId: "claim-y", relatedNodeIds: ["claim-y", "mech-a"] }),
    finding("contradiction", { id: "c3", priority: 93, nodeId: "claim-x", relatedNodeIds: ["claim-x", "mech-a"] }),
    finding("unanswered_question", { id: "q1", priority: 40, nodeId: "q-1", relatedNodeIds: ["mech-a"] })
  ];
  const categories = selectConsultationCandidates(report(findings), { nodes, limit: 3 })
    .map(candidate => candidate.finding.category);

  assert.ok(categories.includes("unanswered_question"), "la question doit sortir malgré son score inférieur");
});

test("la clé est stable d'un run à l'autre et distingue deux contradictions", () => {
  const first = consultationKey("contradiction", ["claim-x", "claim-y"]);
  const second = consultationKey("contradiction", ["claim-x", "claim-y"]);
  const other = consultationKey("contradiction", ["claim-x", "mech-a"]);

  assert.equal(first, second);
  assert.notEqual(first, other);
});

test("une consultation déjà enregistrée n'est pas resoumise", () => {
  const input = report([finding("unanswered_question", { nodeId: "q-1", relatedNodeIds: ["mech-a"] })]);
  const [candidate] = selectConsultationCandidates(input, { nodes, limit: 5 });
  const again = selectConsultationCandidates(input, { nodes, limit: 5, existingKeys: new Set([candidate.key]) });

  assert.deepEqual(again, []);
});

// `nodeId` désigne la cible d'une arête causale et `relatedNodeIds` porte (source, cible) :
// mélanger les deux publierait l'affirmation à l'envers.
test("le cadre causal respecte le sens de la flèche", () => {
  const [candidate] = selectConsultationCandidates(report([
    finding("unquantified_causal", { nodeId: "state-b", relatedNodeIds: ["mech-a", "state-b"] })
  ]), { nodes, limit: 1 });
  const post = renderConsultationPost(candidate, { today: "2026-07-22" });

  assert.match(post, /\*\*Mécanisme A\*\* déplace \*\*État B\*\*/);
});

test("le post ne fuit pas le vocabulaire interne du graphe", () => {
  const candidates = selectConsultationCandidates(report([
    finding("unanswered_question", { nodeId: "q-1", relatedNodeIds: ["mech-a"] }),
    finding("unquantified_causal", { nodeId: "state-b", relatedNodeIds: ["mech-a", "state-b"] }),
    finding("contradiction", { nodeId: "claim-x", relatedNodeIds: ["claim-x", "claim-y"] }),
    finding("underspecified_solution", { nodeId: "mech-a", relatedNodeIds: ["state-b"] })
  ]), { nodes, limit: 4 });

  assert.equal(candidates.length, 4);
  for (const candidate of candidates) {
    const body = renderConsultationPost(candidate, { today: "2026-07-22" })
      .split("\n").filter(line => !line.startsWith("<!--")).join("\n");
    for (const leak of ["ADDRESSES", "SUPPORTS_ESTIMATE", "DERIVED_FROM", "effectSizePct", "confidenceScore", "clusterId", "priorit"]) {
      assert.ok(!body.includes(leak), `${candidate.key} laisse fuiter « ${leak} » dans le post`);
    }
  }
});

test("le post annonce ce qu'une réponse ne pourra pas faire", () => {
  const [candidate] = selectConsultationCandidates(report([
    finding("unquantified_causal", { nodeId: "state-b", relatedNodeIds: ["mech-a", "state-b"] })
  ]), { nodes, limit: 1 });
  const post = renderConsultationPost(candidate, { today: "2026-07-22" });

  assert.match(post, /ne modifient aucune valeur chiffrée/);
  assert.ok(CONSULTATION_FRAMES.unquantified_causal.useless.length > 0);
});

// La publication est un acte humain : un script qui écrirait `published` affirmerait une action
// qui n'a pas eu lieu.
test("une consultation naît toujours en brouillon et respecte son contrat", () => {
  const [candidate] = selectConsultationCandidates(report([
    finding("unanswered_question", { nodeId: "q-1", relatedNodeIds: ["mech-a"] })
  ]), { nodes, limit: 1 });
  const { node, links } = buildConsultationNode(candidate, { today: "2026-07-22", channel: "reddit" });

  assert.equal(node.nodeType, "consultation");
  assert.equal(node.consultationStatus, "draft");
  for (const field of ontology.consultationContract.requiredFields) assert.ok(node[field], `manque ${field}`);
  assert.ok(links.length > 0);
  for (const link of links) {
    assert.equal(link.type, "CONSULTS");
    assert.equal(link.source, node.id);
    assert.ok(link.justification.trim().length > 0);
  }
});

test("CONSULTS ne vise que des types acceptés par le contrat d'ontologie", () => {
  const constraint = ontology.relationConstraints.CONSULTS;
  const allowed = new Set(constraint.targetTypes || []);
  for (const group of constraint.targetGroups || []) {
    for (const type of ontology.typeGroups[group]) allowed.add(type);
  }
  const byId = new Map(nodes.map(node => [node.id, node]));
  const candidates = selectConsultationCandidates(report([
    finding("unanswered_question", { nodeId: "q-1", relatedNodeIds: ["mech-a", "metric-1"] }),
    finding("contradiction", { nodeId: "claim-x", relatedNodeIds: ["claim-x", "claim-y"] })
  ]), { nodes, limit: 5 });

  for (const candidate of candidates) {
    for (const target of candidate.targets) {
      assert.ok(allowed.has(byId.get(target).nodeType), `${target} n'est pas un cible valide de CONSULTS`);
    }
  }
});

test("le fil est découpé par en-tête d'auteur, préambule ignoré", () => {
  const thread = parseThread("intro ignorée\n\n## u/alice\nPremier point.\n\n## bob\nSecond point.\n");

  assert.deepEqual(thread.comments.map(comment => comment.author), ["alice", "bob"]);
  assert.equal(thread.comments[0].body, "Premier point.");
});

test("le squelette de récolte relie chaque réponse et n'ouvre aucune porte au chiffrage", () => {
  const consultation = {
    id: "consultation-question-x", nodeType: "consultation", consultationChannel: "reddit", clusterId: "consultations"
  };
  const scaffold = buildHarvestScaffold(consultation, parseThread("## u/alice\nUn point.\n\n## u/bob\nUn autre.\n"), { today: "2026-07-22" });

  const replies = scaffold.nodes.filter(node => String(node.nodeType).startsWith("TODO"));
  assert.equal(replies.length, 2);
  for (const reply of replies) {
    assert.ok(scaffold.links.some(link => link.type === "ANSWERS" && link.source === reply.id && link.target === consultation.id));
    assert.ok(scaffold.links.some(link => link.type === "AUTHORED_BY" && link.source === reply.id));
  }
  for (const node of scaffold.nodes) {
    for (const field of ["probabilityPct", "confidenceScore", "effectSizePct"]) {
      assert.equal(node[field], undefined, `le squelette ne doit jamais proposer ${field}`);
    }
  }
  assert.ok(!scaffold.links.some(link => link.type === "SUPPORTS_ESTIMATE"));
  assert.equal(scaffold.nodes.filter(node => node.nodeType === "actor").length, 2);
});
