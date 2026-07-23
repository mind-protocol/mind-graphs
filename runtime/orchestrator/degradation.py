"""Graceful degradation system — 4-level resilience with auto-recovery.

Levels:
  0 = normal      (full parallelism)
  1 = throttled   (MAX_PARALLEL → 3, brief backoff)
  2 = degraded    (MAX_PARALLEL → 1, Claude API only)
  3 = minimal     (MAX_PARALLEL → 1, OpenAI fallback)

4-level resilience system with auto-recovery and degradation management.
Notifications are sent via Telegram when degradation level changes.
"""

import os
import time
import logging
from datetime import datetime
from typing import Optional, Callable

from runtime.orchestrator.account_balancer import all_accounts_exhausted

logger = logging.getLogger("orchestrator.degradation")

# ── Default Notification Function ──────────────────────────────────────────
# Registered at boot by the dispatcher. Used as fallback when callers
# (e.g. claude_invoker) don't pass notify_fn explicitly.

_default_notify_fn: Optional[Callable] = None


def set_notify_fn(fn: Callable):
    """Register a default notification function for degradation alerts.

    Called once at dispatcher startup. All escalate/recovery/deadlock calls
    will use this function when no explicit notify_fn is passed.
    """
    global _default_notify_fn
    _default_notify_fn = fn
    logger.info("Degradation notify_fn registered")


def _resolve_notify_fn(explicit: Optional[Callable] = None) -> Optional[Callable]:
    """Return the explicit notify_fn if provided, else the registered default."""
    return explicit if explicit is not None else _default_notify_fn


def build_telegram_notify_fn() -> Optional[Callable]:
    """Build a notify function that sends Telegram alerts.

    Uses TELEGRAM_ALERT_CHAT_ID or NICOLAS_CHAT_ID env vars for the target.
    Returns None if no bot token or chat ID is configured.
    Gracefully handles Telegram being unavailable — logs and moves on.
    """
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    alert_chat_id = (
        os.environ.get("TELEGRAM_ALERT_CHAT_ID")
        or os.environ.get("TELEGRAM_NOTIFICATIONS_CHAT_ID")
        or os.environ.get("NICOLAS_CHAT_ID", "")
    )

    if not bot_token:
        logger.warning("TELEGRAM_BOT_TOKEN not set — degradation alerts disabled")
        return None

    if not alert_chat_id:
        logger.warning(
            "No alert chat ID configured (set TELEGRAM_ALERT_CHAT_ID or NICOLAS_CHAT_ID) "
            "— degradation alerts disabled"
        )
        return None

    def _notify(message: str):
        """Send a degradation alert to Telegram. Never raises."""
        import requests as _requests

        level_names = {0: "normal", 1: "throttled", 2: "degraded", 3: "minimal"}
        level = _state.get("level", 0)
        level_name = level_names.get(level, "unknown")
        error_count = _state.get("error_count", 0)
        last_error = _state.get("last_error", "N/A")

        # Build rich alert message
        severity = "INFO" if level <= 1 else ("WARNING" if level == 2 else "CRITICAL")
        alert_text = (
            f"[{severity}] Degradation Alert\n"
            f"Level: {level} ({level_name})\n"
            f"Errors: {error_count}\n"
            f"Last error: {last_error or 'N/A'}\n"
            f"Max parallel: {get_effective_max_parallel()}\n\n"
            f"{message}"
        )

        # Truncate to Telegram limit
        if len(alert_text) > 4000:
            alert_text = alert_text[:3997] + "..."

        logger.info(f"Sending degradation alert to Telegram chat {alert_chat_id}: {message}")

        try:
            url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
            resp = _requests.post(
                url,
                json={"chat_id": alert_chat_id, "text": alert_text},
                timeout=10,
            )
            if resp.ok:
                logger.info("Degradation alert sent successfully")
            else:
                logger.warning(
                    f"Degradation alert failed (HTTP {resp.status_code}): "
                    f"{resp.text[:200]}"
                )
        except Exception as e:
            # Graceful degradation of the degradation system itself
            logger.warning(f"Degradation alert send failed (Telegram unavailable): {e}")

    logger.info(f"Telegram degradation alerts configured (chat_id={alert_chat_id})")
    return _notify

# ── Constants ───────────────────────────────────────────────────────────────

DEGRADATION_BACKOFF = {
    0: 0,      # no backoff
    1: 15,     # throttled
    2: 45,     # degraded
    3: 120,    # minimal
}

DEGRADATION_PARALLEL = {
    0: 35,  # normal (overridden by env MAX_PARALLEL)
    1: 3,   # throttled
    2: 1,   # degraded
    3: 1,   # minimal
}

DEGRADATION_THRESHOLDS = {
    "throttle_after_errors": 3,
    "degrade_after_errors": 6,
    "minimal_after_errors": 10,
    "recovery_tests_needed": 2,
}

AUTO_RECOVERY_IDLE_SECONDS = 600  # 10 minutes no errors → step down

# ── State ───────────────────────────────────────────────────────────────────

_state = {
    "level": 0,
    "since": None,
    "last_error": None,
    "last_error_at": 0,
    "error_count": 0,
    "backoff_until": 0,
    "recovery_tests": 0,
    "original_max_parallel": 35,
    "last_degradation_notif": 0,
    "_last_deadlock_recovery": 0,
}


def detect_rate_limit_error(stderr: str, stdout: str = "") -> bool:
    """Detect if Claude output indicates rate limiting or auth failure."""
    combined = (stderr + stdout).lower()

    # Strong indicators
    strong = [
        "rate limit", "rate_limit", "ratelimit",
        "429", "too many requests",
        "quota exceeded", "resource_exhausted",
        "hit your limit", "credit balance",
    ]
    if any(ind in combined for ind in strong):
        return True

    # Auth/credential errors
    auth_errors = [
        "unauthorized", "401",
        "invalid_grant", "token expired",
        "authentication failed", "not authenticated",
        "invalid credentials", "session expired",
        "no conversation found",
    ]
    if any(ind in combined for ind in auth_errors):
        return True

    # Weak indicators — only if multiple
    weak = [
        "overloaded", "capacity",
        "please try again", "temporarily unavailable",
    ]
    weak_count = sum(1 for ind in weak if ind in combined)
    return weak_count >= 2


def escalate(error_msg: Optional[str] = None, notify_fn=None):
    """Escalate degradation level based on consecutive errors.

    notify_fn: explicit callback. Falls back to registered default if None.
    """
    resolved_notify = _resolve_notify_fn(notify_fn)
    thresholds = DEGRADATION_THRESHOLDS

    _state["error_count"] += 1
    _state["last_error"] = error_msg
    _state["last_error_at"] = time.time()
    _state["recovery_tests"] = 0

    old_level = _state["level"]

    if _state["error_count"] >= thresholds["minimal_after_errors"]:
        _state["level"] = 3
    elif _state["error_count"] >= thresholds["degrade_after_errors"]:
        _state["level"] = 2
    elif _state["error_count"] >= thresholds["throttle_after_errors"]:
        _state["level"] = 1

    backoff_seconds = DEGRADATION_BACKOFF.get(_state["level"], 60)
    _state["backoff_until"] = time.time() + backoff_seconds

    if _state["level"] != old_level:
        if _state["since"] is None:
            _state["since"] = datetime.now().isoformat()
        level_names = {0: "normal", 1: "throttled", 2: "degraded", 3: "minimal"}
        logger.warning(
            f"DEGRADATION: {old_level} → {_state['level']} ({level_names[_state['level']]}) "
            f"— parallel={get_effective_max_parallel()}, backoff={backoff_seconds}s"
        )

        if _state["level"] >= 2 and resolved_notify:
            last_notif = _state.get("last_degradation_notif", 0)
            if time.time() - last_notif > 1800:
                _state["last_degradation_notif"] = time.time()
                try:
                    resolved_notify(
                        f"Escalated {old_level} -> {_state['level']} ({level_names[_state['level']]}). "
                        f"Error: {error_msg or 'unknown'}. "
                        f"Responses may be slower."
                    )
                except Exception as e:
                    logger.warning(f"Degradation notification failed: {e}")


def attempt_recovery(notify_fn=None):
    """Check if we can step down from degradation after successful requests.

    notify_fn: explicit callback. Falls back to registered default if None.
    """
    if _state["level"] == 0:
        return

    resolved_notify = _resolve_notify_fn(notify_fn)
    _state["recovery_tests"] += 1

    if _state["recovery_tests"] >= DEGRADATION_THRESHOLDS["recovery_tests_needed"]:
        old_level = _state["level"]
        _state["level"] = max(0, _state["level"] - 1)
        _state["error_count"] = max(0, _state["error_count"] - 3)
        _state["recovery_tests"] = 0

        if _state["level"] == 0:
            _state["since"] = None
            _state["last_error"] = None

        level_names = {0: "normal", 1: "throttled", 2: "degraded", 3: "minimal"}
        logger.info(f"RECOVERY: {old_level} → {_state['level']} ({level_names[_state['level']]})")

        if _state["level"] == 0 and resolved_notify:
            try:
                resolved_notify("Back to normal operation. All systems recovered.")
            except Exception as e:
                logger.warning(f"Recovery notification failed: {e}")


def check_deadlock(notify_fn=None):
    """Auto-recover from degradation deadlock.

    Two paths:
    1. MINIMAL (level 3) >30min: force-reset to THROTTLED
    2. ANY level >0 with no errors for AUTO_RECOVERY_IDLE_SECONDS: step down

    notify_fn: explicit callback. Falls back to registered default if None.
    """
    if _state["level"] == 0:
        return

    resolved_notify = _resolve_notify_fn(notify_fn)

    # Path 2: idle recovery
    if all_accounts_exhausted():
        return
    last_err = _state.get("last_error_at", 0)
    if last_err > 0 and time.time() - last_err > AUTO_RECOVERY_IDLE_SECONDS:
        old_level = _state["level"]
        _state["level"] = max(0, _state["level"] - 1)
        _state["error_count"] = max(0, _state["error_count"] - 3)
        _state["recovery_tests"] = 0
        _state["last_error_at"] = time.time()  # Reset timer for next step-down

        level_names = {0: "normal", 1: "throttled", 2: "degraded", 3: "minimal"}
        logger.info(f"IDLE RECOVERY: {old_level} → {_state['level']} ({level_names[_state['level']]})")

        if _state["level"] == 0:
            _state["since"] = None
            _state["last_error"] = None
            if resolved_notify:
                try:
                    resolved_notify("Back to normal (idle auto-recovery).")
                except Exception as e:
                    logger.warning(f"Idle recovery notification failed: {e}")
        return

    # Path 1: minimal deadlock recovery
    if _state["level"] < 3 or not _state["since"]:
        return

    try:
        since = datetime.fromisoformat(_state["since"])
        stuck_minutes = (datetime.now() - since).total_seconds() / 60
    except (ValueError, TypeError):
        return

    if stuck_minutes < 30:
        return

    last_recovery = _state.get("_last_deadlock_recovery", 0)
    if time.time() - last_recovery < 1800:
        return
    _state["_last_deadlock_recovery"] = time.time()

    _state["level"] = 1
    _state["error_count"] = 2
    _state["recovery_tests"] = 0
    _state["since"] = datetime.now().isoformat()
    _state["backoff_until"] = time.time() + 10

    logger.warning(f"DEADLOCK RECOVERY: MINIMAL for {stuck_minutes:.0f}min → reset to THROTTLED")

    if resolved_notify:
        try:
            resolved_notify(f"Auto-recovered from MINIMAL deadlock ({stuck_minutes:.0f}min). Reset to THROTTLED.")
        except Exception as e:
            logger.warning(f"Deadlock recovery notification failed: {e}")


def is_in_backoff() -> bool:
    """Check if we're in backoff period."""
    return time.time() < _state["backoff_until"]


def get_effective_max_parallel() -> int:
    """Get current effective max parallel sessions."""
    import os
    base = int(os.environ.get("MAX_PARALLEL", _state["original_max_parallel"]))
    return DEGRADATION_PARALLEL.get(_state["level"], base)


def is_degraded() -> bool:
    """Return True if running in degraded mode (level >= 2)."""
    return _state["level"] >= 2


def get_status() -> dict:
    """Get current degradation status for display."""
    level_names = {0: "normal", 1: "throttled", 2: "degraded", 3: "minimal"}
    return {
        "level": _state["level"],
        "level_name": level_names.get(_state["level"], "unknown"),
        "since": _state["since"],
        "error_count": _state["error_count"],
        "max_parallel": get_effective_max_parallel(),
        "in_backoff": is_in_backoff(),
        "backoff_remaining": max(0, _state["backoff_until"] - time.time()),
    }
