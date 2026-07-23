"""Graph projection for temporal-desire physics.

The AlarmWatcher calls :func:`process_temporal_desires` before reading due
alarms. The module fails open: a malformed expectation cannot silence manual
wakes or another citizen.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import replace
from datetime import datetime, timedelta
from typing import Any, Mapping, Optional

from runtime.cognition.temporal_desire import (
    DEFAULT_REFRACTORY_SECONDS,
    TemporalBias,
    TemporalExpectation,
    calculate_pressure,
    comparable_datetime,
    integrate_previous_interval,
    plan_next_alarm,
    resolve_modifiers,
    summarize_wake_load,
)
from runtime.orchestrator import graph_alarms

logger = logging.getLogger("orchestrator.graph_temporal_desires")

FRAME_ID = "temporal-desire-current"
FRAME_SCHEMA_VERSION = "1.0"
TEMPORAL_REASON = "temporal_desire_threshold"
TEMPORAL_PROMPT = (
    "Un désir important reste insuffisamment réalisé et son attente est "
    "devenue temporellement saillante."
)
RESCHEDULE_TOLERANCE_SECONDS = 2.0
PRESSURE_EPSILON = 1e-8

_RELATION_MATCH = """
MATCH (w)-[r:SEEKS_REALIZATION]->(o)
WHERE toLower(coalesce(w.semanticType, '')) = 'wish'
  AND coalesce(w.status, 'active') = 'active'
"""

_RELATION_FIELDS = """
w.id, coalesce(w.weight, 0.0), coalesce(w.status, 'active'), w.createdAt,
       o.id, coalesce(o.progress, 0.0), coalesce(o.status, 'active'),
       coalesce(r.commitment, 0.0), coalesce(r.category, ''),
       coalesce(r.baseClockRate, 1.0), coalesce(r.patienceTauSeconds, 43200.0),
       coalesce(r.baseThreshold, 0.65), coalesce(r.releaseThreshold, 0.40),
       coalesce(r.subjectiveAgeSeconds, 0.0), r.lastIntegratedAt,
       coalesce(r.heldClockRate, 1.0), coalesce(r.effectiveThreshold, 0.65),
       coalesce(r.generation, 0), r.alarmMomentId,
       coalesce(r.alarmArmed, true), r.refractoryUntil,
       r.measurementStatus, r.createdAt,
       r.lastProcessedMomentAt, r.lastProcessedMomentId,
       coalesce(r.flexibilityThresholdAdjustment, 0.0)
"""

_RELATION_QUERY = _RELATION_MATCH + "\nRETURN " + _RELATION_FIELDS


def _relation_key(wish_id: str, realization_id: str) -> str:
    return f"{wish_id}|{realization_id}"


def _alarm_id(relation_key: str, generation: int) -> str:
    digest = hashlib.sha256(relation_key.encode("utf-8")).hexdigest()[:12]
    return f"moment:alarm:temporal-desire:{digest}:{generation}"


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _number(value: object, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _integer(value: object, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _normalize_key(value: object) -> str:
    raw = str(value or "").strip().lower().replace("-", "_")
    for separator in (":", "/"):
        if separator in raw:
            raw = raw.split(separator)[-1]
    for prefix in ("affect_", "emotion_", "drive_", "subentity_"):
        if raw.startswith(prefix):
            raw = raw[len(prefix):]
    return raw


def _expectation_from_row(row: list[object]) -> tuple[TemporalExpectation, dict[str, Any]]:
    (
        wish_id,
        wish_weight,
        wish_status,
        wish_created_at,
        realization_id,
        progress,
        realization_status,
        commitment,
        category,
        base_clock_rate,
        patience_tau,
        base_threshold,
        release_threshold,
        subjective_age,
        last_integrated_at,
        held_clock_rate,
        effective_threshold,
        generation,
        alarm_moment_id,
        alarm_armed,
        refractory_until,
        measurement_status,
        relation_created_at,
        last_processed_moment_at,
        last_processed_moment_id,
        flexibility_adjustment,
    ) = row

    baseline = comparable_datetime(last_integrated_at)
    status = str(measurement_status or "")
    if baseline is None:
        baseline = comparable_datetime(relation_created_at) or comparable_datetime(wish_created_at)
        if baseline is None:
            status = "unknown"
        elif not status:
            status = "observed"
    elif not status:
        status = "observed"

    expectation = TemporalExpectation(
        wish_id=str(wish_id),
        realization_id=str(realization_id),
        wish_weight=_number(wish_weight),
        commitment=_number(commitment),
        progress=_number(progress),
        category=str(category or ""),
        base_clock_rate=_number(base_clock_rate, 1.0),
        patience_tau_seconds=max(0.001, _number(patience_tau, 43200.0)),
        base_threshold=_number(base_threshold, 0.65),
        release_threshold=_number(release_threshold, 0.40),
        subjective_age_seconds=max(0.0, _number(subjective_age)),
        last_integrated_at=baseline,
        held_clock_rate=_number(held_clock_rate, 1.0),
        effective_threshold=_number(effective_threshold, 0.65),
        generation=_integer(generation),
        alarm_moment_id=str(alarm_moment_id) if alarm_moment_id else None,
        alarm_armed=bool(alarm_armed),
        refractory_until=comparable_datetime(refractory_until),
        measurement_status=status,
        wish_status=str(wish_status or "active"),
        realization_status=str(realization_status or "active"),
    )
    metadata = {
        "lastProcessedMomentAt": comparable_datetime(last_processed_moment_at),
        "lastProcessedMomentId": str(last_processed_moment_id or ""),
        "flexibilityAdjustment": _number(flexibility_adjustment),
    }
    return expectation, metadata


def _load_expectations(graph) -> list[tuple[TemporalExpectation, dict[str, Any]]]:
    result = graph.query(_RELATION_QUERY)
    return [_expectation_from_row(list(row)) for row in (result.result_set or [])]


def _moment_is_new(
    occurred_at: datetime,
    moment_id: str,
    last_at: Optional[datetime],
    last_id: str,
) -> bool:
    if last_at is None:
        return True
    if occurred_at > last_at:
        return True
    return occurred_at == last_at and moment_id > last_id


def _apply_new_moments(
    graph,
    expectation: TemporalExpectation,
    metadata: dict[str, Any],
) -> tuple[TemporalExpectation, dict[str, Any]]:
    result = graph.query(
        """
        MATCH (m)-[e]->(target)
        WHERE target.id IN [$wish_id, $realization_id]
          AND type(e) IN ['PROGRESSES', 'FULFILLS', 'FAILED_ATTEMPT_FOR', 'CANCELS', 'REVISES']
        RETURN m.id, coalesce(m.timestamp, m.occurredAt, m.createdAt),
               type(e), coalesce(e.delta, 0.0), coalesce(e.relief, 0.0),
               coalesce(e.confidence, 1.0), target.id
        """,
        {
            "wish_id": expectation.wish_id,
            "realization_id": expectation.realization_id,
        },
    )
    moments = []
    for row in result.result_set or []:
        occurred_at = comparable_datetime(row[1])
        if occurred_at is None:
            continue
        moment_id = str(row[0] or "")
        if _moment_is_new(
            occurred_at,
            moment_id,
            metadata["lastProcessedMomentAt"],
            metadata["lastProcessedMomentId"],
        ):
            moments.append((occurred_at, moment_id, list(row)))
    moments.sort(key=lambda item: (item[0], item[1]))

    current = expectation
    for occurred_at, moment_id, row in moments:
        relation_type = str(row[2])
        if relation_type == "PROGRESSES":
            delta = max(0.0, _number(row[3]))
            relief = max(0.0, min(1.0, _number(row[4])))
            current = replace(
                current,
                progress=max(0.0, min(1.0, current.progress + delta)),
                subjective_age_seconds=current.subjective_age_seconds * (1.0 - relief),
                generation=current.generation + 1,
            )
            graph.query(
                "MATCH (o {id: $id}) SET o.progress = $progress",
                {"id": current.realization_id, "progress": current.progress},
            )
        elif relation_type == "FULFILLS":
            current = replace(
                current,
                progress=1.0,
                subjective_age_seconds=0.0,
                wish_status="satisfied",
                realization_status="satisfied",
                generation=current.generation + 1,
                alarm_armed=False,
            )
            graph.query(
                """
                MATCH (w {id: $wish_id}), (o {id: $realization_id})
                SET w.status = 'satisfied', o.status = 'satisfied', o.progress = 1.0
                """,
                {
                    "wish_id": current.wish_id,
                    "realization_id": current.realization_id,
                },
            )
        elif relation_type == "CANCELS":
            current = replace(
                current,
                wish_status="abandoned",
                generation=current.generation + 1,
                alarm_armed=False,
            )
            graph.query(
                "MATCH (w {id: $id}) SET w.status = 'abandoned'",
                {"id": current.wish_id},
            )
        elif relation_type == "REVISES":
            current = replace(
                current,
                generation=current.generation + 1,
                alarm_armed=True,
                refractory_until=None,
            )
        # FAILED_ATTEMPT_FOR intentionally preserves subjective age.

        metadata["lastProcessedMomentAt"] = occurred_at
        metadata["lastProcessedMomentId"] = moment_id
    return current, metadata


def _read_internal_state(graph, now: datetime) -> tuple[dict[str, float], str, dict[str, float], str]:
    result = graph.query(
        "MATCH (s {id: 'interoception-current'}) RETURN s.data, s.expiresAt LIMIT 1"
    )
    if not result.result_set:
        return {}, "not_measured", {}, "unknown"

    raw_data, expires_at = result.result_set[0]
    try:
        payload = json.loads(raw_data) if raw_data else {}
    except (TypeError, json.JSONDecodeError):
        return {}, "measurement_failed", {}, "measurement_failed"

    expiry = comparable_datetime(expires_at or payload.get("expiresAt"))
    current = comparable_datetime(now)
    if expiry and current and expiry < current:
        return {}, "not_measured", {}, "unknown"

    affects = {}
    for collection in (payload.get("emotions") or {}, payload.get("drives") or {}):
        for name, intensity in collection.items():
            affects[_normalize_key(name)] = max(
                affects.get(_normalize_key(name), 0.0),
                _number(intensity),
            )

    workspace = payload.get("workspaceSubentities") or payload.get("workspace_subentities") or {}
    subentities: dict[str, float] = {}
    if isinstance(workspace, Mapping):
        subentities = {_normalize_key(name): _number(share) for name, share in workspace.items()}
    elif isinstance(workspace, list):
        for item in workspace:
            if isinstance(item, Mapping):
                name = item.get("id") or item.get("name")
                subentities[_normalize_key(name)] = _number(
                    item.get("share"),
                    _number(item.get("workspaceShare"), 0.0),
                )
    controller = payload.get("workspaceController") or payload.get("workspace_controller")
    if not subentities and isinstance(controller, Mapping) and controller.get("id"):
        subentities[_normalize_key(controller["id"])] = 1.0

    return (
        affects,
        "observed",
        subentities,
        "observed" if subentities else "unknown",
    )


def _load_biases(
    graph,
    expectation: TemporalExpectation,
    affects: Mapping[str, float],
    subentities: Mapping[str, float],
) -> tuple[dict[str, TemporalBias], dict[str, TemporalBias]]:
    result = graph.query(
        """
        MATCH (source)-[b:TEMPORALLY_BIASES]->(target)
        WHERE target.id = $wish_id
           OR target.id = $category
           OR toLower(coalesce(target.name, '')) = toLower($category)
        RETURN source.id, source.name, source.semanticType, source.nodeType,
               coalesce(b.clockBias, 0.0), coalesce(b.thresholdBias, 0.0),
               coalesce(b.compatibility, 1.0)
        """,
        {"wish_id": expectation.wish_id, "category": expectation.category},
    )
    affect_biases: dict[str, TemporalBias] = {}
    subentity_biases: dict[str, TemporalBias] = {}
    for row in result.result_set or []:
        keys = {
            _normalize_key(row[0]),
            _normalize_key(row[1]),
        }
        bias = TemporalBias(
            clock_bias=_number(row[4]),
            threshold_bias=_number(row[5]),
            compatibility=_number(row[6], 1.0),
        )
        for key in keys:
            if key in affects:
                affect_biases[key] = bias
            if key in subentities:
                subentity_biases[key] = bias
    return affect_biases, subentity_biases


def _existing_alarm(graph, relation_key: str) -> Optional[dict[str, Any]]:
    result = graph.query(
        """
        MATCH (m:L1Node)
        WHERE m.nodeType = 'Moment'
          AND m.semanticType = 'Alarm'
          AND m.reason = $reason
          AND m.temporalRelationKey = $relation_key
          AND m.status = 'dormant'
        RETURN m.id, m.scheduledFor, m.relationGeneration
        ORDER BY m.createdAt DESC
        LIMIT 1
        """,
        {"reason": TEMPORAL_REASON, "relation_key": relation_key},
    )
    if not result.result_set:
        return None
    row = result.result_set[0]
    return {
        "id": str(row[0]),
        "scheduledFor": comparable_datetime(row[1]),
        "generation": _integer(row[2]),
    }


def _cancel_alarm(graph, alarm_id: Optional[str], now: datetime) -> None:
    if not alarm_id:
        return
    graph.query(
        """
        MATCH (m:L1Node {id: $id})
        WHERE m.status = 'dormant'
        SET m.status = 'cancelled', m.cancelledAt = $at
        """,
        {"id": alarm_id, "at": now.isoformat()},
    )


def _create_alarm(
    graph,
    expectation: TemporalExpectation,
    *,
    scheduled_for: datetime,
    pressure: float,
    generation: int,
    now: datetime,
) -> str:
    relation_key = _relation_key(expectation.wish_id, expectation.realization_id)
    alarm_id = _alarm_id(relation_key, generation)
    required_age = expectation.subjective_age_seconds
    if expectation.amplitude > expectation.effective_threshold:
        from runtime.cognition.temporal_desire import required_subjective_age

        required_age = required_subjective_age(
            expectation,
            expectation.effective_threshold,
        ) or required_age
    graph.query(
        """
        MERGE (m:L1Node {id: $id})
        SET m.nodeType = 'Moment',
            m.semanticType = 'Alarm',
            m.name = 'Alarme · désir temporel',
            m.prompt = $prompt,
            m.status = 'dormant',
            m.scheduledFor = $scheduled_for,
            m.repeat = 'once',
            m.place = '',
            m.reason = $reason,
            m.temporalRelationKey = $relation_key,
            m.sourceNarrativeId = $wish_id,
            m.realizationNarrativeId = $realization_id,
            m.relationGeneration = $generation,
            m.pressureThreshold = $threshold,
            m.heldClockRate = $clock_rate,
            m.subjectiveAgeAtFire = $subjective_age_at_fire,
            m.createdAt = $created_at
        """,
        {
            "id": alarm_id,
            "prompt": TEMPORAL_PROMPT,
            "scheduled_for": scheduled_for.isoformat(),
            "reason": TEMPORAL_REASON,
            "relation_key": relation_key,
            "wish_id": expectation.wish_id,
            "realization_id": expectation.realization_id,
            "generation": generation,
            "threshold": expectation.effective_threshold,
            "clock_rate": expectation.held_clock_rate,
            "subjective_age_at_fire": required_age,
            "created_at": now.isoformat(),
        },
    )
    return alarm_id


def _persist_relation(
    graph,
    expectation: TemporalExpectation,
    metadata: Mapping[str, Any],
    *,
    modifiers,
) -> None:
    graph.query(
        """
        MATCH (w {id: $wish_id})-[r:SEEKS_REALIZATION]->(o {id: $realization_id})
        SET r.subjectiveAgeSeconds = $subjective_age,
            r.lastIntegratedAt = $last_integrated_at,
            r.heldClockRate = $held_clock_rate,
            r.effectiveThreshold = $effective_threshold,
            r.generation = $generation,
            r.alarmMomentId = $alarm_moment_id,
            r.alarmArmed = $alarm_armed,
            r.refractoryUntil = $refractory_until,
            r.measurementStatus = $measurement_status,
            r.lastProcessedMomentAt = $last_processed_moment_at,
            r.lastProcessedMomentId = $last_processed_moment_id,
            r.affectMeasurementStatus = $affect_status,
            r.subentityMeasurementStatus = $subentity_status,
            r.affectClockFactor = $affect_factor,
            r.subentityClockFactor = $subentity_factor
        """,
        {
            "wish_id": expectation.wish_id,
            "realization_id": expectation.realization_id,
            "subjective_age": expectation.subjective_age_seconds,
            "last_integrated_at": _iso(expectation.last_integrated_at),
            "held_clock_rate": expectation.held_clock_rate,
            "effective_threshold": expectation.effective_threshold,
            "generation": expectation.generation,
            "alarm_moment_id": expectation.alarm_moment_id,
            "alarm_armed": expectation.alarm_armed,
            "refractory_until": _iso(expectation.refractory_until),
            "measurement_status": expectation.measurement_status,
            "last_processed_moment_at": _iso(metadata.get("lastProcessedMomentAt")),
            "last_processed_moment_id": metadata.get("lastProcessedMomentId") or None,
            "affect_status": modifiers.affect_status,
            "subentity_status": modifiers.subentity_status,
            "affect_factor": modifiers.affect_factor,
            "subentity_factor": modifiers.subentity_factor,
        },
    )


def _plan_one(
    graph,
    expectation: TemporalExpectation,
    metadata: dict[str, Any],
    *,
    now: datetime,
    affects: Mapping[str, float],
    affect_status: str,
    subentities: Mapping[str, float],
    subentity_status: str,
) -> tuple[TemporalExpectation, dict[str, Any]]:
    current = integrate_previous_interval(expectation, now)
    current, metadata = _apply_new_moments(graph, current, metadata)
    affect_biases, subentity_biases = _load_biases(
        graph,
        current,
        affects,
        subentities,
    )
    modifiers = resolve_modifiers(
        current,
        affects=affects,
        affect_biases=affect_biases,
        subentities=subentities,
        subentity_biases=subentity_biases,
        affect_status=affect_status,
        subentity_status=subentity_status,
        flexibility_adjustment=metadata["flexibilityAdjustment"],
    )
    current = replace(
        current,
        held_clock_rate=modifiers.clock_rate,
        effective_threshold=modifiers.effective_threshold,
    )
    pressure = calculate_pressure(current)
    if not current.alarm_armed and pressure <= current.release_threshold:
        current = replace(current, alarm_armed=True)

    plan = plan_next_alarm(current, modifiers, now)
    relation_key = _relation_key(current.wish_id, current.realization_id)
    existing = _existing_alarm(graph, relation_key)

    if plan.action != "schedule" or plan.scheduled_for is None:
        if existing:
            _cancel_alarm(graph, existing["id"], now)
            current = replace(
                current,
                generation=max(current.generation, existing["generation"]) + 1,
                alarm_moment_id=None,
            )
        else:
            current = replace(current, alarm_moment_id=None)
    else:
        same_schedule = False
        if existing and existing["scheduledFor"]:
            same_schedule = abs(
                (existing["scheduledFor"] - comparable_datetime(plan.scheduled_for)).total_seconds()
            ) <= RESCHEDULE_TOLERANCE_SECONDS
        if existing and same_schedule:
            current = replace(
                current,
                generation=existing["generation"],
                alarm_moment_id=existing["id"],
            )
        else:
            if existing:
                _cancel_alarm(graph, existing["id"], now)
            generation = max(
                current.generation,
                existing["generation"] if existing else current.generation,
            ) + 1
            alarm_id = _create_alarm(
                graph,
                current,
                scheduled_for=plan.scheduled_for,
                pressure=plan.pressure,
                generation=generation,
                now=now,
            )
            current = replace(
                current,
                generation=generation,
                alarm_moment_id=alarm_id,
            )

    _persist_relation(graph, current, metadata, modifiers=modifiers)
    return current, {
        "wishId": current.wish_id,
        "realizationId": current.realization_id,
        "measurementStatus": current.measurement_status,
        "pressure": round(calculate_pressure(current), 6),
        "threshold": round(current.effective_threshold, 6),
        "subjectiveAgeSeconds": round(current.subjective_age_seconds, 6),
        "heldClockRate": round(current.held_clock_rate, 6),
        "nextAlarmAt": _iso(plan.scheduled_for) if current.alarm_moment_id else None,
        "alarmMomentId": current.alarm_moment_id,
        "generation": current.generation,
        "affectModifiers": {"status": modifiers.affect_status},
        "subentityModifiers": {"status": modifiers.subentity_status},
    }


def _publish_frame(graph, handle: str, expectations: list[dict[str, Any]], now: datetime) -> dict[str, Any]:
    wakes = graph_alarms.list_wakes(handle)
    wake_load = summarize_wake_load(wakes, now=now)
    frame = {
        "id": FRAME_ID,
        "schemaVersion": FRAME_SCHEMA_VERSION,
        "nodeType": "interoception_snapshot",
        "semanticType": "temporal_desire",
        "citizen": handle,
        "observedAt": now.isoformat(),
        "measurementStatus": "observed",
        "activeExpectations": expectations,
        "wakeLoad": wake_load,
    }
    graph.query(
        """
        MERGE (s:RuntimeState {id: $id})
        SET s.nodeType = $node_type,
            s.semanticType = $semantic_type,
            s.citizen = $citizen,
            s.schemaVersion = $schema_version,
            s.observedAt = $observed_at,
            s.data = $data
        """,
        {
            "id": FRAME_ID,
            "node_type": frame["nodeType"],
            "semantic_type": frame["semanticType"],
            "citizen": handle,
            "schema_version": FRAME_SCHEMA_VERSION,
            "observed_at": now.isoformat(),
            "data": json.dumps(frame, ensure_ascii=False, separators=(",", ":")),
        },
    )
    return frame


def process_temporal_desires(handle: str, now: Optional[datetime] = None) -> dict[str, Any]:
    """Advance all temporal expectations and materialize their next alarms."""

    now = now or datetime.now()
    graph = graph_alarms.select_graph(handle)
    affects, affect_status, subentities, subentity_status = _read_internal_state(graph, now)
    frames = []
    for expectation, metadata in _load_expectations(graph):
        try:
            _, frame = _plan_one(
                graph,
                expectation,
                metadata,
                now=now,
                affects=affects,
                affect_status=affect_status,
                subentities=subentities,
                subentity_status=subentity_status,
            )
            frames.append(frame)
        except Exception as exc:
            logger.warning(
                "Temporal expectation %s -> %s failed for @%s: %s",
                expectation.wish_id,
                expectation.realization_id,
                handle,
                exc,
            )
    return _publish_frame(graph, handle, frames, now)


def is_temporal_desire_alarm(wake: Mapping[str, object]) -> bool:
    return (
        str(wake.get("semanticType") or "").lower() == "alarm"
        and wake.get("reason") == TEMPORAL_REASON
    )


def validate_due_alarm(
    handle: str,
    wake: Mapping[str, object],
    now: Optional[datetime] = None,
) -> tuple[bool, dict[str, Any]]:
    """Perform the minimal membrane validation before a temporal alarm speaks."""

    if not is_temporal_desire_alarm(wake):
        return True, {}
    now = now or datetime.now()
    graph = graph_alarms.select_graph(handle)
    wish_id = str(wake.get("sourceNarrativeId") or "")
    realization_id = str(wake.get("realizationNarrativeId") or "")
    result = graph.query(
        _RELATION_MATCH
        + "\n  AND w.id = $wish_id AND o.id = $realization_id\nRETURN "
        + _RELATION_FIELDS,
        {"wish_id": wish_id, "realization_id": realization_id},
    )
    if not result.result_set:
        return False, {"reason": "missing_relation"}
    expectation, _ = _expectation_from_row(list(result.result_set[0]))
    pressure = calculate_pressure(expectation)
    valid = (
        expectation.active
        and expectation.alarm_armed
        and expectation.generation == _integer(wake.get("relationGeneration"))
        and expectation.alarm_moment_id == wake.get("id")
        and pressure + PRESSURE_EPSILON >= expectation.effective_threshold
        and not (
            expectation.refractory_until
            and comparable_datetime(expectation.refractory_until) > comparable_datetime(now)
        )
    )
    return valid, {
        "channel": "interoception.temporal_desire",
        "wishNarrativeId": wish_id,
        "realizationNarrativeId": realization_id,
        "pressure": pressure,
        "threshold": expectation.effective_threshold,
        "subjectiveAgeSeconds": expectation.subjective_age_seconds,
        "measurementStatus": expectation.measurement_status,
    }


def mark_temporal_alarm_delivered(
    handle: str,
    wake: Mapping[str, object],
    now: Optional[datetime] = None,
) -> None:
    if not is_temporal_desire_alarm(wake):
        return
    now = now or datetime.now()
    refractory_seconds = max(
        0.0,
        _number(wake.get("refractorySeconds"), DEFAULT_REFRACTORY_SECONDS),
    )
    graph_alarms.select_graph(handle).query(
        """
        MATCH (w {id: $wish_id})-[r:SEEKS_REALIZATION]->(o {id: $realization_id})
        WHERE coalesce(r.generation, 0) = $generation
        SET r.alarmArmed = false,
            r.alarmMomentId = null,
            r.refractoryUntil = $refractory_until
        """,
        {
            "wish_id": wake.get("sourceNarrativeId"),
            "realization_id": wake.get("realizationNarrativeId"),
            "generation": _integer(wake.get("relationGeneration")),
            "refractory_until": (
                now + timedelta(seconds=refractory_seconds)
            ).isoformat(),
        },
    )


def read_temporal_desire_frame(handle: str) -> Optional[dict[str, Any]]:
    try:
        graph = graph_alarms.select_graph(handle)
        result = graph.query(
            "MATCH (s:RuntimeState {id: $id}) RETURN s.data LIMIT 1",
            {"id": FRAME_ID},
        )
        if not result.result_set:
            return None
        return json.loads(result.result_set[0][0])
    except Exception as exc:
        logger.debug("Temporal desire frame unavailable for @%s: %s", handle, exc)
        return None


def temporal_desire_awareness_text(handle: str) -> str:
    frame = read_temporal_desire_frame(handle)
    if not frame:
        return ""
    load = frame.get("wakeLoad") or {}
    level_text = {
        "quiet": "Mon horizon programmé est calme.",
        "loaded": "Mon horizon commence à se remplir.",
        "crowded": "Plusieurs engagements se rapprochent.",
        "saturated": "Mon futur programmé est très encombré.",
    }.get(load.get("level"), "Je ne peux pas mesurer ma charge temporelle.")
    lines = ["### Temporal horizon", level_text]
    if load.get("measurementStatus") == "observed":
        lines.append(
            f"Activations prévues : {int(load.get('nextHour', 0))} dans l’heure, "
            f"{int(load.get('next24Hours', 0))} dans les 24 heures, "
            f"{int(load.get('next7Days', 0))} sur sept jours."
        )
    expectations = frame.get("activeExpectations") or []
    salient = [
        item
        for item in expectations
        if item.get("measurementStatus") == "observed"
        and _number(item.get("pressure")) >= 0.75 * _number(item.get("threshold"), 1.0)
    ]
    if salient:
        lines.append(
            f"{len(salient)} désir(s) approchent de leur seuil temporel."
        )
    return "\n".join(lines)
