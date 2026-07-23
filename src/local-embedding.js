import { createHash } from "node:crypto";
import { composeDynamicSearchIntent } from "./intent-embedding-profile.js";

const tokenize = text => String(text)
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .match(/[a-z0-9]{2,}/g) || [];

export const LOCAL_EMBEDDING_MODEL = Object.freeze({
  id: "local-hash-token-bigram",
  version: "1",
  dimensions: 128,
  limitation: "Embedding lexical de démarrage : il partage les mots et bigrammes, mais ne comprend pas un synonyme absent du texte."
});

const idOf = endpoint => typeof endpoint === "object" ? endpoint?.id : endpoint;
const nodeText = node => [
  node.name,
  node.phrase,
  node.summary,
  node.description,
  node.definition,
  node.semanticType,
  node.family,
  node.stateDimension,
  node.stateIndicator
].filter(Boolean).join(" | ");

/**
 * Embedding local de démarrage : hashing trick sur tokens et bigrammes. Il est
 * déterministe, sans réseau et reproductible. Ce n'est pas un modèle sémantique
 * final ; l'interface `embed(text)` reste remplaçable par un fournisseur réel.
 */
export function createLocalEmbedder({ dimensions = LOCAL_EMBEDDING_MODEL.dimensions } = {}) {
  if (!Number.isInteger(dimensions) || dimensions < 16) throw new Error("dimensions must be an integer >= 16");
  const embed = async text => {
    const tokens = tokenize(text);
    const features = [...tokens, ...tokens.slice(0, -1).map((token, index) => `${token}_${tokens[index + 1]}`)];
    const vector = Array(dimensions).fill(0);
    for (const feature of features) {
      const digest = createHash("sha256").update(feature).digest();
      const index = digest.readUInt32BE(0) % dimensions;
      const sign = digest[4] & 1 ? 1 : -1;
      vector[index] += sign;
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return norm ? vector.map(value => value / norm) : vector;
  };
  embed.metadata = { ...LOCAL_EMBEDDING_MODEL, dimensions };
  return embed;
}

export async function embedNodes(nodes, embed, { force = false } = {}) {
  return Promise.all(nodes.map(async node => ({
    ...node,
    embedding: !force && Array.isArray(node.embedding)
      ? node.embedding
      : await embed(nodeText(node)),
    embeddingModel: embed.metadata?.id || node.embeddingModel || null,
    embeddingModelVersion: embed.metadata?.version || node.embeddingModelVersion || null
  })));
}

/**
 * Encode une transition complète. Le lien porte donc la raison du passage et
 * les deux extrémités, plutôt qu'un prédicat ou une cible isolés.
 */
export async function embedLinks(links, nodes, embed, { force = false } = {}) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  return Promise.all(links.map(async link => {
    if (!force && Array.isArray(link.embedding)) return link;
    const source = byId.get(idOf(link.source)) || { id: idOf(link.source) };
    const target = byId.get(idOf(link.target)) || { id: idOf(link.target) };
    const text = [
      nodeText(source),
      link.type,
      link.synthesis,
      link.justification,
      nodeText(target)
    ].filter(Boolean).join(" | ");
    return {
      ...link,
      embedding: await embed(text),
      embeddingModel: embed.metadata?.id || null,
      embeddingModelVersion: embed.metadata?.version || null,
      embeddingSurface: "source-predicate-target-transition"
    };
  }));
}

export async function embedWorkspace(workspace, nodes, embed, { force = false } = {}) {
  if (!workspace || typeof workspace !== "object") throw new Error("workspace must be an object");
  if (!force && Array.isArray(workspace.embedding)) return workspace;
  const byId = new Map(nodes.map(node => [node.id, node]));
  const referenced = [...new Set([...(workspace.goalIds || []), ...(workspace.activeNodeIds || [])])]
    .map(id => byId.get(id))
    .filter(Boolean);
  const text = [
    workspace.name,
    workspace.text,
    workspace.summary,
    ...referenced.map(nodeText)
  ].filter(Boolean).join(" | ");
  const hasDynamicIntent = Boolean(
    workspace.cortexState
    || workspace.activeSubentity?.cortexState
    || workspace.affectVector
    || workspace.activeSubentity?.affectVector
    || workspace.predictionResidual
  );
  const intentProfile = hasDynamicIntent
    ? await composeDynamicSearchIntent(workspace, nodes, embed)
    : null;
  return {
    ...workspace,
    embedding: intentProfile?.embedding || await embed(text),
    embeddingModel: embed.metadata?.id || workspace.embeddingModel || null,
    embeddingModelVersion: embed.metadata?.version || workspace.embeddingModelVersion || null,
    embeddingText: text,
    intentProfile
  };
}
