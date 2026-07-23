import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSensoryTickLog, formatSensoryTickLog, summarizeSensoryRun, formatSensoryRunSummary
} from "../src/l1-sensory-logging.js";

const index = {
  nameOf: new Map([["goal", "Question active"]]),
  clusterOf: new Map([["goal", "cluster-goals"]])
};

const report = {
  totalBudget: 1,
  sensoryAllocated: 0.6,
  localBudget: 0.4,
  attention: {
    sensoryShare: 0.6,
    sensoryBudget: 0.6,
    scores: { external: 0.9, internal: 0.6 },
    external: { intensity: 0.8, novelty: 1 },
    workspace: { entityId: "explorer", orientation: "external", focusIntensity: 0.7 }
  },
  sensory: {
    tickId: "tick-1",
    selectedConnections: [{
      graphId: "design", source: "C", target: "q",
      sourceNode: { name: "Citizen" }, targetNode: { name: "Question" },
      weight: 0.9, selectedBecause: { strong: true, recent: false }, link: { type: "PURSUES" }
    }],
    transfers: [{ targetNodeId: "goal", energy: 0.6, similarity: 0.91, sourceGraphId: "design" }]
  }
};

const physicsBefore = { totalEnergy: 0, liveLinks: 0, links: 2, activeFlows: 0, byCluster: [] };
const physicsAfter = { totalEnergy: 0.51, liveLinks: 2, links: 2, activeFlows: 2, byCluster: [{ cluster: "cluster-goals", energy: 0.4 }] };

test("the sensory tick log explains perception, arbitration, routing and conservation", () => {
  const log = buildSensoryTickLog(report, index, { physicsBefore, physicsAfter });
  assert.equal(log.perception.selectedConnections, 1);
  assert.equal(log.routing.topTargets[0].name, "Question active");
  assert.equal(log.conservation.conserved, true);
  const text = formatSensoryTickLog(log);
  for (const section of ["WORKSPACE", "PERCEPTION", "ARBITRAGE", "POURQUOI", "ROUTAGE", "GRAPHE", "CONSERVATION"]) {
    assert.match(text, new RegExp(section));
  }
});

test("the run summary aggregates attention, energy, sources and hot targets", () => {
  const first = buildSensoryTickLog(report, index, { physicsBefore, physicsAfter });
  const secondReport = structuredClone(report);
  secondReport.sensory.tickId = "tick-2";
  secondReport.attention.sensoryShare = 0.4;
  secondReport.attention.external.novelty = 0.3;
  secondReport.sensoryAllocated = 0.4;
  secondReport.localBudget = 0.6;
  secondReport.sensory.transfers[0].energy = 0.4;
  const second = buildSensoryTickLog(secondReport, index, { physicsBefore: physicsAfter, physicsAfter });
  const stats = summarizeSensoryRun([first, second]);
  assert.equal(stats.ticks, 2);
  assert.equal(stats.energy.totalCitizenBudget, 2);
  assert.equal(stats.energy.sensoryAllocated, 1);
  assert.equal(stats.attention.meanSensoryShare, 0.5);
  assert.equal(stats.attention.initialNovelty, 1);
  assert.equal(stats.attention.finalNovelty, 0.3);
  assert.equal(stats.sources[0].graphId, "design");
  assert.match(formatSensoryRunSummary(stats), /RÉCAPITULATIF SENSORIEL/u);
});
