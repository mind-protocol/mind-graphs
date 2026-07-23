import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const projectWorkPath = new URL("../data/project-work.json", import.meta.url);

test("the conversation ingestion chain stays at maximum priority through anamnesis complete", async () => {
  const graph = JSON.parse(await readFile(projectWorkPath, "utf8"));
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const chainTaskIds = [
    "task-conversation-export-request",
    "task-conversation-download-acquire",
    "task-conversation-anamnesis-prepare",
    "task-conversation-chunk-ingest",
    "task-conversation-anamnesis-complete"
  ];

  for (const taskId of chainTaskIds) {
    assert.equal(byId.get(taskId)?.priority, 100, `${taskId} must remain at maximum priority`);
  }
  assert.equal(byId.get("task-conversation-ingest-blocker-notify")?.workStatus, "done");
});

