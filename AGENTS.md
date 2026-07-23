# Agent instructions

## Graph context before code edits

Graph context augmentation is enabled by default for code changes in this workspace. The user may disable it explicitly for the current task or for named files.

Before every operation that creates or modifies a code file:

1. Call the MCP tool `before_code_edit` with that file's path, `enabled: true`, and `maxDepth: 1` unless the user requested another depth.
2. Read the returned `Thing` anchors and their local nodes before deciding or applying the modification.
3. If one write operation covers several code files, call `before_code_edit` separately for every path before the write.
4. Call it again before a later modification of the same file when the graph may have changed or been reseeded. Otherwise, one call immediately before a contiguous edit sequence is sufficient.

This is an agent protocol, not an MCP hook: MCP cannot intercept native write tools. Do not claim that the call is automatic or technically enforced.

If the user explicitly disables graph augmentation, do not call the tool and continue normally. If `before_code_edit` is unavailable or FalkorDB is unreachable, state that briefly, continue with the code task, and report the missing augmentation in the final response. A missing matching `Thing` is a valid empty result and must not block the edit.

The protocol applies to source code, tests, scripts, stylesheets, templates, and executable configuration. It does not apply to prose-only Markdown or generated artifacts unless they contain executable code being changed.
