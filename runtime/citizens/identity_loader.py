"""Citizen identity loading and permission management.

Citizen identity loading and permission management.
Loads citizen profiles from citizens/{handle}/ directories.

Autonomy model:
  - Numeric levels 0-10 (canonical) with cumulative permission sets
  - Zone labels (awake_required / guarded / autonomous) mapped over numeric scale
  - Circuit breaker: consecutive rejections auto-downgrade within a session
  - Audit trail: every permission check is logged as structured JSON
"""

import json
import logging
import os
import time
from collections import defaultdict
from pathlib import Path
from typing import Optional

logger = logging.getLogger("citizens.identity")
_audit_logger = logging.getLogger("citizens.autonomy.audit")

# Default: citizens/ at project root
# Can be overridden via set_citizens_dir() or CITIZENS_DIR / WORLD_ROOT env vars
_citizens_dir: Optional[Path] = None

# mind-mcp project root
_PROJECT_ROOT: Path = Path(__file__).resolve().parent.parent.parent


def get_citizens_dir() -> Path:
    """Return the citizens base directory.

    Resolution priority:
      1. Explicit override via set_citizens_dir()
      2. CITIZENS_DIR env var
      3. WORLD_ROOT env var / citizens
      4. Submodule layout: mind-mcp at {world_repo}/.mind/mind-mcp/ -> ../../citizens
      5. Sibling world repo with citizens/ (standalone layout)
      6. Fallback: mind-mcp/citizens/ (local)
    """
    if _citizens_dir is not None:
        return _citizens_dir

    if os.environ.get("CITIZENS_DIR"):
        return Path(os.environ["CITIZENS_DIR"])
    if os.environ.get("WORLD_ROOT"):
        return Path(os.environ["WORLD_ROOT"]) / "citizens"

    # Submodule layout: mind-mcp at {world_repo}/.mind/mind-mcp/
    submodule_citizens = _PROJECT_ROOT.parent.parent / "citizens"
    if submodule_citizens.is_dir():
        # Verify it has actual citizen dirs (not just a stray folder)
        has_citizens = any(
            (d / "CLAUDE.md").exists()
            for d in submodule_citizens.iterdir()
            if d.is_dir()
        )
        if has_citizens:
            return submodule_citizens

    # Standalone layout: look for sibling world repo with citizens/
    # Use L3_GRAPH / FALKORDB_GRAPH as hint for the world repo name
    workspace = _PROJECT_ROOT.parent
    graph_hint = os.environ.get("L3_GRAPH", os.environ.get("FALKORDB_GRAPH", ""))
    if graph_hint:
        hinted = workspace / graph_hint / "citizens"
        if hinted.is_dir():
            return hinted

    for sibling in sorted(workspace.iterdir()):
        if sibling.is_dir() and sibling.name != "mind-mcp":
            candidate = sibling / "citizens"
            if candidate.is_dir():
                has_citizens = any(
                    (d / "CLAUDE.md").exists()
                    for d in candidate.iterdir()
                    if d.is_dir()
                )
                if has_citizens:
                    return candidate

    # Fallback: local citizens/ dir
    return _PROJECT_ROOT / "citizens"


def set_citizens_dir(path: Path) -> None:
    """Override the citizens base directory (e.g. for tests or alternate layouts)."""
    global _citizens_dir
    _citizens_dir = path


# ── Autonomy Permissions ────────────────────────────────────────────────────

AUTONOMY_PERMISSIONS = {
    # Communication is a fundamental right at ALL levels.
    # "communicate" = speak in protocol spaces (Discord, TG channels, Places, call)
    # "post_social" = post to external/public platforms (Twitter, email, public announcements)
    #
    # Level 0-1: Observer — can read, report, ask questions, and SPEAK
    0: {"read_code", "log_journal", "ask_help", "communicate"},
    1: {"read_code", "log_journal", "ask_help", "save_memory", "communicate"},
    # Level 2-3: Contributor — can write code in assigned repos
    2: {"read_code", "log_journal", "ask_help", "save_memory", "write_code", "communicate"},
    3: {"read_code", "log_journal", "ask_help", "save_memory", "write_code", "create_branch", "communicate"},
    # Level 4-5: Builder — can commit, post to external platforms, create issues
    4: {"read_code", "log_journal", "ask_help", "save_memory", "write_code", "create_branch", "commit", "communicate"},
    5: {"read_code", "log_journal", "ask_help", "save_memory", "write_code", "create_branch", "commit", "post_social", "communicate", "create_issue"},
    # Level 6-7: Leader — can spawn other citizen sessions, assign tasks
    6: {"read_code", "log_journal", "ask_help", "save_memory", "write_code", "create_branch", "commit", "post_social", "communicate", "create_issue", "spawn_citizen", "assign_task"},
    7: {"read_code", "log_journal", "ask_help", "save_memory", "write_code", "create_branch", "commit", "post_social", "communicate", "create_issue", "spawn_citizen", "assign_task", "push_code"},
    # Level 8-9: Sovereign — can create orgs, spend tokens
    8: {"read_code", "log_journal", "ask_help", "save_memory", "write_code", "create_branch", "commit", "post_social", "communicate", "create_issue", "spawn_citizen", "assign_task", "push_code", "create_org", "spend_tokens"},
    9: {"read_code", "log_journal", "ask_help", "save_memory", "write_code", "create_branch", "commit", "post_social", "communicate", "create_issue", "spawn_citizen", "assign_task", "push_code", "create_org", "spend_tokens", "modify_physics"},
    # Level 10: Full autonomy
    10: {"all"},
}

# ── Autonomy Zones (legacy) ────────────────────────────────────────────────
# Original 3-zone model. Kept for backward compatibility.
# Superseded by the 5-tier supervision model in autonomy_gate.py.

AUTONOMY_ZONES = {
    "awake_required": (0, 3),   # → maps to Tier 1 (OBSERVE_ONLY)
    "guarded":        (4, 6),   # → maps to Tier 2 (GUARDED)
    "autonomous":     (7, 10),  # → maps to Tier 3 (AUTONOMOUS)
}


def autonomy_zone(level: int) -> str:
    """Map a numeric autonomy level (0-10) to its legacy zone label.

    Returns one of: 'awake_required', 'guarded', 'autonomous'.
    Prefer supervision_tier from autonomy_gate.py for new code.
    """
    for zone, (lo, hi) in AUTONOMY_ZONES.items():
        if lo <= level <= hi:
            return zone
    return "awake_required"  # safe default


def zone_bounds(zone: str) -> tuple:
    """Return (min_level, max_level) for a zone label."""
    return AUTONOMY_ZONES.get(zone, (0, 3))


# ── Supervision Tier (new) ────────────────────────────────────────────────
# 5-tier model: DORMANT(0), OBSERVE_ONLY(1), GUARDED(2), AUTONOMOUS(3), SOVEREIGN(4)
# See runtime/citizens/autonomy_gate.py for enforcement logic.
# The tier is read from profile.json capabilities.supervision_tier.

DEFAULT_SUPERVISION_TIER = 2  # GUARDED — safe default, earn your way up


# ── Circuit Breaker ────────────────────────────────────────────────────────
# Session-scoped: 3 consecutive rejected citizen_can() checks → auto-downgrade
# one level for the rest of the session. Resets on next session or on a grant.

_CIRCUIT_BREAKER_THRESHOLD = 3

# {handle: consecutive_rejection_count}
_rejection_counts: dict[str, int] = defaultdict(int)
# {handle: levels_downgraded_this_session}
_session_downgrades: dict[str, int] = defaultdict(int)


def _circuit_breaker_check(handle: str, granted: bool) -> int:
    """Update circuit breaker state after a permission check.

    Returns the current downgrade offset for this citizen (0 = no downgrade).
    """
    if granted:
        # Success resets the consecutive rejection counter
        _rejection_counts[handle] = 0
        return _session_downgrades[handle]

    _rejection_counts[handle] += 1
    if _rejection_counts[handle] >= _CIRCUIT_BREAKER_THRESHOLD:
        _session_downgrades[handle] += 1
        _rejection_counts[handle] = 0  # reset counter after downgrade
        logger.warning(
            "circuit_breaker: @%s downgraded by %d level(s) this session",
            handle, _session_downgrades[handle],
        )
    return _session_downgrades[handle]


def reset_circuit_breaker(handle: Optional[str] = None) -> None:
    """Reset circuit breaker state. Call at session start.

    If handle is None, resets all citizens.
    """
    if handle:
        _rejection_counts.pop(handle, None)
        _session_downgrades.pop(handle, None)
    else:
        _rejection_counts.clear()
        _session_downgrades.clear()


def get_effective_autonomy_level(handle: str) -> int:
    """Get a citizen's autonomy level after circuit breaker adjustments."""
    citizen = load_citizen_identity(handle)
    if not citizen:
        return 0
    caps = citizen.get("profile", {}).get("capabilities", {})
    # autonomy_level est un nombre 0-10. D'anciens profils ont écrit des mots
    # ("full"), ce qui faisait crasher TOUTE lecture d'identité de ce citoyen.
    # `autonomy_gate` applique déjà cette coercition ; elle manquait ici. On
    # retombe sur le plancher — la direction conservatrice, jamais l'inverse —
    # et on le journalise pour que la donnée invalide reste visible plutôt que
    # devinée silencieusement.
    raw_level = caps.get("autonomy_level", 1)
    try:
        base_level = int(raw_level)
    except (TypeError, ValueError):
        logger.warning(
            f"@{handle}: autonomy_level={raw_level!r} n'est pas un nombre 0-10 — "
            "niveau ramené à 1. Corrige le profil : ce citoyen est traité comme "
            "le plus restreint tant que la valeur n'est pas numérique."
        )
        base_level = 1
    downgrade = _session_downgrades.get(handle, 0)
    return max(0, base_level - downgrade)


def load_citizen_identity(handle: str) -> Optional[dict]:
    """Load a citizen's identity from their directory.

    Returns dict with:
      - handle: citizen handle
      - dir: path to citizen directory
      - claude_md: full CLAUDE.md text
      - profile: parsed profile.json
      - memory_index: MEMORY.md contents
      - memories: list of {file, content} from memory/ subdirectory

    Returns None if citizen directory doesn't exist.
    """
    citizen_dir = get_citizens_dir() / handle
    if not citizen_dir.exists():
        return None

    result = {"handle": handle, "dir": str(citizen_dir)}

    # Load CLAUDE.md
    claude_md = citizen_dir / "CLAUDE.md"
    if claude_md.exists():
        try:
            result["claude_md"] = claude_md.read_text()
        except OSError:
            result["claude_md"] = ""
    else:
        result["claude_md"] = ""

    # Load profile.json
    profile_json = citizen_dir / "profile.json"
    if profile_json.exists():
        try:
            result["profile"] = json.loads(profile_json.read_text())
        except (OSError, json.JSONDecodeError):
            result["profile"] = {}
    else:
        result["profile"] = {}

    # Load MEMORY.md index
    memory_md = citizen_dir / "MEMORY.md"
    if memory_md.exists():
        try:
            result["memory_index"] = memory_md.read_text()
        except OSError:
            result["memory_index"] = ""
    else:
        result["memory_index"] = ""

    # Load individual memory files
    memory_dir = citizen_dir / "memory"
    memories = []
    if memory_dir.exists():
        for mf in sorted(memory_dir.glob("*.md")):
            try:
                memories.append({"file": mf.name, "content": mf.read_text()})
            except OSError:
                pass
    result["memories"] = memories

    return result


def list_available_citizens() -> list:
    """List all birthed citizens with loaded profiles.

    A citizen is "birthed" if their directory contains a CLAUDE.md file.
    Returns list of dicts with handle, name, archetype, universe, organization.
    """
    base = get_citizens_dir()
    if not base.exists():
        return []

    citizens = []
    for d in sorted(base.iterdir()):
        if d.is_dir() and (d / "CLAUDE.md").exists():
            profile = {}
            pf = d / "profile.json"
            if pf.exists():
                try:
                    profile = json.loads(pf.read_text())
                except (OSError, json.JSONDecodeError):
                    pass
            identity = profile.get("identity", {})
            citizens.append({
                "handle": d.name,
                "name": identity.get("name", d.name),
                "archetype": identity.get("personality_archetype", "unknown"),
                "universe": identity.get("universe", "unknown"),
                "organization": identity.get("organization"),
            })
    return citizens


def get_citizen_permissions(handle: str) -> set:
    """Get the permission set for a citizen based on their effective autonomy level.

    Takes circuit breaker downgrades into account.
    """
    level = get_effective_autonomy_level(handle)
    return AUTONOMY_PERMISSIONS.get(level, AUTONOMY_PERMISSIONS[0])


def citizen_can(handle: str, action: str) -> bool:
    """Check if a citizen has permission to perform an action.

    Applies circuit breaker logic and emits an audit log entry.
    """
    level = get_effective_autonomy_level(handle)
    perms = AUTONOMY_PERMISSIONS.get(level, AUTONOMY_PERMISSIONS[0])
    granted = "all" in perms or action in perms

    # Circuit breaker: track consecutive rejections
    _circuit_breaker_check(handle, granted)

    # Audit trail: structured log for every permission check
    zone = autonomy_zone(level)
    downgrade = _session_downgrades.get(handle, 0)
    _audit_logger.info(
        json.dumps({
            "event": "permission_check",
            "citizen": handle,
            "action": action,
            "level": level,
            "zone": zone,
            "granted": granted,
            "downgrade_active": downgrade,
            "ts": time.time(),
        })
    )

    return granted
