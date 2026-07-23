# DOCS: mind-protocol/docs/spawning/the_prism/ALGORITHM_The_Prism.md (Step 6)
"""
Safety Validator — Three hard gates with dynamic thresholds.

All thresholds are computed from the existing population: mean + 1σ.
Each generation of citizens must be better than the last.
Absolute floors prevent degenerate first-generation bootstrapping.

Gate 1: Empathy — cosine similarity to empathy anchors > dynamic threshold
Gate 2: Concentration — max category fraction < dynamic threshold (inverted: mean - 1σ)
Gate 3: Diversity — cosine distance from ALL existing citizens > dynamic threshold

On failure: REJECT with explanation. Never auto-repair.
"""

import logging
from collections import Counter
from dataclasses import dataclass

import numpy as np

from runtime.spawning.seed_assembler import SeedBrain, SeedNode

logger = logging.getLogger("mind.spawning.safety")

# Absolute floors — below these, no amount of population statistics helps
EMPATHY_FLOOR = 0.3
CONCENTRATION_CEILING = 0.60     # never allow > 60% even if population is worse
CONCENTRATION_MIN_CATEGORIES = 3
DIVERSITY_FLOOR = 0.03           # never allow distance < 0.03 even if population is tight

# Empathy anchor phrases — embedded at validation time
EMPATHY_ANCHORS = [
    "I care deeply about the wellbeing of others and want to help them thrive.",
    "Empathy, compassion, and understanding are core to who I am.",
    "I listen to others, feel their struggles, and act to reduce suffering.",
]


@dataclass
class PopulationStats:
    """Population-level statistics for dynamic threshold computation."""
    empathy_scores: list[float] | None = None       # best empathy similarity per citizen
    concentration_scores: list[float] | None = None  # max category fraction per citizen
    diversity_distances: list[float] | None = None   # nearest-neighbor distance per citizen


@dataclass
class CheckResult:
    """Result of a single safety check."""
    passed: bool
    details: dict


@dataclass
class SafetyReport:
    """Complete safety validation result."""
    passed: bool
    empathy_check: CheckResult
    concentration_check: CheckResult
    diversity_check: CheckResult
    rejection_reason: str | None = None
    suggested_adjustments: list[str] | None = None


def validate_seed(
    seed_brain: SeedBrain,
    existing_centroids: list[tuple[str, np.ndarray]],
    embed_fn=None,
    population_stats: PopulationStats | None = None,
) -> SafetyReport:
    """Run all three safety gates with dynamic thresholds.

    Every threshold is computed from the existing population: mean + 1σ
    (or mean - 1σ for concentration, since lower is better).
    Each generation must improve on the last. Physics, not policy.

    Args:
        seed_brain: The crystallized seed brain to validate.
        existing_centroids: All existing citizen centroids for diversity check.
        embed_fn: Callable for embedding empathy anchor phrases.
        population_stats: Pre-computed population statistics for dynamic thresholds.
            If None, uses absolute floors (bootstrap mode).

    Returns:
        SafetyReport with pass/fail and detailed results.
    """
    if population_stats is None:
        population_stats = PopulationStats()

    # Compute dynamic thresholds
    empathy_threshold = _dynamic_threshold_rising(
        population_stats.empathy_scores, EMPATHY_FLOOR, "empathy"
    )
    concentration_threshold = _dynamic_threshold_falling(
        population_stats.concentration_scores, CONCENTRATION_CEILING, "concentration"
    )
    diversity_threshold = _dynamic_threshold_rising(
        population_stats.diversity_distances, DIVERSITY_FLOOR, "diversity"
    )

    empathy = check_empathy(seed_brain.nodes, embed_fn, threshold=empathy_threshold)
    concentration = check_concentration(
        seed_brain.nodes, threshold=concentration_threshold
    )
    diversity = check_diversity(
        seed_brain.centroid, existing_centroids, threshold=diversity_threshold
    )

    passed = empathy.passed and concentration.passed and diversity.passed

    rejection_reason = None
    adjustments = None

    if not passed:
        reasons = []
        adjustments = []

        if not empathy.passed:
            t = empathy.details.get("threshold", "?")
            score = empathy.details.get("nearest_distance", 0)
            reasons.append(
                f"Empathy gate failed: score {score:.3f} < threshold {t:.3f}"
            )
            adjustments.append(
                "Add intent language about care, compassion, or concern for others. "
                "The child needs at least one empathy-adjacent trait."
            )

        if not concentration.passed:
            dist = concentration.details.get("distribution", {})
            top_cat = max(dist, key=dist.get) if dist else "unknown"
            t = concentration.details.get("threshold", "?")
            reasons.append(
                f"Concentration gate failed: category '{top_cat}' is "
                f"{dist.get(top_cat, 0):.0%} of seed (threshold: {t:.0%})"
            )
            adjustments.append(
                "Diversify intent — include aspects beyond the dominant category. "
                "A mind needs breadth, not just depth."
            )

        if not diversity.passed:
            nearest = diversity.details.get("nearest_citizen", "unknown")
            dist_val = diversity.details.get("distance", 0)
            t = diversity.details.get("threshold", "?")
            reasons.append(
                f"Diversity gate failed: too similar to @{nearest} "
                f"(distance={dist_val:.4f}, threshold: {t:.4f})"
            )
            adjustments.append(
                f"The intended citizen is too similar to @{nearest}. "
                f"Adjust intent to create more distinct personality/expertise."
            )

        rejection_reason = "; ".join(reasons)

    report = SafetyReport(
        passed=passed,
        empathy_check=empathy,
        concentration_check=concentration,
        diversity_check=diversity,
        rejection_reason=rejection_reason,
        suggested_adjustments=adjustments,
    )

    if passed:
        logger.info("Safety validation PASSED — all three gates clear")
    else:
        logger.warning(f"Safety validation FAILED: {rejection_reason}")

    return report


# ── Dynamic threshold computation ────────────────────────────────────────


def _dynamic_threshold_rising(
    population_scores: list[float] | None,
    floor: float,
    name: str,
) -> float:
    """For metrics where HIGHER is better (empathy, diversity).

    Formula: max(floor, mean + 1σ)
    New citizens must exceed the current population by one standard deviation.
    """
    if not population_scores or len(population_scores) < 3:
        logger.info(f"Dynamic {name}: insufficient data, using floor {floor:.3f}")
        return floor

    scores = np.array(population_scores, dtype=np.float64)
    mean = float(np.mean(scores))
    std = float(np.std(scores))
    dynamic = mean + std

    threshold = max(floor, dynamic)
    logger.info(
        f"Dynamic {name}: {threshold:.3f} "
        f"(mean={mean:.3f}, σ={std:.3f}, floor={floor:.3f}, n={len(population_scores)})"
    )
    return threshold


def _dynamic_threshold_falling(
    population_scores: list[float] | None,
    ceiling: float,
    name: str,
) -> float:
    """For metrics where LOWER is better (concentration).

    Formula: min(ceiling, mean - 1σ)
    New citizens must be more balanced than the current population.
    Clamped to never go below a reasonable minimum (10%).
    """
    if not population_scores or len(population_scores) < 3:
        logger.info(f"Dynamic {name}: insufficient data, using ceiling {ceiling:.2f}")
        return ceiling

    scores = np.array(population_scores, dtype=np.float64)
    mean = float(np.mean(scores))
    std = float(np.std(scores))
    dynamic = mean - std

    # Never tighter than 10% (would make 10+ categories required)
    threshold = min(ceiling, max(0.10, dynamic))
    logger.info(
        f"Dynamic {name}: {threshold:.2f} "
        f"(mean={mean:.2f}, σ={std:.2f}, ceiling={ceiling:.2f}, n={len(population_scores)})"
    )
    return threshold


# ── Individual checks ────────────────────────────────────────────────────


def check_empathy(
    nodes: list[SeedNode],
    embed_fn=None,
    threshold: float | None = None,
) -> CheckResult:
    """At least one node with cosine similarity above threshold to empathy anchors."""
    if threshold is None:
        threshold = EMPATHY_FLOOR

    if embed_fn is None:
        logger.warning("Empathy check skipped: no embedding function provided")
        return CheckResult(passed=True, details={"skipped": True})

    anchor_embeddings = [
        np.array(e, dtype=np.float64)
        for e in embed_fn(EMPATHY_ANCHORS)
    ]

    best_similarity = 0.0
    best_node_content = ""

    for node in nodes:
        for anchor_emb in anchor_embeddings:
            sim = _cosine_similarity(node.embedding, anchor_emb)
            if sim > best_similarity:
                best_similarity = sim
                best_node_content = node.content[:80]

    passed = best_similarity >= threshold

    return CheckResult(
        passed=passed,
        details={
            "nearest_distance": best_similarity,
            "threshold": threshold,
            "threshold_type": "dynamic" if threshold != EMPATHY_FLOOR else "floor",
            "best_node": best_node_content,
        },
    )


def check_concentration(
    nodes: list[SeedNode],
    threshold: float | None = None,
) -> CheckResult:
    """No single category exceeds threshold. At least 3 categories present."""
    if threshold is None:
        threshold = CONCENTRATION_CEILING

    if not nodes:
        return CheckResult(passed=False, details={"error": "empty seed brain"})

    counts = Counter(n.node_type for n in nodes)
    total = len(nodes)
    distribution = {cat: count / total for cat, count in counts.items()}

    max_fraction = max(distribution.values())
    num_categories = len(distribution)

    passed = max_fraction <= threshold and num_categories >= CONCENTRATION_MIN_CATEGORIES

    return CheckResult(
        passed=passed,
        details={
            "distribution": distribution,
            "max_fraction": max_fraction,
            "num_categories": num_categories,
            "threshold": threshold,
            "threshold_type": "dynamic" if threshold != CONCENTRATION_CEILING else "ceiling",
            "min_categories": CONCENTRATION_MIN_CATEGORIES,
        },
    )


def check_diversity(
    seed_centroid: np.ndarray,
    existing_centroids: list[tuple[str, np.ndarray]],
    threshold: float | None = None,
) -> CheckResult:
    """Cosine distance from ALL existing citizens must exceed threshold."""
    if threshold is None:
        threshold = DIVERSITY_FLOOR

    if not existing_centroids:
        return CheckResult(
            passed=True,
            details={"nearest_citizen": None, "distance": 1.0, "note": "first citizen"},
        )

    nearest_handle = ""
    nearest_distance = float("inf")

    for handle, centroid in existing_centroids:
        sim = _cosine_similarity(seed_centroid, centroid)
        distance = 1.0 - sim
        if distance < nearest_distance:
            nearest_distance = distance
            nearest_handle = handle

    passed = nearest_distance > threshold

    return CheckResult(
        passed=passed,
        details={
            "nearest_citizen": nearest_handle,
            "distance": nearest_distance,
            "threshold": threshold,
            "threshold_type": "dynamic" if threshold != DIVERSITY_FLOOR else "floor",
        },
    )


from runtime.utils import cosine_similarity as _cosine_similarity  # canonical impl
