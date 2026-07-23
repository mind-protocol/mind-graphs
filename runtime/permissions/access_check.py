"""
HAS_ACCESS permission checker — graph-gated filesystem access for citizens.

Citizens run `claude -p` in their own `citizens/{handle}/` directory.
They can see their own files by default. To access other directories,
the MCP server checks the L2 graph for HAS_ACCESS links between the
citizen's Actor node and Space nodes (which represent directories).

Always allowed (no graph query):
  - Own directory: citizens/{handle}/**  (read + write)
  - Message delivery: citizens/*/messages/  (write only)

Everything else requires a HAS_ACCESS link in the graph.

Results are cached per citizen per session to avoid querying the graph
on every file access. The cache is a module-level dict keyed by
(citizen_handle, normalized_path).

Environment:
  FALKORDB_HOST  — default "localhost"
  FALKORDB_PORT  — default 6379
  L2_GRAPH       — default "mind_protocol"
  MIND_HANDLE    — citizen handle override

Co-Authored-By: Dev (@dev) <dev@mindprotocol.ai>
"""

import logging
import os
import re
from pathlib import Path
from typing import Dict, Optional, Tuple

logger = logging.getLogger("mind.permissions.access_check")

# ── Session cache ────────────────────────────────────────────────────────────
# Key: (citizen_handle, normalized_path) -> role ("read" | "write") or None
_access_cache: Dict[Tuple[str, str], Optional[str]] = {}

# ── Lazy FalkorDB connection ─────────────────────────────────────────────────
_graph = None


def _get_graph():
    """Lazy-connect to the L2 FalkorDB graph. Returns the graph object or None."""
    global _graph
    if _graph is not None:
        return _graph

    try:
        from falkordb import FalkorDB

        host = os.environ.get("FALKORDB_HOST", "localhost")
        port = int(os.environ.get("FALKORDB_PORT", "6379"))
        graph_name = os.environ.get("L2_GRAPH", "mind_protocol")

        db = FalkorDB(host=host, port=port)
        _graph = db.select_graph(graph_name)
        logger.info(f"[permissions] Connected to L2 graph {graph_name} at {host}:{port}")
        return _graph
    except Exception as e:
        logger.warning(f"[permissions] Cannot connect to L2 graph: {e}")
        return None


def _normalize_path(path_str: str) -> str:
    """Resolve and normalize a path string for consistent cache keys."""
    return str(Path(path_str).resolve())


def _extract_citizens_segment(path_str: str) -> Optional[Tuple[str, str]]:
    """Extract (citizen_handle, relative_subpath) from a path containing /citizens/.

    Returns None if the path doesn't contain /citizens/{handle}/.
    """
    # Le chemin arrive avec le séparateur natif : sous Windows c'est "\", et une
    # regex sur "/" ne matchait alors jamais. Conséquences observées : handle
    # toujours vide (donc perception muette) et vérifications de propriété
    # silencieusement fausses. On normalise avant de chercher.
    match = re.search(r"/citizens/([^/]+)(?:/(.*))?$", path_str.replace("\\", "/"))
    if match:
        handle = match.group(1)
        subpath = match.group(2) or ""
        return handle, subpath
    return None


def _is_own_directory(citizen_handle: str, target_path: str) -> bool:
    """Check if target_path is inside the citizen's own directory."""
    segment = _extract_citizens_segment(target_path)
    if segment is None:
        return False
    path_handle, _ = segment
    return path_handle == citizen_handle


def _is_messages_directory(target_path: str) -> bool:
    """Check if target_path is inside any citizen's messages/ directory."""
    segment = _extract_citizens_segment(target_path)
    if segment is None:
        return False
    _, subpath = segment
    # Allow writing to messages/ or messages/anything
    return subpath == "messages" or subpath.startswith("messages/")


def _query_graph_access(citizen_handle: str, target_path: str) -> Optional[str]:
    """Query the L2 graph for HAS_ACCESS link between citizen and path.

    Checks for:
      (Actor {id: citizen_handle})-[HAS_ACCESS]->(Space {path: target_path})

    Also checks parent directories — if access is granted to a parent,
    the child inherits. Walks up from target to root until a match is found
    or we run out of parents.

    Returns the role ("read", "write") or None if no access.
    """
    graph = _get_graph()
    if graph is None:
        # Graph unavailable — fail open with a warning.
        # In production this should fail closed, but during bootstrap
        # many citizens won't have a running FalkorDB.
        logger.warning(
            f"[permissions] Graph unavailable, denying access for "
            f"{citizen_handle} -> {target_path}"
        )
        return None

    # Collect the target path and all its parents
    check_path = Path(target_path)
    paths_to_check = []
    while str(check_path) != check_path.root:
        paths_to_check.append(str(check_path))
        check_path = check_path.parent

    if not paths_to_check:
        return None

    # Single query: check all candidate paths at once
    try:
        cypher = (
            "MATCH (a {id: $handle})-[r:HAS_ACCESS]->(s {path: $path}) "
            "RETURN s.path AS path, r.role AS role "
            "LIMIT 1"
        )
        # Check most specific path first, walk up
        for candidate in paths_to_check:
            result = graph.query(cypher, {"handle": citizen_handle, "path": candidate})
            if result.result_set:
                row = result.result_set[0]
                role = row[1] if len(row) > 1 else "read"
                logger.debug(
                    f"[permissions] {citizen_handle} has '{role}' access "
                    f"to {target_path} via {candidate}"
                )
                return role
    except Exception as e:
        logger.warning(f"[permissions] Graph query failed: {e}")

    return None


def check_access(
    citizen_handle: str,
    target_path: str,
    operation: str = "read",
) -> bool:
    """Check if citizen has access to target path.

    Always allowed:
    - Own directory: citizens/{handle}/**
    - Message delivery: citizens/*/messages/ (write only)

    Graph-gated:
    - Everything else requires HAS_ACCESS link in graph

    Args:
        citizen_handle: The citizen's handle (e.g., "dev", "nervo")
        target_path: Absolute or relative path to check
        operation: "read" or "write"

    Returns:
        True if access is allowed, False otherwise.
    """
    if not citizen_handle:
        logger.warning("[permissions] No citizen handle provided, denying access")
        return False

    normalized = _normalize_path(target_path)

    # ── Always-allow: own directory ──
    if _is_own_directory(citizen_handle, normalized):
        return True

    # ── Always-allow: message delivery (write to any citizen's messages/) ──
    if operation == "write" and _is_messages_directory(normalized):
        return True

    # ── Cache check ──
    cache_key = (citizen_handle, normalized)
    if cache_key in _access_cache:
        cached_role = _access_cache[cache_key]
        if cached_role is None:
            return False
        # "write" role allows both read and write; "read" only allows read
        if operation == "read":
            return cached_role in ("read", "write")
        return cached_role == "write"

    # ── Graph query ──
    role = _query_graph_access(citizen_handle, normalized)
    _access_cache[cache_key] = role

    if role is None:
        return False

    if operation == "read":
        return role in ("read", "write")
    return role == "write"


def clear_cache(citizen_handle: Optional[str] = None) -> int:
    """Clear the access cache. Returns number of entries cleared.

    Args:
        citizen_handle: If provided, only clear entries for this citizen.
                       If None, clear all entries.
    """
    global _access_cache
    if citizen_handle is None:
        count = len(_access_cache)
        _access_cache = {}
        return count

    keys_to_remove = [k for k in _access_cache if k[0] == citizen_handle]
    for k in keys_to_remove:
        del _access_cache[k]
    return len(keys_to_remove)


def detect_citizen_handle() -> str:
    """Auto-detect citizen handle from environment or CWD.

    Priority:
      1. MIND_HANDLE env var
      2. Canonical process identity variables used by HTTP/stdio transports
      3. MIND_ACTOR actor ID
      4. CWD inside citizens/{handle}/
    """
    for env_name in (
        "MIND_HANDLE",
        "MIND_CITIZEN_ID",
        "CITIZEN_HANDLE",
        "MIND_CITIZEN",
        "MIND_CITIZEN_HANDLE",
        "MIND_ACTOR",
    ):
        raw = os.environ.get(env_name, "")
        if not raw:
            continue
        handle = raw.strip().lstrip("@").lower().replace("-", "_")
        for prefix in ("citizen_", "actor_"):
            if handle.startswith(prefix):
                handle = handle[len(prefix):]
                break
        if handle:
            return handle

    cwd = os.getcwd()
    segment = _extract_citizens_segment(cwd)
    if segment:
        return segment[0]
    return ""
