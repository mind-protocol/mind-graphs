"""Action dispatch — routes process node action_commands to MCP tools."""

from .action_dispatch import (
    parse_action_command,
    compute_context_match,
    record_action_moment,
    write_output_to_filesystem,
)
