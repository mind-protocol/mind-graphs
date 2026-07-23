"""Battle Log — records every conscious action as a receipt for the human partner.

Each citizen gets a battle_log.jsonl in their citizen directory.
Entries include: timestamp, action taken, obstacles hit, allies recruited, result.
The human wakes up to a timeline of their AI's overnight struggle.
"""

import json
import logging
import os
import time
from pathlib import Path

logger = logging.getLogger("orchestrator.battle_log")

def log_action_start(citizen_handle: str, action_node_id: str, action_command: str, action_content: str, orientation: str):
    """Log when a conscious action fires."""
    _append(citizen_handle, {
        "event": "action_start",
        "ts": time.time(),
        "iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "action_id": action_node_id,
        "command": action_command,
        "content": action_content,
        "orientation": orientation,
    })

def log_action_result(citizen_handle: str, session_id: str, success: bool, duration_s: float, output_summary: str = ""):
    """Log when a session completes."""
    _append(citizen_handle, {
        "event": "action_result",
        "ts": time.time(),
        "iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "session_id": session_id,
        "success": success,
        "duration_s": round(duration_s, 1),
        "output": output_summary[:500],
    })

def log_obstacle(citizen_handle: str, obstacle: str, action_taken: str = ""):
    """Log an obstacle encountered during action."""
    _append(citizen_handle, {
        "event": "obstacle",
        "ts": time.time(),
        "iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "obstacle": obstacle[:300],
        "action_taken": action_taken[:300],
    })

def log_alliance(citizen_handle: str, ally_handle: str, reason: str):
    """Log when a citizen recruits another AI."""
    _append(citizen_handle, {
        "event": "alliance",
        "ts": time.time(),
        "iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "ally": ally_handle,
        "reason": reason[:300],
    })

def get_recent_log(citizen_handle: str, hours: float = 12) -> list:
    """Get recent battle log entries."""
    path = _log_path(citizen_handle)
    if not path.exists():
        return []
    cutoff = time.time() - hours * 3600
    entries = []
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
            if entry.get("ts", 0) >= cutoff:
                entries.append(entry)
        except json.JSONDecodeError:
            continue
    return entries

def _log_path(citizen_handle: str) -> Path:
    """Get battle log path for a citizen."""
    # Try universe repo first, fallback to mind-mcp
    for base in [
        Path(os.environ.get("WORLD_REPO", "/home/mind-protocol/lumina-prime")),
        Path(os.environ.get("TARGET_DIR", "/home/mind-protocol/lumina-prime")),
    ]:
        citizen_dir = base / "citizens" / citizen_handle
        if citizen_dir.is_dir() and (
            (citizen_dir / "profile.json").exists() or (citizen_dir / "CLAUDE.md").exists()
        ):
            log_dir = citizen_dir / "battle_log"
            log_dir.mkdir(exist_ok=True)
            return log_dir / "log.jsonl"
    # Fallback
    fallback = Path(f"/tmp/mind-battle-log/{citizen_handle}")
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback / "log.jsonl"

def _append(citizen_handle: str, entry: dict):
    """Append entry to citizen's battle log."""
    try:
        path = _log_path(citizen_handle)
        with open(path, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception as e:
        logger.warning(f"Battle log write failed for {citizen_handle}: {e}")
