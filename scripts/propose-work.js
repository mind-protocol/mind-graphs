// npm run work:propose            → liste les tâches candidates sans rien écrire
// npm run work:propose -- --apply → écrit les candidats dans data/project-work.json
//
// Une réparation produit des candidats, jamais une mutation implicite : tout ce qui est écrit ici
// reste `proposed` + `review_required`. Les ébauches de nœuds de graphe
// (états, métriques) sont déposées dans artifacts/proposals/ avec des marqueurs TODO, parce qu'un
// état observable encode un choix de projet qu'aucun algorithme ne doit trancher.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { analyzeGraph } from "../public/graph-analysis.js";
import { loadCorpus } from "../src/corpus.js";
import { buildGapProposals, buildObservableScaffold } from "../src/gap-proposals.js";

const workPath = new URL("../data/project-work.json", import.meta.url);
const scaffoldPath = new URL("../artifacts/proposals/observable-scaffold.json", import.meta.url);

const apply = process.argv.includes("--apply");
const graphId = process.argv.find(argument => argument.startsWith("--graph="))?.split("=")[1] || "design";
const today = (process.argv.find(argument => argument.startsWith("--date="))?.split("=")[1])
  || new Date().toISOString().slice(0, 10);

const { nodes, links } = await loadCorpus(graphId);
const report = analyzeGraph(nodes, links);
const work = JSON.parse(await readFile(workPath, "utf8"));

const proposals = buildGapProposals(report, work, { today, knownNodeIds: nodes.map(node => node.id) });
const scaffold = buildObservableScaffold(report, { today });

const summary = {
  mode: apply ? "apply" : "dry-run",
  methodVersion: report.methodVersion,
  causalSaturation: `${report.causalSaturation.satisfied}/${report.causalSaturation.mechanisms}`,
  observability: {
    statesMeasured: `${report.observability.measuredStates}/${report.observability.states}`,
    metricsAnchored: `${report.observability.anchoredMetrics}/${report.observability.metrics}`,
    blindClusters: report.observability.blindClusters
  },
  groups: proposals.groups,
  proposedNodes: proposals.nodes.map(node => ({ id: node.id, nodeType: node.nodeType, priority: node.priority, name: node.name })),
  proposedLinks: proposals.links.length,
  skipped: proposals.skipped,
  scaffold: { path: "artifacts/proposals/observable-scaffold.json", nodes: scaffold.nodes.length, links: scaffold.links.length }
};

await mkdir(new URL("./", scaffoldPath), { recursive: true });
await writeFile(scaffoldPath, `${JSON.stringify(scaffold, null, 2)}\n`, "utf8");

if (apply && proposals.nodes.length) {
  work.nodes.push(...proposals.nodes);
  work.links.push(...proposals.links);
  await writeFile(workPath, `${JSON.stringify(work, null, 2)}\n`, "utf8");
  summary.written = { file: "data/project-work.json", nodes: proposals.nodes.length, links: proposals.links.length };
} else if (apply) {
  summary.written = { file: "data/project-work.json", nodes: 0, links: 0, reason: "aucun candidat nouveau" };
} else {
  summary.hint = "Relancer avec --apply pour écrire ces candidats dans data/project-work.json.";
}

console.log(JSON.stringify(summary, null, 2));
