import { runAnalysis } from "../src/analysis-runner.js";

console.log(JSON.stringify(await runAnalysis(), null, 2));
