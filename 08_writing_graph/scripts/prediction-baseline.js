// Calcule la baseline de routine : le taux de base de chaque événement observable,
// sur les jours réellement observés. C'est le prédicteur « simple habitude » que le
// moteur doit battre pour prouver qu'il a appris une personne et non un emploi du
// temps (axiom-accuracy-on-the-trivial-counts-for-nothing).
//
// Aujourd'hui l'histoire tient sur un seul jour : le script le déclare au lieu de
// fabriquer un taux. Les questions structurelles n'ont donc pas encore de base rate
// et restent à null ; elles se rempliront à mesure que le journal accumule des jours
// scellés et notés. Refuser d'inventer une baseline est le cœur du dispositif.

import fs from "node:fs/promises";
import { QUESTION_IDS, baselinePath, readLedger, ledgerDir } from "../src/prediction-ledger.js";
import { sessionActivity, localDay } from "../src/prediction-observer.js";
import os from "node:os";
import path from "node:path";

const sessionsDir = path.join(os.homedir(), ".claude", "projects", "C--Users-reyno-OneDrive-Documents-body-suit");

// Jours pour lesquels on dispose d'une trace d'activité de session.
async function observedDays() {
  const files = (await fs.readdir(sessionsDir).catch(() => [])).filter(file => file.endsWith(".jsonl"));
  const days = new Set();
  for (const file of files) {
    const raw = await fs.readFile(path.join(sessionsDir, file), "utf8").catch(() => "");
    for (const line of raw.split("\n")) {
      if (!line) continue;
      try {
        const stamp = JSON.parse(line).timestamp;
        if (stamp) days.add(localDay(new Date(stamp)));
      } catch { /* ligne non json */ }
    }
  }
  return [...days].sort();
}

const days = await observedDays();

// Occurrences par question. Les trois questions de session se calculent à partir des
// transcripts ; les autres n'ont pas d'historique complet et restent non observées.
const sessionDerived = new Set(["session_any", "session_multi", "evening_work"]);
const counts = Object.fromEntries(QUESTION_IDS.map(id => [id, { observedDays: 0, occurred: 0 }]));

for (const day of days) {
  const activity = await sessionActivity(day);
  for (const id of ["session_any", "session_multi", "evening_work"]) counts[id].observedDays += 1;
  if (activity.activeSessions >= 1) counts.session_any.occurred += 1;
  if (activity.activeSessions >= 2) counts.session_multi.occurred += 1;
  if (activity.eveningWork) counts.evening_work.occurred += 1;
}

// Enrichissement par les issues déjà notées dans le journal : chaque jour scellé et
// noté ajoute une observation à chaque question, y compris structurelle.
const ledger = await readLedger();
const scored = ledger.filter(entry => entry.kind === "score");
for (const entry of scored) {
  for (const [id, outcome] of Object.entries(entry.outcomes || {})) {
    if (outcome === null || sessionDerived.has(id)) continue;
    if (!counts[id]) continue;
    counts[id].observedDays += 1;
    counts[id].occurred += outcome ? 1 : 0;
  }
}

const baseline = {
  computedAt: new Date().toISOString(),
  observedDaysTotal: days.length,
  degenerate: days.length < 7,
  note: days.length < 7
    ? `Baseline dégénérée : ${days.length} jour(s) d'histoire. Les taux ne sont pas fiables et les questions structurelles restent sans base rate tant que le journal n'a pas accumulé des jours notés. Aucun score de compétence n'est interprétable avant d'avoir une vraie baseline.`
    : "Baseline calculée sur un historique pluri-journalier.",
  questions: Object.fromEntries(QUESTION_IDS.map(id => {
    const { observedDays, occurred } = counts[id];
    return [id, {
      observedDays,
      occurred,
      prob: observedDays > 0 ? occurred / observedDays : null
    }];
  }))
};

await fs.mkdir(ledgerDir, { recursive: true });
await fs.writeFile(baselinePath, JSON.stringify(baseline, null, 2) + "\n");

console.log(`Baseline de routine écrite dans artifacts/prediction/baseline.json`);
console.log(`Jours observés : ${days.length}${baseline.degenerate ? " (DÉGÉNÉRÉE — voir note)" : ""}`);
for (const id of QUESTION_IDS) {
  const q = baseline.questions[id];
  console.log(`  ${id.padEnd(22)} ${q.prob === null ? "sans base rate" : q.prob.toFixed(2)}  (${q.occurred}/${q.observedDays})`);
}
