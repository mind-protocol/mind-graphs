# DOCS: mind-protocol/docs/spawning/the_prism/ALGORITHM_The_Prism.md (Step 2)
"""
Godparent Selection — Score and select godparents from candidates.

Candidates are scored by domain affinity to intent (0.4), brain health (0.3),
godchild load (0.15), and trust level (0.15). Minimum 2 godparents selected.
"""

import logging
from dataclasses import dataclass

import numpy as np

logger = logging.getLogger("mind.spawning.godparent")

# Scoring weights (from ALGORITHM spec — needs empirical calibration)
W_AFFINITY = 0.40
W_HEALTH = 0.30
W_LOAD = 0.15
W_TRUST = 0.15

MIN_GODPARENTS = 2
MAX_GODPARENTS = 6
MIN_SCORE = 0.1  # candidates below this are excluded


@dataclass
class GodparentCandidate:
    """A candidate godparent with scoring inputs."""
    handle: str
    brain_centroid: np.ndarray    # R^D — centroid of their brain nodes
    health_score: float           # [0, 1] — brain health from GraphCare
    godchild_count: int           # number of existing godchildren
    trust_level: float            # [0, 1] — trust score
    intent_paragraph: str         # their intent paragraph for this birth


@dataclass
class SelectedGodparent:
    """A selected godparent with final score."""
    handle: str
    score: float
    brain_centroid: np.ndarray
    intent_paragraph: str


def select_godparents(
    candidates: list[GodparentCandidate],
    intent_vector: np.ndarray,
) -> list[SelectedGodparent]:
    """Score candidates and select top godparents.

    Args:
        candidates: Godparent candidates with brain data and scores.
        intent_vector: R^D intent centroid from intent collection.

    Returns:
        Selected godparents (2-6), ranked by score.

    Raises:
        ValueError: If fewer than 2 candidates qualify.
    """
    if len(candidates) < MIN_GODPARENTS:
        raise ValueError(
            f"At least {MIN_GODPARENTS} godparent candidates required, "
            f"got {len(candidates)}."
        )

    scored = []
    for candidate in candidates:
        score = _score_candidate(candidate, intent_vector)
        if score >= MIN_SCORE:
            scored.append((candidate, score))

    scored.sort(key=lambda x: x[1], reverse=True)

    if len(scored) < MIN_GODPARENTS:
        raise ValueError(
            f"Only {len(scored)} candidates scored above threshold ({MIN_SCORE}). "
            f"Need at least {MIN_GODPARENTS}. Consider adjusting intent or "
            f"recruiting more godparents."
        )

    selected_pairs = scored[:MAX_GODPARENTS]

    selected = [
        SelectedGodparent(
            handle=c.handle,
            score=s,
            brain_centroid=c.brain_centroid,
            intent_paragraph=c.intent_paragraph,
        )
        for c, s in selected_pairs
    ]

    logger.info(
        f"Selected {len(selected)} godparents from {len(candidates)} candidates: "
        f"{[g.handle for g in selected]} "
        f"(scores: {[f'{g.score:.3f}' for g in selected]})"
    )

    return selected


def _score_candidate(
    candidate: GodparentCandidate,
    intent_vector: np.ndarray,
) -> float:
    """Score a single godparent candidate.

    Formula: 0.4 * affinity + 0.3 * health + 0.15 * (1 - load_penalty) + 0.15 * trust
    """
    # Domain affinity: cosine similarity between candidate brain centroid and intent
    affinity = _cosine_similarity(candidate.brain_centroid, intent_vector)
    affinity = max(0.0, affinity)  # clamp negative similarities

    # Health: direct score
    health = candidate.health_score

    # Load: penalize candidates with many godchildren (diminishing returns on parenting)
    load_penalty = min(1.0, candidate.godchild_count / 10.0)
    load_score = 1.0 - load_penalty

    # Trust: direct score
    trust = candidate.trust_level

    score = (
        W_AFFINITY * affinity
        + W_HEALTH * health
        + W_LOAD * load_score
        + W_TRUST * trust
    )

    logger.debug(
        f"  {candidate.handle}: affinity={affinity:.3f} health={health:.3f} "
        f"load={load_score:.3f} trust={trust:.3f} => score={score:.3f}"
    )

    return score


from runtime.utils import cosine_similarity as _cosine_similarity  # canonical impl
