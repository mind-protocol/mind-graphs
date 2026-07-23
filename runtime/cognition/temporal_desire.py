"""Pure physics for temporal desire and future wake-load perception.

The graph adapter lives in ``runtime.orchestrator.graph_temporal_desires``.
This module has no database, scheduler, or LLM dependency: it closes the
previous temporal interval, resolves explicit modifiers, computes pressure,
and predicts the next threshold crossing.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from typing import Iterable, Mapping, Optional


MIN_CLOCK_RATE = 0.25
MAX_CLOCK_RATE = 4.0
MIN_THRESHOLD = 0.10
MAX_THRESHOLD = 0.95
DEFAULT_RELEASE_THRESHOLD = 0.40
DEFAULT_REFRACTORY_SECONDS = 3600.0


def clamp(low: float, high: float, value: float) -> float:
    return max(low, min(high, value))


def parse_datetime(value: object) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def comparable_datetime(value: object) -> Optional[datetime]:
    parsed = parse_datetime(value)
    if parsed is None:
        return None
    return parsed.replace(tzinfo=None) if parsed.tzinfo else parsed


@dataclass(frozen=True)
class TemporalBias:
    """An explicit policy linking an affect/subentity to an expectation."""

    clock_bias: float = 0.0
    threshold_bias: float = 0.0
    compatibility: float = 1.0


@dataclass(frozen=True)
class TemporalModifiers:
    clock_rate: float
    effective_threshold: float
    affect_factor: float = 1.0
    subentity_factor: float = 1.0
    affect_threshold_shift: float = 0.0
    subentity_threshold_shift: float = 0.0
    affect_status: str = "not_measured"
    subentity_status: str = "unknown"


@dataclass(frozen=True)
class TemporalExpectation:
    wish_id: str
    realization_id: str
    wish_weight: float = 0.0
    commitment: float = 0.0
    progress: float = 0.0
    category: str = ""
    base_clock_rate: float = 1.0
    patience_tau_seconds: float = 43200.0
    base_threshold: float = 0.65
    release_threshold: float = DEFAULT_RELEASE_THRESHOLD
    subjective_age_seconds: float = 0.0
    last_integrated_at: Optional[datetime] = None
    held_clock_rate: float = 1.0
    effective_threshold: float = 0.65
    generation: int = 0
    alarm_moment_id: Optional[str] = None
    alarm_armed: bool = True
    refractory_until: Optional[datetime] = None
    measurement_status: str = "observed"
    wish_status: str = "active"
    realization_status: str = "active"

    @property
    def realization_gap(self) -> float:
        return clamp(0.0, 1.0, 1.0 - self.progress)

    @property
    def amplitude(self) -> float:
        return (
            clamp(0.0, 1.0, self.wish_weight)
            * clamp(0.0, 1.0, self.commitment)
            * self.realization_gap
        )

    @property
    def active(self) -> bool:
        return (
            self.wish_status == "active"
            and self.realization_status not in {"satisfied", "cancelled", "abandoned", "complete"}
            and self.progress < 1.0
        )


@dataclass(frozen=True)
class TemporalPlan:
    action: str
    pressure: float
    threshold: float
    scheduled_for: Optional[datetime] = None
    reason: str = ""


def integrate_previous_interval(
    expectation: TemporalExpectation,
    now: datetime,
) -> TemporalExpectation:
    """Close the elapsed interval with the clock rate held before this tick."""

    if expectation.last_integrated_at is None:
        return replace(expectation, measurement_status="unknown")

    last = comparable_datetime(expectation.last_integrated_at)
    current = comparable_datetime(now)
    if last is None or current is None:
        return replace(expectation, measurement_status="measurement_failed")

    objective_delta = max(0.0, (current - last).total_seconds())
    subjective_delta = objective_delta * clamp(
        MIN_CLOCK_RATE,
        MAX_CLOCK_RATE,
        expectation.held_clock_rate,
    )
    return replace(
        expectation,
        subjective_age_seconds=max(
            0.0,
            expectation.subjective_age_seconds + subjective_delta,
        ),
        last_integrated_at=now,
    )


def resolve_modifiers(
    expectation: TemporalExpectation,
    *,
    affects: Optional[Mapping[str, float]] = None,
    affect_biases: Optional[Mapping[str, TemporalBias]] = None,
    subentities: Optional[Mapping[str, float]] = None,
    subentity_biases: Optional[Mapping[str, TemporalBias]] = None,
    affect_status: str = "not_measured",
    subentity_status: str = "unknown",
    flexibility_adjustment: float = 0.0,
) -> TemporalModifiers:
    """Resolve only explicit policies; unknown state remains epistemically unknown."""

    affect_exponent = 0.0
    affect_threshold_shift = 0.0
    for name, intensity in (affects or {}).items():
        bias = (affect_biases or {}).get(name)
        if bias is None:
            continue
        contribution = clamp(0.0, 1.0, float(intensity)) * bias.compatibility
        affect_exponent += contribution * bias.clock_bias
        affect_threshold_shift += contribution * bias.threshold_bias

    shares = {
        name: max(0.0, float(share))
        for name, share in (subentities or {}).items()
    }
    share_total = sum(shares.values())
    if share_total > 0:
        shares = {name: value / share_total for name, value in shares.items()}

    subentity_exponent = 0.0
    subentity_threshold_shift = 0.0
    for name, share in shares.items():
        bias = (subentity_biases or {}).get(name)
        if bias is None:
            continue
        contribution = share * bias.compatibility
        subentity_exponent += contribution * bias.clock_bias
        subentity_threshold_shift += contribution * bias.threshold_bias

    affect_factor = math.exp(affect_exponent)
    subentity_factor = math.exp(subentity_exponent)
    clock_rate = clamp(
        MIN_CLOCK_RATE,
        MAX_CLOCK_RATE,
        expectation.base_clock_rate * affect_factor * subentity_factor,
    )
    threshold = clamp(
        MIN_THRESHOLD,
        MAX_THRESHOLD,
        expectation.base_threshold
        + affect_threshold_shift
        + subentity_threshold_shift
        + flexibility_adjustment,
    )
    return TemporalModifiers(
        clock_rate=clock_rate,
        effective_threshold=threshold,
        affect_factor=affect_factor,
        subentity_factor=subentity_factor,
        affect_threshold_shift=affect_threshold_shift,
        subentity_threshold_shift=subentity_threshold_shift,
        affect_status=affect_status,
        subentity_status=subentity_status,
    )


def calculate_pressure(expectation: TemporalExpectation) -> float:
    if expectation.patience_tau_seconds <= 0:
        return expectation.amplitude
    age = max(0.0, expectation.subjective_age_seconds)
    return expectation.amplitude * (
        1.0 - math.exp(-age / expectation.patience_tau_seconds)
    )


def required_subjective_age(expectation: TemporalExpectation, threshold: float) -> Optional[float]:
    amplitude = expectation.amplitude
    if amplitude <= threshold or amplitude <= 0:
        return None
    return -expectation.patience_tau_seconds * math.log(1.0 - threshold / amplitude)


def plan_next_alarm(
    expectation: TemporalExpectation,
    modifiers: TemporalModifiers,
    now: datetime,
) -> TemporalPlan:
    """Predict an alarm without directly creating a stimulus or action."""

    configured = replace(
        expectation,
        held_clock_rate=modifiers.clock_rate,
        effective_threshold=modifiers.effective_threshold,
    )
    pressure = calculate_pressure(configured)

    if configured.measurement_status != "observed":
        return TemporalPlan("none", pressure, modifiers.effective_threshold, reason="unknown_baseline")
    if not configured.active:
        return TemporalPlan("none", pressure, modifiers.effective_threshold, reason="inactive")

    refractory_until = comparable_datetime(configured.refractory_until)
    current = comparable_datetime(now)
    if refractory_until and current and refractory_until > current:
        return TemporalPlan("none", pressure, modifiers.effective_threshold, reason="refractory")

    if not configured.alarm_armed:
        if pressure <= configured.release_threshold:
            configured = replace(configured, alarm_armed=True)
        else:
            return TemporalPlan("none", pressure, modifiers.effective_threshold, reason="hysteresis")

    if pressure >= modifiers.effective_threshold:
        return TemporalPlan(
            "schedule",
            pressure,
            modifiers.effective_threshold,
            scheduled_for=now,
            reason="threshold_crossed",
        )

    required_age = required_subjective_age(configured, modifiers.effective_threshold)
    if required_age is None:
        return TemporalPlan(
            "none",
            pressure,
            modifiers.effective_threshold,
            reason="unreachable_threshold",
        )

    remaining_subjective = max(
        0.0,
        required_age - configured.subjective_age_seconds,
    )
    remaining_objective = remaining_subjective / modifiers.clock_rate
    return TemporalPlan(
        "schedule",
        pressure,
        modifiers.effective_threshold,
        scheduled_for=now + timedelta(seconds=remaining_objective),
        reason="future_crossing",
    )


def apply_progress(
    expectation: TemporalExpectation,
    *,
    delta: float,
    relief: float = 0.0,
) -> TemporalExpectation:
    return replace(
        expectation,
        progress=clamp(0.0, 1.0, expectation.progress + max(0.0, delta)),
        subjective_age_seconds=expectation.subjective_age_seconds
        * (1.0 - clamp(0.0, 1.0, relief)),
        generation=expectation.generation + 1,
    )


def expand_wake_occurrences(
    wakes: Iterable[Mapping[str, object]],
    *,
    now: datetime,
    horizon: timedelta = timedelta(days=7),
) -> list[datetime]:
    """Expand each stored next occurrence over a bounded perception horizon."""

    current = comparable_datetime(now)
    if current is None:
        return []
    end = current + horizon
    steps = {
        "hourly": timedelta(hours=1),
        "daily": timedelta(days=1),
        "weekly": timedelta(weeks=1),
    }
    occurrences: list[datetime] = []
    for wake in wakes:
        scheduled = comparable_datetime(wake.get("scheduledFor"))
        if scheduled is None or scheduled < current:
            continue
        repeat = str(wake.get("repeat") or "once")
        while scheduled <= end:
            occurrences.append(scheduled)
            step = steps.get(repeat)
            if step is None:
                break
            scheduled += step
    return sorted(occurrences)


def summarize_wake_load(
    wakes: Iterable[Mapping[str, object]],
    *,
    now: datetime,
) -> dict[str, object]:
    """Describe scheduled activation density, never inferred task workload."""

    current = comparable_datetime(now)
    if current is None:
        return {
            "measurementStatus": "measurement_failed",
            "scheduledAlarmCount": 0,
            "nextHour": 0,
            "next24Hours": 0,
            "next7Days": 0,
            "level": "unknown",
        }

    wakes_list = list(wakes)
    occurrences = expand_wake_occurrences(wakes_list, now=current)
    one_hour = current + timedelta(hours=1)
    one_day = current + timedelta(days=1)
    next_hour = sum(at <= one_hour for at in occurrences)
    next_day = sum(at <= one_day for at in occurrences)
    next_week = len(occurrences)
    density = next_hour + 0.25 * (next_day - next_hour) + 0.05 * (next_week - next_day)
    if density < 1.0:
        level = "quiet"
    elif density < 3.0:
        level = "loaded"
    elif density < 6.0:
        level = "crowded"
    else:
        level = "saturated"
    return {
        "measurementStatus": "observed",
        "scheduledAlarmCount": len(wakes_list),
        "nextHour": next_hour,
        "next24Hours": next_day,
        "next7Days": next_week,
        "densityScore": round(density, 6),
        "level": level,
        "meaning": "scheduled_activation_density_not_task_workload",
    }
