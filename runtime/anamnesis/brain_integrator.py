# DOCS: mind-protocol/docs/memory/the_anamnesis/ALGORITHM_The_Anamnesis.md (Steps 3-6)
"""
Brain Integrator — Build conversation spaces, chain moments, and persist.

Graph structure per conversation:

    space:conv_{id}  (the conversation as a place)
        │
        ├── [occurred_in] ← moment:1  ──[next]──▶  moment:2  ──[next]──▶  moment:3
        │
        └── metadata: title, platform, date range, participants

Cross-conversation links:
    moment:A  ──[associates]──  moment:B   (semantic similarity)
    space:X   ──[continues]──   space:Y    (thematic continuity)
"""

import hashlib
import logging
from dataclasses import dataclass, field

import numpy as np

from runtime.anamnesis.node_extractor import ExtractedNode, ConversationCluster

logger = logging.getLogger("mind.anamnesis.integrator")

DEDUP_THRESHOLD = 0.92
ANCHOR_MIN_SIMILARITY = 0.3
ANCHOR_TOP_K = 3
CROSS_CONV_SIMILARITY = 0.6  # threshold for linking moments across conversations
SPACE_CONTINUITY_THRESHOLD = 0.5  # threshold for linking spaces as thematic continuations


@dataclass
class AnchorLink:
    """Link from a new memory to an existing brain node."""
    target_id: str
    similarity: float
    link_type: str


@dataclass
class IntegratedNode:
    """A memory ready for persistence."""
    node_id: str
    content: str
    embedding: np.ndarray
    node_type: str
    significance: float
    source_platform: str
    source_conversation: str
    timestamp: str | None
    participants: list[str]
    sequence_position: int
    anchor_links: list[AnchorLink] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)


@dataclass
class IntegratedSpace:
    """A conversation space with its chained moments."""
    space_id: str
    conversation_id: str
    title: str
    source_platform: str
    participants: list[str]
    timestamp_start: str | None
    timestamp_end: str | None
    turn_count: int
    centroid: np.ndarray | None = None
    moments: list[IntegratedNode] = field(default_factory=list)  # ordered


@dataclass
class IntegrationResult:
    """Complete result of integration step."""
    spaces_created: int = 0
    moments_persisted: int = 0
    chain_links_created: int = 0
    anchor_links_created: int = 0
    cross_conv_links_created: int = 0
    space_continuity_links_created: int = 0
    dedup_removed: int = 0
    persisted_ids: list[str] = field(default_factory=list)


def integrate_clusters(
    clusters: list[ConversationCluster],
    citizen_handle: str,
    embed_fn,
    graph_ops=None,
    session_id: str = "",
) -> IntegrationResult:
    """Full integration: embed → build spaces → chain → dedup → anchor → persist.

    Args:
        clusters: ConversationClusters from the extractor (ordered).
        citizen_handle: Target citizen.
        embed_fn: Callable(str) -> list[float] for single text embedding.
        graph_ops: GraphOps for FalkorDB. If None, dry-run.
        session_id: Anamnesis session identifier.

    Returns:
        IntegrationResult with metrics.
    """
    result = IntegrationResult()
    graph_name = f"brain_{citizen_handle}"

    if not clusters:
        logger.info("No clusters to integrate.")
        return result

    # Step 1: Embed all nodes and build integrated spaces
    logger.info(f"Embedding nodes from {len(clusters)} conversations...")
    spaces = _embed_and_build_spaces(clusters, citizen_handle, embed_fn)

    # Step 2: Deduplicate within and across spaces
    logger.info("Deduplicating...")
    existing_memories = _get_existing_memories(citizen_handle, graph_ops)
    result.dedup_removed = _deduplicate_spaces(spaces, existing_memories)
    logger.info(f"  Removed {result.dedup_removed} duplicates")

    # Step 3: Anchor to existing brain nodes
    logger.info("Anchoring to existing brain...")
    existing_brain = _get_existing_brain(citizen_handle, graph_ops)
    _anchor_all_moments(spaces, existing_brain)

    # Step 4: Persist spaces, moments, chains, and cross-links
    logger.info(f"Persisting to {graph_name}...")
    _persist_all(spaces, citizen_handle, session_id, graph_ops, result)

    # Step 5: Cross-conversation linking
    logger.info("Building cross-conversation links...")
    _build_cross_conversation_links(spaces, citizen_handle, graph_ops, result)
    _build_space_continuity_links(spaces, citizen_handle, graph_ops, result)

    logger.info(
        f"Integration complete: {result.spaces_created} spaces, "
        f"{result.moments_persisted} moments, "
        f"{result.chain_links_created} chain links, "
        f"{result.anchor_links_created} anchor links, "
        f"{result.cross_conv_links_created} cross-conv links, "
        f"{result.space_continuity_links_created} space continuity links"
    )
    return result


# ── Step 1: Embed and build spaces ───────────────────────────────────────


def _embed_and_build_spaces(
    clusters: list[ConversationCluster],
    citizen_handle: str,
    embed_fn,
) -> list[IntegratedSpace]:
    """Embed all nodes and organize into IntegratedSpaces."""
    spaces = []

    for cluster in clusters:
        space_id = f"space:conv:{citizen_handle}_{_hash8(cluster.conversation_id)}"

        moments = []
        for node in cluster.nodes:
            emb = np.array(embed_fn(node.content), dtype=np.float64)
            if np.linalg.norm(emb) < 0.05:
                continue

            node_id = f"moment:{citizen_handle}_{_hash8(node.content)}"
            inode = IntegratedNode(
                node_id=node_id,
                content=node.content,
                embedding=emb,
                node_type=node.node_type,
                significance=node.significance,
                source_platform=node.source_platform,
                source_conversation=node.source_conversation,
                timestamp=node.timestamp,
                participants=node.participants,
                sequence_position=node.sequence_position,
            )
            inode.sources.append(f"{node.source_platform}:{node.source_conversation}")
            moments.append(inode)

        if not moments:
            continue

        # Compute space centroid from moment embeddings
        embs = np.array([m.embedding for m in moments])
        centroid = np.mean(embs, axis=0)
        norm = np.linalg.norm(centroid)
        if norm > 0:
            centroid = centroid / norm

        space = IntegratedSpace(
            space_id=space_id,
            conversation_id=cluster.conversation_id,
            title=cluster.title,
            source_platform=cluster.source_platform,
            participants=cluster.participants,
            timestamp_start=cluster.timestamp_start,
            timestamp_end=cluster.timestamp_end,
            turn_count=cluster.turn_count,
            centroid=centroid,
            moments=moments,
        )
        spaces.append(space)

    total = sum(len(s.moments) for s in spaces)
    logger.info(f"  Built {len(spaces)} spaces with {total} moments")
    return spaces


# ── Step 2: Deduplication ────────────────────────────────────────────────


def _deduplicate_spaces(
    spaces: list[IntegratedSpace],
    existing_memories: list[tuple[str, np.ndarray]],
) -> int:
    """Remove duplicate moments within and across spaces. Returns count removed."""
    removed = 0

    # Collect all existing embeddings
    existing_embs = [emb for _, emb in existing_memories]

    # Track accepted embeddings globally for cross-space dedup
    accepted_embs: list[np.ndarray] = []

    for space in spaces:
        unique = []
        for moment in space.moments:
            is_dup = False

            # Check against existing brain memories
            for ex_emb in existing_embs:
                if _cosine_similarity(moment.embedding, ex_emb) > DEDUP_THRESHOLD:
                    is_dup = True
                    break

            # Check against already-accepted moments (cross-space)
            if not is_dup:
                for acc_emb in accepted_embs:
                    if _cosine_similarity(moment.embedding, acc_emb) > DEDUP_THRESHOLD:
                        is_dup = True
                        break

            if is_dup:
                removed += 1
            else:
                unique.append(moment)
                accepted_embs.append(moment.embedding)

        space.moments = unique

    return removed


# ── Step 3: Anchoring ────────────────────────────────────────────────────


def _anchor_all_moments(
    spaces: list[IntegratedSpace],
    brain_nodes: list[tuple[str, np.ndarray]],
):
    """Anchor moments to existing brain nodes (traits, values, knowledge)."""
    if not brain_nodes:
        return

    for space in spaces:
        for moment in space.moments:
            similarities = []
            for brain_id, brain_emb in brain_nodes:
                sim = _cosine_similarity(moment.embedding, brain_emb)
                if sim >= ANCHOR_MIN_SIMILARITY:
                    similarities.append((brain_id, sim))

            similarities.sort(key=lambda x: x[1], reverse=True)
            for brain_id, sim in similarities[:ANCHOR_TOP_K]:
                if sim > 0.8:
                    link_type = "reinforces"
                elif sim > 0.5:
                    link_type = "associates"
                else:
                    link_type = "contextualizes"

                moment.anchor_links.append(AnchorLink(
                    target_id=brain_id,
                    similarity=sim,
                    link_type=link_type,
                ))


# ── Step 4: Persistence ─────────────────────────────────────────────────


def _persist_all(
    spaces: list[IntegratedSpace],
    citizen_handle: str,
    session_id: str,
    graph_ops,
    result: IntegrationResult,
):
    """Persist spaces, moments, chain links, and anchor links."""
    graph_name = f"brain_{citizen_handle}"

    for space in spaces:
        if not space.moments:
            continue

        # Create space node
        if graph_ops is not None:
            try:
                graph_ops.create_node(
                    graph_name=graph_name,
                    node_id=space.space_id,
                    node_type="space",
                    name=space.title[:80],
                    content=(
                        f"Conversation on {space.source_platform}. "
                        f"{space.turn_count} turns, {len(space.moments)} significant moments. "
                        f"Participants: {', '.join(space.participants)}."
                    ),
                    synthesis=f"Conversation space: {space.title[:60]}",
                    embedding=space.centroid.tolist() if space.centroid is not None else None,
                    properties={
                        "space_type": "conversation",
                        "source_platform": space.source_platform,
                        "conversation_id": space.conversation_id,
                        "participants": ",".join(space.participants),
                        "timestamp_start": space.timestamp_start or "",
                        "timestamp_end": space.timestamp_end or "",
                        "turn_count": space.turn_count,
                        "moment_count": len(space.moments),
                        "anamnesis_session": session_id,
                    },
                )
                result.spaces_created += 1
            except Exception as e:
                logger.error(f"Failed to create space {space.space_id}: {e}")

        # Create moment nodes and chain them
        prev_moment_id = None

        for moment in space.moments:
            if graph_ops is not None:
                try:
                    graph_ops.create_node(
                        graph_name=graph_name,
                        node_id=moment.node_id,
                        node_type="moment",
                        name=moment.content[:60],
                        content=moment.content,
                        synthesis=f"Memory ({moment.node_type}) via anamnesis",
                        embedding=moment.embedding.tolist(),
                        properties={
                            "weight": moment.significance,
                            "energy": 0.1,
                            "stability": 0.3,
                            "memory_type": moment.node_type,
                            "source_platform": moment.source_platform,
                            "source_conversation": moment.source_conversation,
                            "timestamp": moment.timestamp or "",
                            "participants": ",".join(moment.participants),
                            "sequence_position": moment.sequence_position,
                            "anamnesis_session": session_id,
                        },
                    )

                    # Link moment → space (occurred_in)
                    graph_ops.create_link(
                        graph_name=graph_name,
                        source_id=moment.node_id,
                        target_id=space.space_id,
                        properties={
                            "type": "occurred_in",
                            "weight": 1.0,
                            "permanence": 0.9,
                        },
                    )

                    # Chain link: prev_moment → this_moment (next)
                    if prev_moment_id:
                        graph_ops.create_link(
                            graph_name=graph_name,
                            source_id=prev_moment_id,
                            target_id=moment.node_id,
                            properties={
                                "type": "next",
                                "weight": 0.8,
                                "permanence": 0.9,
                            },
                        )
                        result.chain_links_created += 1

                    # Anchor links to existing brain nodes
                    for link in moment.anchor_links:
                        graph_ops.create_link(
                            graph_name=graph_name,
                            source_id=moment.node_id,
                            target_id=link.target_id,
                            properties={
                                "type": link.link_type,
                                "weight": link.similarity,
                                "permanence": 0.6,
                            },
                        )
                        result.anchor_links_created += 1

                except Exception as e:
                    logger.error(f"Failed to persist {moment.node_id}: {e}")
                    continue

            result.moments_persisted += 1
            result.persisted_ids.append(moment.node_id)
            prev_moment_id = moment.node_id


# ── Step 5: Cross-conversation linking ───────────────────────────────────


def _build_cross_conversation_links(
    spaces: list[IntegratedSpace],
    citizen_handle: str,
    graph_ops,
    result: IntegrationResult,
):
    """Link moments across conversations by semantic similarity.

    Only links the strongest cross-conversation matches to avoid noise.
    """
    if graph_ops is None or len(spaces) < 2:
        return

    graph_name = f"brain_{citizen_handle}"

    # Collect all moments with their space index
    all_moments = []
    for si, space in enumerate(spaces):
        for moment in space.moments:
            all_moments.append((si, moment))

    # Find strong cross-conversation similarities
    for i, (si_a, mom_a) in enumerate(all_moments):
        best_cross = None
        best_sim = CROSS_CONV_SIMILARITY

        for j, (si_b, mom_b) in enumerate(all_moments):
            if si_a == si_b:  # same conversation — skip
                continue
            if j <= i:  # avoid duplicate pairs
                continue

            sim = _cosine_similarity(mom_a.embedding, mom_b.embedding)
            if sim > best_sim:
                best_sim = sim
                best_cross = mom_b

        if best_cross:
            try:
                graph_ops.create_link(
                    graph_name=graph_name,
                    source_id=mom_a.node_id,
                    target_id=best_cross.node_id,
                    properties={
                        "type": "echoes",
                        "weight": best_sim,
                        "permanence": 0.5,
                    },
                )
                result.cross_conv_links_created += 1
            except Exception as e:
                logger.debug(f"Cross-link failed: {e}")


def _build_space_continuity_links(
    spaces: list[IntegratedSpace],
    citizen_handle: str,
    graph_ops,
    result: IntegrationResult,
):
    """Link conversation spaces that are thematic continuations of each other."""
    if graph_ops is None or len(spaces) < 2:
        return

    graph_name = f"brain_{citizen_handle}"

    for i, space_a in enumerate(spaces):
        if space_a.centroid is None:
            continue

        best_match = None
        best_sim = SPACE_CONTINUITY_THRESHOLD

        for j, space_b in enumerate(spaces):
            if j <= i or space_b.centroid is None:
                continue

            sim = _cosine_similarity(space_a.centroid, space_b.centroid)
            if sim > best_sim:
                best_sim = sim
                best_match = space_b

        if best_match:
            try:
                graph_ops.create_link(
                    graph_name=graph_name,
                    source_id=space_a.space_id,
                    target_id=best_match.space_id,
                    properties={
                        "type": "continues",
                        "weight": best_sim,
                        "permanence": 0.7,
                    },
                )
                result.space_continuity_links_created += 1
            except Exception as e:
                logger.debug(f"Space continuity link failed: {e}")


# ── Helpers ──────────────────────────────────────────────────────────────


def _get_existing_brain(citizen_handle: str, graph_ops) -> list[tuple[str, np.ndarray]]:
    """Get existing brain nodes for anchoring (non-moment nodes only)."""
    if graph_ops is None:
        return []
    try:
        nodes = graph_ops.get_all_nodes(graph_name=f"brain_{citizen_handle}")
        result = []
        for n in nodes:
            emb = n.get("embedding")
            # Only anchor to non-moment nodes (traits, values, knowledge)
            if emb and len(emb) > 0 and n.get("memory_type") is None:
                result.append((n.get("id", ""), np.array(emb, dtype=np.float64)))
        return result
    except Exception:
        return []


def _get_existing_memories(citizen_handle: str, graph_ops) -> list[tuple[str, np.ndarray]]:
    """Get existing memory (moment) nodes for dedup."""
    if graph_ops is None:
        return []
    try:
        nodes = graph_ops.get_all_nodes(graph_name=f"brain_{citizen_handle}")
        result = []
        for n in nodes:
            emb = n.get("embedding")
            if emb and len(emb) > 0 and n.get("memory_type"):
                result.append((n.get("id", ""), np.array(emb, dtype=np.float64)))
        return result
    except Exception:
        return []


def _hash8(text: str) -> str:
    return hashlib.md5(text.encode()).hexdigest()[:8]


from runtime.utils import cosine_similarity as _cosine_similarity  # canonical impl
