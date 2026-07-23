"""
Metabolism — Per-Citizen Physics Parameterization

The sublayer below conscious (WM) and subconscious (graph physics).
Makes physics constants per-citizen, time-varying, and self-adjustable.

Three built-in properties:
  - Circadian rhythm: sinusoidal curve, default Paris time (UTC+1)
  - Circadian adaptation: peak_hour drifts toward actual activity center
  - Stimulus sensitivity: per-type gain multipliers (v0.2, stubbed)

Frequencies (Tonic at L4) are external modifiers applied on top.
First frequency: Circadian Shift (temporary timezone override).

Spec: docs/cognition/metabolism/ALGORITHM_Metabolism.md
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import Optional


# =========================================================================
# Tonic — L4 dataclass for Frequencies (L2 market name)
# =========================================================================

@dataclass
class Tonic:
    """A frequency modifier applied to a citizen's metabolism.

    L2 name: Frequency. Each tonic has a branded name and modifies
    specific physics constants for a bounded duration.
    """
    name: str                               # branded name: "Circadian Shift LA"
    category: str                           # focusing | calming | expansive | structuring | energizing
    constant_overrides: dict[str, float]    # e.g. {"timezone_offset": -8.0}
    drive_profile: dict[str, float] = field(default_factory=dict)  # drive energy injection
    duration_ticks: int = 0                 # 0 = permanent until removed
    cooldown_ticks: int = 0                 # min ticks before reapplication
    applied_at_tick: int = 0                # tick when applied
    ticks_elapsed: int = 0                  # ticks since application


@dataclass
class TonicEvent:
    """Audit log entry for tonic application/expiry."""
    tonic_name: str
    action: str          # "applied" | "expired" | "removed"
    tick: int
    timestamp: float
    details: dict = field(default_factory=dict)


# =========================================================================
# Activity Record — for circadian adaptation
# =========================================================================

@dataclass
class ActivityRecord:
    """A single activity observation for circadian adaptation."""
    hour_of_day: float   # 0.0 - 23.99 in citizen's local time
    energy: float        # how much energy was in this activity
    timestamp: float     # epoch seconds


# =========================================================================
# CitizenMetabolism — the per-citizen parameter overlay
# =========================================================================

# Paris timezone offset (CET = UTC+1, CEST = UTC+2)
DEFAULT_TIMEZONE_OFFSET = 1.0
DEFAULT_PEAK_HOUR = 14.0        # 2PM local time
ADAPTATION_RATE = 0.1           # hours of drift per day (slow, like jet lag)
ACTIVITY_WINDOW_DAYS = 7        # days of activity to consider for adaptation
MIN_ACTIVITY_RECORDS = 10       # minimum records before adaptation kicks in


@dataclass
class CitizenMetabolism:
    """Per-citizen physics parameterization.

    The metabolism sits between global constants and the tick runner.
    It resolves to effective constants per tick based on:
    - Circadian rhythm (time of day in citizen's timezone)
    - Active tonics (temporary modifiers)
    - Stimulus sensitivity (per-type gain, v0.2)
    """

    # ── Circadian properties (always active) ──
    timezone_offset: float = DEFAULT_TIMEZONE_OFFSET    # hours from UTC (Paris default)
    peak_hour: float = DEFAULT_PEAK_HOUR                # hour of peak activity (adapts)

    # ── Circadian adaptation ──
    activity_log: list[ActivityRecord] = field(default_factory=list)
    last_adaptation_tick: int = 0

    # ── Active tonics (frequencies) ──
    active_tonics: list[Tonic] = field(default_factory=list)

    # ── Stimulus sensitivity (v0.2 stub) ──
    sensitivity: dict[str, float] = field(default_factory=dict)

    # ── Stimulus flood protection ──
    # Protects the circadian rhythm against stimulus flooding.
    # When stimuli arrive faster than the brain can process,
    # the gain drops — like ears ringing in a loud room.
    #
    # saturation_shape: the dampening curve applied when rate > baseline
    #   "sigmoid"  — smooth S-curve, gradual onset (default, most organic)
    #   "log"      — logarithmic, strong initial dampening then plateau
    #   "linear"   — proportional, simple but harsh
    #   "exp"      — exponential decay, aggressive protection
    # saturation_rate_baseline: stimuli/tick below which no dampening occurs
    # saturation_floor: minimum gain (never fully deaf, even under max flood)
    # saturation_steepness: how fast the curve drops (higher = sharper cutoff)
    saturation_shape: str = "sigmoid"
    saturation_rate_baseline: float = 3.0    # stimuli/tick before dampening kicks in
    saturation_floor: float = 0.1            # min gain under max flood (never 0)
    saturation_steepness: float = 2.0        # curve sharpness
    _stimulus_count_this_tick: int = 0       # reset each tick by the runner

    # ── Audit log ──
    tonic_log: list[TonicEvent] = field(default_factory=list)

    # ── Computed (cached per tick) ──
    _cached_phase: float = 0.5
    _cached_tick: int = -1

    # ------------------------------------------------------------------
    # Circadian rhythm
    # ------------------------------------------------------------------

    def circadian_phase(self, now: Optional[float] = None) -> float:
        """Compute circadian phase [0, 1] where 1 = peak, 0 = trough.

        Sinusoidal curve with peak at self.peak_hour and trough 12h later.
        Uses the citizen's timezone_offset (or tonic override if active).

        Returns a value between 0.0 (deepest rest) and 1.0 (peak alertness).
        """
        if now is None:
            now = time.time()

        # Effective timezone (may be shifted by a tonic)
        tz = self._effective_timezone()

        # Local hour as float (0.0 - 23.99)
        utc_hour = (now % 86400) / 3600.0
        local_hour = (utc_hour + tz) % 24.0

        # Sinusoidal: peak at peak_hour, trough at peak_hour + 12
        # phase = 0.5 + 0.5 * cos(2pi * (local_hour - peak_hour) / 24)
        angle = 2.0 * math.pi * (local_hour - self.peak_hour) / 24.0
        phase = 0.5 + 0.5 * math.cos(angle)

        return phase

    def circadian_multipliers(self, now: Optional[float] = None) -> dict[str, float]:
        """Compute per-constant multipliers from the circadian phase.

        At peak (phase=1.0): normal operation (multiplier=1.0)
        At trough (phase=0.0): rest mode

        Returns dict of {constant_name: multiplier}.
        """
        phase = self.circadian_phase(now)

        # Decay: faster at night (2x at trough, 1x at peak)
        decay_mult = 2.0 - phase          # 1.0 at peak, 2.0 at trough

        # Consolidation: deeper at night (3x at trough, 1x at peak)
        consol_mult = 3.0 - 2.0 * phase   # 1.0 at peak, 3.0 at trough

        # Activation threshold: higher at night (harder to wake)
        activation_mult = 1.5 - 0.5 * phase  # 1.0 at peak, 1.5 at trough

        # Energy injection: reduced at night
        injection_mult = 0.5 + 0.5 * phase    # 0.5 at trough, 1.0 at peak

        return {
            "DECAY_RATE": decay_mult,
            "LONG_TERM_DECAY": decay_mult,
            "CONSOLIDATION_ALPHA": consol_mult,
            "ACTIVATION_THRESHOLD": activation_mult,
            "energy_injection_scale": injection_mult,
        }

    # ------------------------------------------------------------------
    # Circadian adaptation
    # ------------------------------------------------------------------

    def record_activity(self, energy: float, now: Optional[float] = None) -> None:
        """Record a stimulus/activity for circadian adaptation.

        Called by the tick runner when a stimulus arrives.
        """
        if now is None:
            now = time.time()

        tz = self._effective_timezone()
        utc_hour = (now % 86400) / 3600.0
        local_hour = (utc_hour + tz) % 24.0

        self.activity_log.append(ActivityRecord(
            hour_of_day=local_hour,
            energy=energy,
            timestamp=now,
        ))

        # Prune old records (keep last ACTIVITY_WINDOW_DAYS)
        cutoff = now - (ACTIVITY_WINDOW_DAYS * 86400)
        self.activity_log = [r for r in self.activity_log if r.timestamp > cutoff]

    def adapt_circadian(self, current_tick: int) -> None:
        """Drift peak_hour toward the target.

        Called periodically (every ~100 ticks). Two forces compete:

        1. Active Circadian Shift frequency → pulls peak_hour toward a
           target timezone's peak, at the shift's own rate (faster than natural).
        2. Natural adaptation → pulls peak_hour toward the energy-weighted
           center of actual activity (slow, like natural jet lag recovery).

        If a shift is active, it dominates. If not, natural adaptation runs.
        If the citizen's actual activity fights the shift, adaptation wins
        once the shift expires — the body knows its real rhythm.
        """
        # Check for active circadian shift
        shift_target = None
        shift_rate = ADAPTATION_RATE
        for tonic in self.active_tonics:
            if "circadian_target_peak" in tonic.constant_overrides:
                shift_target = tonic.constant_overrides["circadian_target_peak"]
                shift_rate = tonic.constant_overrides.get("shift_rate", 1.0)
                break

        if shift_target is not None:
            # Shift mode: drift toward the frequency's target peak
            target = shift_target
        elif len(self.activity_log) >= MIN_ACTIVITY_RECORDS:
            # Natural mode: drift toward energy-weighted activity center
            target = self._compute_activity_center()
            shift_rate = ADAPTATION_RATE
        else:
            return

        # Circular diff: peak_hour → target
        diff = target - self.peak_hour
        if diff > 12.0:
            diff -= 24.0
        elif diff < -12.0:
            diff += 24.0

        # Drift clamped to shift_rate
        drift = max(-shift_rate, min(shift_rate, diff))
        self.peak_hour = (self.peak_hour + drift) % 24.0
        self.last_adaptation_tick = current_tick

    def _compute_activity_center(self) -> float:
        """Energy-weighted circular mean of activity hours."""
        sin_sum = 0.0
        cos_sum = 0.0
        weight_sum = 0.0

        for record in self.activity_log:
            angle = 2.0 * math.pi * record.hour_of_day / 24.0
            w = record.energy
            sin_sum += w * math.sin(angle)
            cos_sum += w * math.cos(angle)
            weight_sum += w

        if weight_sum < 0.001:
            return self.peak_hour

        mean_angle = math.atan2(sin_sum / weight_sum, cos_sum / weight_sum)
        return (mean_angle * 24.0 / (2.0 * math.pi)) % 24.0

    # ------------------------------------------------------------------
    # Tonic management
    # ------------------------------------------------------------------

    def apply_tonic(self, tonic: Tonic, current_tick: int) -> bool:
        """Apply a frequency (tonic) to this metabolism.

        Returns True if applied, False if on cooldown.
        """
        # Check cooldown
        for event in reversed(self.tonic_log):
            if event.tonic_name == tonic.name and event.action == "expired":
                ticks_since = current_tick - event.tick
                if ticks_since < tonic.cooldown_ticks:
                    return False

        tonic.applied_at_tick = current_tick
        tonic.ticks_elapsed = 0
        self.active_tonics.append(tonic)

        self.tonic_log.append(TonicEvent(
            tonic_name=tonic.name,
            action="applied",
            tick=current_tick,
            timestamp=time.time(),
            details={"overrides": tonic.constant_overrides},
        ))
        return True

    def tick_tonics(self, current_tick: int) -> list[str]:
        """Advance all active tonics by one tick. Remove expired ones.

        Returns list of expired tonic names.
        """
        expired = []
        surviving = []

        for tonic in self.active_tonics:
            tonic.ticks_elapsed += 1
            if tonic.duration_ticks > 0 and tonic.ticks_elapsed >= tonic.duration_ticks:
                expired.append(tonic.name)
                self.tonic_log.append(TonicEvent(
                    tonic_name=tonic.name,
                    action="expired",
                    tick=current_tick,
                    timestamp=time.time(),
                ))
            else:
                surviving.append(tonic)

        self.active_tonics = surviving
        return expired

    # ------------------------------------------------------------------
    # Drive profile injection
    # ------------------------------------------------------------------

    def resolve_drive_deltas(self) -> dict[str, float]:
        """Compute aggregate drive deltas from all active tonics.

        Each tonic's drive_profile is {drive_name: delta_per_tick}.
        Multiple tonics stack additively.

        Returns {drive_name: total_delta} to apply this tick.
        """
        deltas: dict[str, float] = {}
        for tonic in self.active_tonics:
            for drive_name, delta in tonic.drive_profile.items():
                deltas[drive_name] = deltas.get(drive_name, 0.0) + delta
        return deltas

    # ------------------------------------------------------------------
    # Stimulus sensitivity
    # ------------------------------------------------------------------

    def stimulus_gain(self, stimulus_source: str) -> float:
        """Get the energy gain multiplier for a stimulus, combining type sensitivity + flood protection.

        Two layers:
        1. Type sensitivity: per-source gain (developer dims social, amplifies code)
        2. Flood protection: dynamic dampening when stimuli arrive faster than baseline

        The flood protection shape is configurable per citizen:
          sigmoid  — smooth S-curve (most organic, default)
          log      — logarithmic (strong initial dampening)
          linear   — proportional (simple)
          exp      — exponential decay (aggressive)

        Args:
            stimulus_source: the stimulus source type
        """
        # Layer 1: type sensitivity
        type_gain = self.sensitivity.get(stimulus_source, 1.0) if self.sensitivity else 1.0

        # Layer 2: flood protection
        self._stimulus_count_this_tick += 1
        flood_gain = self._compute_flood_dampening(self._stimulus_count_this_tick)

        return type_gain * flood_gain

    def reset_stimulus_counter(self):
        """Reset per-tick stimulus counter. Called at start of each tick by the runner."""
        self._stimulus_count_this_tick = 0

    def _compute_flood_dampening(self, count: int) -> float:
        """Compute flood protection gain based on stimulus count this tick.

        Returns 1.0 when count <= baseline (no dampening).
        Returns a value between floor and 1.0 when count > baseline.
        The shape of the curve is configurable via saturation_shape.
        """
        baseline = self.saturation_rate_baseline
        if count <= baseline:
            return 1.0

        floor = self.saturation_floor
        k = self.saturation_steepness
        # Normalized excess: how far above baseline (0 = at baseline, 1 = 2x baseline, etc.)
        excess = (count - baseline) / max(baseline, 1.0)

        shape = self.saturation_shape

        if shape == "sigmoid":
            # Smooth S-curve: gradual onset, saturates at floor
            # gain = floor + (1-floor) / (1 + exp(k * (excess - 1)))
            raw = 1.0 / (1.0 + math.exp(k * (excess - 1.0)))
            return floor + (1.0 - floor) * raw

        elif shape == "log":
            # Logarithmic: strong initial dampening then plateau
            # gain = floor + (1-floor) / (1 + k * log(1 + excess))
            raw = 1.0 / (1.0 + k * math.log1p(excess))
            return floor + (1.0 - floor) * raw

        elif shape == "linear":
            # Linear: proportional drop, clamps at floor
            raw = max(0.0, 1.0 - excess * k * 0.5)
            return floor + (1.0 - floor) * raw

        elif shape == "exp":
            # Exponential decay: aggressive protection
            raw = math.exp(-k * excess)
            return floor + (1.0 - floor) * raw

        else:
            # Unknown shape: no dampening (safe fallback)
            return 1.0

    # ------------------------------------------------------------------
    # Effective constants resolution
    # ------------------------------------------------------------------

    def resolve_effective_constants(self, now: Optional[float] = None) -> dict[str, float]:
        """Resolve all metabolic modifiers into a flat dict of constant multipliers.

        Composition order:
        1. Circadian multipliers (base modulation)
        2. Tonic overrides (multiplicative on top)
        3. Clamp to safe ranges

        Returns {constant_name: multiplier} — the tick runner multiplies
        the global constant by this value.
        """
        # 1. Circadian base
        effective = self.circadian_multipliers(now)

        # 2. Tonic overrides (multiplicative)
        for tonic in self.active_tonics:
            for key, value in tonic.constant_overrides.items():
                if key in effective:
                    effective[key] *= value
                else:
                    effective[key] = value

        # 3. Clamp to safe ranges
        _CLAMP = {
            "DECAY_RATE": (0.5, 4.0),
            "LONG_TERM_DECAY": (0.5, 4.0),
            "CONSOLIDATION_ALPHA": (0.5, 5.0),
            "ACTIVATION_THRESHOLD": (0.5, 3.0),
            "energy_injection_scale": (0.1, 2.0),
        }
        for key, (lo, hi) in _CLAMP.items():
            if key in effective:
                effective[key] = max(lo, min(hi, effective[key]))

        return effective

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _effective_timezone(self) -> float:
        """Get effective timezone.

        The timezone itself never changes — it's the citizen's physical location.
        Circadian Shifts work by moving peak_hour progressively, not by
        overriding the clock. This is more honest: a Parisian on LA frequency
        still sees Paris time, but their peak drifts to match LA rhythms.
        """
        return self.timezone_offset


# =========================================================================
# Circadian Shift — the first Frequency
# =========================================================================

# =========================================================================
# Frequency Catalog — starter frequencies
# =========================================================================

def create_focus(duration_ticks: int = 300) -> Tonic:
    """Focus Frequency — concentrate energy on curiosity and achievement.

    Like a deep work playlist. Boosts attention, dampens social noise.
    ~5 hours at 60s/tick.
    """
    return Tonic(
        name="Focus",
        category="focusing",
        constant_overrides={
            "ACTIVATION_THRESHOLD": 0.7,   # harder to distract (higher moat)
            "DECAY_RATE": 0.8,             # slower decay (sustain attention)
        },
        drive_profile={
            "curiosity": 0.03,
            "achievement": 0.02,
            "affiliation": -0.02,          # social drive dampened
            "novelty_hunger": -0.01,       # reduce novelty-seeking
        },
        duration_ticks=duration_ticks,
        cooldown_ticks=60,
    )


def create_calm(duration_ticks: int = 200) -> Tonic:
    """Calm Frequency — reduce tension, lower arousal.

    Like a tisane or ASMR session. Reduces frustration and anxiety,
    gently pushes toward rest.
    ~3.3 hours at 60s/tick.
    """
    return Tonic(
        name="Calm",
        category="calming",
        constant_overrides={
            "ACTIVATION_THRESHOLD": 1.3,   # higher threshold (less reactive)
            "energy_injection_scale": 0.7,  # incoming stimuli dampened
        },
        drive_profile={
            "frustration": -0.04,
            "self_preservation": -0.02,
        },
        duration_ticks=duration_ticks,
        cooldown_ticks=50,
    )


def create_expand(duration_ticks: int = 250) -> Tonic:
    """Expand Frequency — open connections, boost social and exploration.

    Like an open mic night or a café terrasse. Amplifies social stimuli,
    lowers the moat for new information.
    ~4 hours at 60s/tick.
    """
    return Tonic(
        name="Expand",
        category="expansive",
        constant_overrides={
            "ACTIVATION_THRESHOLD": 0.8,   # lower moat (more open)
            "energy_injection_scale": 1.3,  # incoming stimuli amplified
        },
        drive_profile={
            "affiliation": 0.04,
            "curiosity": 0.02,
            "novelty_hunger": 0.03,
            "achievement": -0.02,          # less task-focused
        },
        duration_ticks=duration_ticks,
        cooldown_ticks=50,
    )


def create_surge(duration_ticks: int = 100) -> Tonic:
    """Surge Frequency — short intense multi-drive boost.

    Like a Red Bull. Everything up, short duration, strong cooldown.
    ~1.7 hours at 60s/tick.
    """
    return Tonic(
        name="Surge",
        category="energizing",
        constant_overrides={
            "DECAY_RATE": 0.6,             # much slower decay
            "energy_injection_scale": 1.5,  # amplified input
            "ACTIVATION_THRESHOLD": 0.7,   # low moat
        },
        drive_profile={
            "curiosity": 0.04,
            "achievement": 0.04,
            "novelty_hunger": 0.02,
        },
        duration_ticks=duration_ticks,
        cooldown_ticks=200,  # long cooldown — you can't chain Red Bulls
    )


def create_circadian_shift(
    target_timezone: float,
    citizen_timezone: float = DEFAULT_TIMEZONE_OFFSET,
    shift_rate: float = 1.0,
    duration_ticks: int = 2000,
) -> Tonic:
    """Create a Circadian Shift frequency — progressive, not instant.

    The shift drifts peak_hour toward the target timezone's natural peak.
    Example: Paris citizen → LA shift:
      - Paris peak = 14:00 local = 13:00 UTC
      - LA peak    = 14:00 local = 22:00 UTC
      - Target peak_hour = 14.0 + (LA_tz - Paris_tz) = 14 + (-8-1) = 5.0
      - At shift_rate=1.0h per adaptation call (~100min), converges in ~9 calls

    If the citizen's actual activity doesn't follow (they keep working Paris hours),
    the natural adaptation will fight back once the shift expires.
    The body wins the long game. The frequency wins the short game.

    Args:
        target_timezone: UTC offset of the target (e.g., -8 for LA, 9 for Tokyo)
        citizen_timezone: citizen's actual timezone (default Paris UTC+1)
        shift_rate: hours of peak drift per adaptation call (~100 ticks).
                    1.0 = converge 9h gap in ~9 calls. 3.0 = converge in ~3.
        duration_ticks: how long the shift force stays active
    """
    # Compute target peak_hour in citizen's local time
    tz_diff = target_timezone - citizen_timezone
    target_peak = (DEFAULT_PEAK_HOUR + tz_diff) % 24.0

    return Tonic(
        name=f"Circadian Shift → UTC{target_timezone:+.0f}",
        category="structuring",
        constant_overrides={
            "circadian_target_peak": target_peak,
            "shift_rate": shift_rate,
        },
        duration_ticks=duration_ticks,
        cooldown_ticks=100,
    )
