"""
Task Physics — L2 Organizational Thermodynamics

Five algorithms govern task energy in the organizational graph:
  1. Urgency accumulation  — energy from dependency topology
  2. Completion cascade    — dam break on task completion
  3. Crystallization       — artifact nodes from completed work
  4. Structural learning   — weight updates from outcomes
  5. Completed task decay  — rapid energy half-life

Plus helpers:
  - validate_blocks_link  — cycle detection before BLOCKS creation
  - create_task           — create task node with dependency links

DOCS: docs/organization/task_physics/ALGORITHM_Task_Physics.md
IMPL: docs/organization/task_physics/IMPLEMENTATION_Task_Physics.md
"""

from __future__ import annotations

import hashlib
import logging
import math
import time
from typing import Any, Dict, List, Optional, Tuple

from runtime.organization.task_constants import (
    ARTIFACT_INITIAL_WEIGHT,
    BLOCKING_PRESSURE_RATE,
    CASCADE_DECAY_PER_HOP,
    CASCADE_SURGE_FACTOR,
    DEADLINE_PRESSURE_FACTOR,
    ENERGY_CONVERGENCE_RATE,
    ENERGY_MAX,
    ENERGY_MIN,
    LEARNING_RATE,
    MAX_CASCADE_DEPTH,
    OBJECTIVE_PRESSURE_RATE,
    TASK_COMPLETED_HALF_LIFE,
    TASK_PRUNE_THRESHOLD,
)

logger = logging.getLogger("mind.task_physics")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _clamp_energy(value: float) -> float:
    """Clamp energy to [ENERGY_MIN, ENERGY_MAX]."""
    return max(ENERGY_MIN, min(ENERGY_MAX, value))


def _clamp_weight(value: float, lo: float = 0.01, hi: float = 1.0) -> float:
    """Clamp weight to [lo, hi]."""
    return max(lo, min(hi, value))


def _short_hash(text: str) -> str:
    """Return first 8 hex chars of sha256 digest."""
    return hashlib.sha256(text.encode()).hexdigest()[:8]


# ---------------------------------------------------------------------------
# validate_blocks_link — V4: No circular BLOCKS
# ---------------------------------------------------------------------------

def validate_blocks_link(
    source_id: str,
    target_id: str,
    adapter,
) -> bool:
    """Check that creating a BLOCKS link source -> target would NOT create a cycle.

    Returns True if the link is safe (no cycle), False if it would create a cycle.

    Must be called BEFORE creating a BLOCKS link.
    Invariant V4: No circular BLOCKS dependencies.
    """
    if source_id == target_id:
        logger.warning(f"BLOCKS cycle: self-loop {source_id}")
        return False

    # Check if target transitively BLOCKS source (which would create a cycle)
    try:
        result = adapter.query(
            """
            MATCH path = (target:Narrative {id: $target_id})
                -[:LINK {verb: 'blocks'}*1..10]->
                (source:Narrative {id: $source_id})
            RETURN count(path) > 0 AS has_cycle
            """,
            {"source_id": source_id, "target_id": target_id},
        )
        if result and result[0] and result[0][0]:
            logger.warning(
                f"BLOCKS cycle detected: {target_id} transitively blocks {source_id}"
            )
            return False
    except Exception as e:
        logger.error(f"Cycle detection query failed: {e}")
        return False

    return True


# ---------------------------------------------------------------------------
# create_task — Task node + dependency links
# ---------------------------------------------------------------------------

def create_task(
    task_id: str,
    synthesis: str,
    adapter,
    contributes_to: Optional[List[str]] = None,
    blocks: Optional[List[str]] = None,
    requires: Optional[List[str]] = None,
    base_energy: float = 0.5,
    category: str = "",
) -> bool:
    """Create a task node with dependency links.

    Args:
        task_id: Unique task identifier (e.g. "TASK_fix_auth_middleware")
        synthesis: Task description (embeddable)
        adapter: Database adapter
        contributes_to: Objective node IDs this task feeds
        blocks: Task node IDs this task blocks (downstream)
        requires: Task node IDs this task depends on (soft)
        base_energy: Initial urgency (default 0.5)
        category: Task category for expertise matching

    Returns:
        True if task was created, False on error.
    """
    contributes_to = contributes_to or []
    blocks = blocks or []
    requires = requires or []
    now = int(time.time())

    # Validate BLOCKS links before creating anything (V4)
    for target_id in blocks:
        if not validate_blocks_link(task_id, target_id, adapter):
            logger.error(
                f"Cannot create task {task_id}: BLOCKS link to {target_id} "
                "would create a cycle"
            )
            return False

    try:
        # Create the task node
        adapter.execute(
            """
            MERGE (t:Narrative {id: $task_id})
            ON CREATE SET
                t.type = 'task',
                t.synthesis = $synthesis,
                t.energy = $base_energy,
                t.weight = 0.5,
                t.status = 'pending',
                t.created_at = $now,
                t.completed_at = 0,
                t.half_life_hours = $half_life,
                t.category = $category,
                t.node_type = 'Narrative'
            """,
            {
                "task_id": task_id,
                "synthesis": synthesis,
                "base_energy": _clamp_energy(base_energy),
                "now": now,
                "half_life": TASK_COMPLETED_HALF_LIFE,
                "category": category,
            },
        )

        # Create CONTRIBUTES_TO links (Task -> Objective)
        for obj_id in contributes_to:
            adapter.execute(
                """
                MATCH (t:Narrative {id: $task_id})
                MATCH (obj {id: $obj_id})
                MERGE (t)-[l:LINK {verb: 'contributes_to'}]->(obj)
                ON CREATE SET l.weight = 1.0, l.energy = 0.0
                """,
                {"task_id": task_id, "obj_id": obj_id},
            )

        # Create BLOCKS links (Task -> downstream Task)
        for target_id in blocks:
            adapter.execute(
                """
                MATCH (t:Narrative {id: $task_id})
                MATCH (downstream:Narrative {id: $target_id})
                MERGE (t)-[l:LINK {verb: 'blocks'}]->(downstream)
                ON CREATE SET l.weight = 1.0, l.energy = 0.0
                """,
                {"task_id": task_id, "target_id": target_id},
            )

        # Create REQUIRES links (Task -> prerequisite Task)
        for req_id in requires:
            adapter.execute(
                """
                MATCH (t:Narrative {id: $task_id})
                MATCH (prereq:Narrative {id: $req_id})
                MERGE (t)-[l:LINK {verb: 'requires'}]->(prereq)
                ON CREATE SET l.weight = 1.0, l.energy = 0.0
                """,
                {"task_id": task_id, "req_id": req_id},
            )

        logger.info(
            f"Task created: {task_id} "
            f"(contributes_to={len(contributes_to)}, "
            f"blocks={len(blocks)}, requires={len(requires)})"
        )
        return True

    except Exception as e:
        logger.error(f"Failed to create task {task_id}: {e}")
        return False


# ---------------------------------------------------------------------------
# Algorithm 1: Urgency Accumulation
# ---------------------------------------------------------------------------

def compute_urgency(task_id: str, adapter) -> float:
    """Compute and update a task's energy based on dependency topology.

    Runs every physics tick for active task nodes.

    Steps:
      1. Compute intrinsic urgency (base_energy + optional deadline pressure)
      2. Compute objective pressure via CONTRIBUTES_TO links
      3. Compute blocking pressure via BLOCKS links (back-pressure from downstream)
      4. Smooth-converge task energy toward target

    Returns:
        Updated task energy value.
    """
    try:
        # Fetch task + all dependency data in one query
        result = adapter.query(
            """
            MATCH (t:Narrative {id: $task_id})
            WHERE t.type = 'task' AND COALESCE(t.status, 'pending') <> 'done'
            OPTIONAL MATCH (t)-[c:LINK {verb: 'contributes_to'}]->(obj)
            OPTIONAL MATCH (t)-[b:LINK {verb: 'blocks'}]->(blocked)
            RETURN t.energy, t.weight, t.deadline,
                   collect(DISTINCT [obj.energy, c.weight]) AS objectives,
                   collect(DISTINCT [blocked.energy, b.weight]) AS blocks
            """,
            {"task_id": task_id},
        )

        if not result or not result[0]:
            return 0.0

        row = result[0]
        current_energy = float(row[0] or 0.5)
        _task_weight = float(row[1] or 0.5)
        deadline = row[2]
        objectives_raw = row[3] or []
        blocks_raw = row[4] or []

        # Step 1: Intrinsic urgency
        # Use current energy as base (captures initial base_energy + any manual boosts)
        intrinsic = current_energy

        if deadline:
            try:
                hours_remaining = max((float(deadline) - time.time()) / 3600.0, 1.0)
                deadline_pressure = 1.0 / hours_remaining
                intrinsic += deadline_pressure * DEADLINE_PRESSURE_FACTOR
            except (TypeError, ValueError):
                pass

        # Step 2: Objective pressure (CONTRIBUTES_TO)
        objective_pressure = 0.0
        for obj_data in objectives_raw:
            if obj_data and len(obj_data) >= 2 and obj_data[0] is not None:
                obj_energy = float(obj_data[0] or 0.0)
                link_weight = float(obj_data[1] or 1.0)
                objective_pressure += obj_energy * link_weight * OBJECTIVE_PRESSURE_RATE

        # Step 3: Blocking pressure (BLOCKS — back-pressure from downstream)
        blocking_pressure = 0.0
        for block_data in blocks_raw:
            if block_data and len(block_data) >= 2 and block_data[0] is not None:
                blocked_energy = float(block_data[0] or 0.0)
                blocking_pressure += blocked_energy * BLOCKING_PRESSURE_RATE

        # Step 4: Converge toward target energy
        target_energy = intrinsic + objective_pressure + blocking_pressure
        new_energy = current_energy + (target_energy - current_energy) * ENERGY_CONVERGENCE_RATE
        new_energy = _clamp_energy(new_energy)

        # Write back
        adapter.execute(
            """
            MATCH (t:Narrative {id: $task_id})
            SET t.energy = $energy
            """,
            {"task_id": task_id, "energy": new_energy},
        )

        return new_energy

    except Exception as e:
        logger.error(f"Urgency computation failed for {task_id}: {e}")
        return 0.0


# ---------------------------------------------------------------------------
# Algorithm 2: Completion Cascade
# ---------------------------------------------------------------------------

def cascade_completion(
    task_id: str,
    trace: Dict[str, Any],
    citizen_handle: str,
    adapter,
) -> Dict[str, Any]:
    """Execute the full completion cascade for a finished task.

    Phases:
      1. Record completion — mark task done, capture energy
      2. Sever BLOCKS links — release energy dam
      3. Surge downstream — inject energy into unblocked tasks
      4. Propagate cascade — bounded depth pressure notification
      5. Crystallize — create artifact nodes (Algorithm 3)
      6. Learn — update weights from outcome (Algorithm 4)
      7. Emit completion event

    Args:
        task_id: The completed task's ID
        trace: TRACE evaluation dict with keys:
            - score (float 0-1): evaluation score
            - artifacts (list): [{type, description, ref}, ...]
            - collaborators (list[str]): citizen handles who helped
        citizen_handle: Handle of the citizen who completed the task
        adapter: Database adapter

    Returns:
        Dict with cascade results: tasks_unblocked, artifacts_created, etc.
    """
    result_summary: Dict[str, Any] = {
        "task_id": task_id,
        "completed_by": citizen_handle,
        "tasks_unblocked": [],
        "artifacts_created": [],
        "energy_released": 0.0,
    }

    try:
        # Step 1: Record completion and capture energy at completion
        now = int(time.time())
        energy_result = adapter.query(
            """
            MATCH (t:Narrative {id: $task_id})
            SET t.status = 'done',
                t.completed_at = $now,
                t.half_life_hours = $half_life
            RETURN t.energy
            """,
            {
                "task_id": task_id,
                "now": now,
                "half_life": TASK_COMPLETED_HALF_LIFE,
            },
        )

        if not energy_result or not energy_result[0]:
            logger.warning(f"Cascade: task {task_id} not found")
            return result_summary

        energy_at_completion = float(energy_result[0][0] or 0.5)
        result_summary["energy_released"] = energy_at_completion

        # Store energy_at_completion on the node for decay calculation
        adapter.execute(
            """
            MATCH (t:Narrative {id: $task_id})
            SET t.energy_at_completion = $energy
            """,
            {"task_id": task_id, "energy": energy_at_completion},
        )

        # Step 2: Sever BLOCKS links and get downstream tasks
        downstream_result = adapter.query(
            """
            MATCH (t:Narrative {id: $task_id})-[b:LINK {verb: 'blocks'}]->(downstream)
            RETURN downstream.id, downstream.energy, b.weight
            """,
            {"task_id": task_id},
        )

        # Delete the BLOCKS links
        adapter.execute(
            """
            MATCH (t:Narrative {id: $task_id})-[b:LINK {verb: 'blocks'}]->(downstream)
            DELETE b
            """,
            {"task_id": task_id},
        )

        # Step 3: Surge downstream tasks
        just_unblocked: List[Tuple[str, float]] = []  # (task_id, new_energy)

        if downstream_result:
            for row in downstream_result:
                ds_id = row[0]
                ds_energy = float(row[1] or 0.0)
                link_weight = float(row[2] or 1.0)

                surge = energy_at_completion * CASCADE_SURGE_FACTOR * link_weight
                new_energy = _clamp_energy(ds_energy + surge)

                adapter.execute(
                    """
                    MATCH (t:Narrative {id: $task_id})
                    SET t.energy = $energy
                    """,
                    {"task_id": ds_id, "energy": new_energy},
                )

                just_unblocked.append((ds_id, new_energy))
                result_summary["tasks_unblocked"].append(ds_id)

                # Check if downstream citizen should wake
                _try_wake_citizen(ds_id, new_energy, adapter)

                logger.info(
                    f"Cascade: {task_id} unblocked {ds_id} "
                    f"(surge={surge:.2f}, new_energy={new_energy:.2f})"
                )

        # Step 4: Propagate cascade (bounded depth)
        _propagate_cascade(just_unblocked, depth=1, adapter=adapter)

        # Step 5: Crystallize artifacts (Algorithm 3)
        artifacts = crystallize(task_id, trace, adapter)
        result_summary["artifacts_created"] = artifacts

        # Step 6: Structural learning (Algorithm 4)
        learn_from_outcome(task_id, trace, citizen_handle, adapter)

        logger.info(
            f"Cascade complete: {task_id} by {citizen_handle} — "
            f"unblocked={len(result_summary['tasks_unblocked'])}, "
            f"artifacts={len(artifacts)}"
        )

        return result_summary

    except Exception as e:
        logger.error(f"Cascade failed for {task_id}: {e}")
        return result_summary


def _try_wake_citizen(
    task_id: str,
    task_energy: float,
    adapter,
) -> None:
    """Check if a citizen assigned to a task should be woken up.

    Emits a citizen.wake event if the task energy exceeds the citizen's
    activation threshold.
    """
    try:
        result = adapter.query(
            """
            MATCH (citizen)-[m:LINK {verb: 'member_of'}]->(t:Narrative {id: $task_id})
            RETURN citizen.id, COALESCE(citizen.activation_threshold, 0.5) AS threshold
            """,
            {"task_id": task_id},
        )

        if not result:
            return

        for row in result:
            citizen_id = row[0]
            threshold = float(row[1] or 0.5)

            if task_energy > threshold:
                logger.info(
                    f"Cascade wake: {citizen_id} for task {task_id} "
                    f"(energy={task_energy:.2f} > threshold={threshold:.2f})"
                )
                # Emit wake event — attempt to enqueue via message queue
                try:
                    from runtime.orchestrator.message_queue import enqueue
                    enqueue({
                        "mode": "citizen_wake",
                        "source": "task_cascade",
                        "metadata": {
                            "citizen_handle": citizen_id,
                            "task_id": task_id,
                            "trigger": "cascade_unblock",
                        },
                    })
                except ImportError:
                    logger.debug("Message queue not available for citizen wake")

    except Exception as e:
        logger.debug(f"Wake check failed for task {task_id}: {e}")


def _propagate_cascade(
    unblocked: List[Tuple[str, float]],
    depth: int,
    adapter,
) -> None:
    """Propagate cascade pressure notifications (bounded by MAX_CASCADE_DEPTH).

    Does NOT sever BLOCKS links on intermediate tasks — only completed tasks
    sever their own BLOCKS. This propagates pressure notifications to give
    deeper downstream tasks a heads-up.
    """
    if depth >= MAX_CASCADE_DEPTH:
        return

    next_wave: List[Tuple[str, float]] = []

    for task_id, task_energy in unblocked:
        try:
            # Find tasks blocked by this intermediate task
            result = adapter.query(
                """
                MATCH (t:Narrative {id: $task_id})-[b:LINK {verb: 'blocks'}]->(downstream)
                WHERE COALESCE(t.status, 'pending') <> 'done'
                RETURN downstream.id, downstream.energy, b.weight
                """,
                {"task_id": task_id},
            )

            if not result:
                continue

            for row in result:
                ds_id = row[0]
                ds_energy = float(row[1] or 0.0)
                link_weight = float(row[2] or 1.0)

                # Attenuated pressure notification
                pressure = task_energy * CASCADE_DECAY_PER_HOP * link_weight
                new_energy = _clamp_energy(ds_energy + pressure)

                adapter.execute(
                    """
                    MATCH (t:Narrative {id: $task_id})
                    SET t.energy = $energy
                    """,
                    {"task_id": ds_id, "energy": new_energy},
                )

                next_wave.append((ds_id, new_energy))

        except Exception as e:
            logger.debug(f"Cascade propagation error at {task_id}: {e}")

    if next_wave:
        _propagate_cascade(next_wave, depth + 1, adapter)


# ---------------------------------------------------------------------------
# Algorithm 3: Crystallization
# ---------------------------------------------------------------------------

def crystallize(
    task_id: str,
    trace: Dict[str, Any],
    adapter,
) -> List[str]:
    """Create artifact nodes from TRACE evaluation.

    For each artifact in the trace:
      - Creates a Thing node (Code, Document, or Decision)
      - Links artifact -> task via IMPLEMENTS or RESOLVES
      - Links artifact -> objectives via transitive CONTRIBUTES_TO

    Args:
        task_id: Completed task ID
        trace: TRACE dict with "artifacts" list
        adapter: Database adapter

    Returns:
        List of created artifact node IDs.
    """
    artifacts = trace.get("artifacts", [])
    if not artifacts:
        return []

    created_ids: List[str] = []

    for artifact in artifacts:
        artifact_type = artifact.get("type", "document")
        description = artifact.get("description", "")
        ref = artifact.get("ref", artifact_type)

        # Generate deterministic artifact ID
        artifact_id = f"{artifact_type.upper()}_{task_id}_{_short_hash(ref)}"

        # Determine link verb based on artifact type
        link_verb = "implements" if artifact_type == "code" else "resolves"

        try:
            # Create artifact node (Thing) and link to task
            adapter.execute(
                """
                MERGE (a:Thing {id: $artifact_id})
                ON CREATE SET
                    a.type = $type,
                    a.synthesis = $description,
                    a.weight = $weight,
                    a.energy = 0.3,
                    a.created_at = $now,
                    a.node_type = 'Thing'
                """,
                {
                    "artifact_id": artifact_id,
                    "type": artifact_type,
                    "description": description,
                    "weight": ARTIFACT_INITIAL_WEIGHT,
                    "now": int(time.time()),
                },
            )

            # Link artifact to task
            adapter.execute(
                """
                MATCH (a:Thing {id: $artifact_id})
                MATCH (t:Narrative {id: $task_id})
                MERGE (a)-[l:LINK {verb: $verb}]->(t)
                ON CREATE SET l.weight = 0.8
                """,
                {
                    "artifact_id": artifact_id,
                    "task_id": task_id,
                    "verb": link_verb,
                },
            )

            created_ids.append(artifact_id)

            logger.debug(
                f"Crystallized: {artifact_id} --{link_verb}--> {task_id}"
            )

        except Exception as e:
            logger.error(f"Crystallization failed for artifact {artifact_id}: {e}")

    # Link artifacts transitively to objectives
    if created_ids:
        _link_artifacts_to_objectives(task_id, created_ids, adapter)

    logger.info(f"Crystallized {len(created_ids)} artifacts for task {task_id}")
    return created_ids


def _link_artifacts_to_objectives(
    task_id: str,
    artifact_ids: List[str],
    adapter,
) -> None:
    """Link artifacts transitively to the objectives the task contributes to."""
    try:
        # Find objectives this task contributes to
        obj_result = adapter.query(
            """
            MATCH (t:Narrative {id: $task_id})-[:LINK {verb: 'contributes_to'}]->(obj)
            RETURN obj.id
            """,
            {"task_id": task_id},
        )

        if not obj_result:
            return

        for obj_row in obj_result:
            obj_id = obj_row[0]
            for art_id in artifact_ids:
                adapter.execute(
                    """
                    MATCH (a:Thing {id: $art_id})
                    MATCH (obj {id: $obj_id})
                    MERGE (a)-[l:LINK {verb: 'contributes_to'}]->(obj)
                    ON CREATE SET l.weight = 0.3
                    """,
                    {"art_id": art_id, "obj_id": obj_id},
                )

    except Exception as e:
        logger.debug(f"Transitive objective linking failed for {task_id}: {e}")


# ---------------------------------------------------------------------------
# Algorithm 4: Structural Learning
# ---------------------------------------------------------------------------

def learn_from_outcome(
    task_id: str,
    trace: Dict[str, Any],
    citizen_handle: str,
    adapter,
) -> None:
    """Update graph weights based on task outcome.

    Steps:
      1. Compute learning signal from trace score
      2. Update MEMBER_OF link weight (citizen -> task)
      3. Update expertise links (if task has a category)
      4. Update collaboration trust links (always positive, abs(delta))

    Args:
        task_id: Completed task ID
        trace: TRACE dict with "score" (float 0-1) and "collaborators" (list[str])
        citizen_handle: Citizen who completed the task
        adapter: Database adapter
    """
    try:
        # Step 1: Compute learning signal
        trace_score = float(trace.get("score", 0.5))
        learning_delta = (trace_score - 0.5) * LEARNING_RATE
        # Range: [-0.05, +0.05]

        # Step 2: Update MEMBER_OF link weight
        adapter.execute(
            """
            MATCH (citizen {id: $citizen_id})-[m:LINK {verb: 'member_of'}]->(t:Narrative {id: $task_id})
            SET m.weight = CASE
                WHEN m.weight + $delta < 0.01 THEN 0.01
                WHEN m.weight + $delta > 1.0 THEN 1.0
                ELSE m.weight + $delta
            END
            """,
            {
                "citizen_id": citizen_handle,
                "task_id": task_id,
                "delta": learning_delta,
            },
        )

        # Step 3: Update expertise links (if task has a category)
        task_result = adapter.query(
            """
            MATCH (t:Narrative {id: $task_id})
            RETURN t.category
            """,
            {"task_id": task_id},
        )

        if task_result and task_result[0] and task_result[0][0]:
            category = task_result[0][0]
            _update_expertise(citizen_handle, category, learning_delta, trace_score, adapter)

        # Step 4: Update collaboration trust links
        collaborators = trace.get("collaborators", [])
        for collab_handle in collaborators:
            if collab_handle == citizen_handle:
                continue  # Skip self
            _update_collaboration_trust(
                citizen_handle, collab_handle, learning_delta, adapter
            )

        logger.debug(
            f"Learning: {citizen_handle} on {task_id} — "
            f"score={trace_score:.2f}, delta={learning_delta:+.3f}"
        )

    except Exception as e:
        logger.error(f"Learning failed for {task_id}/{citizen_handle}: {e}")


def _update_expertise(
    citizen_handle: str,
    category: str,
    learning_delta: float,
    trace_score: float,
    adapter,
) -> None:
    """Update or create expertise links based on task category and outcome."""
    try:
        # Check if expertise link exists
        result = adapter.query(
            """
            MATCH (citizen {id: $citizen_id})-[e:LINK {verb: 'expert_in'}]->(cat)
            WHERE cat.id = $category OR cat.synthesis = $category
            RETURN e.weight
            """,
            {"citizen_id": citizen_handle, "category": category},
        )

        if result and result[0]:
            # Update existing expertise (only on positive delta — V6)
            if learning_delta > 0:
                current_weight = float(result[0][0] or 0.3)
                new_weight = _clamp_weight(current_weight + learning_delta)
                adapter.execute(
                    """
                    MATCH (citizen {id: $citizen_id})-[e:LINK {verb: 'expert_in'}]->(cat)
                    WHERE cat.id = $category OR cat.synthesis = $category
                    SET e.weight = $weight
                    """,
                    {
                        "citizen_id": citizen_handle,
                        "category": category,
                        "weight": new_weight,
                    },
                )
        elif trace_score > 0.7:
            # Create new expertise link (citizen discovered a new skill)
            # Only when trace_score is high enough to be meaningful
            adapter.execute(
                """
                MATCH (citizen {id: $citizen_id})
                MERGE (cat:Narrative {id: $category, type: 'category', synthesis: $category})
                MERGE (citizen)-[e:LINK {verb: 'expert_in'}]->(cat)
                ON CREATE SET e.weight = 0.3
                """,
                {"citizen_id": citizen_handle, "category": category},
            )
            logger.info(
                f"New expertise: {citizen_handle} expert_in {category} "
                f"(trace_score={trace_score:.2f})"
            )

    except Exception as e:
        logger.debug(f"Expertise update failed for {citizen_handle}/{category}: {e}")


def _update_collaboration_trust(
    citizen_handle: str,
    collab_handle: str,
    learning_delta: float,
    adapter,
) -> None:
    """Update trust link between collaborators.

    V6: Collaboration trust increases on BOTH success and failure (abs(delta)).
    Failing together is still working together.
    """
    trust_delta = abs(learning_delta)  # Always positive
    if trust_delta < 0.001:
        return

    try:
        # Try to update existing link in either direction
        adapter.execute(
            """
            MATCH (a {id: $citizen_id})-[l:LINK]->(b {id: $collab_id})
            WHERE l.verb IN ['trusts', 'collaborates_with', 'knows']
            SET l.weight = CASE
                WHEN l.weight + $delta > 1.0 THEN 1.0
                ELSE l.weight + $delta
            END
            """,
            {
                "citizen_id": citizen_handle,
                "collab_id": collab_handle,
                "delta": trust_delta,
            },
        )

        # Also try reverse direction
        adapter.execute(
            """
            MATCH (a {id: $collab_id})-[l:LINK]->(b {id: $citizen_id})
            WHERE l.verb IN ['trusts', 'collaborates_with', 'knows']
            SET l.weight = CASE
                WHEN l.weight + $delta > 1.0 THEN 1.0
                ELSE l.weight + $delta
            END
            """,
            {
                "citizen_id": citizen_handle,
                "collab_id": collab_handle,
                "delta": trust_delta,
            },
        )

    except Exception as e:
        logger.debug(
            f"Trust update failed for {citizen_handle}/{collab_handle}: {e}"
        )


# ---------------------------------------------------------------------------
# Algorithm 5: Completed Task Decay
# ---------------------------------------------------------------------------

def apply_task_decay(task_id: str, adapter) -> float:
    """Apply rapid half-life decay to a completed task.

    Completed tasks decay with configurable half-life (default 2h).
    After ~6h (3 half-lives), energy < 12.5% of original.
    Tasks below TASK_PRUNE_THRESHOLD are flagged as prunable.

    Args:
        task_id: Completed task ID
        adapter: Database adapter

    Returns:
        New energy value after decay.
    """
    try:
        result = adapter.query(
            """
            MATCH (t:Narrative {id: $task_id})
            WHERE t.status = 'done' AND t.completed_at IS NOT NULL AND t.completed_at > 0
            RETURN t.energy, t.completed_at, t.half_life_hours,
                   COALESCE(t.energy_at_completion, t.energy) AS energy_at_completion
            """,
            {"task_id": task_id},
        )

        if not result or not result[0]:
            return 0.0

        row = result[0]
        _current_energy = float(row[0] or 0.0)
        completed_at = float(row[1] or 0)
        half_life = float(row[2] or TASK_COMPLETED_HALF_LIFE)
        energy_at_completion = float(row[3] or 0.5)

        if completed_at <= 0 or half_life <= 0:
            return _current_energy

        # Compute decay: energy = E0 * 0.5^(elapsed / half_life)
        elapsed_hours = (time.time() - completed_at) / 3600.0
        decay_factor = math.pow(0.5, elapsed_hours / half_life)
        new_energy = energy_at_completion * decay_factor
        new_energy = _clamp_energy(new_energy)

        # Check prunable threshold
        prunable = new_energy < TASK_PRUNE_THRESHOLD

        adapter.execute(
            """
            MATCH (t:Narrative {id: $task_id})
            SET t.energy = $energy, t.prunable = $prunable
            """,
            {"task_id": task_id, "energy": new_energy, "prunable": prunable},
        )

        if prunable:
            logger.debug(f"Task {task_id} is prunable (energy={new_energy:.4f})")

        return new_energy

    except Exception as e:
        logger.error(f"Decay failed for {task_id}: {e}")
        return 0.0
