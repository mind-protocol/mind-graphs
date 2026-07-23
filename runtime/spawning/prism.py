# DOCS: mind-protocol/docs/spawning/the_prism/
"""
The Prism — Main orchestrator for citizen spawning.

Pipeline: Intent -> Godparents -> Assembly -> Safety -> Identity -> Registration

Each step is independently testable and produces output consumed by the next.
The orchestrator coordinates; logic lives in each step's module.

Usage:
    from runtime.spawning import run_prism

    result = run_prism(
        intent_paragraphs=["A citizen who understands graph physics deeply..."],
        intent_weights=[1.0],
        godparent_candidates=[...],
        universe_sid=universe_centroid,
        working_name="Nervo",
        embed_fn=embed,
        graph_ops=ctx.graph_ops,
    )
"""

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from runtime.spawning.intent_collector import collect_intent, IntentResult
from runtime.spawning.godparent_selector import (
    select_godparents, GodparentCandidate, SelectedGodparent,
)
from runtime.spawning.seed_assembler import assemble_seed, SeedBrain
from runtime.spawning.safety_validator import validate_seed, SafetyReport
from runtime.spawning.identity_generator import generate_identity, CitizenIdentity
from runtime.spawning.registrar import register_citizen, RegistrationResult

logger = logging.getLogger("mind.spawning.prism")


@dataclass
class PrismResult:
    """Complete result of a Prism spawning attempt."""
    success: bool
    handle: str | None = None
    name: str | None = None
    sid: str | None = None
    registration: RegistrationResult | None = None
    safety_report: SafetyReport | None = None

    # Diagnostic data for transparency
    intent_result: IntentResult | None = None
    godparents_selected: list[SelectedGodparent] = field(default_factory=list)
    seed_brain: SeedBrain | None = None
    identity: CitizenIdentity | None = None

    # Error tracking
    failed_at_step: str | None = None
    error_message: str | None = None
    duration_seconds: float = 0.0


def run_prism(
    intent_paragraphs: list[str],
    intent_weights: list[float] | None,
    godparent_candidates: list[GodparentCandidate],
    universe_sid: np.ndarray,
    existing_centroids: list[tuple[str, np.ndarray]],
    working_name: str,
    embed_fn,
    org_id: str = "mind-protocol",
    universe: str = "lumina-prime",
    intended_human: str | None = None,
    graph_ops=None,
    citizens_dir: Path | None = None,
    keys_dir: Path | None = None,
) -> PrismResult:
    """Run the full Prism spawning pipeline.

    Args:
        intent_paragraphs: Free-text paragraphs from godparents (min 20 words each).
        intent_weights: Optional weights per paragraph. Defaults to equal weight.
        godparent_candidates: Candidate godparents with brain data and scores.
        universe_sid: R^D centroid of the L3 universe graph.
        existing_centroids: All existing citizen centroids for diversity check.
        working_name: Proposed name for the new citizen.
        embed_fn: Callable that takes list[str] and returns list[list[float]].
        org_id: Organization the citizen belongs to.
        universe: Universe the citizen belongs to.
        intended_human: Optional human partner handle for auto bond proposal.
        graph_ops: GraphOps instance for FalkorDB writes.
        citizens_dir: Override for citizen file directory.
        keys_dir: Override for key storage directory.

    Returns:
        PrismResult with success/failure, citizen data, and diagnostics.
    """
    start_time = time.time()
    result = PrismResult(success=False)

    logger.info(f"=== PRISM BIRTH INITIATED: {working_name} ===")

    try:
        # Step 1: Collect and embed intent
        logger.info("Step 1/6: Collecting intent...")
        intent_result = collect_intent(intent_paragraphs, intent_weights, embed_fn)
        result.intent_result = intent_result

        # Step 2: Select godparents
        logger.info("Step 2/6: Selecting godparents...")
        selected = select_godparents(godparent_candidates, intent_result.intent_vector)
        result.godparents_selected = selected

        # Step 3: Assemble seed brain (extract nodes + tensor contraction)
        logger.info("Step 3/6: Assembling seed brain (prismatic projection)...")
        godparent_brains = _extract_godparent_brains(selected, graph_ops)
        seed_brain = assemble_seed(
            godparent_brains=godparent_brains,
            intent_matrix=intent_result.intent_matrix,
            universe_sid=universe_sid,
            godparent_count=len(selected),
        )
        result.seed_brain = seed_brain

        # Step 4: Safety validation (three gates)
        logger.info("Step 4/6: Running safety validation...")
        safety_report = validate_seed(seed_brain, existing_centroids, embed_fn)
        result.safety_report = safety_report

        if not safety_report.passed:
            result.failed_at_step = "safety_validation"
            result.error_message = safety_report.rejection_reason
            result.duration_seconds = time.time() - start_time
            logger.warning(
                f"=== PRISM BIRTH REJECTED: {working_name} ===\n"
                f"Reason: {safety_report.rejection_reason}\n"
                f"Adjustments: {safety_report.suggested_adjustments}"
            )
            return result

        # Step 5: Generate identity (SID, name, CLAUDE.md, profile.json)
        logger.info("Step 5/6: Generating identity...")

        # Collect parent visual data for color inheritance
        godparent_colors = _collect_godparent_colors(
            [g.handle for g in selected], graph_ops
        )

        identity = generate_identity(
            seed_brain=seed_brain,
            working_name=working_name,
            godparent_handles=[g.handle for g in selected],
            intent_paragraphs=intent_paragraphs,
            safety_report=safety_report,
            org_id=org_id,
            universe=universe,
            intended_human=intended_human,
            embed_fn=embed_fn,
            godparent_colors=godparent_colors,
        )
        result.identity = identity

        # Step 6: Register across all layers
        logger.info("Step 6/6: Registering citizen...")
        registration = register_citizen(
            identity=identity,
            seed_brain=seed_brain,
            godparent_handles=[g.handle for g in selected],
            intended_human=intended_human,
            citizens_dir=citizens_dir,
            keys_dir=keys_dir,
            graph_ops=graph_ops,
        )
        result.registration = registration
        result.handle = identity.handle
        result.name = identity.name
        result.sid = identity.sid
        result.success = True

        duration = time.time() - start_time
        result.duration_seconds = duration

        logger.info(
            f"=== PRISM BIRTH COMPLETE: @{identity.handle} ===\n"
            f"  Name: {identity.name}\n"
            f"  SID: {identity.sid}\n"
            f"  Seed brain: {len(seed_brain.nodes)} nodes\n"
            f"  Godparents: {[g.handle for g in selected]}\n"
            f"  Duration: {duration:.1f}s"
        )

        return result

    except Exception as e:
        result.failed_at_step = result.failed_at_step or "unknown"
        result.error_message = str(e)
        result.duration_seconds = time.time() - start_time
        logger.exception(f"=== PRISM BIRTH FAILED: {working_name} === {e}")
        return result


def _collect_godparent_colors(
    handles: list[str],
    graph_ops,
) -> list[list[int]]:
    """Collect canvas_color from each godparent's profile for visual inheritance.

    Falls back gracefully — if a parent has no color or graph_ops is unavailable,
    that parent is skipped. The identity generator handles missing data.
    """
    colors = []
    if graph_ops is None:
        return colors

    for handle in handles:
        try:
            # Look up the actor node in the universe graph
            profile = graph_ops.get_node_by_id(
                f"actor:{handle}", graph_name="lumina_prime"
            )
            if profile and profile.get("canvas_color"):
                cc = profile["canvas_color"]
                if isinstance(cc, list) and len(cc) == 3:
                    colors.append(cc)
                    continue

            # Fallback: try reading from citizen profile file
            # (some citizens may not have canvas_color in graph yet)
            logger.debug(f"No canvas_color in graph for @{handle}, skipping")
        except Exception as e:
            logger.debug(f"Could not get canvas_color for @{handle}: {e}")

    return colors


def _extract_godparent_brains(
    godparents: list[SelectedGodparent],
    graph_ops,
) -> dict[str, list[dict]]:
    """Extract eligible brain nodes from each godparent's L1 graph.

    Args:
        godparents: Selected godparents with handles.
        graph_ops: GraphOps for FalkorDB queries. If None, returns empty brains.

    Returns:
        {handle: [node_dicts]} where each node has content, embedding, type.
    """
    brains = {}

    for gp in godparents:
        handle = gp.handle
        graph_name = f"brain_{handle}"

        if graph_ops is None:
            logger.warning(f"No graph_ops — cannot extract brain for @{handle}")
            brains[handle] = []
            continue

        try:
            # Query all nodes from godparent's L1 brain
            nodes = graph_ops.get_all_nodes(graph_name=graph_name)
            brains[handle] = [
                {
                    "content": n.get("content", ""),
                    "embedding": n.get("embedding", []),
                    "type": n.get("type", n.get("node_type", "concept")),
                }
                for n in nodes
                if n.get("embedding") and len(n.get("embedding", [])) > 0
            ]
            logger.info(
                f"Extracted {len(brains[handle])} nodes from @{handle}'s brain"
            )
        except Exception as e:
            logger.error(f"Failed to extract brain for @{handle}: {e}")
            brains[handle] = []

    return brains
