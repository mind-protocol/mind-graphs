import test from "node:test";
import assert from "node:assert/strict";
import { composeCitizenStatuses } from "../src/l1-citizen-status.js";

test("compose une collection multi-citoyen depuis les workspaces et la physique", () => {
  const result = composeCitizenStatuses({
    generatedAt: "2026-07-23T10:00:00.000Z",
    globalWorkspaceState: {
      citizens: {
        "citizen-a": {
          actorId: "citizen-a",
          graphId: "design",
          cortexState: "state-execution",
          innerOuterFocus: -0.5,
          questionAgenda: [{ id: "q1", energyBudget: 1 }],
          questionBudget: 1
        }
      }
    },
    physicsState: {
      graphId: "design",
      workspaces: { "citizen-b": { cortexState: "state-monitoring", innerOuterFocus: 0.4 } },
      summary: {
        tick: 8,
        totalEnergy: 4,
        byCitizen: [{ citizenId: "citizen-a", energy: 2.5 }, { citizenId: "citizen-b", energy: 1.5 }]
      }
    },
    runtimeState: {
      revision: 2,
      subentities: [{ id: "agent", name: "Agent", status: "active", weight: 2, goals: [], strategies: [] }],
      narratives: [], moments: [], relations: [], events: [],
      metacognitive: { mode: "ENGAGE", awareness: { energyAvailability: 0.8 }, scenarios: [] }
    },
    primaryCitizenId: "citizen-a"
  });

  assert.deepEqual(result.citizens.map(citizen => citizen.citizenId), ["citizen-a", "citizen-b"]);
  assert.equal(result.citizens[0].energy.citizenEnergy, 2.5);
  assert.equal(result.citizens[0].agency.activeSubentityId, "agent");
  assert.equal(result.citizens[1].agency.activeSubentityId, null, "l'état local ne doit pas être attribué à tous les citoyens");
});

test("préserve null pour une mesure absente au lieu de fabriquer zéro", () => {
  const { citizens: [citizen] } = composeCitizenStatuses({
    generatedAt: "2026-07-23T10:00:00.000Z",
    fallbackCitizenId: "citizen-empty"
  });
  assert.equal(citizen.attention.innerOuterFocus, null);
  assert.equal(citizen.energy.citizenEnergy, null);
  assert.equal(citizen.awareness.calibratedConfidence, undefined);
  assert.match(citizen.text.summary, /citizen-empty/);
});

