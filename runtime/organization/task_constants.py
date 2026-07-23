"""
Task Physics Constants — L2 Organizational Thermodynamics

All constants for task energy accumulation, cascades, crystallization,
and structural learning.

DOCS: docs/organization/task_physics/ALGORITHM_Task_Physics.md §CONSTANTS
"""

# =============================================================================
# URGENCY ACCUMULATION (Algorithm 1)
# =============================================================================

# How much deadline proximity adds to urgency
# intrinsic += (1 / hours_remaining) * DEADLINE_PRESSURE_FACTOR
DEADLINE_PRESSURE_FACTOR: float = 0.5

# Rate of pressure flow from objectives to tasks via CONTRIBUTES_TO links
# objective_pressure += obj.energy * link.weight * OBJECTIVE_PRESSURE_RATE
OBJECTIVE_PRESSURE_RATE: float = 0.2

# Rate of back-pressure from blocked downstream tasks via BLOCKS links
# blocking_pressure += blocked.energy * BLOCKING_PRESSURE_RATE
BLOCKING_PRESSURE_RATE: float = 0.3

# Smoothing factor for energy convergence (prevents oscillation)
# task.energy += (target - current) * ENERGY_CONVERGENCE_RATE
ENERGY_CONVERGENCE_RATE: float = 0.1

# =============================================================================
# CASCADE (Algorithm 2)
# =============================================================================

# Fraction of blocker energy transferred to each downstream task on completion
# surge = energy_at_completion * CASCADE_SURGE_FACTOR * link.weight
CASCADE_SURGE_FACTOR: float = 0.6

# Energy attenuation per cascade hop (for indirect downstream tasks)
CASCADE_DECAY_PER_HOP: float = 0.3

# Maximum cascade propagation depth (prevents runaway amplification)
MAX_CASCADE_DEPTH: int = 5

# =============================================================================
# DECAY (Algorithm 5)
# =============================================================================

# Completed task energy half-life in hours
# decay_factor = 0.5 ^ (elapsed_hours / TASK_COMPLETED_HALF_LIFE)
TASK_COMPLETED_HALF_LIFE: float = 2.0

# Energy below which a completed task is flagged as prunable
TASK_PRUNE_THRESHOLD: float = 0.01

# =============================================================================
# LEARNING (Algorithm 4)
# =============================================================================

# Weight adjustment per task outcome
# learning_delta = (trace_score - 0.5) * LEARNING_RATE
# Range: [-0.05, +0.05] per task
LEARNING_RATE: float = 0.1

# =============================================================================
# CRYSTALLIZATION (Algorithm 3)
# =============================================================================

# Initial weight for crystallized artifact nodes (stable, no rapid decay)
ARTIFACT_INITIAL_WEIGHT: float = 0.5

# =============================================================================
# ENERGY BOUNDS
# =============================================================================

# Task energy is always clamped to this range
ENERGY_MIN: float = 0.0
ENERGY_MAX: float = 5.0
