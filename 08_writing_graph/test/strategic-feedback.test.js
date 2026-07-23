import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const feedback = JSON.parse(fs.readFileSync(new URL("../data/mind-strategic-feedback.json", import.meta.url), "utf8"));

const st = node => node.semanticType || node.nodeType;

test("strategic feedback keeps sources, decisions and recommendations distinct", () => {
  const sources = feedback.nodes.filter(node => st(node) === "source_document");
  const decisions = feedback.nodes.filter(node => node.id.startsWith("decision-"));
  const options = feedback.nodes.filter(node => st(node) === "decision_option");
  const recommendations = feedback.nodes.filter(node => node.id.startsWith("recommendation-"));
  assert.equal(sources.length, 2);
  assert.equal(decisions.length, 5);
  assert.equal(recommendations.length, 6);
  assert.equal(options.length, 10);
  assert.ok(decisions.every(node => st(node) === "decision" && node.decisionStatus === "proposed" && node.responsibleRole && node.optionCriteria.length));
  assert.ok(recommendations.every(node => node.epistemicStatus === "design_proposal"));
});

test("every strategic decision has a recommendation and two explicit options", () => {
  const decisionIds = new Set(feedback.nodes.filter(node => node.id.startsWith("decision-")).map(node => node.id));
  const addressed = new Set(feedback.links.filter(link => ["ADDRESSES", "RECOMMENDS"].includes(link.type)).map(link => link.target));
  assert.deepEqual([...addressed].filter(id => decisionIds.has(id)).sort(), [...decisionIds].sort());
  for (const id of decisionIds) assert.equal(feedback.links.filter(link => link.type === "OPTION_FOR" && link.target === id).length, 2);
});

test("legal financing remains an open gate instead of an approved instrument", () => {
  const decision = feedback.nodes.find(node => node.id === "decision-seed-instrument");
  const recommendation = feedback.nodes.find(node => node.id === "recommendation-financing-decision-gate");
  assert.equal(st(decision), "decision");
  assert.equal(decision.decisionStatus, "proposed");
  assert.match(recommendation.summary, /deux options/i);
  assert.match(recommendation.summary, /Aucun montage n’est présenté comme validé juridiquement/);
});
