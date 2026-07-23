// Émet les prédictions scellées pour un jour cible (par défaut : demain, en local).
// Chaque prédiction porte une probabilité, l'instantané de l'état actuel du dépôt
// (pour permettre la notation par diff), et le prédicteur qui l'a produite. Le tout
// est figé par un hash : c'est le préenregistrement continu de mech-prediction-ledger.
//
//   npm run predict:day                      → prédicteur baseline, cible = demain
//   node scripts/predict-day.js --engine=FICHIER.json  → probabilités fournies
//   node scripts/predict-day.js --date=2026-07-24
//
// FICHIER.json : { "engine": "nom", "predictions": { "session_any": 0.9, ... } }
// Toute probabilité manquante retombe sur la baseline de routine.

import fs from "node:fs/promises";
import {
  QUESTIONS, QUESTION_IDS, appendPrediction, baselinePath
} from "../src/prediction-ledger.js";
import { snapshot } from "../src/prediction-observer.js";

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

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const targetDate = args.date || localDay(tomorrow);

const baseline = JSON.parse(await fs.readFile(baselinePath, "utf8").catch(() => '{"questions":{}}'));
const baselineProb = id => baseline.questions?.[id]?.prob;

let engineName = "baseline-routine";
let provided = {};
if (args.engine) {
  const file = JSON.parse(await fs.readFile(args.engine, "utf8"));
  engineName = file.engine || "engine";
  provided = file.predictions || {};
}

// Une probabilité manquante retombe sur la baseline ; une baseline absente retombe
// sur 0.5, marqué comme prior non informatif — jamais présenté comme un savoir.
const predictions = {};
for (const id of QUESTION_IDS) {
  const fromEngine = provided[id];
  const fromBaseline = baselineProb(id);
  const prob = fromEngine ?? fromBaseline ?? 0.5;
  predictions[id] = {
    prob,
    source: fromEngine !== undefined ? engineName : fromBaseline != null ? "baseline-routine" : "uninformative-prior",
    baselineProb: fromBaseline ?? null
  };
}

const entry = {
  targetDate,
  sealedAt: new Date().toISOString(),
  engine: engineName,
  predictions,
  snapshot: await snapshot(),
  // À l'émission, aucune prédiction n'a été suivie d'une action du système : la
  // période est propre par construction. Le champ est enregistré pour que cette
  // référence non contaminée soit datée avant qu'un moteur agissant n'existe.
  cleanPeriod: true,
  contaminatedQuestions: []
};

const sealed = await appendPrediction(entry);
console.log(`Prédictions scellées pour ${targetDate} (prédicteur : ${engineName}).`);
console.log(`Seal ${sealed.seal.slice(0, 16)}…`);
for (const q of QUESTIONS) {
  const p = predictions[q.id];
  console.log(`  ${q.id.padEnd(22)} ${p.prob.toFixed(2)}  [${p.source}]`);
}
