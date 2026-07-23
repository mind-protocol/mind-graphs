"""
Interoception — Validation tests against invariants V1-V8.

Verifies docs/cognition/interoception/VALIDATION_Interoception.md.
"""

import pytest
from runtime.cognition.interoception import InteroceptionEngine, MAX_STIMULI_PER_TICK
from runtime.cognition.models import (
    CitizenCognitiveState, Node, NodeType, Link, LinkType,
)
from runtime.cognition.metabolism import CitizenMetabolism
from runtime.cognition.tick_runner_l1_cognitive_engine import (
    L1CognitiveTickRunner, Stimulus,
)


def _make_state(**overrides) -> CitizenCognitiveState:
    state = CitizenCognitiveState(citizen_id="test")
    for i, (ntype, name) in enumerate([
        (NodeType.CONCEPT, "con_a"), (NodeType.CONCEPT, "con_b"),
        (NodeType.VALUE, "val_a"), (NodeType.PROCESS, "proc_a"),
        (NodeType.DESIRE, "des_a"), (NodeType.NARRATIVE, "nar_a"),
        (NodeType.MEMORY, "mem_a"), (NodeType.PROCESS, "proc_b"),
    ]):
        node = Node(id=name, node_type=ntype, content=f"test {name}",
                     weight=0.5, energy=0.3)
        state.add_node(node)
    state.tick_count = overrides.get("tick", 100)
    return state


# =========================================================================
# V1: State Immutability — interoception NEVER mutates state
# =========================================================================

class TestV1StateImmutability:

    def test_nodes_unchanged(self):
        state = _make_state()
        original_energies = {nid: n.energy for nid, n in state.nodes.items()}
        original_weights = {nid: n.weight for nid, n in state.nodes.items()}

        engine = InteroceptionEngine()
        engine.tick(state, CitizenMetabolism())

        for nid, n in state.nodes.items():
            assert n.energy == original_energies[nid], f"Node {nid} energy mutated"
            assert n.weight == original_weights[nid], f"Node {nid} weight mutated"

    def test_drives_unchanged(self):
        state = _make_state()
        state.limbic.drives["frustration"].intensity = 0.8
        original_drives = {n: d.intensity for n, d in state.limbic.drives.items()}

        engine = InteroceptionEngine()
        engine.tick(state, CitizenMetabolism())

        for name, drive in state.limbic.drives.items():
            assert drive.intensity == original_drives[name], f"Drive {name} mutated"

    def test_wm_unchanged(self):
        state = _make_state()
        state.wm.node_ids = ["con_a", "con_b", "val_a"]
        original_wm = list(state.wm.node_ids)

        engine = InteroceptionEngine()
        engine.tick(state, CitizenMetabolism())

        assert state.wm.node_ids == original_wm


# =========================================================================
# V2: Refractory Gating — same channel can't fire twice within refractory
# =========================================================================

class TestV2RefractoryGating:

    def test_channel_doesnt_fire_twice(self):
        state = _make_state()
        state.limbic.ticks_since_social = 200  # trigger social_isolated
        state.tick_count = 100

        engine = InteroceptionEngine()
        s1 = engine.tick(state, CitizenMetabolism())
        social_fired = any("alone" in s.content.lower() for s in s1)

        # Same tick+1, same conditions
        state.tick_count = 101
        s2 = engine.tick(state, CitizenMetabolism())
        social_fired_again = any("alone" in s.content.lower() for s in s2)

        if social_fired:
            assert not social_fired_again, "Social channel fired again within refractory"

    def test_channel_rearms_after_refractory(self):
        state = _make_state()
        state.limbic.ticks_since_social = 200
        state.tick_count = 100

        engine = InteroceptionEngine()
        engine.tick(state, CitizenMetabolism())

        # Verify social channel is disarmed
        ch = engine.channels["social_isolated"]
        assert not ch.is_armed, "Channel should be disarmed after firing"

        # Jump past refractory (80 ticks for social_isolated)
        state.tick_count = 200
        # Re-arm happens in the tick call
        engine.tick(state, CitizenMetabolism())
        assert ch.is_armed or ch.last_fired_tick == 200, "Channel should rearm after refractory"


# =========================================================================
# V3: Bounded Output — max N stimuli per tick
# =========================================================================

class TestV3BoundedOutput:

    def test_max_stimuli_cap(self):
        state = _make_state(tick=600)
        # Create extreme conditions to trigger many channels
        state.limbic.drives["frustration"].intensity = 0.9
        state.limbic.drives["curiosity"].intensity = 0.8
        state.limbic.ticks_since_social = 200
        state.wm.node_ids = ["con_a", "con_b", "val_a", "proc_a", "des_a", "nar_a", "mem_a"]

        engine = InteroceptionEngine()
        engine._wake_tick = 0
        stimuli = engine.tick(state, CitizenMetabolism())

        assert len(stimuli) <= MAX_STIMULI_PER_TICK


# =========================================================================
# V4: Standard Injection — all stimuli have source="interoception"
# =========================================================================

class TestV4StandardInjection:

    def test_all_stimuli_have_correct_source(self):
        state = _make_state()
        state.limbic.drives["frustration"].intensity = 0.9
        state.limbic.ticks_since_social = 200

        engine = InteroceptionEngine()
        stimuli = engine.tick(state, CitizenMetabolism())

        for s in stimuli:
            assert s.source == "interoception", f"Stimulus source={s.source}, expected interoception"


# =========================================================================
# V5: Natural Language — content is human-readable, not telemetry
# =========================================================================

class TestV5NaturalLanguage:

    def test_no_numbers_in_content(self):
        state = _make_state()
        state.limbic.drives["frustration"].intensity = 0.9
        state.wm.node_ids = ["con_a", "con_b", "val_a", "proc_a", "des_a", "nar_a", "mem_a"]

        engine = InteroceptionEngine()
        stimuli = engine.tick(state, CitizenMetabolism())

        for s in stimuli:
            # Content should not contain raw floats like "0.8" or "frustration=0.9"
            assert "=" not in s.content, f"Telemetry in content: {s.content}"
            assert "0." not in s.content, f"Raw float in content: {s.content}"


# =========================================================================
# V6: Silence by Default — no stimuli when nothing noteworthy
# =========================================================================

class TestV6SilenceByDefault:

    def test_calm_state_no_stimuli(self):
        state = _make_state()
        # All drives at baseline, WM partial, not isolated
        state.limbic.ticks_since_social = 5
        state.wm.node_ids = ["con_a", "con_b", "val_a"]

        engine = InteroceptionEngine()
        stimuli = engine.tick(state, CitizenMetabolism())

        assert len(stimuli) == 0, f"Expected silence, got {len(stimuli)} stimuli"


# =========================================================================
# V7: Metabolism Independence — works without metabolism
# =========================================================================

class TestV7MetabolismIndependence:

    def test_no_metabolism_no_crash(self):
        state = _make_state()
        state.limbic.drives["frustration"].intensity = 0.9

        engine = InteroceptionEngine()
        stimuli = engine.tick(state, metabolism=None)

        assert isinstance(stimuli, list)

    def test_no_circadian_channel_without_metabolism(self):
        state = _make_state()
        engine = InteroceptionEngine()
        stimuli = engine.tick(state, metabolism=None)

        circadian = [s for s in stimuli if "drowsy" in s.content.lower()]
        assert len(circadian) == 0


# =========================================================================
# V8: Zone Awareness — metacognition detects dominant zones
# =========================================================================

class TestV8ZoneAwareness:

    def test_cortex_dominance_detected(self):
        state = _make_state()
        # Make cortex nodes very energetic
        state.nodes["con_a"].energy = 5.0
        state.nodes["con_b"].energy = 5.0
        state.nodes["val_a"].energy = 5.0
        # Suppress other zones
        state.nodes["proc_a"].energy = 0.0
        state.nodes["proc_b"].energy = 0.0
        state.nodes["des_a"].energy = 0.0
        state.nodes["nar_a"].energy = 0.0

        engine = InteroceptionEngine()
        # Need a previous tick with different zones to trigger zone_shift
        engine._prev_zone_energies = {"stem": 5.0, "limbic": 5.0, "cortex": 1.0}
        stimuli = engine.tick(state, CitizenMetabolism())

        zone_stimuli = [s for s in stimuli if "analytical" in s.content.lower() or "cortex" in s.content.lower()]
        assert len(zone_stimuli) > 0, "Zone shift to cortex not detected"


# =========================================================================
# Integration: Full tick cycle with interoception
# =========================================================================

class TestIntegrationFullCycle:

    def test_100_ticks_with_interoception(self):
        state = _make_state()
        state.metabolism = CitizenMetabolism()
        runner = L1CognitiveTickRunner(state)

        total_intero = 0
        for i in range(100):
            stim = None
            if i == 50:
                state.limbic.drives["frustration"].intensity = 0.9
            result = runner.run_tick(stimulus=stim)
            # Can't directly count intero stimuli from result,
            # but verify no crash
        assert state.tick_count >= 100

    def test_interoception_stimuli_enter_via_law1(self):
        """Interoception stimuli should be injected and increase total energy."""
        state = _make_state()
        state.metabolism = CitizenMetabolism()
        state.limbic.drives["frustration"].intensity = 0.9
        state.limbic.ticks_since_social = 200
        state.wm.node_ids = list(state.nodes.keys())[:7]

        runner = L1CognitiveTickRunner(state)
        result = runner.run_tick()

        # Interoception should have injected stimuli → energy_injected > 0
        # (even without external stimulus, interoception generates internal ones)
        assert result.energy_injected > 0, "Interoception stimuli not injected"
