import fs from "node:fs/promises";
import path from "node:path";
import { createMetacognitiveState, runMetacognitiveStateTick } from "../src/l1-metacognitive-runtime.js";
import { formatMetacognitiveSummary, formatMetacognitiveTick, summarizeMetacognitiveRun } from "../src/l1-metacognitive-logging.js";

const args = new Map(process.argv.slice(2).map(argument => {
  const [key, ...value] = argument.split("=");
  return [key, value.join("=")];
}));
const inputPath = args.get("--input") || "simulation/l1-metacognition-endgame-scenarios.json";
const outputPath = args.get("--output") || "artifacts/l1/metacognition-endgame-demo.json";
const input = JSON.parse(await fs.readFile(inputPath, "utf8"));
let state = createMetacognitiveState();
let subentities = input.subentities || [];
const results = [];

for (const traversal of input.traversals || []) {
  const result = runMetacognitiveStateTick({ previousState: state, traversal, workspace: input.workspace || {}, subentities, config: input.config || {} });
  results.push(result);
  state = result.nextState;
  subentities = result.adaptedSubentities;
  console.log(formatMetacognitiveTick(result));
}

const summary = summarizeMetacognitiveRun(results);
console.log(formatMetacognitiveSummary(summary));
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify({ inputPath: path.resolve(inputPath), finalState: state, ticks: results, summary }, null, 2)}\n`, "utf8");
console.log(`Rapport JSON: ${path.resolve(outputPath)}`);
