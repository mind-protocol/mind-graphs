// Serveur MCP du graphe causal — la surface par laquelle un agent devient citoyen.
//
// Interroger le graphe, c'est le parcourir, donc y injecter de l'énergie. Chaque
// appel d'outil dépose le chemin réellement parcouru dans `artifacts/l4/injections.jsonl`,
// exactement comme `scripts/query-graph.js`. Le moteur L4 (`l4:watch`) draine ce
// journal, propage et refroidit ; la page live regarde le graphe chauffer là où
// il est réellement utilisé. Le citoyen n'est pas synthétique : c'est le client MCP.
//
// Contrainte stdio : stdout porte le protocole JSON-RPC. Aucun `console.log` ici —
// toute trace lisible par un humain part sur stderr.
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildGraphQueryEngine } from "../public/graph-query.js";
import { projectDir } from "./graph-manifest.js";
import { L4_PHYSICS_TUNING } from "./l4-physics.js";
import { augmentCodeContext, formatCodeContext } from "./code-context-augmentation.js";
import { formatMoveResult, moveToSpace } from "./graph-move.js";
import { relocateActorForCodeContext } from "./actor-location.js";
import { formatL1BlueprintSync, syncDeclaredL1Blueprints } from "./l1-blueprint-sync.js";

const GRAPH_API_URL = process.env.GRAPH_API_URL || "http://localhost:4173/api/graph";
const injectionsPath = path.resolve(projectDir, "artifacts/l4/injections.jsonl");
const statePath = path.resolve(projectDir, "artifacts/l4/physics-state.json");
const QUERY_AMOUNT = L4_PHYSICS_TUNING.parameters.queryInjection.value;

// Le graphe est chargé une fois puis mémorisé : le même corpus sert toutes les
// requêtes d'une session, et un agent qui n'interroge jamais ne paie pas le coût.
let enginePromise = null;
async function getEngine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      const response = await fetch(GRAPH_API_URL);
      if (!response.ok) throw new Error(`Graph API ${response.status} sur ${GRAPH_API_URL}`);
      const graph = await response.json();
      return { engine: buildGraphQueryEngine(graph.nodes, graph.links), size: graph.nodes.length };
    })().catch(err => { enginePromise = null; throw err; });
  }
  return enginePromise;
}

// Dépose le chemin parcouru. On n'enregistre pas la question, seulement les nœuds :
// le moteur d'énergie n'a pas à savoir ce qui a été demandé, juste ce qui a servi.
async function injectPath(nodeIds) {
  if (!nodeIds.length) return;
  await fs.mkdir(path.dirname(injectionsPath), { recursive: true });
  const event = { nodeIds, amount: QUERY_AMOUNT, atSeconds: Date.now() / 1000 };
  await fs.appendFile(injectionsPath, `${JSON.stringify(event)}\n`, "utf8");
}

const server = new McpServer({ name: "mind-causal-graph", version: "0.1.0" });

server.registerTool(
  "before_code_edit",
  {
    title: "Enrichir le contexte avant une modification de code",
    description:
      "À appeler avant de modifier un fichier de code. Cherche dans toutes les bases FalkorDB actives les nœuds Thing dont sourcePath correspond au chemin du fichier, "
      + "traverse leur voisinage local, puis place actor-nlr dans le Space contenant le Thing. enabled=false désactive explicitement ces deux effets.",
    inputSchema: {
      filePath: z.string().min(1).describe("Chemin absolu ou relatif du fichier qui va être modifié."),
      enabled: z.boolean().default(true).describe("Active ou désactive l'augmentation pour cette modification."),
      maxDepth: z.number().int().min(1).max(3).default(1).describe("Profondeur locale de traversée, entre 1 et 3 sauts.")
    }
  },
  async ({ filePath, enabled, maxDepth }) => {
    try {
      const result = await augmentCodeContext({ filePath, enabled, maxDepth });
      const locationUpdates = enabled && !result.skipped
        ? await relocateActorForCodeContext(result, { actorId: "actor-nlr" })
        : [];
      const enriched = { ...result, locationUpdates };
      const locationText = locationUpdates.length
        ? `\n\nLocation acteur : ${locationUpdates.map(update => update.moved
          ? `${update.actorId} → ${update.space.name || update.space.id}`
          : `${update.graphId}: ${update.reason}`).join(", ")}`
        : "";
      return {
        content: [{ type: "text", text: `${formatCodeContext(enriched)}${locationText}` }],
        structuredContent: enriched
      };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: `Augmentation impossible : ${err.message}` }] };
    }
  }
);

const graphQuestionSchema = {
  title: "Demander au graphe causal",
  description:
    "Pose une question au graphe causal de Mind Protocol par similarité sémantique locale. "
    + "Renvoie le cluster pertinent et injecte l'énergie L4 sur les nœuds parcourus.",
  inputSchema: { question: z.string().min(1).describe("La question, en langage naturel.") }
};

async function answerGraphQuestion({ question }) {
  let engine;
  try {
    ({ engine } = await getEngine());
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: `Graphe injoignable : ${err.message}. Lance le serveur (npm start) puis réessaie.` }]
    };
  }
  const result = engine.query(question);
  const nodeIds = result.nodes.map(node => node.id);
  await injectPath(nodeIds);

  const top = result.results.slice(0, 8)
    .map((item, i) => `${i + 1}. ${(item.score * 100).toFixed(1)}% — ${item.name}  [${item.path.join(" → ")}]`)
    .join("\n");
  const text =
    `Cluster pertinent : ${result.nodes.length} nœuds, ${result.links.length} relations `
    + `(moteur ${result.metadata.kind}, ${result.metadata.documents} nœuds actifs).\n\n${top}\n\n`
    + `Énergie ${QUERY_AMOUNT} déposée sur ${nodeIds.length} nœuds parcourus — visible en live sur /l4-live.html.`;
  return { content: [{ type: "text", text }] };
}

server.registerTool("ask_graph", graphQuestionSchema, answerGraphQuestion);

// Alias conservé pour les clients MCP déjà configurés.
server.registerTool("query_graph", graphQuestionSchema, answerGraphQuestion);

server.registerTool(
  "sync_l1_blueprint",
  {
    title: "Synchroniser le blueprint structurel vers les L1",
    description:
      "Compare le blueprint L1 versionné aux projections structurelles gérées des L1. Le dry-run est la valeur par défaut ; apply=true accepte explicitement la migration. Les contenus personnels ne sont ni écrasés ni supprimés.",
    inputSchema: {
      graphId: z.string().min(1).optional().describe("L1 déclarée dans graphs.json. Sans valeur, traite toutes les L1 configurées."),
      apply: z.boolean().default(false).describe("Applique explicitement la migration structurelle proposée.")
    }
  },
  async ({ graphId, apply }) => {
    try {
      const result = await syncDeclaredL1Blueprints({ graphId: graphId || null, apply });
      return { content: [{ type: "text", text: formatL1BlueprintSync(result) }], structuredContent: result };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: `Synchronisation impossible : ${err.message}` }] };
    }
  }
);

server.registerTool(
  "move",
  {
    title: "Déplacer un nœud vers un Space",
    description:
      "Détache tous les liens sortants d'un nœud qui ciblent des Space et les recrée vers newSpace, "
      + "en conservant le type et les propriétés de chaque lien. La cible doit être un Space du même graphe.",
    inputSchema: {
      nodeId: z.string().min(1).describe("Identifiant du nœud à déplacer."),
      newSpaceId: z.string().min(1).describe("Identifiant du nouveau Space."),
      graphId: z.string().min(1).default("design").describe("Identifiant déclaré dans graphs.json."),
      dryRun: z.boolean().default(false).describe("Prévisualise les liens concernés sans modifier FalkorDB.")
    }
  },
  async args => {
    try {
      const result = await moveToSpace(args);
      return {
        content: [{ type: "text", text: formatMoveResult(result) }],
        structuredContent: result
      };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: `Déplacement impossible : ${err.message}` }] };
    }
  }
);

server.registerTool(
  "l4_state",
  {
    title: "Lire l'état énergétique L4",
    description:
      "Renvoie où le graphe est actuellement chaud : énergie totale, énergie par cluster et liens les plus chauds. "
      + "Ne juge rien — dit seulement où l'attention s'est portée. Nécessite que le moteur tourne (npm run l4:watch).",
    inputSchema: {}
  },
  async () => {
    let state;
    try {
      state = JSON.parse(await fs.readFile(statePath, "utf8"));
    } catch {
      return { content: [{ type: "text", text: "Aucun état L4 : lance le moteur (npm run l4:watch), puis interroge le graphe." }] };
    }
    const s = state.summary || {};
    const clusters = (s.byCluster || []).map(c => `  ${c.cluster} : ${c.energy}`).join("\n");
    const hot = (s.hottest || []).slice(0, 8).map(h => `  ${h.energy}  ${h.link} (${h.type})`).join("\n");
    const text =
      `Tic ${s.tick} · énergie totale ${s.totalEnergy} · liens vivants ${s.liveLinks}/${s.links}.\n\n`
      + `Par cluster :\n${clusters || "  (froid)"}\n\nLiens les plus chauds :\n${hot || "  (froid)"}`;
    return { content: [{ type: "text", text }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`Serveur MCP mind-causal-graph prêt (stdio). Graphe : ${GRAPH_API_URL}`);
