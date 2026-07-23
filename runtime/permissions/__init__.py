"""
Permissions — HAS_ACCESS graph-gated filesystem access control for citizens.

Citizens run in their own directory (citizens/{handle}/) and can only access
other directories if a HAS_ACCESS link exists in the L2 graph between their
Actor node and the target Space node.

Always allowed (no graph check):
  - Own directory: citizens/{handle}/**
  - Message delivery: citizens/*/messages/ (write only)

Everything else requires a HAS_ACCESS link with the appropriate role.
"""

from .access_check import check_access
from .grant_access import grant_access

__all__ = ["check_access", "grant_access"]
