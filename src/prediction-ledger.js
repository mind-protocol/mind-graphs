// Journal scellé de prédictions — implémentation minimale de mech-prediction-ledger
// et mech-skill-scoring-against-routine-baseline (cluster human-prediction-engine).
//
// Doctrine appliquée ici, pas seulement décrite dans le graphe :
//   - une prédiction non écrite avant l'issue n'existe pas : le journal est
//     append-only et chaque entrée porte le hash de son contenu scellé ;
//   - le score n'est jamais une exactitude brute : on rend Brier et log loss,
//     et surtout l'écart à une baseline de routine (skill) ;
//   - une issue précédée d'une action du système est contaminée et ne compte pas
//     dans le score de compétence sur la personne (champ `contaminated`).
//
// La vérité de terrain est produite par un observateur déterministe (un script),
// jamais par une notation humaine : c'est ce qui remplace l'aveuglement du
// correcteur. Voir axiom-reality-writes-the-questions.

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { projectDir } from "./graph-manifest.js";

export const ledgerDir = path.join(projectDir, "artifacts", "prediction");
export const ledgerPath = path.join(ledgerDir, "ledger.jsonl");
export const baselinePath = path.join(ledgerDir, "baseline.json");

// Chaque question est un événement observable dont la vérité se lit dans deux
// instantanés (avant / après) ou dans les traces de session. Aucune ne demande
// un jugement. `direction` note le sens humain, sans effet sur le score.
export const QUESTIONS = [
  { id: "session_any", text: "Au moins une session de travail a lieu ce jour-là." },
  { id: "session_multi", text: "Plus d'une session distincte est active ce jour-là." },
  { id: "evening_work", text: "Du travail a lieu après 20 h locale." },
  { id: "data_touched", text: "Au moins un fichier data/*.json est modifié." },
  { id: "new_district", text: "Un nouveau jeu de données apparaît dans graphs.json." },
  { id: "ontology_bumped", text: "La version de l'ontologie (schemaVersion) change." },
  { id: "new_test", text: "Un nouveau fichier test/*.test.js apparaît." },
  { id: "project_work_touched", text: "data/project-work.json est modifié." },
  { id: "consultation_touched", text: "data/consultations.json est modifié." },
  { id: "doc_touched", text: "Au moins un fichier *.md du projet est modifié." }
];

export const QUESTION_IDS = QUESTIONS.map(question => question.id);

// Un enregistrement scellé est figé par le hash de ses champs prédictifs. Toute
// réécriture ultérieure change le hash et devient détectable : c'est le
// préenregistrement, appliqué en continu.
export function sealPrediction(entry) {
  const material = JSON.stringify({
    targetDate: entry.targetDate,
    sealedAt: entry.sealedAt,
    engine: entry.engine,
    predictions: entry.predictions
  });
  return createHash("sha256").update(material).digest("hex");
}

export function verifySeal(entry) {
  return entry.seal === sealPrediction(entry);
}

export async function readLedger() {
  try {
    const raw = await fs.readFile(ledgerPath, "utf8");
    return raw.split("\n").filter(Boolean).map(line => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

// Append-only : on refuse d'écrire une prédiction pour une date déjà scellée.
// Écraser une prédiction ratée est exactement ce que le journal interdit.
export async function appendPrediction(entry) {
  await fs.mkdir(ledgerDir, { recursive: true });
  const existing = await readLedger();
  if (existing.some(record => record.kind === "prediction" && record.targetDate === entry.targetDate)) {
    throw new Error(`Une prédiction est déjà scellée pour ${entry.targetDate}. Le journal est append-only.`);
  }
  const sealed = { ...entry, kind: "prediction", seal: sealPrediction(entry) };
  await fs.appendFile(ledgerPath, JSON.stringify(sealed) + "\n");
  return sealed;
}

export async function appendScore(entry) {
  await fs.mkdir(ledgerDir, { recursive: true });
  await fs.appendFile(ledgerPath, JSON.stringify({ ...entry, kind: "score" }) + "\n");
  return entry;
}

// Règles de score propres. `prob` est la probabilité annoncée que l'événement
// survienne ; `outcome` vaut 1 s'il est survenu, 0 sinon.
export function brier(prob, outcome) {
  return (prob - outcome) ** 2;
}

export function logLoss(prob, outcome) {
  const clamped = Math.min(1 - 1e-9, Math.max(1e-9, prob));
  return -(outcome * Math.log(clamped) + (1 - outcome) * Math.log(1 - clamped));
}

// Compétence = de combien on bat la simple habitude. Positif : le prédicteur fait
// mieux que la baseline de routine sur cet item. Nul : il a appris un emploi du
// temps, pas une personne (axiom-accuracy-on-the-trivial-counts-for-nothing).
export function skillVsBaseline(prob, baselineProb, outcome) {
  return brier(baselineProb, outcome) - brier(prob, outcome);
}

// Agrège une liste d'items {prob, baselineProb, outcome, contaminated} en séparant
// le signal propre du signal contaminé : les deux ne partagent jamais leur score.
export function scoreItems(items) {
  const clean = items.filter(item => !item.contaminated);
  const contaminated = items.filter(item => item.contaminated);
  const summarise = subset => {
    if (!subset.length) return { n: 0, brier: null, logLoss: null, skill: null };
    const mean = pick => subset.reduce((sum, item) => sum + pick(item), 0) / subset.length;
    return {
      n: subset.length,
      brier: mean(item => brier(item.prob, item.outcome)),
      logLoss: mean(item => logLoss(item.prob, item.outcome)),
      skill: mean(item => skillVsBaseline(item.prob, item.baselineProb, item.outcome))
    };
  };
  return {
    clean: summarise(clean),
    contaminated: summarise(contaminated),
    contaminatedShare: items.length ? contaminated.length / items.length : 0
  };
}
