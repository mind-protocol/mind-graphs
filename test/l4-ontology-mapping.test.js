import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const readJson = async relativePath => JSON.parse(
  await fs.readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")
);

async function loadContract() {
  const [ontology, mapping] = await Promise.all([
    readJson("data/graph-ontology.json"),
    readJson("data/l4-ontology-mapping.json")
  ]);
  const typeNode = mapping.nodes.find(node => node.id === "l4-node-type-mapping");
  const predicateNode = mapping.nodes.find(node => node.id === "l4-predicate-translation-dictionary");
  return { ontology, mapping, typeNode, predicateNode };
}

test("le mapping L4 couvre exactement les 30 types actifs", async () => {
  const { ontology, typeNode } = await loadContract();
  const sourceTypes = (ontology.semanticTypes || ontology.nodeTypes).map(type => type.id).sort();
  const mappedTypes = typeNode.mappings.map(entry => entry.source).sort();

  assert.deepEqual(mappedTypes, sourceTypes);
  assert.equal(new Set(mappedTypes).size, mappedTypes.length);
  for (const entry of typeNode.mappings) {
    assert.ok(["actor", "moment", "narrative", "space", "thing"].includes(entry.l4));
    assert.ok(entry.reason?.length > 20);
  }
});

test("le dictionnaire L4 couvre exactement les 41 prédicats actifs", async () => {
  const { ontology, predicateNode } = await loadContract();
  const activePredicates = ontology.relationTypes
    .filter(relation => relation.status === "active")
    .map(relation => relation.id)
    .sort();
  const mappedPredicates = predicateNode.profiles.map(profile => profile.source).sort();

  assert.deepEqual(mappedPredicates, activePredicates);
  assert.equal(new Set(mappedPredicates).size, mappedPredicates.length);
});

test("les prototypes ne détournent jamais les champs dynamiques pour coder un verbe", async () => {
  const { predicateNode } = await loadContract();
  for (const profile of predicateNode.profiles) {
    assert.equal(profile.polarity.length, 2, profile.source);
    assert.ok(profile.polarity.every(value => value >= -1 && value <= 1), profile.source);
    assert.ok(profile.hierarchy >= -1 && profile.hierarchy <= 1, profile.source);
    assert.ok(profile.permanence >= 0 && profile.permanence <= 1, profile.source);
    assert.equal("weight" in profile, false, profile.source);
    assert.equal("energy" in profile, false, profile.source);
    assert.ok(["axis_dominant", "composite", "semantic_required"].includes(profile.mode), profile.source);
    assert.ok(profile.synthesis?.includes("{a}") || profile.synthesis?.includes("{b}"), profile.source);
  }
});

test("BLOCKS porte une inhibition directionnelle sans devenir une étiquette numérique", async () => {
  const { mapping, predicateNode } = await loadContract();
  const contract = mapping.nodes.find(node => node.id === "l4-translation-contract");
  const example = mapping.nodes.find(node => node.id === "l4-blocks-translation-example");
  const blocks = predicateNode.profiles.find(profile => profile.source === "BLOCKS");

  assert.deepEqual(blocks.polarity, [-0.8, 0]);
  assert.equal(blocks.hierarchy, 0);
  assert.equal(blocks.permanence, 0.7);
  assert.equal(blocks.mode, "composite");
  assert.equal(example.translationStatus, "physical_effect_representable_semantic_role_required");
  assert.equal(contract.translationRules.exactNumericEqualityIsMeaning, false);
  assert.equal(predicateNode.decoderPolicy.returnAmbiguousOnCollision, true);
});

test("la nouvelle physique sépare état, temps et conditionalité", async () => {
  const { mapping } = await loadContract();
  const contract = mapping.nodes.find(node => node.id === "l4-translation-contract");
  const physics = mapping.nodes.find(node => node.id === "l4-signed-conditional-temporal-physics");
  const propagation = mapping.nodes.find(node => node.id === "l4-physical-propagation-rule");

  assert.equal(mapping.mappingVersion, "0.4.0");
  assert.equal(physics.dimensions.polarity.range, "[-1,1] x [-1,1]");
  assert.equal(physics.dimensions.gate.kind, "behaviour_interface");
  assert.match(contract.translationRules.conditionalityContract, /sous-graphe/);
  assert.match(propagation.equation, /P_ab\*G\(t\)/);
});

// Le noyau ne se défend pas par son élégance mais par le coût qu'il impose. Une
// dimension qui ne sait pas dire pourquoi tous les liens la paient a échoué au
// second volet du critère, et ce test refuse qu'on en réintroduise une.
test("les sept champs conservés justifient chacun le coût qu ils imposent à tous les liens", async () => {
  const { mapping } = await loadContract();
  const physics = mapping.nodes.find(node => node.id === "l4-signed-conditional-temporal-physics");
  const terms = new Map(mapping.nodes.filter(node => (node.semanticType || node.nodeType) === "terme").map(node => [node.id, node]));

  assert.deepEqual(Object.keys(physics.dimensions).sort(),
    ["energy", "gate", "hierarchy", "permanence", "polarity", "stability", "weight"]);
  for (const [name, dimension] of Object.entries(physics.dimensions)) {
    const term = terms.get(dimension.term);
    assert.ok(term.coreJustification?.length > 60, `${name} ne dit pas pourquoi tous les liens la paient`);
  }
  assert.equal(physics.derivedCaches.recency.kind, "derived_cache");
  assert.equal("recency" in physics.dimensions, false, "un cache n est pas une dimension");
  assert.match(mapping.admissionCriterion, /deux volets/);
});

// Descendre n'est pas supprimer : delay et duration gardent leur terme, leur
// paire séparée et le motif de leur descente, sinon le graphe oublierait qu'on
// a jugé leur cas plutôt que de les avoir ignorées.
test("delay et duration descendent au comportement sans perdre leur trace", async () => {
  const { mapping } = await loadContract();
  const physics = mapping.nodes.find(node => node.id === "l4-signed-conditional-temporal-physics");
  const contract = mapping.nodes.find(node => node.id === "l4-translation-contract");
  const propagation = mapping.nodes.find(node => node.id === "l4-physical-propagation-rule");
  const example = mapping.nodes.find(node => node.id === "l4-blocks-translation-example");

  for (const name of ["delay", "duration"]) {
    assert.equal(name in physics.dimensions, false, `${name} est encore une dimension`);
    assert.equal(contract.translationRules.prototypeFields.includes(name), false);
    assert.ok(contract.translationRules.behaviourFields.includes(name));
    assert.equal(name in example.prototype, false);
    const demotion = mapping.demotedDimensions.find(entry => entry.name === name);
    assert.equal(demotion?.to, "comportement porté par un routeur");
    const term = mapping.nodes.find(node => node.id === `terme-dimension-${name}`);
    assert.ok(term.separationTest?.trim(), `${name} a perdu la paire qu il séparait`);
    assert.ok(term.demotionJustification?.length > 60, `${name} ne dit pas pourquoi il descend`);
  }
  assert.doesNotMatch(propagation.equation, /delay|duration/);
  assert.match(contract.translationRules.gateContract, /interface/);
});

// Le critère d'admission n'a de valeur que s'il est appliqué. Un attribut qui ne
// nomme pas la paire qu'il sépare est un synonyme numérique déguisé : le test
// interdit d'en réintroduire un en silence.
test("chaque dimension du noyau possède un terme, une note d emploi et le test qu elle sépare", async () => {
  const { mapping } = await loadContract();
  const physics = mapping.nodes.find(node => node.id === "l4-signed-conditional-temporal-physics");
  const terms = new Map(mapping.nodes.filter(node => (node.semanticType || node.nodeType) === "terme").map(node => [node.id, node]));

  assert.ok(terms.size >= Object.keys(physics.dimensions).length);
  for (const [name, dimension] of Object.entries(physics.dimensions)) {
    const term = terms.get(dimension.term);
    assert.ok(term, `${name} n a pas de terme`);
    assert.equal(term.name, name);
    assert.equal(term.definitionStatus, "defined");
    assert.ok(term.definition?.trim(), `${name} n a pas de définition`);
    assert.ok(term.context?.trim(), `${name} n a pas de note d emploi`);
    assert.ok(term.separationTest?.trim(), `${name} ne dit pas ce qu il sépare`);
    assert.ok(term.justification?.length > 60, `${name} n est pas justifié`);
    assert.ok(term.example?.trim(), `${name} n a pas d exemple`);
    assert.equal(typeof dimension.writable, "boolean", `${name} ne dit pas s il est écrivable`);
  }
  for (const term of terms.values()) {
    const defines = mapping.links.some(link => link.source === term.id && link.type === "DEFINES");
    assert.ok(defines, `${term.id} ne définit rien`);
  }
});

// Friction était weight sous un autre nom : deux scalaires de [0,1] multipliés
// dans la même loi, sans loi d'évolution distincte. La supprimer sans garder la
// trace de la non-linéarité qu'elle masquait rendrait la loi faussement complète.
test("friction est supprimée et la non-linéarité qu elle masquait reste une question ouverte", async () => {
  const { mapping } = await loadContract();
  const physics = mapping.nodes.find(node => node.id === "l4-signed-conditional-temporal-physics");
  const propagation = mapping.nodes.find(node => node.id === "l4-physical-propagation-rule");
  const contract = mapping.nodes.find(node => node.id === "l4-translation-contract");
  const example = mapping.nodes.find(node => node.id === "l4-blocks-translation-example");

  assert.equal("friction" in physics.dimensions, false);
  assert.equal("friction" in example.prototype, false);
  assert.equal(contract.translationRules.prototypeFields.includes("friction"), false);
  assert.doesNotMatch(propagation.equation, /F\(t\)/);
  assert.equal(mapping.removedDimensions.find(entry => entry.name === "friction")?.residualQuestion,
    "question-l4-activation-threshold");

  const threshold = mapping.nodes.find(node => node.id === "question-l4-activation-threshold");
  assert.equal(threshold?.semanticType || threshold?.nodeType, "open_question");
  assert.ok(mapping.links.some(link =>
    link.source === "question-l4-activation-threshold"
      && link.target === "l4-physical-propagation-rule"
      && link.type === "BLOCKS"));
});

// Recency ne sépare rien : elle se recalcule depuis last_traversed_at_s. La
// garder écrivable ferait coexister deux vérités sur le même lien.
test("recency est rétrogradée en cache dérivé plutôt que supprimée", async () => {
  const { mapping } = await loadContract();
  const physics = mapping.nodes.find(node => node.id === "l4-signed-conditional-temporal-physics");
  const contract = mapping.nodes.find(node => node.id === "l4-translation-contract");
  const term = mapping.nodes.find(node => node.id === "terme-dimension-recency");

  assert.equal(physics.derivedCaches.recency.kind, "derived_cache");
  assert.equal(physics.derivedCaches.recency.writable, false);
  assert.equal(physics.derivedCaches.recency.derivedFrom, "last_traversed_at_s");
  assert.equal(contract.translationRules.dynamicFields.includes("recency"), false);
  assert.ok(contract.translationRules.derivedReadOnlyFields.includes("recency"));
  assert.match(term.separationTest, /^Aucune/);
  assert.equal(mapping.demotedDimensions.find(entry => entry.name === "recency")?.to,
    "grandeur dérivée en lecture seule");
});

test("une réponse de fond clôt le gap signé mais la preuve de Turing reste ouverte", async () => {
  const { mapping } = await loadContract();
  const signedAnswer = mapping.links.find(link =>
    link.source === "l4-signed-conditional-temporal-physics"
      && link.target === "question-l4-signed-opposition-axis"
  );
  const turingBlock = mapping.links.find(link =>
    link.source === "question-l4-turing-completeness-proof"
      && link.target === "hypothesis-query-physical-grammar-suffices"
  );

  assert.equal(signedAnswer?.type, "ADDRESSES");
  assert.equal(turingBlock?.type, "BLOCKS");
});
