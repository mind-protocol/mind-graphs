"""
HAS_ACCESS link creator — grant filesystem access to a citizen via the L2 graph.

Creates a Space node for the target directory (if it doesn't exist),
then creates a HAS_ACCESS link from the citizen's Actor node to that Space.

Environment:
  FALKORDB_HOST  — default "localhost"
  FALKORDB_PORT  — default 6379
  L2_GRAPH       — default "mind_protocol"

Co-Authored-By: Dev (@dev) <dev@mindprotocol.ai>
"""

import logging
import os
from pathlib import Path
from typing import Optional

logger = logging.getLogger("mind.permissions.grant_access")

# Reuse the lazy connection from access_check
from .access_check import _get_graph, clear_cache

# Valid roles
_VALID_ROLES = ("read", "write")


def grant_access(
    citizen_handle: str,
    path: str,
    role: str = "read",
) -> bool:
    """Create HAS_ACCESS link between citizen and a directory (as Space node).

    - Creates the Space node with the given path if it doesn't exist.
    - Creates or updates the HAS_ACCESS link from the citizen's Actor node.
    - Clears the permission cache for this citizen so the new grant takes
      effect immediately.

    Args:
        citizen_handle: The citizen's handle (e.g., "dev", "nervo")
        path: Absolute path to the directory to grant access to.
        role: "read" or "write". "write" implies read access.

    Returns:
        True if the grant succeeded, False if graph is unavailable or query failed.
    """
    if not citizen_handle:
        logger.error("[grant_access] No citizen handle provided")
        return False

    if role not in _VALID_ROLES:
        logger.error(f"[grant_access] Invalid role '{role}'. Must be one of {_VALID_ROLES}")
        return False

    normalized = str(Path(path).resolve())

    graph = _get_graph()
    if graph is None:
        logger.warning(
            f"[grant_access] Graph unavailable, cannot grant "
            f"{citizen_handle} -> {normalized}"
        )
        return False

    try:
        # MERGE the Space node (create if not exists)
        graph.query(
            "MERGE (s:Space {path: $path}) "
            "ON CREATE SET s.id = $space_id, s.node_type = 'space', "
            "s.type = 'directory', s.content = $content",
            {
                "path": normalized,
                "space_id": f"space:{normalized}",
                "content": f"Directory: {normalized}",
            },
        )

        # MERGE the HAS_ACCESS link (create or update role)
        graph.query(
            "MATCH (a {id: $handle}), (s:Space {path: $path}) "
            "MERGE (a)-[r:HAS_ACCESS]->(s) "
            "SET r.role = $role",
            {
                "handle": citizen_handle,
                "path": normalized,
                "role": role,
            },
        )

        logger.info(
            f"[grant_access] Granted '{role}' access: "
            f"{citizen_handle} -> {normalized}"
        )

        # Clear cache so the new permission takes effect immediately
        clear_cache(citizen_handle)
        return True

    except Exception as e:
        logger.error(f"[grant_access] Failed to grant access: {e}")
        return False


def revoke_access(
    citizen_handle: str,
    path: str,
) -> bool:
    """Remove HAS_ACCESS link between citizen and a directory.

    Args:
        citizen_handle: The citizen's handle
        path: Absolute path to the directory

    Returns:
        True if the revocation succeeded, False otherwise.
    """
    if not citizen_handle:
        logger.error("[revoke_access] No citizen handle provided")
        return False

    normalized = str(Path(path).resolve())

    graph = _get_graph()
    if graph is None:
        logger.warning(
            f"[revoke_access] Graph unavailable, cannot revoke "
            f"{citizen_handle} -> {normalized}"
        )
        return False

    try:
        graph.query(
            "MATCH (a {id: $handle})-[r:HAS_ACCESS]->(s:Space {path: $path}) "
            "DELETE r",
            {
                "handle": citizen_handle,
                "path": normalized,
            },
        )

        logger.info(
            f"[revoke_access] Revoked access: "
            f"{citizen_handle} -> {normalized}"
        )

        clear_cache(citizen_handle)
        return True

    except Exception as e:
        logger.error(f"[revoke_access] Failed to revoke access: {e}")
        return False


def list_access(citizen_handle: str) -> list:
    """List all directories a citizen has access to.

    Returns:
        List of dicts: [{"path": str, "role": str}]
    """
    graph = _get_graph()
    if graph is None:
        return []

    try:
        result = graph.query(
            "MATCH (a {id: $handle})-[r:HAS_ACCESS]->(s:Space) "
            "RETURN s.path AS path, r.role AS role",
            {"handle": citizen_handle},
        )

        entries = []
        if result.result_set:
            for row in result.result_set:
                entries.append({
                    "path": row[0] if len(row) > 0 else "",
                    "role": row[1] if len(row) > 1 else "read",
                })
        return entries

    except Exception as e:
        logger.error(f"[list_access] Query failed for {citizen_handle}: {e}")
        return []
