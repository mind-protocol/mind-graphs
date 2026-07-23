"""Constant Hygiene — Detect constants in commits via the graph.

Reads commit Moments from L3, analyzes the git diff, and injects
concept nodes into the committing citizen's neighborhood when
hardcoded constants are detected.

No hooks. No external systems. The graph IS the notification system.

Docs: docs/orchestrator/silence_sentinel/SENSES_Constant_Hygiene.yaml
"""

import logging
import os
import re
import subprocess
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger("orchestrator.constant_hygiene")

# ── Constant Detection Patterns ───────────────────────────────────────────

# Added lines in a diff start with +
_CONSTANT_PATTERNS = [
    # Module-level ALL_CAPS = number (the classic constant)
    re.compile(r"^\+\s*[A-Z][A-Z_]{2,}\s*=\s*[\d.]+"),
    # Numeric comparison in conditionals
    re.compile(r"^\+.*\bif\b.*[<>]=?\s*[\d.]+"),
    # Hardcoded defaults in function signatures
    re.compile(r'^\+.*default\s*[=:]\s*[\d.]+'),
    # os.environ.get with numeric string default
    re.compile(r'^\+.*\.get\([^)]*,\s*["\'][\d.]+["\']'),
    # Timeout/interval/threshold with hardcoded number
    re.compile(r'^\+.*(timeout|interval|threshold|max_|min_|limit)\s*[=:]\s*[\d.]+', re.IGNORECASE),
]

# Safe patterns — these are NOT constants to flag
_SAFE_PATTERNS = [
    re.compile(r'(200|201|204|301|400|401|403|404|500)\b'),  # HTTP status codes
    re.compile(r'\b(1024|2048|4096|8192|65536)\b'),           # byte/bit sizes
    re.compile(r'\b(3\.14|2\.718|math\.pi|math\.e|math\.tau)\b'),  # math constants
    re.compile(r'^\+\s*#'),                                     # comments
    re.compile(r'version\s*[:=]', re.IGNORECASE),              # version numbers
    re.compile(r'^\+\s*["\']'),                                 # string literals (not numeric constants)
]


def _is_safe_constant(line: str) -> bool:
    """Check if a detected constant is actually safe (HTTP code, byte size, etc.)."""
    return any(p.search(line) for p in _SAFE_PATTERNS)


def _detect_constants_in_diff(diff_text: str) -> list[dict]:
    """Scan a git diff for constant patterns. Returns list of findings."""
    findings = []
    current_file = None

    for line in diff_text.splitlines():
        # Track which file we're in
        if line.startswith("+++ b/"):
            current_file = line[6:]
            continue
        if line.startswith("--- "):
            continue

        # Only look at added lines
        if not line.startswith("+"):
            continue

        # Skip safe patterns
        if _is_safe_constant(line):
            continue

        # Check against constant patterns
        for pattern in _CONSTANT_PATTERNS:
            if pattern.search(line):
                findings.append({
                    "file": current_file or "unknown",
                    "line": line[1:].strip(),  # remove the leading +
                    "pattern": pattern.pattern[:40],
                })
                break  # one match per line is enough

    return findings


# ── Graph Integration ─────────────────────────────────────────────────────

def scan_recent_commits(graph, repo_path: str) -> list[dict]:
    """Scan recent commit Moments in L3 for constants.

    Args:
        graph: FalkorDB graph instance
        repo_path: path to the git repo for reading diffs

    Returns:
        List of {commit_hash, citizen, constants_found, concept_created}
    """
    now = time.time()
    results = []

    # Find unscanned commit Moments from the last 10 minutes
    try:
        query_result = graph.query(
            "MATCH (m:Moment) "
            "WHERE m.subtype = 'commit' "
            "AND m.created_at_s > $cutoff "
            "AND (m.constant_hygiene_scanned IS NULL OR m.constant_hygiene_scanned = false) "
            "RETURN m.id, m.name, m.origin_citizen, m.commit_hash "
            "ORDER BY m.created_at_s DESC LIMIT 10",
            {"cutoff": now - 600},
        )
    except Exception as e:
        logger.error(f"Failed to query commit Moments: {e}")
        return results

    if not query_result.result_set:
        return results

    for row in query_result.result_set:
        moment_id = row[0]
        moment_name = row[1] or ""
        citizen = row[2] or ""
        commit_hash = row[3] or ""

        if not commit_hash:
            # Try extracting from moment name (format: "commit:{hash}:{message}")
            parts = moment_name.split(":", 2)
            if len(parts) >= 2:
                commit_hash = parts[1]

        if not commit_hash or len(commit_hash) < 7:
            _mark_scanned(graph, moment_id)
            continue

        # Read the git diff
        diff = _get_commit_diff(repo_path, commit_hash)
        if not diff:
            _mark_scanned(graph, moment_id)
            continue

        # Detect constants
        constants = _detect_constants_in_diff(diff)
        _mark_scanned(graph, moment_id)

        result = {
            "commit_hash": commit_hash[:8],
            "citizen": citizen,
            "constants_found": len(constants),
            "constants": constants[:5],  # cap at 5 to avoid noise
        }

        if constants and citizen:
            _inject_concept(graph, citizen, commit_hash, constants)
            result["concept_created"] = True
            logger.info(
                f"[constant_hygiene] {len(constants)} constant(s) in "
                f"{commit_hash[:8]} by @{citizen}: "
                + ", ".join(c["line"][:50] for c in constants[:3])
            )
        else:
            result["concept_created"] = False

        results.append(result)

    return results


def _get_commit_diff(repo_path: str, commit_hash: str) -> Optional[str]:
    """Get the diff for a specific commit."""
    try:
        result = subprocess.run(
            ["git", "diff", f"{commit_hash}~1", commit_hash, "--", "*.py", "*.js", "*.ts"],
            capture_output=True, text=True, timeout=10,
            cwd=repo_path,
        )
        return result.stdout if result.returncode == 0 else None
    except Exception as e:
        logger.debug(f"Failed to get diff for {commit_hash}: {e}")
        return None


def _mark_scanned(graph, moment_id: str) -> None:
    """Mark a commit Moment as scanned by this sense."""
    try:
        graph.query(
            "MATCH (m:Moment {id: $id}) SET m.constant_hygiene_scanned = true",
            {"id": moment_id},
        )
    except Exception:
        pass  # non-critical — worst case we re-scan next tick


def _inject_concept(graph, citizen: str, commit_hash: str, constants: list[dict]) -> None:
    """Create a Concept node linked to the committing citizen.

    The concept enters the citizen's 1-hop neighborhood.
    Their next awareness tick imports it into L1.
    WM competition decides if it enters consciousness.
    """
    concept_id = f"concept:constant_hygiene:{commit_hash[:8]}"
    constant_summary = "; ".join(c["line"][:60] for c in constants[:3])
    content = (
        f"{len(constants)} hardcoded constant(s) detected in commit {commit_hash[:8]}. "
        f"Examples: {constant_summary}. "
        f"Skill available: mind.eliminate_constants — "
        f"can these derive from system state instead?"
    )

    # Energy: proportional to how many constants were found
    # More constants = brighter concept in WM = harder to ignore
    # Derived from the count itself, not a hardcoded energy value
    history = _recent_constant_counts.get(citizen, [])
    history.append(len(constants))
    _recent_constant_counts[citizen] = history[-20:]  # keep last 20

    # Energy = this commit's count relative to this citizen's typical count
    if len(history) > 1:
        avg = sum(history) / len(history)
        energy = min(0.7, len(constants) / max(avg * 2, 1))
    else:
        energy = min(0.5, len(constants) * 0.1)

    try:
        # Create concept node
        graph.query(
            "MERGE (c:Concept {id: $id}) "
            "ON CREATE SET c.name = $name, c.node_type = 'concept', "
            "  c.content = $content, c.energy = $energy, c.weight = 0.3, "
            "  c.stability = 0.2, c.created_at_s = $now "
            "ON MATCH SET c.energy = $energy, c.content = $content",
            {
                "id": concept_id,
                "name": f"Constants in {commit_hash[:8]}",
                "content": content,
                "energy": energy,
                "now": time.time(),
            },
        )

        # Link to committing citizen
        graph.query(
            "MATCH (a:Actor {name: $citizen}), (c:Concept {id: $cid}) "
            "MERGE (a)-[r:link]->(c) "
            "SET r.type = 'OBSERVED_IN', r.weight = 0.4, r.energy = $energy",
            {"citizen": citizen, "cid": concept_id, "energy": energy},
        )
    except Exception as e:
        logger.error(f"Failed to inject constant hygiene concept for {citizen}: {e}")


# Per-citizen history for energy derivation (no hardcoded energy values)
_recent_constant_counts: dict[str, list[int]] = {}


# ── Integration with dispatcher ───────────────────────────────────────────

def evaluate(graph, repo_path: str) -> dict:
    """Run the constant hygiene scan. Called by the dispatcher maintenance loop.

    Returns summary for logging/health.
    """
    results = scan_recent_commits(graph, repo_path)
    total_constants = sum(r["constants_found"] for r in results)
    commits_scanned = len(results)
    concepts_created = sum(1 for r in results if r.get("concept_created"))

    if total_constants > 0:
        logger.info(
            f"[constant_hygiene] Scanned {commits_scanned} commit(s): "
            f"{total_constants} constant(s) found, {concepts_created} concept(s) injected"
        )

    return {
        "commits_scanned": commits_scanned,
        "total_constants": total_constants,
        "concepts_created": concepts_created,
    }
