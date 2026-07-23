import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acquireLock } from "../src/runtime-manager.js";

test("process lock rejects a second live owner", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mind-process-lock-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const lockPath = path.join(directory, "runtime.lock");

  await acquireLock(lockPath, { label: "test service" });

  await assert.rejects(
    acquireLock(lockPath, { label: "test service" }),
    new RegExp(`test service already running as pid ${process.pid}`)
  );
});

test("process lock atomically replaces a dead owner", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mind-process-lock-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const lockPath = path.join(directory, "runtime.lock");
  await fs.writeFile(lockPath, JSON.stringify({
    pid: 2_147_483_647,
    createdAt: "2026-01-01T00:00:00.000Z"
  }));

  await acquireLock(lockPath, { label: "test service" });

  const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  assert.equal(lock.pid, process.pid);
});
