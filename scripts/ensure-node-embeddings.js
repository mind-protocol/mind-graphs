// Garantit qu'aucun nœud ne reste sans embedding.
//
// Un nœud sans vecteur n'est pas seulement incomplet : il est invisible pour
// tout ce qui raisonne dans l'espace sémantique — routage d'intention, score de
// lien, champ attentionnel des sous-entités, carte du cerveau. Le placer
// quelque part malgré tout reviendrait à inventer sa position. Ce script
// supprime ce trou et rend l'absence détectable.
//
// Usage :
//   node scripts/ensure-node-embeddings.js --all
//   node scripts/ensure-node-embeddings.js --graph=mind_causal
//   node scripts/ensure-node-embeddings.js --all --check     (n'écrit rien, sort 1 s'il manque un vecteur)
//   node scripts/ensure-node-embeddings.js --all --force     (recalcule tout)
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getClient, getGraphByName } from "../src/db.js";
import { LOCAL_EMBEDDING_MODEL, createLocalEmbedder, nodeText } from "../src/local-embedding.js";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const valueOf = name => process.argv.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const check = process.argv.includes("--check");
const force = process.argv.includes("--force");
const all = process.argv.includes("--all");
const requested = valueOf("graph");
const batchSize = Number(valueOf("batch") || 200);

if (!all && !requested) {
  throw new Error("Usage: node scripts/ensure-node-embeddings.js --all | --graph=<falkorGraph> [--check] [--force]");
}

// Champs qui composent la surface textuelle d'un nœud. Ils sont lus
// explicitement : `properties(n)` remonterait des dizaines de champs inutiles
// sur 4 600 nœuds.
const TEXT_FIELDS = ["name", "phrase", "summary", "description", "definition", "semanticType", "family", "stateDimension", "stateIndicator"];

async function resolveGraphNames() {
  if (requested) return [requested];
  const manifest = JSON.parse(await readFile(path.join(projectDir, "graphs.json"), "utf8"));
  return manifest.graphs.filter(graph => graph.status === "active" && graph.falkorGraph).map(graph => graph.falkorGraph);
}

/** Nœuds dont le vecteur est absent, ou produit par un autre modèle que le modèle courant. */
async function readStaleNodes(graph) {
  const projection = TEXT_FIELDS.map(field => `${field}: n.${field}`).join(", ");
  const condition = force
    ? "true"
    : "n.embedding IS NULL OR n.embeddingModel <> $model OR n.embeddingModelVersion <> $version";
  const result = await graph.roQuery(`
    MATCH (n)
    WHERE ${condition}
    RETURN n.id AS id, {${projection}} AS text
  `, { params: { model: LOCAL_EMBEDDING_MODEL.id, version: LOCAL_EMBEDDING_MODEL.version } });
  return (result.data || []).filter(row => row.id);
}

async function countNodes(graph) {
  const result = await graph.roQuery("MATCH (n) RETURN count(n) AS total");
  return Number(result.data?.[0]?.total || 0);
}

async function writeEmbeddings(graph, rows) {
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    await graph.query(`
      UNWIND $rows AS row
      MATCH (n {id: row.id})
      SET n.embedding = row.embedding,
          n.embeddingModel = $model,
          n.embeddingModelVersion = $version,
          n.embeddingDimensions = $dimensions
    `, { params: {
      rows: rows.slice(offset, offset + batchSize),
      model: LOCAL_EMBEDDING_MODEL.id,
      version: LOCAL_EMBEDDING_MODEL.version,
      dimensions: LOCAL_EMBEDDING_MODEL.dimensions
    } });
  }
}

const embed = createLocalEmbedder();
const report = [];
let missingAfterwards = 0;

for (const graphName of await resolveGraphNames()) {
  let graph;
  try {
    graph = await getGraphByName(graphName);
  } catch (error) {
    report.push({ graph: graphName, status: "unreachable", error: error.message });
    continue;
  }
  try {
    const total = await countNodes(graph);
    if (!total) {
      report.push({ graph: graphName, status: "empty", total: 0, stale: 0, embedded: 0, textless: 0 });
      continue;
    }
    const stale = await readStaleNodes(graph);

    // Un nœud sans aucun texte ne peut pas recevoir un vecteur honnête : le
    // hasher produirait un point sur la carte sans contenu derrière. Il est
    // signalé, pas rempli.
    const withText = [];
    const textless = [];
    for (const row of stale) {
      const text = nodeText(row.text || {});
      if (text.trim()) withText.push({ id: row.id, text });
      else textless.push(row.id);
    }

    const embedded = await Promise.all(withText.map(async row => ({ id: row.id, embedding: await embed(row.text) })));
    if (!check && embedded.length) await writeEmbeddings(graph, embedded);

    const remaining = check ? stale.length : textless.length;
    missingAfterwards += remaining;
    report.push({
      graph: graphName,
      status: check ? (stale.length ? "incomplete" : "complete") : "written",
      total,
      stale: stale.length,
      embedded: check ? 0 : embedded.length,
      textless: textless.length,
      textlessSample: textless.slice(0, 5)
    });
  } catch (error) {
    missingAfterwards += 1;
    report.push({ graph: graphName, status: "failed", error: error.message });
  }
}

await (await getClient()).close();

console.log(JSON.stringify({
  mode: check ? "check" : force ? "force" : "backfill",
  model: LOCAL_EMBEDDING_MODEL,
  graphs: report,
  nodesWithoutEmbedding: missingAfterwards
}, null, 2));

// Le mode --check est une garantie : il échoue si un nœud reste sans vecteur.
if (check && missingAfterwards) process.exitCode = 1;
if (!check && report.some(entry => entry.status === "failed")) process.exitCode = 1;
