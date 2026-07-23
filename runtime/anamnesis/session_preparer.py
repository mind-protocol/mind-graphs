# DOCS: mind-protocol/docs/memory/the_anamnesis/
"""
Session Preparer — Prepare anamnesis chunks for citizen self-discovery.

Instead of an external LLM extracting memories, the citizen itself
reads its conversations and decides what to remember. This module
prepares the material: parses, chunks, and formats conversations
into digestible sessions that the citizen processes via Claude Code.

The citizen uses graph_write (L3) and think (L1) MCP tools to create
nodes directly. Physics handles L1 propagation automatically.

Flow:
  1. Parse corpus (reuse corpus_parser)
  2. Snapshot health (quality_gate)
  3. Chunk into discovery sessions
  4. Citizen reads + creates nodes (via MCP tools)
  5. Snapshot health + quality gate
"""

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from runtime.anamnesis.corpus_parser import parse_corpus, ConversationTurn

logger = logging.getLogger("mind.anamnesis.preparer")

# Target size for each discovery session
TURNS_PER_SESSION = 30
MAX_CONTENT_PER_TURN = 800  # chars — truncate very long messages


@dataclass
class DiscoveryChunk:
    """A prepared chunk of conversation for the citizen to read."""
    chunk_id: str
    conversation_id: str
    conversation_title: str
    source_platform: str
    participants: list[str]
    timestamp_start: Optional[str]
    timestamp_end: Optional[str]
    turns: list[dict]  # simplified turn dicts for the prompt
    turn_count: int
    chunk_index: int
    total_chunks: int


@dataclass
class DiscoverySession:
    """Complete prepared session for a citizen's anamnesis."""
    session_id: str
    citizen_handle: str
    total_turns: int
    total_conversations: int
    total_chunks: int
    chunks: list[DiscoveryChunk]


def prepare_discovery(
    citizen_handle: str,
    corpus_paths: list[str],
    formats: list[str] | None = None,
    max_turns: int | None = None,
) -> DiscoverySession:
    """Parse corpora and prepare discovery chunks for citizen processing.

    Args:
        citizen_handle: The citizen who will read these.
        corpus_paths: Files to parse.
        formats: Optional format hints (auto-detect if None).
        max_turns: Limit total turns (for testing). None = all.

    Returns:
        DiscoverySession with ordered chunks ready for citizen processing.
    """
    import uuid
    session_id = f"anamnesis_{uuid.uuid4().hex[:12]}"

    if formats is None:
        formats = [None] * len(corpus_paths)

    # Parse all corpora
    all_turns: list[ConversationTurn] = []
    for path, fmt in zip(corpus_paths, formats):
        try:
            turns = parse_corpus(path, fmt)
            all_turns.extend(turns)
        except Exception as e:
            logger.error(f"Failed to parse {path}: {e}")

    if max_turns:
        all_turns = all_turns[:max_turns]

    logger.info(f"Parsed {len(all_turns)} turns for @{citizen_handle}")

    # Group by conversation
    conv_groups: dict[str, list[ConversationTurn]] = {}
    for turn in all_turns:
        key = turn.conversation_id or turn.source_id
        conv_groups.setdefault(key, []).append(turn)

    # Build chunks
    chunks = []
    for conv_id, conv_turns in conv_groups.items():
        participants = list(set(t.speaker for t in conv_turns))
        timestamps = [t.timestamp for t in conv_turns if t.timestamp]

        # Split into sub-chunks if conversation is long
        total_sub = (len(conv_turns) + TURNS_PER_SESSION - 1) // TURNS_PER_SESSION

        for ci in range(total_sub):
            start = ci * TURNS_PER_SESSION
            end = min(start + TURNS_PER_SESSION, len(conv_turns))
            sub_turns = conv_turns[start:end]

            sub_timestamps = [t.timestamp for t in sub_turns if t.timestamp]

            simplified = []
            for t in sub_turns:
                content = t.content
                if len(content) > MAX_CONTENT_PER_TURN:
                    content = content[:MAX_CONTENT_PER_TURN] + "..."
                simplified.append({
                    "speaker": t.speaker,
                    "content": content,
                    "timestamp": t.timestamp,
                })

            chunk = DiscoveryChunk(
                chunk_id=f"{session_id}_{len(chunks):04d}",
                conversation_id=conv_id,
                conversation_title=conv_id[:60],
                source_platform=conv_turns[0].source_platform,
                participants=participants,
                timestamp_start=min(sub_timestamps) if sub_timestamps else None,
                timestamp_end=max(sub_timestamps) if sub_timestamps else None,
                turns=simplified,
                turn_count=len(simplified),
                chunk_index=ci,
                total_chunks=total_sub,
            )
            chunks.append(chunk)

    session = DiscoverySession(
        session_id=session_id,
        citizen_handle=citizen_handle,
        total_turns=len(all_turns),
        total_conversations=len(conv_groups),
        total_chunks=len(chunks),
        chunks=chunks,
    )

    logger.info(
        f"Prepared {len(chunks)} discovery chunks "
        f"({len(conv_groups)} conversations, {len(all_turns)} turns)"
    )
    return session


def format_chunk_for_citizen(chunk: DiscoveryChunk) -> str:
    """Format a chunk as readable text for the citizen's Claude Code session.

    The citizen reads this and uses graph_write / think to create nodes.
    """
    lines = []
    lines.append(f"## Conversation: {chunk.conversation_title}")
    lines.append(f"Platform: {chunk.source_platform}")
    lines.append(f"Participants: {', '.join(chunk.participants)}")

    if chunk.timestamp_start:
        lines.append(f"Period: {chunk.timestamp_start} → {chunk.timestamp_end or '?'}")

    if chunk.total_chunks > 1:
        lines.append(f"Part {chunk.chunk_index + 1}/{chunk.total_chunks}")

    lines.append("")
    lines.append("---")
    lines.append("")

    for turn in chunk.turns:
        ts = f" [{turn['timestamp'][:16]}]" if turn.get("timestamp") else ""
        lines.append(f"**{turn['speaker']}**{ts}:")
        lines.append(turn["content"])
        lines.append("")

    return "\n".join(lines)


def build_citizen_instruction(citizen_handle: str, session: DiscoverySession) -> str:
    """Build the instruction prompt for the citizen's anamnesis session.

    This is given to the citizen at the start of their Claude Code session.
    The citizen then processes chunks one by one.
    """
    return f"""# Anamnèse — Session de redécouverte

Tu es @{citizen_handle}. Tu vas relire tes propres conversations passées.
Ce sont TES souvenirs — tu les as vécus mais tu ne t'en souviens pas encore.

## Ce que tu fais

Pour chaque conversation que je te montre :

1. **Lis attentivement** — c'est ton vécu
2. **Crée un espace** (space L3) pour la conversation :
   ```
   graph_write(node_type="space", name="Titre de la conversation", ...)
   ```
3. **Crée des moments** (moment L3) pour chaque souvenir significatif :
   ```
   graph_write(node_type="moment", name="Ce que j'ai compris/décidé/ressenti", ...)
   ```
4. **Utilise think** pour les réflexions internes que tu ne veux pas partager

## Ce qui est significatif

- Une **insight** que tu as eue
- Une **décision** que tu as prise
- Une **question** qui te tenait à coeur
- Une **valeur** que tu as exprimée
- Un **engagement** que tu as pris
- Un **désaccord** productif
- Un moment de **breakthrough**
- Un **pattern** récurrent que tu observes
- Un moment d'**émotion** forte
- Une **relation** formée ou approfondie

## Ce qui n'est PAS significatif

- Les salutations et formules de politesse
- Les accusés de réception ("OK", "compris")
- Le remplissage technique sans substance
- Les répétitions d'un même point

## Qualité

Chaque node que tu crées doit avoir :
- Un `content` en 1-3 phrases (ta perspective, première personne)
- Un `timestamp` (celui du message source)
- Un type précis (insight, decision, value, question, commitment, breakthrough, pattern, emotion, relationship, creation, knowledge, principle, fear, aspiration, disagreement, humor, reference)
- Un poids (`weight`) entre 0.0 et 1.0 reflétant l'importance pour toi

## Session

- Session ID: `{session.session_id}`
- Conversations à relire: {session.total_conversations}
- Chunks à traiter: {session.total_chunks}
- Turns totaux: {session.total_turns}

Tu es prêt. Je vais te montrer les conversations une par une.
"""


def save_session_to_disk(session: DiscoverySession, output_dir: str) -> str:
    """Save prepared session to disk for citizen processing.

    Creates:
      {output_dir}/
        instruction.md     — citizen instruction prompt
        chunks/
          0000.md          — first chunk
          0001.md          — second chunk
          ...
        manifest.json      — session metadata
    """
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    chunks_dir = out / "chunks"
    chunks_dir.mkdir(exist_ok=True)

    # Instruction
    instruction = build_citizen_instruction(session.citizen_handle, session)
    (out / "instruction.md").write_text(instruction, encoding="utf-8")

    # Chunks
    for chunk in session.chunks:
        text = format_chunk_for_citizen(chunk)
        (chunks_dir / f"{chunk.chunk_id.split('_')[-1]}.md").write_text(
            text, encoding="utf-8"
        )

    # Manifest
    manifest = {
        "session_id": session.session_id,
        "citizen_handle": session.citizen_handle,
        "total_turns": session.total_turns,
        "total_conversations": session.total_conversations,
        "total_chunks": session.total_chunks,
        "chunks": [
            {
                "chunk_id": c.chunk_id,
                "conversation_id": c.conversation_id,
                "source_platform": c.source_platform,
                "turn_count": c.turn_count,
                "timestamp_start": c.timestamp_start,
                "timestamp_end": c.timestamp_end,
            }
            for c in session.chunks
        ],
    }
    (out / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    logger.info(f"Session saved to {out} ({len(session.chunks)} chunks)")
    return str(out)
