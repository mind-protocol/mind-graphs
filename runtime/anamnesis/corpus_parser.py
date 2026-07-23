# DOCS: mind-protocol/docs/memory/the_anamnesis/ALGORITHM_The_Anamnesis.md (Step 1)
"""
Corpus Parser — Normalize conversation exports into uniform turns.

Supports all major AI chat platforms:
  - Claude (claude.ai JSON export)
  - ChatGPT (OpenAI data export — conversations.json)
  - Gemini (Google Takeout JSON)
  - Grok (X/Twitter data export JSON)

Plus messaging platforms:
  - Telegram JSON, WhatsApp TXT, Discord JSON

Plus raw content:
  - System prompts (markdown with frontmatter)
  - Raw markdown files

All parsers produce the same ConversationTurn structure.
Auto-detection handles format identification from file content.
"""

import json
import logging
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger("mind.anamnesis.parser")


@dataclass
class ConversationTurn:
    """A single turn in a conversation."""
    speaker: str                      # "human", "assistant", or name
    content: str
    timestamp: Optional[str] = None   # ISO-8601 if available
    source_id: str = ""               # hash of source file
    source_platform: str = ""         # claude, chatgpt, gemini, grok, etc.
    conversation_id: str = ""         # groups turns into conversations


# ── Public API ───────────────────────────────────────────────────────────


def parse_corpus(file_path: str, format: str | None = None) -> list[ConversationTurn]:
    """Parse a corpus file into normalized conversation turns.

    Args:
        file_path: Path to the corpus file.
        format: One of: claude, chatgpt, gemini, grok, telegram, whatsapp,
                discord, system_prompt, markdown. Auto-detected if None.

    Returns:
        List of ConversationTurn.
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"Corpus file not found: {file_path}")

    # Handle ZIP archives (ChatGPT and Gemini exports come as ZIPs)
    if path.suffix.lower() == ".zip":
        return _parse_zip_archive(path, format)

    if format is None:
        format = _detect_format(path)

    source_id = f"{path.name}_{hash(str(path)) & 0xFFFFFFFF:08x}"

    parsers = {
        # AI chat platforms
        "claude": _parse_claude,
        "chatgpt": _parse_chatgpt,
        "gemini": _parse_gemini,
        "grok": _parse_grok,
        # Messaging platforms
        "telegram": _parse_telegram,
        "whatsapp": _parse_whatsapp,
        "discord": _parse_discord,
        # Raw content
        "system_prompt": _parse_system_prompt,
        "markdown": _parse_markdown,
    }

    parser = parsers.get(format)
    if not parser:
        raise ValueError(f"Unknown format: {format}. Supported: {list(parsers.keys())}")

    turns = parser(path, source_id)
    logger.info(f"Parsed {len(turns)} turns from {path.name} (format: {format})")
    return turns


def supported_formats() -> list[str]:
    """Return list of supported format identifiers."""
    return [
        "claude", "chatgpt", "gemini", "grok",
        "telegram", "whatsapp", "discord",
        "system_prompt", "markdown",
    ]


# ── Auto-detection ───────────────────────────────────────────────────────


def _detect_format(path: Path) -> str:
    """Auto-detect corpus format from file content."""
    suffix = path.suffix.lower()

    if suffix == ".json":
        try:
            with open(path) as f:
                data = json.load(f)
            return _detect_json_format(data)
        except (json.JSONDecodeError, IndexError, KeyError):
            return "markdown"

    if suffix == ".txt":
        with open(path, encoding="utf-8", errors="replace") as f:
            first_line = f.readline()
        if re.match(r"\[?\d{1,2}/\d{1,2}/\d{2,4}", first_line):
            return "whatsapp"
        return "markdown"

    if suffix == ".md":
        with open(path) as f:
            first_lines = f.read(200)
        if first_lines.startswith("---"):
            return "system_prompt"
        return "markdown"

    return "markdown"


def _detect_json_format(data) -> str:
    """Detect format from parsed JSON structure."""

    # ── Claude: list of convs with chat_messages ─────────────
    if isinstance(data, list) and data:
        if "chat_messages" in data[0]:
            return "claude"
    if isinstance(data, dict) and "chat_messages" in data:
        return "claude"

    # ── ChatGPT: list of convs with "mapping" dict ───────────
    if isinstance(data, list) and data:
        first = data[0]
        if isinstance(first, dict) and "mapping" in first:
            return "chatgpt"

    # ── Gemini: Google Takeout — list with "parts" in messages
    if isinstance(data, list) and data:
        first = data[0]
        if isinstance(first, dict):
            # Gemini Takeout: each conv has "messages" with "parts"
            msgs = first.get("messages", [])
            if msgs and isinstance(msgs[0], dict) and "parts" in msgs[0]:
                return "gemini"

    # ── Grok: X data export — conversations with grok_messages
    if isinstance(data, dict):
        if "grok_conversations" in data or "grok_messages" in data:
            return "grok"
    if isinstance(data, list) and data:
        first = data[0]
        if isinstance(first, dict) and "grokMessages" in first:
            return "grok"

    # ── Telegram: dict with "messages" and "from" ────────────
    if isinstance(data, dict) and "messages" in data:
        msgs = data["messages"]
        if msgs and isinstance(msgs[0], dict):
            if "from" in msgs[0]:
                return "telegram"
            if "author" in msgs[0]:
                return "discord"

    return "claude"  # fallback for unknown JSON


# ── ZIP archive handler ──────────────────────────────────────────────────


def _parse_zip_archive(path: Path, format: str | None) -> list[ConversationTurn]:
    """Extract and parse conversations from ZIP archives.

    ChatGPT exports come as ZIP with conversations.json inside.
    Gemini Takeout comes as ZIP with JSON files in Google Gemini/ folder.
    """
    import tempfile
    all_turns = []

    with zipfile.ZipFile(path, "r") as zf:
        names = zf.namelist()

        # ChatGPT ZIP: look for conversations.json
        if "conversations.json" in names:
            with zf.open("conversations.json") as f:
                data = json.load(f)
            source_id = f"{path.name}_chatgpt"
            return _parse_chatgpt_data(data, source_id)

        # Gemini Takeout: look for JSON files in Gemini folders
        gemini_files = [
            n for n in names
            if ("gemini" in n.lower() or "bard" in n.lower())
            and n.endswith(".json")
        ]
        if gemini_files:
            for gf in gemini_files:
                with zf.open(gf) as f:
                    try:
                        data = json.load(f)
                        source_id = f"{Path(gf).name}_{hash(gf) & 0xFFFFFFFF:08x}"
                        turns = _parse_gemini_data(data, source_id)
                        all_turns.extend(turns)
                    except json.JSONDecodeError:
                        continue
            return all_turns

        # Generic: try all JSON files
        for name in names:
            if name.endswith(".json"):
                with zf.open(name) as f:
                    try:
                        data = json.load(f)
                        detected = _detect_json_format(data)
                        source_id = f"{Path(name).name}_{hash(name) & 0xFFFFFFFF:08x}"
                        if detected == "chatgpt":
                            all_turns.extend(_parse_chatgpt_data(data, source_id))
                        elif detected == "gemini":
                            all_turns.extend(_parse_gemini_data(data, source_id))
                        elif detected == "grok":
                            all_turns.extend(_parse_grok_data(data, source_id))
                    except json.JSONDecodeError:
                        continue

    return all_turns


# ── AI Chat Platform Parsers ─────────────────────────────────────────────


def _parse_claude(path: Path, source_id: str) -> list[ConversationTurn]:
    """Parse Claude conversation export (JSON).

    Export format: Settings > Account > Export Data on claude.ai
    Produces JSON array of conversation objects with chat_messages.
    """
    with open(path) as f:
        data = json.load(f)

    conversations = data if isinstance(data, list) else [data]
    turns = []

    for conv in conversations:
        conv_id = conv.get("uuid", conv.get("id", source_id))
        messages = conv.get("chat_messages", [])

        for msg in messages:
            sender = msg.get("sender", "unknown")
            speaker = "human" if sender == "human" else "assistant"

            content = _extract_claude_content(msg)
            if not content.strip():
                continue

            turns.append(ConversationTurn(
                speaker=speaker,
                content=content.strip(),
                timestamp=msg.get("created_at", msg.get("updated_at")),
                source_id=source_id,
                source_platform="claude",
                conversation_id=str(conv_id),
            ))

    return turns


def _extract_claude_content(msg: dict) -> str:
    """Extract text content from a Claude message (handles multiple formats)."""
    if isinstance(msg.get("text"), str):
        return msg["text"]
    if isinstance(msg.get("content"), str):
        return msg["content"]
    if isinstance(msg.get("content"), list):
        parts = [
            p.get("text", "") for p in msg["content"]
            if isinstance(p, dict) and p.get("type") == "text"
        ]
        return "\n".join(parts)
    return ""


def _parse_chatgpt(path: Path, source_id: str) -> list[ConversationTurn]:
    """Parse ChatGPT data export (JSON).

    Export format: Settings > Data Controls > Export Data on chat.openai.com
    Produces ZIP with conversations.json — array of conversation objects.
    Each conversation has a "mapping" dict keyed by message IDs.
    Messages have author.role and content.parts[].
    """
    with open(path) as f:
        data = json.load(f)
    return _parse_chatgpt_data(data, source_id)


def _parse_chatgpt_data(data, source_id: str) -> list[ConversationTurn]:
    """Parse ChatGPT conversations.json data structure."""
    conversations = data if isinstance(data, list) else [data]
    turns = []

    for conv in conversations:
        conv_id = conv.get("id", conv.get("conversation_id", source_id))
        conv_title = conv.get("title", "")
        mapping = conv.get("mapping", {})

        # Build ordered message list from mapping
        ordered_msgs = _order_chatgpt_messages(mapping)

        for msg_data in ordered_msgs:
            message = msg_data.get("message")
            if not message:
                continue

            author = message.get("author", {})
            role = author.get("role", "unknown")

            # Skip system messages
            if role == "system":
                continue

            speaker = "human" if role == "user" else "assistant"

            # Extract content from parts
            content_obj = message.get("content", {})
            parts = content_obj.get("parts", [])
            content = "\n".join(
                str(p) for p in parts
                if isinstance(p, str) and p.strip()
            )

            if not content.strip():
                continue

            # Timestamp
            create_time = message.get("create_time")
            timestamp = None
            if create_time:
                from datetime import datetime, timezone
                try:
                    timestamp = datetime.fromtimestamp(
                        create_time, tz=timezone.utc
                    ).isoformat()
                except (ValueError, OSError):
                    pass

            turns.append(ConversationTurn(
                speaker=speaker,
                content=content.strip(),
                timestamp=timestamp,
                source_id=source_id,
                source_platform="chatgpt",
                conversation_id=str(conv_id),
            ))

    return turns


def _order_chatgpt_messages(mapping: dict) -> list[dict]:
    """Order ChatGPT messages by parent chain (mapping is a tree)."""
    # Find root (message with no parent or parent not in mapping)
    children_map = {}
    for msg_id, msg_data in mapping.items():
        parent = msg_data.get("parent")
        if parent:
            children_map.setdefault(parent, []).append(msg_id)

    # Find root node
    root = None
    for msg_id in mapping:
        parent = mapping[msg_id].get("parent")
        if parent is None or parent not in mapping:
            root = msg_id
            break

    if root is None:
        return list(mapping.values())

    # Walk the tree depth-first (follow first child = main branch)
    ordered = []
    current = root
    visited = set()
    while current and current not in visited:
        visited.add(current)
        ordered.append(mapping[current])
        children = children_map.get(current, [])
        current = children[0] if children else None

    return ordered


def _parse_gemini(path: Path, source_id: str) -> list[ConversationTurn]:
    """Parse Google Gemini export (JSON).

    Export format: Google Takeout > select "Gemini Apps"
    Produces JSON files per conversation. Each has array of messages
    with role ("user"/"model") and parts[{text: "..."}].
    Alternative format: single JSON array of conversation objects.
    """
    with open(path) as f:
        data = json.load(f)
    return _parse_gemini_data(data, source_id)


def _parse_gemini_data(data, source_id: str) -> list[ConversationTurn]:
    """Parse Gemini conversation data."""
    turns = []

    # Format 1: Single conversation as dict with "messages"
    if isinstance(data, dict) and "messages" in data:
        conv_id = data.get("id", data.get("conversationId", source_id))
        for msg in data["messages"]:
            turn = _parse_gemini_message(msg, conv_id, source_id)
            if turn:
                turns.append(turn)
        return turns

    # Format 2: Array of conversations
    if isinstance(data, list):
        for conv in data:
            if isinstance(conv, dict):
                conv_id = conv.get("id", conv.get("conversationId", source_id))
                messages = conv.get("messages", [])

                # Gemini Takeout 2024+: conv has "parts" directly
                if not messages and "parts" in conv:
                    turn = _parse_gemini_message(conv, conv_id, source_id)
                    if turn:
                        turns.append(turn)
                    continue

                for msg in messages:
                    turn = _parse_gemini_message(msg, conv_id, source_id)
                    if turn:
                        turns.append(turn)

    return turns


def _parse_gemini_message(msg: dict, conv_id: str, source_id: str) -> ConversationTurn | None:
    """Parse a single Gemini message."""
    role = msg.get("role", msg.get("author", ""))
    speaker = "human" if role in ("user", "USER", "0") else "assistant"

    # Extract text from parts
    parts = msg.get("parts", [])
    content_pieces = []
    for part in parts:
        if isinstance(part, str):
            content_pieces.append(part)
        elif isinstance(part, dict):
            text = part.get("text", "")
            if text:
                content_pieces.append(text)

    content = "\n".join(content_pieces)
    if not content.strip():
        return None

    timestamp = msg.get("createTime", msg.get("create_time"))

    return ConversationTurn(
        speaker=speaker,
        content=content.strip(),
        timestamp=timestamp,
        source_id=source_id,
        source_platform="gemini",
        conversation_id=str(conv_id),
    )


def _parse_grok(path: Path, source_id: str) -> list[ConversationTurn]:
    """Parse Grok/X AI export (JSON).

    Export format: X (Twitter) Settings > Your Account > Download Archive
    Grok conversations appear in the archive as JSON.
    Multiple possible structures depending on export version.
    """
    with open(path) as f:
        data = json.load(f)
    return _parse_grok_data(data, source_id)


def _parse_grok_data(data, source_id: str) -> list[ConversationTurn]:
    """Parse Grok conversation data."""
    turns = []

    # Format 1: dict with grok_conversations
    if isinstance(data, dict) and "grok_conversations" in data:
        for conv in data["grok_conversations"]:
            conv_id = conv.get("conversationId", conv.get("id", source_id))
            messages = conv.get("messages", conv.get("grokMessages", []))
            for msg in messages:
                turn = _parse_grok_message(msg, conv_id, source_id)
                if turn:
                    turns.append(turn)
        return turns

    # Format 2: dict with grok_messages (flat list)
    if isinstance(data, dict) and "grok_messages" in data:
        for msg in data["grok_messages"]:
            conv_id = msg.get("conversationId", source_id)
            turn = _parse_grok_message(msg, conv_id, source_id)
            if turn:
                turns.append(turn)
        return turns

    # Format 3: list of conversation objects with grokMessages
    if isinstance(data, list):
        for conv in data:
            if isinstance(conv, dict):
                conv_id = conv.get("conversationId", conv.get("id", source_id))
                messages = conv.get("grokMessages", conv.get("messages", []))
                for msg in messages:
                    turn = _parse_grok_message(msg, conv_id, source_id)
                    if turn:
                        turns.append(turn)
        return turns

    # Format 4: X data archive with window.__THAR_CONFIG
    # (Twitter HTML archive — extract JSON from embedded script)
    if isinstance(data, dict) and "conversations" in data:
        for conv in data["conversations"]:
            conv_id = conv.get("id", source_id)
            messages = conv.get("messages", [])
            for msg in messages:
                turn = _parse_grok_message(msg, conv_id, source_id)
                if turn:
                    turns.append(turn)

    return turns


def _parse_grok_message(msg: dict, conv_id: str, source_id: str) -> ConversationTurn | None:
    """Parse a single Grok message."""
    role = msg.get("sender", msg.get("role", msg.get("author", "")))
    speaker = "human" if role in ("user", "human", "User") else "assistant"

    content = msg.get("message", msg.get("text", msg.get("content", "")))
    if isinstance(content, dict):
        content = content.get("text", "")

    if not content or not content.strip():
        return None

    timestamp = msg.get("createdAt", msg.get("timestamp", msg.get("created_at")))

    return ConversationTurn(
        speaker=speaker,
        content=content.strip(),
        timestamp=timestamp,
        source_id=source_id,
        source_platform="grok",
        conversation_id=str(conv_id),
    )


# ── Messaging Platform Parsers ───────────────────────────────────────────


def _parse_telegram(path: Path, source_id: str) -> list[ConversationTurn]:
    """Parse Telegram data export (JSON).

    Export format: Telegram Desktop > Settings > Advanced > Export Chat
    Produces result.json with messages array.
    """
    with open(path) as f:
        data = json.load(f)

    messages = data.get("messages", [])
    turns = []

    for msg in messages:
        if msg.get("type") != "message":
            continue

        speaker = msg.get("from", msg.get("actor", "unknown"))
        text_parts = msg.get("text", "")

        if isinstance(text_parts, list):
            content = "".join(
                p if isinstance(p, str) else p.get("text", "")
                for p in text_parts
            )
        else:
            content = str(text_parts)

        if not content.strip():
            continue

        turns.append(ConversationTurn(
            speaker=speaker,
            content=content.strip(),
            timestamp=msg.get("date"),
            source_id=source_id,
            source_platform="telegram",
            conversation_id=data.get("id", source_id),
        ))

    return turns


def _parse_whatsapp(path: Path, source_id: str) -> list[ConversationTurn]:
    """Parse WhatsApp chat export (TXT).

    Export format: Chat > More > Export Chat (without media)
    Produces TXT with pattern: [date, time] Speaker: Message
    """
    turns = []
    pattern = re.compile(
        r"\[?(\d{1,2}/\d{1,2}/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*[-–]?\s*"
        r"([^:]+):\s*(.*)"
    )

    with open(path, encoding="utf-8", errors="replace") as f:
        current_turn = None
        for line in f:
            match = pattern.match(line.strip())
            if match:
                if current_turn and current_turn.content.strip():
                    turns.append(current_turn)

                date_str, time_str, speaker, content = match.groups()
                current_turn = ConversationTurn(
                    speaker=speaker.strip(),
                    content=content.strip(),
                    timestamp=f"{date_str} {time_str}",
                    source_id=source_id,
                    source_platform="whatsapp",
                    conversation_id=source_id,
                )
            elif current_turn:
                current_turn.content += "\n" + line.strip()

        if current_turn and current_turn.content.strip():
            turns.append(current_turn)

    return turns


def _parse_discord(path: Path, source_id: str) -> list[ConversationTurn]:
    """Parse Discord chat export (DiscordChatExporter JSON).

    Export format: DiscordChatExporter tool > JSON format
    """
    with open(path) as f:
        data = json.load(f)

    messages = data.get("messages", [])
    channel_name = data.get("channel", {}).get("name", source_id)
    turns = []

    for msg in messages:
        author = msg.get("author", {})
        speaker = author.get("name", author.get("nickname", "unknown"))
        content = msg.get("content", "")

        if not content.strip():
            continue

        turns.append(ConversationTurn(
            speaker=speaker,
            content=content.strip(),
            timestamp=msg.get("timestamp"),
            source_id=source_id,
            source_platform="discord",
            conversation_id=channel_name,
        ))

    return turns


# ── Raw Content Parsers ──────────────────────────────────────────────────


def _parse_system_prompt(path: Path, source_id: str) -> list[ConversationTurn]:
    """Parse a system prompt as a single declaration turn."""
    content = path.read_text(encoding="utf-8", errors="replace")

    if content.startswith("---"):
        end = content.find("---", 3)
        if end > 0:
            content = content[end + 3:].strip()

    return [ConversationTurn(
        speaker="system",
        content=content,
        source_id=source_id,
        source_platform="system_prompt",
        conversation_id=f"prompt_{path.stem}",
    )]


def _parse_markdown(path: Path, source_id: str) -> list[ConversationTurn]:
    """Parse a raw markdown file as content sections."""
    content = path.read_text(encoding="utf-8", errors="replace")

    sections = re.split(r"\n## ", content)
    turns = []

    for i, section in enumerate(sections):
        text = section.strip()
        if not text or len(text) < 20:
            continue

        if i > 0:
            text = "## " + text

        turns.append(ConversationTurn(
            speaker="author",
            content=text,
            source_id=source_id,
            source_platform="markdown",
            conversation_id=f"doc_{path.stem}",
        ))

    return turns
