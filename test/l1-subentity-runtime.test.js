import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  EMPTY_SUBENTITY_RUNTIME_STATE,
  applySubentityLifecycleTick,
  readSubentityRuntimeState,
  runSubentityLifecycleTick
} from "../src/l1-subentity-runtime.js";

const strongCandidate = id => ({
  id, level: "low", status: "candidate", weight: 30, stability: 1, certainty: 1, coherence: 1,
  signature: { create: 1 }, goals: [{ key: "create", score: 1 }], strategies: [{ key: "prototype", score: 0.9 }],
  preferences: [{ key: "novelty", score: 0.9, evidenceMomentIds: ["moment-1"] }], beliefs: [],
  evidenceMomentIds: Array.from({ length: 20 }, (_, index) => `evidence-${index}`)
});

const tick = {
  tickId: "tick-1",
  recordedAt: "2026-07-23T12:00:00.000Z",
  candidates: [strongCandidate("creator")],
  workspaceSnapshot: { id: "workspace-1", controllers: [{ subentityId: "creator", confidence: 0.82, active: true }] },
  memory: { id: "moment-1", occurredAt: "2026-07-23T11:59:59.000Z", content: "A prototype was chosen." }
};

test("one lifecycle transaction promotes, narrates and attributes its Moment", () => {
  const result = runSubentityLifecycleTick(EMPTY_SUBENTITY_RUNTIME_STATE, tick);
  assert.equal(result.report.status, "applied");
  assert.equal(result.state.revision, 1);
  assert.equal(result.state.subentities.find(entity => entity.id === "creator").level, "high");
  assert.ok(result.state.narratives.length >= 2);
  assert.ok(result.state.relations.some(edge => edge.type === "CONTROLLED_WORKSPACE_DURING" && edge.target === "moment-1"));
  assert.ok(result.state.relations.some(edge => edge.type === "SUPPORTS"));
});

test("une coalition meneuse fusionnée dans le tick ne persiste pas un contrôleur fantôme", () => {
  // alpha et beta portent la même signature : elles fusionnent. alpha domine (poids,
  // certitude), donc beta est absorbée. Le snapshot, arbitré avant la fusion, fait
  // pourtant mener beta — l'entité qui va disparaître.
  const alpha = { ...strongCandidate("alpha"), signature: { care: 1 }, goals: [{ key: "care", score: 1 }] };
  const beta = { ...strongCandidate("beta"), weight: 4, certainty: 0.4, stability: 0.4, signature: { care: 1 }, goals: [{ key: "care", score: 1 }] };
  const gamma = { ...strongCandidate("gamma"), signature: { explore: 1 }, goals: [{ key: "explore", score: 1 }] };
  const mergeTick = {
    tickId: "merge-tick",
    recordedAt: "2026-07-23T12:30:00.000Z",
    candidates: [alpha, beta, gamma],
    workspaceSnapshot: {
      id: "workspace-merge", semanticType: "WorkspaceSnapshot", version: 3,
      characterBudget: 2000, characterUsed: 2000,
      controllerId: "beta", controllerStatus: "attributed_live",
      activeEntity: { id: "beta", semanticType: "subentity", confidence: 0.6 },
      controllers: [{ subentityId: "beta", confidence: 0.6, active: true, rank: 1 }, { subentityId: "alpha", confidence: 0.55, active: true, rank: 2 }],
      slots: [
        { rank: 1, role: "lead", controllerId: "beta", characterAllocation: 900, score: 0.5, positiveScore: 0.5, penalty: 0 },
        { rank: 2, role: "support", controllerId: "alpha", characterAllocation: 600, score: 0.45, positiveScore: 0.45, penalty: 0 },
        { rank: 3, role: "support", controllerId: "gamma", characterAllocation: 500, score: 0.3, positiveScore: 0.3, penalty: 0 }
      ],
      bids: [
        { candidateId: "workspace-candidate-beta", controllerId: "beta", rank: 1, score: 0.5 },
        { candidateId: "workspace-candidate-alpha", controllerId: "alpha", rank: 2, score: 0.45 },
        { candidateId: "workspace-candidate-gamma", controllerId: "gamma", rank: 3, score: 0.3 }
      ],
      audit: { empty: false, controllerUnknown: false }
    },
    memory: { id: "moment-merge", occurredAt: "2026-07-23T12:29:59.000Z", content: "Two coalitions became one." }
  };
  const result = runSubentityLifecycleTick(EMPTY_SUBENTITY_RUNTIME_STATE, mergeTick);

  const persisted = result.state.workspaceSnapshots.find(snapshot => snapshot.id === "workspace-merge");
  const activeIds = new Set(result.state.subentities.filter(entity => entity.status !== "merged").map(entity => entity.id));
  assert.ok(!activeIds.has("beta"), "beta a bien été absorbée");
  // Le contrôleur persisté existe encore et porte une carte.
  assert.equal(persisted.controllerId, "alpha");
  assert.ok(activeIds.has(persisted.controllerId));
  assert.ok(!persisted.slots.some(slot => slot.controllerId === "beta"), "aucun créneau ne pointe vers la coalition morte");
  // alpha, désormais unique, tient la somme des parts des deux créneaux repliés.
  assert.equal(persisted.slots.find(slot => slot.controllerId === "alpha").characterAllocation, 1500);
  // L'attribution mémoire encode le Moment sous le survivant, pas sous le fantôme.
  const encodedUnder = result.state.relations.filter(edge => edge.type === "ENCODED_UNDER");
  assert.ok(encodedUnder.length > 0);
  assert.ok(encodedUnder.every(edge => edge.target !== "beta"));
});

test("replaying a stable tick id is idempotent", () => {
  const first = runSubentityLifecycleTick(EMPTY_SUBENTITY_RUNTIME_STATE, tick);
  const replay = runSubentityLifecycleTick(first.state, tick);
  assert.equal(replay.report.status, "already_processed");
  assert.equal(replay.state.revision, 1);
  assert.equal(replay.state.moments.length, 1);
  assert.deepEqual(replay.state, first.state);
});

test("a different tick cannot silently overwrite an existing Moment", () => {
  const first = runSubentityLifecycleTick(EMPTY_SUBENTITY_RUNTIME_STATE, tick);
  assert.throws(() => runSubentityLifecycleTick(first.state, { ...tick, tickId: "tick-2" }), /already exists/);
});

test("atomic file adapter persists complete state and dry-run leaves it untouched", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "l1-subentity-runtime-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, "state.json");
  const applied = await applySubentityLifecycleTick({ statePath, input: tick });
  assert.equal(applied.persisted, true);
  const stored = await readSubentityRuntimeState(statePath);
  assert.equal(stored.revision, 1);

  const dryInput = { tickId: "tick-dry", recordedAt: "2026-07-23T13:00:00.000Z", candidates: [] };
  const dry = await applySubentityLifecycleTick({ statePath, input: dryInput, dryRun: true });
  assert.equal(dry.state.revision, 2);
  assert.equal((await readSubentityRuntimeState(statePath)).revision, 1);
});
