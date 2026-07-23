import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const graph = JSON.parse(await fs.readFile(new URL("../l1/data/l1-brain-blueprint-v0.1.graph.json", import.meta.url), "utf8"));
const nodes = new Map(graph.nodes.map(node => [node.id, node]));

test("the L1 brain blueprint is internally closed and uniquely addressable", () => {
  assert.equal(graph.clusters.length, 49);
  assert.equal(new Set(graph.nodes.map(node => node.id)).size, graph.nodes.length);
  assert.equal(new Set(graph.relations.map(relation => relation.id)).size, graph.relations.length);
  for (const relation of graph.relations) {
    assert.ok(nodes.has(relation.source), `missing source ${relation.source}`);
    assert.ok(nodes.has(relation.target), `missing target ${relation.target}`);
  }
});

test("all nodes obey the five-role L4 grammar", () => {
  const allowed = new Set(["Actor", "Moment", "Narrative", "Thing", "Space"]);
  for (const node of graph.nodes) {
    assert.ok(allowed.has(node.nodeType), `${node.id} has invalid nodeType ${node.nodeType}`);
    assert.ok(node.semanticType, `${node.id} has no semanticType`);
    assert.ok(Array.isArray(node.facets), `${node.id} has no facets array`);
    assert.ok(node.initialEnergy >= 0, `${node.id} starts with negative energy`);
  }
});

test("only the local citizen actor can inject energy", () => {
  const pumps = graph.nodes.filter(node => node.injectsEnergy);
  assert.deepEqual(pumps.map(node => node.id), ["actor-citizen-runtime-citizen-role"]);
  assert.equal(pumps[0].nodeType, "Actor");
  assert.equal(pumps[0].citizen, true);
  for (const node of graph.nodes.filter(node => node.semanticType === "Subentity")) {
    assert.equal(node.nodeType, "Actor");
    assert.equal(node.citizen, false);
  }
});

test("workspace, memory and goals use their constitutional L4 roles", () => {
  const workspace = nodes.get("thing-global-workspace-runtime");
  assert.equal(workspace.nodeType, "Thing");
  assert.equal(workspace.injectsEnergy, false);
  assert.equal(workspace.characterBudget, null);
  assert.equal(workspace.characterBudgetStatus, "configuration_required");
  assert.equal(nodes.get("moment-memory-autobiographical").nodeType, "Moment");
  assert.equal(nodes.get("narrative-goals-goal-template").nodeType, "Narrative");
  assert.equal(nodes.get("narrative-goals-open-loop-template").nodeType, "Narrative");
});

test("edge physics stays bounded and keeps the declared conservative formula", () => {
  assert.equal(graph.physics.fluxFormula, "I = E × W × P × G");
  assert.equal(graph.physics.conservation, "strict");
  assert.equal(graph.physics.nonlinearActivationThreshold, null);
  for (const relation of graph.relations) {
    const { W, P, G, S } = relation.physics;
    assert.ok(W >= 0 && W <= 1, `${relation.id} has invalid W`);
    assert.ok(P >= -1 && P <= 1, `${relation.id} has invalid P`);
    assert.ok(G >= 0 && G <= 1, `${relation.id} has invalid G`);
    if (S !== undefined) assert.ok(S >= 0 && S <= 1, `${relation.id} has invalid S`);
  }
});

test("open thresholds remain explicit questions, not invented constants", () => {
  assert.deepEqual(graph.openQuestionIds.sort(), [
    "narrative-clusters-no-universal-threshold",
    "narrative-global-workspace-workspace-budget-open",
    "narrative-l4-physics-threshold-open"
  ]);
});

test("the complete graph includes the eight-state Cortex machine and its primitives", () => {
  const states = graph.nodes.filter(node => node.semanticType === "CortexState");
  const primitives = graph.nodes.filter(node => node.semanticType === "CortexPrimitive");
  assert.equal(states.length, 8);
  assert.equal(primitives.length, 4);
  assert.equal(graph.relations.filter(relation => relation.type === "TRANSITIONS_TO").length, 10);
  for (const state of states) {
    assert.ok(graph.relations.some(relation =>
      relation.target === state.id
      && relation.type === "MOTIVATES"
      && nodes.get(relation.source)?.nodeType === "Narrative"), `${state.id} has no narrative rationale`);
  }
  for (const primitive of primitives) {
    assert.ok(graph.relations.some(relation =>
      relation.target === primitive.id
      && relation.type === "JUSTIFIES"
      && nodes.get(relation.source)?.nodeType === "Narrative"), `${primitive.id} has no narrative rationale`);
  }
});

test("the eight Cortex states are justified as an engineering decomposition, not a biological fact", () => {
  const decomposition = nodes.get("narrative-cortex-eight-state-functional-decomposition");
  const limitation = nodes.get("narrative-cortex-state-count-remains-hypothesis");
  assert.equal(decomposition.semanticType, "DesignJustification");
  assert.match(decomposition.description, /décomposition d ingénierie/u);
  assert.match(limitation.description, /ne démontre pas que huit est le nombre minimal/u);
  for (const stateId of [
    "state-activation-evaluation", "state-workspace-bidding", "state-targeting-planning",
    "state-execution", "state-feedback-monitoring"
  ]) {
    assert.ok(graph.relations.some(relation =>
      relation.source === decomposition.id && relation.type === "MOTIVATES" && relation.target === stateId), stateId);
  }
});

test("high affect can open a provisional candidate but cannot silently create a durable subentity", () => {
  const separation = nodes.get("narrative-subentity-activation-is-not-formation");
  const exception = nodes.get("narrative-high-affect-can-create-provisional-candidate");
  assert.match(separation.description, /ne suffit pas à lui seul à déclarer une identité interne durable/u);
  assert.match(exception.description, /candidat protecteur/u);
  assert.ok(graph.relations.some(relation =>
    relation.source === separation.id
    && relation.type === "CONSTRAINS"
    && relation.target === "thing-subentities-subentity-detector"));
  assert.ok(graph.relations.some(relation =>
    relation.source === exception.id
    && relation.type === "CONFIGURES"
    && relation.target === "thing-subentities-subentity-detector"));
  assert.ok(nodes.get("thing-affect-plasticity-controller").description.includes("candidat provisoire"));
});

test("the affective system is hierarchical, continuous and never a flat emotion enum", () => {
  const system = graph.affectiveSystem;
  assert.equal(system.personalPrefill, false);
  assert.equal(system.stateHierarchy.simultaneous, true);
  assert.deepEqual(system.stateHierarchy.metabolicRegimes, ["RESTORED", "AVAILABLE", "STRAINED", "DEPLETED", "OVERLOADED"]);
  assert.deepEqual(system.stateHierarchy.safetyRegimes, ["SAFE", "VIGILANT", "THREATENED", "INTERRUPT", "RECOVERY"]);
  assert.equal(Object.keys(system.stateHierarchy.limbicDimensions).length, 10);
  assert.deepEqual(system.stateHierarchy.limbicDimensions.valence, [-1, 1]);
  for (const [dimension, bounds] of Object.entries(system.stateHierarchy.limbicDimensions)) {
    assert.equal(bounds.length, 2, dimension);
    assert.ok(bounds[0] < bounds[1], dimension);
  }
});

test("affective prototypes are shared Things while personal states remain Moments", () => {
  const prototypes = graph.nodes.filter(node => node.semanticType === "AffectPrototype");
  assert.equal(prototypes.length, 14);
  assert.ok(prototypes.every(node => node.nodeType === "Thing" && node.citizen === false));
  for (const id of ["moment-affect-metabolic-state-snapshot", "moment-affect-error-state-event", "moment-affect-cortical-pattern-event", "moment-affect-limbic-state-snapshot", "moment-affect-limbic-transition-event"]) {
    assert.equal(nodes.get(id).nodeType, "Moment", id);
    assert.equal(nodes.get(id).initialEnergy, 0, id);
  }
  const snapshot = nodes.get("moment-affect-limbic-state-snapshot");
  assert.equal(snapshot.valence, undefined, "the blueprint must not prefill a personal affective state");
});

test("metabolism, safety and affect only modulate gates around citizen energy", () => {
  assert.equal(graph.affectiveSystem.formulas.effectiveGate, "G_effectif = G_base × G_metabolic × G_safety × G_affective × G_permission");
  assert.equal(graph.affectiveSystem.formulas.propagation, "I = E × W × P × G_effectif");
  assert.equal(nodes.get("thing-affect-subentity-activation-router").injectsEnergy, false);
  assert.ok(graph.relations.some(relation => relation.source === "thing-affect-bounded-interrupt-lease" && relation.type === "GATES"));
  assert.ok(graph.relations.some(relation => relation.source === "thing-affect-runtime-auditor" && relation.target === "thing-affect-recovery-controller"));
});

test("the complete affective tick reaches the workspace and conditional learning", () => {
  assert.equal(graph.affectiveSystem.tick.length, 15);
  assert.ok(graph.relations.some(relation => relation.source === "thing-affect-subentity-activation-router" && relation.target === "thing-global-workspace-selector"));
  assert.ok(graph.relations.some(relation => relation.source === "moment-action-action-event" && relation.target === "thing-affect-plasticity-controller"));
  assert.ok(graph.relations.some(relation => relation.source === "thing-affect-runtime-auditor" && relation.target === "thing-validation-acceptance-suite"));
});

test("every link carries an auditable affect vector", () => {
  const dimensions = graph.affectiveSystem.linkAffect.dimensions;
  assert.deepEqual(dimensions, ["curiosity", "desire", "care", "fearOfError", "frustration", "surprise", "anger"]);
  for (const relation of graph.relations) {
    assert.deepEqual(Object.keys(relation.affectVector), dimensions, relation.id);
    assert.ok(Object.values(relation.affectVector).every(value => value >= 0 && value <= 1), relation.id);
    assert.equal(relation.affectProfile.observationCount, 0, relation.id);
    assert.equal(relation.affectProfile.personal, false, relation.id);
  }
});

test("homeostasis turns a dominant affect into proposals before arbitration", () => {
  assert.equal(graph.affectiveSystem.homeostasis.fundamentalGoal, true);
  assert.ok(nodes.has("thing-affect-homeostasis-controller"));
  assert.ok(nodes.has("thing-affect-dominant-selector"));
  assert.ok(graph.relations.some(relation => relation.source === "moment-affect-homeostatic-decision-event" && relation.target === "thing-action-arbitrator"));
});

test("human needs and AI operational requirements stay separate and behaviorally explicit", () => {
  const system = graph.needsSystem;
  assert.equal(system.basisVersion, "l1-needs-v0.1");
  assert.equal(system.vectorContract.unknownIsZero, false);
  assert.equal(system.human.entityKind, "human_need");
  assert.equal(system.human.experienced, true);
  assert.equal(system.ai.entityKind, "ai_operational_requirement");
  assert.equal(system.ai.experienced, false);
  assert.equal(system.human.dimensions.length, 8);
  assert.equal(system.ai.dimensions.length, 8);

  for (const dimension of [...system.human.dimensions, ...system.ai.dimensions]) {
    const node = nodes.get(dimension.id);
    assert.ok(node, dimension.id);
    assert.ok(dimension.description.length > 40, `${dimension.id} has no useful description`);
    assert.ok(dimension.behavioralEffects.length >= 3, `${dimension.id} has too few behavioral effects`);
    assert.deepEqual(node.behavioralEffects, dimension.behavioralEffects);
    assert.equal(node.basisVersion, system.basisVersion);
    assert.equal(node.injectsEnergy, false);
  }

  assert.ok(graph.relations.some(relation => relation.source === "thing-human-need-state-estimator" && relation.target === "thing-affect-subentity-activation-router"));
  assert.ok(graph.relations.some(relation => relation.source === "thing-ai-operational-requirement-monitor" && relation.target === "thing-citizen-ai-role-activation-scorer"));
  assert.match(system.distinction, /ni émotion, ni conscience/u);
});

test("the sensory bridge observes strong or recent citizen relations without joining graphs", () => {
  assert.equal(graph.sensorySystem.crossGraphEdgesCreated, false);
  assert.equal(graph.sensorySystem.energyAttribution, "citizen");
  assert.deepEqual(graph.sensorySystem.configContract, [
    "citizenIds", "minWeight", "recentWindowMs", "minSimilarity", "topK", "workspaceState", "attentionState", "attentionConfig", "now", "tickId"
  ]);
  assert.equal(graph.sensorySystem.fixedSensoryRatio, false);
  assert.match(graph.sensorySystem.attentionRule, /Global Workspace/u);
  for (const id of [
    "thing-sensory-citizen-identity-resolver",
    "thing-sensory-connection-scanner",
    "thing-sensory-line-serializer",
    "thing-sensory-embedding-cache",
    "thing-sensory-similarity-router",
    "thing-sensory-energy-ledger",
    "thing-attention-internal-external-arbitrator",
    "thing-sensory-habituation-memory"
  ]) {
    assert.ok(nodes.has(id), id);
    assert.equal(nodes.get(id).injectsEnergy, false, id);
  }
  assert.ok(graph.relations.some(relation => relation.source === "actor-citizen-runtime-citizen-role" && relation.target === "thing-sensory-energy-ledger"));
  assert.ok(graph.relations.some(relation => relation.source === "moment-sensory-tick" && relation.target === "thing-routing-energy-router"));
  assert.ok(graph.relations.some(relation => relation.source === "thing-global-workspace-runtime" && relation.target === "thing-attention-internal-external-arbitrator"));
  assert.ok(graph.relations.some(relation => relation.source === "thing-affect-homeostasis-controller" && relation.target === "thing-attention-internal-external-arbitrator"));
  for (const id of ["thing-sensory-runtime-explainer", "thing-sensory-run-statistics-aggregator", "moment-sensory-run-summary"]) {
    assert.ok(nodes.has(id), id);
  }
  assert.ok(graph.relations.some(relation => relation.source === "thing-sensory-run-statistics-aggregator" && relation.target === "moment-sensory-run-summary"));
});

test("the subentity lifecycle is explicit, softly capacity-regulated and memory-linked", () => {
  const mechanisms = [
    "thing-subentities-similarity-reconciler",
    "thing-subentities-soft-capacity-regulator",
    "thing-subentities-narrative-materializer",
    "thing-subentities-moment-controller-writer"
  ];
  for (const id of mechanisms) {
    assert.equal(nodes.get(id)?.nodeType, "Thing", `${id} must be an executable mechanism`);
    assert.ok(graph.relations.some(relation => relation.target === id && relation.type === "JUSTIFIES"), `${id} needs a rationale`);
  }
  assert.match(nodes.get("narrative-subentities-soft-equilibrium-not-cap").description, /Aucun test de type maximum atteint/u);
  assert.match(nodes.get("narrative-subentities-low-level-reconcile-high-level-protect").description, /contradiction seule ne suffit donc jamais/u);
  assert.ok(graph.relations.some(relation => relation.source === "thing-subentities-moment-controller-writer" && relation.target === "moment-memory-autobiographical" && relation.type === "ANNOTATES"));
});

test("subentity memory attribution keeps common ownership, bounded workspace control and append-only correction", () => {
  const system = graph.subentityMemoryAttributionSystem;
  assert.equal(system.memoryOwner, "citizen_ai_unique");
  assert.equal(system.relationDirection, "Moment_to_Subentity");
  assert.equal(system.unknownIsValid, true);
  assert.equal(system.selfConfirmationAllowed, false);
  assert.equal(system.correctionStrategy, "append_only_supersession");
  assert.equal(system.principles.length, 15);
  assert.equal(system.risks.length, 9);
  assert.equal(system.scenarios.length, 8);
  assert.deepEqual(system.relationTypes, [
    "ENCODED_UNDER", "GENERATED_BY", "INVOLVES",
    "RESONATES_WITH", "RECALLS", "REINTERPRETS"
  ]);
  assert.deepEqual(graph.subentityMemoryAttributionAugmentationCounts, { nodes: 99, relations: 206, clusters: 0 });
  assert.match(nodes.get("actor-subentities-subentity-template").description, /citizen=false/u);
  assert.match(nodes.get("action-pulse").description, /ne crée jamais/u);
});

test("metacognition keeps parallel futures and only exposes positive bounded modes", () => {
  const system = graph.metacognitiveSystem;
  assert.deepEqual(system.modes, ["OBSERVE", "VERIFY", "STABILIZE", "PROTECT", "RECOVER", "ENGAGE"]);
  assert.deepEqual(system.forbiddenModes, ["PANIC"]);
  assert.equal(system.beliefUtilitySeparation, true);
  assert.equal(system.stateAwarenessIsEstimate, true);
  assert.equal(system.autonomousIrreversibleActionAllowed, false);
  assert.match(system.formulas.posterior, /temperature/u);
  assert.match(system.formulas.scenarioUtility, /controllability/u);
  for (const id of [
    "thing-meta-scenario-ensemble-generator",
    "thing-meta-bayesian-scenario-evaluator",
    "thing-meta-confidence-calibrator",
    "thing-meta-mode-selector",
    "thing-meta-threat-hysteresis-controller",
    "thing-meta-subentity-adaptation-controller",
    "thing-meta-runtime-auditor"
  ]) {
    assert.equal(nodes.get(id)?.injectsEnergy, false, id);
  }
  assert.ok(graph.relations.some(relation => relation.source === "thing-meta-mode-selector" && relation.target === "thing-meta-subentity-adaptation-controller"));
  assert.ok(graph.relations.some(relation => relation.source === "thing-meta-runtime-auditor" && relation.target === "thing-validation-acceptance-suite"));
});

test("the machine-readable audit preserves the source count discrepancy", () => {
  assert.deepEqual(graph.declaredCounts, { nodes: 212, relations: 764, clusters: 23 });
  assert.deepEqual(graph.baseBodyCounts, { nodes: 209, relations: 668, clusters: 23 });
  assert.deepEqual(graph.cortexAugmentationCounts, { nodes: 46, relations: 98 });
  assert.deepEqual(graph.affectiveAugmentationCounts, { nodes: 92, relations: 259, clusters: 10 });
  assert.deepEqual(graph.sensoryAugmentationCounts, { nodes: 24, relations: 80, clusters: 0 });
  assert.deepEqual(graph.metacognitiveAugmentationCounts, { nodes: 22, relations: 83, clusters: 0 });
  assert.deepEqual(graph.citizenAIRoleAugmentationCounts, { nodes: 326, relations: 437, clusters: 16 });
  assert.deepEqual(graph.actualCounts, { nodes: 818, relations: 1831, clusters: 49 });
  assert.equal(graph.sourceAudit.sources.length, 7);
  assert.equal(graph.sourceAudit.discrepancies.length, 2);
});
