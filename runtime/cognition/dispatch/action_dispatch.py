"""
Action Dispatch — Route process node action_commands to MCP tools.

Spec: ai_devboard/docs/interaction/ALGORITHM_Interaction.md

When a process node's energy crosses the action threshold (Law 17 impulse
accumulation), the tick runner reads its action_command string and routes
it through this module:

    action_command string
        → parse_action_command()     → (tool_name, args)
        → compute_context_match()    → relevance check
        → execute via MCP tool       → ActionResult
        → record_action_moment()     → graph persistence
        → write_output_to_filesystem → evidence trail
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np

logger = logging.getLogger("cognition.dispatch")


@dataclass
class ActionCommand:
    """Parsed action command ready for execution."""
    tool_name: str
    args: str
    raw: str


@dataclass
class ActionResult:
    """Result of executing an action command."""
    success: bool
    output: str = ""
    error: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# parse_action_command
# ---------------------------------------------------------------------------


def parse_action_command(command_string: str) -> ActionCommand:
    """Parse an action_command string into a tool name and arguments.

    Spec: ALGORITHM_Interaction.md § parse_action_command

    Split on first space. Tool name is the first token (must be in
    MCP_TOOL_REGISTRY). Remaining string is the argument payload.

    Args:
        command_string: Raw action_command from process node
            e.g. "send platform=telegram message='hello'"
            e.g. "graph_query What narratives are active?"

    Returns:
        ActionCommand with tool_name and args separated.

    Raises:
        ValueError: If command_string is empty.
    """
    stripped = command_string.strip()
    if not stripped:
        raise ValueError("Empty action command")

    parts = stripped.split(None, 1)
    tool_name = parts[0]
    args = parts[1] if len(parts) > 1 else ""

    return ActionCommand(tool_name=tool_name, args=args, raw=stripped)


# ---------------------------------------------------------------------------
# compute_context_match
# ---------------------------------------------------------------------------


from runtime.utils import cosine_similarity as _cosine_similarity  # canonical impl


def compute_context_match(
    process_node: Dict[str, Any],
    wm_node_ids: List[str],
    all_nodes: Dict[str, Dict[str, Any]],
    all_links: List[Dict[str, Any]],
) -> float:
    """Determine how well current context matches the action's intended context.

    Spec: ALGORITHM_Interaction.md § compute_context_match

    Compares the process node's neighborhood (linked nodes) against
    current working memory contents. Returns float [0.0, 1.0].

    Strategy:
    1. Find all nodes linked to the process node (its neighborhood)
    2. Count how many of those neighbors are in working memory
    3. Also compute embedding similarity between action_context and WM centroid
    4. Combine both signals

    Args:
        process_node: The process/action node dict
        wm_node_ids: List of node IDs currently in working memory
        all_nodes: Full node dict (id → node)
        all_links: Full link list

    Returns:
        Float in [0.0, 1.0] — 1.0 means perfect context match.
    """
    if not wm_node_ids:
        return 0.0

    wm_set = set(wm_node_ids)
    node_id = process_node.get("id", "")

    # 1. Neighborhood overlap: what fraction of the node's neighbors are in WM?
    neighbor_ids = set()
    for link in all_links:
        src = link.get("source_id", link.get("node_a", ""))
        tgt = link.get("target_id", link.get("node_b", ""))
        if src == node_id and tgt:
            neighbor_ids.add(tgt)
        elif tgt == node_id and src:
            neighbor_ids.add(src)

    if neighbor_ids:
        overlap = len(neighbor_ids & wm_set) / len(neighbor_ids)
    else:
        overlap = 0.0

    # 2. Embedding similarity: action_context vs WM centroid
    action_context = process_node.get("action_context", [])
    embedding_match = 0.0

    if action_context:
        # Compute WM centroid from available embeddings
        wm_embeddings = []
        for nid in wm_node_ids:
            node = all_nodes.get(nid)
            if node and node.get("embedding"):
                wm_embeddings.append(node["embedding"])

        if wm_embeddings:
            centroid = np.mean(wm_embeddings, axis=0).tolist()
            embedding_match = max(0.0, _cosine_similarity(action_context, centroid))

    # Combine: 60% neighborhood overlap, 40% embedding match
    return min(1.0, 0.6 * overlap + 0.4 * embedding_match)


# ---------------------------------------------------------------------------
# write_output_to_filesystem
# ---------------------------------------------------------------------------


def write_output_to_filesystem(
    node_id: str,
    tick: int,
    result: ActionResult,
    base_dir: Optional[str] = None,
) -> str:
    """Persist action output to the filesystem.

    Spec: ALGORITHM_Interaction.md § write_output_to_filesystem

    Writes to {base_dir}/.mind/evidence/{node_id}/{tick}.json.
    Returns the path for use as EvidenceRef on the moment node.

    Args:
        node_id: The process node ID that triggered the action
        tick: Current tick number
        result: The ActionResult to persist
        base_dir: Base directory (defaults to HOME or cwd)

    Returns:
        Absolute path to the written evidence file.
    """
    if base_dir is None:
        base_dir = os.environ.get("HOME", os.getcwd())

    evidence_dir = Path(base_dir) / ".mind" / "evidence" / node_id
    evidence_dir.mkdir(parents=True, exist_ok=True)

    evidence_path = evidence_dir / f"{tick}.json"

    payload = {
        "node_id": node_id,
        "tick": tick,
        "timestamp": time.time(),
        "success": result.success,
        "output": result.output,
        "error": result.error,
        "metadata": result.metadata,
    }

    with open(evidence_path, "w") as f:
        json.dump(payload, f, indent=2, default=str)

    return str(evidence_path.resolve())


# ---------------------------------------------------------------------------
# record_action_moment
# ---------------------------------------------------------------------------


def record_action_moment(
    process_node: Dict[str, Any],
    result: ActionResult,
    tick: int,
    graph_ops: Any = None,
    base_dir: Optional[str] = None,
) -> Dict[str, Any]:
    """Write the action result to the graph as a moment node with EvidenceRef.

    Spec: ALGORITHM_Interaction.md § record_action_moment

    1. Write full output to filesystem via write_output_to_filesystem()
    2. Create a moment node with evidence_ref pointing to the file
    3. Link the moment to the source process node

    Args:
        process_node: The process/action node that fired
        result: ActionResult from tool execution
        tick: Current tick number
        graph_ops: Optional GraphOps instance for graph writes
        base_dir: Base directory for evidence files

    Returns:
        Dict describing the created moment node.
    """
    node_id = process_node.get("id", "unknown")

    # 1. Persist output to filesystem
    evidence_path = write_output_to_filesystem(
        node_id=node_id,
        tick=tick,
        result=result,
        base_dir=base_dir,
    )

    # 2. Build moment node
    moment_id = f"moment:action_{node_id}_{tick}"
    moment_node = {
        "id": moment_id,
        "node_type": "moment",
        "subtype": "action_result",
        "content": result.output[:500] if result.output else "",
        "evidence_ref": evidence_path,
        "source_node_id": node_id,
        "tick": tick,
        "timestamp": time.time(),
        "success": result.success,
        "energy": 1.0,
        "weight": 0.1,
    }

    # 3. Write to graph if available
    if graph_ops is not None:
        try:
            graph_ops.create_node(moment_node)
            graph_ops.create_link({
                "source_id": node_id,
                "target_id": moment_id,
                "link_type": "causes",
                "weight": 0.5,
            })
            logger.info(f"Recorded action moment {moment_id} → {evidence_path}")
        except Exception as e:
            logger.warning(f"Failed to write action moment to graph: {e}")

    return moment_node
