import fs from "node:fs/promises";
import path from "node:path";
import {
  compileClusterQuestions, DEFAULT_CLUSTER_QUESTION_POLICY
} from "../src/cluster-question-compiler.js";
import {
  datasetLinks, datasetNodes, loadManifest, projectDir, readDatasets, selectGraph
} from "../src/graph-manifest.js";

const args = process.argv.slice(2);
const valueOf = (flag, fallback) => {
  const found = args.find(arg => arg.startsWith(`--${flag}=`));
  return found ? found.slice(flag.length + 3) : fallback;
};
const graphId = valueOf("graph", "design");
const clusterId = valueOf("cluster", "autonomous-improvement-endgame");
const cortexState = valueOf("cortex-state", "state-targeting-planning");
const maxQuestions = Number(valueOf("max-questions", "6"));
const totalEnergyBudget = Number(valueOf("energy-budget", "1"));
const outputPath = path.resolve(projectDir, valueOf("output", "artifacts/autonomy/question-agenda-smoke.json"));
const affectVector = Object.fromEntries(valueOf("affects", "frustration:0.7,curiosity:0.4,fearOfError:0.2")
  .split(",")
  .filter(Boolean)
  .map(entry => {
    const [affect, intensity] = entry.split(":");
    return [affect, Number(intensity)];
  }));

if (!Number.isInteger(maxQuestions) || maxQuestions < 0) throw new Error("--max-questions must be a non-negative integer");
if (!Number.isFinite(totalEnergyBudget) || totalEnergyBudget < 0) throw new Error("--energy-budget must be non-negative");

const manifest = await loadManifest();
const datasets = await readDatasets(selectGraph(manifest, graphId));
const nodes = datasets.flatMap(datasetNodes);
const links = datasets.flatMap(datasetLinks);
const questionAgenda = compileClusterQuestions({
  nodes,
  links,
  selectedClusterIds: clusterId ? [clusterId] : [],
  cortexState,
  affectVector,
  energyByCluster: clusterId ? { [clusterId]: totalEnergyBudget } : {},
  policy: {
    ...DEFAULT_CLUSTER_QUESTION_POLICY,
    maxQuestions,
    totalEnergyBudget
  }
});
const artifact = {
  generatedAt: new Date().toISOString(),
  graphId,
  corpus: { nodes: nodes.length, links: links.length },
  clusterId,
  cortexState,
  affectVector,
  questionCount: questionAgenda.length,
  allocatedEnergyBudget: Number(questionAgenda.reduce((sum, question) => sum + question.energyBudget, 0).toFixed(9)),
  questionAgenda
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: path.relative(projectDir, outputPath),
  corpus: artifact.corpus,
  questionCount: artifact.questionCount,
  allocatedEnergyBudget: artifact.allocatedEnergyBudget,
  gapTypes: questionAgenda.map(question => question.gapType)
}, null, 2));
