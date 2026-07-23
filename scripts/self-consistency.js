// Plafond d'auto-cohérence (metric-self-consistency-ceiling). Deux passages du même
// questionnaire à trois semaines d'écart ; leur accord borne tout score de prédiction.
//
//   node scripts/self-consistency.js --new=pass-1   → crée un fichier réponses vierge
//   node scripts/self-consistency.js --score        → compare pass-1 et pass-2
//
// Le script ne répond jamais à la place de la personne : il ne fait que dérouler les
// questions et, quand les deux passages existent, mesurer leur accord.

import fs from "node:fs/promises";
import path from "node:path";
import { ledgerDir } from "../src/prediction-ledger.js";

const questionsPath = path.join(ledgerDir, "self-consistency-questions.json");
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, value] = arg.replace(/^--/, "").split("=");
  return [key, value ?? true];
}));

const bank = JSON.parse(await fs.readFile(questionsPath, "utf8"));

if (args.new) {
  const target = path.join(ledgerDir, `${args.new}.json`);
  const scaffold = {
    pass: args.new,
    filledAt: null,
    answers: Object.fromEntries(bank.questions.map(question => [question.id, null]))
  };
  await fs.writeFile(target, JSON.stringify(scaffold, null, 2) + "\n");
  console.log(`Fichier réponses créé : artifacts/prediction/${args.new}.json`);
  console.log(`Remplis chaque valeur par "A", "B" ou "C" (les intitulés sont dans self-consistency-questions.json).`);
  process.exit(0);
}

if (args.score) {
  const read = async name => JSON.parse(await fs.readFile(path.join(ledgerDir, `${name}.json`), "utf8"));
  let pass1, pass2;
  try { pass1 = await read("pass-1"); pass2 = await read("pass-2"); }
  catch { console.error("Il faut pass-1.json et pass-2.json remplis dans artifacts/prediction/."); process.exit(2); }

  const domainOf = Object.fromEntries(bank.questions.map(question => [question.id, question.domain]));
  let agree = 0, total = 0;
  const byDomain = {};
  for (const question of bank.questions) {
    const a = pass1.answers[question.id];
    const b = pass2.answers[question.id];
    if (!a || !b) continue;
    total += 1;
    const same = a === b;
    if (same) agree += 1;
    const domain = domainOf[question.id];
    byDomain[domain] ??= { agree: 0, total: 0 };
    byDomain[domain].total += 1;
    if (same) byDomain[domain].agree += 1;
  }

  if (!total) { console.error("Aucune question répondue dans les deux passages."); process.exit(2); }
  const ceiling = agree / total;
  console.log(`Plafond d'auto-cohérence : ${(ceiling * 100).toFixed(0)}% (${agree}/${total})`);
  console.log(`C'est la borne haute qu'un prédicteur peut atteindre. Au-dessus, il mesure la structure des questions, pas toi.`);
  for (const [domain, stats] of Object.entries(byDomain)) {
    console.log(`  ${domain.padEnd(22)} ${(stats.agree / stats.total * 100).toFixed(0)}%  (${stats.agree}/${stats.total})`);
  }
  process.exit(0);
}

console.log("Usage : --new=pass-1 pour créer un fichier réponses, --score pour comparer pass-1 et pass-2.");
