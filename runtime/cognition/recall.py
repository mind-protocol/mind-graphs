"""Question-driven recall over one complete L1 Space.

The caller supplies a snapshot of every node and internal link in the Space.
Recall adds one central question Moment, injects energy only there, and lets
the canonical L1 propagation/decay/competition laws determine what resonates.

This module is deliberately graph-backend agnostic. Persistence and Space
closure resolution belong to the MCP adapter in ``mcp.tools.recall_handler``.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional

from runtime.cognition.laws.law_02_propagation import propagate_energy
from runtime.cognition.laws.law_03_energy_decay import decay_energy
from runtime.cognition.laws.law_04_attentional_competition import (
    select_working_memory,
)
from runtime.cognition.models import (
    CitizenCognitiveState,
    Link,
    LinkType,
    Node,
    NodeType,
)
from runtime.physics.subentity import (
    ExplorationContext,
    SubEntity,
    create_subentity,
)
from runtime.utils import cosine_similarity


QUESTION_CENTRALITY = 0.8
SEMANTIC_EXPONENT = 0.65
ACTIVATION_EXPONENT = 0.35
MINIMUM_SEMANTIC_COMPATIBILITY = 0.20
MIN_CONTEXT_LINK_WEIGHT = 0.01
DEFAULT_RECALL_ENERGY = 1.0
MIN_RECALL_ENERGY = 0.21
MAX_RECALL_ENERGY = 5.0
DEFAULT_MAX_TICKS = 8
MAX_TICKS_LIMIT = 64
CONVERGENCE_WINDOW = 2
RESULT_EPSILON = 1e-9


@dataclass
class RecallGraphNode:
    """Backend-neutral projection of one node in the recalled Space."""

    id: str
    content: str = ""
    node_type: str = "concept"
    semantic_type: str = ""
    embedding: list[float] = field(default_factory=list)
    energy: float = 0.0
    weight: float = 0.1
    stability: float = 0.0
    recency: float = 1.0
    status: str = ""
    epistemic_status: str = "unknown"


@dataclass
class RecallGraphLink:
    """Backend-neutral projection of one internal Space link."""

    source_id: str
    target_id: str
    relation: str = "associates"
    weight: float = 0.5
    activation_gain: float = 1.0
    friction: float = 0.0
    trust: float = 0.5


@dataclass
class SubentitySelection:
    """Observable routing decision for the recall exploration."""

    parent_id: Optional[str] = None
    semantic: Optional[float] = None
    activation: Optional[float] = None
    combined: Optional[float] = None


@dataclass
class RecallResultNode:
    """One node whose energy increased during recall."""

    node_id: str
    score: float
    semantic_similarity: float
    energy_before: float
    energy_after: float
    epistemic_status: str


@dataclass
class RecallOutcome:
    """Complete deterministic result of one recall run."""

    moment_id: str
    recall_subentity_id: str
    selection: SubentitySelection
    stimulus_node_count: int
    stimulus_link_count: int
    injected_energy: float
    ticks_run: int
    stop_reason: str
    status: str
    results: list[RecallResultNode]
    result_limit: int
    final_energies: dict[str, float]
    remaining_question_energy: float
    missing_embedding_count: int

    def to_dict(self) -> dict[str, Any]:
        visible_results = self.results[:self.result_limit]
        return {
            "momentId": self.moment_id,
            "recallSubentityId": self.recall_subentity_id,
            "parentSubentityId": self.selection.parent_id,
            "selection": {
                "semantic": self.selection.semantic,
                "activation": self.selection.activation,
                "combined": self.selection.combined,
            },
            "stimulusNodeCount": self.stimulus_node_count,
            "stimulusLinkCount": self.stimulus_link_count,
            "injectedEnergy": self.injected_energy,
            "ticksRun": self.ticks_run,
            "stopReason": self.stop_reason,
            "status": self.status,
            "results": [
                {
                    "nodeId": item.node_id,
                    "score": item.score,
                    "semanticSimilarity": item.semantic_similarity,
                    "energyBefore": item.energy_before,
                    "energyAfter": item.energy_after,
                    "epistemicStatus": item.epistemic_status,
                }
                for item in visible_results
            ],
            "allResultCount": len(self.results),
            "missingEmbeddingCount": self.missing_embedding_count,
        }


def parse_embedding(value: Any) -> list[float]:
    """Normalize list or JSON-serialized embeddings without inventing values."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return []
    if not isinstance(value, (list, tuple)):
        return []
    try:
        result = [float(component) for component in value]
    except (TypeError, ValueError):
        return []
    return result if result and all(math.isfinite(v) for v in result) else []


def _mean_embedding(embeddings: Iterable[list[float]]) -> list[float]:
    usable = [embedding for embedding in embeddings if embedding]
    if not usable:
        return []
    dimension = len(usable[0])
    usable = [embedding for embedding in usable if len(embedding) == dimension]
    if not usable:
        return []
    centroid = [
        sum(embedding[index] for embedding in usable) / len(usable)
        for index in range(dimension)
    ]
    magnitude = math.sqrt(sum(value * value for value in centroid))
    return [value / magnitude for value in centroid] if magnitude else []


def _blend_embeddings(
    question_embedding: list[float],
    space_centroid: list[float],
) -> list[float]:
    if not space_centroid or len(space_centroid) != len(question_embedding):
        return list(question_embedding)
    blended = [
        QUESTION_CENTRALITY * question
        + (1.0 - QUESTION_CENTRALITY) * context
        for question, context in zip(question_embedding, space_centroid)
    ]
    magnitude = math.sqrt(sum(value * value for value in blended))
    return [value / magnitude for value in blended] if magnitude else list(question_embedding)


def _safe_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    return max(0.0, min(1.0, float(cosine_similarity(left, right))))


def select_active_subentity(
    nodes: Iterable[RecallGraphNode],
    stimulus_centroid: list[float],
) -> SubentitySelection:
    """Select a semantically compatible active Subentity.

    Semantic compatibility dominates, while a zero-activation candidate cannot
    capture the question. Candidates below the semantic gate are rejected.
    """
    candidates = [
        node
        for node in nodes
        if node.semantic_type.strip().lower() in {"subentity", "sub_entity"}
        and node.energy > 0.0
        and node.embedding
    ]
    if not candidates:
        return SubentitySelection()

    activation_ceiling = max(max(node.energy, 0.0) for node in candidates)
    if activation_ceiling <= 0.0:
        activation_ceiling = 1.0

    ranked: list[tuple[float, float, float, str]] = []
    for node in candidates:
        semantic = _safe_similarity(stimulus_centroid, node.embedding)
        if semantic < MINIMUM_SEMANTIC_COMPATIBILITY:
            continue
        activation = min(1.0, max(node.energy, 0.0) / activation_ceiling)
        combined = (
            semantic ** SEMANTIC_EXPONENT
            * activation ** ACTIVATION_EXPONENT
        )
        ranked.append((combined, semantic, activation, node.id))

    if not ranked:
        return SubentitySelection()
    combined, semantic, activation, node_id = max(
        ranked,
        key=lambda item: (item[0], item[1], item[2], item[3]),
    )
    return SubentitySelection(
        parent_id=node_id,
        semantic=semantic,
        activation=activation,
        combined=combined,
    )


def _create_recall_subentity(
    *,
    citizen_id: str,
    moment_id: str,
    question: str,
    question_embedding: list[float],
    selection: SubentitySelection,
    nodes: list[RecallGraphNode],
) -> SubEntity:
    """Create the actual runtime SubEntity and its optional selected parent."""
    context = ExplorationContext()
    if selection.parent_id:
        selected = next(
            node for node in nodes if node.id == selection.parent_id
        )
        parent = SubEntity(
            id=selected.id,
            actor_id=citizen_id,
            position=selected.id,
            run_position=selected.id,
            query=selected.content,
            query_embedding=list(selected.embedding),
            intention=selected.content,
            intention_embedding=list(selected.embedding),
            crystallization_embedding=list(selected.embedding),
        )
        context.register(parent)

    child = create_subentity(
        actor_id=citizen_id,
        origin_moment=moment_id,
        query=question,
        query_embedding=question_embedding,
        intention=question,
        intention_embedding=question_embedding,
        start_position=moment_id,
        context=context,
    )
    if selection.parent_id:
        child.parent_id = selection.parent_id
        parent.children_ids.append(child.id)
    return child


def _node_type(value: str) -> NodeType:
    normalized = str(value or "").strip().lower()
    aliases = {
        "moment": NodeType.MEMORY,
        "actor": NodeType.CONCEPT,
        "thing": NodeType.CONCEPT,
        "space": NodeType.CONCEPT,
    }
    if normalized in aliases:
        return aliases[normalized]
    try:
        return NodeType(normalized)
    except ValueError:
        return NodeType.CONCEPT


def _link_type(value: str) -> LinkType:
    normalized = str(value or "").strip().lower()
    try:
        return LinkType(normalized)
    except ValueError:
        return LinkType.ASSOCIATES


def _build_state(
    *,
    citizen_id: str,
    moment_id: str,
    question: str,
    question_embedding: list[float],
    nodes: list[RecallGraphNode],
    links: list[RecallGraphLink],
    energy: float,
) -> CitizenCognitiveState:
    state = CitizenCognitiveState(citizen_id=citizen_id)
    for source in nodes:
        state.add_node(Node(
            id=source.id,
            node_type=_node_type(source.node_type),
            content=source.content or source.id,
            embedding=list(source.embedding),
            energy=max(0.0, source.energy),
            weight=max(0.0, source.weight),
            stability=max(0.0, min(1.0, source.stability)),
            recency=max(0.0, min(1.0, source.recency)),
        ))

    state.add_node(Node(
        id=moment_id,
        node_type=NodeType.MEMORY,
        content=question,
        embedding=list(question_embedding),
        energy=energy,
        weight=1.0,
        recency=1.0,
        self_relevance=1.0,
        goal_relevance=1.0,
        novelty_affinity=0.5,
    ))

    for source in links:
        if source.source_id not in state.nodes or source.target_id not in state.nodes:
            continue
        state.add_link(Link(
            source_id=source.source_id,
            target_id=source.target_id,
            link_type=_link_type(source.relation),
            weight=max(0.0, source.weight),
            activation_gain=source.activation_gain,
            friction=max(0.0, min(1.0, source.friction)),
            trust=max(0.0, min(1.0, source.trust)),
        ))

    # Transient contextual links make every Space node physically reachable
    # from the central question without mutating the durable graph topology.
    for source in nodes:
        semantic = _safe_similarity(question_embedding, source.embedding)
        state.add_link(Link(
            source_id=moment_id,
            target_id=source.id,
            link_type=LinkType.ASSOCIATES,
            weight=max(MIN_CONTEXT_LINK_WEIGHT, semantic),
            trust=1.0,
        ))
    return state


def run_recall(
    *,
    citizen_id: str,
    moment_id: str,
    question: str,
    question_embedding: list[float],
    nodes: list[RecallGraphNode],
    links: list[RecallGraphLink],
    energy: float = DEFAULT_RECALL_ENERGY,
    max_ticks: int = DEFAULT_MAX_TICKS,
    top_k: int = 10,
    source_missing_embedding_count: Optional[int] = None,
) -> RecallOutcome:
    """Execute recall physics over the complete supplied Space snapshot."""
    if not question.strip():
        raise ValueError("question must not be empty")
    if not question_embedding:
        raise ValueError("question embedding is required")

    energy = max(MIN_RECALL_ENERGY, min(MAX_RECALL_ENERGY, float(energy)))
    max_ticks = max(1, min(MAX_TICKS_LIMIT, int(max_ticks)))
    top_k = max(1, min(100, int(top_k)))

    space_centroid = _mean_embedding(node.embedding for node in nodes)
    stimulus_centroid = _blend_embeddings(question_embedding, space_centroid)
    selection = select_active_subentity(nodes, stimulus_centroid)
    recall_subentity = _create_recall_subentity(
        citizen_id=citizen_id,
        moment_id=moment_id,
        question=question,
        question_embedding=question_embedding,
        selection=selection,
        nodes=nodes,
    )

    state = _build_state(
        citizen_id=citizen_id,
        moment_id=moment_id,
        question=question,
        question_embedding=question_embedding,
        nodes=nodes,
        links=links,
        energy=energy,
    )
    initial_energies = {node.id: node.energy for node in nodes}

    previous_rank: tuple[str, ...] = ()
    stable_ticks = 0
    stop_reason = "safety_limit"
    ticks_run = 0
    for tick in range(1, max_ticks + 1):
        ticks_run = tick
        propagation = propagate_energy(state)
        select_working_memory(state)
        decay_energy(state)

        ranked_ids = tuple(
            item[0]
            for item in sorted(
                (
                    (node.id, node.energy - initial_energies.get(node.id, 0.0))
                    for node in nodes
                    if node.id in state.nodes
                    and state.nodes[node.id].energy
                    - initial_energies.get(node.id, 0.0) > RESULT_EPSILON
                ),
                key=lambda item: (-item[1], item[0]),
            )[:top_k]
        )
        if ranked_ids and ranked_ids == previous_rank:
            stable_ticks += 1
        else:
            stable_ticks = 0
        previous_rank = ranked_ids

        if propagation.flows_count == 0:
            stop_reason = "exhausted"
            break
        if stable_ticks >= CONVERGENCE_WINDOW:
            stop_reason = "converged"
            break

    result_nodes: list[RecallResultNode] = []
    by_id = {node.id: node for node in nodes}
    for node_id, source in by_id.items():
        current = state.nodes[node_id].energy
        before = initial_energies[node_id]
        delta = current - before
        if delta <= RESULT_EPSILON:
            continue
        semantic = _safe_similarity(question_embedding, source.embedding)
        result_nodes.append(RecallResultNode(
            node_id=node_id,
            score=delta * (0.5 + 0.5 * semantic),
            semantic_similarity=semantic,
            energy_before=before,
            energy_after=current,
            epistemic_status=source.epistemic_status or "unknown",
        ))
    result_nodes.sort(key=lambda item: (-item.score, item.node_id))

    status = "completed" if result_nodes else "no_match"
    final_energies = {
        node.id: state.nodes[node.id].energy
        for node in nodes
        if node.id in state.nodes
    }
    return RecallOutcome(
        moment_id=moment_id,
        recall_subentity_id=recall_subentity.id,
        selection=selection,
        stimulus_node_count=len(nodes) + 1,
        stimulus_link_count=len(state.links),
        injected_energy=energy,
        ticks_run=ticks_run,
        stop_reason=stop_reason,
        status=status,
        results=result_nodes,
        result_limit=top_k,
        final_energies=final_energies,
        remaining_question_energy=state.nodes[moment_id].energy,
        missing_embedding_count=(
            sum(1 for node in nodes if not node.embedding)
            if source_missing_embedding_count is None
            else max(0, int(source_missing_embedding_count))
        ),
    )
