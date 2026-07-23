import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FORWARD_PREDICATES, BLOCKING_PREDICATES, LANE_COUNT,
  buildNarrative, objectiveCharge, roleOf, orientationOf
} from "../public/garden-narrative.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ontology = JSON.parse(await fs.readFile(path.resolve(__dirname, "../data/graph-ontology.json"), "utf8"));

const node = (id, nodeType, extra = {}) => ({ id, name: id, nodeType, clusterId: "d", ...extra });
const link = (source, type, target, extra = {}) => ({ source, target, type, ...extra });

test("every node type of the ontology has a narrative role", () => {
  for (const type of (ontology.semanticTypes || ontology.nodeTypes)) {
    const role = roleOf({ nodeType: type.id, semanticType: type.id });
    assert.ok(role, `${type.id} has no role`);
    assert.notEqual(role, undefined);
  }
});

test("the forward and blocking predicate sets are active and disjoint", () => {
  const active = new Set(ontology.relationTypes.filter(t => t.status === "active").map(t => t.id));
  for (const p of [...FORWARD_PREDICATES, ...BLOCKING_PREDICATES]) assert.ok(active.has(p), `${p} is not active`);
  for (const p of BLOCKING_PREDICATES) assert.ok(!FORWARD_PREDICATES.has(p), `${p} both advances and blocks`);
});

test("an observable state outranks a horizon as the district objective", () => {
  const nodes = [node("h", "horizon"), node("s", "system_state"), node("m", "mechanism")];
  const story = buildNarrative(nodes, [link("m", "CAUSES", "s")], { mainCluster: "d" });
  assert.equal(story.objectives[0].id, "s");
  assert.equal(story.voidReason, null);
});

// Un district « cherche à déplacer » sa cible : un état qu'on veut éviter n'est
// pas une destination, sinon le briefing annonce un but que personne ne poursuit.
test("an adverse state is a hazard, not the destination", () => {
  const nodes = [
    node("risk", "system_state", { stateOrientation: "indésirable" }),
    node("goal", "system_state", { stateOrientation: "désirable" }),
    node("m", "mechanism")
  ];
  const story = buildNarrative(nodes, [link("m", "CAUSES", "risk")], { mainCluster: "d" });
  assert.equal(story.objectives[0].id, "goal");
});

test("an adverse state still leads when the district aims at nothing else", () => {
  const nodes = [node("risk", "system_state", { stateOrientation: "indésirable" }), node("m", "mechanism")];
  const story = buildNarrative(nodes, [link("m", "CAUSES", "risk")], { mainCluster: "d" });
  assert.equal(story.objectives[0].id, "risk");
  assert.equal(story.voidReason, null);
});

test("between equals, the destination is the one the district argues toward", () => {
  const nodes = [
    node("quiet", "system_state", { stateOrientation: "désirable" }),
    node("aimed", "system_state", { stateOrientation: "désirable" }),
    node("m1", "mechanism"), node("m2", "mechanism")
  ];
  const links = [link("m1", "CAUSES", "aimed"), link("m2", "FEEDS", "aimed")];
  const story = buildNarrative(nodes, links, { mainCluster: "d" });
  assert.equal(story.objectives[0].id, "aimed");
});

test("a district without an observable state names its void instead of hiding it", () => {
  const nodes = [node("m1", "mechanism"), node("m2", "mechanism"), node("a", "axiom")];
  const story = buildNarrative(nodes, [link("a", "GROUNDS", "m1")], { mainCluster: "d" });
  assert.deepEqual(story.objectives, []);
  assert.match(story.voidReason, /2 mécanismes/);
  assert.match(story.voidReason, /aucun état observable/);
  assert.deepEqual(story.path, []);
  assert.equal(story.entry, null);
});

test("lanes run from the ground up to the objective", () => {
  const nodes = [node("a", "axiom"), node("m", "mechanism"), node("c", "claim"), node("s", "system_state")];
  const links = [link("a", "GROUNDS", "m"), link("m", "CAUSES", "s")];
  const story = buildNarrative(nodes, links, { mainCluster: "d" });
  assert.equal(story.lanes.get("s"), LANE_COUNT - 1, "the objective sits at the far end");
  assert.equal(story.lanes.get("a"), 0, "the ground stays at the ground");
  assert.ok(story.lanes.get("m") < story.lanes.get("s"), "machinery comes before the objective");
});

test("the critical path runs from a source to the objective, without going backwards", () => {
  const nodes = [node("a", "axiom"), node("m", "mechanism"), node("s", "system_state")];
  const links = [link("a", "GROUNDS", "m"), link("m", "CAUSES", "s")];
  const story = buildNarrative(nodes, links, { mainCluster: "d" });
  assert.deepEqual(story.path.map(n => n.id), ["a", "m", "s"]);
  assert.equal(story.entry.id, "a");
});

test("the avenue prefers a quantified causal edge over a bare one", () => {
  const nodes = [node("bare", "mechanism"), node("solid", "mechanism"), node("s", "system_state")];
  const links = [
    link("bare", "CAUSES", "s"),
    link("solid", "CAUSES", "s", { effectSizePct: 12, confidenceScore: 0.6 })
  ];
  const story = buildNarrative(nodes, links, { mainCluster: "d" });
  assert.deepEqual(story.path.map(n => n.id), ["solid", "s"]);
});

test("a cycle cannot make the critical path loop forever", () => {
  const nodes = [node("x", "mechanism"), node("y", "mechanism"), node("s", "system_state")];
  const links = [link("x", "FEEDS", "y"), link("y", "FEEDS", "x"), link("y", "CAUSES", "s")];
  const story = buildNarrative(nodes, links, { mainCluster: "d" });
  assert.equal(new Set(story.path.map(n => n.id)).size, story.path.length, "no node appears twice");
  assert.ok(story.path.length <= nodes.length);
});

test("an open question is a gate only when it blocks something", () => {
  const nodes = [node("q", "open_question"), node("lonely", "open_question"), node("m", "mechanism"), node("s", "system_state")];
  const links = [link("m", "CAUSES", "s"), link("q", "BLOCKS", "m")];
  const story = buildNarrative(nodes, links, { mainCluster: "d" });
  const blocking = story.gates.find(g => g.node.id === "q");
  const lonely = story.gates.find(g => g.node.id === "lonely");
  assert.deepEqual(blocking.blocks.map(n => n.id), ["m"]);
  assert.equal(blocking.onCriticalPath, true);
  assert.deepEqual(lonely.blocks, []);
  assert.ok(blocking.severity > lonely.severity, "a gate across the avenue outranks an isolated note");
});

test("an answered gate is less severe than an unanswered one", () => {
  const nodes = [node("q", "open_question"), node("m", "mechanism"), node("r", "claim")];
  const base = [link("q", "BLOCKS", "m")];
  const open = buildNarrative(nodes, base, { mainCluster: "d" }).gates[0];
  const closed = buildNarrative(nodes, [...base, link("r", "ADDRESSES", "q")], { mainCluster: "d" }).gates[0];
  assert.equal(open.answered, false);
  assert.equal(closed.answered, true);
  assert.ok(closed.severity < open.severity);
});

test("a beacon is lit in proportion to the quantified claims aimed at it", () => {
  const s = node("s", "system_state");
  assert.deepEqual(objectiveCharge(s, []), { claimed: 0, quantified: 0, charge: 0 });
  const links = [
    link("a", "CAUSES", "s", { effectSizePct: 10 }),
    link("b", "CAUSES", "s"),
    link("c", "LEADS_TO", "s")
  ];
  const charge = objectiveCharge(s, links);
  assert.equal(charge.claimed, 3);
  assert.equal(charge.quantified, 1);
  assert.ok(Math.abs(charge.charge - 1 / 3) < 1e-9);
});

test("orientation tolerates the spellings the corpus actually carries", () => {
  assert.equal(orientationOf({ stateOrientation: "desirable" }), "desirable");
  assert.equal(orientationOf({ stateOrientation: "désirable" }), "desirable");
  assert.equal(orientationOf({ stateOrientation: "indésirable" }), "adverse");
  assert.equal(orientationOf({}), "neutral");
});

test("stranded nodes are counted, not silently drawn as if connected", () => {
  const nodes = [node("m", "mechanism"), node("s", "system_state"), node("orphan", "claim")];
  const story = buildNarrative(nodes, [link("m", "CAUSES", "s")], { mainCluster: "d" });
  assert.equal(story.reach.total, 3);
  assert.equal(story.reach.stranded, 1);
});

// Le district Science met son poids sur une thèse, pas sur son unique état
// observable : désigner l'état comme jardin afficherait un but vide à côté du
// vrai centre de gravité.
test("the garden is where the district actually converges, whatever the type", () => {
  const nodes = [
    node("thesis", "working_hypothesis"), node("state", "system_state"),
    node("m1", "mechanism"), node("m2", "mechanism"), node("m3", "mechanism"), node("money", "institution")
  ];
  const links = [
    link("m1", "IMPLEMENTS", "thesis"), link("m2", "IMPLEMENTS", "thesis"), link("m3", "IMPLEMENTS", "thesis"),
    link("money", "FEEDS", "state")
  ];
  const story = buildNarrative(nodes, links, { mainCluster: "d" });
  assert.equal(story.garden.node.id, "thesis");
  assert.equal(story.garden.convergence, 3);
  assert.deepEqual(story.garden.defines.map(e => e.node.id), ["m1", "m2", "m3"]);
});

test("a single arrival is not a convergence, so there is no garden", () => {
  const nodes = [node("s", "system_state"), node("m", "mechanism")];
  const story = buildNarrative(nodes, [link("m", "CAUSES", "s")], { mainCluster: "d" });
  assert.equal(story.garden, null);
});

test("at equal convergence the observable wins, because it is the falsifiable one", () => {
  const nodes = [
    node("thesis", "working_hypothesis"), node("state", "system_state"),
    node("a", "mechanism"), node("b", "mechanism")
  ];
  const links = [
    link("a", "IMPLEMENTS", "thesis"), link("b", "IMPLEMENTS", "thesis"),
    link("a", "CAUSES", "state"), link("b", "CAUSES", "state")
  ];
  assert.equal(buildNarrative(nodes, links, { mainCluster: "d" }).garden.node.id, "state");
});

// Les ouvrages qui bâtissent le jardin mènent quelque part : les compter comme
// « sans destination » contredisait ce que la clairière montre à l'écran.
test("works that build the garden are not counted as leading nowhere", () => {
  const nodes = [
    node("thesis", "working_hypothesis"), node("m1", "mechanism"), node("m2", "mechanism"), node("lost", "claim")
  ];
  const links = [link("m1", "IMPLEMENTS", "thesis"), link("m2", "IMPLEMENTS", "thesis")];
  const story = buildNarrative(nodes, links, { mainCluster: "d" });
  assert.equal(story.garden.node.id, "thesis");
  assert.equal(story.reach.stranded, 1, "only the disconnected claim leads nowhere");
  assert.ok(story.distance.has("m1"));
});

test("the avenue leads to the garden when there is one", () => {
  const nodes = [node("thesis", "working_hypothesis"), node("a", "mechanism"), node("b", "mechanism"), node("s", "system_state")];
  const links = [link("a", "IMPLEMENTS", "thesis"), link("b", "IMPLEMENTS", "thesis"), link("b", "CAUSES", "s")];
  const story = buildNarrative(nodes, links, { mainCluster: "d" });
  assert.equal(story.path[story.path.length - 1].id, "thesis");
});

test("at equal weight the avenue starts inside the district, not in a neighbour", () => {
  const nodes = [
    node("hub", "working_hypothesis"),
    { id: "aa-outsider", name: "aa-outsider", nodeType: "mechanism", clusterId: "other" },
    node("zz-local", "mechanism")
  ];
  const links = [link("aa-outsider", "IMPLEMENTS", "hub"), link("zz-local", "IMPLEMENTS", "hub")];
  const story = buildNarrative(nodes, links, { mainCluster: "d" });
  assert.equal(story.entry.id, "zz-local", "an alphabetically earlier neighbour must not win");
});
