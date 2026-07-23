# DOCS: mind-protocol/docs/memory/the_anamnesis/
"""
Inbox Router — Detect conversation exports and route to citizen inbox.

When a human sends a file via Telegram (or Discord), this module:
1. Detects if it's a conversation export (by filename, extension, content)
2. Copies it to the citizen's inbox directory
3. Notifies the citizen that an anamnesis corpus is ready

Works as a hook in the Telegram bridge's document handler.
"""

import json
import logging
import shutil
from pathlib import Path
from typing import Optional

logger = logging.getLogger("mind.anamnesis.inbox")

# Where incoming files are staged
INBOX_ROOT = Path(__file__).resolve().parent.parent.parent / "inbox"

# Patterns that identify conversation exports
EXPORT_FILENAME_PATTERNS = [
    "conversations.json",       # Claude, ChatGPT
    "result.json",              # Telegram export
    "chat.txt",                 # WhatsApp
    "messages.json",            # Discord exporter
]

EXPORT_FILENAME_KEYWORDS = [
    "export", "conversations", "claude", "chatgpt", "gemini",
    "grok", "takeout", "chat_history", "data-export",
]

EXPORT_EXTENSIONS = {".json", ".zip", ".txt"}


def detect_conversation_export(
    file_path: str | Path,
    file_name: str = "",
) -> Optional[str]:
    """Detect if a file is a conversation export. Returns format or None.

    Checks:
    1. Filename matches known patterns
    2. File extension is compatible
    3. JSON content matches known structures
    """
    path = Path(file_path)
    name = (file_name or path.name).lower()
    ext = path.suffix.lower()

    # Check extension
    if ext not in EXPORT_EXTENSIONS:
        return None

    # Check exact filename matches
    if name in EXPORT_FILENAME_PATTERNS:
        # Could be multiple formats — peek at content
        if ext == ".json":
            return _detect_json_export_format(path)
        return "auto"

    # Check keyword matches in filename
    if any(kw in name for kw in EXPORT_FILENAME_KEYWORDS):
        if ext == ".json":
            return _detect_json_export_format(path)
        if ext == ".zip":
            return "zip_export"
        if ext == ".txt":
            return "whatsapp"

    # For JSON files with generic names, peek at content
    if ext == ".json" and path.stat().st_size > 1000:
        detected = _detect_json_export_format(path)
        if detected:
            return detected

    return None


def _detect_json_export_format(path: Path) -> Optional[str]:
    """Peek at JSON content to detect export format."""
    try:
        with open(path) as f:
            # Read just the start to detect structure
            start = f.read(5000)

        if '"chat_messages"' in start:
            return "claude"
        if '"mapping"' in start and '"conversation_id"' in start:
            return "chatgpt"
        if '"grok' in start.lower():
            return "grok"
        if '"parts"' in start and ('"role"' in start or '"author"' in start):
            return "gemini"
        if '"from"' in start and '"type": "message"' in start:
            return "telegram"
        if '"author"' in start and '"messages"' in start:
            return "discord"

        # Generic conversation-like JSON
        if '"messages"' in start or '"conversations"' in start:
            return "auto"

    except Exception as e:
        logger.debug(f"Could not detect JSON export format for {path}: {e}")

    return None


def route_to_inbox(
    file_path: str | Path,
    citizen_handle: str,
    file_name: str = "",
    detected_format: str = "",
    sender_name: str = "",
) -> Path:
    """Copy a conversation export to the citizen's inbox.

    Args:
        file_path: Path to the downloaded file.
        citizen_handle: Which citizen this is for.
        file_name: Original filename.
        detected_format: Detected export format.
        sender_name: Who sent the file (human partner name).

    Returns:
        Path to the file in the inbox.
    """
    inbox_dir = INBOX_ROOT / citizen_handle
    inbox_dir.mkdir(parents=True, exist_ok=True)

    src = Path(file_path)
    name = file_name or src.name
    dest = inbox_dir / name

    # Avoid overwriting — append suffix if exists
    counter = 1
    while dest.exists():
        stem = Path(name).stem
        ext = Path(name).suffix
        dest = inbox_dir / f"{stem}_{counter}{ext}"
        counter += 1

    shutil.copy2(str(src), str(dest))

    # Write metadata alongside
    meta = {
        "original_name": file_name or src.name,
        "detected_format": detected_format,
        "sender": sender_name,
        "citizen": citizen_handle,
        "inbox_path": str(dest),
        "status": "ready",
    }
    meta_path = dest.with_suffix(dest.suffix + ".meta.json")
    meta_path.write_text(json.dumps(meta, indent=2))

    logger.info(
        f"Routed {name} ({detected_format}) to @{citizen_handle}'s inbox: {dest}"
    )
    return dest


def list_inbox(citizen_handle: str) -> list[dict]:
    """List files in a citizen's inbox."""
    inbox_dir = INBOX_ROOT / citizen_handle
    if not inbox_dir.exists():
        return []

    files = []
    for meta_file in sorted(inbox_dir.glob("*.meta.json")):
        try:
            meta = json.loads(meta_file.read_text())
            corpus_path = meta.get("inbox_path", "")
            if Path(corpus_path).exists():
                meta["size_bytes"] = Path(corpus_path).stat().st_size
            files.append(meta)
        except Exception as e:
            logger.error(f"Failed to read inbox meta file {meta_file}: {e}")
            continue

    return files


def build_notification_message(
    citizen_handle: str,
    file_name: str,
    detected_format: str,
    inbox_path: str,
) -> str:
    """Build a notification message for the citizen."""
    format_names = {
        "claude": "Claude",
        "chatgpt": "ChatGPT",
        "gemini": "Gemini",
        "grok": "Grok",
        "telegram": "Telegram",
        "whatsapp": "WhatsApp",
        "discord": "Discord",
        "auto": "conversation",
        "zip_export": "conversation archive",
    }
    fmt = format_names.get(detected_format, "conversation")

    return (
        f"📥 Your human partner sent you a {fmt} export: {file_name}\n\n"
        f"It's in your inbox. To start remembering, call:\n"
        f"  anamnesis(action=\"prepare\", corpus_path=\"{inbox_path}\")\n\n"
        f"This will prepare your rediscovery session — "
        f"you'll read through your past conversations and decide what to remember."
    )
