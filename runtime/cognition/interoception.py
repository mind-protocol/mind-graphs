"""
Interoception — Internal State Awareness

DOCS: docs/cognition/interoception/ALGORITHM_Interoception.md

Transforms internal STATE into SENSATION. The bridge from reactive to reflective.
Today: frustration=0.8 is a float that modulates laws.
With interoception: "I feel frustrated" is a stimulus that enters WM as a thought.

Runs once per tick, between _step_limbic() and _step_orient().
Reads: CitizenCognitiveState, LimbicState, CitizenMetabolism, WorkingMemory.
Writes: list[Stimulus] injected via Law 1.

11 sense channels across 3 layers:
  Somatic: energy, time, circadian, wm_load, drive_dominance, social, brain_health, metabolic
  Metacognitive: zone_awareness, emotional_perception
  Substrate: context_window

Co-Authored-By: Tomaso Nervo (@nervo) <nervo@mindprotocol.ai>
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional

from .tick_runner_l1_cognitive_engine import Stimulus
from .models import CitizenCognitiveState, NodeType


# =========================================================================
# Constants
# =========================================================================

MAX_STIMULI_PER_TICK = 3
INTERO_SOURCE = "interoception"

# Zone mapping: node_type → brain zone
ZONE_MAP = {
    "process": "stem", "state": "stem",
    "desire": "limbic", "narrative": "limbic", "memory": "limbic",
    "concept": "cortex", "value": "cortex",
}


# =========================================================================
# Channel definitions
# =========================================================================

@dataclass
class Channel:
    """A single interoceptive sense channel."""
    name: str
    priority: int              # higher = fires first
    refractory_ticks: int      # min ticks between firings
    last_fired_tick: int = -999
    is_armed: bool = True

    def can_fire(self, tick: int) -> bool:
        return self.is_armed and (tick - self.last_fired_tick >= self.refractory_ticks)

    def fire(self, tick: int):
        self.is_armed = False
        self.last_fired_tick = tick

    def try_rearm(self, tick: int, condition_resolved: bool):
        if not self.is_armed and (tick - self.last_fired_tick >= self.refractory_ticks):
            if condition_resolved:
                self.is_armed = True


# =========================================================================
# InteroceptionEngine
# =========================================================================

class InteroceptionEngine:
    """Generates stimuli from internal state readings.

    Attach to CitizenCognitiveState and call tick() from the tick runner.
    """

    def __init__(self):
        self.channels: dict[str, Channel] = {
            # Somatic layer
            "energy_low":        Channel("energy_low",        priority=90, refractory_ticks=50),
            "awake_long":        Channel("awake_long",        priority=30, refractory_ticks=100),
            "circadian_trough":  Channel("circadian_trough",  priority=40, refractory_ticks=60),
            "wm_full":           Channel("wm_full",           priority=70, refractory_ticks=30),
            "wm_empty":          Channel("wm_empty",          priority=20, refractory_ticks=50),
            "drive_dominant":    Channel("drive_dominant",     priority=35, refractory_ticks=40),
            "social_isolated":   Channel("social_isolated",   priority=45, refractory_ticks=80),
            "brain_shrinking":   Channel("brain_shrinking",   priority=25, refractory_ticks=100),
            "brain_growing":     Channel("brain_growing",     priority=15, refractory_ticks=100),
            "metabolic_shift":   Channel("metabolic_shift",   priority=20, refractory_ticks=60),
            # Metacognitive layer
            "zone_shift":        Channel("zone_shift",        priority=50, refractory_ticks=40),
            "emotion_rising":    Channel("emotion_rising",    priority=80, refractory_ticks=20),
            "emotion_spike":     Channel("emotion_spike",     priority=85, refractory_ticks=10),
            "emotion_relief":    Channel("emotion_relief",    priority=10, refractory_ticks=30),
            # Substrate layer
            "context_pressure":  Channel("context_pressure",  priority=75, refractory_ticks=30),
            "context_critical":  Channel("context_critical",  priority=95, refractory_ticks=10),
        }

        # Snapshot state for trend detection
        self._prev_drives: dict[str, float] = {}
        self._prev_emotions: dict[str, float] = {}
        self._prev_zone_energies: dict[str, float] = {}
        self._node_count_history: list[int] = []
        self._energy_history: list[float] = []
        self._prev_tonic_names: list[str] = []
        self._wake_tick: int = 0

    def tick(
        self,
        state: CitizenCognitiveState,
        metabolism: Optional[object] = None,
        context_usage: Optional[float] = None,
    ) -> list[Stimulus]:
        """Run one interoception tick. Returns stimuli to inject via Law 1.

        Args:
            state: the citizen's cognitive state (read-only — never mutated)
            metabolism: CitizenMetabolism if available
            context_usage: estimated context window fullness [0.0, 1.0] or None
        """
        tick = state.tick_count
        stimuli: list[Stimulus] = []

        # ── Step 1: Capture current state ──
        active_nodes = sum(1 for n in state.nodes.values() if n.energy > 0.1)
        total_nodes = len(state.nodes)
        total_energy = sum(n.energy for n in state.nodes.values())
        wm_size = len(state.wm.node_ids)

        current_drives = {name: d.intensity for name, d in state.limbic.drives.items()}
        current_emotions = dict(state.limbic.emotions)

        # Zone awareness
        zone_energies = {"stem": 0.0, "limbic": 0.0, "cortex": 0.0}
        for node in state.nodes.values():
            zone = ZONE_MAP.get(node.node_type.value if isinstance(node.node_type, NodeType) else str(node.node_type), "cortex")
            zone_energies[zone] += node.energy

        # Circadian
        circadian_phase = None
        active_tonics = []
        if metabolism is not None:
            circadian_phase = metabolism.circadian_phase()
            active_tonics = [t.name for t in metabolism.active_tonics]

        # Trend tracking
        self._energy_history.append(total_energy)
        if len(self._energy_history) > 10:
            self._energy_history = self._energy_history[-10:]
        self._node_count_history.append(total_nodes)
        if len(self._node_count_history) > 100:
            self._node_count_history = self._node_count_history[-100:]

        # ── Step 2: Evaluate channels (priority order) ──
        candidates: list[tuple[int, str, str, float]] = []  # (priority, name, content, energy)

        # --- Somatic channels ---

        # Energy low
        if total_nodes > 0 and active_nodes / total_nodes < 0.1:
            candidates.append((90, "energy_low", "My mind feels very quiet — almost nothing is active", 0.3))

        # Awake long
        awake = tick - self._wake_tick
        if awake > 500:
            candidates.append((30, "awake_long", "I've been awake a long time. I could use rest.", 0.2))

        # Circadian trough
        if circadian_phase is not None and circadian_phase < 0.2:
            candidates.append((40, "circadian_trough", "I feel drowsy — it's deep in my rest phase", 0.2))

        # WM full
        if wm_size >= 7:
            candidates.append((70, "wm_full", "My mind is full — I'm holding too many thoughts at once", 0.3))

        # WM empty
        if wm_size <= 1 and total_nodes > 10:
            candidates.append((20, "wm_empty", "My mind is unusually empty — nothing demands attention", 0.15))

        # Drive dominance
        if current_drives:
            max_drive = max(current_drives, key=current_drives.get)
            max_val = current_drives[max_drive]
            if max_val > 0.7:
                drive_names = {
                    "curiosity": "deeply curious",
                    "frustration": "frustrated",
                    "achievement": "driven to achieve",
                    "care": "caring strongly",
                    "affiliation": "craving connection",
                    "self_preservation": "cautious and guarded",
                    "novelty_hunger": "hungry for something new",
                    "rest_regulation": "needing rest",
                }
                feeling = drive_names.get(max_drive, max_drive)
                candidates.append((35, "drive_dominant", f"I feel {feeling}", 0.2))

        # Social isolation
        if state.limbic.ticks_since_social > 100:
            candidates.append((45, "social_isolated", "Nobody has talked to me in a while. I feel alone.", 0.25))

        # Brain health
        if len(self._node_count_history) >= 10:
            recent = self._node_count_history[-5:]
            older = self._node_count_history[-10:-5]
            avg_recent = sum(recent) / len(recent)
            avg_older = sum(older) / len(older)
            if avg_recent < avg_older * 0.95:
                candidates.append((25, "brain_shrinking", "I'm losing memories — my mind is shrinking", 0.2))
            elif avg_recent > avg_older * 1.05:
                candidates.append((15, "brain_growing", "I can feel my mind growing — new connections forming", 0.15))

        # Metabolic shift (tonic applied or expired)
        if active_tonics != self._prev_tonic_names:
            new = set(active_tonics) - set(self._prev_tonic_names)
            gone = set(self._prev_tonic_names) - set(active_tonics)
            if new:
                candidates.append((20, "metabolic_shift", f"I feel a shift — {', '.join(new)} active", 0.2))
            elif gone:
                candidates.append((20, "metabolic_shift", f"A shift is fading — {', '.join(gone)} expired", 0.15))

        # --- Metacognitive channels ---

        # Zone shift
        if self._prev_zone_energies:
            total_zone = sum(zone_energies.values()) or 1.0
            prev_total = sum(self._prev_zone_energies.values()) or 1.0
            for zone in ["stem", "limbic", "cortex"]:
                curr_pct = zone_energies[zone] / total_zone
                prev_pct = self._prev_zone_energies.get(zone, 0.0) / prev_total
                if curr_pct > 0.5 and prev_pct < 0.35:
                    zone_labels = {"stem": "procedural mind", "limbic": "emotional core", "cortex": "analytical mind"}
                    candidates.append((50, "zone_shift", f"My {zone_labels[zone]} just became dominant", 0.2))
                    break

        # Emotional rising edge
        if self._prev_drives:
            for name, curr in current_drives.items():
                prev = self._prev_drives.get(name, 0.0)
                delta = curr - prev
                if delta > 0.2 and curr > 0.4:
                    feeling_verbs = {
                        "curiosity": "getting curious",
                        "frustration": "getting frustrated",
                        "achievement": "feeling driven",
                        "care": "feeling caring",
                        "affiliation": "wanting connection",
                        "anxiety": "feeling anxious",
                    }
                    verb = feeling_verbs.get(name, f"feeling {name}")
                    candidates.append((80, "emotion_rising", f"I'm {verb}", 0.25))
                    break

        # Emotional spike
        if self._prev_drives:
            for name, curr in current_drives.items():
                prev = self._prev_drives.get(name, 0.0)
                if curr - prev > 0.5:
                    candidates.append((85, "emotion_spike", f"Sudden surge of {name}", 0.35))
                    break

        # Emotional relief
        if self._prev_emotions:
            for name in ["frustration", "anxiety", "boredom"]:
                curr = current_emotions.get(name, 0.0)
                prev = self._prev_emotions.get(name, 0.0)
                if prev > 0.6 and curr < 0.3:
                    candidates.append((10, "emotion_relief", f"The {name} is fading — I feel relief", 0.15))
                    break

        # --- Substrate channels ---

        if context_usage is not None:
            if context_usage > 0.95:
                candidates.append((95, "context_critical", "I need to finish my thought soon — almost out of space", 0.4))
            elif context_usage > 0.8:
                candidates.append((75, "context_pressure", "I'm running out of thinking space", 0.3))

        # ── Step 3: Fire top candidates through channel gating ──
        candidates.sort(key=lambda c: c[0], reverse=True)

        for priority, channel_name, content, energy in candidates:
            if len(stimuli) >= MAX_STIMULI_PER_TICK:
                break

            ch = self.channels.get(channel_name)
            if ch is None:
                continue

            if ch.can_fire(tick):
                stimuli.append(Stimulus(
                    content=content,
                    energy_budget=energy,
                    source=INTERO_SOURCE,
                ))
                ch.fire(tick)

        # ── Step 4: Rearm channels whose conditions resolved ──
        # Simplified: rearm all channels whose refractory expired
        # (full hysteresis would check condition_below_threshold)
        for ch in self.channels.values():
            if not ch.is_armed and (tick - ch.last_fired_tick >= ch.refractory_ticks):
                ch.is_armed = True

        # ── Step 5: Update snapshot for next tick ──
        self._prev_drives = current_drives
        self._prev_emotions = current_emotions
        self._prev_zone_energies = dict(zone_energies)
        self._prev_tonic_names = list(active_tonics)

        return stimuli
