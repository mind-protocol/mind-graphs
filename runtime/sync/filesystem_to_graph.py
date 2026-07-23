"""Filesystem to graph sync utility."""
import logging
from typing import Optional

logger = logging.getLogger("runtime.sync.filesystem_to_graph")


def sync_file(path: str, actor_handle: Optional[str] = None) -> bool:
    """Sync a file modification to the graph.

    Args:
        path: Path to the modified file
        actor_handle: Citizen or system actor responsible for the edit
    """
    logger.debug(f"sync_file called for path={path}, actor={actor_handle}")
    return True
