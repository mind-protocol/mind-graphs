import path from "node:path";
import { activeGraphs, loadManifest, projectDir } from "./graph-manifest.js";
import { getGraphByName } from "./db.js";

const CODE_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".cs", ".css", ".go", ".h", ".hpp", ".html",
  ".java", ".js", ".jsx", ".kt", ".mjs", ".php", ".py", ".rb", ".rs",
  ".scss", ".sh", ".sql", ".svelte", ".swift", ".ts", ".tsx", ".vue"
]);

export function normalizeCodePath(filePath, root = projectDir) {
  if (typeof filePath !== "string" || !filePath.trim()) throw new Error("filePath must be a non-empty string");
  const absolute = path.resolve(root, filePath.trim());
  const relative = path.relative(root, absolute);
  const selected = relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : absolute;
  return selected.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

export function isCodePath(filePath) {
  return CODE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function normalizeStoredPath(filePath) {
  return String(filePath || "").trim().replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

function nodeProjection(prefix) {
  return `${prefix}.id AS id, ${prefix}.name AS name, ${prefix}.nodeType AS nodeType, `
    + `${prefix}.semanticType AS semanticType, ${prefix}.sourcePath AS sourcePath, `
    + `${prefix}.summary AS summary, ${prefix}.phrase AS phrase, ${prefix}.status AS status, `
    + `${prefix}.epistemicStatus AS epistemicStatus, ${prefix}.clusterId AS clusterId`;
}

async function augmentFromGraph(graphConfig, normalizedPath, maxDepth, selectGraph) {
  const graph = await selectGraph(graphConfig.falkorGraph);
  const candidates = await graph.roQuery(`
    MATCH (anchor)
    WHERE toLower(anchor.nodeType) = 'thing' AND anchor.sourcePath <> ''
    RETURN ${nodeProjection("anchor")}
  `);
  const anchors = candidates.data.filter(node => normalizeStoredPath(node.sourcePath) === normalizedPath);
  if (!anchors.length) return null;

  const ids = anchors.map(node => node.id);
  const neighbors = await graph.roQuery(`
    MATCH p=(anchor)-[*1..${maxDepth}]-(context)
    WHERE anchor.id IN $anchorIds
    RETURN ${nodeProjection("context")}, min(length(p)) AS depth
    ORDER BY depth, name
  `, { params: { anchorIds: ids } });

  return { graphId: graphConfig.id, database: graphConfig.falkorGraph, anchors, nodes: neighbors.data };
}

export async function augmentCodeContext({
  filePath,
  enabled = true,
  maxDepth = 1,
  root = projectDir,
  manifest,
  selectGraph = getGraphByName
}) {
  const normalizedPath = normalizeCodePath(filePath, root);
  if (!enabled) return { enabled: false, filePath: normalizedPath, graphs: [] };
  if (!isCodePath(filePath)) return { enabled: true, skipped: "not_code", filePath: normalizedPath, graphs: [] };

  const depth = Math.max(1, Math.min(3, Math.trunc(Number(maxDepth) || 1)));
  const resolvedManifest = manifest || await loadManifest();
  const graphConfigs = activeGraphs(resolvedManifest);
  const results = await Promise.allSettled(graphConfigs.map(graphConfig =>
    augmentFromGraph(graphConfig, normalizedPath, depth, selectGraph)
  ));
  const graphs = results.flatMap(result => result.status === "fulfilled" && result.value ? [result.value] : []);
  const errors = results.flatMap((result, index) => result.status === "rejected"
    ? [{ graphId: graphConfigs[index].id, message: result.reason?.message || String(result.reason) }]
    : []);

  return { enabled: true, filePath: normalizedPath, maxDepth: depth, graphs, errors };
}

export function formatCodeContext(result) {
  if (!result.enabled) return `Augmentation désactivée pour ${result.filePath}.`;
  if (result.skipped === "not_code") return `${result.filePath} n'est pas un fichier de code : augmentation ignorée.`;
  if (!result.graphs.length) {
    const suffix = result.errors?.length ? ` ${result.errors.length} graphe(s) injoignable(s).` : "";
    return `Aucun Thing ne porte le chemin ${result.filePath}.${suffix}`;
  }

  const sections = result.graphs.map(({ graphId, database, anchors, nodes }) => {
    const anchorLines = anchors.map(node => `  - [ancre] ${node.name || node.id} (${node.id})`).join("\n");
    const contextLines = nodes.map(node => {
      const detail = node.summary || node.phrase || node.status || "sans description";
      return `  - [${node.depth} saut${node.depth > 1 ? "s" : ""}] ${node.name || node.id} (${node.id}) — ${detail}`;
    }).join("\n");
    return `${graphId} · ${database}\n${anchorLines}${contextLines ? `\n${contextLines}` : ""}`;
  });
  const errors = result.errors?.length
    ? `\n\nGraphes injoignables : ${result.errors.map(error => `${error.graphId} (${error.message})`).join(", ")}`
    : "";
  return `Contexte graphe avant modification de ${result.filePath} :\n\n${sections.join("\n\n")}${errors}`;
}
