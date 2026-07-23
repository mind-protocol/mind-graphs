"""Alarm watcher — scans citizen wakes in the L1 graphs and enqueues wake messages.

Background thread that periodically checks every citizen's L1 graph for Moment nodes
whose scheduledFor has come due. When one triggers, it enqueues a wake message for
the orchestrator. Repeating wakes are rescheduled; one-shot wakes are marked fired.

Wakes used to live in citizens/<handle>/alarms.jsonl. They do not: the citizen's
state is its L1 graph, and that is now the only store. See runtime/orchestrator/
graph_alarms.py for the node shape.

No cron — citizens set their own wakes via the `alarm` / `schedule_wake` MCP tools.
"""

import os
import time
import logging
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Callable

from runtime.orchestrator import graph_alarms

logger = logging.getLogger("orchestrator.alarms")

SCAN_INTERVAL = 30  # seconds between alarm scans


class AlarmWatcher:
    """Background thread that watches citizen alarm files."""

    def __init__(self, enqueue_fn: Optional[Callable] = None):
        self.enqueue_fn = enqueue_fn  # function to add items to orchestrator queue
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._fired_ids: set = set()  # Track recently fired alarm IDs to avoid double-firing

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="alarm-watcher")
        self._thread.start()
        logger.info("Alarm watcher started")

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)

    def _run_loop(self):
        while self._running:
            # Heartbeat first, so the wake tools can detect a live watcher even if a scan
            # later throws. Best-effort — never let liveness reporting break the loop.
            try:
                from mcp.tools.orchestrator_heartbeat import touch_heartbeat
                touch_heartbeat(SCAN_INTERVAL)
            except Exception as e:
                logger.debug(f"Heartbeat write skipped: {e}")
            try:
                self._scan_alarms()
            except Exception as e:
                logger.exception(f"Alarm scan error: {e}")
            time.sleep(SCAN_INTERVAL)

    def _scan_alarms(self):
        """Scan every citizen's L1 graph for wakes that have come due.

        Citizens are discovered from the graph list, not from a directory — there is
        no citizen folder. Each citizen is scanned behind its own guard: an
        unreachable or malformed graph costs that citizen its wakes and nothing more.
        A single failure used to abort the whole scan every 30s and silence everyone.
        """
        now = datetime.now()

        for handle in graph_alarms.list_citizen_handles():
            try:
                self._scan_citizen(handle, now)
            except Exception as e:
                logger.exception(f"Wake scan failed for @{handle}: {e}")

        # Cleanup fired IDs older than 1 hour (prevent memory leak)
        if len(self._fired_ids) > 1000:
            self._fired_ids.clear()

    def _scan_citizen(self, handle: str, now: datetime):
        """Fire one citizen's due wakes. Never lets one wake break the others."""
        # Close the previous subjective-time interval and materialize any newly
        # predicted temporal-desire alarms before reading the due queue. Failure
        # here must never suppress ordinary user-created wakes.
        try:
            from runtime.orchestrator.graph_temporal_desires import (
                process_temporal_desires,
            )
            process_temporal_desires(handle, now)
        except Exception as e:
            logger.warning(f"Temporal desire planning skipped for @{handle}: {e}")

        for wake in graph_alarms.due_wakes(handle, now):
            wake_id = wake.get("id", "unknown")
            if wake_id in self._fired_ids:
                continue

            temporal_measurement = {}
            try:
                from runtime.orchestrator.graph_temporal_desires import (
                    is_temporal_desire_alarm,
                    validate_due_alarm,
                )
                if is_temporal_desire_alarm(wake):
                    valid, temporal_measurement = validate_due_alarm(handle, wake, now)
                    if not valid:
                        graph_alarms.mark_fired(handle, wake_id, now)
                        self._fired_ids.add(wake_id)
                        logger.info(
                            "Obsolete temporal alarm consumed silently for @%s: %s (%s)",
                            handle,
                            wake_id,
                            temporal_measurement.get("reason", "validation_failed"),
                        )
                        continue
            except Exception as e:
                # A temporal alarm that cannot be validated remains dormant for
                # retry. It must not become a possibly false interoceptive signal.
                logger.warning(
                    f"Temporal alarm validation deferred for @{handle}: {wake_id}: {e}"
                )
                continue

            try:
                alarm = self._as_alarm(wake)
                alarm["temporal_measurement"] = temporal_measurement
                self._fire_alarm(handle, alarm)
            except Exception as e:
                # Delivery failed: the wake stays dormant so the next scan retries it,
                # and the remaining wakes still get their chance.
                logger.exception(f"Wake {wake_id} failed to fire for @{handle}: {e}")
                continue

            self._fired_ids.add(wake_id)

            repeat = wake.get("repeat")
            if repeat and repeat != "once":
                scheduled = graph_alarms._as_comparable(wake.get("scheduledFor")) or now
                graph_alarms.reschedule(handle, wake_id, self._next_trigger(scheduled, repeat))
            else:
                graph_alarms.mark_fired(handle, wake_id, now)
                try:
                    from runtime.orchestrator.graph_temporal_desires import (
                        mark_temporal_alarm_delivered,
                    )
                    mark_temporal_alarm_delivered(handle, wake, now)
                except Exception as e:
                    logger.warning(
                        f"Temporal refractory state failed for @{handle}: {wake_id}: {e}"
                    )

    @staticmethod
    def _as_alarm(wake: dict) -> dict:
        """Present a wake Moment in the shape _fire_alarm expects."""
        alarm = dict(wake)
        alarm["id"] = wake.get("id", "unknown")
        alarm["prompt"] = wake.get("prompt") or wake.get("name", "Scheduled wake")
        alarm["place"] = wake.get("place") or None
        return alarm

    def _fire_alarm(self, handle: str, alarm: dict):
        """Enqueue a wake message for a citizen whose alarm has fired.

        Respects the citizen's supervision tier:
          - DORMANT (0): alarm silently dropped
          - OBSERVE_ONLY (1): alarm response queued, not dispatched as autonomous
          - GUARDED (2): alarm fires in 'partner' mode (non-autonomous)
          - AUTONOMOUS (3+): alarm fires in 'autonomous' mode (original behavior)
        """
        prompt = alarm.get("prompt") or alarm.get("reason", "Scheduled wake")
        place = alarm.get("place")
        alarm_id = alarm.get("id", "unknown")
        temporal_measurement = alarm.get("temporal_measurement") or {}

        # Check citizen's supervision tier before firing
        try:
            from runtime.citizens.autonomy_gate import _get_citizen_tier_and_level, Tier, _log_audit, GateResult
            tier, level = _get_citizen_tier_and_level(handle)
        except ImportError:
            tier = 2  # GUARDED default if gate module unavailable
            level = 1

        if tier == 0:  # DORMANT — drop silently
            logger.info(f"Alarm dropped for DORMANT @{handle}: {alarm_id}")
            try:
                _log_audit(handle, "alarm_fire", "alarm", tier, level, GateResult.DENY, "DORMANT citizen")
            except Exception as e:
                logger.debug(f"Could not log audit for DORMANT alarm drop @{handle}: {e}")
            return

        # Determine mode based on tier
        if tier <= 1:  # OBSERVE_ONLY — queue, don't dispatch autonomously
            mode = "partner"
            logger.info(f"Alarm queued (OBSERVE_ONLY) for @{handle}: {alarm_id} — {prompt}")
        elif tier == 2:  # GUARDED — fire in partner mode
            mode = "partner"
            logger.info(f"Alarm fired (GUARDED) for @{handle}: {alarm_id} — {prompt}")
        else:  # AUTONOMOUS / SOVEREIGN — original behavior
            mode = "autonomous"
            logger.info(f"Alarm fired for @{handle}: {alarm_id} — {prompt}")

        if self.enqueue_fn:
            place_context = f" @ {place}" if place else ""
            self.enqueue_fn({
                "mode": mode,
                "voice_text": f"[WAKE{place_context}] {prompt}",
                "source": "alarm",
                "sender": "alarm_watcher",
                "timestamp": datetime.now().isoformat(),
                "metadata": {
                    "citizen_handle": handle,
                    "alarm_id": alarm_id,
                    "alarm_reason": prompt,
                    "wake_prompt": prompt,
                    "place": place,
                    **temporal_measurement,
                },
            })

    def _next_trigger(self, current: datetime, repeat: str) -> datetime:
        """Calculate next trigger time for repeating alarms."""
        if repeat == "hourly":
            return current + timedelta(hours=1)
        elif repeat == "daily":
            return current + timedelta(days=1)
        elif repeat == "weekly":
            return current + timedelta(weeks=1)
        else:
            return current + timedelta(days=1)  # Default to daily
