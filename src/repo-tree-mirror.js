// Miroir arborescent dépôt→graphe L2 : chaque dossier devient un `space`, chaque
// fichier un `thing`, reliés par CONVERGES_IN le long de l'arborescence, avec le
// nœud dépôt déclaratif comme racine. Le périmètre suit `git ls-files` (fichiers
// suivis + non ignorés), donc `.git/`, `node_modules/` et les chemins gitignore
// sont exclus sans liste en dur. Les nœuds sont un overlay runtime révisionné :
// une projection complète nettoie ce qui a disparu par comparaison de révision.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { upsertNodes, upsertLinksBatched, deleteStaleRuntime } from "./l2-graph-writer.js";

const exec = promisify(execFile);

// Racine de l'arbre : le nœud dépôt déclaratif (porteur de l'URL du remote).
export const REPO_ROOT_NODE_ID = "thing-l2-repo-mind-graphs";
const FILE_KIND = "repo_file";
const DIR_KIND = "repo_dir";

/** Fichiers suivis + non ignorés, chemins POSIX relatifs à la racine du dépôt. */
export async function listTrackedFiles(rootDir) {
  const { stdout } = await exec("git", ["ls-files", "-c", "-o", "--exclude-standard"], { cwd: rootDir, maxBuffer: 128 * 1024 * 1024 });
  return stdout.split("\n").map(line => line.trim()).filter(Boolean);
}

function ancestorDirs(rel) {
  const parts = rel.split("/").slice(0, -1);
  const dirs = [];
  const acc = [];
  for (const part of parts) { acc.push(part); dirs.push(acc.join("/")); }
  return dirs;
}

const parentTarget = relOrDir => relOrDir.includes("/")
  ? `repo:${relOrDir.slice(0, relOrDir.lastIndexOf("/"))}`
  : REPO_ROOT_NODE_ID;

/**
 * Construit nœuds + liens (purs, sans effet) pour un ensemble de fichiers. `stats`
 * fournit optionnellement taille et date de modification par chemin.
 */
export function buildGraphElements(files, stats = {}) {
  const dirSet = new Set();
  const nodes = [];
  const links = [];
  for (const rel of files) {
    for (const dir of ancestorDirs(rel)) dirSet.add(dir);
    const stat = stats[rel] || {};
    nodes.push({
      id: `repo:${rel}`,
      name: rel.split("/").pop(),
      nodeType: FILE_KIND,
      semanticType: "thing",
      runtimeKind: FILE_KIND,
      path: rel,
      ext: path.extname(rel).replace(/^\./, ""),
      sizeBytes: stat.size ?? "",
      modifiedAt: stat.mtime ?? "",
      depth: rel.split("/").length
    });
    links.push({
      source: `repo:${rel}`,
      target: parentTarget(rel),
      type: "CONVERGES_IN",
      justification: `Le fichier ${rel} appartient à ${rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "la racine du dépôt"}.`
    });
  }
  for (const dir of dirSet) {
    nodes.push({
      id: `repo:${dir}`,
      name: dir.split("/").pop(),
      nodeType: DIR_KIND,
      semanticType: "space",
      runtimeKind: DIR_KIND,
      path: dir,
      depth: dir.split("/").length
    });
    links.push({
      source: `repo:${dir}`,
      target: parentTarget(dir),
      type: "CONVERGES_IN",
      justification: `Le dossier ${dir} est un sous-espace de ${dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "la racine du dépôt"}.`
    });
  }
  return { nodes, links };
}

async function statFiles(rootDir, files) {
  const stats = {};
  await Promise.all(files.map(async rel => {
    try {
      const stat = await fs.stat(path.join(rootDir, rel));
      stats[rel] = { size: stat.size, mtime: stat.mtime.toISOString() };
    } catch { /* fichier disparu entre le listing et le stat : ignoré */ }
  }));
  return stats;
}

/** Projection complète, idempotente : upsert de tout l'arbre puis GC des révisions périmées. */
export async function projectFullTree(graph, rootDir, revision) {
  const files = await listTrackedFiles(rootDir);
  const stats = await statFiles(rootDir, files);
  const { nodes, links } = buildGraphElements(files, stats);
  const stamped = nodes.map(node => ({ ...node, runtimeManaged: true, runtimeRevision: revision }));
  await upsertNodes(graph, stamped);
  await upsertLinksBatched(graph, links);
  await deleteStaleRuntime(graph, "repo_", revision);
  return { files: files.length, nodes: nodes.length, links: links.length };
}

/**
 * Reflet incrémental d'un seul chemin. Absent du disque → suppression du thing ;
 * présent → upsert du thing et de ses dossiers ancêtres. Un événement de dossier
 * seul est ignoré : les dossiers naissent et meurent avec leurs fichiers.
 */
export async function applyFileEvent(graph, rootDir, rel, revision) {
  const absolute = path.join(rootDir, rel);
  let stat;
  try {
    stat = await fs.stat(absolute);
  } catch {
    await graph.query("MATCH (n:MindNode {id:$id}) DETACH DELETE n", { params: { id: `repo:${rel}` } });
    return { rel, kind: "deleted" };
  }
  if (stat.isDirectory()) return { rel, kind: "dir-skip" };
  const stats = { [rel]: { size: stat.size, mtime: stat.mtime.toISOString() } };
  const { nodes, links } = buildGraphElements([rel], stats);
  const stamped = nodes.map(node => ({ ...node, runtimeManaged: true, runtimeRevision: revision }));
  await upsertNodes(graph, stamped);
  await upsertLinksBatched(graph, links);
  return { rel, kind: "upsert" };
}
