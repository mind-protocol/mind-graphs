"""
Shared utility functions for the Mind Protocol runtime.

This module holds commonly needed helpers that are used across multiple
subsystems (cognition, physics, anamnesis, membrane, spawning).  Keeping
them here avoids the 15-copy duplication problem.
"""

from __future__ import annotations

from typing import List, Optional, Sequence, Union

import numpy as np


def cosine_similarity(
    a: Optional[Union[List[float], Sequence[float], "np.ndarray"]],
    b: Optional[Union[List[float], Sequence[float], "np.ndarray"]],
) -> float:
    """Cosine similarity between two vectors.

    Accepts lists, sequences, or numpy arrays.
    Returns 0.0 on degenerate input (None, empty, zero-norm, length mismatch).
    """
    if a is None or b is None:
        return 0.0

    va = np.asarray(a, dtype=np.float64)
    vb = np.asarray(b, dtype=np.float64)

    if va.size == 0 or vb.size == 0 or va.shape != vb.shape:
        return 0.0

    norm_a = np.linalg.norm(va)
    norm_b = np.linalg.norm(vb)

    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0

    return float(np.dot(va, vb) / (norm_a * norm_b))
