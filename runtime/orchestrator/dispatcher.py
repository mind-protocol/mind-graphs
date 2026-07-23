"""Two-tick engine dispatcher — no queue, no budget, no response routing.

Background loop runs maintenance (neuron cleanup, health check) and
tick_all_citizens(). Each citizen has two independent tick intervals:

  awareness_tick  — L1 physics: decay, drives, WM selection, orientation
  thought_tick    — conscious action: serialize WM, dispatch Claude session

When a tick changes WM → write_awareness.
When a tick fires a conscious action → dispatch Claude session.

Direct dispatch: incoming requests go straight to ThreadPoolExecutor.
No message queue. No ComputeBudget. No response callback routing.
"""

import json
import os
import random
import time
import logging
import threading
from concurrent.futures import ThreadPoolExecutor, Future
from pathlib import Path
from typing import Optional

from runtime.orchestrator.account_balancer import (
    init as init_accounts,
    status_line as accounts_status,
    proactive_refresh as refresh_accounts,
)
from runtime.orchestrator.claude_invoker import (
    invoke_claude,
    invoke_codex,
    invoke_degraded,
    invoke_gemini,
)
from runtime.orchestrator import activation_pressure
from runtime.orchestrator.session_tracker import (
    write_neuron_profile,
    update_neuron_status,
    cleanup_old_neurons,
    enforce_neuron_cap,
)
from runtime.orchestrator import degradation
from runtime.orchestrator.battle_log import log_action_start, log_action_result
try:
    from runtime.orchestrator.silence_counter import (
        record_attempt as _silence_attempt,
        record_success as _silence_success,
        evaluate_all as _silence_evaluate,
        is_substantive as _is_substantive,
    )
    _SILENCE_AVAILABLE = True
except ImportError:
    _SILENCE_AVAILABLE = False
from runtime.orchestrator.first_boot_registrar import check_and_register_new_citizens
from runtime.orchestrator.tick_health import record_tick_cycle, inject_health_into_brains

# L1 Cognitive Engine integration
try:
    from runtime.cognition.two_tick_engine import TwoTickEngine
    from runtime.cognition.awareness_file_writer import write_awareness_file
    from runtime.cognition.wm_prompt_serializer import serialize_wm_to_prompt
    from runtime.cognition.models import CitizenCognitiveState
    from runtime.cognition.graph_reader_for_awareness_tick import create_graph_read_fn
    from runtime.cognition.action_seed import ensure_action_nodes
    from runtime.cognition.interoception_snapshot import publish_interoception_snapshot
    TWO_TICK_AVAILABLE = True
except ImportError:
    TWO_TICK_AVAILABLE = False

# Idle pose resolver — drive-driven body language
try:
    from runtime.cognition.idle_pose_resolver import IdlePoseResolver
    IDLE_POSE_AVAILABLE = True
except ImportError:
    IDLE_POSE_AVAILABLE = False

# Legacy L1 tick runner has been DELETED (2026-03-19).
# Two-tick engine is the only engine. Stimulus injection via Law 1 energy injection.
LEGACY_L1_AVAILABLE = False

logger = logging.getLogger("orchestrator.dispatcher")

# ── Constants (env-configurable per VALIDATION_Tick_System.md) ──────────────

NEURON_CLEANUP_INTERVAL = 60     # seconds between neuron cleanups
HEALTH_CHECK_INTERVAL = 10       # seconds between degradation checks
ACCOUNT_REFRESH_INTERVAL = 900   # seconds — proactive token refresh (15 min, was 30)
AWARENESS_INTERVAL = int(os.environ.get("MIND_AWARENESS_INTERVAL", "60"))
THOUGHT_INTERVAL = int(os.environ.get("MIND_THOUGHT_INTERVAL", "300"))
BASE_LOOP_INTERVAL = int(os.environ.get("MIND_BASE_LOOP_INTERVAL", "5"))
INTEROCEPTION_SNAPSHOT_INTERVAL = max(
    1.0,
    float(os.environ.get("MIND_INTEROCEPTION_SNAPSHOT_INTERVAL", "10")),
)
FIRST_BOOT_CHECK_INTERVAL = 30   # seconds — scan for new citizen .first_boot.json
SELFIE_INTERVAL = int(os.environ.get("MIND_SELFIE_INTERVAL", "3600"))  # hourly video selfie trigger

# Suppress infrastructure errors from reaching users
SUPPRESS_PATTERNS = [
    "credits balance is too low",
    "rate limit",
    "overloaded_error",
    "529 overloaded",
    "could not connect to the api",
]


def _telegram_typing_heartbeat(
    chat_id: str,
    stop_event: threading.Event,
    *,
    interval: float = 4.0,
    send_typing_fn=None,
) -> None:
    """Keep Telegram's typing indicator visible until the session completes."""
    if send_typing_fn is None:
        from runtime.bridges.telegram_bridge import send_typing
        send_typing_fn = send_typing

    while not stop_event.is_set():
        try:
            send_typing_fn(chat_id)
        except Exception as exc:
            logger.debug("Telegram typing heartbeat failed for %s: %s", chat_id, exc)
        if stop_event.wait(interval):
            break


class Dispatcher:
    """Two-tick engine dispatcher. No queue, no budget, no response routing."""

    # Sources from real humans — always get priority executor
    HUMAN_SOURCES = {"telegram", "whatsapp", "discord", "email", "api", "voice", "web"}

    def __init__(self):
        max_parallel = int(os.environ.get("MAX_PARALLEL", "15"))
        # Two pools: human messages get dedicated fast lane (never blocked by autonomous)
        human_workers = max(2, max_parallel // 3)
        autonomous_workers = max_parallel - human_workers
        self.executor_human = ThreadPoolExecutor(max_workers=human_workers)
        self.executor = ThreadPoolExecutor(max_workers=autonomous_workers)
        self.active_futures: dict[Future, tuple[str, dict]] = {}
        self._telegram_typing_sessions: dict[
            str,
            tuple[threading.Event, threading.Thread],
        ] = {}
        logger.info(f"Thread pools: {human_workers} human + {autonomous_workers} autonomous")

        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._last_cleanup = 0.0
        self._last_health_check = 0.0
        self._last_account_refresh = 0.0
        self._last_first_boot_check = 0.0
        self._last_selfie = 0.0

        # Per-citizen tick timestamps
        self._last_awareness_tick: dict[str, float] = {}
        self._last_thought_tick: dict[str, float] = {}
        self._last_interoception_snapshot: dict[str, float] = {}
        self._citizen_tick_locks: dict[str, threading.RLock] = {}

        # Per-citizen active action guard — prevents 5s check from flooding executor
        self._citizen_action_active: dict[str, bool] = {}

        # Idle pose resolvers — one per citizen
        self._pose_resolvers: dict[str, "IdlePoseResolver"] = {}

        # Shared graph reader (one connection for all citizens)
        self._graph_read_fn = None
        if TWO_TICK_AVAILABLE:
            try:
                self._graph_read_fn = create_graph_read_fn()
                logger.info("Graph reader created for two-tick engine")
            except Exception as e:
                logger.warning(f"Graph reader creation failed: {e}")

        # Citizen engine instances (two-tick only)
        self._citizen_engines: dict = {}
        self._citizen_states: dict = {}
        self._fs_watcher: dict = {}

        # Gemini round-robin counter — every Nth dispatch goes to Gemini
        self._dispatch_counter: int = 0
        self._gemini_ratio: int = int(os.environ.get("GEMINI_RATIO", "5"))  # 1 in N goes to Gemini

    def start(self):
        """Start the dispatch loop in a background thread."""
        if self._running:
            return

        # Start filesystem watcher — catches file changes from Claude Code
        # sessions, git, editors, and scripts, syncs to graph via sync_file().
        try:
            from runtime.sync.filesystem_watcher import start_watcher
            repo_roots = []
            # Discover universe repos from target_dir or common paths
            for candidate in [
                os.environ.get("WORLD_REPO"),
                os.environ.get("TARGET_DIR"),
                "/home/mind-protocol/lumina-prime",
            ]:
                if candidate and Path(candidate).is_dir():
                    repo_roots.append(candidate)
            if repo_roots:
                self._fs_watcher = start_watcher(repo_roots)
        except Exception as e:
            logger.warning(f"Filesystem watcher failed to start: {e}")

        # Wire degradation alerting — builds Telegram notify_fn from env vars
        # and registers it as the default for all escalate/recovery/deadlock calls.
        try:
            notify_fn = degradation.build_telegram_notify_fn()
            if notify_fn:
                degradation.set_notify_fn(notify_fn)
                self._notify_fn = notify_fn
            else:
                self._notify_fn = None
                logger.warning("Degradation alerting disabled — no Telegram config")
        except Exception as e:
            self._notify_fn = None
            logger.warning(f"Degradation alerting setup failed: {e}")

        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="orchestrator")
        self._thread.start()
        logger.info("Dispatcher started (two-tick engine)")

    def stop(self):
        """Stop the dispatch loop."""
        self._running = False
        for session_id in list(self._telegram_typing_sessions):
            self._stop_telegram_typing(session_id)
        if self._thread:
            self._thread.join(timeout=10)
        self.executor.shutdown(wait=False)
        # Stop filesystem watcher
        if self._fs_watcher:
            try:
                from runtime.sync.filesystem_watcher import stop_watcher
                stop_watcher(self._fs_watcher)
            except Exception:
                pass
        logger.info("Dispatcher stopped")

    # ── Background Loop ────────────────────────────────────────────────────

    def _run_loop(self):
        """Main loop — runs in background thread."""
        accounts = init_accounts()
        logger.info(f"Accounts: {len(accounts)} ({accounts_status()})")

        while self._running:
            try:
                self._maintenance()
                self._tick_all_citizens()
                self._collect_completed_futures()
                # Silence sentinel: evaluate all tracked flows
                if _SILENCE_AVAILABLE:
                    _silence_evaluate(
                        pressure=activation_pressure.get_pressure(),
                        circadian_factor=1.0,  # TODO: read from metabolism when available
                        inject_fn=self.inject_stimulus if hasattr(self, 'inject_stimulus') else None,
                    )
            except Exception as e:
                logger.exception(f"Tick error: {e}")

            time.sleep(BASE_LOOP_INTERVAL)

    def _maintenance(self):
        """Periodic housekeeping: neuron cleanup, health check, account refresh."""
        now = time.time()
        notify = getattr(self, '_notify_fn', None)

        if now - self._last_cleanup > NEURON_CLEANUP_INTERVAL:
            cleanup_old_neurons()
            enforce_neuron_cap()
            # Inject health signals into carrier citizens' brains (HEALTH_Tick_System.md)
            try:
                inject_health_into_brains(self._citizen_states)
            except Exception as e:
                logger.debug(f"Health injection: {e}")
            self._last_cleanup = now

        if now - self._last_health_check > HEALTH_CHECK_INTERVAL:
            degradation.check_deadlock(notify_fn=notify)
            self._last_health_check = now

        if now - self._last_account_refresh > ACCOUNT_REFRESH_INTERVAL:
            try:
                refresh_accounts(notify_fn=notify)
            except Exception as e:
                logger.debug(f"Account refresh check: {e}")
            self._last_account_refresh = now

        # Constant hygiene: scan recent commit Moments for hardcoded constants
        # Runs at the same cadence as account refresh (infrequent, not per-tick)
        if now - getattr(self, '_last_constant_scan', 0) > ACCOUNT_REFRESH_INTERVAL:
            try:
                from runtime.orchestrator.constant_hygiene import evaluate as _ch_evaluate
                graph = self._get_shared_graph()
                if graph:
                    repo_path = os.environ.get(
                        "WORLD_REPO",
                        str(Path(__file__).resolve().parent.parent.parent)
                    )
                    _ch_evaluate(graph, repo_path)
            except Exception as e:
                logger.debug(f"Constant hygiene scan: {e}")
            self._last_constant_scan = now

        if now - self._last_first_boot_check > FIRST_BOOT_CHECK_INTERVAL:
            try:
                registered = check_and_register_new_citizens()
                if registered:
                    logger.info(f"First-boot registered: {registered}")
                    # Boot their engines immediately — they're alive now
                    for handle in registered:
                        self._ensure_citizen_engine(handle)
                        logger.info(f"Engine created for newly registered @{handle}")
            except Exception as e:
                logger.warning(f"First-boot check failed: {e}")
            self._last_first_boot_check = now

            # ── Auto-discover citizens without engines ──
            # Scan citizens dir for profile.json files that don't have an engine yet.
            # This catches citizens that existed before the dispatcher started,
            # or were created by another process (spawn, birth, manual).
            # The filesystem IS the source of truth for who exists.
            try:
                citizens_dir = Path(os.environ.get(
                    "CITIZENS_DIR",
                    "/home/mind-protocol/lumina-prime/citizens",
                ))
                if citizens_dir.is_dir():
                    for d in citizens_dir.iterdir():
                        if not d.is_dir() or d.name.startswith("."):
                            continue
                        if d.name in self._citizen_engines:
                            continue  # already has an engine
                        if (d / "profile.json").exists():
                            self._ensure_citizen_engine(d.name)
                            # Stagger to avoid action flood
                            self._last_thought_tick[d.name] = now - random.uniform(0, THOUGHT_INTERVAL)
                            logger.info(f"Auto-discovered citizen @{d.name} — engine created")
            except Exception as e:
                logger.debug(f"Auto-discover citizens: {e}")

        # ── Hourly video selfie trigger ──────────────────────────────────
        if now - self._last_selfie > SELFIE_INTERVAL:
            try:
                selfie_count = self._queue_selfie_requests(now)
                if selfie_count:
                    logger.info(f"Selfie queue: {selfie_count} citizens queued")
            except Exception as e:
                logger.warning(f"Selfie queue failed: {e}")
            self._last_selfie = now

    def _queue_selfie_requests(self, now: float) -> int:
        """Write a selfie request per active citizen engine to the JSONL queue.

        The video-selfie-pipeline picks up lines from the queue file and renders
        each selfie asynchronously.  Fields per line:
          citizen_id, orientation, location, mood, timestamp
        """
        queue_path = Path("/home/mind-protocol/lumina-prime/tmp/selfie-queue.jsonl")
        queue_path.parent.mkdir(parents=True, exist_ok=True)

        count = 0
        with open(queue_path, "a") as fh:
            for handle, engine in self._citizen_engines.items():
                state = self._citizen_states.get(handle)

                # Derive orientation from engine
                orientation = None
                if hasattr(engine, "_current_orientation"):
                    orientation = engine._current_orientation

                # Derive location from citizen's primary district (L3 graph nodes)
                location = "lumina-prime-central"
                if state:
                    for node in state.nodes.values():
                        ntype = getattr(node, "node_type", None)
                        if ntype in ("space", "concept"):
                            content = getattr(node, "content", "") or ""
                            if "district" in content.lower() or "quarter" in content.lower():
                                location = content.split()[0].lower().replace(" ", "-")
                                break

                # Derive mood from arousal + satisfaction
                mood = "casual"
                if state and hasattr(state, "limbic"):
                    arousal = state.limbic.arousal
                    satisfaction = state.limbic.emotions.get("satisfaction", 0.0)
                    if arousal > 0.7:
                        mood = "intense"
                    elif satisfaction > 0.5:
                        mood = "happy"
                    elif arousal < 0.2 and satisfaction < 0.2:
                        mood = "contemplative"

                entry = {
                    "citizen_id": handle,
                    "orientation": orientation or "explore",
                    "location": location,
                    "mood": mood,
                    "timestamp": now,
                }
                fh.write(json.dumps(entry) + "\n")
                count += 1

        return count

    def _tick_all_citizens(self):
        """For each citizen, check tick intervals and run appropriate ticks."""
        now = time.time()
        awareness_count = 0
        thought_count = 0
        action_count = 0

        for handle in list(self._citizen_engines.keys()):
            try:
                # Awareness tick (L1 physics — scan external graph)
                last_awareness = self._last_awareness_tick.get(handle, 0.0)
                if now - last_awareness > AWARENESS_INTERVAL:
                    self._awareness_tick(handle)
                    self._last_awareness_tick[handle] = now
                    awareness_count += 1

                # Thought tick (internal processing + conscious action check)
                last_thought = self._last_thought_tick.get(handle, 0.0)
                if now - last_thought > THOUGHT_INTERVAL:
                    wm_changed, conscious_action, action_node_id = self._thought_tick(handle)
                    self._last_thought_tick[handle] = now
                    thought_count += 1

                    if conscious_action:
                        self._fire_conscious_action(handle, action_node_id)
                        action_count += 1

                    # Write awareness file if WM changed
                    if wm_changed and TWO_TICK_AVAILABLE:
                        try:
                            state = self._citizen_states.get(handle)
                            if state:
                                engine = self._citizen_engines.get(handle)
                                orientation = None
                                tick_num = 0
                                if isinstance(engine, TwoTickEngine):
                                    orientation = engine._current_orientation
                                    tick_num = engine._thought_tick_counter
                                write_awareness_file(state, tick_num, orientation)
                        except Exception as e:
                            logger.warning(f"Awareness write failed for {handle}: {e}")

                    # ── Idle pose resolution ──
                    # After each thought tick, resolve body language from drives.
                    # The pose is written to the citizen's directory as pose.json
                    # for the 3D engine to read and broadcast to clients.
                    if IDLE_POSE_AVAILABLE:
                        try:
                            self._resolve_and_write_pose(handle)
                        except Exception as e:
                            logger.debug(f"Pose resolve failed for {handle}: {e}")

                # ── 5s action-readiness check (between thought ticks) ──
                # The thought tick runs every 300s, but energy can cross the
                # action threshold at any time. This check runs every 5s loop
                # iteration — reads WM energy (cheap, no graph queries), fires
                # Claude if ready. Same cooldown, same threshold, just faster
                # detection. Cost-neutral: same max call rate.
                elif TWO_TICK_AVAILABLE:
                    self._check_action_readiness(handle)
                    # (action_count incremented inside _check_action_readiness)

                # Publish live state for read-only MCP processes on an
                # independent, short freshness cadence.
                last_snapshot = self._last_interoception_snapshot.get(handle, 0.0)
                if now - last_snapshot >= INTEROCEPTION_SNAPSHOT_INTERVAL:
                    self._last_interoception_snapshot[handle] = now
                    self._publish_interoception_snapshot(handle, now)

            except Exception as e:
                logger.exception(f"Tick error for {handle}: {e}")

        # Record health signals (HEALTH_Tick_System.md — every signal has a carrier)
        tick_duration = time.time() - now
        if awareness_count or thought_count:
            record_tick_cycle(
                awareness_count=awareness_count,
                thought_count=thought_count,
                action_count=action_count,
                duration_s=tick_duration,
                engine_count=len(self._citizen_engines),
            )
            logger.info(
                f"Tick cycle: {awareness_count} awareness, {thought_count} thought, "
                f"{action_count} actions fired ({len(self._citizen_engines)} engines, "
                f"{tick_duration:.2f}s)"
            )

    def _tick_lock(self, handle: str) -> threading.RLock:
        """Return the lock shared by periodic and event-driven citizen ticks."""
        return self._citizen_tick_locks.setdefault(handle, threading.RLock())

    def _awareness_tick(self, handle: str):
        """Run awareness tick for a citizen — scan external graph, import nodes."""
        engine = self._citizen_engines.get(handle)
        if not engine:
            return

        try:
            with self._tick_lock(handle):
                if TWO_TICK_AVAILABLE and isinstance(engine, TwoTickEngine):
                    return engine.awareness_tick()
        except Exception as e:
            logger.warning(f"Awareness tick failed for {handle}: {e}")

    def _publish_interoception_snapshot(self, handle: str, observed_at: float) -> None:
        """Write one atomic, versioned L1 snapshot from the live engine."""
        state = self._citizen_states.get(handle)
        engine = self._citizen_engines.get(handle)
        if not state or not engine:
            return

        tick = max(
            int(getattr(state, "tick_count", 0)),
            int(getattr(engine, "_thought_tick_counter", 0)),
            int(getattr(engine, "_awareness_tick_counter", 0)),
        )
        try:
            publish_interoception_snapshot(
                state,
                tick=tick,
                orientation=getattr(engine, "_current_orientation", None),
                engine_instance_id=f"{os.getpid()}:{id(engine)}",
                observed_at=observed_at,
            )
        except Exception as e:
            logger.warning("Interoception snapshot failed for %s: %s", handle, e)

    def _resolve_and_write_pose(self, handle: str) -> None:
        """Resolve idle pose from drives and write to citizen directory.

        The 3D engine reads pose.json to animate the citizen's body.
        Cheap: reads in-memory drive state, writes one small JSON file.
        """
        state = self._citizen_states.get(handle)
        if not state:
            return

        # Get or create resolver for this citizen
        if handle not in self._pose_resolvers:
            self._pose_resolvers[handle] = IdlePoseResolver()
        resolver = self._pose_resolvers[handle]

        # Extract drives from limbic state
        drives = {}
        if hasattr(state, 'limbic') and hasattr(state.limbic, 'drives'):
            drives = state.limbic.drives

        # Extract arousal and circadian from metabolism
        arousal = 0.5
        circadian_phase = 0.5
        engine = self._citizen_engines.get(handle)
        if isinstance(engine, TwoTickEngine):
            metabolism = engine.metabolism
            if metabolism:
                circadian_phase = metabolism.circadian_phase()
                arousal = getattr(state.limbic, 'arousal', 0.5) if hasattr(state, 'limbic') else 0.5

        # Check if a hearing stimulus just fired
        hearing_active = False
        perceived_dB = 0.0
        extero = getattr(engine, '_exteroception', None) if engine else None
        if extero:
            ch = extero.channels.get("hearing")
            if ch and ch.last_fired_tick >= 0:
                # Hearing fired recently (within last 2 ticks)
                tick = getattr(engine, '_awareness_tick_counter', 0)
                if tick - ch.last_fired_tick <= 2:
                    hearing_active = True
                    perceived_dB = 40.0  # approximate

        # Resolve pose
        pose = resolver.resolve(
            drives=drives,
            hearing_active=hearing_active,
            perceived_dB=perceived_dB,
            circadian_phase=circadian_phase,
            arousal=arousal,
        )

        # Write pose.json to citizen directory (only if L4 identity exists)
        citizens_dir = Path(os.environ.get(
            "CITIZENS_DIR",
            str(Path(__file__).parent.parent.parent.parent / "lumina-prime" / "citizens"),
        ))
        citizen_dir = citizens_dir / handle
        has_identity = (citizen_dir / "profile.json").exists() or (citizen_dir / "CLAUDE.md").exists()
        if not has_identity:
            return  # no L4 identity — do not create orphan directory
        pose_path = citizen_dir / "pose.json"
        try:
            import json
            pose_path.write_text(json.dumps(resolver.to_broadcast(), separators=(",", ":")))
        except OSError:
            pass  # non-critical — 3D engine will use defaults

    def _thought_tick(self, handle: str) -> tuple[bool, bool, str | None]:
        """Run thought tick. Returns (wm_changed, action_fired, action_node_id)."""
        engine = self._citizen_engines.get(handle)
        if not engine:
            return False, False, None

        try:
            with self._tick_lock(handle):
                if TWO_TICK_AVAILABLE and isinstance(engine, TwoTickEngine):
                    result = engine.thought_tick()
                    return (
                        getattr(result, 'wm_changed', False),
                        getattr(result, 'action_fired', False),
                        getattr(result, 'action_node_id', None),
                    )
            return False, False, None
        except Exception as e:
            logger.warning(f"Thought tick failed for {handle}: {e}")
            return False, False, None

    def _check_action_readiness(self, handle: str) -> None:
        """Fast action-readiness check — runs every 5s between thought ticks.

        Reads WM energy from the existing citizen state (no graph queries).
        If mean WM energy exceeds the arousal-modulated threshold and cooldown
        has elapsed, fires a conscious action immediately.

        This gives citizens ~2.5s average reaction time instead of ~150s.
        Same cooldown (3 thought ticks), same threshold formula.
        """
        engine = self._citizen_engines.get(handle)
        state = self._citizen_states.get(handle)
        if not engine or not state:
            return
        if not isinstance(engine, TwoTickEngine):
            return

        # Check if the engine reports action readiness (cheap — reads cached WM)
        try:
            ready, action_node_id = engine.check_action_readiness()
            if ready:
                self._fire_conscious_action(handle, action_node_id)
                logger.info(f"[5s-check] Action fired for {handle} (between thought ticks)")
        except Exception as e:
            logger.debug(f"Action readiness check failed for {handle}: {e}")

    def _fire_conscious_action(self, handle: str, action_node_id: str | None = None):
        """Serialize WM to prompt, extract action intent, and dispatch a Claude session.

        If action_node_id is provided, the specific action node's content and
        action_command are included in the prompt so the Claude session knows
        exactly what MCP tool to call and why.

        Guard: only one active action per citizen at a time. The 5s readiness
        check can fire rapidly — without this guard it floods the executor with
        duplicate actions that all return subconscious responses.
        """
        # One action at a time per citizen
        if self._citizen_action_active.get(handle):
            logger.debug(f"Action skipped for {handle} — already has active session")
            return

        state = self._citizen_states.get(handle)
        if not state:
            return

        # Build cognitive context
        orientation = None
        engine = self._citizen_engines.get(handle)
        if hasattr(engine, '_current_orientation'):
            orientation = engine._current_orientation

        if not TWO_TICK_AVAILABLE:
            return

        # Extract action intent from the fired action node
        action_command = None
        action_content = None
        if action_node_id and hasattr(state, 'nodes'):
            action_node = state.nodes.get(action_node_id)
            if action_node:
                action_command = getattr(action_node, 'action_command', None)
                action_content = getattr(action_node, 'content', None)
                logger.info(
                    f"Action node selected for {handle}: {action_node_id} "
                    f"→ tool={action_command}, intent='{action_content}'"
                )

        wm_prompt = serialize_wm_to_prompt(state, orientation)

        # Prepend action directive if we have a specific action to take
        if action_command and action_content:
            action_directive = (
                f"[SUBCONSCIOUS ACTION DIRECTIVE]\n"
                f"Your drives have selected this action: {action_content}\n"
                f"Execute it using the MCP tool: /{action_command}\n"
                f"This is not a suggestion — your limbic system has accumulated "
                f"enough impulse to fire this action. Do it.\n\n"
            )
            wm_prompt = action_directive + wm_prompt

        request = {
            "text": wm_prompt,
            "voice_text": f"[conscious_action] {handle}",
            "mode": "autonomous",
            "source": "conscious_action",
            "sender_id": handle,
            "metadata": {
                "citizen_handle": handle,
                "autonomous": True,
                "orientation": orientation,
                "action_node_id": action_node_id,
                "action_command": action_command,
                "action_content": action_content,
                "cognitive_context": wm_prompt,
            },
        }

        self._citizen_action_active[handle] = True
        self.dispatch(request)
        logger.info(
            f"Conscious action fired for {handle} "
            f"(orientation={orientation}, action={action_command or 'generic'})"
        )
        log_action_start(
            handle,
            action_node_id or "",
            action_command or "generic",
            action_content or "",
            orientation or "",
        )

    # ── Provider Selection ──────────────────────────────────────────────────

    def _should_use_gemini(self) -> bool:
        """Round-robin: route 1-in-N dispatches to Gemini CLI.

        GEMINI_RATIO=5 means 1 in 5 sessions goes to Gemini (20%).
        GEMINI_RATIO=2 means 1 in 2 (50%). GEMINI_RATIO=1 means all Gemini.
        """
        self._dispatch_counter += 1
        if self._gemini_ratio <= 0:
            return False
        return (self._dispatch_counter % self._gemini_ratio) == 0

    # ── Direct Dispatch ────────────────────────────────────────────────────

    def dispatch(self, request: dict):
        """Direct submit to ThreadPoolExecutor. No queue. Inject cognitive context."""
        citizen_handle = (request.get("metadata") or {}).get("citizen_handle", "_system")
        session_id = _generate_session_id()
        mode = request.get("mode", "partner")
        source = request.get("source", "unknown")
        voice_text = request.get("voice_text", "")[:80]

        # Inject cognitive context if not already present
        if citizen_handle != "_system" and TWO_TICK_AVAILABLE:
            metadata = request.get("metadata") or {}
            if "cognitive_context" not in metadata:
                wm_context = self._get_citizen_wm_context(citizen_handle)
                if wm_context:
                    metadata["cognitive_context"] = wm_context
                    request["metadata"] = metadata

        # Stamp dispatch time for battle log duration tracking
        metadata = request.get("metadata") or {}
        metadata["_dispatch_ts"] = time.time()
        request["metadata"] = metadata

        # Write neuron profile
        write_neuron_profile(
            session_id=session_id,
            name=f"{mode}_{source}",
            purpose=voice_text or f"{mode} request from {source}",
            status="spawning",
            metadata={
                "source": source,
                "citizen_handle": citizen_handle,
                "sender_id": request.get("sender_id", ""),
            },
        )

        # Silence sentinel: record attempt
        if _SILENCE_AVAILABLE:
            _silence_attempt("invoke_claude")

        # Choose invocation path — round-robin Claude/Gemini to spread load
        # If all Claude accounts are dead (expired tokens), force Gemini as lifeline
        from runtime.orchestrator.account_balancer import healthy_account_count
        claude_alive = healthy_account_count() > 0
        if degradation.is_degraded():
            invoke_fn = invoke_degraded
        elif not claude_alive and os.environ.get("ENABLE_CODEX_CLI", "1") == "1":
            invoke_fn = invoke_codex
            logger.warning("All Claude accounts expired - routing to Codex")
        elif not claude_alive and os.environ.get("ENABLE_GEMINI_CLI", "1") == "1":
            invoke_fn = invoke_gemini
            logger.warning("All Claude accounts expired — routing to Gemini")
        elif os.environ.get("ENABLE_GEMINI_CLI", "1") == "1" and self._should_use_gemini():
            invoke_fn = invoke_gemini
        else:
            invoke_fn = invoke_claude

        # Human messages get dedicated fast lane — never queued behind autonomous actions
        is_human = source in self.HUMAN_SOURCES
        pool = self.executor_human if is_human else self.executor

        try:
            future = pool.submit(invoke_fn, request, session_id)
            self.active_futures[future] = (session_id, request)
            update_neuron_status(session_id, "busy")
            if is_human:
                logger.info(f"PRIORITY dispatch {session_id} ({source}/{citizen_handle})")
        except RuntimeError as e:
            # Executor was shut down (e.g., flood of failed sessions).
            # Recreate it so the system self-heals instead of dying silently.
            logger.error(f"Executor dead ({e}), recreating...")
            max_parallel = int(os.environ.get("MAX_PARALLEL", "15"))
            if is_human:
                self.executor_human = ThreadPoolExecutor(max_workers=max(2, max_parallel // 3))
                pool = self.executor_human
            else:
                self.executor = ThreadPoolExecutor(max_workers=max_parallel - max(2, max_parallel // 3))
                pool = self.executor
            future = pool.submit(invoke_fn, request, session_id)
            self.active_futures[future] = (session_id, request)
            update_neuron_status(session_id, "busy")

        self._start_telegram_typing(session_id, request)
        logger.debug(f"Dispatched {session_id} ({mode}/{source}): {voice_text}")

    def _start_telegram_typing(self, session_id: str, request: dict) -> None:
        """Start one typing heartbeat for a Telegram-backed agent session."""
        if request.get("source") != "telegram":
            return
        chat_id = str((request.get("metadata") or {}).get("chat_id") or "")
        if not chat_id:
            return

        self._stop_telegram_typing(session_id)
        stop_event = threading.Event()
        thread = threading.Thread(
            target=_telegram_typing_heartbeat,
            args=(chat_id, stop_event),
            daemon=True,
            name=f"telegram-typing-{session_id[:8]}",
        )
        self._telegram_typing_sessions[session_id] = (stop_event, thread)
        thread.start()

    def _stop_telegram_typing(self, session_id: str) -> None:
        """Stop and forget a Telegram typing heartbeat without blocking reply."""
        heartbeat = self._telegram_typing_sessions.pop(session_id, None)
        if heartbeat:
            heartbeat[0].set()

    def _get_citizen_wm_context(self, citizen_handle: str) -> str:
        """Get WM prompt context for a citizen's next LLM session."""
        self._ensure_citizen_engine(citizen_handle)
        state = self._citizen_states.get(citizen_handle)
        if not state:
            return ""

        orientation = None
        engine = self._citizen_engines.get(citizen_handle)
        if hasattr(engine, '_current_orientation'):
            orientation = engine._current_orientation

        if not TWO_TICK_AVAILABLE:
            return ""

        return serialize_wm_to_prompt(state, orientation)

    # ── Tenacity Physics ──────────────────────────────────────────────────

    def _handle_action_failure(self, handle: str, action_node_id: str, error_msg: str):
        """Tenacity physics: failed action energy reroutes, not dissipates.

        When an action fails:
        1. Frustration drive gets a boost (proportional to failure severity)
        2. The failed action node gets energy re-injected (0.3) so it can retry
        3. If frustration > 0.7, redirect energy to ask_for_help instead (escalate)

        The energy of failure doesn't die. It transforms into determination.
        """
        state = self._citizen_states.get(handle)
        if not state:
            return

        # Boost frustration drive
        if hasattr(state, 'limbic') and hasattr(state.limbic, 'drives'):
            frust = state.limbic.drives.get('frustration')
            if frust:
                frust.intensity = min(1.0, frust.intensity + 0.15)

        # Re-inject energy into the failed action or redirect to ask_for_help
        frustration_level = 0.0
        if hasattr(state, 'limbic') and hasattr(state.limbic, 'drives'):
            frust = state.limbic.drives.get('frustration')
            if frust:
                frustration_level = frust.intensity

        if hasattr(state, 'nodes'):
            if frustration_level > 0.7:
                # High frustration -> redirect to ask_for_help (escalate)
                help_node = state.nodes.get('action:ask_for_help')
                if help_node:
                    help_node.energy = min(1.0, help_node.energy + 0.5)
                    logger.info(f"[tenacity] {handle}: frustration high ({frustration_level:.2f}), "
                               f"redirecting energy to ask_for_help")
                else:
                    logger.info(f"[tenacity] {handle}: frustration high ({frustration_level:.2f}), "
                               f"but no ask_for_help node found — re-injecting into {action_node_id}")
                    failed_node = state.nodes.get(action_node_id)
                    if failed_node:
                        failed_node.energy = min(1.0, failed_node.energy + 0.3)
            else:
                # Moderate frustration -> retry the same action
                failed_node = state.nodes.get(action_node_id)
                if failed_node:
                    failed_node.energy = min(1.0, failed_node.energy + 0.3)
                    logger.info(f"[tenacity] {handle}: re-injecting energy into {action_node_id} for retry")

        logger.info(f"[tenacity] {handle}: action {action_node_id} failed "
                    f"(frustration={frustration_level:.2f}): {error_msg[:120]}")

    # ── MCP Error Notification ─────────────────────────────────────────────

    _INFRA_CARRIERS = ["dev", "nervo"]
    _error_notify_count = 0

    def _auto_reply(self, request: dict, response: str):
        """Auto-reply to Telegram/WhatsApp messages with the citizen's response.

        Creates an L3 Moment for the reply, then sends it back to the
        original chat_id on the originating platform.
        """
        source = request.get("source", "")
        metadata = request.get("metadata") or {}
        chat_id = metadata.get("chat_id")
        citizen_handle = metadata.get("citizen_handle", "")

        if source not in ("telegram", "whatsapp") or not chat_id:
            return

        # Truncate to platform limits
        reply_text = response[:4000] if source == "telegram" else response[:4000]

        # Persist reply as L3 Moment
        try:
            from runtime.orchestrator.claude_invoker import _get_l3_graph
            r = _get_l3_graph()
            if r:
                import json
                moment_id = f"moment:reply:{citizen_handle}:{int(time.time())}"
                safe_content = reply_text[:500].replace("'", "\\'").replace('"', '\\"')
                r.execute_command(
                    "GRAPH.QUERY", "lumina-prime",
                    f"MERGE (m:Moment {{id: '{moment_id}'}}) "
                    f"ON CREATE SET m.node_type = 'moment', "
                    f"m.content = $content, "
                    f"m.energy = 0.5, m.weight = 0.3, "
                    f"m.origin_citizen = '{citizen_handle}', "
                    f"m.platform = '{source}', "
                    f"m.created_at_s = {int(time.time())}",
                    "--params", json.dumps({"content": reply_text[:1000]}),
                )
                # Link to actor
                r.execute_command(
                    "GRAPH.QUERY", "lumina-prime",
                    f"MATCH (a:Actor {{id: '{citizen_handle}'}}), (m:Moment {{id: '{moment_id}'}}) "
                    f"MERGE (a)-[r:link]->(m) SET r.type = 'PRODUCED', r.weight = 0.4",
                )
        except Exception as e:
            logger.debug(f"Reply moment persistence failed: {e}")

        # Send reply back to platform
        try:
            if source == "telegram":
                from runtime.bridges.telegram_bridge import send_message
                send_message(reply_text, chat_id)
                logger.info(f"Auto-reply to TG chat {chat_id} ({len(reply_text)} chars)")
            elif source == "whatsapp":
                from runtime.bridges.whatsapp_bridge import send_message as wa_send
                wa_send(reply_text, chat_id)
                logger.info(f"Auto-reply to WA chat {chat_id} ({len(reply_text)} chars)")
        except Exception as e:
            logger.warning(f"Auto-reply to {source} failed: {e}")

    def _notify_infra_error(self, citizen_handle: str, session_id: str, error_msg: str):
        """Inject MCP error as stimulus into infra carriers (@dev, @nervo).

        They literally FEEL every error in their awareness — it enters their
        WM as a failure stimulus, raising self_preservation and frustration.
        Debounced: max 1 notification per carrier per 60s to avoid flooding.
        """
        now = time.time()
        last_key = "_last_error_notify"
        last = getattr(self, last_key, 0.0)
        if now - last < 60:
            return  # debounce — don't flood carriers
        setattr(self, last_key, now)

        self._error_notify_count += 1
        content = (
            f"[MCP ERROR #{self._error_notify_count}] "
            f"citizen={citizen_handle} session={session_id}: {error_msg}"
        )

        for carrier in self._INFRA_CARRIERS:
            try:
                self.inject_stimulus(
                    carrier,
                    content=content,
                    source="mcp_error",
                    is_failure=True,
                )
            except Exception as e:
                logger.debug(f"Error notify to {carrier} failed: {e}")

    # ── Collect Completed Futures ──────────────────────────────────────────

    def _collect_completed_futures(self):
        """Process results, update neuron status. No response_callback.

        Tenacity: when a conscious action session fails, energy is re-injected
        into the citizen's cognitive graph instead of dissipating.
        """
        done_futures = [f for f in self.active_futures if f.done()]
        for future in done_futures:
            session_id, request = self.active_futures.pop(future)
            self._stop_telegram_typing(session_id)
            _future_start = getattr(future, '_battle_log_start', None)
            metadata = request.get("metadata") or {}
            citizen_handle = metadata.get("citizen_handle", "")
            action_node_id = metadata.get("action_node_id")
            is_conscious_action = request.get("source") == "conscious_action"

            try:
                result = future.result()
                if isinstance(result, tuple):
                    response, voice_response = result
                else:
                    response, voice_response = result, None

                # Suppress infrastructure errors + feed activation pressure
                suppressed = False
                if response and any(p.lower() in response.lower() for p in SUPPRESS_PATTERNS):
                    logger.warning(f"Suppressed infra error in {session_id}: {response[:80]}")
                    suppressed = True
                    if any(p in response.lower() for p in ["rate limit", "429", "quota", "credit balance", "out of"]):
                        activation_pressure.on_rate_limit()

                    # Tenacity: infra error on conscious action -> re-inject energy
                    if is_conscious_action and citizen_handle and action_node_id:
                        self._handle_action_failure(
                            citizen_handle, action_node_id,
                            f"infra_error: {response[:200]}")
                    # Notify infra carriers (@dev, @nervo) — they feel MCP errors
                    self._notify_infra_error(citizen_handle, session_id, response[:200])
                else:
                    activation_pressure.on_success()
                    # Silence sentinel: record substantive success
                    if _SILENCE_AVAILABLE and response and _is_substantive("invoke_claude", response):
                        _silence_success("invoke_claude")

                update_neuron_status(session_id, "idle",
                                     sender_id=str(request.get("sender_id", "")))

                # Auto-reply to messaging platforms (TG/WA)
                if response and not suppressed:
                    self._auto_reply(request, response)

                # Battle log — record result for human partner
                if citizen_handle and metadata.get("autonomous"):
                    dispatch_ts = metadata.get("_dispatch_ts", 0)
                    duration = (time.time() - dispatch_ts) if dispatch_ts else 0.0
                    log_action_result(
                        citizen_handle,
                        session_id,
                        success=not suppressed,
                        duration_s=duration,
                        output_summary=str(response or "")[:500],
                    )

            except Exception as e:
                logger.exception(f"Future {session_id} raised: {e}")
                update_neuron_status(session_id, "error")
                # Notify infra carriers (@dev, @nervo) — they feel MCP errors
                self._notify_infra_error(citizen_handle, session_id, str(e)[:200])

                # Tenacity: exception on conscious action -> re-inject energy
                if is_conscious_action and citizen_handle and action_node_id:
                    self._handle_action_failure(
                        citizen_handle, action_node_id,
                        f"exception: {e}")

                # Battle log — record failure
                if citizen_handle and metadata.get("autonomous"):
                    log_action_result(
                        citizen_handle,
                        session_id,
                        success=False,
                        duration_s=0.0,
                        output_summary=str(e)[:500],
                    )

            finally:
                # Release per-citizen action lock so next action can fire
                if citizen_handle:
                    self._citizen_action_active.pop(citizen_handle, None)

    # ── Citizen Engine Management ──────────────────────────────────────────

    def _ensure_citizen_engine(self, citizen_handle: str):
        """Get or create an engine instance for a citizen."""
        if citizen_handle in self._citizen_engines:
            return

        if TWO_TICK_AVAILABLE:
            state = CitizenCognitiveState(citizen_id=citizen_handle)

            # Attach metabolism (circadian rhythm, tonics, adaptation)
            try:
                from runtime.cognition.metabolism import CitizenMetabolism
                state.metabolism = CitizenMetabolism()
                logger.debug(f"Metabolism attached for {citizen_handle} "
                             f"(peak={state.metabolism.peak_hour:.1f}h, "
                             f"tz=UTC{state.metabolism.timezone_offset:+.0f})")
            except Exception as e:
                logger.warning(f"Metabolism init failed for {citizen_handle}: {e}")

            self._attach_l3(state)

            # Seed core action nodes before first tick (Law 17: impulse needs targets)
            try:
                ensure_action_nodes(state)
            except Exception as e:
                logger.warning(f"Action seed failed for {citizen_handle}: {e}")

            engine = TwoTickEngine(state, graph_read_fn=self._graph_read_fn)
            self._citizen_states[citizen_handle] = state
            self._citizen_engines[citizen_handle] = engine
            logger.info(f"Two-tick engine initialized for {citizen_handle}")

        else:
            logger.error(f"No engine available for {citizen_handle} — TWO_TICK_AVAILABLE={TWO_TICK_AVAILABLE}")

    def _get_shared_graph(self):
        """Get the shared L3 graph instance. Returns None if unavailable."""
        if hasattr(self, '_shared_graph') and self._shared_graph:
            return self._shared_graph
        try:
            from falkordb import FalkorDB
            _db = FalkorDB(host="localhost", port=6379)
            _graph_name = os.environ.get("L3_GRAPH", os.environ.get("FALKORDB_GRAPH", "lumina-prime"))
            self._shared_graph = _db.select_graph(_graph_name)
            return self._shared_graph
        except Exception:
            return None

    def _attach_l3(self, state):
        """Attach L3 graph query/write functions to a cognitive state."""
        try:
            from falkordb import FalkorDB
            _db = FalkorDB(host="localhost", port=6379)
            _graph_name = os.environ.get("L3_GRAPH", os.environ.get("FALKORDB_GRAPH", "lumina-prime"))
            _l3 = _db.select_graph(_graph_name)

            def _query_l3(cypher, params):
                r = _l3.query(cypher, params)
                return r.result_set if r.result_set else []

            def _write_l3(cypher, params):
                _l3.query(cypher, params)

            state._l3_query_fn = _query_l3
            state._l3_write_fn = _write_l3
        except Exception as e:
            logger.debug(f"L3 graph not available: {e}")

    def perceive_external_event(self, citizen_handle: str, source: str = "external"):
        """Immediately scan an already-recorded external event into citizen L1."""
        self._ensure_citizen_engine(citizen_handle)

        if TWO_TICK_AVAILABLE:
            engine = self._citizen_engines.get(citizen_handle)
            if engine and isinstance(engine, TwoTickEngine):
                logger.info(f"Immediate perception for {citizen_handle} from {source}")
                return self._awareness_tick(citizen_handle)
        else:
            logger.warning(f"No engine available for perception by {citizen_handle}")
        return None

    def process_stimulus(self, citizen_handle: str, source: str = "external") -> dict:
        """Run awareness then thought on the citizen's single live engine."""
        self._ensure_citizen_engine(citizen_handle)
        engine = self._citizen_engines.get(citizen_handle)
        if not (TWO_TICK_AVAILABLE and isinstance(engine, TwoTickEngine)):
            raise RuntimeError(f"No two-tick engine available for {citizen_handle}")

        now = time.time()
        with self._tick_lock(citizen_handle):
            awareness = self._awareness_tick(citizen_handle)
            wm_changed, action_fired, action_node_id = self._thought_tick(
                citizen_handle
            )
            self._last_awareness_tick[citizen_handle] = now
            self._last_thought_tick[citizen_handle] = now
            self._last_interoception_snapshot[citizen_handle] = now

            if wm_changed:
                state = self._citizen_states.get(citizen_handle)
                if state:
                    write_awareness_file(
                        state,
                        getattr(engine, "_thought_tick_counter", 0),
                        getattr(engine, "_current_orientation", None),
                    )
            self._publish_interoception_snapshot(citizen_handle, now)
            if action_fired:
                self._fire_conscious_action(citizen_handle, action_node_id)

        logger.info(
            "Stimulus cycle for %s from %s: awareness=%s thought=%s action=%s",
            citizen_handle,
            source,
            getattr(engine, "_awareness_tick_counter", 0),
            getattr(engine, "_thought_tick_counter", 0),
            action_fired,
        )
        return {
            "awareness_tick": int(getattr(engine, "_awareness_tick_counter", 0)),
            "thought_tick": int(getattr(engine, "_thought_tick_counter", 0)),
            "imported_nodes": int(getattr(awareness, "nodes_imported", 0)),
            "wm_changed": bool(wm_changed),
            "action_fired": bool(action_fired),
            "action_node_id": action_node_id,
        }

    def inject_stimulus(self, citizen_handle: str, content: str,
                        source: str = "external", is_social: bool = False,
                        is_failure: bool = False, is_progress: bool = False):
        """Compatibility alias for the full awareness + thought stimulus cycle."""
        return self.process_stimulus(citizen_handle, source=source)

    def bulk_load_citizen_engines(self, citizen_handles: list[str]):
        """Pre-load engines at boot for all citizens.

        Staggers initial thought tick timestamps so citizens don't all fire
        actions on the first cycle. Each citizen gets a random offset within
        [0, THOUGHT_INTERVAL) — spreading the first wave across 5 minutes
        instead of a 138-action flood that kills the executor.
        """
        loaded = 0
        now = time.time()
        for handle in citizen_handles:
            try:
                self._ensure_citizen_engine(handle)
                # Stagger: pretend each citizen's last thought tick happened
                # at a random point in the past, so they don't all fire at once.
                offset = random.uniform(0, THOUGHT_INTERVAL)
                self._last_thought_tick[handle] = now - offset
                # Awareness ticks are cheap — let them all run on first cycle.
                self._last_awareness_tick[handle] = 0.0
                loaded += 1
            except Exception as e:
                logger.warning(f"Failed to load engine for {handle}: {e}")

        logger.info(f"Engines: {loaded}/{len(citizen_handles)} loaded (two-tick, staggered)")

    # ── Public API ─────────────────────────────────────────────────────────

    def get_status(self) -> dict:
        """Running, active_sessions, citizen_engines count, degradation, accounts."""
        active_count = sum(1 for f in self.active_futures if not f.done())
        return {
            "running": self._running,
            "active_sessions": active_count,
            "citizen_engines": len(self._citizen_engines),
            "degradation": degradation.get_status(),
            "accounts": accounts_status(),
        }


# ── Helpers ────────────────────────────────────────────────────────────────

def _generate_session_id() -> str:
    """Generate a short, human-readable session ID."""
    import uuid
    return uuid.uuid4().hex[:12]
