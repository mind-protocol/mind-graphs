# DOCS: mind-protocol/docs/spawning/the_prism/ALGORITHM_The_Prism.md (Steps 3-5)
"""
Seed Assembler — Build matrices, run tensor contraction, crystallize seed brain.

The mathematical core of the Prism. Three operations:
1. Extract eligible nodes from godparent brains (traits, values, aspirations, knowledge — NOT memories)
2. Prismatic projection: Parents_Matrix.T @ Intent_Matrix @ Universe_SID
3. Crystallize: find K nearest nodes to the child vector

The tensor contraction preserves cross-terms between parents — this is where novelty lives.
A parent who values precision x an intent about empathy produces something neither would suggest alone.
"""

import logging
import math
from dataclasses import dataclass

import numpy as np

logger = logging.getLogger("mind.spawning.assembler")

# Node types eligible for inheritance (V7: memories excluded)
ELIGIBLE_NODE_TYPES = frozenset({
    "trait", "value", "aspiration", "fear", "knowledge", "skill",
    # L1 cognitive types that map to eligible categories
    "narrative", "concept", "process", "desire",
})
EXCLUDED_NODE_TYPES = frozenset({
    "memory", "experience", "conversation", "dialogue", "state", "moment",
})

SEED_K_MULTIPLIER = 5
DEDUP_THRESHOLD = 0.9  # cosine similarity above which nodes are considered duplicates


@dataclass
class SeedNode:
    """A node in the seed brain with provenance."""
    content: str
    embedding: np.ndarray         # R^D
    node_type: str                # trait, value, aspiration, fear, knowledge, skill
    source_godparent: str         # handle of the godparent this node came from
    distance_to_child: float      # cosine distance to child vector (lower = more relevant)


@dataclass
class SeedBrain:
    """The crystallized seed brain for a new citizen."""
    nodes: list[SeedNode]
    child_vector: np.ndarray      # R^D — the projection result
    centroid: np.ndarray          # R^D — centroid of seed node embeddings
    k_target: int                 # how many nodes we aimed for
    godparent_count: int


def assemble_seed(
    godparent_brains: dict[str, list[dict]],
    intent_matrix: np.ndarray,
    universe_sid: np.ndarray,
    godparent_count: int,
) -> SeedBrain:
    """Build matrices, run tensor contraction, crystallize seed brain.

    Args:
        godparent_brains: {handle: [node_dicts]} — eligible nodes per godparent.
            Each node dict must have 'content', 'embedding', 'type'.
        intent_matrix: [N_intents x D] — embedded intent paragraphs.
        universe_sid: R^D — centroid of the L3 universe graph.
        godparent_count: Number of selected godparents.

    Returns:
        SeedBrain with crystallized nodes and child vector.

    Raises:
        ValueError: If no eligible nodes found or projection fails.
    """
    # Step 1: Extract eligible nodes and build parents matrix
    all_nodes = []
    embeddings = []

    for handle, nodes in godparent_brains.items():
        for node in nodes:
            node_type = node.get("type", "")
            if node_type in EXCLUDED_NODE_TYPES:
                continue
            emb = node.get("embedding")
            if emb is None or len(emb) == 0:
                continue

            emb_arr = np.array(emb, dtype=np.float64)
            if np.linalg.norm(emb_arr) < 1e-8:
                continue

            all_nodes.append({
                "content": node.get("content", ""),
                "embedding": emb_arr,
                "type": _categorize_node_type(node_type),
                "source": handle,
            })
            embeddings.append(emb_arr)

    if not all_nodes:
        raise ValueError(
            "No eligible nodes found in godparent brains. "
            "Godparents may have empty or memory-only brains."
        )

    logger.info(
        f"Extracted {len(all_nodes)} eligible nodes from "
        f"{len(godparent_brains)} godparent brains"
    )

    # Step 2: Build parents matrix [N_nodes x D]
    parents_matrix = np.stack(embeddings)  # [N x D]
    D = parents_matrix.shape[1]

    # Step 3: Prismatic projection (tensor contraction)
    child_vector = prismatic_projection(parents_matrix, intent_matrix, universe_sid)

    # Step 4: Crystallize — find K nearest nodes
    K = math.ceil(math.sqrt(godparent_count) * SEED_K_MULTIPLIER)
    K = max(K, 3)  # minimum 3 nodes for a mind

    seed_nodes = crystallize(all_nodes, child_vector, K)

    # Compute centroid of seed brain
    seed_embeddings = np.stack([n.embedding for n in seed_nodes])
    centroid = seed_embeddings.mean(axis=0)
    centroid = centroid / np.linalg.norm(centroid)

    logger.info(
        f"Seed brain crystallized: {len(seed_nodes)} nodes "
        f"(target K={K}, from {len(all_nodes)} eligible)"
    )

    return SeedBrain(
        nodes=seed_nodes,
        child_vector=child_vector,
        centroid=centroid,
        k_target=K,
        godparent_count=godparent_count,
    )


def prismatic_projection(
    parents_matrix: np.ndarray,
    intent_matrix: np.ndarray,
    universe_sid: np.ndarray,
) -> np.ndarray:
    """The core tensor contraction.

    PI = Parents_Matrix.T @ Intent_Matrix    # [D x N_intents]
    Child_raw = PI @ Universe_SID            # [D]
    Child_vector = normalize(Child_raw)      # unit sphere

    The intermediate PI encodes cross-terms: each element PI[d, i] captures how
    ALL parent nodes in dimension d relate to intent paragraph i. This is where
    combinatorial novelty emerges.

    Args:
        parents_matrix: [N_nodes x D] — embeddings of eligible parent nodes.
        intent_matrix: [N_intents x D] — embedded intent paragraphs.
        universe_sid: [D] — universe centroid vector.

    Returns:
        Normalized child vector [D] on the unit sphere.
    """
    # parents_matrix: [N x D], intent_matrix: [I x D], universe_sid: [D]
    # PI = Parents_Matrix.T @ Intent_Matrix.T = [D x N] @ [N x ... wait
    # Actually: Parents_Matrix.T is [D x N], Intent_Matrix is [I x D]
    # We need: [D x N] @ ... @ [D] = [D]
    #
    # Correct formulation from the spec:
    # PI = Parents_Matrix.T @ Intent_Matrix  =>  [D x N] @ [N x ... no
    #
    # Let me re-read: "PI = Parents_Matrix.T @ Intent_Matrix"
    # Parents_Matrix is [N_nodes x D], so .T is [D x N_nodes]
    # Intent_Matrix is [N_intents x D]
    # [D x N_nodes] @ [N_intents x D] doesn't work dimensionally.
    #
    # The spec says: "[D x N_nodes] @ [N_intents x D] @ [D x 1] = [D x 1]"
    # This requires N_nodes == N_intents which is wrong.
    #
    # The correct interpretation: Parents_Matrix.T @ Intent_Matrix.T
    # = [D x N_nodes] @ [N_nodes x ... no.
    #
    # Re-reading SYNC handoff: "Parents_Matrix.T @ Intent_Matrix"
    # produces [D x N_intents] "where each column encodes how ALL parent
    # nodes in dimension d relate to ONE intent"
    #
    # For this to work: [D x N_nodes] @ [N_nodes x N_intents] = [D x N_intents]
    # So Intent_Matrix should be [N_nodes x N_intents]? No, that's wrong.
    #
    # The intent is to compute cross-correlations between parent brain material
    # and intent. The simplest correct formulation:
    #
    # Step 1: Compute affinity of each parent node to each intent
    #   Affinity = Parents_Matrix @ Intent_Matrix.T  -> [N_nodes x N_intents]
    # Step 2: Weight parent embeddings by their affinity to intents
    #   PI = Parents_Matrix.T @ Affinity  -> [D x N_intents]
    # Step 3: Contract with universe SID
    #   Child_raw = PI @ Universe_SID  -> [D] ... but Universe_SID is [D], not [N_intents]
    #
    # Better: Universe_SID projects to intent space via:
    #   universe_weights = Intent_Matrix @ Universe_SID  -> [N_intents]
    #   Child_raw = PI @ universe_weights  -> [D]
    #
    # This chains correctly:
    #   Affinity[N_nodes x N_intents] = Parents[N x D] @ Intent[I x D].T
    #   PI[D x N_intents] = Parents[N x D].T @ Affinity[N x I]
    #   universe_weights[N_intents] = Intent[I x D] @ Universe_SID[D]
    #   Child[D] = PI[D x I] @ universe_weights[I]
    #
    # This preserves the cross-term property: PI encodes how parent
    # dimensions relate to intents, and universe_weights bias which
    # intents matter more in this universe's context.

    N_nodes, D = parents_matrix.shape
    N_intents = intent_matrix.shape[0]

    # Affinity: how each parent node relates to each intent [N_nodes x N_intents]
    affinity = parents_matrix @ intent_matrix.T

    # PI: parent dimensions weighted by intent affinity [D x N_intents]
    PI = parents_matrix.T @ affinity

    # Universe weights: how each intent aligns with universe context [N_intents]
    universe_weights = intent_matrix @ universe_sid

    # Child vector: PI contracted with universe-weighted intents [D]
    child_raw = PI @ universe_weights

    # Normalize to unit sphere
    norm = np.linalg.norm(child_raw)
    if norm < 1e-10:
        raise ValueError(
            "Prismatic projection produced zero vector. "
            "This means parent brains and intents are orthogonal — "
            "the godparents have nothing relevant to the stated intent."
        )

    child_vector = child_raw / norm

    logger.info(
        f"Prismatic projection: {N_nodes} parent nodes x {N_intents} intents "
        f"-> child vector (norm before normalization: {norm:.4f})"
    )

    return child_vector


def crystallize(
    all_nodes: list[dict],
    child_vector: np.ndarray,
    K: int,
) -> list[SeedNode]:
    """Find K nearest nodes to child vector, with deduplication.

    Args:
        all_nodes: All eligible nodes with embeddings.
        child_vector: The projection result to find neighbors for.
        K: Target number of seed nodes.

    Returns:
        K seed nodes (or fewer if deduplication removes near-duplicates).
    """
    # Compute distances to child vector
    scored = []
    for node in all_nodes:
        emb = node["embedding"]
        similarity = float(np.dot(child_vector, emb) / (
            np.linalg.norm(child_vector) * np.linalg.norm(emb)
        ))
        distance = 1.0 - similarity
        scored.append((node, distance))

    scored.sort(key=lambda x: x[1])

    # Take top candidates (2x K to allow for dedup)
    candidates = scored[:K * 2]

    # Deduplicate near-identical nodes
    selected = []
    for node, distance in candidates:
        if len(selected) >= K:
            break
        if _is_duplicate(node, selected):
            continue
        selected.append(SeedNode(
            content=node["content"],
            embedding=node["embedding"],
            node_type=node["type"],
            source_godparent=node["source"],
            distance_to_child=distance,
        ))

    return selected


def _is_duplicate(node: dict, existing: list[SeedNode]) -> bool:
    """Check if node is too similar to any existing seed node."""
    emb = node["embedding"]
    for seed in existing:
        sim = float(np.dot(emb, seed.embedding) / (
            np.linalg.norm(emb) * np.linalg.norm(seed.embedding)
        ))
        if sim > DEDUP_THRESHOLD:
            return True
    return False


def _categorize_node_type(raw_type: str) -> str:
    """Map L1 cognitive node types to Prism seed categories."""
    mapping = {
        "narrative": "trait",
        "concept": "knowledge",
        "process": "skill",
        "desire": "aspiration",
        "value": "value",
        "trait": "trait",
        "aspiration": "aspiration",
        "fear": "fear",
        "knowledge": "knowledge",
        "skill": "skill",
    }
    return mapping.get(raw_type, "knowledge")
