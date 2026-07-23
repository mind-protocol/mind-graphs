"""
Law 17 — Latent Desire Activation + Impulse Accumulation

Spec: docs/cognition/l1_physics/ALGORITHM_L1_Physics.md § Law 17

Desire nodes simmer at low energy until internal conditions align, then
ignite without any external trigger. Action nodes accumulate energy under
sustained drive pressure until they cross the WM selection threshold.

Activation check (spec):
    activation_check = (
        desire.weight
        * goal_proximity(desire, opportunity)
        * limbic_alignment(desire, drives)
        * cognitive_load_inverse
        * narrative_legitimacy(desire, active_narratives)
    )

    if activation_check > DESIRE_ACTIVATION_THRESHOLD:
        desire.energy += DESIRE_IGNITION_BOOST

Impulse accumulation (action nodes):
    drive_pressure = sum(drive.intensity * action.drive_affinity[drive])
    context_match  = Coh(WM_centroid, action.action_context)

    if drive_pressure > threshold AND context_match > threshold:
        action.energy += RATE * drive_pressure * context_match
    else:
        action.energy *= IMPULSE_DECAY
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from ..constants import (
    DESIRE_ACTIVATION_THRESHOLD,
    DESIRE_IGNITION_BOOST,
    IMPULSE_ACCUMULATION_RATE,
    IMPULSE_CONTEXT_THRESHOLD,
    IMPULSE_DECAY,
    IMPULSE_DRIVE_THRESHOLD,
    WM_SIZE_MAX,
)
from ..models import (
    CitizenCognitiveState,
    DriveName,
    Node,
    NodeType,
)


# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------


@dataclass
class ImpulseResult:
    """Output of a single Law 17 tick."""

    desires_ignited: int = 0
    action_impulses_accumulated: int = 0
    desires_checked: int = 0
    actions_checked: int = 0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


from runtime.utils import cosine_similarity as _cosine_similarity  # canonical impl


def _get_drive_affinity_for_node(drive_name: str, node: Node) -> float:
    """Read the drive-affinity score for *drive_name* from *node*."""
    if node.drive_affinity and drive_name in node.drive_affinity:
        return node.drive_affinity[drive_name]

    _field_map: dict[str, str] = {
        DriveName.CURIOSITY.value: "novelty_affinity",
        DriveName.NOVELTY_HUNGER.value: "novelty_affinity",
        DriveName.CARE.value: "care_affinity",
        DriveName.ACHIEVEMENT.value: "achievement_affinity",
        DriveName.SELF_PRESERVATION.value: "risk_affinity",
    }
    attr = _field_map.get(drive_name)
    if attr is not None:
        return getattr(node, attr, 0.0)
    return 0.0


def goal_proximity(desire: Node, state: CitizenCognitiveState) -> float:
    """Compute goal proximity: how close is an opportunity to fulfilling this desire?

    Measures the best semantic alignment between the desire's embedding and
    any active node in the graph that could serve as an "opportunity" — nodes
    with energy > 0 that are concepts, processes, or other desires.

    Returns a score in [0, 1]. 0 = no opportunity visible, 1 = perfect match.
    """
    if not desire.embedding:
        return 0.0

    best_proximity = 0.0

    for node in state.nodes.values():
        # Skip self and dormant nodes.
        if node.id == desire.id or node.energy <= 0:
            continue
        # Skip state/value nodes — they aren't opportunities.
        if node.node_type in (NodeType.STATE, NodeType.VALUE):
            continue
        if not node.embedding:
            continue

        sim = _cosine_similarity(desire.embedding, node.embedding)
        # Weight by the node's goal_relevance if available.
        proximity = sim * max(node.goal_relevance, 0.1)
        best_proximity = max(best_proximity, proximity)

    return min(best_proximity, 1.0)


def narrative_legitimacy(
    desire: Node, state: CitizenCognitiveState
) -> float:
    """Compute narrative legitimacy: do active narratives support this desire?

    Scans active narrative nodes (energy > 0) and measures embedding
    coherence with the desire. High coherence = the desire fits the
    current story the citizen is telling themselves.

    Returns a score in [0.1, 1.0]. Floor of 0.1 ensures desires can
    still ignite without narrative support (just harder).
    """
    if not desire.embedding:
        return 0.5  # No embedding to compare — neutral.

    narrative_nodes = [
        n for n in state.nodes.values()
        if n.node_type == NodeType.NARRATIVE and n.energy > 0 and n.embedding
    ]

    if not narrative_nodes:
        return 0.5  # No active narratives — neutral, not blocking.

    # Weighted average coherence, weighted by narrative energy.
    total_weight = 0.0
    weighted_sim = 0.0

    for narr in narrative_nodes:
        sim = _cosine_similarity(desire.embedding, narr.embedding)
        w = narr.energy * narr.weight
        weighted_sim += sim * w
        total_weight += w

    if total_weight == 0.0:
        return 0.5

    legitimacy = weighted_sim / total_weight

    # Floor at 0.1 so narrative absence doesn't fully block ignition.
    return max(0.1, min(1.0, legitimacy))


# ---------------------------------------------------------------------------
# Core functions
# ---------------------------------------------------------------------------


def activate_desires(state: CitizenCognitiveState) -> tuple[int, int]:
    """Scan desire nodes and ignite dormant ones whose conditions align.

    Implements the full spec formula:
        activation_check = weight * goal_proximity * limbic_alignment
                         * cognitive_load_inverse * narrative_legitimacy

    Returns (desires_ignited, desires_checked).
    """
    centroid = state.wm.centroid
    desires_ignited = 0
    desires_checked = 0

    for node in state.nodes.values():
        if node.node_type != NodeType.DESIRE:
            continue
        desires_checked += 1

        # Only ignite dormant desires (energy below half the boost).
        if node.energy > DESIRE_IGNITION_BOOST * 0.5:
            continue

        # Alignment with WM centroid (basic semantic proximity).
        if not centroid or not node.embedding:
            continue
        alignment = _cosine_similarity(centroid, node.embedding)

        # Goal proximity: is there an active opportunity in the graph?
        proximity = goal_proximity(node, state)

        # Limbic alignment: how well do current drives favor this desire?
        limbic_alignment = 0.0
        for drive in state.limbic.drives.values():
            affinity = _get_drive_affinity_for_node(drive.name.value, node)
            limbic_alignment += drive.intensity * affinity

        # Cognitive load inverse: room in WM -> more likely to ignite.
        cognitive_load_inverse = max(
            0.0, 1.0 - state.wm.size / max(WM_SIZE_MAX, 1)
        )

        # Narrative legitimacy: does the current story support this desire?
        legitimacy = narrative_legitimacy(node, state)

        # Full spec formula: combine all factors.
        # Use max(alignment, proximity) so either WM relevance OR
        # opportunity visibility can satisfy the proximity requirement.
        combined_proximity = max(alignment, proximity)

        activation_check = (
            node.weight
            * combined_proximity
            * (1.0 + limbic_alignment)
            * cognitive_load_inverse
            * legitimacy
        )

        if activation_check > DESIRE_ACTIVATION_THRESHOLD:
            node.energy += DESIRE_IGNITION_BOOST
            desires_ignited += 1

    return desires_ignited, desires_checked


def accumulate_impulses(state: CitizenCognitiveState) -> tuple[int, int]:
    """Scan action nodes and accumulate energy under sustained drive pressure.

    Returns (impulses_accumulated, actions_checked).
    """
    centroid = state.wm.centroid
    impulses_accumulated = 0
    actions_checked = 0

    for node in state.nodes.values():
        if not node.is_action_node:
            continue
        actions_checked += 1

        # Drive pressure: sum of (drive.intensity * affinity).
        drive_pressure = 0.0
        for drive in state.limbic.drives.values():
            aff = node.drive_affinity.get(drive.name.value, 0.0)
            drive_pressure += drive.intensity * aff

        # Context match: cosine(WM_centroid, action_node.action_context).
        if centroid and node.action_context:
            context_match = _cosine_similarity(centroid, node.action_context)
        else:
            context_match = 0.0

        if accumulate_impulse(node, drive_pressure, context_match):
            impulses_accumulated += 1

    return impulses_accumulated, actions_checked


def check_threshold(drive_pressure: float, context_match: float) -> bool:
    """Check if drive pressure and context match exceed impulse thresholds.

    Args:
        drive_pressure: Sum of drive.intensity * affinity for matching drives.
        context_match: Cosine similarity between WM centroid and action context.

    Returns:
        True if both thresholds exceeded (action should accumulate energy).
    """
    return (
        drive_pressure > IMPULSE_DRIVE_THRESHOLD
        and context_match > IMPULSE_CONTEXT_THRESHOLD
    )


def accumulate_impulse(
    node: "Node",
    drive_pressure: float,
    context_match: float,
) -> bool:
    """Accumulate impulse energy on a single action node.

    If thresholds are met, adds energy proportional to drive pressure
    and context match. Otherwise decays the node's energy.

    Args:
        node: The action node (modified in-place).
        drive_pressure: Sum of drive.intensity * affinity.
        context_match: Cosine similarity with WM centroid.

    Returns:
        True if energy was accumulated, False if decayed.
    """
    if check_threshold(drive_pressure, context_match):
        node.energy += IMPULSE_ACCUMULATION_RATE * drive_pressure * context_match
        return True
    else:
        node.energy *= IMPULSE_DECAY
        return False


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def update_impulse(state: CitizenCognitiveState) -> ImpulseResult:
    """Execute one tick of Law 17 — desire activation + impulse accumulation.

    Parameters
    ----------
    state:
        The full citizen cognitive state. Modified in-place.

    Returns
    -------
    ImpulseResult with counts for desires ignited and impulses accumulated.
    """
    desires_ignited, desires_checked = activate_desires(state)
    impulses_accumulated, actions_checked = accumulate_impulses(state)

    return ImpulseResult(
        desires_ignited=desires_ignited,
        action_impulses_accumulated=impulses_accumulated,
        desires_checked=desires_checked,
        actions_checked=actions_checked,
    )
