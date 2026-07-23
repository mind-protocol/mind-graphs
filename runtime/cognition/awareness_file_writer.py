"""
Awareness File Writer — Persist WM state as awareness.md for citizen prompt injection.

Writes `citizens/{handle}/awareness.md` whenever WM changes.
The file contains YAML frontmatter (tick, orientation, timestamp, wm_size,
nodes_total) followed by the natural-language output of
serialize_wm_to_prompt().

Path resolution:
    _MIND_MCP_ROOT = this_file / ../../..         (runtime/cognition/ -> mind-mcp/)
    _WORLD_ROOT    = _MIND_MCP_ROOT / ../..       (mind-mcp/ -> world repo root)
    _CITIZENS_DIR  = _WORLD_ROOT / citizens

Returns False if the citizen directory does not exist (citizen has no
filesystem presence). Raises on I/O errors so callers can handle them.

Co-Authored-By: Dev (@dev) <dev@mindprotocol.ai>
"""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Optional

from .models import CitizenCognitiveState
from .wm_prompt_serializer import serialize_wm_to_prompt

logger = logging.getLogger("cognition.awareness_writer")

# =========================================================================
# Path resolution
# =========================================================================

# runtime/cognition/awareness_file_writer.py -> runtime/cognition/
#   -> runtime/ -> mind-mcp/
_MIND_MCP_ROOT: Path = Path(__file__).resolve().parent.parent.parent


def _resolve_citizens_dir() -> Path:
    """Resolve the citizens/ directory using env var or heuristics.

    Priority:
      1. WORLD_ROOT env var -> {WORLD_ROOT}/citizens/
      2. CITIZENS_DIR env var -> direct path
      3. Submodule layout: mind-mcp at {world_repo}/.mind/mind-mcp/
         -> _MIND_MCP_ROOT.parent.parent / citizens
      4. Standalone layout: mind-mcp at {workspace}/mind-mcp/
         -> _MIND_MCP_ROOT.parent / citizens  (sibling world repo)
      5. Fallback: _MIND_MCP_ROOT / citizens  (local citizens dir)
    """
    # Explicit env vars
    if os.environ.get("CITIZENS_DIR"):
        return Path(os.environ["CITIZENS_DIR"])
    if os.environ.get("WORLD_ROOT"):
        return Path(os.environ["WORLD_ROOT"]) / "citizens"

    # Submodule layout: mind-mcp at {world_repo}/.mind/mind-mcp/
    submodule_world = _MIND_MCP_ROOT.parent.parent
    submodule_citizens = submodule_world / "citizens"
    if submodule_citizens.is_dir():
        return submodule_citizens

    # Standalone layout: mind-mcp alongside a world repo (e.g. lumina-prime)
    # Use L3_GRAPH / FALKORDB_GRAPH as hint for the world repo name
    workspace = _MIND_MCP_ROOT.parent
    graph_hint = os.environ.get("L3_GRAPH", os.environ.get("FALKORDB_GRAPH", ""))
    if graph_hint:
        hinted = workspace / graph_hint / "citizens"
        if hinted.is_dir():
            return hinted

    # Fallback: scan sibling dirs for one with citizens/
    for sibling in sorted(workspace.iterdir()):
        if sibling.is_dir() and sibling.name != "mind-mcp":
            candidate = sibling / "citizens"
            if candidate.is_dir():
                return candidate

    # Last resort: citizens/ inside mind-mcp itself
    local = _MIND_MCP_ROOT / "citizens"
    return local


_CITIZENS_DIR: Path = _resolve_citizens_dir()


# =========================================================================
# Public API
# =========================================================================

def write_awareness_file(
    state: CitizenCognitiveState,
    tick: int,
    orientation: Optional[str] = None,
    previous_wm_ids: Optional[list[str]] = None,
    previous_emotions: Optional[dict[str, float]] = None,
) -> bool:
    """Write the citizen's awareness.md file with current WM state.

    Args:
        state: The citizen's full cognitive state.
        tick: Current tick number.
        orientation: Current behavioral orientation (explore, create, etc.)
        previous_wm_ids: WM node IDs from previous tick (for shift narration).
        previous_emotions: Emotion values from previous tick.

    Returns:
        True if the file was written successfully.
        False if the citizen directory does not exist.

    Raises:
        OSError: On I/O errors (permission denied, disk full, etc.)
    """
    # Resolve citizen handle from citizen_id
    handle = state.citizen_id

    citizen_dir = _CITIZENS_DIR / handle
    if not citizen_dir.is_dir():
        logger.debug(
            f"Citizen directory does not exist: {citizen_dir} -- "
            f"skipping awareness write for {handle}"
        )
        return False

    awareness_path = citizen_dir / "awareness.md"

    # Generate the WM prompt text
    wm_text = serialize_wm_to_prompt(
        state,
        orientation=orientation,
        previous_wm_ids=previous_wm_ids,
        previous_emotions=previous_emotions,
    )

    # Build YAML frontmatter
    timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    wm_size = len(state.wm.node_ids)
    nodes_total = len(state.nodes)

    frontmatter_lines = [
        "---",
        f"tick: {tick}",
        f"orientation: {orientation or 'unknown'}",
        f"timestamp: {timestamp}",
        f"wm_size: {wm_size}",
        f"nodes_total: {nodes_total}",
        "---",
    ]
    frontmatter = "\n".join(frontmatter_lines)

    # Compose final content
    content = f"{frontmatter}\n\n{wm_text}\n"

    # Write atomically-ish (write to same path; no temp file needed for
    # a small file that is read by prompt assembly, not by concurrent writers)
    awareness_path.write_text(content, encoding="utf-8")

    logger.debug(
        f"Awareness written for {handle}: tick={tick}, "
        f"orientation={orientation}, wm_size={wm_size}, "
        f"nodes_total={nodes_total}, path={awareness_path}"
    )
    return True
