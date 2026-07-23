// Fait remonter les arbitrages de code déjà tranchés, pour qu'un agent qui va
// modifier un paramètre ou l'architecture voie ce qui a été écarté avant de le
// rouvrir. Projection du graphe, rien n'est recopié.
//
//   node scripts/code-decisions.js                 → rapport lisible
//   node scripts/code-decisions.js --json          → sortie machine
//   node scripts/code-decisions.js graph-query      → filtre par paramètre / cluster / id
import { collectCodeDecisions } from "../src/code-decisions.js";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const filter = args.find(arg => !arg.startsWith("--"))?.toLowerCase() || null;

const matches = decision => {
  if (!filter) return true;
  const haystack = [decision.id, decision.clusterId, decision.name, ...decision.codeParameters].join(" ").toLowerCase();
  return haystack.includes(filter);
};

const { decisions, openQuestions } = await collectCodeDecisions();
const selected = decisions.filter(matches);

if (asJson) {
  console.log(JSON.stringify({ decisions: selected, openQuestions }, null, 2));
  process.exit(0);
}

const bullet = (items, prefix = "    · ") => items.map(item => `${prefix}${item}`).join("\n");

const lines = [];
lines.push("ARBITRAGES DE CODE DÉJÀ TRANCHÉS");
lines.push("Un statut `approved` garde ses options écartées. Les rouvrir demande une");
lines.push("preuve qui bat la `closureEvidence` enregistrée, pas une opinion neuve.");
lines.push(filter ? `Filtre : « ${filter} »` : "");
lines.push("");

for (const decision of selected) {
  lines.push(`── ${decision.name}  [${decision.status}]`);
  lines.push(`   cluster ${decision.clusterId} · ${decision.id}`);
  if (decision.codeParameters.length) lines.push(`   paramètres : ${decision.codeParameters.map(ref => `\`${ref}\``).join(", ")}`);
  if (decision.chosen) {
    lines.push(`   RETENU → ${decision.chosen.name} : ${decision.chosen.phrase}`);
  }
  if (decision.rationale) lines.push(`   pourquoi : ${decision.rationale}`);
  if (decision.rejected.length) {
    lines.push("   DÉJÀ ÉCARTÉ :");
    for (const option of decision.rejected) {
      lines.push(`     ✗ ${option.name} — ${option.phrase}`);
      if (option.whyRejected.length) lines.push(bullet(option.whyRejected, "        motif : "));
      if (option.conditionsToRevisit.length) lines.push(bullet(option.conditionsToRevisit, "        rouvrir si : "));
    }
  }
  if (decision.closureEvidence) lines.push(`   ce qui rouvrirait : battre → ${decision.closureEvidence}`);
  if (decision.reviewDate) lines.push(`   revue prévue : ${decision.reviewDate}`);
  lines.push("");
}

if (!selected.length) lines.push(filter ? "Aucun arbitrage de code ne correspond au filtre." : "Aucun arbitrage de code enregistré.");

if (openQuestions.length && !filter) {
  lines.push("QUESTIONS DE CODE ENCORE OUVERTES (à ne pas trancher seul en passant) :");
  for (const question of openQuestions) lines.push(`   ? ${question.name} — ${question.phrase}`);
  lines.push("");
}

console.log(lines.filter(line => line !== null).join("\n"));
