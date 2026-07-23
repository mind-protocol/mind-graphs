import { readFile } from "node:fs/promises";
import { nextAutonomousTask } from "../src/work-queue.js";

const work = JSON.parse(await readFile(new URL("../data/project-work.json", import.meta.url), "utf8"));
const task = nextAutonomousTask(work.nodes, work.links);

if (!task) {
  console.log(JSON.stringify({ ready: false, reason: "Aucune tâche ready + autonomous dont les dépendances sont terminées." }, null, 2));
  process.exitCode = 2;
} else {
  console.log(JSON.stringify({
    ready: true,
    task: {
      id: task.id,
      priority: task.priority,
      title: task.name,
      summary: task.summary,
      acceptanceCriteria: task.acceptanceCriteria,
      verificationCommand: task.verificationCommand
    }
  }, null, 2));
}
