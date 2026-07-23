import { readFile } from "node:fs/promises";
import { analyzeGraph } from "../public/graph-analysis.js";
import { eligibleAutonomousTasks } from "./work-queue.js";
import { codeDecisionSummary } from "./code-decisions.js";

const idOf = value => typeof value === "object" ? value.id : value;

const compactTask = task => ({
  id: task.id,
  priority: task.priority,
  title: task.name,
  workStatus: task.workStatus,
  autonomyMode: task.autonomyMode,
  summary: task.summary,
  verificationCommand: task.verificationCommand
});

function dependencyIds(taskId, links) {
  return links
    .filter(link => link.type === "DEPENDS_ON" && idOf(link.source) === taskId)
    .map(link => idOf(link.target));
}

export function summarizeWorkQueue(nodes, links) {
  const tasks = nodes.filter(node => node.nodeType === "task");
  const taskById = new Map(tasks.map(task => [task.id, task]));

  const proposed = tasks
    .filter(task => task.workStatus === "proposed")
    .sort((a, b) => Number(b.priority) - Number(a.priority) || a.id.localeCompare(b.id, "fr"))
    .map(compactTask);

  const blocked = tasks
    .filter(task => task.workStatus === "blocked")
    .sort((a, b) => Number(b.priority) - Number(a.priority) || a.id.localeCompare(b.id, "fr"))
    .map(task => ({
      ...compactTask(task),
      dependencies: dependencyIds(task.id, links).map(id => ({
        id,
        workStatus: taskById.get(id)?.workStatus || "missing"
      }))
    }));

  const inProgress = tasks
    .filter(task => task.workStatus === "in_progress")
    .sort((a, b) => Number(b.priority) - Number(a.priority) || a.id.localeCompare(b.id, "fr"))
    .map(compactTask);

  return {
    readyAutonomous: eligibleAutonomousTasks(nodes, links).map(compactTask),
    blocked,
    proposed,
    inProgress
  };
}

export function summarizeFullAnalysis(report) {
  return {
    mode: "api",
    complete: true,
    methodVersion: report.methodVersion,
    graph: report.graph,
    causalSaturation: report.causalSaturation,
    findings: report.findings.length,
    categoryCounts: report.categoryCounts,
    top: report.findings.slice(0, 10).map(item => ({
      priority: item.priority,
      category: item.category,
      title: item.title
    }))
  };
}

export async function loadProjectWork(projectWorkUrl = new URL("../data/project-work.json", import.meta.url)) {
  return JSON.parse(await readFile(projectWorkUrl, "utf8"));
}

export function summarizeFallbackAnalysis(error, projectWork) {
  return {
    mode: "fallback",
    complete: false,
    reason: error.message,
    warning: "Fallback incomplet: lecture statique de data/project-work.json seulement, sans findings causaux complets.",
    graph: {
      source: "data/project-work.json",
      nodes: projectWork.nodes.length,
      links: projectWork.links.length
    },
    work: summarizeWorkQueue(projectWork.nodes, projectWork.links),
    findings: 0,
    categoryCounts: {},
    top: []
  };
}

/**
 * Garde-fou lisible dans `analyze` : combien d'arbitrages de code sont clos et
 * quels paramètres ils couvrent. Le détail (options écartées, motifs) reste dans
 * `npm run code:decisions` ; ici on ne fait qu'attirer l'œil vers lui. Une
 * lecture qui échoue ne doit jamais faire tomber l'analyse.
 */
export async function codeGuardrailsSummary() {
  try {
    const summary = await codeDecisionSummary();
    return { ...summary, detail: "npm run code:decisions" };
  } catch (error) {
    return { error: error.message, detail: "npm run code:decisions" };
  }
}

export async function runAnalysis({
  graphApiUrl = "http://localhost:4173/api/graph",
  projectWorkUrl = new URL("../data/project-work.json", import.meta.url),
  fetchImpl = fetch
} = {}) {
  const codeGuardrails = await codeGuardrailsSummary();
  try {
    const response = await fetchImpl(graphApiUrl);
    if (!response.ok) throw new Error(`Graph API returned ${response.status}`);
    const graph = await response.json();
    return { ...summarizeFullAnalysis(analyzeGraph(graph.nodes, graph.links)), codeGuardrails };
  } catch (error) {
    const projectWork = await loadProjectWork(projectWorkUrl);
    return { ...summarizeFallbackAnalysis(error, projectWork), codeGuardrails };
  }
}
