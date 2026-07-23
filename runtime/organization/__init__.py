"""
Organization Layer (L2) — The membrane between citizens and the universe.

This layer manages:
- Organization lifecycle (creation, membership, dissolution)
- Space access control and hierarchy
- Moment perception routing between citizens
- Bilateral trust and economic settlement
- Anti-sybil protection
- Task physics (urgency, cascades, crystallization, learning)

Architecture:
  L1 (Brain)  →  L2 (Organization)  →  L3 (Universe)
  Private        Scoped                 Public

The L2 layer was historically eliminated as a separate graph.
Everything is a Space with access control (HAS_ACCESS links).
Organizations are Actors that MANAGE Spaces.

This module provides the operational code that runs at the
organizational scope — between individual brains and the
shared universe.
"""

from runtime.organization.task_physics import (
    compute_urgency,
    cascade_completion,
    crystallize,
    learn_from_outcome,
    apply_task_decay,
    validate_blocks_link,
    create_task,
)
