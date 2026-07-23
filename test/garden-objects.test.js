import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OBJECTS, CONNECTORS, PORTS, PORT_PREDICATES, MACHINE_STATES,
  blockageOf, connectorOf, isSealed, machineStateOf, objectOf, portStateOf, producesNothing
} from "../public/garden-objects.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ontology = JSON.parse(await fs.readFile(path.resolve(__dirname, "../data/graph-ontology.json"), "utf8"));
const activePredicates = ontology.relationTypes.filter(t => t.status === "active").map(t => t.id);

const node = (id, nodeType) => ({ id, name: id, nodeType, semanticType: nodeType });
const link = (source, type, target) => ({ source, target, type });

// --- Couverture : le vocabulaire doit épouser l'ontologie, pas l'approximer ---

test("every node type of the ontology owns an object, and no object is invented", () => {
  const declared = (ontology.semanticTypes || ontology.nodeTypes).map(t => t.id).sort();
  assert.deepEqual(Object.keys(OBJECTS).sort(), declared);
});

test("every active predicate owns a connector, and no connector is invented", () => {
  assert.deepEqual(Object.keys(CONNECTORS).sort(), [...activePredicates].sort());
});

test("every object silhouette is distinct enough to be told apart", () => {
  const shapes = Object.values(OBJECTS).map(o => o.shape);
  const counts = {};
  for (const s of shapes) counts[s] = (counts[s] || 0) + 1;
  const shared = Object.entries(counts).filter(([, n]) => n > 1);
  assert.deepEqual(shared, [], "two node types would look identical");
});

test("every declared port and every connector port is a real port", () => {
  for (const [type, spec] of Object.entries(OBJECTS)) {
    for (const port of spec.ports) assert.ok(PORTS.includes(port), `${type} declares unknown port ${port}`);
  }
  for (const [predicate, spec] of Object.entries(CONNECTORS)) {
    if (spec.port !== null) assert.ok(PORTS.includes(spec.port), `${predicate} plugs into unknown port ${spec.port}`);
  }
});

test("every port is reachable: a port nothing can plug into would always look capped", () => {
  const pluggable = new Set(Object.values(CONNECTORS).map(c => c.port).filter(Boolean));
  for (const port of PORTS) assert.ok(pluggable.has(port), `nothing can ever connect to ${port}`);
});

test("each object states the function that justifies its shape", () => {
  for (const [type, spec] of Object.entries(OBJECTS)) {
    assert.ok(spec.does && spec.does.length > 3, `${type} has no stated function`);
  }
});

// --- Les deux pièges à mensonge que le vocabulaire doit tenir ----------------

test("a wished-for effect never wears the shape of an observable state", () => {
  assert.notEqual(OBJECTS.design_effect.shape, OBJECTS.system_state.shape);
  assert.deepEqual(OBJECTS.design_effect.ports, [], "a wish has no port: nothing flows into it");
});

test("a design rationale is a tension, not a support", () => {
  assert.equal(OBJECTS.design_rationale.shape, "fissure");
  assert.notEqual(OBJECTS.design_rationale.shape, OBJECTS.axiom.shape);
});

// --- Ports : le déficit se lit sur l'objet -----------------------------------

test("a mechanism with neither intake nor outlet reads as a sealed box", () => {
  const m = node("m", "mechanism");
  assert.equal(isSealed(m, []), true);
  const state = portStateOf(m, []);
  assert.deepEqual(state.connected, []);
  assert.deepEqual(state.capped.sort(), ["footing", "intake", "outlet"]);
});

test("a mechanism that both admits and produces is not sealed", () => {
  const m = node("m", "mechanism");
  const links = [link("src", "FEEDS", "m"), link("m", "CAUSES", "state")];
  assert.equal(isSealed(m, links), false);
  const state = portStateOf(m, links);
  assert.deepEqual(state.connected.sort(), ["intake", "outlet"]);
  assert.deepEqual(state.capped, ["footing"]);
});

// « Avale sans rien produire » est un régime distinct de « scellé », et c'est le
// plus parlant : la machine reçoit un flux et n'en tire aucun effet chiffrable.
test("a machine has four regimes, not two", () => {
  const m = node("m", "mechanism");
  assert.equal(machineStateOf(m, []), "sealed");
  assert.equal(machineStateOf(m, [link("src", "FEEDS", "m")]), "swallows");
  assert.equal(machineStateOf(m, [link("m", "CAUSES", "s")]), "vents");
  assert.equal(machineStateOf(m, [link("src", "FEEDS", "m"), link("m", "CAUSES", "s")]), "running");
  for (const state of ["sealed", "swallows", "vents", "running"]) {
    assert.ok(MACHINE_STATES.includes(state));
  }
});

test("a capped outlet is what matters, whether or not the machine admits anything", () => {
  const m = node("m", "mechanism");
  assert.equal(producesNothing(m, []), true);
  assert.equal(producesNothing(m, [link("src", "FEEDS", "m")]), true, "swallowing is still producing nothing");
  assert.equal(producesNothing(m, [link("m", "CAUSES", "s")]), false);
});

test("only objects that declare both ports have a machine regime", () => {
  assert.equal(machineStateOf(node("a", "axiom"), []), null);
  assert.equal(machineStateOf(node("d", "metric"), []), null);
});

test("only objects that declare both ports can be sealed", () => {
  assert.equal(isSealed(node("a", "axiom"), []), false);
  assert.equal(isSealed(node("d", "source_document"), []), false);
});

test("direction matters: an outlet is fed by outgoing edges only", () => {
  const m = node("m", "mechanism");
  const backwards = [link("other", "CAUSES", "m")];
  assert.ok(portStateOf(m, backwards).capped.includes("outlet"), "an incoming CAUSES is not an outlet");
});

// --- « A bloque B » ----------------------------------------------------------

test("a blockage names its blocker and shows the flow it stops", () => {
  const a = node("q", "open_question"), b = node("m", "mechanism");
  const links = [link("q", "BLOCKS", "m"), link("src", "FEEDS", "m")];
  const blockage = blockageOf(a, b, links);
  assert.equal(blockage.blocker.id, "q");
  assert.equal(blockage.blocked.id, "m");
  assert.equal(blockage.pooling, true, "flow arrives, so it must be shown pooling");
  assert.equal(blockage.answered, false);
  assert.equal(blockage.plank, false);
});

test("with no incoming flow the barrier stays dry rather than faking pressure", () => {
  const blockage = blockageOf(node("q", "open_question"), node("m", "mechanism"), [link("q", "BLOCKS", "m")]);
  assert.equal(blockage.pooling, false);
  assert.equal(blockage.incomingFlow, 0);
});

// ADDRESSES dit qu'une proposition traite la question, jamais qu'elle est validée.
test("an addressed blockage gets a scaffold plank, never a solid crossing", () => {
  const a = node("q", "open_question"), b = node("m", "mechanism");
  const links = [link("q", "BLOCKS", "m"), link("r", "ADDRESSES", "q")];
  const blockage = blockageOf(a, b, links);
  assert.equal(blockage.answered, true);
  assert.equal(blockage.plank, true);
  assert.match(blockage.note, /pas validée/);
});

test("blocking, clashing and shielding are three different connectors", () => {
  assert.equal(connectorOf({ type: "BLOCKS" }).kind, "barrier");
  assert.equal(connectorOf({ type: "CONTRADICTS" }).kind, "clash");
  assert.equal(connectorOf({ type: "SAFEGUARDS" }).kind, "shield");
  assert.equal(connectorOf({ type: "SAFEGUARDS" }).port, "cap", "a shield must not sit in the intake");
  assert.equal(connectorOf({ type: "BLOCKS" }).port, "intake", "a barrier must sit where the flow arrives");
});

test("an unknown predicate degrades to a plain tie instead of throwing", () => {
  assert.equal(connectorOf({ type: "NOT_A_PREDICATE" }).kind, "tie");
  assert.equal(objectOf({ nodeType: "not_a_type" }).shape, "panel");
});

test("the intake predicates that wire a port are the ones the flow family declares", () => {
  for (const predicate of PORT_PREDICATES.intake.predicates) {
    assert.ok(activePredicates.includes(predicate), `${predicate} is not active`);
  }
  for (const [port, rule] of Object.entries(PORT_PREDICATES)) {
    for (const predicate of rule.predicates) {
      assert.ok(activePredicates.includes(predicate), `${port} wires inactive ${predicate}`);
    }
  }
});
