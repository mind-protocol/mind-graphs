import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildCanonical, runIngestion } from "../scripts/science-ingest.js";
import { evaluateIngestionQuality } from "../src/science-ingestion-quality.js";
import { loadScienceCandidate } from "../src/science-candidate.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ontology = JSON.parse(await readFile(new URL("../science/ontology.json", import.meta.url), "utf8"));
const governance = JSON.parse(await readFile(new URL("../governance/evidence-firewall.json", import.meta.url), "utf8"));
const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("l'ontologie scientifique exprime les cinq primitives CSG", () => {
  const types = new Set(ontology.nodeTypes.map(type => type.id));
  for (const primitive of ["variable", "mechanism", "context", "intervention", "observation"]) {
    assert.ok(types.has(primitive), `primitive absente: ${primitive}`);
  }
});

test("la chaîne Study -> Estimate -> Claim -> Evidence est contrainte", () => {
  assert.deepEqual(ontology.relationConstraints.REPORTS_ESTIMATE, { sourceTypes: ["study"], targetTypes: ["estimate"] });
  assert.deepEqual(ontology.relationConstraints.SUPPORTS_CLAIM, { sourceTypes: ["estimate"], targetTypes: ["claim"] });
  assert.deepEqual(ontology.relationConstraints.JUSTIFIED_BY, { sourceTypes: ["claim"], targetTypes: ["evidence"] });
});

test("le socle partagé conserve une certitude continue sans palier de promotion", () => {
  assert.equal(ontology.governanceRef, "governance/evidence-firewall.json");
  assert.equal(governance.certaintyModel.kind, "continuous_from_justifications");
  assert.equal(governance.actionThresholds.location, "outside_science_graph");
  assert.equal(governance.evidenceLadder, undefined);
});

test("l'ingestion Satopää vérifie le hash et construit le cluster canonique", async () => {
  const { data } = await buildCanonical("science/staging/satopaa-2014-information-diversity.json");
  assert.equal(data.nodes.length, 69);
  assert.equal(data.links.length, 103);
  assert.equal(data.ingestion.completedStages.at(-1), "commit");
  assert.equal(data.ingestion.canonicalStatus, "complete");
  assert.equal(data.ingestion.quality.ready, true);
  assert.deepEqual(data.ingestion.quality.failedFloors, []);
  assert.ok(data.nodes.some(node => node.nodeType === "claim"));
  assert.ok(data.nodes.filter(node => node.nodeType === "evidence").every(node => node.sourceLocator));
});

test("une ingestion sous les planchers ne peut pas se déclarer complete", async () => {
  const candidate = JSON.parse(await readFile(new URL("../science/staging/satopaa-2014-information-diversity.json", import.meta.url), "utf8"));
  candidate.ingestion.fragments = [];
  candidate.ingestion.canonicalStatus = "complete";
  const temporary = new URL("../science/staging/.invalid-complete-ingestion.json", import.meta.url);
  const { writeFile, unlink } = await import("node:fs/promises");
  try {
    await writeFile(temporary, JSON.stringify(candidate), "utf8");
    await assert.rejects(() => buildCanonical("science/staging/.invalid-complete-ingestion.json"), /forbidden/);
  } finally {
    await unlink(temporary).catch(() => {});
  }
});

test("le dataset canonique est exactement la sortie de la staging validée", async () => {
  const result = await runIngestion({ candidatePath: "science/staging/satopaa-2014-information-diversity.json", check: true });
  assert.equal(result.mode, "check");
});

test("le score de readiness reste transparent et distinct de la certitude scientifique", async () => {
  const candidate = await loadScienceCandidate(projectDir, "science/staging/satopaa-2014-information-diversity.json");
  const report = await evaluateIngestionQuality(candidate, projectDir);
  assert.ok(Math.abs(Object.values(report.weights).reduce((sum, weight) => sum + weight, 0) - 1) < 1e-12);
  assert.equal(report.raw.sourceTextCharacters, 59891);
  assert.ok(report.raw.representationRatio >= report.raw.targetRepresentationRatio);
  assert.equal(report.raw.conceptsExpected, 12);
  assert.equal(report.raw.conceptsMatched, 12);
  assert.equal(report.scores.structuralCoverage, 1);
  assert.equal(report.scores.provenanceCoverage, 1);
  assert.equal(report.ready, true);
  assert.match(report.interpretation, /ne mesure ni la validité/);
});
