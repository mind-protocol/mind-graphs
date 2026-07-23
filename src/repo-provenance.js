// Provenance du dépôt lue depuis le nœud déclaratif du graphe L2. Le remote
// d'auto-push vient de là, pas de `git config` : le graphe est la source de
// vérité de provenance. On lit la définition déclarative du nœud (versionnée dans
// le dépôt) plutôt que FalkorDB, pour que l'auto-push fonctionne même base éteinte.
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { projectDir } from "./graph-manifest.js";

const exec = promisify(execFile);
const DATASET = path.join(projectDir, "data", "l2-mind-organization.json");
export const REPO_NODE_ID = "thing-l2-repo-mind-graphs";

/** { repositoryUrl, remoteName, defaultBranch } depuis le nœud dépôt déclaratif. */
export async function readRepoNode() {
  const data = JSON.parse(await fs.readFile(DATASET, "utf8"));
  const node = (data.nodes || []).find(entry => entry.id === REPO_NODE_ID);
  if (!node) throw new Error(`Nœud dépôt "${REPO_NODE_ID}" introuvable dans ${DATASET}.`);
  if (!node.repositoryUrl) throw new Error(`Le nœud dépôt "${REPO_NODE_ID}" n'a pas de repositoryUrl.`);
  return {
    repositoryUrl: node.repositoryUrl,
    remoteName: node.remoteName || "origin",
    defaultBranch: node.defaultBranch || "main"
  };
}

/** Compare le remote déclaré dans le graphe à `git remote get-url`. */
export async function verifyGitRemote(rootDir, remoteName, expectedUrl) {
  try {
    const { stdout } = await exec("git", ["remote", "get-url", remoteName], { cwd: rootDir });
    const actual = stdout.trim();
    return { ok: actual === expectedUrl, actual };
  } catch (error) {
    return { ok: false, actual: null, error: error.message };
  }
}
