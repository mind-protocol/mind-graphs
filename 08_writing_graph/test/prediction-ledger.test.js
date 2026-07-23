import test from "node:test";
import assert from "node:assert/strict";
import {
  sealPrediction, verifySeal, brier, logLoss, skillVsBaseline, scoreItems, QUESTION_IDS
} from "../src/prediction-ledger.js";

// Le sceau est le préenregistrement : réécrire une prédiction après coup doit être
// détectable, sinon le journal ne prouve plus rien (mech-prediction-ledger).
test("the seal detects any change to a sealed prediction", () => {
  const entry = {
    targetDate: "2026-07-24",
    sealedAt: "2026-07-23T20:00:00.000Z",
    engine: "engine-v0",
    predictions: { session_any: { prob: 0.8 } }
  };
  const sealed = { ...entry, seal: sealPrediction(entry) };
  assert.equal(verifySeal(sealed), true);
  const tampered = { ...sealed, predictions: { session_any: { prob: 0.99 } } };
  assert.equal(verifySeal(tampered), false);
});

// Une règle propre récompense la confiance justifiée et punit plus fort la confiance
// erronée : c'est ce qui interdit de gonfler un score en pariant sur le presque sûr.
test("proper scoring punishes confident errors harder than it rewards confident hits", () => {
  assert.ok(brier(0.9, 1) < brier(0.5, 1));
  assert.ok(brier(0.9, 0) > brier(0.5, 0));
  assert.ok(logLoss(0.9, 0) > logLoss(0.5, 0));
});

// La compétence est un écart à la baseline : positive quand on la bat, négative sinon.
// Battre la routine sur un événement certain rapporte peu ; se tromper avec assurance
// coûte cher (axiom-accuracy-on-the-trivial-counts-for-nothing).
test("skill is the gap to the routine baseline, not raw accuracy", () => {
  assert.ok(skillVsBaseline(0.9, 0.5, 1) > 0);
  assert.ok(skillVsBaseline(0.9, 0.5, 0) < 0);
  assert.equal(skillVsBaseline(0.7, 0.7, 1), 0, "matching the baseline is zero skill, whatever the outcome");
});

// Le signal propre et le signal contaminé ne partagent jamais leur score
// (axiom-acted-prediction-does-not-train-the-person-model).
test("scoring separates clean outcomes from those an action contaminated", () => {
  const items = [
    { prob: 0.8, baselineProb: 0.5, outcome: 1, contaminated: false },
    { prob: 0.9, baselineProb: 0.5, outcome: 1, contaminated: true }
  ];
  const summary = scoreItems(items);
  assert.equal(summary.clean.n, 1);
  assert.equal(summary.contaminated.n, 1);
  assert.equal(summary.contaminatedShare, 0.5);
  assert.notEqual(summary.clean.brier, summary.contaminated.brier);
});

test("the question set stays stable and non-empty", () => {
  assert.ok(QUESTION_IDS.length >= 8);
  assert.equal(new Set(QUESTION_IDS).size, QUESTION_IDS.length, "duplicate question id");
});
