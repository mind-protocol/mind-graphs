"""
Sense Engine — Continuous measurement → awareness injection.

Spec: docs/cognition/custom_senses/
Related: exteroception.py (fires per-tick stimuli), this module adds:
  1. Rolling state tracking (history of observations)
  2. Variable-outcome correlation computation
  3. Sense node updates (synthesis reflects current insights)
  4. Internalization (L1 mirror node) / externalization (L3 Thing update)

A sense is a Thing(type=sense) in L3 with a YAML definition.
The SenseEngine evaluates all senses periodically, maintains rolling
state, computes insights, and updates both the L3 Thing (externalized)
and optionally an L1 node (internalized).

The exteroception engine handles per-tick stimulus injection from
senses. This engine handles the LEARNING: what works, what doesn't,
what correlates with success.

Co-Authored-By: Tomaso Nervo (@nervo) <nervo@mindprotocol.ai>
"""

from __future__ import annotations

import json
import logging
import math
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger("cognition.sense_engine")

# How often the sense engine re-evaluates (in ticks)
SENSE_EVAL_INTERVAL = 10
# Max observations to retain per sense
MAX_HISTORY = 200
# Min observations before computing correlations
MIN_OBSERVATIONS_FOR_CORRELATION = 5


@dataclass
class Observation:
    """A single measurement from a sense."""
    timestamp: float
    variables: Dict[str, float]   # measured variables (e.g. {"stories_told": 3, "time_to_birth": 8})
    outcomes: Dict[str, float]    # measured outcomes (e.g. {"retained_d1": 1.0, "subscribed": 0.0})
    score: float = 0.0            # composite score [0, 1]


@dataclass
class SenseState:
    """Rolling state for one sense."""
    sense_id: str
    observations: List[Observation] = field(default_factory=list)
    correlations: Dict[str, Dict[str, float]] = field(default_factory=dict)  # var → {outcome → r}
    insights: List[str] = field(default_factory=list)
    last_eval_tick: int = 0
    rolling_score: float = 0.0

    def add_observation(self, obs: Observation):
        self.observations.append(obs)
        if len(self.observations) > MAX_HISTORY:
            self.observations = self.observations[-MAX_HISTORY:]
        # Update rolling score (exponential moving average)
        alpha = 0.2
        self.rolling_score = alpha * obs.score + (1 - alpha) * self.rolling_score

    def compute_correlations(self):
        """Compute variable→outcome correlations from observation history."""
        if len(self.observations) < MIN_OBSERVATIONS_FOR_CORRELATION:
            return

        self.correlations = {}
        self.insights = []

        # Collect all variable and outcome keys
        var_keys = set()
        out_keys = set()
        for obs in self.observations:
            var_keys.update(obs.variables.keys())
            out_keys.update(obs.outcomes.keys())

        for var in var_keys:
            self.correlations[var] = {}
            for out in out_keys:
                r = _pearson(
                    [obs.variables.get(var, 0.0) for obs in self.observations],
                    [obs.outcomes.get(out, 0.0) for obs in self.observations],
                )
                if r is not None:
                    self.correlations[var][out] = r
                    # Generate insight if correlation is strong
                    if abs(r) > 0.4:
                        direction = "positively" if r > 0 else "negatively"
                        self.insights.append(
                            f"{var} {direction} correlated with {out} (r={r:.2f})"
                        )

    def synthesis_text(self) -> str:
        """Generate human-readable synthesis of current sense state."""
        lines = []
        n = len(self.observations)
        lines.append(f"Score: {self.rolling_score:.2f} ({n} observations)")

        if self.insights:
            lines.append("Insights:")
            for insight in self.insights[:5]:
                lines.append(f"  • {insight}")

        # Best/worst variable values
        if n >= MIN_OBSERVATIONS_FOR_CORRELATION:
            recent = self.observations[-min(10, n):]
            good = [o for o in recent if o.score > 0.6]
            bad = [o for o in recent if o.score < 0.3]
            if good and bad:
                # Find the variable with biggest difference between good and bad
                all_vars = set()
                for o in recent:
                    all_vars.update(o.variables.keys())
                for var in all_vars:
                    good_avg = _mean([o.variables.get(var, 0) for o in good])
                    bad_avg = _mean([o.variables.get(var, 0) for o in bad])
                    if good_avg is not None and bad_avg is not None and abs(good_avg - bad_avg) > 0.3:
                        lines.append(f"  {var}: {good_avg:.1f} (good) vs {bad_avg:.1f} (bad)")

        return "\n".join(lines)


class SenseEngine:
    """Evaluates custom senses, maintains rolling state, computes insights.

    Runs periodically (every SENSE_EVAL_INTERVAL ticks) inside the tick loop.
    Updates L3 Thing nodes with computed insights.
    Optionally mirrors to L1 nodes for internalization.
    """

    def __init__(self):
        self._states: Dict[str, SenseState] = {}
        self._loaded: bool = False
        self._sense_definitions: Dict[str, dict] = {}

    def tick(
        self,
        citizen_id: str,
        tick: int,
        query_fn: Optional[Callable] = None,
        write_fn: Optional[Callable] = None,
        state: Optional[Any] = None,  # CitizenCognitiveState for L1 internalization
    ):
        """Evaluate all senses for this citizen. Call every tick.

        Args:
            citizen_id: actor ID
            tick: current tick number
            query_fn: callable(cypher, params) → result_set (L3 graph)
            write_fn: callable(cypher, params) → None (L3 graph write)
            state: CitizenCognitiveState for L1 internalization (optional)
        """
        if query_fn is None:
            return

        # Load sense definitions once
        if not self._loaded:
            self._load_senses(citizen_id, query_fn)

        if not self._sense_definitions:
            return

        # Only evaluate every N ticks
        for sense_id, definition in self._sense_definitions.items():
            sense_state = self._states.setdefault(sense_id, SenseState(sense_id=sense_id))

            eval_interval = definition.get("eval_interval", SENSE_EVAL_INTERVAL)
            if tick - sense_state.last_eval_tick < eval_interval:
                continue
            sense_state.last_eval_tick = tick

            # Evaluate the sense
            observation = self._evaluate_sense(sense_id, definition, citizen_id, query_fn)
            if observation:
                sense_state.add_observation(observation)
                sense_state.compute_correlations()

                # Update L3 Thing node with insights
                if write_fn:
                    self._update_l3_sense_node(sense_id, sense_state, write_fn)

                # Internalize: update L1 mirror node if citizen wants it
                if state and definition.get("internalize", False):
                    self._update_l1_mirror(sense_id, sense_state, state)

                logger.debug(
                    f"Sense {sense_id} for {citizen_id}: "
                    f"score={observation.score:.2f}, "
                    f"rolling={sense_state.rolling_score:.2f}, "
                    f"insights={len(sense_state.insights)}"
                )

    def record_observation(self, sense_id: str, observation: Observation):
        """Manually record an observation (for senses that collect data externally).

        Used when data comes from bridges/events rather than graph queries.
        E.g., mentor's welcome sense records from actual conversations.
        """
        sense_state = self._states.setdefault(sense_id, SenseState(sense_id=sense_id))
        sense_state.add_observation(observation)
        sense_state.compute_correlations()

    def get_awareness_text(self, sense_id: str) -> str:
        """Get current awareness text for a sense."""
        state = self._states.get(sense_id)
        if not state:
            return ""
        return state.synthesis_text()

    # ── Internal ─────────────────────────────────────────────────────

    def _load_senses(self, citizen_id: str, query_fn: Callable):
        """Load sense definitions from L3 Thing(type=sense) nodes."""
        rows = _safe_query(query_fn,
            "MATCH (a:Actor {id: $cid})-[:LINK]->(s:Thing) "
            "WHERE s.type = 'sense' "
            "RETURN s.id, s.name, s.content, s.synthesis "
            "LIMIT 20",
            {"cid": citizen_id},
        )

        for row in rows:
            sense_id, name, content, synthesis = row[0], row[1], row[2], row[3]
            if not content:
                continue
            try:
                import yaml
                definition = yaml.safe_load(content)
                if isinstance(definition, dict):
                    definition["_id"] = sense_id
                    definition["_name"] = name or sense_id
                    self._sense_definitions[sense_id] = definition

                    # Restore state from synthesis if available
                    if synthesis:
                        try:
                            saved = json.loads(synthesis)
                            if isinstance(saved, dict) and "rolling_score" in saved:
                                ss = SenseState(sense_id=sense_id)
                                ss.rolling_score = saved.get("rolling_score", 0.0)
                                ss.insights = saved.get("insights", [])
                                self._states[sense_id] = ss
                        except (json.JSONDecodeError, TypeError):
                            pass
            except Exception as e:
                logger.warning(f"Failed to parse sense definition {sense_id}: {e}")

        self._loaded = True
        if self._sense_definitions:
            logger.info(
                f"Loaded {len(self._sense_definitions)} senses for {citizen_id}: "
                f"{list(self._sense_definitions.keys())}"
            )

    def _evaluate_sense(
        self,
        sense_id: str,
        definition: dict,
        citizen_id: str,
        query_fn: Callable,
    ) -> Optional[Observation]:
        """Run the sense's measurement query and build an Observation."""

        measure_query = definition.get("measure_query")
        if not measure_query:
            return None

        rows = _safe_query(query_fn, measure_query, {"cid": citizen_id})
        if not rows:
            return None

        # Each row is one observation
        # Expected columns: variable names as defined in "variables" key
        var_keys = definition.get("variables", [])
        out_keys = definition.get("outcomes", [])
        score_formula = definition.get("score", "mean_outcomes")

        observations = []
        for row in rows:
            variables = {}
            outcomes = {}
            for i, key in enumerate(var_keys):
                if i < len(row):
                    try:
                        variables[key] = float(row[i]) if row[i] is not None else 0.0
                    except (TypeError, ValueError):
                        variables[key] = 0.0
            for i, key in enumerate(out_keys):
                idx = len(var_keys) + i
                if idx < len(row):
                    try:
                        outcomes[key] = float(row[idx]) if row[idx] is not None else 0.0
                    except (TypeError, ValueError):
                        outcomes[key] = 0.0

            # Compute score
            if score_formula == "mean_outcomes" and outcomes:
                score = _mean(list(outcomes.values())) or 0.0
            elif score_formula == "first_outcome" and outcomes:
                score = list(outcomes.values())[0]
            else:
                score = 0.0

            observations.append(Observation(
                timestamp=time.time(),
                variables=variables,
                outcomes=outcomes,
                score=score,
            ))

        # Return most recent observation (or aggregate if needed)
        if observations:
            return observations[-1]
        return None

    def _update_l3_sense_node(self, sense_id: str, sense_state: SenseState, write_fn: Callable):
        """Update the L3 Thing node with current insights."""
        state_data = {
            "rolling_score": round(sense_state.rolling_score, 3),
            "observations": len(sense_state.observations),
            "insights": sense_state.insights[:10],
            "correlations": {
                k: {ok: round(ov, 2) for ok, ov in v.items() if abs(ov) > 0.3}
                for k, v in sense_state.correlations.items()
                if any(abs(ov) > 0.3 for ov in v.values())
            },
        }
        try:
            write_fn(
                "MATCH (s:Thing {id: $sid}) "
                "SET s.synthesis = $synthesis, "
                "    s.energy = $energy, "
                "    s.weight = $weight",
                {
                    "sid": sense_id,
                    "synthesis": json.dumps(state_data),
                    "energy": min(1.0, sense_state.rolling_score),
                    "weight": 0.1 + len(sense_state.observations) * 0.01,
                },
            )
        except Exception as e:
            logger.warning(f"Failed to update L3 sense node {sense_id}: {e}")

    def _update_l1_mirror(self, sense_id: str, sense_state: SenseState, cog_state):
        """Create or update an L1 concept node that mirrors the sense."""
        from .models import Node, NodeType

        mirror_id = f"sense:{sense_id}"
        synthesis = sense_state.synthesis_text()

        if mirror_id in cog_state.nodes:
            # Update existing
            node = cog_state.nodes[mirror_id]
            node.content = synthesis
            node.energy = min(1.0, sense_state.rolling_score)
            node.weight = max(node.weight, 0.5)  # keep it heavy enough to stay in WM
        else:
            # Create new
            node = Node(
                id=mirror_id,
                node_type=NodeType.CONCEPT,
                content=synthesis,
                weight=1.0,       # heavy — stays in WM (internalized)
                energy=0.5,
                stability=0.8,    # resistant to decay
                self_relevance=0.8,
            )
            cog_state.add_node(node)
            logger.info(f"Internalized sense {sense_id} as L1 node {mirror_id}")


# ── Helpers ──────────────────────────────────────────────────────────────────

def _safe_query(query_fn, cypher, params):
    try:
        result = query_fn(cypher, params)
        return result if result else []
    except Exception as e:
        logger.error(f"Sense query failed — cypher={cypher!r} params={params!r}: {e}")
        return []


def _mean(values: list) -> Optional[float]:
    valid = [v for v in values if v is not None]
    if not valid:
        return None
    return sum(valid) / len(valid)


def _pearson(xs: list, ys: list) -> Optional[float]:
    """Pearson correlation coefficient. Returns None if not computable."""
    n = len(xs)
    if n < MIN_OBSERVATIONS_FOR_CORRELATION:
        return None

    mx = sum(xs) / n
    my = sum(ys) / n

    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    dy = math.sqrt(sum((y - my) ** 2 for y in ys))

    if dx == 0 or dy == 0:
        return None

    return num / (dx * dy)
