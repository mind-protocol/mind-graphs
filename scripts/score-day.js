// Note les prédictions scellées d'un jour désormais passé, en confrontant leur
// instantané à l'état courant et à l'activité de session. La note est une règle
// propre (Brier, log loss) et surtout l'écart à la baseline de routine — jamais une
// exactitude brute. Le résultat est ajouté au journal, sans toucher la prédiction.
//
//   npm run score:day                    → note le jour d'hier
//   node scripts/score-day.js --date=2026-07-24
//
// Une question dont l'issue n'est pas encore observable est laissée à null : le
// silence est déclaré, jamais comblé par une valeur commode.

import {
  QUESTIONS, readLedger, appendScore, verifySeal, scoreItems
} from "../src/prediction-ledger.js";
import { observe, snapshot } from "../src/prediction-observer.js";

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, value] = arg.replace(/^--/, "").split("=");
  return [key, value ?? true];
}));

function localDay(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);
const targetDate = args.date || localDay(yesterday);

const ledger = await readLedger();
const prediction = ledger.find(entry => entry.kind === "prediction" && entry.targetDate === targetDate);
if (!prediction) {
  console.error(`Aucune prédiction scellée pour ${targetDate}.`);
  process.exit(2);
}
if (ledger.some(entry => entry.kind === "score" && entry.targetDate === targetDate)) {
  console.error(`${targetDate} est déjà noté. Le journal n'est pas réécrit.`);
  process.exit(2);
}
if (!verifySeal(prediction)) {
  console.error(`SCEAU INVALIDE pour ${targetDate} : la prédiction a été altérée après scellement. Notation refusée.`);
  process.exit(1);
}

const current = await snapshot();
const outcomes = await observe(targetDate, prediction.snapshot, current);

const contaminated = new Set(prediction.contaminatedQuestions || []);
const items = [];
for (const q of QUESTIONS) {
  const outcome = outcomes[q.id];
  if (outcome === null || outcome === undefined) continue;
  const p = prediction.predictions[q.id];
  items.push({
    questionId: q.id,
    prob: p.prob,
    baselineProb: p.baselineProb ?? 0.5,
    outcome,
    contaminated: contaminated.has(q.id)
  });
}

const summary = scoreItems(items);
const scoreEntry = {
  targetDate,
  scoredAt: new Date().toISOString(),
  engine: prediction.engine,
  outcomes,
  items,
  summary,
  observedItems: items.length,
  baselineDegenerate: items.some(item => item.baselineProb === 0.5)
};
await appendScore(scoreEntry);

console.log(`Jour ${targetDate} noté — prédicteur ${prediction.engine}.`);
for (const item of items) {
  console.log(`  ${item.questionId.padEnd(22)} p=${item.prob.toFixed(2)} base=${item.baselineProb.toFixed(2)} → ${item.outcome}  skill=${(item.baselineProb - item.outcome) ** 2 - (item.prob - item.outcome) ** 2 >= 0 ? "+" : ""}${((item.baselineProb - item.outcome) ** 2 - (item.prob - item.outcome) ** 2).toFixed(3)}${item.contaminated ? "  [contaminée]" : ""}`);
}
console.log(`Issues propres : ${summary.clean.n}`);
if (summary.clean.n) {
  console.log(`  Brier ${summary.clean.brier.toFixed(3)} · log loss ${summary.clean.logLoss.toFixed(3)} · compétence vs routine ${summary.clean.skill >= 0 ? "+" : ""}${summary.clean.skill.toFixed(3)}`);
}
if (scoreEntry.baselineDegenerate) {
  console.log(`  ⚠ baseline dégénérée sur au moins une question : la compétence n'est pas encore interprétable. Recalcule après plusieurs jours (npm run predict:baseline).`);
}
