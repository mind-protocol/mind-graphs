// Observateur déterministe du projet — la « réalité » qui écrit les questions et
// note les réponses (axiom-reality-writes-the-questions). Il ne juge rien : il
// photographie l'état du dépôt et lit les horodatages des sessions. Le score se
// calcule ensuite en comparant deux photographies, jamais par une opinion.

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { projectDir, loadManifest } from "./graph-manifest.js";

const dataDir = path.join(projectDir, "data");
const testDir = path.join(projectDir, "test");

// Répertoire des transcripts de session. Seule source d'activité horodatée
// disponible aujourd'hui ; elle est locale à la machine, jamais exportée.
const sessionsDir = path.join(
  os.homedir(), ".claude", "projects", "C--Users-reyno-OneDrive-Documents-body-suit"
);

async function listFiles(dir) {
  try {
    return await fs.readdir(dir);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function fileMtimeDay(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return localDay(stat.mtime);
  } catch {
    return null;
  }
}

// Jour local au format YYYY-MM-DD. « après 20 h » et « ce jour-là » se lisent dans
// le fuseau de la personne, pas en UTC : c'est sa vie qui est le référentiel.
export function localDay(date) {
  const local = new Date(date);
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, "0");
  const d = String(local.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Photographie l'état structurel du dépôt : inventaire de fichiers avec leur jour
// de dernière modification, liste des jeux de données déclarés, version d'ontologie.
export async function snapshot() {
  const manifest = await loadManifest();
  const datasetIds = manifest.graphs.flatMap(graph => (graph.datasets || []).map(dataset => dataset.id));
  const ontology = JSON.parse(await fs.readFile(path.join(dataDir, "graph-ontology.json"), "utf8"));

  const dataFiles = {};
  for (const file of await listFiles(dataDir)) {
    if (file.endsWith(".json")) dataFiles[file] = await fileMtimeDay(path.join(dataDir, file));
  }
  const testFiles = (await listFiles(testDir)).filter(file => file.endsWith(".test.js"));
  const docFiles = {};
  for (const file of await listFiles(projectDir)) {
    if (file.endsWith(".md")) docFiles[file] = await fileMtimeDay(path.join(projectDir, file));
  }

  return {
    capturedAt: new Date().toISOString(),
    datasetIds,
    schemaVersion: ontology.schemaVersion,
    dataFiles,
    testFiles,
    docFiles
  };
}

// Compte l'activité de session pour un jour donné : sessions distinctes et présence
// après 20 h locale. Lit tous les .jsonl et regroupe par fichier (une session).
export async function sessionActivity(day) {
  const files = (await listFiles(sessionsDir)).filter(file => file.endsWith(".jsonl"));
  let activeSessions = 0;
  let eveningWork = false;
  for (const file of files) {
    let sawDay = false;
    const raw = await fs.readFile(path.join(sessionsDir, file), "utf8").catch(() => "");
    for (const line of raw.split("\n")) {
      if (!line) continue;
      let stamp;
      try { stamp = JSON.parse(line).timestamp; } catch { continue; }
      if (!stamp) continue;
      const when = new Date(stamp);
      if (localDay(when) !== day) continue;
      sawDay = true;
      if (when.getHours() >= 20) eveningWork = true;
    }
    if (sawDay) activeSessions += 1;
  }
  return { activeSessions, eveningWork };
}

// Résout chaque question pour un jour, en comparant l'instantané scellé (avant) au
// courant (après) et en lisant l'activité de session. Rend {questionId: 0|1|null}.
// null = non observable (la question ne peut pas encore être tranchée honnêtement).
export async function observe(day, sealedSnapshot, currentSnapshot) {
  const activity = await sessionActivity(day);
  const before = sealedSnapshot || {};
  const after = currentSnapshot || (await snapshot());

  const touchedOn = (files, name) => (files?.[name] === day ? 1 : 0);
  const anyTouched = files => Object.values(files || {}).some(mtime => mtime === day) ? 1 : 0;
  const newInList = (beforeList, afterList) =>
    (afterList || []).some(item => !(beforeList || []).includes(item)) ? 1 : 0;

  return {
    session_any: activity.activeSessions >= 1 ? 1 : 0,
    session_multi: activity.activeSessions >= 2 ? 1 : 0,
    evening_work: activity.eveningWork ? 1 : 0,
    data_touched: anyTouched(after.dataFiles),
    new_district: newInList(before.datasetIds, after.datasetIds),
    ontology_bumped: before.schemaVersion && after.schemaVersion !== before.schemaVersion ? 1 : 0,
    new_test: newInList(before.testFiles, after.testFiles),
    project_work_touched: touchedOn(after.dataFiles, "project-work.json"),
    consultation_touched: touchedOn(after.dataFiles, "consultations.json"),
    doc_touched: anyTouched(after.docFiles)
  };
}
