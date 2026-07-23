import test from "node:test";
import assert from "node:assert/strict";
import { describeCitizenStatus } from "../src/citizen-status-text.js";

const base = {
  citizenId: "citizen-a",
  name: "Ariane",
  executive: { cortexState: "state-targeting-planning", metacognitiveMode: "ENGAGE" },
  attention: { innerOuterFocus: -0.8 },
  energy: { availability: 0.82 },
  affect: { vector: { curiosity: 0.8, frustration: 0.4 } },
  awareness: { uncertainty: 0.2, controllability: 0.9, verifiedThreat: 0.1, calibratedConfidence: 0.8 },
  agency: { activeSubentityId: "repair", activeSubentityName: "Réparatrice", controllerConfidence: 0.85 },
  cognition: { openQuestionCount: 2, scenarioCount: 3 },
  integrity: { fragmentationPressure: 0.1, projectionStatus: "current" }
};

test("traduit les valeurs en un récit déterministe sans perdre les signaux principaux", () => {
  const result = describeCitizenStatus(base, "standard");
  assert.match(result.headline, /Ariane/);
  assert.match(result.summary, /fortement orientée vers ses objectifs/);
  assert.match(result.summary, /curiosité \(80 %\)/);
  assert.ok(result.sections.some(section => /Réparatrice/.test(section.text)));
  assert.deepEqual(result.alerts, []);
});

test("les seuils sont configurables et produisent des alertes explicites", () => {
  const result = describeCitizenStatus({
    ...base,
    energy: { availability: 0.35 },
    awareness: { ...base.awareness, verifiedThreat: 0.55 },
    integrity: { fragmentationPressure: 0.6, projectionStatus: "repair_required" }
  }, { preset: "detailed", thresholds: { low: 0.4, high: 0.5 } });
  assert.deepEqual(result.alerts.map(alert => alert.code), ["low_energy", "verified_threat", "fragmentation", "projection"]);
  assert.ok(result.sections.some(section => section.id === "integrity"));
});

test("le preset compact réduit le récit sans changer les faits", () => {
  const compact = describeCitizenStatus(base, "compact");
  const detailed = describeCitizenStatus(base, "detailed");
  assert.ok(compact.sections.length < detailed.sections.length);
  assert.doesNotMatch(compact.summary, /frustration/);
  assert.match(detailed.summary, /frustration/);
});

test("une mesure absente reste inconnue et n'est jamais traduite comme zéro", () => {
  const result = describeCitizenStatus({
    ...base,
    energy: { availability: null, citizenEnergy: 2.4 },
    agency: { activeSubentityId: "repair", controllerConfidence: null }
  });
  assert.match(result.summary, /2\.400 E/);
  assert.doesNotMatch(result.summary, /énergie disponible.+0 %/i);
  assert.doesNotMatch(result.sections.find(section => section.id === "agency").text, /confiance/);
});
