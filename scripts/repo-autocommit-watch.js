// Orchestrateur : surveille l'arbre de travail, met à jour le miroir L2, et
// commit/push automatiquement à chaque salve d'édition (debounce + mutex). Le
// remote vient du nœud dépôt du graphe (src/repo-provenance.js). Miroir et push
// sont best-effort : FalkorDB éteint ou push refusé n'empêchent jamais le commit.
//
//   node scripts/repo-autocommit-watch.js          # surveille en continu
//   node scripts/repo-autocommit-watch.js --once    # un cycle puis sort
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fsSync from "node:fs";
import path from "node:path";
import { getL2MindGraph, getClient } from "../src/db.js";
import { projectDir } from "../src/graph-manifest.js";
import { projectFullTree, applyFileEvent } from "../src/repo-tree-mirror.js";
import { readRepoNode, verifyGitRemote } from "../src/repo-provenance.js";

const exec = promisify(execFile);
const ONCE = process.argv.includes("--once");
const DEBOUNCE_MS = Number(process.env.REPO_AUTOCOMMIT_DEBOUNCE_MS || 2000);
// Runtime artifacts change continuously and are already excluded from Git.
// Watching them would still schedule `git add -A` on every tick and make
// OneDrive rescan `.git`, even though there is nothing durable to commit.
const IGNORE = [
  /^\.git(\/|$)/,
  /^node_modules(\/|$)/,
  /^artifacts(\/|$)/,
  /(^|\/)\.DS_Store$/
];

const git = args => exec("git", args, { cwd: projectDir, maxBuffer: 128 * 1024 * 1024 });

async function openGraphOrNull() {
  try {
    const graph = await getL2MindGraph();
    await graph.query("RETURN 1");
    return graph;
  } catch (error) {
    console.warn(`FalkorDB indisponible : miroir désactivé pour cette session (${error.message.split("\n")[0]}).`);
    return null;
  }
}

function buildCommitMessage(numstat, nameStatus) {
  let insertions = 0;
  let deletions = 0;
  for (const line of numstat.split("\n").map(l => l.trim()).filter(Boolean)) {
    const [add, del] = line.split("\t");
    insertions += Number(add) || 0;
    deletions += Number(del) || 0;
  }
  const entries = nameStatus.split("\n").map(l => l.trim()).filter(Boolean);
  const paths = entries.map(line => line.split("\t").slice(1).join(" → "));
  const header = `auto: ${entries.length} fichier${entries.length > 1 ? "s" : ""}, +${insertions}/-${deletions}`;
  const list = paths.slice(0, 8).map(p => `- ${p}`).join("\n");
  const more = paths.length > 8 ? `\n- … (+${paths.length - 8})` : "";
  return `${header}\n\n${list}${more}`;
}

async function commitCycle(graph, remote) {
  await git(["add", "-A"]);
  const { stdout: nameStatus } = await git(["diff", "--cached", "--name-status"]);
  if (!nameStatus.trim()) return { committed: false };

  const { stdout: numstat } = await git(["diff", "--cached", "--numstat"]);
  const message = buildCommitMessage(numstat, nameStatus);
  await git(["commit", "-m", message]);
  const { stdout: sha } = await git(["rev-parse", "--short", "HEAD"]);

  let pushed = false;
  try {
    await git(["push", remote.remoteName, "HEAD"]);
    pushed = true;
  } catch (error) {
    console.warn(`Push vers "${remote.remoteName}" échoué : ${error.message.split("\n")[0]}`);
  }

  if (graph) {
    const revision = Date.now();
    for (const line of nameStatus.split("\n").map(l => l.trim()).filter(Boolean)) {
      const parts = line.split("\t");
      const rel = parts[parts.length - 1];
      try {
        await applyFileEvent(graph, projectDir, rel, revision);
      } catch (error) {
        console.warn(`Miroir de ${rel} échoué : ${error.message.split("\n")[0]}`);
      }
    }
  }

  console.log(`Commit ${sha.trim()} · ${message.split("\n")[0]}${pushed ? " · poussé" : " · non poussé"}`);
  return { committed: true };
}

// --- démarrage ---
const remote = await readRepoNode();
const remoteCheck = await verifyGitRemote(projectDir, remote.remoteName, remote.repositoryUrl);
if (!remoteCheck.ok) {
  console.warn(`Divergence de remote : le graphe déclare ${remote.repositoryUrl}, git répond ${remoteCheck.actual ?? "aucun"}. Push visé : "${remote.remoteName}".`);
}

const graph = await openGraphOrNull();
if (graph) {
  const result = await projectFullTree(graph, projectDir, Date.now());
  console.log(`Miroir initial : ${result.files} fichiers, ${result.nodes} nœuds, ${result.links} relations.`);
}

if (ONCE) {
  await commitCycle(graph, remote);
  (await getClient()).close();
  process.exit(0);
}

// --- surveillance ---
let timer = null;
let running = false;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(fire, DEBOUNCE_MS);
}
async function fire() {
  if (running) { schedule(); return; }
  running = true;
  try {
    await commitCycle(graph, remote);
  } catch (error) {
    console.warn(`Cycle de commit échoué : ${error.message.split("\n")[0]}`);
  } finally {
    running = false;
  }
}

console.log(`Surveillance de ${projectDir} (debounce ${DEBOUNCE_MS} ms). Ctrl+C pour arrêter.`);
fsSync.watch(projectDir, { recursive: true }, (_event, filename) => {
  if (!filename) return;
  const rel = filename.split(path.sep).join("/");
  if (IGNORE.some(regex => regex.test(rel))) return;
  schedule();
});
