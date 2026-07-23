// Projette, depuis le graphe de design, les arbitrages déjà tranchés qui
// gouvernent le code de l'outil lui-même. Un agent qui va modifier un paramètre
// ou l'architecture doit voir ce qui a déjà été comparé, retenu et *écarté*,
// pour ne pas rouvrir une décision close avec une opinion neuve.
//
// Rien n'est recopié ni réécrit : chaque valeur vient du graphe. Ce module est
// une lecture, jamais une source. Deux consommateurs : `scripts/code-decisions.js`
// pour le rendu, et l'indicateur `analyze` pour le compte.
import { loadManifest, activeGraphs, readDatasets, datasetNodes, datasetLinks } from "./graph-manifest.js";

/**
 * Clusters qui décrivent le code de l'outil, pas la doctrine du protocole.
 * Ajouter un cluster de code se fait ici, en une ligne : tout le reste suit.
 */
export const CODE_CLUSTERS = Object.freeze(["code-parameters", "graph-architecture"]);

const isCodeCluster = node => node && CODE_CLUSTERS.includes(node.clusterId);

/**
 * Charge tous les nœuds et liens du graphe de design, puis restreint aux
 * clusters de code. On garde l'index global des nœuds pour résoudre les options
 * et raisons, même si un lien traverse deux fichiers.
 */
async function loadDesignGraph() {
  const manifest = await loadManifest();
  const design = activeGraphs(manifest).find(graph => graph.id === "design");
  if (!design) throw new Error("Graphe de design introuvable dans le manifeste.");
  const datasets = await readDatasets(design);
  const nodes = datasets.flatMap(datasetNodes);
  const links = datasets.flatMap(datasetLinks);
  return { nodes, links };
}

/**
 * Arbitrages de code, groupés par cluster. Pour chaque décision on rattache sa
 * raison de design (MOTIVATES), l'option retenue et — c'est le cœur — les
 * options déjà écartées avec le motif de leur rejet.
 */
export async function collectCodeDecisions() {
  const { nodes, links } = await loadDesignGraph();
  const byId = new Map(nodes.map(node => [node.id, node]));

  const optionsOf = decisionId => links
    .filter(link => link.type === "OPTION_FOR" && link.target === decisionId)
    .map(link => byId.get(link.source))
    .filter(Boolean);

  const rationalesOf = decisionId => links
    .filter(link => link.type === "MOTIVATES" && link.target === decisionId)
    .map(link => byId.get(link.source))
    .filter(Boolean);

  const decisions = nodes
    .filter(node => node.nodeType === "decision" && isCodeCluster(node))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(decision => {
      const options = optionsOf(decision.id).sort((a, b) => a.id.localeCompare(b.id));
      const chosen = options.find(option => option.id === decision.chosenOptionId) || null;
      const rejected = options.filter(option => option.id !== decision.chosenOptionId);
      return {
        id: decision.id,
        clusterId: decision.clusterId,
        name: decision.name,
        phrase: decision.phrase,
        status: decision.decisionStatus || "unknown",
        settled: decision.decisionStatus === "approved",
        codeParameters: decision.codeParameters || [],
        evidenceRung: decision.evidenceRung || null,
        reviewDate: decision.reviewDate || null,
        closureEvidence: decision.closureEvidence || null,
        rationale: decision.decisionRationale || null,
        motivations: rationalesOf(decision.id).map(node => ({ id: node.id, phrase: node.phrase })),
        chosen: chosen && { id: chosen.id, name: chosen.name, phrase: chosen.phrase, benefits: chosen.optionBenefits || [] },
        rejected: rejected.map(option => ({
          id: option.id,
          name: option.name,
          phrase: option.phrase,
          whyRejected: option.optionRisks || [],
          conditionsToRevisit: option.optionConditions || []
        }))
      };
    });

  // Questions ouvertes des mêmes clusters : ce qui n'est PAS tranché, donc à ne
  // pas trancher seul en passant.
  const openQuestions = nodes
    .filter(node => node.nodeType === "open_question" && isCodeCluster(node))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(node => ({ id: node.id, clusterId: node.clusterId, name: node.name, phrase: node.phrase }));

  return { clusters: CODE_CLUSTERS, decisions, openQuestions };
}

/**
 * Résumé chiffré pour l'indicateur `analyze` : combien d'arbitrages de code sont
 * clos, et quel index de paramètres de code ils couvrent.
 */
export async function codeDecisionSummary() {
  const { decisions, openQuestions } = await collectCodeDecisions();
  const settled = decisions.filter(decision => decision.settled);
  const parameters = [...new Set(settled.flatMap(decision => decision.codeParameters))].sort();
  return {
    settled: settled.length,
    unsettled: decisions.length - settled.length,
    openQuestions: openQuestions.length,
    coveredParameters: parameters
  };
}
