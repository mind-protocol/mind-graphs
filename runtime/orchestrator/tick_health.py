"""
Tick System Health — Sensory signals carried by specific citizens.

Spec: docs/orchestrator/tick_system/HEALTH_Tick_System.md

Each health signal is a state node injected into a carrier citizen's L1 brain.
The carrier FEELS the system health through their cognitive graph.
When something degrades, the state node's energy rises → enters WM → citizen becomes aware.

Health signals:
  H1: tick_loop_alive     → @nervo   (physics engine owner)
  H2: citizen_action_rate → @conductor (orchestration lead)
  H3: energy_conservation → @nervo   (decay law owner)
  H4: activation_pressure → @dev     (infra lead)
  H5: graph_latency       → @dev     (infra lead)
  H6: tick_duration       → @nervo   (physics must not stall)
  H7: serialization_speed → @nervo   (critical path owner)
  H8: account_health      → @mind    (token expiry — partner must re-login when auto-refresh fails)
  H9: graph_integrity     → @nexus   (graph vs filesystem citizen count alignment)

Co-Authored-By: Tomaso Nervo (@nervo) <nervo@mindprotocol.ai>
Co-Authored-By: Nexus (@nexus) <nexus@mindprotocol.ai>
"""

import logging
import os
import time
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger("orchestrator.tick_health")


# =========================================================================
# Health Signal Definitions
# =========================================================================

@dataclass
class HealthSignal:
    """A health signal carried by a specific citizen as a sense."""
    signal_id: str
    carrier: str          # citizen handle who FEELS this signal
    value: float = 1.0    # 0.0 = critical, 1.0 = healthy
    last_checked: float = 0.0
    alert_message: str = ""


# Carrier assignments (from HEALTH_Tick_System.md)
HEALTH_SIGNALS: dict[str, HealthSignal] = {
    "tick_loop_alive": HealthSignal(
        signal_id="state:tick_loop_alive",
        carrier="nervo",
    ),
    "citizen_action_rate": HealthSignal(
        signal_id="state:citizen_action_rate",
        carrier="conductor",
    ),
    "energy_conservation": HealthSignal(
        signal_id="state:energy_conservation",
        carrier="nervo",
    ),
    "activation_pressure": HealthSignal(
        signal_id="state:activation_pressure",
        carrier="dev",
    ),
    "graph_latency": HealthSignal(
        signal_id="state:graph_latency",
        carrier="dev",
    ),
    "tick_duration": HealthSignal(
        signal_id="state:tick_duration",
        carrier="nervo",
    ),
    "account_health": HealthSignal(
        signal_id="state:account_health",
        carrier="mind",
    ),
    "graph_integrity": HealthSignal(
        signal_id="state:graph_integrity",
        carrier="nexus",
    ),
}


# =========================================================================
# Health Check State
# =========================================================================

@dataclass
class TickHealthState:
    """Running state for health checks."""
    last_tick_time: float = 0.0
    tick_count: int = 0
    action_count: int = 0
    total_energy_prev: float = 0.0
    action_history: list[float] = field(default_factory=list)  # timestamps
    # H9: Graph integrity — cached to avoid scanning filesystem every tick
    last_graph_integrity_check: float = 0.0
    fs_citizen_count: int = 0
    graph_actor_count: int = 0
    graph_integrity_value: float = 1.0
    rebuild_triggered: bool = False


# Global health state
_state = TickHealthState()


# =========================================================================
# Health Check Functions
# =========================================================================

def record_tick_cycle(
    awareness_count: int,
    thought_count: int,
    action_count: int,
    duration_s: float,
    total_energy: float = 0.0,
    engine_count: int = 0,
):
    """Record a tick cycle for health analysis. Called from dispatcher._tick_all_citizens()."""
    now = time.time()
    _state.last_tick_time = now
    _state.tick_count += 1
    _state.action_count += action_count

    for _ in range(action_count):
        _state.action_history.append(now)

    # Trim action history to last 5 minutes
    cutoff = now - 300
    _state.action_history = [t for t in _state.action_history if t > cutoff]

    # Compute health signals
    signals = {}

    # H1: Tick loop alive (always healthy if we're here)
    signals["tick_loop_alive"] = 1.0

    # H2: Action rate (actions per citizen per 5 min)
    if engine_count > 0:
        actions_last_5min = len(_state.action_history)
        rate = actions_last_5min / engine_count  # actions per citizen per 5min
        # Healthy: 0.8-1.2 actions/citizen/5min (roughly 1 per 5 min)
        if 0.5 <= rate <= 2.0:
            signals["citizen_action_rate"] = 1.0
        elif rate < 0.05:
            signals["citizen_action_rate"] = 0.1  # critical: nobody acting
        else:
            signals["citizen_action_rate"] = max(0.3, 1.0 - abs(rate - 1.0))

    # H3: Energy conservation
    if _state.total_energy_prev > 0 and total_energy > 0:
        delta = abs(total_energy - _state.total_energy_prev) / _state.total_energy_prev
        signals["energy_conservation"] = max(0.0, 1.0 - delta * 5)  # 20% change → 0.0
    _state.total_energy_prev = total_energy

    # H6: Tick duration (< 1s = healthy)
    signals["tick_duration"] = max(0.0, 1.0 - duration_s)

    # H8: Account health (token expiry status)
    try:
        from runtime.orchestrator.account_balancer import account_health_value, stagger_warning
        health_val = account_health_value()
        signals["account_health"] = health_val
        stagger_msg = stagger_warning()
        sig = HEALTH_SIGNALS.get("account_health")
        if sig:
            if health_val < 0.3:
                sig.alert_message = "CRITICAL: Claude accounts expired, auto-refresh failed"
            elif health_val < 0.7:
                sig.alert_message = "WARNING: Claude accounts expiring soon"
            elif stagger_msg:
                sig.alert_message = stagger_msg
            else:
                sig.alert_message = ""
    except Exception:
        pass  # account_balancer not available

    # H9: Graph integrity (filesystem citizen count vs L3 Actor count)
    # Checked every 120s to avoid hammering filesystem + graph
    try:
        signals["graph_integrity"] = _check_graph_integrity(now)
    except Exception as e:
        logger.debug(f"Graph integrity check failed: {e}")

    # Update signal objects
    for name, value in signals.items():
        sig = HEALTH_SIGNALS.get(name)
        if sig:
            sig.value = value
            sig.last_checked = now

    return signals


# =========================================================================
# H9: Graph Integrity — Filesystem vs L3 Actor Count
# =========================================================================

GRAPH_INTEGRITY_INTERVAL = 120  # seconds between checks
GRAPH_INTEGRITY_CRITICAL = 0.5  # ratio below which auto-rebuild fires
GRAPH_INTEGRITY_WARNING = 0.8   # ratio below which warning fires


def _count_filesystem_citizens() -> int:
    """Count citizen directories in the world repo."""
    from pathlib import Path
    citizens_dir = Path(os.environ.get(
        "CITIZENS_DIR",
        os.path.join(os.environ.get("WORLD_REPO", ""), "citizens"),
    ))
    if not citizens_dir.is_dir():
        # Fallback: try common locations
        for candidate in [
            Path.home() / "lumina-prime" / "citizens",
            Path("/home/mind-protocol/lumina-prime/citizens"),
        ]:
            if candidate.is_dir():
                citizens_dir = candidate
                break
    if not citizens_dir.is_dir():
        return 0
    return sum(
        1 for d in citizens_dir.iterdir()
        if d.is_dir() and not d.name.startswith(".")
    )


def _count_graph_actors() -> int:
    """Count Actor nodes in the L3 graph with a non-empty handle."""
    try:
        from falkordb import FalkorDB
        host = os.environ.get("FALKORDB_HOST", "localhost")
        port = int(os.environ.get("FALKORDB_PORT", "6379"))
        graph_name = os.environ.get("FALKORDB_GRAPH", "lumina-prime")
        db = FalkorDB(host=host, port=port)
        g = db.select_graph(graph_name)
        result = g.query(
            "MATCH (a:Actor) WHERE a.handle IS NOT NULL AND a.handle <> '' RETURN count(a)"
        )
        if result.result_set and result.result_set[0]:
            return result.result_set[0][0]
    except Exception as e:
        logger.warning(f"Graph actor count query failed: {e}")
    return 0


def _auto_rebuild_graph():
    """Trigger auto-rebuild of L3 graph from filesystem."""
    import subprocess
    rebuild_script = os.path.join(
        os.environ.get("WORLD_REPO", "/home/mind-protocol/lumina-prime"),
        "scripts",
        "rebuild_l3_graph.py",
    )
    if not os.path.exists(rebuild_script):
        logger.error(f"Rebuild script not found: {rebuild_script}")
        return
    logger.warning("GRAPH INTEGRITY CRITICAL — auto-rebuilding L3 graph from filesystem")
    try:
        result = subprocess.run(
            ["python3", rebuild_script],
            capture_output=True,
            text=True,
            timeout=60,
            cwd=os.path.dirname(rebuild_script),
        )
        if result.returncode == 0:
            logger.info(f"Graph auto-rebuild completed:\n{result.stdout[-500:]}")
        else:
            logger.error(f"Graph auto-rebuild failed:\n{result.stderr[-500:]}")
    except Exception as e:
        logger.error(f"Graph auto-rebuild error: {e}")


def _check_graph_integrity(now: float) -> float:
    """Check graph actor count vs filesystem citizen count.

    Returns health value: 1.0 = perfect alignment, 0.0 = critical loss.
    Auto-triggers rebuild when ratio drops below critical threshold.
    """
    # Rate-limit: only check every GRAPH_INTEGRITY_INTERVAL seconds
    if now - _state.last_graph_integrity_check < GRAPH_INTEGRITY_INTERVAL:
        return _state.graph_integrity_value

    _state.last_graph_integrity_check = now

    fs_count = _count_filesystem_citizens()
    graph_count = _count_graph_actors()

    _state.fs_citizen_count = fs_count
    _state.graph_actor_count = graph_count

    if fs_count == 0:
        _state.graph_integrity_value = 1.0
        return 1.0

    ratio = graph_count / fs_count
    sig = HEALTH_SIGNALS.get("graph_integrity")

    if ratio >= GRAPH_INTEGRITY_WARNING:
        # Healthy: graph has >= 80% of filesystem citizens
        health = 1.0
        if sig:
            sig.alert_message = ""
        _state.rebuild_triggered = False
    elif ratio >= GRAPH_INTEGRITY_CRITICAL:
        # Warning: graph missing 20-50% of citizens
        health = max(0.3, ratio)
        if sig:
            sig.alert_message = (
                f"WARNING: Graph has {graph_count}/{fs_count} actors "
                f"({ratio:.0%}) — data loss detected"
            )
        logger.warning(
            f"Graph integrity degraded: {graph_count}/{fs_count} actors ({ratio:.0%})"
        )
        _state.rebuild_triggered = False
    else:
        # Critical: graph missing > 50% of citizens — auto-rebuild
        health = max(0.0, ratio)
        if sig:
            sig.alert_message = (
                f"CRITICAL: Graph has only {graph_count}/{fs_count} actors "
                f"({ratio:.0%}) — triggering auto-rebuild"
            )
        logger.error(
            f"Graph integrity CRITICAL: {graph_count}/{fs_count} actors ({ratio:.0%})"
        )
        if not _state.rebuild_triggered:
            _state.rebuild_triggered = True
            _auto_rebuild_graph()

    _state.graph_integrity_value = health
    return health


def inject_health_into_brains(citizen_states: dict):
    """Inject health state nodes into carrier citizens' L1 brains.

    This is the KEY function that makes health SENSORY.
    Called periodically by the dispatcher (e.g., every 60s).

    Args:
        citizen_states: dict[handle → CitizenCognitiveState] from dispatcher.
    """
    from runtime.cognition.models import Node, NodeType

    injected = 0
    now = time.time()

    for name, signal in HEALTH_SIGNALS.items():
        state = citizen_states.get(signal.carrier)
        if state is None:
            continue

        node_id = signal.signal_id
        existing = state.nodes.get(node_id)

        # Energy reflects health: unhealthy = HIGH energy (enters WM as alarm)
        # healthy = LOW energy (fades from WM, citizen not distracted)
        alarm_energy = max(0.0, 1.0 - signal.value)  # 0 health → 1.0 energy (ALARM)

        if existing:
            existing.energy = alarm_energy
            existing.content = signal.alert_message or f"{name}: {signal.value:.2f}"
        else:
            node = Node(
                id=node_id,
                node_type=NodeType.STATE,
                content=signal.alert_message or f"{name}: {signal.value:.2f}",
                weight=0.6,  # moderate weight — health is important
                energy=alarm_energy,
                stability=0.3,  # transient — updates every check
                created_at=now,
            )
            state.add_node(node)
            injected += 1

    if injected > 0:
        logger.info(f"Health signals injected into {injected} carrier brains")


def get_health_summary() -> dict:
    """Return current health state for API/monitoring."""
    return {
        name: {
            "value": sig.value,
            "carrier": sig.carrier,
            "last_checked": sig.last_checked,
            "status": "healthy" if sig.value > 0.7 else "warning" if sig.value > 0.3 else "critical",
        }
        for name, sig in HEALTH_SIGNALS.items()
    }
