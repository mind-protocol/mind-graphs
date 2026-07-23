"""
Schema Validation — Runtime Invariant Enforcement

Enforces invariants from schema-l1.yaml and schema-l3.yaml on every write.
Every node and link that enters the graph MUST pass validation.

INVARIANTS ENFORCED:
  I01: Single universal link type: link (relation_kind is property, not type)
  I02: 5 universal node types: actor, moment, narrative, space, thing
  I03: 7 cognitive types map to universal types
  I04: All floats in specified ranges
  I05: Drives bounded [0, 1]
  I06: Weight >= 0, asymptotic consolidation
  I07: Energy >= 0
  I08: Stability >= 0
  I09: Media stored as URIs — NEVER inline binary
  I10: Stress capped at 0.5
  I11: Working memory bounded 5-7 nodes
  I12: relation_kind NULL at L3
  I13: Structural links protected from forgetting

DOCS: docs/schema/
"""

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("schema.validation")

# ── Constants ───────────────────────────────────────────────────────────────

UNIVERSAL_NODE_TYPES = {"actor", "moment", "narrative", "space", "thing"}

COGNITIVE_TYPE_MAP = {
    "memory": "moment",
    "concept": "thing",
    "narrative": "narrative",
    "value": "narrative",
    "process": "narrative",
    "desire": "narrative",
    "state": "actor",
}

VALID_RELATION_KINDS = {
    "remembers", "relates_to", "cares_about", "wants",
    "follows_process", "supports", "conflicts_with", "evokes",
    "projects_toward", "habitually_checks", "regulates",
    "contains", "abstracts",
    None,  # L3 links have NULL relation_kind
}

STRUCTURAL_RELATION_KINDS = {"contains", "abstracts"}

DRIVE_NAMES = {
    "curiosity", "achievement", "affiliation", "self_preservation",
    "anxiety", "satisfaction", "frustration", "boredom",
}

# Base64 patterns that indicate inline binary
BASE64_PATTERN = re.compile(r"^data:[a-zA-Z]+/[a-zA-Z0-9.+-]+;base64,")

MAX_STRESS = 0.5
MAX_WM_NODES = 7


# ── Result Types ────────────────────────────────────────────────────────────

@dataclass
class ValidationError:
    invariant: str
    field: str
    message: str
    value: Any = None


@dataclass
class ValidationResult:
    valid: bool
    errors: List[ValidationError] = field(default_factory=list)

    def add(self, invariant: str, field_name: str, message: str, value: Any = None):
        self.errors.append(ValidationError(invariant, field_name, message, value))
        self.valid = False

    def merge(self, other: "ValidationResult"):
        if not other.valid:
            self.valid = False
            self.errors.extend(other.errors)


# ── Node Validation ─────────────────────────────────────────────────────────

def validate_node(node: Dict[str, Any], layer: str = "l1") -> ValidationResult:
    """Validate a node dict before graph write.

    Args:
        node: Node properties dict (must include 'type' at minimum)
        layer: 'l1' for cognitive brain, 'l3' for universe graph

    Returns:
        ValidationResult with errors if invalid
    """
    result = ValidationResult(valid=True)
    node_type = node.get("type", "")

    # I02: Universal node type must be valid
    if layer == "l3":
        if node_type and node_type not in UNIVERSAL_NODE_TYPES:
            result.add("I02", "type", f"Invalid L3 node type: {node_type!r}", node_type)
    else:
        # I03: Cognitive type must map to valid universal type
        if node_type and node_type not in COGNITIVE_TYPE_MAP and node_type not in UNIVERSAL_NODE_TYPES:
            result.add("I03", "type",
                       f"Invalid cognitive type: {node_type!r}. "
                       f"Valid: {sorted(COGNITIVE_TYPE_MAP.keys())} or universal: {sorted(UNIVERSAL_NODE_TYPES)}",
                       node_type)

    # I04/I06: Weight >= 0
    weight = node.get("weight")
    if weight is not None and weight < 0:
        result.add("I06", "weight", f"Weight must be >= 0, got {weight}", weight)

    # I04/I07: Energy >= 0
    energy = node.get("energy")
    if energy is not None and energy < 0:
        result.add("I07", "energy", f"Energy must be >= 0, got {energy}", energy)

    # I04/I08: Stability >= 0
    stability = node.get("stability")
    if stability is not None and stability < 0:
        result.add("I08", "stability", f"Stability must be >= 0, got {stability}", stability)

    # I05: Drives bounded [0, 1]
    drives = node.get("drives", {})
    if isinstance(drives, dict):
        for drive_name, drive_value in drives.items():
            if isinstance(drive_value, (int, float)):
                if drive_value < 0 or drive_value > 1:
                    result.add("I05", f"drives.{drive_name}",
                               f"Drive {drive_name} must be [0, 1], got {drive_value}",
                               drive_value)

    # I10: Stress capped at 0.5
    stress = node.get("stress")
    if stress is not None and stress > MAX_STRESS:
        result.add("I10", "stress", f"Stress must be <= {MAX_STRESS}, got {stress}", stress)

    # I09: Media must be URIs, never inline binary
    _validate_media(node, result)

    return result


def _validate_media(node: Dict[str, Any], result: ValidationResult):
    """Check that media fields use URIs, never inline binary."""
    media = node.get("media", {})
    if not isinstance(media, dict):
        return

    for modality, content in media.items():
        if isinstance(content, dict):
            uri = content.get("uri", "")
            if isinstance(uri, str) and BASE64_PATTERN.match(uri):
                result.add("I09", f"media.{modality}.uri",
                           f"Media URI must not be inline base64 — use object storage",
                           uri[:50] + "...")
        elif isinstance(content, str) and BASE64_PATTERN.match(content):
            result.add("I09", f"media.{modality}",
                       f"Media must not be inline base64 — use object storage",
                       content[:50] + "...")

    # Also check legacy fields
    for legacy_field in ("image_uri", "image_embedding"):
        val = node.get(legacy_field, "")
        if isinstance(val, str) and BASE64_PATTERN.match(val):
            result.add("I09", legacy_field,
                       f"Legacy media field must not be inline base64",
                       val[:50] + "...")


# ── Link Validation ─────────────────────────────────────────────────────────

def validate_link(link: Dict[str, Any], layer: str = "l1") -> ValidationResult:
    """Validate a link dict before graph write.

    Args:
        link: Link properties dict
        layer: 'l1' for cognitive brain, 'l3' for universe graph

    Returns:
        ValidationResult with errors if invalid
    """
    result = ValidationResult(valid=True)

    # I01: relation_kind is a property, not a separate type
    relation_kind = link.get("relation_kind")

    # I12: L3 links must have NULL relation_kind
    if layer == "l3" and relation_kind is not None:
        result.add("I12", "relation_kind",
                   f"L3 links must have NULL relation_kind, got {relation_kind!r}",
                   relation_kind)

    # At L1, relation_kind must be from the valid set
    if layer == "l1" and relation_kind is not None:
        if relation_kind not in VALID_RELATION_KINDS:
            result.add("I01", "relation_kind",
                       f"Invalid relation_kind: {relation_kind!r}. "
                       f"Valid: {sorted(k for k in VALID_RELATION_KINDS if k)}",
                       relation_kind)

    # Physics dimensions on links
    for dim in ("weight", "energy", "stability", "trust", "affinity"):
        val = link.get(dim)
        if val is not None and isinstance(val, (int, float)) and val < 0:
            result.add("I04", dim, f"Link {dim} must be >= 0, got {val}", val)

    # Trust is asymptotic — must be < 1.0
    trust = link.get("trust")
    if trust is not None and isinstance(trust, (int, float)) and trust >= 1.0:
        result.add("I04", "trust",
                   f"Trust is asymptotic and must be < 1.0, got {trust}", trust)

    return result


# ── Batch Validation ────────────────────────────────────────────────────────

def validate_nodes_batch(nodes: List[Dict[str, Any]], layer: str = "l1") -> ValidationResult:
    """Validate a batch of nodes."""
    result = ValidationResult(valid=True)
    for i, node in enumerate(nodes):
        node_result = validate_node(node, layer)
        if not node_result.valid:
            for err in node_result.errors:
                err.message = f"Node [{i}] ({node.get('id', 'unknown')}): {err.message}"
            result.merge(node_result)
    return result


def validate_links_batch(links: List[Dict[str, Any]], layer: str = "l1") -> ValidationResult:
    """Validate a batch of links."""
    result = ValidationResult(valid=True)
    for i, link in enumerate(links):
        link_result = validate_link(link, layer)
        if not link_result.valid:
            for err in link_result.errors:
                err.message = f"Link [{i}]: {err.message}"
            result.merge(link_result)
    return result


# ── Working Memory Validation ───────────────────────────────────────────────

def validate_working_memory(wm_nodes: List[Any]) -> ValidationResult:
    """Validate working memory size constraint.

    I11: Working memory bounded at 5-7 nodes.
    """
    result = ValidationResult(valid=True)
    if len(wm_nodes) > MAX_WM_NODES:
        result.add("I11", "working_memory",
                   f"Working memory has {len(wm_nodes)} nodes, max is {MAX_WM_NODES}",
                   len(wm_nodes))
    return result


# ── Structural Link Protection ──────────────────────────────────────────────

def validate_forgetting_candidates(
    candidates: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Filter forgetting candidates — structural links are protected.

    I13: Structural links (contains, abstracts) cannot be forgotten.

    Returns:
        (allowed, protected) — nodes that can be forgotten and those that can't
    """
    allowed = []
    protected = []

    for candidate in candidates:
        relation_kind = candidate.get("relation_kind")
        if relation_kind in STRUCTURAL_RELATION_KINDS:
            protected.append(candidate)
        else:
            allowed.append(candidate)

    if protected:
        logger.info(
            f"Protected {len(protected)} structural links from forgetting "
            f"(relation_kinds: {set(c.get('relation_kind') for c in protected)})"
        )

    return allowed, protected


# ── Convenience ─────────────────────────────────────────────────────────────

def validate_write(
    nodes: Optional[List[Dict[str, Any]]] = None,
    links: Optional[List[Dict[str, Any]]] = None,
    layer: str = "l1",
) -> ValidationResult:
    """Validate a complete write operation (nodes + links).

    Call this before any graph write to enforce all invariants.
    """
    result = ValidationResult(valid=True)

    if nodes:
        result.merge(validate_nodes_batch(nodes, layer))
    if links:
        result.merge(validate_links_batch(links, layer))

    if not result.valid:
        logger.warning(
            f"Validation FAILED: {len(result.errors)} errors — "
            f"{', '.join(e.invariant for e in result.errors[:5])}"
        )

    return result
