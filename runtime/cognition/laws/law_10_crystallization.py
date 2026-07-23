"""
Law 10 — Crystallization

Dense co-activation patterns collapse into new hub nodes. Zero LLM.

When nodes repeatedly appear together in Working Memory, they form
a cluster. When the cluster reaches sufficient density (co-activation
count ≥ CRYSTALLIZATION_REPS and coherence ≥ CRYSTALLIZATION_COHERENCE),
a new hub node crystallizes:

  - Type: majority rule from cluster members
  - Name: medoid's name (the most central member)
  - Synthesis: combination of member syntheses
  - Weight: CRYSTALLIZATION_INHERITANCE × Σ(member weights)
  - Links: hub →contains→ members (hierarchy=-1)
           members →abstracts→ hub (hierarchy=+1)

This is how brains GROW. 20 scattered memories about "debugging Cypher"
crystallize into a single concept: "I know how to debug Cypher."

Spec: schema-l1.yaml L10_crystallization
      docs/cognition/l1/ALGORITHM_L1_Physics.md

Co-Authored-By: Tomaso Nervo (@nervo) <nervo@mindprotocol.ai>
"""

from __future__ import annotations

import logging
import time
from collections import Counter
from dataclasses import dataclass, field
from typing import Optional

from ..constants import (
    CRYSTALLIZATION_REPS,
    CRYSTALLIZATION_COHERENCE,
    CRYSTALLIZATION_INHERITANCE,
    CRYSTALLIZATION_INTERVAL,
)
from ..models import (
    CitizenCognitiveState,
    Node,
    NodeType,
    Link,
    LinkType,
)

logger = logging.getLogger("cognition.law10")


@dataclass
class CrystallizationResult:
    """Output of one crystallization check."""
    crystallized: bool = False
    hub_id: str = ""
    hub_name: str = ""
    hub_type: str = ""
    member_count: int = 0
    cluster_coherence: float = 0.0


# Track co-activation pairs across ticks
_coactivation_counts: dict[str, dict[frozenset, int]] = {}  # citizen_id → {pair → count}
_wm_history: dict[str, list[set[str]]] = {}  # citizen_id → [wm snapshots]


def crystallize(state: CitizenCognitiveState, tick: int) -> CrystallizationResult:
    """Law 10: check for crystallization opportunities.

    Called every CRYSTALLIZATION_INTERVAL ticks by the tick runner.
    """
    result = CrystallizationResult()

    if tick % CRYSTALLIZATION_INTERVAL != 0:
        return result

    citizen_id = state.citizen_id

    # Get current WM nodes
    wm_ids = set(state.wm.node_ids)
    if len(wm_ids) < 3:
        return result  # need at least 3 nodes to crystallize

    # Track WM history for this citizen
    if citizen_id not in _wm_history:
        _wm_history[citizen_id] = []
    _wm_history[citizen_id].append(wm_ids)

    # Keep last N snapshots
    max_history = CRYSTALLIZATION_REPS * 3
    if len(_wm_history[citizen_id]) > max_history:
        _wm_history[citizen_id] = _wm_history[citizen_id][-max_history:]

    # Count co-activations: how often do pairs appear together in WM?
    if citizen_id not in _coactivation_counts:
        _coactivation_counts[citizen_id] = {}
    coacts = _coactivation_counts[citizen_id]

    # Update counts for current WM
    wm_list = list(wm_ids)
    for i in range(len(wm_list)):
        for j in range(i + 1, len(wm_list)):
            pair = frozenset([wm_list[i], wm_list[j]])
            coacts[pair] = coacts.get(pair, 0) + 1

    # Find clusters: groups of nodes that co-activate frequently
    # Start from the most co-activated pair and expand
    if not coacts:
        return result

    # Find pairs with enough co-activations
    strong_pairs = {pair: count for pair, count in coacts.items()
                    if count >= CRYSTALLIZATION_REPS}

    if not strong_pairs:
        return result

    # Build cluster from connected strong pairs
    # Start with the strongest pair
    best_pair = max(strong_pairs, key=strong_pairs.get)
    cluster = set(best_pair)

    # Expand: add nodes that co-activate with at least 2 cluster members
    for pair, count in strong_pairs.items():
        if count >= CRYSTALLIZATION_REPS:
            overlap = pair & cluster
            if len(overlap) >= 1:  # connected to cluster
                cluster |= pair

    # Check cluster coherence (ratio of actual co-activations to possible)
    cluster_list = list(cluster)
    total_possible = len(cluster_list) * (len(cluster_list) - 1) // 2
    if total_possible == 0:
        return result

    actual_strong = 0
    for i in range(len(cluster_list)):
        for j in range(i + 1, len(cluster_list)):
            pair = frozenset([cluster_list[i], cluster_list[j]])
            if coacts.get(pair, 0) >= CRYSTALLIZATION_REPS:
                actual_strong += 1

    coherence = actual_strong / total_possible
    if coherence < CRYSTALLIZATION_COHERENCE:
        return result

    # Check cluster members are actual nodes
    member_nodes = []
    for nid in cluster:
        node = state.get_node(nid)
        if node is not None:
            member_nodes.append(node)

    if len(member_nodes) < 3:
        return result

    # Don't crystallize if a hub already exists for this cluster
    hub_id = _make_hub_id(cluster)
    if hub_id in state.nodes:
        return result

    # === CRYSTALLIZE ===

    # Type: majority rule
    type_counts = Counter(n.node_type for n in member_nodes)
    hub_type = type_counts.most_common(1)[0][0]

    # Name: medoid (the node with highest weight = most central)
    medoid = max(member_nodes, key=lambda n: n.weight)
    hub_name = f"Crystallized: {medoid.content[:60]}"

    # Synthesis: combine member syntheses
    member_syntheses = [getattr(n, 'synthesis', '') or n.content[:50] for n in member_nodes[:5]]
    hub_synthesis = f"Pattern from {len(member_nodes)} co-activated nodes: {'; '.join(member_syntheses)}"

    # Weight: inherited from members
    hub_weight = CRYSTALLIZATION_INHERITANCE * sum(n.weight for n in member_nodes)

    # Create hub node
    hub = Node(
        id=hub_id,
        node_type=hub_type,
        content=hub_name,
        weight=hub_weight,
        energy=0.5,  # starts with some activation
        stability=0.3,
    )
    hub.synthesis = hub_synthesis
    hub.self_relevance = max(n.self_relevance for n in member_nodes)
    hub.activation_count = 1

    state.add_node(hub)

    # Create bidirectional links: hub ↔ members
    for member in member_nodes:
        # hub →contains→ member
        state.add_link(Link(
            source_id=hub_id,
            target_id=member.id,
            link_type=LinkType.CONTAINS,
            weight=0.5,
        ))
        # member →abstracts→ hub
        state.add_link(Link(
            source_id=member.id,
            target_id=hub_id,
            link_type=LinkType.ABSTRACTS,
            weight=0.3,
        ))

    # Clear co-activation counts for crystallized pairs (prevent re-crystallization)
    for i in range(len(cluster_list)):
        for j in range(i + 1, len(cluster_list)):
            pair = frozenset([cluster_list[i], cluster_list[j]])
            coacts.pop(pair, None)

    logger.info(
        f"Crystallized! {hub_id}: {len(member_nodes)} members, "
        f"coherence={coherence:.2f}, type={hub_type.value}, "
        f"weight={hub_weight:.2f}"
    )

    result.crystallized = True
    result.hub_id = hub_id
    result.hub_name = hub_name
    result.hub_type = hub_type.value
    result.member_count = len(member_nodes)
    result.cluster_coherence = coherence

    return result


def _make_hub_id(cluster: set[str]) -> str:
    """Deterministic hub ID from cluster members."""
    import hashlib
    sorted_ids = sorted(cluster)
    raw = ":".join(sorted_ids)
    return "hub_" + hashlib.sha256(raw.encode()).hexdigest()[:12]
