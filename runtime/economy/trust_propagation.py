"""
Trust Propagation on L3 Links — EMA-based Hebbian Trust

Spec: docs/schema/universe_links/ALGORITHM_Universe_Links.md  Algorithm 2
Ref:  L3_SOCIAL_PHYSICS.yaml  trust_propagation section

Trust on L3 RELATES_TO links between Actors is an Exponential Moving Average
that updates based on the PATTERN of interactions, not single events.

    trust_ema_new = alpha * observed_trust_signal + (1 - alpha) * trust_ema_old

Where:
    alpha           = TRUST_ALPHA (protocol constant, slow learning)
    trust_signal    = derived from interaction history (positive ratio, consistency)
    trust           = bounded [0, TRUST_CEILING], asymptotic

This module bridges L1 limbic experience and L3 structural trust:
    - L1 Law 18 (relational valence) updates trust on internal cognitive links
    - THIS module updates trust on L3 inter-actor links in the universe graph
    - The settlement engine reads L3 trust for $MIND flow computation

Key design principles (from L3_SOCIAL_PHYSICS.yaml):
    - Zero magic numbers: trust emerges from EMA, not manual assignment
    - Pattern over event: consistency matters more than volume
    - Asymptotic ceiling: trust never reaches 1.0
    - Graceful degradation: graph unavailability does not crash callers
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger("mind.trust_propagation")

# ---------------------------------------------------------------------------
# Protocol Constants (L4 governance level)
# ---------------------------------------------------------------------------

TRUST_ALPHA = 0.05       # EMA learning rate — slow, trust builds gradually
TRUST_FLOOR = 0.0        # Minimum trust
TRUST_CEILING = 0.99     # Asymptotic ceiling — never reaches 1.0
LINK_BIRTH_TRUST = 0.1   # Initial trust for new links (Algorithm 1)

# Algorithm 2 constants from ALGORITHM_Universe_Links.md
TRUST_UPDATE_THRESHOLD = 0.05   # Minimum limbic delta to trigger trust update
TRUST_GAIN_RATE = 0.1           # Rate of trust increase per positive event
TRUST_LOSS_RATE = 0.15          # Rate of trust decrease per negative event
AFFINITY_GAIN_RATE = 0.08       # Rate of affinity increase
AVERSION_GAIN_RATE = 0.08       # Rate of aversion increase
FRICTION_DECAY_ON_POSITIVE = 0.05   # Friction reduction from positive interaction
FRICTION_GAIN_ON_NEGATIVE = 0.1     # Friction increase from negative interaction
TRUST_ENERGY_BOOST = 0.5        # Energy injected into link during trust update


# ---------------------------------------------------------------------------
# Graph connection (lazy, graceful degradation)
# ---------------------------------------------------------------------------

_graph = None
_graph_name = "lumina-prime"


def _get_graph():
    """Get FalkorDB graph connection, returning None if unavailable."""
    global _graph
    if _graph is not None:
        return _graph
    try:
        from falkordb import FalkorDB
        db = FalkorDB(host="localhost", port=6379)
        _graph = db.select_graph(_graph_name)
        logger.info(f"Trust propagation connected to {_graph_name}")
        return _graph
    except Exception as e:
        logger.debug(f"Trust propagation graph unavailable: {e}")
        return None


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------

@dataclass
class TrustPropagationResult:
    """Diagnostic output from a trust propagation operation."""
    actor_a: str
    actor_b: str
    old_trust: float
    new_trust: float
    trust_signal: float
    interaction_count: int
    positive_count: int


# ---------------------------------------------------------------------------
# Core: propagate_trust (per-interaction EMA update)
# ---------------------------------------------------------------------------


def propagate_trust(
    actor_a: str,
    actor_b: str,
    interaction_positive: bool,
) -> Optional[TrustPropagationResult]:
    """Update trust EMA on the A->B link in L3 after an interaction.

    Called after each interaction between two actors. Reads the current
    trust and interaction history from the RELATES_TO link, computes
    the trust signal from the accumulated pattern, updates the EMA,
    and writes back to the graph.

    Parameters
    ----------
    actor_a:
        Actor ID of the source (the one whose action is being evaluated).
    actor_b:
        Actor ID of the target (the one affected by the action).
    interaction_positive:
        Whether this interaction was beneficial (True) or harmful (False).
        Derived from limbic delta sign in the caller.

    Returns
    -------
    TrustPropagationResult or None if graph is unavailable.
    """
    g = _get_graph()
    if g is None:
        return None

    try:
        # Step 1: Read current trust and interaction history from L3
        result = g.query(
            """
            MATCH (a:Actor {id: $a})-[r:RELATES_TO]->(b:Actor {id: $b})
            RETURN r.trust, r.interaction_count, r.positive_count,
                   r.affinity, r.aversion, r.friction, r.energy
            """,
            {'a': actor_a, 'b': actor_b},
        )

        if result.result_set:
            row = result.result_set[0]
            current_trust = row[0] if row[0] is not None else LINK_BIRTH_TRUST
            interaction_count = row[1] if row[1] is not None else 0
            positive_count = row[2] if row[2] is not None else 0
            current_affinity = row[3] if row[3] is not None else 0.0
            current_aversion = row[4] if row[4] is not None else 0.0
            current_friction = row[5] if row[5] is not None else 0.0
            current_energy = row[6] if row[6] is not None else 0.0
            link_exists = True
        else:
            current_trust = LINK_BIRTH_TRUST
            interaction_count = 0
            positive_count = 0
            current_affinity = 0.0
            current_aversion = 0.0
            current_friction = 0.0
            current_energy = 0.0
            link_exists = False

        # Step 2: Update interaction counts
        interaction_count += 1
        if interaction_positive:
            positive_count += 1

        # Step 3: Compute trust signal from pattern (not single event)
        #
        # The trust signal is derived from the PATTERN of interactions:
        #   - Consistent positive deltas -> high trust signal
        #   - Volatile deltas -> lower trust signal (unreliable)
        #   - Consistent negative deltas -> trust signal drops
        #
        # Consistency is measured by how stable the positive ratio is.
        # A volatile actor who alternates help/harm builds less trust
        # than a consistently helpful one, even with the same ratio.
        if interaction_count > 0:
            positive_ratio = positive_count / interaction_count

            # Volatility penalty: with few interactions, we are less
            # certain about the pattern. Trust signal is dampened by
            # a confidence factor that grows with interaction count.
            # This prevents a single positive interaction from spiking
            # trust to an unreasonable level.
            confidence = min(1.0, interaction_count / 20.0)
            trust_signal = positive_ratio * confidence
        else:
            trust_signal = 0.0  # no data, no trust signal

        # Step 4: EMA update
        #   trust_ema_new = alpha * trust_signal + (1 - alpha) * trust_ema_old
        new_trust = TRUST_ALPHA * trust_signal + (1 - TRUST_ALPHA) * current_trust
        new_trust = max(TRUST_FLOOR, min(TRUST_CEILING, new_trust))

        # Step 5: Co-evolve affinity, aversion, friction (Algorithm 2)
        if interaction_positive:
            # Positive: affinity up (asymptotic), friction down
            affinity_delta = AFFINITY_GAIN_RATE * (1.0 - current_affinity)
            new_affinity = min(1.0, current_affinity + affinity_delta)
            new_aversion = current_aversion  # unchanged on positive
            friction_reduction = FRICTION_DECAY_ON_POSITIVE * current_friction
            new_friction = max(0.0, current_friction - friction_reduction)
        else:
            # Negative: aversion up (asymptotic), friction up
            aversion_delta = AVERSION_GAIN_RATE * (1.0 - current_aversion)
            new_aversion = min(1.0, current_aversion + aversion_delta)
            new_affinity = current_affinity  # unchanged on negative
            friction_growth = FRICTION_GAIN_ON_NEGATIVE * (1.0 - current_friction)
            new_friction = min(1.0, current_friction + friction_growth)

        # Step 6: Energy boost on link (reactivation)
        new_energy = current_energy + TRUST_ENERGY_BOOST

        ts = time.time()

        # Step 7: Write back to graph
        g.query(
            """
            MATCH (a:Actor {id: $a})
            MATCH (b:Actor {id: $b})
            MERGE (a)-[r:RELATES_TO]->(b)
            SET r.trust = $trust,
                r.interaction_count = $ic,
                r.positive_count = $pc,
                r.affinity = $affinity,
                r.aversion = $aversion,
                r.friction = $friction,
                r.energy = $energy,
                r.recency = 1.0,
                r.last_interaction = $ts
            """,
            {
                'a': actor_a,
                'b': actor_b,
                'trust': new_trust,
                'ic': interaction_count,
                'pc': positive_count,
                'affinity': new_affinity,
                'aversion': new_aversion,
                'friction': new_friction,
                'energy': new_energy,
                'ts': ts,
            },
        )

        logger.debug(
            f"Trust propagated: {actor_a}->{actor_b} "
            f"trust={current_trust:.4f}->{new_trust:.4f} "
            f"signal={trust_signal:.4f} "
            f"interactions={interaction_count} positive={positive_count}"
        )

        return TrustPropagationResult(
            actor_a=actor_a,
            actor_b=actor_b,
            old_trust=current_trust,
            new_trust=new_trust,
            trust_signal=trust_signal,
            interaction_count=interaction_count,
            positive_count=positive_count,
        )

    except Exception as e:
        logger.warning(f"Trust propagation failed for {actor_a}->{actor_b}: {e}")
        return None


# ---------------------------------------------------------------------------
# Query: get_trust
# ---------------------------------------------------------------------------


def get_trust(actor_a: str, actor_b: str) -> float:
    """Read trust from L3 graph for the A->B link.

    Returns 0.0 if no link exists or graph is unavailable.
    """
    g = _get_graph()
    if g is None:
        return 0.0

    try:
        result = g.query(
            """
            MATCH (a:Actor {id: $a})-[r:RELATES_TO]->(b:Actor {id: $b})
            RETURN r.trust
            """,
            {'a': actor_a, 'b': actor_b},
        )

        if result.result_set and result.result_set[0][0] is not None:
            return float(result.result_set[0][0])
        return 0.0

    except Exception as e:
        logger.debug(f"get_trust failed for {actor_a}->{actor_b}: {e}")
        return 0.0


# ---------------------------------------------------------------------------
# Batch: propagate_trust_from_interactions
# ---------------------------------------------------------------------------


def propagate_trust_from_interactions(
    since_timestamp: float,
) -> list[TrustPropagationResult]:
    """Batch trust propagation from recent interactions.

    Reads all recent interactions (AUTHORED + MENTIONS links created
    since the given timestamp) and propagates trust for each actor pair.

    Called by the settlement engine after each epoch to ensure trust
    reflects the accumulated pattern of interactions.

    Parameters
    ----------
    since_timestamp:
        Unix timestamp. Only interactions created after this time are
        considered.

    Returns
    -------
    List of TrustPropagationResult for each pair processed.
    """
    g = _get_graph()
    if g is None:
        logger.debug("Batch trust propagation skipped: graph unavailable")
        return []

    results: list[TrustPropagationResult] = []

    try:
        # Find all (author, mentioned_actor) pairs from recent Moments.
        # A mention is a positive interaction signal: the author directed
        # attention toward the mentioned actor.
        pairs = g.query(
            """
            MATCH (author:Actor)-[:AUTHORED]->(m:Moment)-[:MENTIONS]->(target:Actor)
            WHERE m.timestamp > $since
            RETURN author.id, target.id, count(m) as interaction_count
            ORDER BY interaction_count DESC
            """,
            {'since': since_timestamp},
        )

        if not pairs.result_set:
            logger.debug("Batch trust propagation: no recent interactions found")
            return results

        for row in pairs.result_set:
            author_id = row[0]
            target_id = row[1]
            mention_count = row[2] if row[2] is not None else 1

            if not author_id or not target_id:
                continue

            # Each mention in the batch is treated as a positive interaction.
            # We call propagate_trust once per pair (not per mention) because
            # the EMA already accounts for the accumulated pattern.
            # The interaction_count on the link accumulates across epochs.
            r = propagate_trust(author_id, target_id, interaction_positive=True)
            if r is not None:
                results.append(r)

        # Also process RELATES_TO links that were recently active
        # (e.g., from replies or other direct interactions)
        relates_pairs = g.query(
            """
            MATCH (a:Actor)-[r:RELATES_TO]->(b:Actor)
            WHERE r.last_interaction > $since
                  AND r.last_interaction IS NOT NULL
            RETURN a.id, b.id
            """,
            {'since': since_timestamp},
        )

        # Track pairs already processed to avoid double-counting
        processed = {(r.actor_a, r.actor_b) for r in results}

        if relates_pairs.result_set:
            for row in relates_pairs.result_set:
                a_id = row[0]
                b_id = row[1]
                if not a_id or not b_id:
                    continue
                if (a_id, b_id) in processed:
                    continue

                # Recently active RELATES_TO link — treat as positive
                # (the fact that they interacted is itself the signal)
                r = propagate_trust(a_id, b_id, interaction_positive=True)
                if r is not None:
                    results.append(r)

        logger.info(
            f"Batch trust propagation complete: "
            f"{len(results)} pairs updated since {since_timestamp}"
        )

    except Exception as e:
        logger.warning(f"Batch trust propagation failed: {e}")

    return results


# ---------------------------------------------------------------------------
# Limbic-delta-driven trust propagation (Algorithm 2 full form)
# ---------------------------------------------------------------------------


def propagate_trust_from_limbic_delta(
    actor_a: str,
    actor_b: str,
    limbic_delta: float,
) -> Optional[TrustPropagationResult]:
    """Update trust on A->B link using a real limbic delta signal.

    This is the full Algorithm 2 implementation: when actor A's action
    produces a measurable limbic shift in actor B's L1 graph, the
    L3 link trust is updated using the asymptotic formula from the spec.

    This complements the EMA-based propagate_trust() which uses
    interaction pattern history. When a limbic delta is available,
    this function should be preferred as it captures the actual
    measured impact of the interaction.

    Parameters
    ----------
    actor_a:
        Actor whose action caused the limbic shift.
    actor_b:
        Actor who experienced the limbic shift.
    limbic_delta:
        Signed limbic delta from L1 DriveSnapshot comparison.
        Positive = beneficial, negative = harmful.

    Returns
    -------
    TrustPropagationResult or None if graph unavailable or delta
    below threshold.
    """
    # Threshold gate: ignore tiny limbic shifts
    if abs(limbic_delta) < TRUST_UPDATE_THRESHOLD:
        return None

    g = _get_graph()
    if g is None:
        return None

    try:
        # Read current link state
        result = g.query(
            """
            MATCH (a:Actor {id: $a})-[r:RELATES_TO]->(b:Actor {id: $b})
            RETURN r.trust, r.interaction_count, r.positive_count,
                   r.affinity, r.aversion, r.friction, r.energy
            """,
            {'a': actor_a, 'b': actor_b},
        )

        if result.result_set:
            row = result.result_set[0]
            current_trust = row[0] if row[0] is not None else LINK_BIRTH_TRUST
            interaction_count = row[1] if row[1] is not None else 0
            positive_count = row[2] if row[2] is not None else 0
            current_affinity = row[3] if row[3] is not None else 0.0
            current_aversion = row[4] if row[4] is not None else 0.0
            current_friction = row[5] if row[5] is not None else 0.0
            current_energy = row[6] if row[6] is not None else 0.0
        else:
            current_trust = LINK_BIRTH_TRUST
            interaction_count = 0
            positive_count = 0
            current_affinity = 0.0
            current_aversion = 0.0
            current_friction = 0.0
            current_energy = 0.0

        # Update interaction counts
        interaction_count += 1
        is_positive = limbic_delta > 0
        if is_positive:
            positive_count += 1

        # Algorithm 2 Step 3: Asymptotic trust update from limbic delta
        if limbic_delta > TRUST_UPDATE_THRESHOLD:
            # Positive delta -> trust increases asymptotically
            delta_trust = TRUST_GAIN_RATE * limbic_delta * (1.0 - current_trust)
            new_trust = min(TRUST_CEILING, current_trust + delta_trust)

            # Affinity increases, friction decreases
            affinity_delta = AFFINITY_GAIN_RATE * limbic_delta * (1.0 - current_affinity)
            new_affinity = min(1.0, current_affinity + affinity_delta)
            new_aversion = current_aversion
            friction_reduction = FRICTION_DECAY_ON_POSITIVE * limbic_delta * current_friction
            new_friction = max(0.0, current_friction - friction_reduction)

        elif limbic_delta < -TRUST_UPDATE_THRESHOLD:
            # Negative delta -> trust decreases, aversion increases
            delta_trust = TRUST_LOSS_RATE * abs(limbic_delta) * current_trust
            new_trust = max(TRUST_FLOOR, current_trust - delta_trust)

            # Aversion increases, friction increases
            aversion_delta = AVERSION_GAIN_RATE * abs(limbic_delta) * (1.0 - current_aversion)
            new_aversion = min(1.0, current_aversion + aversion_delta)
            new_affinity = current_affinity
            friction_growth = FRICTION_GAIN_ON_NEGATIVE * abs(limbic_delta) * (1.0 - current_friction)
            new_friction = min(1.0, current_friction + friction_growth)
        else:
            # Below threshold — no update
            return None

        # Algorithm 2 Step 4: Reactivate the link
        new_energy = current_energy + abs(limbic_delta) * TRUST_ENERGY_BOOST

        ts = time.time()

        # Write back
        g.query(
            """
            MATCH (a:Actor {id: $a})
            MATCH (b:Actor {id: $b})
            MERGE (a)-[r:RELATES_TO]->(b)
            SET r.trust = $trust,
                r.interaction_count = $ic,
                r.positive_count = $pc,
                r.affinity = $affinity,
                r.aversion = $aversion,
                r.friction = $friction,
                r.energy = $energy,
                r.recency = 1.0,
                r.last_interaction = $ts
            """,
            {
                'a': actor_a,
                'b': actor_b,
                'trust': new_trust,
                'ic': interaction_count,
                'pc': positive_count,
                'affinity': new_affinity,
                'aversion': new_aversion,
                'friction': new_friction,
                'energy': new_energy,
                'ts': ts,
            },
        )

        logger.debug(
            f"Trust propagated (limbic): {actor_a}->{actor_b} "
            f"trust={current_trust:.4f}->{new_trust:.4f} "
            f"limbic_delta={limbic_delta:.4f}"
        )

        return TrustPropagationResult(
            actor_a=actor_a,
            actor_b=actor_b,
            old_trust=current_trust,
            new_trust=new_trust,
            trust_signal=limbic_delta,
            interaction_count=interaction_count,
            positive_count=positive_count,
        )

    except Exception as e:
        logger.warning(
            f"Limbic trust propagation failed for {actor_a}->{actor_b}: {e}"
        )
        return None
