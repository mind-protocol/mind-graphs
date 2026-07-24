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
import { getGraphByName } from "./db.js";
import { loadManifest, projectDir } from "./graph-manifest.js";
import { L4_PHYSICS_TUNING } from "./l4-physics.js";
import { loadCorpus } from "./corpus.js";
import { formatMoveResult, moveToSpace } from "./graph-move.js";
import { formatL1BlueprintSync, syncDeclaredL1Blueprints } from "./l1-blueprint-sync.js";
import {
  formatL1TaskReport,
  formatNextL1TaskWake,
  getNextL1TaskWake,
  reportL1TaskWake
} from "./l1-task-engine.js";
import {
  CONVERSATION_STIMULUS_DEFAULTS,
  formatConversationStimulus,
  formatThought,
  stimulateConversationBlock,
  think
} from "./l1-conversation-stimulus.js";

const GRAPH_API_URL = process.env.GRAPH_API_URL || "http://localhost:4173/api/graph";
const injectionsPath = path.resolve(projectDir, "artifacts/l4/injections.jsonl");
const statePath = path.resolve(projectDir, "artifacts/l4/physics-state.json");
const QUERY_AMOUNT = L4_PHYSICS_TUNING.parameters.queryInjection.value;

// Le graphe est chargé par graphId puis mémorisé dans un Map.
const enginePromises = new Map();
async function getEngine(graphId = "design") {
  const key = graphId || "design";
  if (!enginePromises.has(key)) {
    const promise = (async () => {
      try {
        const targetUrl = key === "design" ? GRAPH_API_URL : `${GRAPH_API_URL}?graphId=${encodeURIComponent(key)}`;
        const response = await fetch(targetUrl);
        if (response.ok) {
          const graph = await response.json();
          if (graph.nodes && graph.links) {
            return { engine: buildGraphQueryEngine(graph.nodes, graph.links), size: graph.nodes.length };
          }
        }
      } catch {
        // En cas d'erreur API, repli sur le chargement direct du corpus déclaré
      }
      const { nodes, links } = await loadCorpus(key);
      return { engine: buildGraphQueryEngine(nodes, links), size: nodes.length };
    })().catch(err => {
      enginePromises.delete(key);
      throw err;
    });
    enginePromises.set(key, promise);
  }
  return enginePromises.get(key);
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

const graphQuestionSchema = {
  title: "Demander au graphe causal",
  description:
    "Pose une question à un graphe de Mind Protocol par similarité sémantique locale. "
    + "Renvoie le cluster pertinent et injecte l'énergie L4 sur les nœuds parcourus.",
  inputSchema: {
    question: z.string().min(1).describe("La question, en langage naturel."),
    graphId: z.string().min(1).default("design").describe("Identifiant du graphe déclaré dans graphs.json (défaut : 'design').")
  }
};

async function answerGraphQuestion({ question, graphId = "design" }) {
  let engine;
  try {
    ({ engine } = await getEngine(graphId));
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: `Graphe "${graphId}" injoignable : ${err.message}. Lance le serveur (npm start) puis réessaie.` }]
    };
  }
  const result = engine.query(question);
  const nodeIds = result.nodes.map(node => node.id);
  await injectPath(nodeIds);

  const top = result.results.slice(0, 8)
    .map((item, i) => `${i + 1}. ${(item.score * 100).toFixed(1)}% — ${item.name}  [${item.path.join(" → ")}]`)
    .join("\n");
  const text =
    `Graphe : ${graphId}\n`
    + `Cluster pertinent : ${result.nodes.length} nœuds, ${result.links.length} relations `
    + `(moteur ${result.metadata.kind}, ${result.metadata.documents} nœuds actifs).\n\n${top || "(aucun résultat)"}\n\n`
    + `Énergie ${QUERY_AMOUNT} déposée sur ${nodeIds.length} nœuds parcourus — visible en live sur /l4-live.html.`;
  return { content: [{ type: "text", text }] };
}

server.registerTool("ask_graph", graphQuestionSchema, answerGraphQuestion);

// Alias conservé pour les clients MCP déjà configurés.
server.registerTool("query_graph", graphQuestionSchema, answerGraphQuestion);

async function resolveFalkorGraphName(graphId = "design") {
  if (typeof graphId === "string" && /^[A-Za-z0-9_-]+$/.test(graphId)) {
    try {
      const manifest = await loadManifest();
      const graphSpec = manifest.graphs.find(g => g.id === graphId || g.falkorGraph === graphId);
      if (graphSpec && graphSpec.falkorGraph) return graphSpec.falkorGraph;
    } catch {
      // Si graphs.json n'est pas accessible, repli sur le nom nettoyé
    }
    return graphId.replace(/-/g, "_");
  }
  return "mind_causal";
}

const cypherQuestionSchema = {
  title: "Exécuter une requête Cypher sur le graphe",
  description:
    "Exécute une requête Cypher sur la base FalkorDB d'un graphe de Mind Protocol (ex: design, science, l1-nlr-ai, l2-mind-graphs, l3-ecosystem, l4-registry, l4-kernel).",
  inputSchema: {
    cypher: z.string().min(1).describe("La requête Cypher à exécuter (ex: MATCH (n:MindNode) RETURN n.id, n.name LIMIT 10)."),
    graphId: z.string().min(1).default("design").describe("Identifiant du graphe déclaré dans graphs.json ou nom de la base FalkorDB."),
    params: z.record(z.any()).optional().describe("Paramètres de la requête Cypher."),
    readOnly: z.boolean().default(true).describe("Si true, la requête est exécutée en lecture seule (roQuery).")
  }
};

async function executeCypherGraph({ cypher, graphId = "design", params = {}, readOnly = true }) {
  const falkorName = await resolveFalkorGraphName(graphId);
  try {
    const graph = await getGraphByName(falkorName);
    const options = params && Object.keys(params).length > 0 ? { params } : {};
    const result = readOnly ? await graph.roQuery(cypher, options) : await graph.query(cypher, options);
    const data = result.data || [];
    const text = `Exécution Cypher sur '${graphId}' (base '${falkorName}') — ${data.length} résultat(s) :\n\n`
      + (data.length > 0 ? JSON.stringify(data, null, 2) : "(aucun résultat)");
    return {
      content: [{ type: "text", text }],
      structuredContent: { graphId, falkorGraph: falkorName, cypher, count: data.length, data }
    };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: `Erreur d'exécution Cypher sur '${graphId}' (base '${falkorName}') : ${err.message}` }]
    };
  }
}

server.registerTool("cypher_graph", cypherQuestionSchema, executeCypherGraph);
server.registerTool("cypher-graph", cypherQuestionSchema, executeCypherGraph);

server.registerTool(
  "think",
  {
    title: "Remettre un sujet sous mon attention",
    description:
      "S'adresse automatiquement au Citizen AI courant : le message devient un stimulus personnel persisté, "
      + "déclenche des micro-ticks bornés jusqu'à stabilité et retourne le Global Workspace. "
      + "Cette opération modifie l'attention runtime, mais ne crée aucun lien sémantique durable.",
    inputSchema: {
      message: z.string().min(1).describe("Sujet ou contenu que le Citizen veut remettre sous sa propre attention.")
    }
  },
  async ({ message }) => {
    try {
      const result = await think(message);
      return {
        content: [{ type: "text", text: formatThought(result) }],
        structuredContent: result
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: `Pensée impossible : ${err.message}` }]
      };
    }
  }
);

server.registerTool(
  "stimulate_conversation_block",
  {
    title: "Injecter un bloc de conversation dans la cognition L1",
    description:
      "Transforme un bloc en stimulus, route un budget sensoriel fini vers le contexte L1, exécute des micro-ticks bornés puis renvoie le Global Workspace. "
      + "L'embedding active du contexte mais ne crée jamais à lui seul une identité ou un lien sémantique. apply=false simule sans persister.",
    inputSchema: {
      graphId: z.string().min(1).default(CONVERSATION_STIMULUS_DEFAULTS.graphId),
      conversationId: z.string().min(1),
      blockId: z.string().min(1),
      content: z.string().min(1),
      sourceArtifact: z.string().min(1).optional(),
      sourceLocator: z.string().min(1).optional(),
      consentId: z.string().min(1).optional(),
      speakerRole: z.enum(["human", "citizen_ai", "third_party", "unknown"]).default("unknown"),
      occurredAt: z.string().datetime({ offset: true }).optional(),
      timestampBasis: z.enum(["source", "inferred", "unknown"]).default("unknown"),
      recordedAt: z.string().datetime({ offset: true }).optional(),
      sensoryEnergyBudget: z.number().nonnegative().default(CONVERSATION_STIMULUS_DEFAULTS.sensoryEnergyBudget),
      minSimilarity: z.number().min(0).max(1).default(CONVERSATION_STIMULUS_DEFAULTS.minSimilarity),
      topK: z.number().int().positive().default(CONVERSATION_STIMULUS_DEFAULTS.topK),
      characterBudget: z.number().int().positive().default(CONVERSATION_STIMULUS_DEFAULTS.characterBudget),
      maxMicroTicks: z.number().int().positive().default(CONVERSATION_STIMULUS_DEFAULTS.maxMicroTicks),
      requiredQuietTicks: z.number().int().positive().default(CONVERSATION_STIMULUS_DEFAULTS.requiredQuietTicks),
      apply: z.boolean().default(false)
    }
  },
  async args => {
    try {
      const result = await stimulateConversationBlock({
        ...args,
        recordedAt: args.recordedAt || new Date().toISOString()
      });
      return {
        content: [{ type: "text", text: formatConversationStimulus(result) }],
        structuredContent: result
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: `Injection cognitive impossible : ${err.message}` }]
      };
    }
  }
);

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
  "next_l1_task_wake",
  {
    title: "Choisir le prochain réveil de tâche L1",
    description:
      "Découvre dynamiquement les objectifs actifs d'une L1 et choisit celui qui est prêt avec l'échéance la plus proche. "
      + "Aucun identifiant de tâche, rôle ou cadence n'est codé dans le moteur.",
    inputSchema: {
      graphId: z.string().min(1).optional().describe("L1 déclarée dans graphs.json. Facultatif lorsqu'une seule L1 est active."),
      now: z.string().datetime({ offset: true }).optional().describe("Instant d'évaluation ISO. Par défaut : maintenant.")
    }
  },
  async ({ graphId, now }) => {
    try {
      const result = await getNextL1TaskWake({ graphId: graphId || null, now: now || new Date().toISOString() });
      return { content: [{ type: "text", text: formatNextL1TaskWake(result) }], structuredContent: result };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: `Réveil L1 impossible : ${err.message}` }] };
    }
  }
);

server.registerTool(
  "report_l1_task_wake",
  {
    title: "Consigner le résultat d'un réveil de tâche L1",
    description:
      "Ajoute une observation append-only, met à jour le prochain réveil choisi par le Citizen AI et produit un payload Telegram obligatoire si le résultat est blocked. "
      + "Le client MCP doit alors transmettre notification.message avec mcp__mind.send.",
    inputSchema: {
      graphId: z.string().min(1).optional().describe("L1 déclarée dans graphs.json. Facultatif lorsqu'une seule L1 est active."),
      objectiveId: z.string().min(1).describe("Identifiant de l'objectif découvert par next_l1_task_wake."),
      outcome: z.enum(["progressed", "completed", "blocked"]),
      summary: z.string().min(1).describe("Résultat factuel du réveil."),
      reportedAt: z.string().datetime({ offset: true }).optional(),
      nextWakeAt: z.string().datetime({ offset: true }).optional().describe("Obligatoire après progressed ou blocked ; après blocked, garantit un nouveau réveil au lieu d'une veille silencieuse."),
      blockerCause: z.string().min(1).optional(),
      attemptedActions: z.array(z.string().min(1)).optional(),
      remainingOptions: z.array(z.string().min(1)).optional(),
      needsFromCitizen: z.string().min(1).optional(),
      evidence: z.array(z.string().min(1)).default([])
    }
  },
  async args => {
    try {
      const result = await reportL1TaskWake({ ...args, graphId: args.graphId || null });
      return { content: [{ type: "text", text: formatL1TaskReport(result) }], structuredContent: result };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: `Rapport de réveil impossible : ${err.message}` }] };
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
