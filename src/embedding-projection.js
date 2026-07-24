// Projection 2D déterministe d'un espace d'embeddings.
//
// La carte doit être *stable* : si la base changeait à chaque tick, tout
// bougerait à l'écran sans que rien n'ait bougé dans le cerveau, et le
// mouvement ne voudrait plus rien dire. La base est donc calculée une fois à
// partir d'un jeu de référence fixe (les profils de clusters), puis réutilisée
// pour projeter n'importe quel vecteur du même modèle.
//
// L'ACP est obtenue par itération de puissance amorcée par un vecteur pseudo-
// aléatoire dérivé d'une graine constante : deux exécutions donnent exactement
// la même base, donc exactement la même carte.
import { createHash } from "node:crypto";

const POWER_ITERATIONS = 64;

function seededVector(dimensions, seed) {
  const vector = new Array(dimensions);
  let digest = createHash("sha256").update(String(seed)).digest();
  for (let index = 0; index < dimensions; index += 1) {
    const offset = index % 32;
    if (offset === 0 && index > 0) digest = createHash("sha256").update(digest).digest();
    vector[index] = (digest[offset] / 255) * 2 - 1;
  }
  return normalize(vector);
}

function normalize(vector) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm ? vector.map(value => value / norm) : vector;
}

const dot = (left, right) => left.reduce((sum, value, index) => sum + value * (right[index] || 0), 0);

/** Composante principale des vecteurs centrés, orthogonalisée contre `previous`. */
function principalComponent(centered, dimensions, previous, seed) {
  let vector = seededVector(dimensions, seed);
  for (let iteration = 0; iteration < POWER_ITERATIONS; iteration += 1) {
    const next = new Array(dimensions).fill(0);
    for (const sample of centered) {
      const scale = dot(sample, vector);
      for (let index = 0; index < dimensions; index += 1) next[index] += sample[index] * scale;
    }
    for (const axis of previous) {
      const overlap = dot(next, axis);
      for (let index = 0; index < dimensions; index += 1) next[index] -= overlap * axis[index];
    }
    const norm = Math.sqrt(next.reduce((sum, value) => sum + value * value, 0));
    if (!norm) return seededVector(dimensions, `${seed}:degenerate`);
    vector = next.map(value => value / norm);
  }
  // Fixe le signe : sans cela l'axe pourrait s'inverser d'une exécution à
  // l'autre et la carte apparaîtrait en miroir sans raison.
  let extreme = 0;
  for (let index = 1; index < dimensions; index += 1) {
    if (Math.abs(vector[index]) > Math.abs(vector[extreme])) extreme = index;
  }
  return vector[extreme] < 0 ? vector.map(value => -value) : vector;
}

/**
 * Construit une base de projection à partir d'un jeu de vecteurs de référence.
 * @param reference [number[]] vecteurs de même dimension
 */
export function buildProjectionBasis(reference, { seed = "mind-brain-map-v1" } = {}) {
  const samples = (reference || []).filter(vector => Array.isArray(vector) && vector.length);
  if (samples.length < 2) return null;
  const dimensions = samples[0].length;
  if (samples.some(sample => sample.length !== dimensions)) {
    throw new Error("buildProjectionBasis requires reference vectors of identical dimension.");
  }
  const mean = new Array(dimensions).fill(0);
  for (const sample of samples) {
    for (let index = 0; index < dimensions; index += 1) mean[index] += sample[index] / samples.length;
  }
  const centered = samples.map(sample => sample.map((value, index) => value - mean[index]));
  const first = principalComponent(centered, dimensions, [], `${seed}:1`);
  const second = principalComponent(centered, dimensions, [first], `${seed}:2`);

  // Échelle figée sur le jeu de référence : la carte garde le même cadrage même
  // si un vecteur projeté plus tard sort du nuage initial.
  let scale = 0;
  for (const sample of centered) {
    scale = Math.max(scale, Math.abs(dot(sample, first)), Math.abs(dot(sample, second)));
  }
  return { dimensions, mean, axes: [first, second], scale: scale || 1, sampleCount: samples.length, seed };
}

/** Projette un vecteur dans le carré [-1,1]². Renvoie `null` si le vecteur est absent ou hétérogène. */
export function projectVector(basis, vector) {
  if (!basis || !Array.isArray(vector) || vector.length !== basis.dimensions) return null;
  const centered = vector.map((value, index) => value - basis.mean[index]);
  return {
    x: dot(centered, basis.axes[0]) / basis.scale,
    y: dot(centered, basis.axes[1]) / basis.scale
  };
}

/** Barycentre pondéré d'un ensemble de vecteurs, puis sa projection. */
export function projectWeightedCentroid(basis, entries) {
  const usable = (entries || []).filter(entry => Array.isArray(entry.vector) && entry.vector.length === basis?.dimensions && entry.weight > 0);
  if (!basis || !usable.length) return null;
  const total = usable.reduce((sum, entry) => sum + entry.weight, 0);
  const centroid = new Array(basis.dimensions).fill(0);
  for (const entry of usable) {
    for (let index = 0; index < basis.dimensions; index += 1) {
      centroid[index] += (entry.vector[index] * entry.weight) / total;
    }
  }
  return projectVector(basis, centroid);
}
