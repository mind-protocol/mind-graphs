// Régénère les compteurs de corpus et d'ontologie dans README.md et DOCUMENTATION.md
// à partir de la source de vérité. La composition du corpus vient de `graphs.json`,
// comme pour le seed et le validateur : un fichier non déclaré n'est plus compté.
//
//   node scripts/docs-stats.js          → affiche les compteurs et met à jour les docs
//   node scripts/docs-stats.js --check  → échoue (code 1) si une doc est périmée, sans écrire
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadManifest, selectGraph, loadOntology, readDatasets, datasetNodes, datasetLinks
} from "../src/graph-manifest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const checkOnly = process.argv.includes("--check");

async function computeStats() {
  const manifest = await loadManifest();
  const graphConfig = selectGraph(manifest, "design");
  const datasets = await readDatasets(graphConfig);
  let nodes = 0;
  let links = 0;
  for (const entry of datasets) {
    nodes += datasetNodes(entry).length;
    links += datasetLinks(entry).length;
  }
  const ontology = await loadOntology(graphConfig);
  const relationFamilies = ontology.relationFamilies?.length ?? new Set(ontology.relationTypes.map(type => type.family)).size;
  return {
    schemaVersion: ontology.schemaVersion,
    nodes,
    links,
    nodeTypes: ontology.nodeTypes.length,
    relationFamilies,
    activePredicates: ontology.relationTypes.filter(type => type.status === "active").length,
    reservedPredicates: ontology.relationTypes.filter(type => type.status === "reserved").length
  };
}

function updateDocumentation(text, stats) {
  const rows = [
    ["Nœuds actifs", stats.nodes],
    ["Relations actives", stats.links],
    ["Types de nœuds", stats.nodeTypes],
    ["Familles de relations", stats.relationFamilies],
    ["Prédicats actifs", stats.activePredicates],
    ["Prédicats réservés", stats.reservedPredicates]
  ];
  let next = text;
  for (const [label, value] of rows) {
    const pattern = new RegExp(`(\\| ${label} \\| )\\d+( \\|)`);
    next = next.replace(pattern, `$1${value}$2`);
  }
  return next;
}

function updateReadme(text, stats) {
  return text.replace(
    /l’ontologie `[^`]+`, qui distingue \d+ types de nœuds, \d+ familles de relations et \d+ prédicats actifs/,
    `l’ontologie \`${stats.schemaVersion}\`, qui distingue ${stats.nodeTypes} types de nœuds, ${stats.relationFamilies} familles de relations et ${stats.activePredicates} prédicats actifs`
  );
}

const stats = await computeStats();
console.log("Corpus actif :");
console.log(`  ${stats.nodes} nœuds · ${stats.links} relations`);
console.log(`  ontologie ${stats.schemaVersion} · ${stats.nodeTypes} types · ${stats.relationFamilies} familles · ${stats.activePredicates} prédicats actifs · ${stats.reservedPredicates} réservés`);

const targets = [
  { file: path.join(root, "DOCUMENTATION.md"), update: updateDocumentation },
  { file: path.join(root, "README.md"), update: updateReadme }
];

let stale = false;
for (const { file, update } of targets) {
  const current = await fs.readFile(file, "utf8");
  const next = update(current, stats);
  if (next === current) continue;
  stale = true;
  if (checkOnly) {
    console.error(`Périmé : ${path.basename(file)}`);
  } else {
    await fs.writeFile(file, next);
    console.log(`Mis à jour : ${path.basename(file)}`);
  }
}

if (checkOnly && stale) {
  console.error("Documentation périmée. Lance `npm run docs:stats` pour la régénérer.");
  process.exit(1);
}
if (!stale) console.log("Documentation déjà à jour.");
