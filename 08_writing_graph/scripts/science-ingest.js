import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { evaluateIngestionQuality } from "../src/science-ingestion-quality.js";
import { loadScienceCandidate } from "../src/science-candidate.js";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredStages = ["acquire", "parse", "structure", "atomize", "normalize", "resolve", "validate", "review", "commit"];

export async function buildCanonical(candidatePath) {
  const candidate = await loadScienceCandidate(projectDir, candidatePath);
  const errors = [];
  const ingestion = candidate.ingestion || {};
  const source = candidate.source || {};

  for (const field of ["id", "contributor", "contributionMethod", "version", "canonicalFile"]) {
    if (!ingestion[field]) errors.push(`ingestion misses ${field}`);
  }
  if (ingestion.reversible !== true) errors.push("ingestion must be reversible");
  if (JSON.stringify(ingestion.pipeline) !== JSON.stringify(requiredStages)) {
    errors.push(`pipeline must be ${requiredStages.join(" -> ")}`);
  }
  const completed = new Set(ingestion.completedStages || []);
  for (const stage of requiredStages.slice(0, -1)) if (!completed.has(stage)) errors.push(`stage ${stage} is not complete`);

  for (const field of ["id", "sourcePath", "sourceHash", "sourceUrl"]) if (!source[field]) errors.push(`source misses ${field}`);
  if (source.sourcePath) {
    try {
      const bytes = await fs.readFile(path.resolve(projectDir, source.sourcePath));
      const actual = createHash("sha256").update(bytes).digest("hex");
      if (actual.toLowerCase() !== String(source.sourceHash).toLowerCase()) errors.push(`source hash mismatch: expected ${source.sourceHash}, got ${actual}`);
    } catch {
      errors.push(`source artifact is missing: ${source.sourcePath}`);
    }
  }

  const nodes = candidate.nodes || [];
  const links = candidate.links || [];
  const ids = new Set();
  for (const node of nodes) {
    if (!node.id || ids.has(node.id)) errors.push(`invalid or duplicate node id ${node.id || "?"}`);
    ids.add(node.id);
    if (node.nodeType !== "source_document" && !node.sourceId) errors.push(`node ${node.id} misses sourceId`);
    if (["evidence", "observation"].includes(node.nodeType) && !node.sourceLocator) errors.push(`node ${node.id} misses sourceLocator`);
  }
  const sourceNode = nodes.find(node => node.id === source.id && node.nodeType === "source_document");
  if (!sourceNode) errors.push("source metadata does not resolve to a source_document node");
  else if (String(sourceNode.sourceHash).toLowerCase() !== String(source.sourceHash).toLowerCase()) errors.push("source node hash differs from ingestion source hash");

  for (const link of links) {
    if (!ids.has(link.source) || !ids.has(link.target)) errors.push(`unresolved link ${link.source} -> ${link.target}`);
    if (!String(link.justification || "").trim()) errors.push(`link ${link.source} -> ${link.target} misses justification`);
  }

  const types = new Map(nodes.map(node => [node.id, node.nodeType]));
  const hasLink = (from, to, relation) => links.some(link => types.get(link.source) === from && types.get(link.target) === to && link.type === relation);
  if (!hasLink("study", "estimate", "REPORTS_ESTIMATE")) errors.push("chain misses Study -> Estimate");
  if (!hasLink("estimate", "claim", "SUPPORTS_CLAIM")) errors.push("chain misses Estimate -> Claim");
  if (!hasLink("claim", "evidence", "JUSTIFIED_BY")) errors.push("chain misses Claim -> Evidence");
  if (!hasLink("evidence", "source_document", "LOCATED_IN")) errors.push("evidence is not located in its source");

  const quality = await evaluateIngestionQuality(candidate, projectDir);
  if (ingestion.canonicalStatus === "complete" && !quality.ready) {
    errors.push(`canonicalStatus complete is forbidden while ingestion quality is ${quality.status}`);
  }
  if (!["partial", "complete"].includes(ingestion.canonicalStatus)) errors.push("canonicalStatus must be partial or complete");

  if (errors.length) throw new Error(errors.join("\n"));

  return {
    canonicalFile: path.resolve(projectDir, ingestion.canonicalFile),
    data: {
      scope: "Premier cluster canonique du graphe scientifique, produit par la pipeline d'ingestion gouvernée.",
      ingestion: {
        ...ingestion,
        completedStages: requiredStages,
        committedAt: "2026-07-22",
        quality
      },
      nodes,
      links
    }
  };
}

export async function runIngestion({ candidatePath, apply = false, check = false }) {
  const { canonicalFile, data } = await buildCanonical(candidatePath);
  const serialized = `${JSON.stringify(data, null, 2)}\n`;
  if (check) {
    const current = await fs.readFile(canonicalFile, "utf8");
    if (current !== serialized) throw new Error(`canonical dataset is stale: ${path.relative(projectDir, canonicalFile)}`);
    return { mode: "check", canonicalFile, nodes: data.nodes.length, links: data.links.length };
  }
  if (!apply) return { mode: "preview", canonicalFile, nodes: data.nodes.length, links: data.links.length };

  await fs.mkdir(path.dirname(canonicalFile), { recursive: true });
  const temporary = `${canonicalFile}.tmp`;
  await fs.writeFile(temporary, serialized, "utf8");
  await fs.rename(temporary, canonicalFile);
  return { mode: "commit", canonicalFile, nodes: data.nodes.length, links: data.links.length };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const candidate = process.argv.find(arg => arg.startsWith("--candidate="))?.split("=")[1]
    || "science/staging/satopaa-2014-information-diversity.json";
  const result = await runIngestion({
    candidatePath: candidate,
    apply: process.argv.includes("--apply"),
    check: process.argv.includes("--check")
  });
  console.log(`${result.mode}: ${result.nodes} nodes, ${result.links} relations -> ${path.relative(projectDir, result.canonicalFile)}`);
}
