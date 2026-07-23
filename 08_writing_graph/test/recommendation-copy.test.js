import test from "node:test";
import assert from "node:assert/strict";
import { serializeRecommendations } from "../public/recommendation-copy.js";

test("all recommendation fields are serialized into a paste-ready report", () => {
  const text = serializeRecommendations([{
    priority: 91,
    severity: "critique",
    category: "unanswered_question",
    categoryLabel: "Questions non résolues",
    title: "Définir la récupération des wallets",
    nodeId: "repo-question-wallet-custody",
    clusters: ["mind-protocol-github-l4"],
    documents: ["Economy Sync"],
    relatedEdgeCount: 2,
    problem: "La récupération reste indéfinie.",
    prioritySignals: ["bloque deux mécanismes"],
    summary: "Question ouverte centrale.",
    diagnosis: "Aucune solution candidate.",
    metrics: [{ label: "Aval", value: "2 nœuds" }],
    why: "La custodie conditionne le lancement.",
    risk: "Perte définitive des fonds.",
    context: "Solana devnet.",
    probableCauses: ["architecture MPC absente"],
    steps: ["Écrire les scénarios de récupération", "Tester le multisig"],
    graphPatch: "ADDRESSES(solution, question)",
    closureCriteria: ["Un mécanisme est documenté"],
    reviewQuestions: ["Qui peut déclencher la récupération ?"]
  }], { methodVersion: "1.4", nodeCount: 275, linkCount: 522 });

  for (const expected of ["91", "repo-question-wallet-custody", "bloque deux mécanismes", "Aucune solution candidate", "architecture MPC absente", "Tester le multisig", "ADDRESSES(solution, question)", "Qui peut déclencher la récupération ?", "275 nœuds · 522 relations"]) {
    assert.match(text, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(text, /\[object Object\]/);
});
