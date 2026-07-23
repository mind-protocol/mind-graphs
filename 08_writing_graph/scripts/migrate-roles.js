// Migration L4 « rôle primaire + type en facette ».
//
// Décision (utilisateur, 2026-07-23) : le rôle physique L4 devient un axe écrit
// nativement sur chaque nœud ; le type épistémique des 30 est conservé comme
// facette. Rien n'est supprimé. La forme littérale à 5 types était écartée parce
// qu'elle écrasait 18 types et 7 statuts épistémiques dans le seul rôle narrative.
//
// Ce script ne décide jamais un rôle sous override : il n'écrit que les rôles
// sans ambiguïté et laisse les autres à l'arbitrage, conformément au principe
// « un override n'est jamais appliqué en silence ». Par défaut il ne touche
// aucune donnée : il produit un rapport de partage. --apply écrit les seuls
// rôles non ambigus, fichier par fichier, avec un compare-and-swap qui refuse
// d'écraser une modification concurrente (risk-concurrent-dataset-write).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { projectGraph } from "../src/l4-projection.js";
import { projectDir, loadManifest, activeGraphs, readDatasets } from "../src/graph-manifest.js";

const apply = process.argv.includes("--apply");
const graphId = process.argv.find(a => a.startsWith("--graph="))?.split("=")[1] || "design";
const reportPath = path.resolve(projectDir, "artifacts/proposals/role-migration.json");

const projection = await projectGraph(graphId);
const roleById = new Map(projection.nodes.map(n => [n.id, { role: n.role, needsArbitration: Boolean(n.needsArbitration), overrideRule: n.overrideRule ?? null }]));

const manifest = await loadManifest();
const graphConfig = activeGraphs(manifest).find(g => g.id === graphId);
if (!graphConfig) throw new Error(`graphe ${graphId} introuvable ou inactif`);

const perFile = [];
const arbitration = [];
const roleCounts = {};
let total = 0, writable = 0, alreadySet = 0, conflicting = 0;

for (const entry of await readDatasets(graphConfig)) {
  const file = path.join(graphConfig.dataDir, entry.filename);
  const nodes = entry.data.nodes || [];
  let fileWritable = 0, fileArbitration = 0, fileAlready = 0;

  for (const node of nodes) {
    total += 1;
    const resolved = roleById.get(node.id);
    if (!resolved) continue;
    roleCounts[resolved.role] = (roleCounts[resolved.role] || 0) + 1;

    if (node.role !== undefined) {
      alreadySet += 1; fileAlready += 1;
      if (node.role !== resolved.role && !resolved.needsArbitration) conflicting += 1;
      continue;
    }
    if (resolved.needsArbitration) {
      fileArbitration += 1;
      arbitration.push({ id: node.id, nodeType: node.nodeType, defaultRole: resolved.role, overrideRule: resolved.overrideRule });
    } else {
      writable += 1; fileWritable += 1;
    }
  }
  perFile.push({ file: entry.filename, nodes: nodes.length, writable: fileWritable, arbitration: fileArbitration, alreadySet: fileAlready });
}

const report = {
  generatedFor: graphId,
  mode: apply ? "apply" : "dry-run",
  mappingVersion: projection.mappingVersion,
  principle: "role primaire écrit nativement, nodeType conservé en facette ; aucun override appliqué en silence.",
  totals: { total, writable, needsArbitration: arbitration.length, alreadySet, conflicting },
  roleCounts,
  arbitrationSample: arbitration.slice(0, 12),
  perFile: perFile.filter(f => f.writable || f.arbitration || f.alreadySet)
};

await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (apply) {
  let written = 0, refused = 0, markedPending = 0;
  for (const entry of await readDatasets(graphConfig)) {
    const target = path.join(projectDir, graphConfig.dataDir, entry.filename);
    // compare-and-swap : l'état relu doit être identique à celui lu pour le plan.
    const beforeHash = createHash("sha256").update(JSON.stringify(entry.data)).digest("hex");
    const current = JSON.parse(await readFile(target, "utf8"));
    const currentHash = createHash("sha256").update(JSON.stringify(current)).digest("hex");
    if (currentHash !== beforeHash) { refused += 1; console.error(`REFUS ${entry.filename} : modifié depuis la lecture`); continue; }

    let touched = false;
    for (const node of current.nodes || []) {
      const resolved = roleById.get(node.id);
      if (!resolved || node.role !== undefined) continue;
      // Le rôle par défaut est écrit sur tous les nœuds. Un nœud à override reçoit
      // le défaut ET une marque de revue : le défaut n'est jamais présenté comme
      // un choix confirmé quand une règle d'exception d'instance existe.
      node.role = resolved.role;
      if (resolved.needsArbitration) { node.roleArbitration = "default-pending-review"; markedPending += 1; }
      touched = true; written += 1;
    }
    if (touched) await writeFile(target, `${JSON.stringify(current, null, 2)}\n`, "utf8");
  }

  // Une tâche de revue par population d'override, pour retrouver les rares
  // exceptions d'instance. proposed + review_required : la migration écrit des
  // candidats de travail, jamais une file autonome.
  const workFile = path.join(projectDir, graphConfig.dataDir, "project-work.json");
  const work = JSON.parse(await readFile(workFile, "utf8"));
  const existingIds = new Set(work.nodes.map(n => n.id));
  const byType = {};
  for (const a of arbitration) (byType[a.nodeType] = byType[a.nodeType] || []).push(a);
  const OVERRIDE_ROLE = { mechanism: "thing/moment", metric: "thing", method: "thing/moment", system_state: "moment", change: "thing", economic_mechanism: "thing/moment", institution: "actor/space", unlock: "thing", protocol: "moment", observation: "thing", experiment: "narrative" };
  let tasksAdded = 0;
  for (const [type, items] of Object.entries(byType)) {
    const id = `task-role-review-${type.replace(/_/g, "-")}`;
    if (existingIds.has(id)) continue;
    work.nodes.push({
      id,
      name: `Tâche · Confirmer le rôle des ${items.length} nœuds ${type}`,
      nodeType: "task",
      phrase: `Le rôle par défaut a été écrit sur ${items.length} nœuds ${type} ; une règle d'override peut en faire des ${OVERRIDE_ROLE[type] || "autre rôle"}.`,
      family: "Migration L4 · revue des rôles",
      summary: `Les ${items.length} nœuds de type ${type} ont reçu leur rôle par défaut et sont marqués roleArbitration=default-pending-review. Cette tâche relit chacun pour confirmer le défaut ou appliquer l'override d'instance, puis passe roleArbitration à confirmed. Aucune facette épistémique n'est modifiée : seul l'axe physique du rôle est en jeu, et une correction ne perd rien.`,
      workStatus: "proposed",
      priority: 40,
      autonomyMode: "review_required",
      acceptanceCriteria: [
        `Chaque nœud ${type} porte roleArbitration=confirmed après relecture.`,
        "Le rôle final est soit le défaut confirmé, soit l'override d'instance justifié.",
        "La facette nodeType reste inchangée.",
        "npm run validate réussit."
      ],
      verificationCommand: "npm run validate",
      updatedAt: report.generatedAt || "2026-07-23",
      clusterId: "project-work"
    });
    existingIds.add(id);
    tasksAdded += 1;
  }
  if (tasksAdded) await writeFile(workFile, `${JSON.stringify(work, null, 2)}\n`, "utf8");

  report.written = written;
  report.refused = refused;
  report.markedPending = markedPending;
  report.reviewTasksAdded = tasksAdded;
}

console.log(JSON.stringify({ mode: report.mode, ...report.totals, roleCounts, written: report.written, refused: report.refused, report: "artifacts/proposals/role-migration.json" }, null, 2));
