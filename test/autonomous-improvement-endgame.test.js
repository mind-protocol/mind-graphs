import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = async relative => JSON.parse(await fs.readFile(path.resolve(__dirname, relative), "utf8"));
const manifest = await read("../graphs.json");
const endgame = await read("../data/autonomous-improvement-endgame.json");
const nodes = new Map(endgame.nodes.map(node => [node.id, node]));

test("the autonomous improvement endgame is an active design dataset", () => {
  const design = manifest.graphs.find(graph => graph.id === "design");
  assert.ok(design.datasets.some(dataset =>
    dataset.id === "autonomous-improvement-endgame"
    && dataset.file === "autonomous-improvement-endgame.json"));
});

test("the citizen owns the target and no synthetic worker replaces it", () => {
  assert.ok(endgame.links.some(link =>
    link.source === "state-goal-directed-autonomous-improvement"
    && link.type === "AUTHORED_BY"
    && link.target === "actor-nlr"));
  assert.equal(endgame.nodes.some(node => node.nodeType === "actor"), false);
  assert.match(nodes.get("mech-direct-citizen-graph-work").summary, /ne délègue pas la cognition/u);
});

test("workspace semantics route energy without creating it", () => {
  const axiom = nodes.get("axiom-workspace-guides-without-creating-energy");
  const normalization = nodes.get("mech-conservative-semantic-normalization");
  const method = nodes.get("method-workspace-link-cosine-softmax");
  assert.match(axiom.summary, /ne multiplie ni ne réplique l’énergie/u);
  assert.match(normalization.summary, /parts dont la somme vaut un/u);
  assert.match(method.summary, /softmax/u);
  assert.match(method.summary, /Beta, tau et epsilon_exploration/u);
});

test("energy remains attributed to citizen workspace and goals", () => {
  const flow = nodes.get("mech-intention-tagged-energy-flow");
  const ledger = nodes.get("method-attributed-energy-ledger");
  for (const field of ["flowId", "citizenId", "workspaceId", "workspaceVersion", "goalIds"]) {
    assert.match(flow.summary, new RegExp(field));
  }
  assert.match(ledger.summary, /ne détruit jamais l’attribution/u);
  assert.ok(endgame.links.some(link =>
    link.source === ledger.id && link.type === "IMPLEMENTS" && link.target === flow.id));
});

test("semantic routing preserves an explicit exploration path", () => {
  assert.ok(endgame.links.some(link =>
    link.source === "state-semantic-lock-in"
    && link.type === "MOTIVATES"
    && link.target === "mech-exploration-energy-floor"));
  assert.ok(endgame.links.some(link =>
    link.source === "mech-exploration-energy-floor"
    && link.type === "FEEDS"
    && link.target === "mech-conservative-semantic-normalization"));
  assert.match(nodes.get("mech-exploration-energy-floor").summary, /probabilité non nulle/u);
});

test("every target and risk is observable", () => {
  const states = endgame.nodes.filter(node => node.semanticType === "system_state");
  assert.deepEqual(states.map(node => node.stateOrientation).sort(), ["desirable", "undesirable", "undesirable"].sort());
  for (const state of states) {
    assert.ok(state.stateDimension);
    assert.ok(state.stateIndicator);
    assert.ok(endgame.links.some(link => link.source === state.id && link.type === "MEASURED_BY"), `${state.id} lacks a metric`);
  }
});

test("every relation carries an authored justification", () => {
  for (const link of endgame.links) {
    assert.equal(typeof link.justification, "string");
    assert.ok(link.justification.trim().length >= 40, `${link.source} ${link.type} ${link.target}`);
  }
});

test("the executable Thing nodes are linked to the mechanisms they implement", async () => {
  const things = [
    nodes.get("thing-attributed-semantic-energy-runtime"),
    nodes.get("thing-workspace-aware-l4-runner"),
    nodes.get("thing-common-space-local-embedding-runtime"),
    nodes.get("thing-intent-embedding-profile-runtime"),
    nodes.get("thing-universal-moment-reinforcement-runtime"),
    nodes.get("thing-cluster-question-compiler-runtime"),
    nodes.get("thing-inner-outer-attention-runtime")
  ];
  for (const thing of things) {
    assert.equal(thing.nodeType, "thing");
    assert.equal(thing.semanticType, "method");
    assert.ok(thing.codePath);
    assert.ok(thing.verificationCommand);
    await fs.access(path.resolve(__dirname, "..", thing.codePath));
    assert.ok(endgame.links.some(link => link.source === thing.id && link.type === "IMPLEMENTS"));
  }
});

test("the graph records an executable verification and its observation", () => {
  const experiment = nodes.get("experiment-attributed-workspace-routing-contract");
  const observation = nodes.get("observation-attributed-workspace-routing-tests-pass");
  assert.equal(experiment.verificationCommand, "node --test test/l4-physics.test.js test/l4-physics-logging.test.js");
  assert.equal(observation.observedValue, "22/22");
  assert.equal(observation.observationCommand, experiment.verificationCommand);
  assert.ok(endgame.links.some(link =>
    link.source === experiment.id && link.type === "PRODUCES" && link.target === observation.id));
  for (const metric of ["metric-cross-intention-energy-share", "metric-routing-concentration", "metric-explored-path-diversity"]) {
    assert.ok(endgame.links.some(link =>
      link.source === observation.id && link.type === "MEASURES" && link.target === metric));
  }
});

test("the graph records the real common-space embedding comparison", () => {
  const experiment = nodes.get("experiment-common-embedding-space-routing");
  const observation = nodes.get("observation-common-embedding-space-routing");
  assert.match(nodes.get("thing-common-space-local-embedding-runtime").summary, /même dimension/u);
  assert.equal(experiment.comparisonCommands.length, 2);
  assert.match(experiment.comparisonCommands[0], /semantic-beta=2/u);
  assert.match(experiment.comparisonCommands[1], /semantic-beta=0/u);
  assert.equal(observation.observedValue, "26/26 · lien objectif +0,11 % · cluster autonome -0,25 %");
  assert.match(observation.summary, /aucun gain sémantique global n’est revendiqué/u);
  assert.ok(endgame.links.some(link =>
    link.source === experiment.id && link.type === "PRODUCES" && link.target === observation.id));
});

test("the graph maps every Cortex state to the executable intent profile", () => {
  const states = [
    "state-monitoring",
    "state-activation-evaluation",
    "state-workspace-bidding",
    "state-targeting-planning",
    "state-execution",
    "state-feedback-monitoring",
    "state-closure-consolidation",
    "state-frustration-pivot"
  ];
  for (const state of states) {
    assert.ok(endgame.links.some(link =>
      link.source === state
      && link.type === "FEEDS"
      && link.target === "mech-cortex-affect-search-intent"), state);
  }
  const experiment = nodes.get("experiment-intent-embedding-profile-contract");
  const observation = nodes.get("observation-intent-embedding-profile-contract-passes");
  assert.equal(observation.observedValue, "25/25 · 30 profils · cluster autonome rang 4");
  assert.equal(observation.observationCommand, experiment.verificationCommand);
  assert.ok(endgame.links.some(link =>
    link.source === observation.id
    && link.type === "MEASURES"
    && link.target === "metric-intent-cluster-discrimination"));
});

test("winning reinforces Moments directly without introducing a strategy type", () => {
  const axiom = nodes.get("axiom-every-moment-is-reinforceable");
  const mechanism = nodes.get("mech-multidimensional-moment-outcome");
  const experiment = nodes.get("experiment-universal-moment-reinforcement-contract");
  const observation = nodes.get("observation-universal-moment-reinforcement-contract-passes");
  assert.match(axiom.summary, /stratégie reste un motif émergent/u);
  for (const dimension of [
    "humanValenceDelta",
    "positiveAffectDelta",
    "subentityEnergyDelta",
    "completenessDelta",
    "goalProgressDelta"
  ]) assert.match(mechanism.summary, new RegExp(dimension));
  assert.equal(endgame.nodes.some(node => String(node.semanticType).toLowerCase() === "strategy"), false);
  assert.equal(observation.observedValue, "29/29 · score 0,40 · poids 1,08 et 1,04 · énergie 1,568");
  assert.equal(observation.observationCommand, experiment.verificationCommand);
  assert.ok(endgame.links.some(link =>
    link.source === observation.id
    && link.type === "MEASURES"
    && link.target === "metric-moment-reinforcement-outcome-uplift"));
});

test("cluster gaps compile into a typed autonomous question agenda", () => {
  const axiom = nodes.get("axiom-cluster-gaps-ask-before-graph-writing");
  const compiler = nodes.get("mech-cluster-gap-question-compilation");
  const workspace = nodes.get("mech-question-agenda-global-workspace");
  const method = nodes.get("method-cortex-affect-question-priority");
  const presentation = nodes.get("method-json-canonical-markdown-question-view");
  const termination = nodes.get("mech-question-loop-termination");
  const focus = nodes.get("mech-continuous-inner-outer-question-volume");
  const focusDynamics = nodes.get("mech-endogenous-inner-outer-focus-dynamics");
  const observation = nodes.get("observation-cluster-question-compiler-contract-passes");
  assert.match(axiom.summary, /no_mutation/);
  for (const gap of [
    "objective_without_measure",
    "objective_without_origin",
    "unresolved_question",
    "blocked_target",
    "claim_without_evidence",
    "executable_without_test"
  ]) assert.match(compiler.summary, new RegExp(gap));
  assert.match(workspace.summary, /answer_questions/);
  assert.match(workspace.summary, /Sans tâche ni question, observe_only/);
  assert.match(method.summary, /répartit exactement le budget total/);
  assert.match(presentation.summary, /Le Markdown n’est jamais reparsé/);
  assert.match(presentation.summary, /réponse étayée doit être matérialisée dans le graphe/);
  assert.match(termination.summary, /trois essais séparés par deux versions/);
  assert.match(termination.summary, /exhausted/);
  assert.match(focus.summary, /\[-1,1\]/);
  assert.match(focus.summary, /six, quatre ou deux/);
  assert.match(focusDynamics.summary, /externalDemand - internalDemand/);
  assert.match(focusDynamics.summary, /Le focus courant ne participe pas au calcul de target/);
  assert.equal(observation.observedValue, "32/32 · focus smoke -0,8 → +0,158098 · questions 6/4/2 · budget 1/1/1");
  assert.ok(endgame.links.some(link =>
    link.source === termination.id
    && link.type === "SAFEGUARDS"
    && link.target === workspace.id));
  for (const state of [
    "state-monitoring",
    "state-activation-evaluation",
    "state-workspace-bidding",
    "state-targeting-planning",
    "state-execution",
    "state-feedback-monitoring",
    "state-closure-consolidation",
    "state-frustration-pivot"
  ]) assert.ok(endgame.links.some(link =>
    link.source === state
    && link.type === "FEEDS"
    && link.target === compiler.id), state);
});
