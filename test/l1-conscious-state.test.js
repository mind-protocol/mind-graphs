import test from "node:test";
import assert from "node:assert/strict";
import {
  compileConsciousStateFrame,
  narrateConsciousState
} from "../src/l1-conscious-state.js";

test("missing measurements remain unavailable and the voice does not invent calm or emotion", () => {
  const frame = compileConsciousStateFrame({
    workspace: { observedAt: "2026-07-23T12:00:00Z", activeNodeIds: [] }
  });
  const voice = narrateConsciousState(frame);
  assert.equal(frame.presence.measurementStatus, "unavailable");
  assert.equal(frame.emotionalTone.measurementStatus, "unavailable");
  assert.equal(frame.energy.measurementStatus, "unavailable");
  assert.match(voice.text, /ne peux pas encore estimer/i);
  assert.match(voice.text, /ne parviens pas actuellement à lire mon état émotionnel/i);
  assert.doesNotMatch(voice.text, /calme|heureux|triste|en sécurité/i);
});

test("measured overload produces a deterministic grounded statement", () => {
  const frame = compileConsciousStateFrame({
    workspace: {
      observedAt: "2026-07-23T12:00:00Z",
      characterUsed: 9400,
      characterBudget: 10000,
      slots: [{}, {}, {}, {}],
      activeNodeIds: ["a", "b", "c", "d", "e", "f", "g"],
      innerOuterFocus: 0.8
    },
    awareness: { arousal: 0.85, uncertainty: 0.72 },
    integrity: { activeCandidateCount: 12, fragmentationPressure: 0.82, candidateChurnPerTick: 0.8 },
    attention: { sensoryShare: 0.8, previousFocus: 0.2, target: 0.9 }
  });
  const voice = narrateConsciousState(frame);
  assert.equal(frame.presence.load.state, "overloaded");
  assert.equal(frame.presence.clarity, "fragmented");
  assert.equal(frame.attention.orientation, "mostly_external");
  assert.equal(frame.attention.stability, "unstable");
  assert.match(voice.text, /Je suis surchargé/);
  const overload = voice.sentences.find(item => item.ruleId === "awareness-load-overloaded-v1");
  assert.deepEqual(overload.derivedFrom, ["presence.load.intensity", "presence.clarity", "presence.load.components"]);
});

test("functional affects stay separate from the general affective estimate", () => {
  const frame = compileConsciousStateFrame({
    workspace: { observedAt: "2026-07-23T12:00:00Z" },
    affect: {
      functional: { frustration: 0.8, curiosity: 0.55 },
      stateEstimate: { valence: -0.24, arousal: 0.77, control: 0.51, uncertainty: 0.68 }
    }
  });
  assert.equal(frame.emotionalTone.dominant, "frustration");
  assert.equal(frame.emotionalTone.secondary, "curiosity");
  assert.equal(frame.emotionalTone.stateEstimate.valence, -0.24);
  assert.equal(frame.emotionalTone.stateEstimate.arousal, 0.77);
  assert.match(narrateConsciousState(frame).text, /frustration.*curiosité/);
});

test("close functional affects remain mixed instead of forcing a dominant emotion", () => {
  const frame = compileConsciousStateFrame({
    workspace: { observedAt: "2026-07-23T12:00:00Z" },
    affect: { functional: { curiosity: 0.65, fearOfError: 0.61 } }
  });
  assert.equal(frame.emotionalTone.dominant, null);
  assert.equal(frame.emotionalTone.mixed, true);
  assert.match(narrateConsciousState(frame).text, /sans dominante nette/);
});

test("agency distinguishes an attributed controller from supporting subentities", () => {
  const frame = compileConsciousStateFrame({
    workspace: { observedAt: "2026-07-23T12:00:00Z" },
    agency: {
      controller: "captain",
      controllerName: "Le Capitaine",
      confidence: 0.74,
      coalition: [
        { id: "captain", name: "Le Capitaine", confidence: 0.74, role: "lead" },
        { id: "senex", name: "Le Senex", confidence: 0.48, role: "support" }
      ]
    }
  });
  const voice = narrateConsciousState(frame);
  assert.equal(frame.agency.controller, "captain");
  assert.equal(frame.agency.coalition[1].role, "support");
  assert.match(voice.text, /Capitaine.*Senex.*soutien/);
});

test("time pressure requires measured evidence and does not follow task count alone", () => {
  const withoutPressure = compileConsciousStateFrame({
    workspace: {
      observedAt: "2026-07-23T12:00:00Z",
      queue: { total: 100, eligible: 80, blocked: 20 }
    }
  });
  assert.equal(withoutPressure.tempo.measurementStatus, "unavailable");
  assert.doesNotMatch(narrateConsciousState(withoutPressure).text, /pressé|urgence/i);

  const pressured = compileConsciousStateFrame({
    workspace: { observedAt: "2026-07-23T12:00:00Z" },
    attention: { externalDemand: 0.75 }
  });
  assert.equal(pressured.tempo.state, "urgent");
  assert.match(narrateConsciousState(pressured).text, /pressé/);
});
