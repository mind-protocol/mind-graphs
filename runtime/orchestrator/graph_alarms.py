"""Scheduled wakes live in the citizen's L1 graph — there is no citizen folder.

A wake is a Moment node in ``l1_<handle>_graph``:

    nodeType     "Moment"
    semanticType "task"
    scheduledFor ISO 8601, when it comes due
    status       "dormant" until it fires, then "fired"
    repeat       once | hourly | daily | weekly
    prompt       what the citizen is told on waking

That is the shape ``buildTemporalCommitmentCluster`` already produces on the design
side, so a wake reads the same whether it was planned or delivered. The Moment is
linked to its citizen with an AUTHORED_BY relation: a wake without an author would
be an orphan, and the graph does not carry orphans.

Citizens are discovered from the graph list (``l1_*_graph``), never from a directory.

Nothing here raises on a dead database: a wake store that cannot be reached must
degrade to "no wakes this scan", never take the orchestrator down with it.
"""

from __future__ import annotations

import logging
import os
import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("orchestrator.graph_alarms")

L1_GRAPH_RE = re.compile(r"^l1_(?P<handle>.+)_graph$")

REPEATS = {"once", "hourly", "daily", "weekly"}

# Manual wakes keep the historical ``task`` semantic type. Alarms produced by
# temporal-desire physics use the explicit ``Alarm`` semantic type. Both pass
# through the same temporal membrane and no parallel calendar exists.
WAKE_MATCH = (
    "MATCH (m:L1Node) WHERE m.nodeType = 'Moment' "
    "AND m.semanticType IN ['task', 'Alarm']"
)


def graph_name_for(handle: str) -> str:
    """The L1 graph backing one citizen."""
    return f"l1_{handle}_graph"


def _client():
    from falkordb import FalkorDB

    host = os.environ.get("FALKORDB_HOST", "localhost")
    port = int(os.environ.get("FALKORDB_PORT", "6379"))
    return FalkorDB(host=host, port=port)


def select_graph(handle: str):
    """Open one citizen's L1 graph."""
    return _client().select_graph(graph_name_for(handle))


def list_citizen_handles() -> List[str]:
    """Every citizen that has an L1 graph. Empty list if the database is unreachable."""
    try:
        client = _client()
        names = client.connection.execute_command("GRAPH.LIST")
    except Exception as e:
        logger.warning(f"Cannot list L1 graphs: {e}")
        return []

    handles = []
    for raw in names or []:
        name = raw.decode() if isinstance(raw, bytes) else str(raw)
        match = L1_GRAPH_RE.match(name)
        if match:
            handles.append(match.group("handle"))
    return sorted(handles)


def _as_comparable(value: Any) -> Optional[datetime]:
    """Parse a scheduledFor into a naive local datetime, or None if unusable.

    Offsets are dropped rather than honoured: the alarm path has always compared
    against ``datetime.now()``, and silently mixing aware and naive values would
    raise inside the scan.
    """
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed.replace(tzinfo=None) if parsed.tzinfo else parsed


def due_wakes(handle: str, now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    """Dormant wakes whose time has come, oldest first.

    A malformed scheduledFor is skipped and logged — one unreadable Moment must not
    hide the wakes queued behind it.
    """
    now = now or datetime.now()
    try:
        graph = select_graph(handle)
        result = graph.query(
            f"{WAKE_MATCH} AND m.status = 'dormant' AND exists(m.scheduledFor) RETURN m"
        )
    except Exception as e:
        logger.warning(f"Cannot read wakes for @{handle}: {e}")
        return []

    due: List[Tuple[datetime, Dict[str, Any]]] = []
    for row in result.result_set or []:
        props = dict(getattr(row[0], "properties", {}) or {})
        when = _as_comparable(props.get("scheduledFor"))
        if when is None:
            logger.warning(
                f"Wake {props.get('id', '?')} for @{handle} has an unusable scheduledFor: "
                f"{props.get('scheduledFor')!r} — skipped"
            )
            continue
        if when <= now:
            due.append((when, props))

    due.sort(key=lambda item: item[0])
    return [props for _, props in due]


def mark_fired(handle: str, wake_id: str, fired_at: Optional[datetime] = None) -> bool:
    """Consume a one-shot wake. Returns False if the write did not land."""
    fired_at = fired_at or datetime.now()
    try:
        graph = select_graph(handle)
        graph.query(
            f"{WAKE_MATCH} AND m.id = $id SET m.status = 'fired', m.firedAt = $firedAt",
            {"id": wake_id, "firedAt": fired_at.isoformat()},
        )
        return True
    except Exception as e:
        logger.warning(f"Could not mark wake {wake_id} fired for @{handle}: {e}")
        return False


def reschedule(handle: str, wake_id: str, next_at: datetime) -> bool:
    """Move a repeating wake to its next occurrence, leaving it dormant."""
    try:
        graph = select_graph(handle)
        graph.query(
            f"{WAKE_MATCH} AND m.id = $id "
            "SET m.scheduledFor = $next, m.status = 'dormant', m.lastFiredAt = $last",
            {"id": wake_id, "next": next_at.isoformat(), "last": datetime.now().isoformat()},
        )
        return True
    except Exception as e:
        logger.warning(f"Could not reschedule wake {wake_id} for @{handle}: {e}")
        return False


def create_wake(
    *,
    handle: str,
    scheduled_for: str,
    prompt: str,
    place: Optional[str] = None,
    repeat: str = "once",
) -> Dict[str, Any]:
    """Write one dormant wake into the citizen's L1 graph and return it.

    Raises on failure: a caller told "wake scheduled" when nothing was stored would
    be worse than an error.
    """
    if repeat not in REPEATS:
        raise ValueError("repeat must be once, hourly, daily, or weekly")
    prompt = (prompt or "").strip()
    if not prompt:
        raise ValueError("'prompt' is required")

    wake = {
        "id": f"wake-{uuid.uuid4().hex[:12]}",
        "nodeType": "Moment",
        "semanticType": "task",
        "name": f"Réveil · {prompt[:60]}",
        "prompt": prompt,
        "scheduledFor": scheduled_for,
        "status": "dormant",
        "repeat": repeat,
        "place": place or "",
        "citizenHandle": handle,
        "createdAt": datetime.now().isoformat(),
    }

    graph = select_graph(handle)
    # Properties are spelled out: FalkorDB rejects a map parameter as an inlined
    # property set ("unhandled type in inlined properties").
    graph.query(
        "CREATE (m:L1Node {"
        "id: $id, nodeType: $nodeType, semanticType: $semanticType, name: $name, "
        "prompt: $prompt, scheduledFor: $scheduledFor, status: $status, repeat: $repeat, "
        "place: $place, citizenHandle: $citizenHandle, createdAt: $createdAt"
        "}) RETURN m.id",
        wake,
    )
    # Attribution: the wake belongs to the citizen who will receive it.
    try:
        graph.query(
            "MATCH (m:L1Node {id: $id}) "
            "MERGE (a {id: $actor}) "
            "MERGE (m)-[:REL {type: 'AUTHORED_BY'}]->(a)",
            {"id": wake["id"], "actor": f"CITIZEN_{handle}"},
        )
    except Exception as e:
        # The wake itself is stored; a missing edge must not lose it.
        logger.warning(f"Wake {wake['id']} stored without AUTHORED_BY for @{handle}: {e}")

    logger.info(f"Wake stored for @{handle}: {wake['id']} at {scheduled_for} ({repeat})")
    return wake


def list_wakes(handle: str, include_fired: bool = False) -> List[Dict[str, Any]]:
    """Every wake for a citizen, dormant first."""
    try:
        graph = select_graph(handle)
        clause = "" if include_fired else " AND m.status = 'dormant'"
        result = graph.query(f"{WAKE_MATCH}{clause} RETURN m ORDER BY m.scheduledFor")
    except Exception as e:
        logger.warning(f"Cannot list wakes for @{handle}: {e}")
        return []
    return [dict(getattr(row[0], "properties", {}) or {}) for row in result.result_set or []]


def cancel_wake(handle: str, wake_id: str) -> bool:
    """Cancel a wake. Returns False when no dormant wake carried that id."""
    try:
        graph = select_graph(handle)
        result = graph.query(
            f"{WAKE_MATCH} AND m.id = $id AND m.status = 'dormant' "
            "SET m.status = 'cancelled', m.cancelledAt = $at RETURN m.id",
            {"id": wake_id, "at": datetime.now().isoformat()},
        )
        return bool(result.result_set)
    except Exception as e:
        logger.warning(f"Could not cancel wake {wake_id} for @{handle}: {e}")
        return False
