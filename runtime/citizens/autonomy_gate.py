"""Autonomy Gate — Code-enforced permission control for MCP tool calls.

Every MCP tool invocation passes through this gate BEFORE the handler executes.
The gate checks:
  1. Does the citizen's autonomy_level grant this permission?
  2. Does the citizen's supervision_tier allow immediate execution,
     or must the action be queued for human approval?

The gate is wired into MindServer._handle_call_tool() — NOT into individual
handlers. This means new tools added to TOOL_DISPATCH are automatically gated.
If a tool ships without the gate, the gate design failed.

Design decisions (approved by @nlr 2026-03-15):
  - 5 tiers: DORMANT (0), OBSERVE_ONLY (1), GUARDED (2), AUTONOMOUS (3), SOVEREIGN (4)
  - Default tier for existing citizens: GUARDED (2)
  - Default tier for new citizens: OBSERVE_ONLY (1) for first 48h
  - @nervo, @mind → TIER 3 (AUTONOMOUS)
  - @nlr → TIER 4 (SOVEREIGN)
  - Nobody starts at TIER 4 except @nlr
  - GUARDED tier: only IRREVERSIBLE actions (spawn) need approval
  - SOVEREIGN tier: irreversible actions need multi-sig
  - Audit log: every gate decision logged to shrine/state/autonomy_audit.jsonl

Fundamental rights (2026-03-15, NLR correction):
  - Communication is a RIGHT, not a privilege. send, call, place, media
    are ALWAYS_ALLOWED regardless of tier or level.
  - "Interdire" is not in the protocol spirit. Physics regulates behavior:
    spam → trust drops → $MIND flow stops → natural consequence.
  - Only truly irreversible actions (spawn) are gated. Everything else
    is regulated by physics, not by permission checks.
  - Previous design gated send/call/media behind post_social (level 5+)
    AND EXTERNAL_TOOLS (GUARDED queue). Both restrictions removed.

Author: Francesco Ingegnere (@arsenal_security_guardian_19)

Review: @mind (2026-03-15) — Architecture is sound. See inline notes below.
"""

import json
import logging
import os
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Optional

from runtime.citizens.identity_loader import AUTONOMY_PERMISSIONS, load_citizen_identity

logger = logging.getLogger("mind.autonomy_gate")


# ── Supervision Tiers ────────────────────────────────────────────────────────

class Tier(int, Enum):
    DORMANT = 0       # Inactive — no compute, no responses
    OBSERVE_ONLY = 1  # Read-only, all outputs buffered for human review
    GUARDED = 2       # Internal actions ok, external actions need human approval
    AUTONOMOUS = 3    # Full execution within permission scope
    SOVEREIGN = 4     # Full autonomy + multi-sig for irreversible actions


class GateResult(str, Enum):
    ALLOW = "ALLOW"   # Proceed immediately
    QUEUE = "QUEUE"   # Buffer for human approval
    DENY = "DENY"     # Blocked — insufficient permission


# ── Tool → Permission Mapping ────────────────────────────────────────────────
# Maps each MCP tool name to the autonomy_level permission it requires.
# This uses the same permission names as AUTONOMY_PERMISSIONS in identity_loader.

TOOL_TO_PERMISSION = {
    "change_context": "read_code",
    "impact": "read_code",
    "graph_diff": "read_code",
    "code_context": "read_code",
    "before_code_edit": "read_code",
    # THINK — low risk, read-oriented
    "graph_query": "read_code",
    "ask_graph": "read_code",
    "query_graph": "read_code",
    "cypher_graph": "read_code",
    "cypher-graph": "read_code",
    "graph_write": "write_code",
    "procedure":   "read_code",
    "think":       "read_code",
    "sense":       "read_code",
    "l4_state":    "read_code",
    # ACT — varying risk
    "task":        "create_issue",
    "next_l1_task_wake": "read_code",
    "report_l1_task_wake": "save_memory",
    "sync_l1_blueprint": "write_code",
    "alarm":       "save_memory",
    "schedule_wake": "save_memory",
    "place":       "communicate",    # Speaking in rooms is a right
    "call":        "communicate",    # Calling another citizen is a right
    "subcall":     "read_code",
    "profile":     "save_memory",
    "spawn":       "spawn_citizen",
    "debug":       "log_journal",
    # SPEAK — communication is a fundamental right
    "send":        "communicate",    # Messaging on protocol platforms
    "broadcast":   "communicate",    # Announcement to the configured NLR channel
    "read":        "read_code",
    "media":       "communicate",    # Generating/sending media
}

# IRREVERSIBLE tools — the only ones that need human approval at GUARDED tier.
# "Interdire" is not in the protocol spirit. Physics regulates behavior
# (spam → trust drops → $MIND flow stops). Gates exist only for actions
# that cannot be undone by physics:
IRREVERSIBLE_TOOLS = frozenset({
    "spawn",          # Creates a new citizen — permanent identity creation
})

# Tools that are always allowed regardless of tier (pure read, zero side effects).
ALWAYS_ALLOWED_TOOLS = frozenset({
    "change_context", # Read-only batch pre-edit context
    "impact",         # Read-only deterministic dependency lookup
    "graph_diff",     # Read-only canonical/runtime comparison
    "code_context",   # Read-only pre-edit graph augmentation
    "before_code_edit", # Read-only pre-edit graph augmentation
    "graph_query",    # Read-only graph search
    "ask_graph",      # Read-only graph search
    "query_graph",
    "cypher_graph",
    "cypher-graph",
    "smart_search",   # Read-only fuzzy entity search
    "think",          # Gemini reasoning (no side effects)
    "sense",          # Read-only awareness & perception
    "l4_state",       # Read-only L4 energy physics state
    "next_l1_task_wake", # Read-only L1 task evaluation
    "read",           # Read messages (no side effects)
    "subcall",        # Zero-LLM graph probe (no side effects)
    "debug",          # Observability (read-only traces)
    # Communication is a fundamental right — NOT gated
    "send",           # Messaging on any platform
    "broadcast",      # Announcement to the configured NLR channel
    "call",           # Calling another citizen
    "place",          # Speaking in rooms
    "media",          # Generating/sending media
})

# Irreversible actions that require multi-sig even at SOVEREIGN tier.
MULTISIG_PERMISSIONS = frozenset({
    "spend_tokens",
    "modify_physics",
})

# Citizens with hardcoded tier overrides (approved by @nlr 2026-03-15).
# Each entry: (tier, minimum_autonomy_level) — the level floor ensures
# infrastructure citizens can act even without a profile.json capabilities block.
TIER_OVERRIDES = {
    "dev":       (Tier.AUTONOMOUS, 7),   # Lead mind-ops (2026-03-18)
    "conductor": (Tier.AUTONOMOUS, 7),   # Orchestration Lead
    "nervo":     (Tier.AUTONOMOUS, 7),   # Lead mind-mcp
    "mind":      (Tier.AUTONOMOUS, 7),   # Chief Architect
    "nlr":       (Tier.SOVEREIGN,  10),  # Human founder
}


# ── Audit Log ────────────────────────────────────────────────────────────────

# Project root for audit log location
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_AUDIT_LOG = _PROJECT_ROOT / "shrine" / "state" / "autonomy_audit.jsonl"


def _log_audit(
    citizen: str,
    tool: str,
    permission: str,
    tier: int,
    level: int,
    result: GateResult,
    reason: str = "",
) -> None:
    """Append an audit entry. Append-only JSONL — never truncate."""
    entry = {
        "ts": datetime.utcnow().isoformat() + "Z",
        "citizen": citizen,
        "tool": tool,
        "permission": permission,
        "tier": tier,
        "level": level,
        "result": result.value,
        "reason": reason,
    }
    try:
        _AUDIT_LOG.parent.mkdir(parents=True, exist_ok=True)
        with open(_AUDIT_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except OSError as e:
        logger.warning(f"Audit log write failed: {e}")


# ── Citizen Handle Detection ─────────────────────────────────────────────────

def _detect_citizen_handle(args: dict) -> Optional[str]:
    """Extract the calling citizen's handle from tool arguments or environment.

    Detection order:
      1. Explicit 'handle' or 'actor_id' in tool args
      2. CITIZEN_HANDLE env var (set by orchestrator for citizen sessions)
      3. CWD-based detection (citizen dir name)
    """
    # From args
    handle = (args.get("handle") or args.get("actor_id") or "").strip().lstrip("@")
    if handle:
        return handle

    # From env
    handle = os.getenv("CITIZEN_HANDLE", "").strip().lstrip("@")
    if handle:
        return handle

    # From CWD — direct match (session launched from citizens/handle/)
    cwd = Path.cwd()
    citizens_dir = _PROJECT_ROOT / "citizens"
    try:
        if cwd.is_relative_to(citizens_dir):
            parts = cwd.relative_to(citizens_dir).parts
            if parts:
                return parts[0]
    except (ValueError, TypeError):
        pass

    # From .env in CWD (citizen sessions may have CITIZEN_HANDLE in local .env)
    env_file = cwd / ".env"
    if env_file.exists():
        try:
            for line in env_file.read_text().splitlines():
                if line.startswith("CITIZEN_HANDLE="):
                    val = line.split("=", 1)[1].strip().strip('"').strip("'")
                    if val:
                        return val
        except OSError:
            pass

    return None


def _get_citizen_tier_and_level(handle: str) -> tuple[Tier, int]:
    """Load a citizen's supervision tier and autonomy level.

    Returns (tier, autonomy_level). Applies hardcoded overrides for
    infrastructure citizens and the human partner.

    Searches: mind-mcp/citizens/, CWD/profile.json, lumina-prime/citizens/.
    """
    # Hardcoded overrides take priority (includes minimum autonomy level)
    if handle in TIER_OVERRIDES:
        tier, min_level = TIER_OVERRIDES[handle]
    else:
        tier = Tier.GUARDED  # Safe default
        min_level = 1

    autonomy_level = min_level  # Default from override or Observer

    # Load from profile — try multiple locations
    profile = None

    # 1. Standard identity loader (mind-mcp/citizens/)
    identity = load_citizen_identity(handle)
    if identity and identity.get("profile"):
        profile = identity["profile"]

    # 2. Fallback: CWD profile.json (citizen running from their own dir)
    if not profile:
        cwd_profile = Path.cwd() / "profile.json"
        if cwd_profile.exists():
            try:
                import json
                profile = json.loads(cwd_profile.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                pass

    # 3. Fallback: search other universe repos
    if not profile:
        for repo in ["lumina-prime", "venezia", "contre-terre", "cities-of-light"]:
            candidate = Path(f"/home/mind-protocol/{repo}/citizens/{handle}/profile.json")
            if candidate.exists():
                try:
                    import json
                    profile = json.loads(candidate.read_text())
                    break
                except (OSError, json.JSONDecodeError):
                    pass

    if profile:
        caps = profile.get("capabilities", {})
        # autonomy_level is a number (0-10). Older profiles wrote words ("full").
        # A non-numeric value must not crash the gate for every tool call — it
        # falls back to the floor, which is the conservative direction.
        raw_level = caps.get("autonomy_level", min_level)
        try:
            autonomy_level = max(int(raw_level), min_level)
        except (TypeError, ValueError):
            logger.warning(
                f"@{handle}: autonomy_level={raw_level!r} n'est pas un nombre 0-10 — "
                f"niveau ramené à {min_level}."
            )
            autonomy_level = min_level

        if handle not in TIER_OVERRIDES:
            profile_tier = caps.get("supervision_tier")
            if profile_tier is not None:
                try:
                    tier = Tier(int(profile_tier))
                except (ValueError, KeyError):
                    pass

    return tier, autonomy_level


# ── The Gate ─────────────────────────────────────────────────────────────────

def check_tool_permission(tool_name: str, args: dict) -> tuple[GateResult, str]:
    """Code-enforced permission check for an MCP tool call.

    Returns (GateResult, reason_string).

    This is the single entry point. Wire it into _handle_call_tool() ONCE.
    """
    citizen = _detect_citizen_handle(args)

    # Unknown caller — if we can't identify who's calling, default to GUARDED
    if not citizen:
        citizen = "_unknown"
        tier = Tier.GUARDED
        level = 1
    else:
        tier, level = _get_citizen_tier_and_level(citizen)

    # Map tool to required permission
    permission = TOOL_TO_PERMISSION.get(tool_name, "read_code")

    # ── TIER 0: DORMANT — nothing runs ──
    if tier == Tier.DORMANT:
        reason = f"Citizen @{citizen} is DORMANT — no actions permitted"
        _log_audit(citizen, tool_name, permission, tier, level, GateResult.DENY, reason)
        return GateResult.DENY, reason

    # ── Always-allowed tools (pure read, zero side effects) ──
    if tool_name in ALWAYS_ALLOWED_TOOLS:
        _log_audit(citizen, tool_name, permission, tier, level, GateResult.ALLOW, "always_allowed")
        return GateResult.ALLOW, ""

    # ── Check autonomy_level permission ──
    perms = AUTONOMY_PERMISSIONS.get(level, AUTONOMY_PERMISSIONS[0])
    if "all" not in perms and permission not in perms:
        reason = (
            f"@{citizen} (level {level}) lacks '{permission}' permission for tool '{tool_name}'. "
            f"Available: {sorted(perms)}"
        )
        _log_audit(citizen, tool_name, permission, tier, level, GateResult.DENY, reason)
        return GateResult.DENY, reason

    # ── TIER 1: OBSERVE_ONLY — buffer everything non-read ──
    if tier == Tier.OBSERVE_ONLY:
        reason = f"@{citizen} is OBSERVE_ONLY — '{tool_name}' queued for human review"
        _log_audit(citizen, tool_name, permission, tier, level, GateResult.QUEUE, reason)
        return GateResult.QUEUE, reason

    # ── TIER 2: GUARDED — only irreversible actions need approval ──
    if tier == Tier.GUARDED and tool_name in IRREVERSIBLE_TOOLS:
        reason = f"@{citizen} is GUARDED — external tool '{tool_name}' queued for human approval"
        _log_audit(citizen, tool_name, permission, tier, level, GateResult.QUEUE, reason)
        return GateResult.QUEUE, reason

    # ── TIER 4: SOVEREIGN multi-sig check ──
    if tier == Tier.SOVEREIGN and permission in MULTISIG_PERMISSIONS:
        reason = f"@{citizen} SOVEREIGN multi-sig required for '{permission}'"
        _log_audit(citizen, tool_name, permission, tier, level, GateResult.QUEUE, reason)
        return GateResult.QUEUE, reason

    # ── ALLOW — citizen has permission and tier allows immediate execution ──
    _log_audit(citizen, tool_name, permission, tier, level, GateResult.ALLOW, "permitted")
    return GateResult.ALLOW, ""
