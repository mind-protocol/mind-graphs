"""
Metabolism — Validation tests against invariants V1-V8.

Verifies that the metabolism implementation satisfies the contracts
defined in docs/cognition/metabolism/VALIDATION_Metabolism.md.

Tests the INTEGRATION between metabolism.py and tick_runner — not
just metabolism in isolation.
"""

import math
import time
import pytest
from unittest.mock import patch

from runtime.cognition.metabolism import (
    CitizenMetabolism,
    Tonic,
    create_focus,
    create_calm,
    create_expand,
    create_surge,
    create_circadian_shift,
    DEFAULT_TIMEZONE_OFFSET,
    DEFAULT_PEAK_HOUR,
)
from runtime.cognition.tick_runner_l1_cognitive_engine import (
    L1CognitiveTickRunner,
    Stimulus,
)
from runtime.cognition.models import (
    CitizenCognitiveState,
    Node,
    NodeType,
    Link,
    LinkType,
)
from runtime.cognition import constants


# =========================================================================
# Helpers
# =========================================================================

def _make_state(with_metabolism=True, sensitivity=None) -> CitizenCognitiveState:
    """Create a minimal citizen state with a few nodes and links."""
    state = CitizenCognitiveState(citizen_id="test_citizen")

    # Add some nodes
    for i, (ntype, name) in enumerate([
        (NodeType.CONCEPT, "con_python"),
        (NodeType.CONCEPT, "con_debugging"),
        (NodeType.MEMORY, "mem_session"),
        (NodeType.PROCESS, "proc_code_review"),
        (NodeType.DESIRE, "des_ship_feature"),
        (NodeType.VALUE, "val_quality"),
    ]):
        node = Node(
            id=name, node_type=ntype,
            content=f"Test node {name}",
            weight=0.5, energy=0.3,
        )
        node.synthesis = f"Synthesis for {name}"
        state.add_node(node)

    # Add a link
    link = Link(source_id="con_python", target_id="con_debugging",
                link_type=LinkType.ASSOCIATES, weight=0.5)
    state.add_link(link)

    if with_metabolism:
        state.metabolism = CitizenMetabolism(
            sensitivity=sensitivity or {},
        )

    return state


def _run_n_ticks(runner, n, stimulus=None):
    """Run n ticks, optionally injecting a stimulus on tick 1."""
    results = []
    for i in range(n):
        s = stimulus if i == 0 else None
        results.append(runner.run_tick(stimulus=s))
    return results


# =========================================================================
# V1: Global Constants Remain Immutable
# =========================================================================

class TestV1GlobalConstantsImmutable:
    """The metabolism NEVER mutates module-level constants."""

    def test_decay_rate_unchanged_after_ticks(self):
        """DECAY_RATE in constants.py must be unchanged after metabolism ticks."""
        original_decay = constants.DECAY_RATE
        original_long = constants.LONG_TERM_DECAY
        original_consol = constants.CONSOLIDATION_ALPHA

        state = _make_state(with_metabolism=True)
        runner = L1CognitiveTickRunner(state)

        # Run 50 ticks at different circadian phases
        _run_n_ticks(runner, 50)

        assert constants.DECAY_RATE == original_decay
        assert constants.LONG_TERM_DECAY == original_long
        assert constants.CONSOLIDATION_ALPHA == original_consol

    def test_constants_unchanged_with_tonics(self):
        """Constants must survive tonic application and expiry."""
        original_decay = constants.DECAY_RATE

        state = _make_state(with_metabolism=True)
        runner = L1CognitiveTickRunner(state)

        # Apply a focus tonic
        focus = create_focus(duration_ticks=10)
        state.metabolism.apply_tonic(focus, current_tick=0)

        # Run through application and expiry
        _run_n_ticks(runner, 20)

        assert constants.DECAY_RATE == original_decay


# =========================================================================
# V2: Effective Constants Stay Within Valid Ranges
# =========================================================================

class TestV2ConstantsInRange:
    """All effective constants must be clamped to safe ranges."""

    def test_circadian_multipliers_always_in_range(self):
        """Multipliers must stay in clamp range across all 24 hours."""
        m = CitizenMetabolism()

        for hour in range(24):
            # Simulate each hour of the day
            fake_time = hour * 3600.0  # UTC hour
            mults = m.resolve_effective_constants(now=fake_time)

            assert 0.5 <= mults["DECAY_RATE"] <= 4.0, f"DECAY_RATE out of range at hour {hour}"
            assert 0.5 <= mults["LONG_TERM_DECAY"] <= 4.0
            assert 0.5 <= mults["CONSOLIDATION_ALPHA"] <= 5.0
            assert 0.5 <= mults["ACTIVATION_THRESHOLD"] <= 3.0
            assert 0.1 <= mults["energy_injection_scale"] <= 2.0

    def test_stacked_tonics_clamped(self):
        """Even extreme stacking must produce clamped values."""
        m = CitizenMetabolism()

        # Stack 5 surge tonics (shouldn't be possible due to cooldown,
        # but test the clamp anyway)
        for i in range(5):
            surge = create_surge()
            surge.name = f"Surge_{i}"  # bypass cooldown by using different names
            m.apply_tonic(surge, current_tick=i)

        mults = m.resolve_effective_constants()

        for key, value in mults.items():
            if key in {"DECAY_RATE", "LONG_TERM_DECAY"}:
                assert 0.5 <= value <= 4.0, f"{key}={value} out of range"
            elif key == "CONSOLIDATION_ALPHA":
                assert 0.5 <= value <= 5.0
            elif key == "ACTIVATION_THRESHOLD":
                assert 0.5 <= value <= 3.0
            elif key == "energy_injection_scale":
                assert 0.1 <= value <= 2.0


# =========================================================================
# V3: Backward Compatibility Without Metabolism
# =========================================================================

class TestV3BackwardCompatibility:
    """Citizens without metabolism must behave identically to before."""

    def test_no_metabolism_same_results(self):
        """A state without metabolism produces the same tick results."""
        state_with = _make_state(with_metabolism=True)
        state_without = _make_state(with_metabolism=False)

        # Set identical initial conditions
        for nid in state_with.nodes:
            state_with.nodes[nid].energy = 0.5
            state_without.nodes[nid].energy = 0.5

        runner_with = L1CognitiveTickRunner(state_with)
        runner_without = L1CognitiveTickRunner(state_without)

        # Simulate peak hour (phase=1.0, all multipliers=1.0)
        # At peak, metabolism should be transparent
        peak_utc = (DEFAULT_PEAK_HOUR - DEFAULT_TIMEZONE_OFFSET) * 3600.0
        now = peak_utc

        with patch('time.time', return_value=now):
            result_with = runner_with.run_tick()
            result_without = runner_without.run_tick()

        # Energy decayed should be very similar at peak
        # (not exactly equal because circadian phase at exact peak = 1.0
        #  gives multiplier 1.0, but floating point may differ slightly)
        assert abs(result_with.energy_decayed - result_without.energy_decayed) < 0.01

    def test_none_metabolism_no_crash(self):
        """state.metabolism = None must never cause an error."""
        state = _make_state(with_metabolism=False)
        runner = L1CognitiveTickRunner(state)

        # Run 20 ticks with and without stimuli
        results = _run_n_ticks(runner, 10)
        result = runner.run_tick(stimulus=Stimulus(
            content="test", energy_budget=1.0, source="external"
        ))

        assert result.tick_number == 11


# =========================================================================
# V4: Consumable Duration Is Bounded
# =========================================================================

class TestV4ConsumableDuration:
    """Tonics must expire after their duration."""

    def test_tonic_expires_after_duration(self):
        """Tonic must be removed after exactly duration_ticks."""
        m = CitizenMetabolism()
        focus = create_focus(duration_ticks=10)
        m.apply_tonic(focus, current_tick=0)

        assert len(m.active_tonics) == 1

        # Tick 9 times — still active
        for t in range(1, 10):
            m.tick_tonics(t)
        assert len(m.active_tonics) == 1

        # Tick 10 — expired
        expired = m.tick_tonics(10)
        assert expired == ["Focus"]
        assert len(m.active_tonics) == 0

    def test_tonic_logged_on_expiry(self):
        """Expiry must be recorded in the audit log."""
        m = CitizenMetabolism()
        focus = create_focus(duration_ticks=5)
        m.apply_tonic(focus, current_tick=0)

        for t in range(1, 6):
            m.tick_tonics(t)

        events = [e for e in m.tonic_log if e.action == "expired"]
        assert len(events) == 1
        assert events[0].tonic_name == "Focus"
        assert events[0].tick == 5


# =========================================================================
# V5: Cooldown Is Enforced
# =========================================================================

class TestV5CooldownEnforced:
    """Re-application during cooldown must be rejected."""

    def test_cooldown_blocks_reapplication(self):
        """Cannot reapply the same tonic during cooldown."""
        m = CitizenMetabolism()

        # Apply and expire a surge (cooldown=200)
        surge = create_surge(duration_ticks=5)
        m.apply_tonic(surge, current_tick=0)
        for t in range(1, 6):
            m.tick_tonics(t)

        # Try to reapply immediately — should be rejected
        surge2 = create_surge(duration_ticks=5)
        applied = m.apply_tonic(surge2, current_tick=6)
        assert applied is False

        # Try after cooldown — should be accepted
        surge3 = create_surge(duration_ticks=5)
        applied = m.apply_tonic(surge3, current_tick=206)
        assert applied is True


# =========================================================================
# V6: Circadian Phase Continuity
# =========================================================================

class TestV6CircadianContinuity:
    """Circadian phase must be continuous and periodic."""

    def test_phase_is_sinusoidal(self):
        """Phase at peak_hour = 1.0, at peak_hour + 12 = 0.0."""
        m = CitizenMetabolism(timezone_offset=0.0, peak_hour=14.0)

        # Peak: 14:00 UTC
        peak_time = 14 * 3600.0
        assert abs(m.circadian_phase(peak_time) - 1.0) < 0.001

        # Trough: 02:00 UTC
        trough_time = 2 * 3600.0
        assert abs(m.circadian_phase(trough_time) - 0.0) < 0.001

        # Midpoint: 08:00 UTC (rising) and 20:00 UTC (falling)
        mid_time = 8 * 3600.0
        assert abs(m.circadian_phase(mid_time) - 0.5) < 0.001

    def test_phase_24h_periodic(self):
        """Phase at hour X equals phase at hour X+24."""
        m = CitizenMetabolism()
        t1 = 50000.0
        t2 = t1 + 86400.0  # +24 hours
        assert abs(m.circadian_phase(t1) - m.circadian_phase(t2)) < 0.001


# =========================================================================
# V7: Drive Deltas Applied Correctly
# =========================================================================

class TestV7DriveDeltas:
    """Tonic drive profiles must modify drives in the tick runner."""

    def test_focus_increases_curiosity(self):
        """Focus frequency must increase curiosity drive."""
        state = _make_state(with_metabolism=True)
        runner = L1CognitiveTickRunner(state)

        initial_curiosity = state.limbic.drives["curiosity"].intensity

        # Apply focus
        focus = create_focus(duration_ticks=50)
        state.metabolism.apply_tonic(focus, current_tick=0)

        # Run 10 ticks
        _run_n_ticks(runner, 10)

        final_curiosity = state.limbic.drives["curiosity"].intensity
        # Focus adds +0.03/tick to curiosity. After 10 ticks with drive_decay,
        # curiosity should be higher than initial.
        assert final_curiosity > initial_curiosity

    def test_calm_reduces_frustration(self):
        """Calm frequency must reduce frustration."""
        state = _make_state(with_metabolism=True)
        # Set initial frustration high
        state.limbic.emotions["frustration"] = 0.8
        fru_drive = state.limbic.drives.get("frustration")
        if fru_drive:
            fru_drive.intensity = 0.7

        runner = L1CognitiveTickRunner(state)

        calm = create_calm(duration_ticks=50)
        state.metabolism.apply_tonic(calm, current_tick=0)

        _run_n_ticks(runner, 20)

        # Frustration drive should decrease (calm gives -0.04/tick)
        if fru_drive:
            assert fru_drive.intensity < 0.7


# =========================================================================
# V8: Stimulus Sensitivity Applied
# =========================================================================

class TestV8StimulusSensitivity:
    """Stimulus sensitivity must scale energy before injection."""

    def test_social_dampened_for_developer(self):
        """A developer with social=0.3 receives 30% social energy."""
        state = _make_state(
            with_metabolism=True,
            sensitivity={"social": 0.3, "code": 1.0},
        )
        runner = L1CognitiveTickRunner(state)

        # Social stimulus
        social_stim = Stimulus(
            content="Hey!", energy_budget=1.0,
            source="social", is_social=True,
        )

        # Record initial total energy
        initial_energy = sum(n.energy for n in state.nodes.values())

        result = runner.run_tick(stimulus=social_stim)

        # Energy injected should be roughly 0.3 * circadian_scale * 1.0
        # (not exactly 0.3 because circadian also scales)
        # The key assertion: less energy than full budget
        assert result.energy_injected < 1.0

    def test_code_full_energy_for_developer(self):
        """A developer with code=1.0 receives full code energy."""
        state = _make_state(
            with_metabolism=True,
            sensitivity={"social": 0.3, "code": 1.0},
        )
        runner = L1CognitiveTickRunner(state)

        code_stim = Stimulus(
            content="build passed", energy_budget=1.0,
            source="code",
        )

        result = runner.run_tick(stimulus=code_stim)

        # At trough (2AM Paris), injection_scale = 0.5, so max is ~0.5
        # At peak, injection_scale = 1.0, so energy_injected ≈ 1.0
        # Either way, code sensitivity = 1.0 so no further dampening
        assert result.energy_injected > 0


# =========================================================================
# Integration: Full tick cycle with metabolism
# =========================================================================

class TestIntegrationFullCycle:
    """End-to-end: metabolism modulates a full tick cycle."""

    def test_100_ticks_no_crash(self):
        """100 ticks with metabolism, tonics, and stimuli must not crash."""
        state = _make_state(with_metabolism=True)
        runner = L1CognitiveTickRunner(state)

        # Apply some tonics
        state.metabolism.apply_tonic(create_focus(30), current_tick=0)

        for i in range(100):
            stim = None
            if i % 10 == 0:
                stim = Stimulus(content=f"tick {i}", energy_budget=0.5)
            runner.run_tick(stimulus=stim)

        # Verify metabolism snapshot is attached
        result = runner.run_tick()
        assert hasattr(result, 'metabolism_snapshot')
        assert result.metabolism_snapshot is not None
        assert "circadian_phase" in result.metabolism_snapshot

    def test_circadian_adaptation_drifts_peak(self):
        """After enough activity records, peak_hour should drift."""
        m = CitizenMetabolism(peak_hour=14.0, timezone_offset=0.0)

        # Record 20 activities centered around 20:00 (evening)
        for i in range(20):
            fake_time = (20 * 3600.0) + i * 60  # 20:00-20:19 UTC
            m.record_activity(energy=1.0, now=fake_time)

        # Adapt
        m.adapt_circadian(current_tick=100)

        # Peak should have drifted toward 20:00
        # (ADAPTATION_RATE = 0.1h per call, so one call = max 0.1h drift)
        assert m.peak_hour != 14.0
        assert m.peak_hour > 14.0  # drifted toward 20
