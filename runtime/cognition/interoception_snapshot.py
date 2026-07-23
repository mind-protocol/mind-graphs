"""Publish and read the live L1 interoception snapshot.

The cognitive engine is the only writer. HTTP/stdio MCP processes are
read-only consumers, so they never need an in-process Dispatcher to report
fresh drives, emotions, working memory, energy, or orientation.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from .models import CitizenCognitiveState

SNAPSHOT_ID = "interoception-current"
SCHEMA_VERSION = "1.0"
DEFAULT_STALE_AFTER_SECONDS = 30.0


def _normalize_handle(raw: str) -> str:
    handle = str(raw or "").strip().lstrip("@").lower().replace("-", "_")
    for prefix in ("citizen_", "actor_", "l3_actor_"):
        if handle.startswith(prefix):
            handle = handle[len(prefix):]
            break
    return handle.strip("_")


def l1_graph_candidates(citizen_handle: str) -> Iterable[str]:
    """Yield supported graph names in runtime preference order."""
    handle = _normalize_handle(citizen_handle)
    if not handle:
        return
    configured = os.environ.get("L1_GRAPH", "").strip()
    seen: set[str] = set()
    for graph_name in (
        configured,
        f"l1_{handle}",
        handle,
        f"l1_{handle}_graph",
        f"brain_{handle}",
    ):
        if graph_name and graph_name not in seen:
            seen.add(graph_name)
            yield graph_name


def resolve_l1_graph_name(citizen_handle: str, db=None) -> str:
    """Select an existing L1 graph without creating an empty legacy graph."""
    candidates = list(l1_graph_candidates(citizen_handle))
    if not candidates:
        raise ValueError("A citizen handle is required")

    if db is None:
        from falkordb import FalkorDB

        db = FalkorDB(
            host=os.environ.get("FALKORDB_HOST", "localhost"),
            port=int(os.environ.get("FALKORDB_PORT", "6379")),
        )

    existing = set(db.list_graphs())
    return next((name for name in candidates if name in existing), candidates[0])


def _iso_utc(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def build_interoception_snapshot(
    state: CitizenCognitiveState,
    *,
    tick: Optional[int] = None,
    orientation: Optional[str] = None,
    engine_instance_id: Optional[str] = None,
    observed_at: Optional[float] = None,
    stale_after_seconds: Optional[float] = None,
) -> dict[str, Any]:
    """Build the versioned JSON payload written by the live engine."""
    now = float(time.time() if observed_at is None else observed_at)
    stale_after = float(
        stale_after_seconds
        if stale_after_seconds is not None
        else os.environ.get(
            "MIND_INTEROCEPTION_STALE_AFTER",
            str(DEFAULT_STALE_AFTER_SECONDS),
        )
    )
    limbic = state.limbic
    metabolism = getattr(state, "metabolism", None)

    circadian_phase = None
    if metabolism is not None:
        try:
            circadian_phase = float(metabolism.circadian_phase())
        except Exception:
            circadian_phase = None

    return {
        "id": SNAPSHOT_ID,
        "schemaVersion": SCHEMA_VERSION,
        "nodeType": "interoception_snapshot",
        "semanticType": "runtime_state",
        "citizen": _normalize_handle(state.citizen_id),
        "observedAt": _iso_utc(now),
        "observedAtEpoch": now,
        "expiresAt": _iso_utc(now + stale_after),
        "tick": int(state.tick_count if tick is None else tick),
        "energy": float(sum(node.energy for node in state.nodes.values())),
        "arousal": float(limbic.arousal),
        "drives": {
            name: float(drive.intensity)
            for name, drive in limbic.drives.items()
        },
        "emotions": {
            name: float(value)
            for name, value in limbic.emotions.items()
        },
        "workingMemory": {
            "used": len(state.wm.node_ids),
            "capacity": 7,
            "nodeIds": list(state.wm.node_ids),
        },
        "orientation": orientation,
        "circadianPhase": circadian_phase,
        "engineInstanceId": engine_instance_id,
    }


def publish_interoception_snapshot(
    state: CitizenCognitiveState,
    *,
    tick: Optional[int] = None,
    orientation: Optional[str] = None,
    engine_instance_id: Optional[str] = None,
    observed_at: Optional[float] = None,
    graph=None,
    db=None,
) -> dict[str, Any]:
    """Atomically replace the current snapshot in the citizen's L1 graph."""
    payload = build_interoception_snapshot(
        state,
        tick=tick,
        orientation=orientation,
        engine_instance_id=engine_instance_id,
        observed_at=observed_at,
    )

    if graph is None:
        if db is None:
            from falkordb import FalkorDB

            db = FalkorDB(
                host=os.environ.get("FALKORDB_HOST", "localhost"),
                port=int(os.environ.get("FALKORDB_PORT", "6379")),
            )
        graph_name = resolve_l1_graph_name(payload["citizen"], db=db)
        graph = db.select_graph(graph_name)
    else:
        graph_name = getattr(graph, "name", None) or getattr(graph, "graph_name", None)

    graph.query(
        """
        MERGE (s:RuntimeState {id: $id})
        SET s.nodeType = $node_type,
            s.semanticType = $semantic_type,
            s.citizen = $citizen,
            s.schemaVersion = $schema_version,
            s.observedAt = $observed_at_iso,
            s.observed_at = $observed_at,
            s.expiresAt = $expires_at,
            s.data = $data
        """,
        {
            "id": SNAPSHOT_ID,
            "node_type": payload["nodeType"],
            "semantic_type": payload["semanticType"],
            "citizen": payload["citizen"],
            "schema_version": payload["schemaVersion"],
            "observed_at_iso": payload["observedAt"],
            "observed_at": payload["observedAtEpoch"],
            "expires_at": payload["expiresAt"],
            "data": json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        },
    )
    payload["graphName"] = graph_name
    return payload


def read_interoception_snapshot(
    citizen_handle: str,
    *,
    now: Optional[float] = None,
    stale_after_seconds: Optional[float] = None,
    db=None,
) -> Optional[dict[str, Any]]:
    """Read the first available snapshot and classify it as fresh or stale."""
    if db is None:
        from falkordb import FalkorDB

        db = FalkorDB(
            host=os.environ.get("FALKORDB_HOST", "localhost"),
            port=int(os.environ.get("FALKORDB_PORT", "6379")),
        )

    existing = set(db.list_graphs())
    for graph_name in l1_graph_candidates(citizen_handle):
        if graph_name not in existing:
            continue
        result = db.select_graph(graph_name).query(
            "MATCH (s {id: $id}) RETURN s.data, s.observed_at, s.schemaVersion LIMIT 1",
            {"id": SNAPSHOT_ID},
        )
        if not result.result_set:
            continue

        raw_data, observed_at_property, schema_version = result.result_set[0]
        try:
            payload = json.loads(raw_data) if raw_data else {}
        except (TypeError, json.JSONDecodeError):
            return None

        observed_at = float(
            payload.get("observedAtEpoch")
            or observed_at_property
            or 0.0
        )
        current_time = float(time.time() if now is None else now)
        age = max(0.0, current_time - observed_at)
        stale_after = float(
            stale_after_seconds
            if stale_after_seconds is not None
            else os.environ.get(
                "MIND_INTEROCEPTION_STALE_AFTER",
                str(DEFAULT_STALE_AFTER_SECONDS),
            )
        )
        payload["schemaVersion"] = payload.get("schemaVersion") or schema_version
        payload["graphName"] = graph_name
        payload["ageSeconds"] = age
        payload["freshness"] = "fresh" if observed_at > 0 and age <= stale_after else "stale"
        return payload
    return None
