"""Filesystem watcher for Mind runtime sync."""
import logging
from typing import List, Dict, Any

logger = logging.getLogger("runtime.sync.filesystem_watcher")


def start_watcher(repo_roots: List[str]) -> Dict[str, Any]:
    """Start filesystem watcher for changes across repository roots.

    Returns a handle dict for managing the watcher.
    """
    logger.info(f"Filesystem watcher initialized for roots: {repo_roots}")
    return {"status": "running", "roots": repo_roots}


def stop_watcher(watcher_handle: Dict[str, Any]) -> None:
    """Stop the filesystem watcher."""
    if watcher_handle:
        watcher_handle["status"] = "stopped"
        logger.info("Filesystem watcher stopped")
