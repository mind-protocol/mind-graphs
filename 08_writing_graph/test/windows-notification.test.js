import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWakeNotification, compactNotificationText, showWindowsNotification
} from "../src/windows-notification.js";

test("a completed wake notification contains the final Codex result", () => {
  const notification = buildWakeNotification({
    codex: "completed",
    codexResult: "Tests réussis et tâche terminée.",
    queue: { total: 3, eligibleCount: 1, nextTask: { id: "task", name: "Réparer" } },
    workspace: { version: 4 }
  });
  assert.match(notification.title, /tâche terminée/);
  assert.equal(notification.body, "Tests réussis et tâche terminée.");
});

test("an idle wake reports queue state without claiming work", () => {
  const notification = buildWakeNotification({
    codex: "skipped",
    queue: { total: 51, eligibleCount: 0, nextTask: null },
    workspace: { version: 2 }
  });
  assert.match(notification.body, /Aucune tâche autonome/);
  assert.match(notification.body, /0\/51/);
});

test("notification text is single-line and bounded", () => {
  const text = compactNotificationText(`ligne 1\n${"x".repeat(500)}`, 40);
  assert.equal(text.includes("\n"), false);
  assert.equal(text.length, 40);
  assert.ok(text.endsWith("…"));
});

test("notification is a no-op outside Windows", async () => {
  assert.deepEqual(await showWindowsNotification({ title: "T", body: "B", platform: "linux" }), {
    shown: false,
    reason: "not_windows"
  });
});
