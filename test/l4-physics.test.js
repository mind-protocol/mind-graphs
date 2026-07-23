import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  L4_PHYSICS_TUNING, assertStable, buildPhysicsIndex, createState,
  injectAtNode, propagate, relax, tickActor, step, summarize, citizenPumps,
  cosineSimilarity, setCitizenWorkspace
} from "../src/l4-physics.js";
import {
  createLocalEmbedder, embedLinks, embedNodes, embedWorkspace
} from "../src/local-embedding.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const P = Object.fromEntries(
  Object.entries(L4_PHYSICS_TUNING.parameters).map(([key, spec]) => [key, spec.value])
);

// Graphe minimal, indépendant du corpus : M1 est retenu par une abstention
// signée, M2 ne l'est pas. Tout le reste est symétrique, donc tout écart mesuré
// entre les deux vient du signe et de rien d'autre.
const PROFILES = [
  { source: "FEEDS", polarity: [0.9, 0.2], permanence: 0.6, mode: "axis_dominant" },
  { source: "IMPLEMENTS", polarity: [0.9, 0.45], permanence: 0.8, mode: "composite" },
  { source: "BLOCKS", polarity: [-0.8, 0], permanence: 0.7, mode: "composite" }
];
const NODES = [
  { id: "A", nodeType: "actor", citizen: true, weight: 1, clusterId: "c" },
  { id: "M1", nodeType: "mechanism", clusterId: "c" },
  { id: "M2", nodeType: "mechanism", clusterId: "c" },
  { id: "X1", nodeType: "system_state", clusterId: "c" },
  { id: "X2", nodeType: "system_state", clusterId: "c" },
  { id: "Q", nodeType: "open_question", clusterId: "c" }
];
const LINKS = [
  { source: "A", target: "M1", type: "FEEDS" },
  { source: "A", target: "M2", type: "FEEDS" },
  { source: "M1", target: "X1", type: "IMPLEMENTS" },
  { source: "M2", target: "X2", type: "IMPLEMENTS" },
  { source: "Q", target: "M1", type: "BLOCKS" }
];

const fixture = () => {
  const index = buildPhysicsIndex(NODES, LINKS, PROFILES);
  return { index, state: createState(index) };
};
const energyOf = (state, key) => state.energy.get(key) ?? 0;

test("le régime déclaré est borné, et un régime divergent est refusé", () => {
  const stable = assertStable();
  assert.ok(stable.factor < 1);
  assert.ok(stable.steadyStateTotalPerUnitInjected > 0);
  // La borne n'est pas un plafond arbitraire : c'est une propriété du couple.
  assert.throws(() => assertStable({ decayPerTick: 0.95, propagationGain: 0.2 }), /divergent/u);
});

// C'est la garantie que question-l4-energy-budget réclame. Sans elle, des pompes
// qui battent toutes les quelques secondes font franchir n'importe quel seuil à
// n'importe quel voisinage, et le déclenchement local redevient global.
test("l'énergie totale reste bornée quand les pompes battent sans fin", () => {
  const { index, state } = fixture();
  const bound = assertStable().steadyStateTotalPerUnitInjected * P.actorInjection;
  for (let round = 0; round < 500; round += 1) tickActor(state, index, "A");
  const total = summarize(state, index).totalEnergy;
  assert.ok(total > 0, "le moteur ne transmet rien");
  assert.ok(total <= bound * 1.5, `énergie ${total} au-delà de la borne analytique ${bound}`);
});

test("un Thing injecte une pression événementielle attribuée sans dépasser son réservoir", () => {
  const { index, state } = fixture();
  const options = {
    flowId: "thing-event|health_gap|M1",
    citizenId: null,
    originThingId: "M1",
    flowKind: "health_gap",
    trigger: "health_transition_to_partial",
    budgetSource: "continuous_verification",
    maxReservoir: 1
  };
  for (let pulse = 0; pulse < 10; pulse += 1) injectAtNode(state, index, "M1", 1, options);
  assert.ok(summarize(state, index).totalEnergy <= 1 + Number.EPSILON);
  const flows = [...state.flows.values()].flatMap(bucket => [...bucket.values()]);
  assert.ok(flows.length > 0);
  assert.ok(flows.every(flow => flow.citizenId === null));
  assert.ok(flows.every(flow => flow.originThingId === "M1"));
  assert.ok(flows.every(flow => flow.budgetSource === "continuous_verification"));
});

// Le cœur du dispositif. Dans le vocabulaire actuel, « mécanisme sans CAUSES » et
// « mécanisme avec une question ouverte honnête » sont la même absence, donc
// indiscernables au comptage. Dans la physique signée ce sont des signes opposés,
// et l'abstention a un coût immédiat : elle éteint son propre voisinage.
test("une abstention signée éteint son voisinage, le silence ne fait rien", () => {
  const { index, state } = fixture();
  for (let round = 0; round < 200; round += 1) tickActor(state, index, "A");
  const blocked = energyOf(state, "M1|IMPLEMENTS|X1");
  const silent = energyOf(state, "M2|IMPLEMENTS|X2");
  assert.ok(silent > 0, "le bras témoin devrait être chaud");
  assert.ok(
    blocked < silent,
    `l'aval du mécanisme retenu (${blocked}) devrait être plus froid que le témoin (${silent})`
  );
});

test("une influence inhibitrice n'engendre jamais d'énergie négative", () => {
  const { index, state } = fixture();
  state.energy.set("Q|BLOCKS|M1", 10);
  propagate(state, index);
  for (const entry of index.entries) assert.ok(energyOf(state, entry.key) >= 0, entry.key);
});

// Le seul argument qui fait survivre weight et energy au critère d'admission est
// que leurs lois d'évolution diffèrent. Si ce test cesse de passer, les deux
// dimensions sont devenues un seul scalaire et l'une des deux ment sur son rôle.
test("weight apprend lentement pendant que l'énergie décroît vite", () => {
  const { index, state } = fixture();
  const key = "A|FEEDS|M1";
  injectAtNode(state, index, "A", 4);
  const seeded = energyOf(state, key);
  const weightBefore = state.weight.get(key);
  for (let round = 0; round < 10; round += 1) relax(state, index);
  const energyRatio = energyOf(state, key) / seeded;
  const weightMoved = Math.abs(state.weight.get(key) - weightBefore);
  assert.ok(energyRatio < 0.25, `l'énergie devrait s'être effondrée, ratio ${energyRatio}`);
  assert.ok(weightMoved < 0.25, `weight devrait à peine avoir bougé, écart ${weightMoved}`);
});

// La définition de weight dit « acquis au fil des coactivations » et « survit aux
// périodes d'inactivité complète ». Ces deux clauses sont un test : l'énergie qui
// passe doit augmenter weight, et une fois froid, weight ne doit pas redescendre à
// son point de départ. Une loi qui fait suivre l'activation à weight échoue ici.
test("l'énergie qui passe se convertit en weight, et le weight acquis survit au froid", () => {
  const { index, state } = fixture();
  const key = "A|FEEDS|M1";
  // Le défaut est 1, déjà au plafond : on part sous le plafond pour que
  // l'accumulation ait un sens à mesurer.
  state.weight.set(key, 0.5);
  const start = state.weight.get(key);
  for (let round = 0; round < 60; round += 1) tickActor(state, index, "A");
  const warmed = state.weight.get(key);
  assert.ok(warmed > start + 0.05, `le passage devrait avoir versé du weight (${start} -> ${warmed})`);
  // Puis plus aucune injection : le graphe refroidit entièrement.
  for (let round = 0; round < 400; round += 1) relax(state, index);
  assert.equal(summarize(state, index).totalEnergy, 0, "l'énergie devrait être éteinte");
  const cold = state.weight.get(key);
  assert.ok(cold > start, `weight ne doit pas retomber sous son départ (${cold} vs ${start})`);
  assert.ok(cold > warmed * 0.9, `la fuite doit être très faible, pas un retour à zéro (${warmed} -> ${cold})`);
});

// « La descente de weight dépend de la stabilité. » Deux liens partis du même
// weight, l'un maintenu chaud jusqu'à être stable puis relâché, l'autre froid
// d'emblée : le stable doit perdre son weight strictement plus lentement.
test("un lien stable oublie son weight plus lentement qu'un lien instable", () => {
  const { index, state } = fixture();
  const stableKey = "A|FEEDS|M1";
  const erraticKey = "A|FEEDS|M2";
  // On amène les deux au même weight, mais seul stableKey accumule de la stabilité.
  state.weight.set(stableKey, 0.8);
  state.weight.set(erraticKey, 0.8);
  state.stability.set(stableKey, 0.9);
  state.stability.set(erraticKey, 0.0);
  const beforeStable = state.weight.get(stableKey);
  const beforeErratic = state.weight.get(erraticKey);
  // Graphe froid : seule la fuite agit, modulée par la stabilité de chacun.
  for (let round = 0; round < 300; round += 1) relax(state, index);
  const lostStable = beforeStable - state.weight.get(stableKey);
  const lostErratic = beforeErratic - state.weight.get(erraticKey);
  assert.ok(lostStable < lostErratic, `le stable (${lostStable}) doit perdre moins que l'instable (${lostErratic})`);
});

test("sans injection, le plancher ramène le graphe à zéro exact", () => {
  const { index, state } = fixture();
  injectAtNode(state, index, "A", 1);
  for (let round = 0; round < 400; round += 1) {
    propagate(state, index);
    relax(state, index);
  }
  assert.equal(summarize(state, index).totalEnergy, 0);
  assert.equal(summarize(state, index).liveLinks, 0);
});

// Le moteur lit les prototypes du dictionnaire. Si BLOCKS cessait d'être signé,
// tout le raisonnement ci-dessus tomberait sans qu'aucun test de physique ne
// bouge : c'est la donnée qui porte l'hypothèse, pas le code.
test("le dictionnaire fournit bien une inhibition signée à BLOCKS", async () => {
  const mapping = JSON.parse(
    await fs.readFile(path.resolve(__dirname, "../data/l4-ontology-mapping.json"), "utf8")
  );
  const dictionary = mapping.nodes.find(node => node.id === "l4-predicate-translation-dictionary");
  const blocks = dictionary.profiles.find(profile => profile.source === "BLOCKS");
  const feeds = dictionary.profiles.find(profile => profile.source === "FEEDS");
  assert.ok(blocks.polarity[0] < 0, "BLOCKS a cessé d'inhiber");
  assert.ok(feeds.polarity[0] > 0, "FEEDS a cessé d'exciter");
});

// La citoyenneté est la seule porte d'entrée de l'énergie. Un acteur documenté
// non citoyen — un compte externe cité comme source — ne pompe pas ; un Moment
// non plus. La règle vit à un seul endroit, `citizenPumps`.
test("seuls les acteurs citoyens sont des pompes", () => {
  const pumps = citizenPumps([
    { id: "cit", nodeType: "actor", citizen: true },
    { id: "ext", nodeType: "actor" },
    { id: "reddit", nodeType: "actor", citizen: false },
    { id: "mom", nodeType: "moment", citizen: true },
    { id: "mech", nodeType: "mechanism" }
  ]);
  assert.deepEqual(pumps.map(pump => pump.id), ["cit"]);
});

test("un citoyen sans poids déclaré pèse une unité, jamais zéro", () => {
  const pumps = citizenPumps([{ id: "cit", nodeType: "actor", citizen: true }]);
  assert.equal(pumps[0].weight, 1);
});

// « L'énergie dépend de son poids à lui. » Deux citoyens symétriques de poids 1
// et 3 : l'aval du plus lourd doit être trois fois plus chaud, à la tolérance
// numérique de la propagation près.
test("l'énergie injectée est proportionnelle au poids du citoyen", () => {
  const nodes = [
    { id: "C1", nodeType: "actor", citizen: true, weight: 1, clusterId: "c" },
    { id: "C3", nodeType: "actor", citizen: true, weight: 3, clusterId: "c" },
    { id: "L", nodeType: "mechanism", clusterId: "c" },
    { id: "H", nodeType: "mechanism", clusterId: "c" }
  ];
  const links = [
    { source: "C1", target: "L", type: "FEEDS" },
    { source: "C3", target: "H", type: "FEEDS" }
  ];
  const index = buildPhysicsIndex(nodes, links, PROFILES);
  const state = createState(index);
  // step() : les deux pompes déposent dans le même pas de temps, puis UNE
  // décroissance. Les appeler par deux tickActor séparés donnerait au second un
  // relax de moins et fausserait le rapport — c'est précisément l'ambiguïté
  // d'ordre que step() supprime.
  for (let round = 0; round < 150; round += 1) step(state, index, ["C1", "C3"]);
  const light = state.energy.get("C1|FEEDS|L");
  const heavy = state.energy.get("C3|FEEDS|H");
  const ratio = heavy / light;
  assert.ok(ratio > 2.7 && ratio < 3.3, `le rapport devrait valoir ≈ 3, mesuré ${ratio.toFixed(3)}`);
});

// Le poids d'un citoyen ne décroît jamais, contrairement à l'énergie des liens.
// C'est la différence de loi d'évolution qui le distingue d'un lien au sens du
// critère d'admission ; si elle disparaît, citoyen et lien fusionnent.
test("le poids d'un citoyen survit à tous les tics", () => {
  const { index, state } = fixture();
  const before = state.nodeWeight.get("A");
  for (let round = 0; round < 300; round += 1) tickActor(state, index, "A");
  assert.equal(state.nodeWeight.get("A"), before);
  assert.equal(before, 1);
});

// Le 2026-07-23, le premier citoyen est né : NLR · Nicolas porte citizen: true et
// devient la première pompe interne du graphe. Les autres acteurs restent des
// comptes externes documentés. Ce test garde désormais deux invariants : il existe
// exactement un citoyen, et c'est actor-nlr. Le jour où un second citoyen apparaît,
// ce test tombera — signal qu'il faut décider si le graphe modélise plus d'une vie.
test("le corpus de design déclare exactement un citoyen, NLR", async () => {
  const manifest = JSON.parse(await fs.readFile(path.resolve(__dirname, "../graphs.json"), "utf8"));
  const design = manifest.graphs.find(graph => graph.id === "design");
  const citizens = [];
  for (const dataset of design.datasets) {
    const data = JSON.parse(await fs.readFile(path.resolve(__dirname, "../data", dataset.file), "utf8"));
    citizens.push(...citizenPumps(data.nodes || []));
  }
  assert.equal(citizens.length, 1, "un nouvel acteur porte citizen: true — mettre à jour ce test");
  assert.equal(citizens[0].id, "actor-nlr");
  assert.equal(citizens[0].weight, 1, "un citoyen sans poids déclaré pèse une unité");
});

test("le workspace du citoyen guide chaque répartition sans créer d'énergie", () => {
  const nodes = [
    { id: "C", nodeType: "actor", citizen: true },
    { id: "J", nodeType: "narrative" },
    { id: "aligned", nodeType: "narrative", embedding: [1, 0] },
    { id: "distant", nodeType: "narrative", embedding: [0, 1] }
  ];
  const links = [
    { source: "C", target: "J", type: "FEEDS" },
    { source: "J", target: "aligned", type: "FEEDS" },
    { source: "J", target: "distant", type: "FEEDS" }
  ];
  const index = buildPhysicsIndex(nodes, links, PROFILES);
  const state = createState(index);
  setCitizenWorkspace(state, "C", {
    id: "workspace-goal",
    version: 3,
    embedding: [1, 0],
    embeddingModel: "fixture-2d",
    embeddingModelVersion: "1",
    goalIds: ["goal-aligned"]
  });
  injectAtNode(state, index, "C", 1);
  const before = summarize(state, index).totalEnergy;
  propagate(state, index, { ...P, semanticGuidanceBeta: 4, semanticTemperature: 1, explorationRate: 0.1 }, { citizenId: "C" });
  const aligned = energyOf(state, "J|FEEDS|aligned");
  const distant = energyOf(state, "J|FEEDS|distant");
  const after = summarize(state, index).totalEnergy;
  assert.ok(aligned > distant * 5, `le workspace devrait préférer aligned (${aligned} vs ${distant})`);
  assert.ok(Math.abs(after - before) < 1e-9, `la sémantique a créé ou détruit de l'énergie (${before} -> ${after})`);
  const flow = [...state.flows.get("J|FEEDS|aligned").values()][0];
  assert.equal(flow.citizenId, "C");
  assert.equal(flow.workspaceId, "workspace-goal");
  assert.equal(flow.workspaceVersion, 3);
  assert.equal(flow.embeddingModel, "fixture-2d");
  assert.equal(flow.embeddingModelVersion, "1");
  assert.deepEqual(flow.goalIds, ["goal-aligned"]);
});

test("un plancher exploratoire laisse de l'énergie à une sortie sémantiquement éloignée", () => {
  const nodes = [
    { id: "C", nodeType: "actor", citizen: true },
    { id: "J", nodeType: "narrative" },
    { id: "aligned", nodeType: "narrative", embedding: [1, 0] },
    { id: "opposed", nodeType: "narrative", embedding: [-1, 0] }
  ];
  const links = [
    { source: "C", target: "J", type: "FEEDS" },
    { source: "J", target: "aligned", type: "FEEDS" },
    { source: "J", target: "opposed", type: "FEEDS" }
  ];
  const index = buildPhysicsIndex(nodes, links, PROFILES);
  const state = createState(index);
  setCitizenWorkspace(state, "C", { embedding: [1, 0], goalIds: ["goal"] });
  injectAtNode(state, index, "C", 1);
  propagate(state, index, { ...P, semanticGuidanceBeta: 20, explorationRate: 0.2 }, { citizenId: "C" });
  assert.ok(energyOf(state, "J|FEEDS|opposed") > 0.009, "epsilon doit réserver environ 10 % du transfert à la sortie opposée");
});

test("le tic d'un citoyen ne propage pas le flux d'un autre", () => {
  const nodes = [
    { id: "C1", nodeType: "actor", citizen: true },
    { id: "C2", nodeType: "actor", citizen: true },
    { id: "J", nodeType: "narrative" },
    { id: "T", nodeType: "narrative", embedding: [1, 0] }
  ];
  const links = [
    { source: "C1", target: "J", type: "FEEDS" },
    { source: "C2", target: "J", type: "FEEDS" },
    { source: "J", target: "T", type: "FEEDS" }
  ];
  const index = buildPhysicsIndex(nodes, links, PROFILES);
  const state = createState(index);
  setCitizenWorkspace(state, "C1", { id: "w1", embedding: [1, 0], goalIds: ["g1"] });
  setCitizenWorkspace(state, "C2", { id: "w2", embedding: [0, 1], goalIds: ["g2"] });
  injectAtNode(state, index, "C1", 1);
  tickActor(state, index, "C2");
  const targetFlows = [...state.flows.get("J|FEEDS|T").values()];
  assert.ok(targetFlows.some(flow => flow.citizenId === "C2"));
  assert.equal(targetFlows.some(flow => flow.citizenId === "C1"), false);
});

test("la similarité cosinus refuse les vecteurs incompatibles au lieu d'inventer une proximité", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 0], [1]), 0);
  assert.equal(cosineSimilarity([], []), 0);
});

test("le même embedder local encode workspace, nœuds et transitions dans un espace compatible", async () => {
  const embed = createLocalEmbedder({ dimensions: 64 });
  const rawNodes = [
    { id: "C", name: "Citoyen", nodeType: "actor", citizen: true },
    { id: "J", name: "Choix", nodeType: "narrative" },
    { id: "goal", name: "Réparer le graphe autonome", phrase: "workspace énergie objectifs tests erreurs", nodeType: "narrative" },
    { id: "other", name: "Approvisionnement alimentaire", phrase: "stocks transport récolte", nodeType: "narrative" }
  ];
  const nodes = await embedNodes(rawNodes, embed, { force: true });
  const links = await embedLinks([
    { source: "C", target: "J", type: "FEEDS", justification: "Le citoyen alimente le choix." },
    { source: "J", target: "goal", type: "FEEDS", justification: "Le chemin répare le graphe et teste les erreurs." },
    { source: "J", target: "other", type: "FEEDS", justification: "Le chemin organise les stocks alimentaires." }
  ], nodes, embed, { force: true });
  const workspace = await embedWorkspace({
    id: "w",
    version: 1,
    text: "Réparer le graphe autonome avec le workspace, l'énergie, les objectifs et les tests",
    goalIds: ["goal"]
  }, nodes, embed, { force: true });
  const index = buildPhysicsIndex(nodes, links, PROFILES);
  const guided = createState(index);
  setCitizenWorkspace(guided, "C", workspace);
  injectAtNode(guided, index, "C", 1);
  propagate(guided, index, { ...P, semanticGuidanceBeta: 4, explorationRate: 0.05 }, { citizenId: "C" });

  const baseline = createState(index);
  setCitizenWorkspace(baseline, "C", workspace);
  injectAtNode(baseline, index, "C", 1);
  propagate(baseline, index, { ...P, semanticGuidanceBeta: 0, explorationRate: 0.05 }, { citizenId: "C" });

  const guidedGoal = energyOf(guided, "J|FEEDS|goal");
  const baselineGoal = energyOf(baseline, "J|FEEDS|goal");
  assert.equal(workspace.embedding.length, 64);
  assert.equal(workspace.embeddingModel, embed.metadata.id);
  assert.ok(links.every(link => link.embedding.length === 64 && link.embeddingModel === embed.metadata.id));
  assert.ok(guidedGoal > baselineGoal, `le guidage réel devrait augmenter la part de l'objectif (${guidedGoal} vs ${baselineGoal})`);
  assert.ok(energyOf(guided, "J|FEEDS|other") > 0, "le plancher exploratoire doit préserver l'autre chemin");
});
