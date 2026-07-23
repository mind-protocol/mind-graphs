# DOCS: mind-protocol/docs/memory/the_anamnesis/VALIDATION_The_Anamnesis.md
"""
Quality Gate — Measure brain health before/after Anamnesis.

The Anamnesis is a transaction:
  1. Snapshot brain health metrics (BEFORE)
  2. Run anamnesis pipeline
  3. Snapshot brain health metrics (AFTER)
  4. Compare: COMMIT if improved, ROLLBACK if degraded

Metrics measured:
  - cognitive_balance: distribution entropy of node types (higher = more balanced)
  - connectivity: average links per node (higher = richer associations)
  - embedding_spread: mean pairwise distance (too low = collapsed, too high = scattered)
  - node_quality: mean embedding magnitude × content length (low = garbage)
  - cluster_coherence: ratio of within-space similarity to between-space similarity
  - uniqueness: 1 - (duplicates found / total nodes)

Decision: improved if at least 4/6 metrics are equal or better,
and NO metric degraded by more than 10%.
"""

import logging
from dataclasses import dataclass, field
from collections import Counter

import numpy as np

logger = logging.getLogger("mind.anamnesis.quality")


@dataclass
class BrainHealthSnapshot:
    """Point-in-time brain health metrics."""
    total_nodes: int = 0
    total_links: int = 0
    node_type_distribution: dict[str, int] = field(default_factory=dict)

    # Computed metrics (0.0-1.0 normalized where possible)
    cognitive_balance: float = 0.0       # entropy of node type distribution
    connectivity: float = 0.0            # avg links per node
    embedding_spread: float = 0.0        # mean pairwise cosine distance
    node_quality: float = 0.0            # mean(magnitude × log(content_len))
    cluster_coherence: float = 0.0       # within/between cluster similarity ratio
    uniqueness: float = 1.0              # 1 - duplicate ratio

    def to_dict(self) -> dict:
        return {
            "total_nodes": self.total_nodes,
            "total_links": self.total_links,
            "cognitive_balance": round(self.cognitive_balance, 4),
            "connectivity": round(self.connectivity, 4),
            "embedding_spread": round(self.embedding_spread, 4),
            "node_quality": round(self.node_quality, 4),
            "cluster_coherence": round(self.cluster_coherence, 4),
            "uniqueness": round(self.uniqueness, 4),
        }


@dataclass
class QualityVerdict:
    """Result of before/after comparison."""
    approved: bool
    before: BrainHealthSnapshot
    after: BrainHealthSnapshot
    improvements: list[str] = field(default_factory=list)
    degradations: list[str] = field(default_factory=list)
    unchanged: list[str] = field(default_factory=list)
    reason: str = ""


METRICS = [
    "cognitive_balance", "connectivity", "embedding_spread",
    "node_quality", "cluster_coherence", "uniqueness",
]

# Maximum allowed degradation per metric (10%)
MAX_DEGRADATION = 0.10


def snapshot_brain_health(
    citizen_handle: str,
    graph_ops=None,
) -> BrainHealthSnapshot:
    """Take a health snapshot of a citizen's brain graph.

    Works with or without graph_ops — if None, returns empty snapshot
    (useful for first-time anamnesis on empty brain).
    """
    snap = BrainHealthSnapshot()

    if graph_ops is None:
        return snap

    graph_name = f"brain_{citizen_handle}"

    try:
        nodes = graph_ops.get_all_nodes(graph_name=graph_name)
    except Exception:
        return snap

    if not nodes:
        return snap

    snap.total_nodes = len(nodes)

    # Node type distribution
    type_counts = Counter()
    embeddings = []
    content_lengths = []
    node_ids = set()

    for n in nodes:
        ntype = n.get("memory_type") or n.get("type") or n.get("node_type") or "unknown"
        type_counts[ntype] += 1
        node_ids.add(n.get("id", ""))

        emb = n.get("embedding")
        if emb and len(emb) > 0:
            embeddings.append(np.array(emb, dtype=np.float64))

        content = n.get("content", "") or ""
        content_lengths.append(len(content))

    snap.node_type_distribution = dict(type_counts)

    # Cognitive balance: Shannon entropy of type distribution, normalized
    if type_counts:
        total = sum(type_counts.values())
        probs = [c / total for c in type_counts.values()]
        entropy = -sum(p * np.log2(p) for p in probs if p > 0)
        max_entropy = np.log2(len(type_counts)) if len(type_counts) > 1 else 1.0
        snap.cognitive_balance = entropy / max_entropy if max_entropy > 0 else 0.0

    # Connectivity: count links
    try:
        # Try to get link count from graph
        all_links = graph_ops.get_all_links(graph_name=graph_name)
        snap.total_links = len(all_links) if all_links else 0
        snap.connectivity = snap.total_links / max(1, snap.total_nodes)
    except Exception:
        snap.connectivity = 0.0

    # Embedding spread: mean pairwise distance (sample if too many)
    if len(embeddings) >= 2:
        sample_size = min(100, len(embeddings))
        if len(embeddings) > sample_size:
            indices = np.random.choice(len(embeddings), sample_size, replace=False)
            sample = [embeddings[i] for i in indices]
        else:
            sample = embeddings

        distances = []
        for i in range(len(sample)):
            for j in range(i + 1, min(i + 10, len(sample))):
                sim = _cosine_similarity(sample[i], sample[j])
                distances.append(1.0 - sim)

        snap.embedding_spread = float(np.mean(distances)) if distances else 0.0

    # Node quality: mean(magnitude × log(content_len + 1))
    if embeddings and content_lengths:
        qualities = []
        for emb, clen in zip(embeddings, content_lengths[:len(embeddings)]):
            mag = float(np.linalg.norm(emb))
            q = mag * np.log1p(clen)
            qualities.append(q)
        snap.node_quality = float(np.mean(qualities))

    # Cluster coherence (spaces vs between spaces)
    snap.cluster_coherence = _compute_cluster_coherence(nodes, embeddings)

    # Uniqueness: check for near-duplicates
    if len(embeddings) >= 2:
        dup_count = 0
        checked = 0
        for i in range(min(200, len(embeddings))):
            for j in range(i + 1, min(i + 5, len(embeddings))):
                if _cosine_similarity(embeddings[i], embeddings[j]) > 0.92:
                    dup_count += 1
                checked += 1
        snap.uniqueness = 1.0 - (dup_count / max(1, checked))

    return snap


def compare_snapshots(
    before: BrainHealthSnapshot,
    after: BrainHealthSnapshot,
) -> QualityVerdict:
    """Compare before/after snapshots and produce a verdict.

    Rules:
    - At least 4/6 metrics must be equal or improved
    - No single metric may degrade by more than 10%
    - Empty brain before = auto-approve (first anamnesis)
    """
    verdict = QualityVerdict(approved=False, before=before, after=after)

    # First anamnesis on empty brain: auto-approve
    if before.total_nodes == 0:
        verdict.approved = True
        verdict.reason = "First anamnesis on empty brain — auto-approved"
        return verdict

    for metric in METRICS:
        val_before = getattr(before, metric)
        val_after = getattr(after, metric)

        if val_before == 0:
            if val_after > 0:
                verdict.improvements.append(f"{metric}: 0 → {val_after:.4f}")
            else:
                verdict.unchanged.append(metric)
            continue

        delta = (val_after - val_before) / abs(val_before)

        if delta > 0.001:
            verdict.improvements.append(
                f"{metric}: {val_before:.4f} → {val_after:.4f} (+{delta:.1%})"
            )
        elif delta < -0.001:
            verdict.degradations.append(
                f"{metric}: {val_before:.4f} → {val_after:.4f} ({delta:.1%})"
            )
        else:
            verdict.unchanged.append(metric)

    # Decision logic
    improved_or_stable = len(verdict.improvements) + len(verdict.unchanged)
    severe_degradation = any(
        _metric_degradation(before, after, m) > MAX_DEGRADATION
        for m in METRICS
    )

    if severe_degradation:
        bad = [
            m for m in METRICS
            if _metric_degradation(before, after, m) > MAX_DEGRADATION
        ]
        verdict.approved = False
        verdict.reason = (
            f"Severe degradation (>{MAX_DEGRADATION:.0%}) in: {', '.join(bad)}. "
            f"Rollback recommended."
        )
    elif improved_or_stable >= 4:
        verdict.approved = True
        verdict.reason = (
            f"{len(verdict.improvements)} improved, "
            f"{len(verdict.unchanged)} stable, "
            f"{len(verdict.degradations)} minor degradations"
        )
    else:
        verdict.approved = False
        verdict.reason = (
            f"Only {improved_or_stable}/6 metrics stable or improved. "
            f"Degradations: {'; '.join(verdict.degradations)}"
        )

    return verdict


def _metric_degradation(before: BrainHealthSnapshot, after: BrainHealthSnapshot, metric: str) -> float:
    """Return absolute degradation ratio for a metric (0 = no degradation)."""
    val_before = getattr(before, metric)
    val_after = getattr(after, metric)
    if val_before == 0:
        return 0.0
    delta = (val_after - val_before) / abs(val_before)
    return max(0.0, -delta)  # only negative deltas count


def _compute_cluster_coherence(nodes: list[dict], embeddings: list[np.ndarray]) -> float:
    """Ratio of within-space similarity to between-space similarity."""
    if len(embeddings) < 4:
        return 0.5

    # Group by space (conversation_id)
    space_groups: dict[str, list[int]] = {}
    for i, n in enumerate(nodes):
        if i >= len(embeddings):
            break
        space = n.get("source_conversation", n.get("conversation_id", "default"))
        space_groups.setdefault(space, []).append(i)

    if len(space_groups) < 2:
        return 0.5

    within_sims = []
    between_sims = []

    spaces = list(space_groups.values())
    for group in spaces[:10]:  # sample up to 10 spaces
        # Within-space pairs
        for i in range(min(5, len(group))):
            for j in range(i + 1, min(5, len(group))):
                within_sims.append(
                    _cosine_similarity(embeddings[group[i]], embeddings[group[j]])
                )

    # Between-space pairs (sample)
    for si in range(min(5, len(spaces))):
        for sj in range(si + 1, min(5, len(spaces))):
            if spaces[si] and spaces[sj]:
                between_sims.append(
                    _cosine_similarity(embeddings[spaces[si][0]], embeddings[spaces[sj][0]])
                )

    if not within_sims or not between_sims:
        return 0.5

    within_mean = float(np.mean(within_sims))
    between_mean = float(np.mean(between_sims))

    if between_mean == 0:
        return 1.0

    return min(1.0, within_mean / between_mean)


from runtime.utils import cosine_similarity as _cosine_similarity  # canonical impl
