"""
Graph Reader for Awareness Tick — FalkorDB-backed external graph scanner.

Creates a `graph_read_fn(citizen_id)` closure that the awareness tick can
call to scan the citizen's 1-hop neighborhood in the L3 (world) graph.

Connection details:
    FALKORDB_HOST  (default: localhost)
    FALKORDB_PORT  (default: 6379)
    FALKORDB_GRAPH (default: lumina)

The closure:
1. Connects to FalkorDB lazily (first call) with auto-reconnect.
2. Queries 1-hop neighbors of the citizen's Actor node, filtered by
   energy > 0.1 OR recent activity (timestamp within last 5 minutes).
3. Deduplicates nodes by ID.
4. Fetches 2nd-hop inter-neighbor links (links between the neighbors
   themselves) for richer context.
5. Returns list of cluster dicts compatible with awareness_tick():
   [{"node": {...}, "links": [...]}, ...]

Co-Authored-By: Dev (@dev) <dev@mindprotocol.ai>
"""

from __future__ import annotations

import logging
import os
import time
from typing import Callable, Optional

logger = logging.getLogger("cognition.graph_reader")

# =========================================================================
# Configuration from environment
# =========================================================================

_FALKORDB_HOST = os.environ.get("FALKORDB_HOST", "localhost")
_FALKORDB_PORT = int(os.environ.get("FALKORDB_PORT", "6379"))
_FALKORDB_GRAPH = os.environ.get("FALKORDB_GRAPH", "lumina-prime")

# Scan window: nodes with activity more recent than this are included
# even if their energy is below the threshold.
_RECENT_WINDOW_S = 300.0  # 5 minutes

# Energy threshold: nodes above this are always included.
_ENERGY_THRESHOLD = 0.1


def citizen_actor_ids(citizen_id: str) -> list[str]:
    """Resolve one citizen handle to the actor IDs used across L3 projections."""
    normalized = str(citizen_id or "").strip().lstrip("@").lower().replace("-", "_")
    for prefix in ("citizen_", "actor_", "l3_actor_"):
        if normalized.startswith(prefix):
            normalized = normalized[len(prefix):]
            break
    normalized = normalized.strip("_")
    slug = normalized.replace("_", "-")
    return list(dict.fromkeys([
        normalized,
        f"CITIZEN_{normalized}",
        f"actor-{slug}",
        f"l3-actor-{slug}",
    ]))


# =========================================================================
# Public API
# =========================================================================

def create_graph_read_fn() -> Callable[[str], list[dict]]:
    """Create a closure that reads the external graph for a citizen.

    Returns:
        A callable `graph_read_fn(citizen_id) -> list[dict]` suitable
        for passing to `awareness_tick()`.

    The closure manages its own FalkorDB connection with lazy init
    and auto-reconnect on failure.
    """
    # Mutable state captured by the closure
    _state = {
        "graph": None,
        "connected": False,
    }

    def _ensure_connection() -> bool:
        """Lazily connect (or reconnect) to FalkorDB."""
        if _state["connected"] and _state["graph"] is not None:
            return True

        try:
            from falkordb import FalkorDB
            db = FalkorDB(host=_FALKORDB_HOST, port=_FALKORDB_PORT)
            _state["graph"] = db.select_graph(_FALKORDB_GRAPH)
            _state["connected"] = True
            logger.info(
                f"Graph reader connected to {_FALKORDB_HOST}:{_FALKORDB_PORT} "
                f"graph={_FALKORDB_GRAPH}"
            )
            return True
        except Exception as e:
            logger.warning(f"FalkorDB connection failed: {e}")
            _state["graph"] = None
            _state["connected"] = False
            return False

    def _safe_query(cypher: str, params: dict) -> list:
        """Execute a Cypher query, returning result_set or empty list."""
        graph = _state["graph"]
        if graph is None:
            return []
        try:
            result = graph.query(cypher, params)
            return result.result_set if result.result_set else []
        except Exception as e:
            logger.debug(f"Graph query failed: {e}")
            # Mark disconnected so next call will reconnect
            _state["connected"] = False
            return []

    def graph_read_fn(citizen_id: str) -> list[dict]:
        """Read 1-hop neighborhood of a citizen's Actor node.

        Args:
            citizen_id: The citizen's actor ID in the L3 graph.

        Returns:
            List of cluster dicts:
            [
                {
                    "node": {
                        "id": str,
                        "node_type": str,
                        "content": str,
                        "energy": float,
                        "weight": float,
                        "stability": float,
                        "valence": float,
                        "relevance": float,
                        "origin_citizen": str,
                    },
                    "links": [
                        {
                            "source_id": str,
                            "target_id": str,
                            "link_type": str,
                            "weight": float,
                        },
                        ...
                    ]
                },
                ...
            ]
        """
        if not _ensure_connection():
            return []

        now = time.time()
        since = now - _RECENT_WINDOW_S

        # ── Step 1: Query 1-hop neighbors ──
        # Match nodes connected to the citizen's Actor node via LINK edges.
        # Filter: energy > threshold OR recent activity.
        # Both directions: outgoing and incoming links.
        actor_ids = citizen_actor_ids(citizen_id)
        rows = _safe_query(
            "MATCH (a)-[r]-(n) "
            "WHERE a.id IN $cids "
            "AND ("
            "(n.energy > $ethresh OR n.timestamp > $since) "
            "OR coalesce(r.weight, 0.0) >= 0.5 "
            "OR toLower(coalesce(n.node_type, '')) = 'moment' "
            "OR 'Moment' IN labels(n)"
            ") "
            "AND NOT n.id IN $cids "
            "RETURN DISTINCT n.id, n.node_type, n.name, n.synthesis, n.content, "
            "       n.energy, n.weight, n.stability, n.valence, "
            "       r.weight, coalesce(r.relation_kind, r.computed_type, type(r)), "
            "       r.perception_energy, n.timestamp, "
            "       coalesce(n.author_handle, n.origin_citizen, '') "
            "LIMIT 50",
            {
                "cids": actor_ids,
                "ethresh": _ENERGY_THRESHOLD,
                "since": since,
            },
        )

        if not rows:
            return []

        # ── Step 2: Deduplicate by node ID ──
        seen_ids: set[str] = set()
        neighbor_ids: list[str] = []
        node_data: dict[str, dict] = {}

        for row in rows:
            n_id = row[0]
            if not n_id or n_id in seen_ids:
                continue
            seen_ids.add(n_id)
            neighbor_ids.append(n_id)

            node_data[n_id] = {
                "id": n_id,
                "node_type": _normalize_node_type(row[1]),
                "content": row[4] or row[3] or row[2] or n_id,
                "energy": max(float(row[5] or 0.0), float(row[11] or 0.0)),
                "weight": float(row[6] or 0.1),
                "stability": float(row[7] or 0.0),
                "valence": float(row[8] or 0.0),
                "relevance": 1.0 if float(row[11] or 0.0) > 0 else 0.5,
                "partner_relevance": 1.0 if float(row[11] or 0.0) > 0 else 0.0,
                "origin_citizen": row[13] or "",
                "origin_date": float(row[12] or 0.0),
            }

        if not neighbor_ids:
            return []

        # ── Step 3: Fetch inter-neighbor links (2nd-hop connections) ──
        # These are links between the neighbors themselves, providing
        # richer structural context for the awareness tick.
        inter_links: dict[str, list[dict]] = {nid: [] for nid in neighbor_ids}

        if len(neighbor_ids) >= 2:
            # Query links between the discovered neighbors
            link_rows = _safe_query(
                "MATCH (a)-[r:LINK]->(b) "
                "WHERE a.id IN $nids AND b.id IN $nids "
                "AND a.id <> b.id "
                "RETURN a.id, b.id, r.relation_kind, r.weight "
                "LIMIT 200",
                {"nids": neighbor_ids},
            )

            for link_row in link_rows:
                src, tgt = link_row[0], link_row[1]
                link_dict = {
                    "source_id": src,
                    "target_id": tgt,
                    "link_type": link_row[2] or "associates",
                    "weight": float(link_row[3] or 0.1),
                }
                # Attach to both source and target clusters
                if src in inter_links:
                    inter_links[src].append(link_dict)
                if tgt in inter_links:
                    inter_links[tgt].append(link_dict)

        # ── Step 4: Assemble clusters ──
        clusters: list[dict] = []
        for nid in neighbor_ids:
            clusters.append({
                "node": node_data[nid],
                "links": inter_links.get(nid, []),
            })

        logger.debug(
            f"Graph read for {citizen_id}: "
            f"{len(clusters)} neighbors, "
            f"{sum(len(c['links']) for c in clusters)} inter-links"
        )
        return clusters

    return graph_read_fn


# =========================================================================
# Helpers
# =========================================================================

def _normalize_node_type(raw: Optional[str]) -> str:
    """Normalize L3 node type labels to L1-compatible strings.

    L3 uses capitalized labels (Actor, Space, Moment, Narrative, Thing).
    L1 NodeType uses lowercase (memory, concept, narrative, etc.).
    """
    if not raw:
        return "concept"

    mapping = {
        "actor": "concept",
        "space": "concept",
        "moment": "memory",
        "narrative": "narrative",
        "thing": "concept",
        # L1 types pass through
        "memory": "memory",
        "concept": "concept",
        "value": "value",
        "process": "process",
        "desire": "desire",
        "state": "state",
    }
    return mapping.get(raw.lower(), "concept")
