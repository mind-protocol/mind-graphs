import fs from "node:fs/promises";
import path from "node:path";

export async function loadScienceCandidate(projectDir, candidatePath) {
  const absolute = path.resolve(projectDir, candidatePath);
  const candidate = JSON.parse(await fs.readFile(absolute, "utf8"));
  const nodes = [...(candidate.nodes || [])];
  const links = [...(candidate.links || [])];
  for (const fragmentPath of candidate.ingestion?.fragments || []) {
    const fragment = JSON.parse(await fs.readFile(path.resolve(projectDir, fragmentPath), "utf8"));
    nodes.push(...(fragment.nodes || []));
    links.push(...(fragment.links || []));
  }
  return { ...candidate, nodes, links };
}
