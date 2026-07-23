// Interroger le graphe, c'est le parcourir — donc y injecter de l'énergie.
// La requête est la seule pompe qui vienne de l'extérieur : un détecteur ne voit
// que les trous qu'on l'a programmé à reconnaître, un parcours dit ce dont
// quelqu'un a réellement eu besoin. On n'enregistre pas la question, seulement le
// chemin : le moteur d'énergie n'a pas à savoir ce qui a été demandé.
import fs from "node:fs/promises";
import path from "node:path";
import { buildGraphQueryEngine } from "../public/graph-query.js";
import { projectDir } from "../src/graph-manifest.js";
import { L4_PHYSICS_TUNING } from "../src/l4-physics.js";

const question = process.argv.slice(2).join(" ") || "Pourquoi la simulation économique à l’échelle d’une ville est-elle importante ?";
const response = await fetch(process.env.GRAPH_API_URL || "http://localhost:4173/api/graph");
if (!response.ok) throw new Error(`Graph API: ${response.status} ${response.statusText}`);
const graph = await response.json();
const engine = buildGraphQueryEngine(graph.nodes, graph.links);
const result = engine.query(question);
console.log(`Question: ${question}`);
console.log(`Moteur: ${result.metadata.kind}, ${result.metadata.documents} nœuds actifs`);
console.log(`Cluster: ${result.nodes.length} nœuds, ${result.links.length} relations`);
for (const [index, item] of result.results.entries()) {
  console.log(`${index + 1}. ${(item.score * 100).toFixed(1)}% — ${item.name} [${item.path.join(" → ")}]`);
}

if (!process.argv.includes("--no-inject")) {
  const nodeIds = result.nodes.map(node => node.id);
  // Le montant n'est pas câblé : c'est le paramètre déclaré queryInjection, seule
  // source de vérité. L'événement le recopie pour rester auto-décrivant face à un
  // runner qui tourne dans un autre process — mais la valeur vient du TUNING, pas
  // d'un littéral qui dériverait en silence si le paramètre changeait.
  const amount = L4_PHYSICS_TUNING.parameters.queryInjection.value;
  const target = path.resolve(projectDir, "artifacts/l4/injections.jsonl");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.appendFile(target, `${JSON.stringify({ nodeIds, amount })}\n`, "utf8");
  console.log(`Énergie ${amount} déposée sur ${nodeIds.length} nœuds parcourus (artifacts/l4/injections.jsonl).`);
}
