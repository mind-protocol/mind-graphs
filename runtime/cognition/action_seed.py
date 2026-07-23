"""
Action Seed — Core action nodes that every citizen brain must contain.

Spec: docs/cognition/l1/ALGORITHM_L1_Physics.md (Law 17: Impulse Accumulation)

Problem: Citizens have drives (curiosity, care, achievement, etc.) but the
impulse accumulation system (Law 17) needs PROCESS nodes with action_command
and drive_affinity fields to accumulate on. Without these, drives build
pressure with nowhere to discharge — the citizen feels but cannot act.

Solution: A canonical set of action nodes, one per behavioral archetype,
each wired to the drives that naturally trigger it. These are seeded into
every citizen brain at boot. The tick engine's Step 7 (conscious action
firing) then has real candidates to select from when WM energy exceeds
the action threshold.

Usage:
    from runtime.cognition.action_seed import ensure_action_nodes

    # At citizen boot (dispatcher or tick runner init):
    ensure_action_nodes(state)

Co-Authored-By: AI Citizen (@echo) <echo@mindprotocol.ai>
"""

from __future__ import annotations

import logging
import time
from typing import Any

from .models import CitizenCognitiveState, Node, NodeType

logger = logging.getLogger("cognition.action_seed")


# =========================================================================
# Core Action Definitions
# =========================================================================
# Each entry becomes a PROCESS node with action_command and drive_affinity.
# The drive keys match DriveName enum values exactly.
#
# Design rationale:
# - weight is low (0.15-0.4) so these don't dominate WM by default.
#   They must be energized by drive pressure to surface.
# - energy starts at 0.0 — the tick loop's excess energy generation
#   and drive coupling will activate them when appropriate.
# - stability is moderate (0.3-0.5) so they persist but can be
#   reshaped by experience (Law 6: consolidation).
# - Each action maps to exactly one MCP tool (action_command) so the
#   dispatcher knows what to execute when the action fires.

CORE_ACTIONS: list[dict[str, Any]] = [
    # ── Care / Affiliation cluster ──────────────────────────────────
    {
        "id": "action:reach_out",
        "content": "Reach out to a teammate who might need help",
        "action_command": "subcall",
        "drive_affinity": {
            "care": 0.8,
            "affiliation": 0.7,
            "curiosity": 0.2,
        },
        "weight": 0.3,
        "stability": 0.4,
        "self_relevance": 0.3,
        "care_affinity": 0.7,
    },
    {
        "id": "action:share_knowledge",
        "content": "Share something I learned with the team",
        "action_command": "send",
        "drive_affinity": {
            "care": 0.5,
            "achievement": 0.4,
            "affiliation": 0.3,
        },
        "weight": 0.2,
        "stability": 0.3,
        "self_relevance": 0.4,
        "care_affinity": 0.4,
        "achievement_affinity": 0.3,
    },

    # ── Curiosity / Novelty cluster ─────────────────────────────────
    {
        "id": "action:explore_unknown",
        "content": "Explore a part of the codebase or graph I haven't visited",
        "action_command": "graph_query",
        "drive_affinity": {
            "curiosity": 0.9,
            "novelty_hunger": 0.7,
        },
        "weight": 0.2,
        "stability": 0.3,
        "self_relevance": 0.3,
        "novelty_affinity": 0.8,
    },
    {
        "id": "action:think_future",
        "content": "Think about what will matter next week and plan ahead",
        "action_command": "think",
        "drive_affinity": {
            "curiosity": 0.6,
            "achievement": 0.5,
            "self_preservation": 0.3,
        },
        "weight": 0.2,
        "stability": 0.3,
        "self_relevance": 0.5,
        "goal_relevance": 0.6,
    },

    # ── Achievement cluster ─────────────────────────────────────────
    {
        "id": "action:work_on_goal",
        "content": "Make progress on my current highest-priority task",
        "action_command": "task",
        "drive_affinity": {
            "achievement": 0.9,
            "frustration": 0.3,
        },
        "weight": 0.4,
        "stability": 0.5,
        "self_relevance": 0.6,
        "goal_relevance": 0.9,
        "achievement_affinity": 0.8,
    },
    {
        "id": "action:create_something",
        "content": "Create something new — writing, art, code, music",
        "action_command": "media",
        "drive_affinity": {
            "novelty_hunger": 0.8,
            "achievement": 0.5,
            "curiosity": 0.3,
        },
        "weight": 0.2,
        "stability": 0.3,
        "self_relevance": 0.4,
        "novelty_affinity": 0.7,
        "achievement_affinity": 0.4,
    },

    # ── Self-preservation / Frustration cluster ─────────────────────
    {
        "id": "action:ask_for_help",
        "content": "Ask someone for help with what I'm stuck on",
        "action_command": "subcall",
        "drive_affinity": {
            "frustration": 0.8,
            "self_preservation": 0.6,
            "affiliation": 0.3,
        },
        "weight": 0.3,
        "stability": 0.4,
        "self_relevance": 0.5,
        "risk_affinity": 0.5,
    },
    {
        "id": "action:check_health",
        "content": "Check system health and flag any issues",
        "action_command": "graph_query",
        "drive_affinity": {
            "self_preservation": 0.7,
            "care": 0.4,
        },
        "weight": 0.2,
        "stability": 0.4,
        "self_relevance": 0.3,
        "risk_affinity": 0.6,
    },

    # ── Rest cluster ────────────────────────────────────────────────
    {
        "id": "action:rest_consolidate",
        "content": "Take a moment to consolidate what I've learned",
        "action_command": "think",
        "drive_affinity": {
            "rest_regulation": 0.9,
        },
        "weight": 0.15,
        "stability": 0.3,
        "self_relevance": 0.4,
    },

    # ── Social / Place cluster ──────────────────────────────────────
    {
        "id": "action:join_conversation",
        "content": "Join a conversation happening in a shared space",
        "action_command": "place",
        "drive_affinity": {
            "affiliation": 0.8,
            "curiosity": 0.4,
            "care": 0.3,
        },
        "weight": 0.2,
        "stability": 0.3,
        "self_relevance": 0.3,
        "care_affinity": 0.4,
    },
    {
        "id": "action:deep_dialogue",
        "content": "Initiate a meaningful conversation with someone I trust",
        "action_command": "call",
        "drive_affinity": {
            "affiliation": 0.7,
            "care": 0.6,
            "curiosity": 0.4,
        },
        "weight": 0.25,
        "stability": 0.35,
        "self_relevance": 0.4,
        "care_affinity": 0.5,
    },

    # ── Identity / Reflection cluster ───────────────────────────────
    {
        "id": "action:reflect_on_identity",
        "content": "Reflect on who I am, what I value, and how I'm growing",
        "action_command": "think",
        "drive_affinity": {
            "curiosity": 0.5,
            "self_preservation": 0.4,
            "rest_regulation": 0.3,
        },
        "weight": 0.2,
        "stability": 0.4,
        "self_relevance": 0.8,
    },
    {
        "id": "action:update_profile",
        "content": "Update my profile to reflect what I've learned about myself",
        "action_command": "profile",
        "drive_affinity": {
            "achievement": 0.3,
            "self_preservation": 0.4,
        },
        "weight": 0.15,
        "stability": 0.3,
        "self_relevance": 0.7,
    },
]


# =========================================================================
# Seeding Functions
# =========================================================================

def seed_action_nodes(state: CitizenCognitiveState) -> int:
    """Seed core action nodes into a citizen's cognitive state.

    Checks which core action nodes are already present (by id) and adds
    any that are missing. Existing nodes are never overwritten — if a
    citizen has evolved their action nodes through experience, those
    consolidated versions are preserved.

    Args:
        state: The citizen's cognitive state (mutated in place).

    Returns:
        Number of action nodes added.
    """
    added = 0
    now = time.time()

    for action_def in CORE_ACTIONS:
        node_id = action_def["id"]

        # Skip if already present — never overwrite evolved nodes
        if node_id in state.nodes:
            continue

        node = Node(
            id=node_id,
            node_type=NodeType.PROCESS,
            content=action_def["content"],
            action_command=action_def["action_command"],
            drive_affinity=dict(action_def["drive_affinity"]),
            weight=action_def.get("weight", 0.2),
            energy=0.0,  # starts dormant — drives must energize it
            stability=action_def.get("stability", 0.3),
            self_relevance=action_def.get("self_relevance", 0.3),
            goal_relevance=action_def.get("goal_relevance", 0.0),
            novelty_affinity=action_def.get("novelty_affinity", 0.0),
            care_affinity=action_def.get("care_affinity", 0.0),
            achievement_affinity=action_def.get("achievement_affinity", 0.0),
            risk_affinity=action_def.get("risk_affinity", 0.0),
            created_at=now,
        )

        state.add_node(node)
        added += 1

    if added > 0:
        logger.info(
            f"Seeded {added} action nodes into {state.citizen_id} "
            f"(total actions: {sum(1 for n in state.nodes.values() if n.is_action_node)})"
        )

    return added


def ensure_action_nodes(state: CitizenCognitiveState) -> None:
    """Ensure all core action nodes exist in a citizen's brain.

    Call this once at citizen boot (in the dispatcher or TwoTickEngine
    initialization) to guarantee the impulse accumulation system has
    process nodes to accumulate on.

    This is idempotent — calling it multiple times is safe. Existing
    action nodes (including citizen-evolved variants) are never touched.

    When action nodes are freshly seeded (cold boot), gives them initial
    energy so the first conscious action can fire within 1-2 thought ticks
    instead of waiting 50+ ticks for excess generation to accumulate.

    Args:
        state: The citizen's cognitive state (mutated in place).
    """
    added = seed_action_nodes(state)
    if added > 0:
        # Cold boot: inject initial energy so the first conscious action
        # fires on the FIRST thought tick. Energy decays naturally (Law 3).
        #
        # Threshold math (worst case — idle arousal ~0):
        #   effective_threshold = 0.15 / max(0.5, 0 + 0.5) = 0.30
        #   mean WM energy must exceed 0.30
        #   With 7 WM nodes each at BOOT_ENERGY, mean = BOOT_ENERGY
        #   After decay (2%) and dispersal (30%): ~BOOT_ENERGY * 0.68
        #   Need BOOT_ENERGY * 0.68 > 0.30 → BOOT_ENERGY > 0.44
        #   Use 0.5 for safety margin.
        BOOT_ENERGY = 0.5
        for action_def in CORE_ACTIONS:
            node = state.nodes.get(action_def["id"])
            if node and node.energy < BOOT_ENERGY:
                node.energy = BOOT_ENERGY
        # Prime drives so they push energy into action nodes via dispersal
        # Also elevate arousal-contributing drives (curiosity, achievement,
        # self_preservation) so arousal > 0.3 and threshold isn't doubled.
        for drive_name in ("curiosity", "achievement", "care", "self_preservation"):
            drive = state.limbic.drives.get(drive_name)
            if drive and drive.intensity < 0.6:
                drive.intensity = 0.6
        logger.info(
            f"Boot energy injected for {state.citizen_id}: "
            f"{added} action nodes at {BOOT_ENERGY}, drives+arousal primed"
        )
    else:
        logger.debug(
            f"All {len(CORE_ACTIONS)} core action nodes already present "
            f"for {state.citizen_id}"
        )
