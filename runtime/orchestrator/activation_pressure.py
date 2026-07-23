"""Activation pressure — single adaptive knob for compute allocation.

Simplifies: degradation.py (4-level system → pressure-based)

One global variable: `pressure`. It goes up on rate limits, down on
successful calls. Subscription tier multiplies the effective threshold
per citizen. That's it.

The physics tick (L1/L3) is free — no LLM. Only conscious waking
(LLM session) costs compute. Pressure controls who wakes.

  429 received     → pressure *= PRESSURE_INCREASE (e.g. 1.25)
  successful call  → pressure *= PRESSURE_DECREASE (e.g. 0.98)
  citizen wakes if → citizen_energy > pressure / subscription_multiplier

Higher pressure = fewer citizens wake = system slows naturally.
Lower pressure = more citizens wake = system runs at full speed.
Subscriber's divisor means their citizen wakes even under high pressure.

Co-Authored-By: Tomaso Nervo (@nervo) <nervo@mindprotocol.ai>
"""

import logging
import time
import threading

logger = logging.getLogger("orchestrator.pressure")

# ── Constants ────────────────────────────────────────────────────────────────

# When a 429/rate-limit is detected, pressure increases by this factor
PRESSURE_INCREASE = 1.25

# Each successful call reduces pressure by this factor
PRESSURE_DECREASE = 0.98

# Pressure bounds
PRESSURE_MIN = 0.1   # system at full speed
PRESSURE_MAX = 50.0  # system nearly stopped

# Initial pressure — start optimistic
PRESSURE_INITIAL = 0.5

# Subscription multipliers — divide the pressure for paying users
SUBSCRIPTION_MULTIPLIER = {
    "free": 1,
    "tier1": 4,
    "tier2": 8,
    "tier3": 25,
}

# Backoff after rate limit — seconds to wait before trying again
BACKOFF_BASE_S = 10.0
BACKOFF_MAX_S = 120.0

# ── State ────────────────────────────────────────────────────────────────────

_lock = threading.Lock()

_state = {
    "pressure": PRESSURE_INITIAL,
    "consecutive_429s": 0,
    "total_calls": 0,
    "total_429s": 0,
    "last_429_at": 0.0,
    "backoff_until": 0.0,
}


# ── Core API ─────────────────────────────────────────────────────────────────

def on_rate_limit():
    """Called when a 429 or rate limit error is detected.

    Increases pressure → fewer citizens can wake → system self-regulates.
    Also updates the L3 sense node so citizens perceive the change.
    """
    old_status = health_check()["status"]

    with _lock:
        _state["pressure"] = min(
            PRESSURE_MAX,
            _state["pressure"] * PRESSURE_INCREASE,
        )
        _state["consecutive_429s"] += 1
        _state["total_429s"] += 1
        _state["last_429_at"] = time.time()

        # Exponential backoff
        backoff = min(
            BACKOFF_MAX_S,
            BACKOFF_BASE_S * (2 ** min(_state["consecutive_429s"] - 1, 6)),
        )
        _state["backoff_until"] = time.time() + backoff

    logger.warning(
        f"Rate limit hit — pressure={_state['pressure']:.2f}, "
        f"backoff={backoff:.0f}s, consecutive={_state['consecutive_429s']}"
    )

    # Update L3 sense node if status changed
    new_status = health_check()["status"]
    if new_status != old_status:
        _update_l3_sense()


def on_success():
    """Called after a successful LLM call.

    Slowly reduces pressure → more citizens can wake.
    Also updates the L3 sense node if status recovers.
    """
    old_status = health_check()["status"]

    with _lock:
        _state["pressure"] = max(
            PRESSURE_MIN,
            _state["pressure"] * PRESSURE_DECREASE,
        )
        _state["consecutive_429s"] = 0
        _state["total_calls"] += 1

    new_status = health_check()["status"]
    if new_status != old_status:
        _update_l3_sense()


def should_wake(citizen_energy: float, subscription: str = "free") -> bool:
    """Should this citizen wake up (get an LLM session)?

    citizen_energy: the citizen's current WM energy (from tick runner)
    subscription: the human partner's subscription tier

    Returns True if the citizen's energy exceeds the effective threshold.
    """
    multiplier = SUBSCRIPTION_MULTIPLIER.get(subscription, 1)
    effective_threshold = _state["pressure"] / multiplier

    return citizen_energy > effective_threshold


def is_in_backoff() -> bool:
    """Are we in backoff period after a rate limit?"""
    return time.time() < _state["backoff_until"]


def get_pressure() -> float:
    """Current pressure value."""
    return _state["pressure"]


def get_effective_threshold(subscription: str = "free") -> float:
    """Get the effective activation threshold for a subscription tier."""
    multiplier = SUBSCRIPTION_MULTIPLIER.get(subscription, 1)
    return _state["pressure"] / multiplier


def _update_l3_sense():
    """Update the sense:activation_pressure Thing node in L3.

    Called on status transitions (healthy↔warning↔critical).
    The exteroception engine will detect the updated synthesis and
    inject it as a stimulus into @dev and @nervo's awareness.
    """
    import json
    try:
        from falkordb import FalkorDB
        import os
        db = FalkorDB(host="localhost", port=6379)
        graph_name = os.environ.get("L3_GRAPH", os.environ.get("FALKORDB_GRAPH", "lumina-prime"))
        graph = db.select_graph(graph_name)

        h = health_check()
        synthesis = json.dumps({
            "status": h["status"],
            "message": h["message"],
            "pressure": h["pressure"],
            "free_threshold": h["free_threshold"],
            "tier3_threshold": h["tier3_threshold"],
        })

        # Update the Thing node — energy reflects health
        energy_map = {"healthy": 0.2, "warning": 0.6, "critical": 1.0}
        graph.query(
            "MATCH (t:Thing {id: $id}) "
            "SET t.synthesis = $synthesis, t.energy = $energy, t.timestamp = $ts",
            {
                "id": "sense:activation_pressure",
                "synthesis": synthesis,
                "energy": energy_map.get(h["status"], 0.5),
                "ts": time.time(),
            },
        )
        logger.info(f"L3 sense updated: activation_pressure → {h['status']}")
    except Exception as e:
        logger.debug(f"L3 sense update failed: {e}")


def health_check() -> dict:
    """Health assessment of the pressure system.

    Returns a status dict with 'healthy', 'warning', or 'critical'.
    This IS the sense — pressure is its own health signal.
    """
    p = _state["pressure"]
    consec = _state["consecutive_429s"]

    if p < 1.0 and consec == 0:
        status = "healthy"
        message = f"Pressure nominal ({p:.2f}). System breathing."
    elif p < 5.0:
        status = "warning"
        message = f"Pressure elevated ({p:.2f}). Free citizens throttled."
    else:
        status = "critical"
        message = f"Pressure critical ({p:.2f}). Most citizens blocked. Rate limits sustained."

    return {
        "status": status,
        "message": message,
        "pressure": round(p, 3),
        "consecutive_429s": consec,
        "free_threshold": round(p, 3),
        "tier3_threshold": round(p / SUBSCRIPTION_MULTIPLIER["tier3"], 3),
    }


def get_status() -> dict:
    """Status for /health and debugging."""
    h = health_check()
    return {
        "pressure": round(_state["pressure"], 3),
        "health": h["status"],
        "thresholds": {
            tier: round(_state["pressure"] / mult, 3)
            for tier, mult in SUBSCRIPTION_MULTIPLIER.items()
        },
        "consecutive_429s": _state["consecutive_429s"],
        "total_calls": _state["total_calls"],
        "total_429s": _state["total_429s"],
        "in_backoff": is_in_backoff(),
        "backoff_remaining": max(0, round(_state["backoff_until"] - time.time())),
    }
