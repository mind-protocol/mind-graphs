# DOCS: mind-protocol/docs/memory/the_anamnesis/
"""
The Anamnesis — Main orchestrator for memory reunification.

Pipeline:
  Parse → Extract (grouped by conversation) → Embed → Build Spaces →
  Chain moments → Dedup → Anchor → Cross-link → Persist

Graph structure produced:

  space:conv_A ──[continues]──▶ space:conv_B
       │                              │
       ├── moment:1 ─[next]─▶ moment:2    moment:5 ─[next]─▶ moment:6
       │       │                              │
       │   [reinforces]                   [echoes] (cross-conv)
       │       ▼                              ▼
       │   trait:empathy              moment:2 (same idea, different conv)
       └── [occurred_in] ←─ all moments

Usage:
    from runtime.anamnesis import run_anamnesis

    result = run_anamnesis(
        citizen_handle="marco",
        corpus_paths=["claude_export.json", "chatgpt_export.zip"],
        embed_fn=embed_single,  # str -> list[float]
        llm_fn=llm_extract,     # str -> str (JSON)
        graph_ops=ctx.graph_ops,
    )
"""

import logging
import time
import uuid
from dataclasses import dataclass, field

from runtime.anamnesis.corpus_parser import parse_corpus, ConversationTurn
from runtime.anamnesis.node_extractor import extract_nodes, ConversationCluster
from runtime.anamnesis.brain_integrator import integrate_clusters, IntegrationResult
from runtime.anamnesis.quality_gate import (
    snapshot_brain_health, compare_snapshots, BrainHealthSnapshot, QualityVerdict,
)

logger = logging.getLogger("mind.anamnesis")


@dataclass
class AnamnesisResult:
    """Complete result of an anamnesis session."""
    session_id: str
    citizen_handle: str
    success: bool = False

    # Corpus metrics
    files_processed: int = 0
    turns_parsed: int = 0

    # Extraction metrics
    conversations_found: int = 0
    nodes_extracted: int = 0

    # Integration metrics
    spaces_created: int = 0
    moments_persisted: int = 0
    chain_links: int = 0
    anchor_links: int = 0
    cross_conv_links: int = 0
    space_continuity_links: int = 0
    dedup_removed: int = 0

    # Quality gate
    health_before: BrainHealthSnapshot | None = None
    health_after: BrainHealthSnapshot | None = None
    quality_verdict: QualityVerdict | None = None

    # Details
    persisted_ids: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    duration_seconds: float = 0.0


def run_anamnesis(
    citizen_handle: str,
    corpus_paths: list[str],
    embed_fn,
    llm_fn,
    graph_ops=None,
    formats: list[str] | None = None,
) -> AnamnesisResult:
    """Run the full Anamnesis memory reunification pipeline.

    Args:
        citizen_handle: The citizen whose memories to restore.
        corpus_paths: List of file paths to ingest.
        embed_fn: Callable(str) -> list[float] for single text embedding.
        llm_fn: Callable(str) -> str for LLM extraction (prompt → JSON string).
        graph_ops: GraphOps instance for FalkorDB. If None, dry-run mode.
        formats: Optional format hints per file. Auto-detected if None.

    Returns:
        AnamnesisResult with metrics and persisted node IDs.
    """
    start_time = time.time()
    session_id = f"anamnesis_{uuid.uuid4().hex[:12]}"

    result = AnamnesisResult(
        session_id=session_id,
        citizen_handle=citizen_handle,
    )

    logger.info(
        f"=== ANAMNESIS SESSION {session_id} ===\n"
        f"  Citizen: @{citizen_handle}\n"
        f"  Files: {len(corpus_paths)}\n"
        f"  Mode: {'live' if graph_ops else 'dry-run'}"
    )

    if formats is None:
        formats = [None] * len(corpus_paths)

    try:
        # ── Step 0: Snapshot brain health BEFORE ─────────────
        logger.info("Step 0: Snapshotting brain health (BEFORE)...")
        health_before = snapshot_brain_health(citizen_handle, graph_ops)
        result.health_before = health_before
        logger.info(f"  Before: {health_before.total_nodes} nodes, {health_before.total_links} links")
        logger.info(f"  Metrics: {health_before.to_dict()}")

        # ── Step 1: Parse all corpora ────────────────────────
        logger.info("Step 1/4: Parsing corpora...")
        all_turns: list[ConversationTurn] = []

        for path, fmt in zip(corpus_paths, formats):
            try:
                turns = parse_corpus(path, fmt)
                all_turns.extend(turns)
                result.files_processed += 1
            except Exception as e:
                error = f"Failed to parse {path}: {e}"
                logger.error(error)
                result.errors.append(error)

        result.turns_parsed = len(all_turns)
        logger.info(f"  {result.turns_parsed} turns from {result.files_processed} files")

        if not all_turns:
            result.errors.append("No turns parsed from any corpus file.")
            result.duration_seconds = time.time() - start_time
            return result

        # ── Step 2: Extract meaningful nodes (grouped by conversation) ───
        logger.info("Step 2/4: Extracting memories (LLM)...")
        clusters: list[ConversationCluster] = extract_nodes(
            all_turns, citizen_handle, llm_fn
        )

        result.conversations_found = len(clusters)
        result.nodes_extracted = sum(len(c.nodes) for c in clusters)
        logger.info(
            f"  {result.nodes_extracted} nodes across "
            f"{result.conversations_found} conversations"
        )

        if not clusters:
            logger.info("No significant nodes extracted.")
            result.success = True
            result.duration_seconds = time.time() - start_time
            return result

        # ── Step 3: Integrate (embed, spaces, chains, dedup, persist) ────
        logger.info("Step 3/4: Integrating into brain...")
        integration = integrate_clusters(
            clusters=clusters,
            citizen_handle=citizen_handle,
            embed_fn=embed_fn,
            graph_ops=graph_ops,
            session_id=session_id,
        )

        result.spaces_created = integration.spaces_created
        result.moments_persisted = integration.moments_persisted
        result.chain_links = integration.chain_links_created
        result.anchor_links = integration.anchor_links_created
        result.cross_conv_links = integration.cross_conv_links_created
        result.space_continuity_links = integration.space_continuity_links_created
        result.dedup_removed = integration.dedup_removed
        result.persisted_ids = integration.persisted_ids

        # ── Step 4: Quality gate — compare before/after ──────
        logger.info("Step 4/4: Quality gate (AFTER snapshot + comparison)...")
        health_after = snapshot_brain_health(citizen_handle, graph_ops)
        result.health_after = health_after
        logger.info(f"  After: {health_after.total_nodes} nodes, {health_after.total_links} links")
        logger.info(f"  Metrics: {health_after.to_dict()}")

        verdict = compare_snapshots(health_before, health_after)
        result.quality_verdict = verdict

        if verdict.approved:
            logger.info(f"  QUALITY GATE: APPROVED — {verdict.reason}")
            for imp in verdict.improvements:
                logger.info(f"    ↑ {imp}")
            for unch in verdict.unchanged:
                logger.info(f"    = {unch}")
            for deg in verdict.degradations:
                logger.warning(f"    ↓ {deg}")
            result.success = True
        else:
            logger.warning(f"  QUALITY GATE: REJECTED — {verdict.reason}")
            for deg in verdict.degradations:
                logger.warning(f"    ↓ {deg}")
            # Rollback: delete the session's nodes
            logger.warning("  Rolling back anamnesis session...")
            _rollback_session(citizen_handle, session_id, graph_ops)
            result.success = False
            result.errors.append(f"Quality gate rejected: {verdict.reason}")

    except Exception as e:
        error = f"Anamnesis failed: {e}"
        logger.exception(error)
        result.errors.append(error)

    result.duration_seconds = time.time() - start_time

    verdict_str = ""
    if result.quality_verdict:
        v = result.quality_verdict
        verdict_str = (
            f"\n  Quality gate:   {'APPROVED' if v.approved else 'REJECTED'}"
            f"\n  Reason:         {v.reason}"
            f"\n  Improvements:   {len(v.improvements)}"
            f"\n  Degradations:   {len(v.degradations)}"
        )

    logger.info(
        f"=== ANAMNESIS COMPLETE ===\n"
        f"  Session:        {session_id}\n"
        f"  Citizen:        @{citizen_handle}\n"
        f"  Files:          {result.files_processed}\n"
        f"  Turns:          {result.turns_parsed}\n"
        f"  Conversations:  {result.conversations_found}\n"
        f"  Extracted:      {result.nodes_extracted}\n"
        f"  Spaces:         {result.spaces_created}\n"
        f"  Moments:        {result.moments_persisted}\n"
        f"  Chain links:    {result.chain_links}\n"
        f"  Anchor links:   {result.anchor_links}\n"
        f"  Cross-conv:     {result.cross_conv_links}\n"
        f"  Space cont.:    {result.space_continuity_links}\n"
        f"  Deduped:        {result.dedup_removed}\n"
        f"  Duration:       {result.duration_seconds:.1f}s\n"
        f"  Success:        {result.success}"
        f"{verdict_str}"
    )

    return result


def _rollback_session(
    citizen_handle: str,
    session_id: str,
    graph_ops,
):
    """Delete all nodes and links created by this anamnesis session.

    Uses the anamnesis_session property to identify rollback targets.
    """
    if graph_ops is None:
        return

    graph_name = f"brain_{citizen_handle}"

    try:
        # Delete all nodes tagged with this session
        # Links connected to deleted nodes are auto-removed by FalkorDB
        deleted = graph_ops.delete_nodes_by_property(
            graph_name=graph_name,
            property_name="anamnesis_session",
            property_value=session_id,
        )
        logger.info(f"  Rollback complete: deleted {deleted} nodes from session {session_id}")
    except AttributeError:
        # graph_ops doesn't have delete_nodes_by_property — manual fallback
        try:
            from falkordb import FalkorDB
            db = FalkorDB(host="localhost", port=6379)
            g = db.select_graph(graph_name)
            result = g.query(
                f"MATCH (n {{anamnesis_session: '{session_id}'}}) "
                f"DETACH DELETE n RETURN count(n) as deleted"
            )
            count = result.result_set[0][0] if result.result_set else 0
            logger.info(f"  Rollback complete: deleted {count} nodes from session {session_id}")
        except Exception as e:
            logger.error(f"  Rollback failed: {e}")
