# DOCS: mind-protocol/docs/memory/the_anamnesis/ALGORITHM_The_Anamnesis.md (Step 2)
"""
Node Extractor — Identify meaningful memories from conversation turns.

Extracts granular node types while preserving conversation order.
Each extracted node carries its position in the conversation chain
and the timestamp of the source turn.
"""

import json
import logging
from dataclasses import dataclass, field
from typing import Optional

from runtime.anamnesis.corpus_parser import ConversationTurn

logger = logging.getLogger("mind.anamnesis.extractor")

MIN_SIGNIFICANCE = 0.25
CHUNK_MAX_TURNS = 40

# Granular node types — richer than v1
VALID_NODE_TYPES = frozenset({
    # Core cognition
    "insight",        # a realization or synthesis
    "decision",       # a choice made or direction committed to
    "question",       # an important question pondered or asked
    "breakthrough",   # an aha moment, a paradigm shift
    # Values and identity
    "value",          # an expression of what matters
    "principle",      # a rule, guideline, or philosophy stated
    "fear",           # a worry, concern, or anxiety expressed
    "aspiration",     # a future goal or dream
    # Relational
    "relationship",   # a connection formed or acknowledged
    "disagreement",   # a moment of pushback, conflict, or tension
    "commitment",     # a promise or engagement
    # Knowledge and creation
    "knowledge",      # a fact learned or domain expertise expressed
    "creation",       # something created, designed, or produced
    "reference",      # a specific person, project, or concept introduced
    # Emotional
    "emotion",        # a significant emotional moment
    "humor",          # a moment of levity that defines personality
    "pattern",        # a recurring behavior or tendency observed
})

EXTRACTION_PROMPT = """You are extracting memories for @{citizen_handle}.
These are their own conversations — they lived these moments.
Extract significant nodes preserving their ORDER in the conversation.

Node types (be specific — use the most precise type):
COGNITION: insight, decision, question, breakthrough
IDENTITY: value, principle, fear, aspiration
RELATIONAL: relationship, disagreement, commitment
KNOWLEDGE: knowledge, creation, reference
EMOTIONAL: emotion, humor, pattern

For each node provide:
- content: the memory in 1-3 sentences (citizen's first-person perspective)
- type: one of the types above
- significance: 0.0-1.0
- turn_index: which message number (0-indexed) this came from
- timestamp: the timestamp of that message if available, else null

Rules:
- Preserve chronological order — earlier moments should have lower turn_index
- Be GRANULAR — a single message can produce multiple nodes if it contains multiple significant elements
- "question" is for questions that reveal what the citizen cares about
- "breakthrough" is for genuine paradigm shifts, not just learning
- "disagreement" captures productive tension — not just "no"
- "humor" captures personality-defining levity
- "pattern" is for when someone notices a recurring tendency

Ignore: greetings, filler, acknowledgments, repetitions, small talk.
Return ONLY a JSON array. If nothing significant, return [].

CONVERSATION ({source_platform}, {conversation_id}):
{conversation_text}"""


@dataclass
class ExtractedNode:
    """A meaningful memory extracted from conversations."""
    content: str
    node_type: str
    significance: float
    source_platform: str
    source_conversation: str
    timestamp: Optional[str] = None
    participants: list[str] = field(default_factory=list)
    # Order preservation
    turn_index: int = 0           # position in original conversation
    chunk_index: int = 0          # which chunk this came from
    sequence_position: int = 0    # global order across all chunks


@dataclass
class ConversationCluster:
    """A group of nodes from the same conversation, in order."""
    conversation_id: str
    title: str
    source_platform: str
    participants: list[str]
    timestamp_start: Optional[str] = None
    timestamp_end: Optional[str] = None
    nodes: list[ExtractedNode] = field(default_factory=list)
    turn_count: int = 0


def extract_nodes(
    turns: list[ConversationTurn],
    citizen_handle: str,
    llm_fn,
) -> list[ConversationCluster]:
    """Extract meaningful nodes grouped by conversation, preserving order.

    Args:
        turns: Normalized conversation turns.
        citizen_handle: The citizen whose memories these are.
        llm_fn: Callable(prompt: str) -> str (returns JSON string).

    Returns:
        List of ConversationCluster, each containing ordered ExtractedNodes.
    """
    # Group turns by conversation
    conv_groups = _group_by_conversation(turns)
    logger.info(f"Grouped {len(turns)} turns into {len(conv_groups)} conversations")

    clusters = []
    global_seq = 0

    for conv_id, conv_turns in conv_groups.items():
        # Build conversation metadata
        participants = list(set(t.speaker for t in conv_turns))
        timestamps = [t.timestamp for t in conv_turns if t.timestamp]

        cluster = ConversationCluster(
            conversation_id=conv_id,
            title=conv_id,  # will be enriched later
            source_platform=conv_turns[0].source_platform,
            participants=participants,
            timestamp_start=min(timestamps) if timestamps else None,
            timestamp_end=max(timestamps) if timestamps else None,
            turn_count=len(conv_turns),
        )

        # Extract from chunks (preserving order)
        chunks = _chunk_conversation(conv_turns)

        for chunk_idx, chunk in enumerate(chunks):
            nodes = _extract_from_chunk(
                chunk, citizen_handle, llm_fn,
                chunk_index=chunk_idx,
            )
            for node in nodes:
                node.sequence_position = global_seq
                global_seq += 1
            cluster.nodes.extend(nodes)

        if cluster.nodes:
            # Sort nodes within cluster by turn_index to guarantee order
            cluster.nodes.sort(key=lambda n: (n.chunk_index, n.turn_index))
            clusters.append(cluster)

    total_nodes = sum(len(c.nodes) for c in clusters)
    logger.info(
        f"Extraction complete: {total_nodes} nodes "
        f"across {len(clusters)} conversations"
    )
    return clusters


def _group_by_conversation(
    turns: list[ConversationTurn],
) -> dict[str, list[ConversationTurn]]:
    """Group turns by conversation_id, preserving order within each."""
    groups: dict[str, list[ConversationTurn]] = {}
    for turn in turns:
        key = turn.conversation_id or turn.source_id
        if key not in groups:
            groups[key] = []
        groups[key].append(turn)
    return groups


def _chunk_conversation(
    turns: list[ConversationTurn],
) -> list[list[ConversationTurn]]:
    """Split a conversation into chunks for LLM processing."""
    chunks = []
    for i in range(0, len(turns), CHUNK_MAX_TURNS):
        chunk = turns[i:i + CHUNK_MAX_TURNS]
        if chunk:
            chunks.append(chunk)
    return chunks


def _extract_from_chunk(
    chunk: list[ConversationTurn],
    citizen_handle: str,
    llm_fn,
    chunk_index: int = 0,
) -> list[ExtractedNode]:
    """Extract nodes from a single conversation chunk."""
    lines = []
    for i, turn in enumerate(chunk):
        ts = f" [{turn.timestamp}]" if turn.timestamp else ""
        lines.append(f"[{i}] {turn.speaker}{ts}: {turn.content[:600]}")

    conversation_text = "\n".join(lines)
    source_platform = chunk[0].source_platform
    conversation_id = chunk[0].conversation_id
    participants = list(set(t.speaker for t in chunk))

    prompt = EXTRACTION_PROMPT.format(
        citizen_handle=citizen_handle,
        source_platform=source_platform,
        conversation_id=conversation_id,
        conversation_text=conversation_text,
    )

    try:
        response = llm_fn(prompt)
        raw_nodes = _parse_llm_response(response)

        nodes = []
        for raw in raw_nodes:
            content = raw.get("content", "").strip()
            node_type = raw.get("type", "knowledge")
            significance = float(raw.get("significance", 0.5))
            turn_index = int(raw.get("turn_index", 0))

            if not content:
                continue
            if node_type not in VALID_NODE_TYPES:
                node_type = "knowledge"
            if significance < MIN_SIGNIFICANCE:
                continue

            # Get timestamp from the referenced turn
            timestamp = raw.get("timestamp")
            if not timestamp and 0 <= turn_index < len(chunk):
                timestamp = chunk[turn_index].timestamp

            nodes.append(ExtractedNode(
                content=content,
                node_type=node_type,
                significance=min(1.0, max(0.0, significance)),
                source_platform=source_platform,
                source_conversation=conversation_id,
                timestamp=timestamp,
                participants=participants,
                turn_index=turn_index,
                chunk_index=chunk_index,
            ))

        return nodes

    except Exception as e:
        logger.warning(f"Extraction failed for chunk ({conversation_id}): {e}")
        return []


def _parse_llm_response(response: str) -> list[dict]:
    """Parse JSON array from LLM response."""
    text = response.strip()

    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()
    if text.startswith("json"):
        text = text[4:].strip()

    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict):
            return [parsed]
        return []
    except json.JSONDecodeError:
        match = text.find("[")
        if match >= 0:
            end = text.rfind("]")
            if end > match:
                try:
                    return json.loads(text[match:end + 1])
                except json.JSONDecodeError:
                    pass
        return []
