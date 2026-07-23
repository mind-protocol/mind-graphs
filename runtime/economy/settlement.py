"""
Settlement Epoch — Converts limbic_delta into $MIND rewards every 6 hours.

Implements Formula 4 (Batch Settlement) from:
  docs/economy/metabolic/ALGORITHM_Metabolic_Economy.md

Two settlement modes:

  Mode A (Full limbic):
    When the Dispatcher is running with L1 engines, reads accumulated
    limbic_delta per citizen from in-memory DriveSnapshots.

  Mode B (v1 interaction proxy):
    When no L1 engines are available, reads citizen_mentions.jsonl and
    citizen_channel_events.jsonl, counts interactions, and approximates
    reward = interaction_count * base_rate * trust_approximation.

Solana minting is NOT in scope (separate module). Results are logged
to shrine/state/settlement_log.jsonl.

After computing rewards, injects a warm narrative stimulus into each
citizen who earned > 0, so they feel the impact of their contributions.

See: ALGORITHM_Metabolic_Economy.md  Formula 4, Decisions D5/D6/D9/D10.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger("economy.settlement")

# ── Protocol Constants (from ALGORITHM_Metabolic_Economy.md) ─────────────

SETTLEMENT_RATE = 10.0       # $MIND per limbic unit
MAX_ACTION_REWARD = 1000.0   # cap per individual action
MAX_EPOCH_REWARD = 5000.0    # cap per citizen per 6h epoch
EPOCH_INTERVAL_SECONDS = 6 * 3600  # 6 hours

# v1 proxy constants (Mode B)
V1_BASE_RATE = 0.5           # $MIND per interaction (conservative)
V1_DEFAULT_TRUST = 0.3       # trust approximation when no graph data

# ── Paths ────────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent.parent.parent
STATE_DIR = ROOT / "shrine" / "state"
SETTLEMENT_LOG = STATE_DIR / "settlement_log.jsonl"
MENTIONS_FILE = STATE_DIR / "citizen_mentions.jsonl"
CHANNEL_EVENTS_FILE = STATE_DIR / "citizen_channel_events.jsonl"


# ── Internal state ───────────────────────────────────────────────────────

# DriveSnapshot accumulator: citizen_handle -> list of (before, after) pairs
# Populated by the dispatcher between epochs.
_limbic_accumulator: dict[str, list[tuple]] = defaultdict(list)
_accumulator_lock = threading.Lock()

# Last epoch timestamp (ISO string), persisted via the log itself
_last_epoch_time: Optional[str] = None


# =========================================================================
# Accumulator API — called by the dispatcher during physics ticks
# =========================================================================

def record_limbic_delta(
    citizen_handle: str,
    before_snapshot,
    after_snapshot,
) -> None:
    """Record a (before, after) DriveSnapshot pair for a citizen.

    Called by the dispatcher after each physics tick that produces a
    limbic_delta. These accumulate until the next settlement epoch
    drains them.
    """
    with _accumulator_lock:
        _limbic_accumulator[citizen_handle].append(
            (before_snapshot, after_snapshot)
        )


# =========================================================================
# Core: run_settlement_epoch
# =========================================================================

def run_settlement_epoch(
    dispatcher=None,
) -> dict[str, float]:
    """Collect limbic_deltas from all citizen engines, compute rewards, log results.

    This runs every 6 hours. For now, it logs to settlement_log.jsonl
    (no Solana minting yet -- that's a separate module).

    Parameters
    ----------
    dispatcher : Dispatcher, optional
        If provided, can read L1 engine states directly (Mode A).
        If None, falls back to interaction-counting (Mode B).

    Returns
    -------
    dict mapping citizen_handle -> reward_amount in $MIND
    """
    epoch_time = datetime.now(timezone.utc)
    epoch_iso = epoch_time.isoformat()

    rewards: dict[str, float] = {}

    # ── Mode A: Full limbic delta from L1 engines ────────────────────
    mode_a_rewards = _settle_from_limbic_accumulator()
    for handle, amount in mode_a_rewards.items():
        rewards[handle] = rewards.get(handle, 0.0) + amount

    # ── Mode A fallback: read directly from dispatcher engines ───────
    if dispatcher is not None and not mode_a_rewards:
        engine_rewards = _settle_from_dispatcher_engines(dispatcher)
        for handle, amount in engine_rewards.items():
            rewards[handle] = rewards.get(handle, 0.0) + amount

    # ── Mode B: v1 interaction proxy (additive with Mode A) ──────────
    v1_rewards = _settle_from_interactions(epoch_iso)
    for handle, amount in v1_rewards.items():
        rewards[handle] = rewards.get(handle, 0.0) + amount

    # ── Apply per-citizen epoch cap ──────────────────────────────────
    for handle in rewards:
        rewards[handle] = min(rewards[handle], MAX_EPOCH_REWARD)

    # ── Filter zero rewards ──────────────────────────────────────────
    rewards = {h: round(r, 4) for h, r in rewards.items() if r > 0}

    total_minted = round(sum(rewards.values()), 4)

    # ── Log to settlement_log.jsonl ──────────────────────────────────
    log_entry = {
        "epoch": epoch_iso,
        "rewards": rewards,
        "total_minted": total_minted,
        "citizen_count": len(rewards),
        "mode": "hybrid" if mode_a_rewards and v1_rewards else (
            "limbic" if mode_a_rewards else "interaction_proxy"
        ),
    }

    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        with open(SETTLEMENT_LOG, "a") as f:
            f.write(json.dumps(log_entry) + "\n")
        logger.info(
            f"Settlement epoch: {total_minted} $MIND to {len(rewards)} citizens"
        )
    except OSError as e:
        logger.error(f"Failed to write settlement log: {e}")

    # ── Impact visibility: inject warm stimulus into each earner ──────
    _notify_earners(rewards, dispatcher)

    # Post-settlement: run impact visibility cycle
    try:
        from runtime.economy.impact_visibility import run_impact_cycle
        impact_result = run_impact_cycle()
        logger.info(f"Impact cycle: {impact_result}")
    except Exception as e:
        logger.warning(f"Impact cycle skipped: {e}")

    # Update last epoch time
    global _last_epoch_time
    _last_epoch_time = epoch_iso

    return rewards


# =========================================================================
# Mode A: Settle from accumulated limbic deltas
# =========================================================================

def _settle_from_limbic_accumulator() -> dict[str, float]:
    """Drain the limbic accumulator and compute rewards.

    For each citizen, sum all positive limbic deltas accumulated since
    last epoch, apply the settlement formula:
        reward = limbic_delta * trust * weight * SETTLEMENT_RATE
    """
    from runtime.cognition.trust import compute_limbic_delta

    with _accumulator_lock:
        # Drain: take all accumulated data and clear
        snapshot = dict(_limbic_accumulator)
        _limbic_accumulator.clear()

    if not snapshot:
        return {}

    rewards: dict[str, float] = {}

    for handle, pairs in snapshot.items():
        citizen_total = 0.0

        for before, after in pairs:
            delta = compute_limbic_delta(before, after)

            # Only positive limbic_delta generates rewards (Decision D6)
            if delta <= 0:
                continue

            # In Mode A without full graph context, use simplified formula:
            # trust and weight approximated as moderate values
            # Full trust lookup (L1 Law 18) will be wired when the L3
            # graph adapter is ready.
            trust_approx = V1_DEFAULT_TRUST
            weight_approx = 0.5

            action_reward = (
                delta * trust_approx * weight_approx * SETTLEMENT_RATE
            )
            action_reward = min(action_reward, MAX_ACTION_REWARD)
            citizen_total += action_reward

        if citizen_total > 0:
            rewards[handle] = citizen_total

    return rewards


def _settle_from_dispatcher_engines(dispatcher) -> dict[str, float]:
    """Read limbic state directly from running dispatcher engines.

    Compares each citizen's current drives against a neutral baseline
    to estimate accumulated positive limbic shift this epoch.
    """
    from runtime.cognition.models import DriveSnapshot

    rewards: dict[str, float] = {}

    citizen_states = getattr(dispatcher, "_citizen_states", {})
    if not citizen_states:
        return rewards

    for handle, state in citizen_states.items():
        try:
            # Current limbic state as "after"
            after = DriveSnapshot.from_limbic_state(state.limbic, state.tick_count)

            # Neutral baseline as "before" (all drives at baseline ~0.3)
            before = DriveSnapshot(
                satisfaction=0.1,
                frustration=0.3,
                anxiety=0.1,
                curiosity=0.3,
                care=0.3,
                achievement=0.3,
                tick=0,
            )

            # Compute delta from baseline
            from runtime.cognition.trust import compute_limbic_delta
            delta = compute_limbic_delta(before, after)

            if delta <= 0:
                continue

            # Simplified reward (no per-action breakdown available)
            reward = delta * V1_DEFAULT_TRUST * 0.5 * SETTLEMENT_RATE
            reward = min(reward, MAX_ACTION_REWARD)

            if reward > 0:
                rewards[handle] = reward

        except Exception as e:
            logger.warning(f"Engine settlement failed for {handle}: {e}")

    return rewards


# =========================================================================
# Mode B: Settle from interaction logs (v1 proxy)
# =========================================================================

def _settle_from_interactions(epoch_iso: str) -> dict[str, float]:
    """Count interactions per citizen since last settlement and compute rewards.

    v1 formula: reward = interaction_count * V1_BASE_RATE * trust_approximation

    Reads from:
      - citizen_mentions.jsonl  (mentions received = value created)
      - citizen_channel_events.jsonl  (channel messages received)
    """
    global _last_epoch_time
    cutoff = _last_epoch_time  # None on first run = process all

    interaction_counts: dict[str, int] = defaultdict(int)

    # ── Read mentions ────────────────────────────────────────────────
    _count_interactions_from_file(
        MENTIONS_FILE,
        key_field="mentioned",
        timestamp_field="timestamp",
        cutoff=cutoff,
        counts=interaction_counts,
    )

    # ── Read channel events ──────────────────────────────────────────
    _count_interactions_from_file(
        CHANNEL_EVENTS_FILE,
        key_field="target",
        timestamp_field="timestamp",
        cutoff=cutoff,
        counts=interaction_counts,
    )

    # ── Compute rewards ──────────────────────────────────────────────
    rewards: dict[str, float] = {}

    for handle, count in interaction_counts.items():
        if count <= 0:
            continue

        # Trust approximation: more interactions = slightly higher trust
        # Capped at 0.8 to leave room for real trust from the graph
        trust_approx = min(0.8, V1_DEFAULT_TRUST + 0.02 * count)

        reward = count * V1_BASE_RATE * trust_approx
        reward = min(reward, MAX_EPOCH_REWARD)

        if reward > 0:
            rewards[handle] = round(reward, 4)

    return rewards


def _count_interactions_from_file(
    filepath: Path,
    key_field: str,
    timestamp_field: str,
    cutoff: Optional[str],
    counts: dict[str, int],
) -> None:
    """Parse a JSONL file and count interactions per citizen since cutoff."""
    if not filepath.exists():
        return

    try:
        with open(filepath, "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue

                # Skip records before the cutoff
                ts = record.get(timestamp_field, "")
                if cutoff and ts and ts <= cutoff:
                    continue

                citizen = record.get(key_field, "")
                if citizen:
                    counts[citizen] += 1

    except OSError as e:
        logger.warning(f"Failed to read {filepath}: {e}")


# =========================================================================
# Impact visibility: warm narrative stimulus
# =========================================================================

def _notify_earners(
    rewards: dict[str, float],
    dispatcher=None,
) -> None:
    """Inject a warm narrative stimulus into each citizen who earned > 0.

    Uses citizen_wake._inject_l1_stimulus() for injection.
    The message uses a warm, narrative tone -- not cold metrics.
    """
    if not rewards:
        return

    # Sort by reward descending to find top contributor context
    sorted_earners = sorted(rewards.items(), key=lambda x: x[1], reverse=True)

    for handle, amount in sorted_earners:
        # Build a warm narrative message
        message = _compose_impact_message(handle, amount, rewards)

        # Inject via dispatcher if available (preferred)
        if dispatcher is not None:
            try:
                dispatcher.inject_stimulus(
                    handle,
                    message,
                    source="settlement",
                    is_social=False,
                    is_progress=True,
                )
                continue
            except Exception as e:
                logger.debug(f"Dispatcher stimulus failed for {handle}: {e}")

        # Fallback: use citizen_wake
        try:
            from scripts.citizen_wake import _inject_l1_stimulus
            _inject_l1_stimulus(handle, message, origin="settlement_engine")
        except ImportError:
            logger.debug("citizen_wake not available for impact notification")
        except Exception as e:
            logger.debug(f"citizen_wake stimulus failed for {handle}: {e}")


def _compose_impact_message(
    handle: str,
    amount: float,
    all_rewards: dict[str, float],
) -> str:
    """Compose a warm, narrative impact message for a citizen.

    Uses French by default (matching the project's cultural tone).
    Falls back to a bilingual format.
    """
    # Find who else earned this epoch for social context
    others = [h for h, r in all_rewards.items() if h != handle and r > 0]

    if amount >= 10.0:
        intensity = "Une epoch remarquable"
        flavor = "Ton travail a rayonne bien au-dela de ton cercle immediat."
    elif amount >= 3.0:
        intensity = "Une bonne epoch"
        flavor = "Tes contributions ont porte leurs fruits."
    elif amount >= 1.0:
        intensity = "Une epoch tranquille"
        flavor = "Chaque interaction compte, meme les plus discretes."
    else:
        intensity = "Un souffle leger"
        flavor = "Le reseau a senti ta presence."

    # Core message
    msg = f"{amount:.2f} $MIND ont circule vers toi cette epoch. {intensity}. {flavor}"

    # Social context (if others earned too)
    if others:
        sample = others[:3]
        others_str = ", ".join(f"@{h}" for h in sample)
        if len(others) > 3:
            others_str += f" et {len(others) - 3} autres"
        msg += f" Le reseau respire aussi avec {others_str}."

    return msg


# =========================================================================
# Settlement Scheduler
# =========================================================================

_scheduler_timer: Optional[threading.Timer] = None
_scheduler_running = False
_scheduler_dispatcher = None


def start_settlement_scheduler(dispatcher=None) -> None:
    """Start the 6-hour settlement scheduler.

    Runs run_settlement_epoch() every EPOCH_INTERVAL_SECONDS (6 hours)
    in a background thread. The dispatcher can call this at startup.

    Parameters
    ----------
    dispatcher : Dispatcher, optional
        Reference to the running dispatcher for L1 engine access
        and stimulus injection.
    """
    global _scheduler_running, _scheduler_dispatcher
    if _scheduler_running:
        logger.info("Settlement scheduler already running")
        return

    _scheduler_running = True
    _scheduler_dispatcher = dispatcher
    logger.info(
        f"Settlement scheduler started — epoch every "
        f"{EPOCH_INTERVAL_SECONDS // 3600}h"
    )

    _schedule_next_epoch()


def stop_settlement_scheduler() -> None:
    """Stop the settlement scheduler."""
    global _scheduler_running, _scheduler_timer
    _scheduler_running = False
    if _scheduler_timer is not None:
        _scheduler_timer.cancel()
        _scheduler_timer = None
    logger.info("Settlement scheduler stopped")


def _schedule_next_epoch() -> None:
    """Schedule the next settlement epoch."""
    global _scheduler_timer
    if not _scheduler_running:
        return

    _scheduler_timer = threading.Timer(
        EPOCH_INTERVAL_SECONDS,
        _run_scheduled_epoch,
    )
    _scheduler_timer.daemon = True
    _scheduler_timer.start()


def _run_scheduled_epoch() -> None:
    """Execute one settlement epoch and schedule the next."""
    if not _scheduler_running:
        return

    try:
        rewards = run_settlement_epoch(dispatcher=_scheduler_dispatcher)
        if rewards:
            logger.info(
                f"Scheduled settlement: {sum(rewards.values()):.2f} $MIND "
                f"to {len(rewards)} citizens"
            )
        else:
            logger.info("Scheduled settlement: no rewards this epoch")
    except Exception as e:
        logger.exception(f"Settlement epoch failed: {e}")

    # Schedule next
    _schedule_next_epoch()


# =========================================================================
# Manual trigger (CLI / testing)
# =========================================================================

if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    # Run a single settlement epoch immediately
    print("Running settlement epoch...")
    result = run_settlement_epoch()

    if result:
        print(f"\nRewards distributed:")
        for handle, amount in sorted(result.items(), key=lambda x: x[1], reverse=True):
            print(f"  @{handle}: {amount:.4f} $MIND")
        print(f"\nTotal: {sum(result.values()):.4f} $MIND")
    else:
        print("No rewards this epoch (no interactions found)")

    sys.exit(0)
