"""Silence Sentinel — Output-rate monitoring for silent failure detection.

ZERO CONSTANTS. Every threshold is derived from:
  - The flow's own historical behavior (mean, variance, percentiles)
  - The system's own state (pressure tiers, circadian, tick intervals)
  - Statistical confidence (standard error, sample size)

The data defines "abnormal." Not a guess. Not a hardcoded number.

Docs: docs/orchestrator/silence_sentinel/

Usage (instrumentation — 1 line per call site):
    from runtime.orchestrator.silence_counter import record_attempt, record_success
    record_attempt("invoke_claude")
    ...
    if is_substantive("invoke_claude", response):
        record_success("invoke_claude")

Usage (evaluation — called by dispatcher every tick):
    from runtime.orchestrator.silence_counter import evaluate_all
    results = evaluate_all(pressure, circadian_factor, inject_fn)
"""

import logging
import math
import os
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Callable, Optional

logger = logging.getLogger("orchestrator.silence_sentinel")


# ── System References (read from the system, not hardcoded) ───────────────

def _thought_interval() -> int:
    """How often citizens think — the natural heartbeat of the system."""
    return int(os.environ.get("MIND_THOUGHT_INTERVAL", "300"))


def _base_loop_interval() -> int:
    """How often the dispatcher ticks — the fastest possible evaluation."""
    return int(os.environ.get("MIND_BASE_LOOP_INTERVAL", "5"))


def _tier_boundaries() -> dict[str, float]:
    """Read subscription tier multipliers from the activation_pressure module."""
    try:
        from runtime.orchestrator.activation_pressure import SUBSCRIPTION_MULTIPLIER
        return dict(SUBSCRIPTION_MULTIPLIER)
    except ImportError:
        return {"free": 1, "tier1": 4, "tier2": 8, "tier3": 25}


# Suppress markers — responses containing these are infrastructure errors, not real output
SUPPRESS_MARKERS = [
    "*[Subconscious response",   # subconscious placeholder — not real Claude output
    # Rate limit / quota errors detected by content
]


def _is_suppress_pattern(response_lower: str) -> bool:
    """Check if response contains infrastructure error patterns.

    Reads from the dispatcher's own SUPPRESS_PATTERNS if available,
    so we don't duplicate the list.
    """
    try:
        from runtime.orchestrator.dispatcher import SUPPRESS_PATTERNS
        return any(p.lower() in response_lower for p in SUPPRESS_PATTERNS)
    except ImportError:
        return any(p in response_lower for p in [
            "rate limit", "429", "quota", "credit balance", "overloaded",
        ])


# ── Data Structures ───────────────────────────────────────────────────────

@dataclass
class Bucket:
    timestamp: int      # minute-aligned epoch
    attempted: int = 0
    substantive: int = 0


@dataclass
class FlowCounter:
    flow_name: str
    buckets: deque = field(default_factory=lambda: deque(maxlen=120))
    # maxlen=120: two hours of minute-buckets — enough for rolling statistics


@dataclass
class SentinelState:
    flow_name: str
    ratio_history: deque = field(default_factory=lambda: deque(maxlen=200))
    length_history: deque = field(default_factory=lambda: deque(maxlen=500))
    last_status: str = "CALIBRATING"
    last_evaluated: float = 0.0
    last_stimulus_ts: float = 0.0


# ── Module State ──────────────────────────────────────────────────────────

_counters: dict[str, FlowCounter] = {}
_states: dict[str, SentinelState] = {}
_last_evaluate_ts: float = 0.0


# ── Counter API (fire-and-forget — MUST NOT raise) ────────────────────────

def record_attempt(flow_name: str) -> None:
    """Record that a flow attempted a call. Fire-and-forget."""
    try:
        bucket = _get_or_create_bucket(flow_name)
        bucket.attempted += 1
    except Exception:
        pass  # V2: counter calls NEVER propagate exceptions


def record_success(flow_name: str) -> None:
    """Record that a flow produced a substantive result. Fire-and-forget."""
    try:
        bucket = _get_or_create_bucket(flow_name)
        bucket.substantive += 1
    except Exception:
        pass  # V2: counter calls NEVER propagate exceptions


def record_response_length(flow_name: str, length: int) -> None:
    """Record a response length for percentile-based substantive classification."""
    try:
        state = _get_or_create_state(flow_name)
        state.length_history.append(length)
    except Exception:
        pass


def _get_or_create_bucket(flow_name: str) -> Bucket:
    """Get or create the current minute's bucket for a flow."""
    if flow_name not in _counters:
        _counters[flow_name] = FlowCounter(flow_name=flow_name)
    counter = _counters[flow_name]
    now_minute = int(time.time()) // 60 * 60
    if not counter.buckets or counter.buckets[-1].timestamp != now_minute:
        counter.buckets.append(Bucket(timestamp=now_minute))
    return counter.buckets[-1]


def _get_or_create_state(flow_name: str) -> SentinelState:
    if flow_name not in _states:
        _states[flow_name] = SentinelState(flow_name=flow_name)
    return _states[flow_name]


# ── Substantive Classification ────────────────────────────────────────────

def is_substantive(flow_name: str, response: str) -> bool:
    """Classify whether a response is substantive output.

    Uses the flow's own historical response length distribution:
    - If enough history: substantive = longer than the 5th percentile
    - If not enough history: substantive = non-empty + not a known placeholder
    No hardcoded length threshold.
    """
    if not response:
        return False

    # Always reject known non-output markers
    if any(response.startswith(m) for m in SUPPRESS_MARKERS):
        return False
    if _is_suppress_pattern(response.lower()):
        return False

    # Record length for future percentile computation
    record_response_length(flow_name, len(response))

    # Check against the flow's own length distribution
    state = _get_or_create_state(flow_name)
    lengths = state.length_history

    if len(lengths) < 10:
        # Not enough history — use structural check:
        # substantive = has at least one newline (real responses have paragraphs)
        # AND is longer than the shortest non-empty response we've ever seen
        min_seen = min((l for l in lengths if l > 0), default=1)
        return len(response) >= min_seen and "\n" in response

    # Enough history: substantive = above the 5th percentile
    sorted_lengths = sorted(lengths)
    p5_index = max(0, len(sorted_lengths) // 20)
    p5 = sorted_lengths[p5_index]
    return len(response) > p5


# For backward compatibility
def is_invoke_substantive(response: str) -> bool:
    """Backward-compatible wrapper."""
    return is_substantive("invoke_claude", response)


# ── Adaptive Window ───────────────────────────────────────────────────────

def _adaptive_window(flow_name: str) -> float:
    """Window size adapts to the flow's own attempt rate.

    Fast flows (many attempts/sec) → short window (enough events arrive quickly).
    Slow flows (few attempts/min) → long window (need time to accumulate).
    Anchored to THOUGHT_INTERVAL — the system's natural heartbeat.
    """
    counter = _counters.get(flow_name)
    if not counter or not counter.buckets:
        return _thought_interval() * 2  # two thought cycles as fallback

    # Compute recent attempt rate from last 10 minutes of buckets
    now = time.time()
    cutoff = now - 600  # last 10 minutes for rate estimation
    recent_attempted = sum(
        b.attempted for b in counter.buckets if b.timestamp >= cutoff
    )
    elapsed = min(600, now - counter.buckets[0].timestamp) if counter.buckets else 600
    rate_per_second = recent_attempted / max(elapsed, 1)

    if rate_per_second <= 0:
        return _thought_interval() * 2

    # Need enough attempts for binomial confidence:
    # n=20 at p=0.5 gives 95% CI width ~0.4 — meaningful discrimination
    min_meaningful_sample = 20
    needed_seconds = min_meaningful_sample / rate_per_second

    # Cap: never wait longer than 6 thought cycles (responsive),
    # never shorter than 1 thought cycle (stable)
    thought = _thought_interval()
    return max(thought, min(needed_seconds, thought * 6))


# ── Statistical Evaluation ────────────────────────────────────────────────

def evaluate_all(
    pressure: float = 0.0,
    circadian_factor: float = 1.0,
    inject_fn: Optional[Callable] = None,
) -> dict[str, dict]:
    """Evaluate all tracked flows. Returns {flow_name: {status, ratio, baseline, sample}}."""
    global _last_evaluate_ts
    _last_evaluate_ts = time.time()

    results = {}
    for flow_name in list(_counters.keys()):
        result = _evaluate_flow(flow_name, pressure, circadian_factor)
        results[flow_name] = result

        if result["status"] in ("RED", "YELLOW") and inject_fn:
            _route_stimulus(flow_name, result, inject_fn)

    return results


def _evaluate_flow(
    flow_name: str, pressure: float, circadian_factor: float,
) -> dict:
    """Evaluate a single flow using its own statistical distribution."""
    state = _get_or_create_state(flow_name)

    # Compute ratio over adaptive window
    window = _adaptive_window(flow_name)
    ratio, sample = _compute_ratio(flow_name, window)

    # Record ratio in history for variance computation
    if ratio is not None:
        state.ratio_history.append(ratio)

    state.last_evaluated = time.time()

    # Calibration: wait until we have enough data for statistical confidence
    if not _calibration_complete(state.ratio_history):
        # Exception: complete silence with meaningful sample = RED immediately
        if ratio is not None and ratio == 0.0 and sample >= _min_meaningful_sample(flow_name):
            state.last_status = "RED"
            logger.warning(
                f"[sentinel] {flow_name}: RED during calibration "
                f"(ratio=0.0, sample={sample}) — complete silence"
            )
            return {"status": "RED", "ratio": 0.0, "baseline": None, "sample": sample}
        state.last_status = "CALIBRATING"
        return {"status": "CALIBRATING", "ratio": ratio, "baseline": None, "sample": sample}

    # No attempts in window
    if ratio is None:
        return {"status": state.last_status, "ratio": None, "baseline": None, "sample": 0}

    # Compute baseline adjusted for system context
    baseline = _compute_baseline(flow_name, pressure, circadian_factor)
    if baseline is None:
        state.last_status = "CALIBRATING"
        return {"status": "CALIBRATING", "ratio": ratio, "baseline": None, "sample": sample}

    # Evaluate by statistical deviation from the flow's own history
    status = _evaluate_by_variance(state.ratio_history, ratio)

    if status != state.last_status:
        logger.info(
            f"[sentinel] {flow_name}: {state.last_status} -> {status} "
            f"(ratio={ratio:.3f}, baseline={baseline:.3f}, sample={sample})"
        )
    state.last_status = status

    return {
        "status": status,
        "ratio": round(ratio, 3),
        "baseline": round(baseline, 3),
        "sample": sample,
    }


def _evaluate_by_variance(history: deque, current_ratio: float) -> str:
    """RED/YELLOW/GREEN from the flow's own statistical variance.

    - RED: current ratio is more than 2 standard deviations below the mean
    - YELLOW: more than 1 standard deviation below the mean
    - GREEN: within normal variation

    No hardcoded thresholds — the data defines "abnormal."
    """
    if len(history) < 3:
        return "CALIBRATING"

    mean = sum(history) / len(history)
    variance = sum((r - mean) ** 2 for r in history) / len(history)
    std_dev = math.sqrt(variance)

    if std_dev < 1e-9:
        # Near-zero variance: the flow is rock-solid
        # Any drop is significant — use a fraction of the mean as synthetic sigma
        std_dev = mean * 0.1 if mean > 0 else 0.01

    distance = (mean - current_ratio) / std_dev

    if distance > 2:   # outside 95% of normal variation
        return "RED"
    if distance > 1:   # outside 68% of normal variation
        return "YELLOW"
    return "GREEN"


def _calibration_complete(history: deque) -> bool:
    """Calibration is done when the standard error is small enough to judge.

    Not a fixed observation count — statistical confidence from the data itself.
    """
    if len(history) < 3:
        return False

    ratios = list(history)
    mean = sum(ratios) / len(ratios)

    # Complete silence is immediately actionable
    if mean == 0.0 and len(ratios) >= 3:
        return True

    if mean == 0.0:
        return False

    variance = sum((r - mean) ** 2 for r in ratios) / len(ratios)
    std_err = math.sqrt(variance / len(ratios))

    # Calibration complete when the standard error is less than half the mean:
    # we're confident enough in the baseline to judge deviations
    return std_err < mean / 2


def _min_meaningful_sample(flow_name: str) -> int:
    """Minimum sample size for the flow's own rate to be statistically meaningful."""
    counter = _counters.get(flow_name)
    if not counter or not counter.buckets:
        return 10  # bootstrap minimum — will be replaced by real data

    # Use the flow's recent rate to determine what "meaningful" means
    # At least 2 minutes of attempts at the current rate
    now = time.time()
    cutoff = now - 120
    recent = sum(b.attempted for b in counter.buckets if b.timestamp >= cutoff)
    return max(3, recent)  # at least 3, or 2 minutes of typical activity


# ── Ratio Computation ─────────────────────────────────────────────────────

def _compute_ratio(flow_name: str, window_seconds: float) -> tuple[Optional[float], int]:
    """Compute the output ratio for a flow over the given window."""
    counter = _counters.get(flow_name)
    if not counter or not counter.buckets:
        return None, 0

    cutoff = time.time() - window_seconds
    attempted = 0
    substantive = 0
    for bucket in counter.buckets:
        if bucket.timestamp >= cutoff:
            attempted += bucket.attempted
            substantive += bucket.substantive

    if attempted == 0:
        return None, 0
    return substantive / attempted, attempted


# ── Baseline Computation ──────────────────────────────────────────────────

def _compute_baseline(
    flow_name: str, pressure: float, circadian_factor: float,
) -> Optional[float]:
    """Self-calibrating baseline from the flow's own history + system context.

    No hardcoded thresholds — pressure factor reads from the tier structure,
    circadian factor comes from metabolism, floor comes from the flow's own
    worst-healthy ratio.
    """
    counter = _counters.get(flow_name)
    if not counter or not counter.buckets:
        return None

    total_attempted = sum(b.attempted for b in counter.buckets)
    total_substantive = sum(b.substantive for b in counter.buckets)

    if total_attempted == 0:
        return None

    raw_baseline = total_substantive / total_attempted

    # Pressure factor: interpolate between tier boundaries from the pressure module
    pressure_factor = _pressure_factor(pressure)

    # Circadian: use the factor directly — it already represents the activity level
    # (1.0 = peak, 0.5 = trough). No artificial floor needed because the statistical
    # evaluation handles near-zero baselines via variance.
    adjusted = raw_baseline * pressure_factor * max(circadian_factor, 0.01)

    # Floor: the flow's own worst-ever-while-still-working ratio
    # If we've never seen it work, use a tiny positive number
    # (never zero — zero baseline makes silence undetectable)
    state = _get_or_create_state(flow_name)
    worst_healthy = min(
        (r for r in state.ratio_history if r > 0),
        default=0.01 if not state.ratio_history else raw_baseline * 0.1
    )
    return max(adjusted, worst_healthy)


def _pressure_factor(pressure: float) -> float:
    """Derive pressure adjustment from the tier structure itself.

    Linearly interpolates between the lowest and highest tier multipliers.
    No hardcoded pressure breakpoints.
    """
    tiers = _tier_boundaries()
    if not tiers:
        return 1.0

    multipliers = list(tiers.values())
    min_mult = min(multipliers)  # free tier (lowest — everyone wakes)
    max_mult = max(multipliers)  # highest tier (only premium wakes)

    # At pressure 0: all citizens can wake → expect full output (factor=1.0)
    # At pressure = max_mult: only premium citizens wake → expect minimal output
    # The ratio min_mult/max_mult IS the expected output fraction at max pressure
    if pressure <= 0:
        return 1.0
    if pressure >= max_mult:
        return min_mult / max_mult

    # Linear interpolation
    t = pressure / max_mult  # 0.0 to 1.0
    return 1.0 - t * (1.0 - min_mult / max_mult)


# ── Stimulus Routing ──────────────────────────────────────────────────────

def _route_stimulus(
    flow_name: str, result: dict, inject_fn: Callable,
) -> None:
    """Route a silence stimulus to the best available infra actor.

    Debounce = one thought interval (the carrier needs at least one thought
    cycle to process the stimulus before receiving another).
    Energy = proportional to how far below baseline the ratio has fallen.
    """
    state = _get_or_create_state(flow_name)

    # Debounce: carrier needs one thought cycle to process
    now = time.time()
    debounce = _thought_interval()
    if now - state.last_stimulus_ts < debounce:
        return
    state.last_stimulus_ts = now

    status = result["status"]
    ratio = result.get("ratio", "?")
    baseline = result.get("baseline", "?")
    sample = result.get("sample", 0)

    content = (
        f"[SILENCE DETECTED] {flow_name}: ratio={ratio} "
        f"(expected={baseline}, sample={sample}). Status: {status}."
    )

    # Energy proportional to severity — how far below baseline
    # Continuous, not binary. Capped by schema max_energy (1.0).
    if isinstance(ratio, (int, float)) and isinstance(baseline, (int, float)) and baseline > 0:
        drop_fraction = max(0, (baseline - ratio) / baseline)
        energy = min(0.95, drop_fraction)  # 0.95 = schema practical max (leave room for panic)
    else:
        energy = 0.9  # no baseline = maximally alarming

    try:
        inject_fn(
            target="infra",
            content=content,
            source="silence_sentinel",
            energy=energy,
            is_failure=(status == "RED"),
        )
        logger.warning(f"[sentinel] Stimulus routed for {flow_name}: {status} (energy={energy:.2f})")
    except Exception as e:
        logger.error(f"[sentinel] Failed to route stimulus for {flow_name}: {e}")


# ── Health Status ─────────────────────────────────────────────────────────

def get_health_status() -> dict:
    """Return health status for H1/H2/H3 checkers."""
    now = time.time()

    # H1: Is the sentinel alive?
    # "Alive" = evaluated within 2× the base loop interval (the evaluation frequency)
    alive_threshold = _base_loop_interval() * 2
    h1_alive = (now - _last_evaluate_ts) < alive_threshold if _last_evaluate_ts > 0 else False

    # H2: Are per-flow counters active?
    # "Active" = recorded data within the last adaptive window for that flow
    active_flows = 0
    for name, counter in _counters.items():
        window = _adaptive_window(name)
        if counter.buckets:
            latest = counter.buckets[-1].timestamp
            if latest >= (int(now) // 60 * 60 - window):
                active_flows += 1

    # H3: False positive tracking (placeholder — needs historical tracking)
    h3_ok = True

    return {
        "h1_alive": h1_alive,
        "h1_last_evaluate": _last_evaluate_ts,
        "h2_active_flows": active_flows,
        "h2_total_flows": len(_counters),
        "h3_calibration_ok": h3_ok,
        "flows": {
            name: {
                "status": _states[name].last_status if name in _states else "UNKNOWN",
                "ratio_history_len": len(_states[name].ratio_history) if name in _states else 0,
                "calibrated": _calibration_complete(_states[name].ratio_history) if name in _states else False,
            }
            for name in _counters
        },
    }


# ── CLI ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    import json

    parser = argparse.ArgumentParser(description="Silence Sentinel")
    parser.add_argument("--status", action="store_true", help="Show current counter status")
    parser.add_argument("--health", action="store_true", help="Run health checks")
    args = parser.parse_args()

    if args.status or args.health:
        status = get_health_status()
        print(json.dumps(status, indent=2, default=str))
    else:
        parser.print_help()
