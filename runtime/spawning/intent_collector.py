# DOCS: mind-protocol/docs/spawning/the_prism/ALGORITHM_The_Prism.md (Step 1)
"""
Intent Collection — Embed paragraphs, validate quality, compute weighted centroid.

Each godparent writes a substantive paragraph (min 20 words) describing what kind of
citizen the world needs. These paragraphs are embedded into R^D and combined via
weighted centroid to form the intent vector that drives the prismatic projection.
"""

import logging
from dataclasses import dataclass, field

import numpy as np

logger = logging.getLogger("mind.spawning.intent")

MIN_INTENT_WORDS = 20
MIN_EMBEDDING_MAGNITUDE = 0.1


@dataclass
class IntentResult:
    """Output of intent collection: validated paragraphs + combined intent vector."""
    intent_vector: np.ndarray          # R^D — weighted centroid of all paragraphs
    intent_matrix: np.ndarray          # [N_intents x 1536] — each paragraph embedded
    paragraphs: list[str]              # Original paragraphs, preserved verbatim
    weights: list[float]               # Weight per paragraph
    quality_scores: list[float] = field(default_factory=list)


def collect_intent(
    paragraphs: list[str],
    weights: list[float] | None,
    embed_fn,
) -> IntentResult:
    """Embed intent paragraphs, validate quality, compute weighted centroid.

    Args:
        paragraphs: Free-text intent paragraphs from godparents.
        weights: Optional weights per paragraph. Defaults to equal weight.
        embed_fn: Callable that takes list[str] and returns list[list[float]].

    Returns:
        IntentResult with intent vector, matrix, and quality scores.

    Raises:
        ValueError: If any paragraph fails validation.
    """
    if not paragraphs:
        raise ValueError("At least one intent paragraph is required.")

    if weights is None:
        weights = [1.0] * len(paragraphs)

    if len(weights) != len(paragraphs):
        raise ValueError(
            f"Weight count ({len(weights)}) must match paragraph count ({len(paragraphs)})."
        )

    # Validate each paragraph
    quality_scores = []
    for i, paragraph in enumerate(paragraphs):
        score = _validate_paragraph(paragraph, index=i)
        quality_scores.append(score)

    # Embed all paragraphs in one API call
    embeddings_raw = embed_fn(paragraphs)
    embeddings = [np.array(e, dtype=np.float64) for e in embeddings_raw]

    # Validate embedding magnitudes
    for i, emb in enumerate(embeddings):
        mag = np.linalg.norm(emb)
        if mag < MIN_EMBEDDING_MAGNITUDE:
            raise ValueError(
                f"Intent paragraph {i} produced near-zero embedding (magnitude={mag:.4f}). "
                f"The text may be too generic or empty."
            )

    # Build intent matrix [N_intents x D]
    intent_matrix = np.stack(embeddings)

    # Compute weighted centroid
    w = np.array(weights, dtype=np.float64)
    w = w / w.sum()  # normalize weights
    intent_vector = (intent_matrix.T @ w)  # [D]
    intent_vector = intent_vector / np.linalg.norm(intent_vector)  # unit sphere

    logger.info(
        f"Intent collected: {len(paragraphs)} paragraphs, "
        f"centroid magnitude={np.linalg.norm(intent_vector):.4f}"
    )

    return IntentResult(
        intent_vector=intent_vector,
        intent_matrix=intent_matrix,
        paragraphs=paragraphs,
        weights=weights,
        quality_scores=quality_scores,
    )


def _validate_paragraph(paragraph: str, index: int) -> float:
    """Validate a single intent paragraph. Returns quality score [0, 1].

    Raises ValueError if paragraph is below minimum quality.
    """
    text = paragraph.strip()
    if not text:
        raise ValueError(f"Intent paragraph {index} is empty.")

    word_count = len(text.split())
    if word_count < MIN_INTENT_WORDS:
        raise ValueError(
            f"Intent paragraph {index} has {word_count} words "
            f"(minimum: {MIN_INTENT_WORDS}). Intent must be substantive — "
            f"describe what kind of citizen the world needs and why."
        )

    # Quality score: word count normalized (20 words = 0.5, 100+ words = 1.0)
    score = min(1.0, word_count / 100.0)
    return max(0.2, score)  # floor at 0.2 for minimum-length paragraphs
