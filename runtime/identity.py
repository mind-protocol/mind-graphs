"""
Citizen identity resolution.

Detects and normalizes citizen IDs from environment, cwd, or config.
Used by MCP tool handlers that need to know which citizen is acting.
"""

import logging
import os
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


def normalize_citizen_id(handle: str) -> str:
    """Normalize a citizen handle to canonical CITIZEN_{handle} format.

    Strips leading @ if present. Lowercases the handle.

    Args:
        handle: e.g. "dragon_slayer", "@dragon_slayer", "CITIZEN_dragon_slayer"

    Returns:
        "CITIZEN_dragon_slayer"
    """
    handle = handle.strip().lstrip("@")
    if handle.upper().startswith("CITIZEN_"):
        handle = handle[8:]
    return f"CITIZEN_{handle.lower()}"


def extract_citizen_handle(citizen_id: str) -> str:
    """Extract the handle from a CITIZEN_ prefixed ID.

    Args:
        citizen_id: "CITIZEN_dragon_slayer"

    Returns:
        "dragon_slayer"
    """
    if citizen_id.startswith("CITIZEN_"):
        return citizen_id[8:]
    return citizen_id.lower()


def detect_citizen_id(target_dir: Optional[Path] = None) -> Optional[str]:
    """Detect the citizen this process acts as, from its environment.

    A process carries one identity, declared by whoever launched it
    (`MIND_CITIZEN_ID`, set by `citizen_registry.citizen_env`), and the L4
    registry decides whether that handle is a real citizen.

    L'identité ne se déduit plus du répertoire courant : un cwd n'est pas une
    preuve, et le même processus pouvait changer de citoyen en changeant de
    dossier. Le handle Telegram est la clé, L4 en est le registre.

    `target_dir` is accepted for call-site compatibility and ignored.

    Returns CITIZEN_{handle} if the handle is registered, None otherwise.
    """
    citizen = os.environ.get("MIND_CITIZEN_ID") or os.environ.get("CITIZEN_HANDLE")
    if not citizen:
        return None

    from runtime.l4.citizen_registry import get_citizen, normalize_handle

    handle = normalize_handle(citizen)
    if not handle:
        return None

    try:
        if get_citizen(handle) is None:
            logger.warning(
                "MIND_CITIZEN_ID=%s is not in the L4 registry — acting anonymously. "
                "Seed it with scripts/seed_citizen_registry.py.", citizen,
            )
            return None
    except Exception as e:
        # Registre injoignable ≠ citoyen inconnu. On ne fabrique pas une
        # identité sur une panne, et on ne la nie pas silencieusement non plus.
        logger.error("L4 registry unreachable while resolving @%s: %s", handle, e)
        raise

    return normalize_citizen_id(handle)


def resolve_actor_id(
    actor_input: Optional[str] = None,
    target_dir: Optional[Path] = None,
    graph_ops=None,
) -> str:
    """Resolve an actor input string to a canonical actor ID.

    Handles citizen IDs (CITIZEN_*) and raw handles.
    Falls back to citizen detection from env/cwd, then graph HUMAN lookup.

    Args:
        actor_input: Optional explicit actor ID or handle
        target_dir: Project root for citizen detection
        graph_ops: Optional graph ops for HUMAN lookup

    Returns:
        Canonical actor ID (e.g. "CITIZEN_solen", "HUMAN_Nicolas")
    """
    if not actor_input:
        # 1. Check for citizen context
        citizen_id = detect_citizen_id(target_dir)
        if citizen_id:
            return citizen_id

        # 2. Find best HUMAN actor from graph
        if graph_ops:
            try:
                result = graph_ops._query(
                    """
                    MATCH (a)
                    WHERE a.node_type = 'actor' AND a.type = 'HUMAN'
                    RETURN a.id, COALESCE(a.weight, 1.0) * COALESCE(a.energy, 0.5) as score
                    ORDER BY score DESC
                    LIMIT 1
                    """
                )
                if result and result[0]:
                    return result[0][0]
            except Exception as e:
                logger.warning(f"Error resolving owner from graph: {e}")

        return "unknown"

    actor_input = actor_input.strip()

    # Already canonical
    if actor_input.startswith("CITIZEN_"):
        return actor_input
    if actor_input.startswith("HUMAN_"):
        return actor_input

    # Looks like a citizen handle
    return normalize_citizen_id(actor_input)
