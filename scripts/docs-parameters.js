// Rend en texte l'état réel des paramètres du code et de leur justification.
//
// Rien n'est recopié : chaque valeur vient de la déclaration que l'algorithme
// exécute, chaque justification vient du graphe. Le fichier produit est une
// projection, jamais une source — l'éditer à la main serait perdre la
// modification à la prochaine génération, d'où le mode --check.
//
//   node scripts/docs-parameters.js          → régénère ALGORITHM_PARAMETERS.md
//   node scripts/docs-parameters.js --check  → échoue (code 1) si le fichier est périmé
import fs from "node:fs/promises";
import path from "node:path";
import { projectDir, loadManifest, activeGraphs, loadOntology, readDatasets, datasetNodes } from "../src/graph-manifest.js";
import { PARAMETER_MODULES, listCodeParameters, parameterCoverage } from "../src/code-parameters.js";

const checkOnly = process.argv.includes("--check");
const target = path.join(projectDir, "ALGORITHM_PARAMETERS.md");

const manifest = await loadManifest();
const design = activeGraphs(manifest).find(graph => graph.id === "design");
const ontology = await loadOntology(design);
const nodes = (await readDatasets(design)).flatMap(entry => datasetNodes(entry));
const decisions = new Map(nodes.filter(node => node.nodeType === "decision").map(node => [node.id, node]));

const rungLabel = id => ontology.evidenceLadder.rungs.find(rung => rung.id === id)?.label || id;

function renderRungScale() {
  const rows = ontology.evidenceLadder.rungs.map(rung =>
    `| ${rung.rank} | \`${rung.id}\` | ${rung.label} | ${rung.selfInvalidating ? "oui" : "non"} | ${rung.requiresReviewDate ? "obligatoire" : "facultative"} |`
  );
  return [
    "| Rang | Identifiant | Barreau | S'auto-invalide | Date de revue |",
    "|---:|---|---|---|---|",
    ...rows
  ].join("\n");
}

function renderModule(module) {
  const rows = Object.entries(module.parameters).map(([name, spec]) => {
    const decision = spec.decisionId ? decisions.get(spec.decisionId) : null;
    const justification = !spec.decisive
      ? "—"
      : decision
        ? `[${decision.decisionStatus}] ${decision.evidenceRung ? rungLabel(decision.evidenceRung) : "**aucun barreau**"}`
        : "**aucune décision**";
    return `| \`${name}\` | ${spec.value} | ${spec.unit} | ${spec.decisive ? "oui" : "non"} | ${justification} | ${spec.role} |`;
  });
  return [
    `## ${module.label}`,
    "",
    module.purpose,
    "",
    "| Paramètre | Valeur | Unité | Décisif | Justification | Rôle |",
    "|---|---:|---|---|---|---|",
    ...rows,
    "",
    `> ${module.limitation}`
  ].join("\n");
}

function renderDecisions() {
  const parameterDecisions = nodes.filter(node => Array.isArray(node.codeParameters));
  if (!parameterDecisions.length) return "Aucune décision de paramètre enregistrée.";
  return parameterDecisions.map(decision => [
    `### ${decision.name}`,
    "",
    `- **Paramètres visés** : ${decision.codeParameters.map(ref => `\`${ref}\``).join(", ")}`,
    `- **Statut** : ${decision.decisionStatus} · responsable : ${decision.responsibleRole}`,
    `- **Barreau de preuve** : ${decision.evidenceRung ? rungLabel(decision.evidenceRung) : "**aucun**"}${decision.evidenceRungNote ? ` — ${decision.evidenceRungNote}` : ""}`,
    `- **Revue prévue** : ${decision.reviewDate}`,
    `- **Ce qui clôturerait** : ${decision.closureEvidence}`,
    "",
    decision.summary
  ].join("\n")).join("\n\n");
}

const coverage = parameterCoverage();
const document = [
  "<!-- Fichier généré par `npm run docs:parameters`. Ne pas éditer à la main :",
  "     les valeurs viennent du code qui les exécute, les justifications du graphe. -->",
  "",
  "# Paramètres des algorithmes",
  "",
  ontology.parameterContract.purpose,
  "",
  `**État** : ${coverage.decisive} paramètres décisifs sur ${coverage.total} déclarés · ${coverage.justified} portent une décision.`,
  "",
  ontology.parameterContract.measurementPrinciple,
  "",
  "## Échelle de preuve",
  "",
  ontology.evidenceLadder.principle,
  "",
  renderRungScale(),
  "",
  ...PARAMETER_MODULES.map(module => `${renderModule(module)}\n`),
  "## Décisions ouvertes",
  "",
  renderDecisions(),
  ""
].join("\n");

const current = await fs.readFile(target, "utf8").catch(() => null);
if (current === document) {
  console.log("ALGORITHM_PARAMETERS.md déjà à jour.");
} else if (checkOnly) {
  console.error("Périmé : ALGORITHM_PARAMETERS.md. Lance `npm run docs:parameters`.");
  process.exit(1);
} else {
  await fs.writeFile(target, document);
  console.log(`Écrit : ALGORITHM_PARAMETERS.md (${coverage.justified}/${coverage.decisive} paramètres décisifs justifiés)`);
}
