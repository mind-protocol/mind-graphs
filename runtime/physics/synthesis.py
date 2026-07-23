"""
Synthesis — v1.6.1 Grammar Floats ↔ Phrases

Bidirectional conversion between physics floats and natural language phrases.

FORWARD (floats → phrases):
    Given link/node physics values, generate natural language description.

BACKWARD (phrases → floats):
    Given natural language input, parse into approximate physics values.

DOCS: docs/schema/GRAMMAR_Link_Synthesis.md
"""

from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, field
import json
import re
import time
from pathlib import Path


# =============================================================================
# VOCABULARY (English default)
# =============================================================================

VERBS = {
    # Base verbs from hierarchy + polarity
    'encompasses': 'encompasses',
    'contains': 'contains',
    'elaborates': 'elaborates',
    'exemplifies': 'exemplifies',
    'acts_on': 'acts on',
    'influences': 'influences',
    'interacts_with': 'interacts with',
    'receives_from': 'receives from',
    'undergoes': 'undergoes',
    'linked_to': 'is linked to',
    'coexists_with': 'coexists with',

    # Ownership
    'belongs_to': 'belongs to',
    'owns': 'owns',
    'possesses': 'possesses',
    'holds': 'holds',
    'uses': 'uses',
    'depends_on': 'depends on',

    # Evidential
    'proves': 'proves',
    'confirms': 'confirms',
    'contradicts': 'contradicts',
    'supports': 'supports',
    'suggests': 'suggests',
    'evokes': 'evokes',

    # Actor-specific
    'believes_in': 'believes in',
    'doubts': 'doubts',
    'expresses': 'expresses',
    'created': 'created',
}

PRE_MODIFIERS = {
    # From permanence
    'definitely': (0.8, 1.0, 'permanence'),
    'clearly': (0.6, 0.8, 'permanence'),
    'probably': (0.2, 0.4, 'permanence'),
    'perhaps': (0.0, 0.2, 'permanence'),

    # From energy
    'intensely': (8.0, float('inf'), 'energy'),
    'actively': (5.0, 8.0, 'energy'),
    'weakly': (0.5, 2.0, 'energy'),
    'barely': (0.0, 0.5, 'energy'),
}

POST_MODIFIERS = {}

WEIGHT_ANNOTATIONS = {
    'fundamental': (5.0, float('inf')),
    'important': (3.0, 5.0),
    'minor': (0.0, 1.0),
}

INTENSIFIERS = {
    # verb_key: (attenuated, intensified)
    'believes_in': ('tends to believe', 'firmly believes'),
    'doubts': ('hesitates about', 'rejects'),
    'contradicts': ('nuances', 'radically contradicts'),
    'confirms': ('supports', 'absolutely confirms'),
    'influences': ('touches', 'dominates'),
    'contains': ('borders', 'imprisons'),
    'proves': ('suggests', 'demonstrates'),
    'expresses': ('sketches', 'proclaims'),
}


# =============================================================================
# FORWARD SYNTHESIS (Floats → Phrases)
# =============================================================================

@dataclass
class LinkPhysics:
    """Physics values for a link."""
    polarity_ab: float = 0.5
    polarity_ba: float = 0.5
    hierarchy: float = 0.0
    permanence: float = 0.5
    energy: float = 1.0
    weight: float = 1.0


def get_base_verb_key(hierarchy: float, polarity_ab: float, polarity_ba: float) -> str:
    """Determine base verb from hierarchy and polarity."""
    # Hierarchy-dominant
    if abs(hierarchy) > 0.5:
        if hierarchy < -0.7:
            return 'encompasses'
        elif hierarchy < -0.5:
            return 'contains'
        elif hierarchy > 0.7:
            return 'exemplifies'
        else:
            return 'elaborates'

    # Polarity-dominant
    if polarity_ab > 0.7 and polarity_ba < 0.3:
        return 'acts_on'
    elif polarity_ab > 0.7 and polarity_ba > 0.7:
        return 'interacts_with'
    elif polarity_ab > 0.7:
        return 'influences'
    elif polarity_ba > 0.7 and polarity_ab < 0.3:
        return 'undergoes'
    elif polarity_ba > 0.7:
        return 'receives_from'
    elif polarity_ab < 0.3 and polarity_ba < 0.3:
        return 'coexists_with'
    else:
        return 'linked_to'


def compute_intensity(permanence: float, polarity_ab: float, polarity_ba: float) -> float:
    """Compute intensity for verb modification."""
    polarity_strength = abs(polarity_ab - polarity_ba)
    return (permanence + polarity_strength) / 2


def apply_intensifier(verb_key: str, intensity: float) -> str:
    """Apply attenuated or intensified verb form."""
    if verb_key in INTENSIFIERS:
        attenuated, intensified = INTENSIFIERS[verb_key]
        if intensity < 0.4:
            return attenuated
        elif intensity > 0.8:
            return intensified

    return VERBS.get(verb_key, verb_key)


def get_pre_modifiers(physics: LinkPhysics) -> List[str]:
    """Get pre-modifiers based on physics values."""
    modifiers = []

    # Energy
    if physics.energy > 8.0:
        modifiers.append('intensely')
    elif physics.energy < 0.5:
        modifiers.append('barely')

    # Permanence
    if physics.permanence > 0.8:
        modifiers.append('definitely')
    elif physics.permanence < 0.2:
        modifiers.append('perhaps')
    elif physics.permanence < 0.4:
        modifiers.append('probably')
    elif physics.permanence > 0.6:
        modifiers.append('clearly')

    return modifiers[:2]  # Max 2


def get_post_modifiers(physics: LinkPhysics) -> List[str]:
    """Get post-modifiers based on physics values."""
    return []


def get_weight_annotation(weight: float) -> Optional[str]:
    """Get weight annotation."""
    if weight > 5.0:
        return '(fundamental)'
    elif weight > 3.0:
        return '(important)'
    elif weight < 1.0:
        return '(minor)'
    return None


def synthesize_link(physics: LinkPhysics) -> str:
    """
    Generate natural language synthesis from link physics.

    Args:
        physics: LinkPhysics values

    Returns:
        Natural language description
    """
    # Get base verb
    verb_key = get_base_verb_key(
        physics.hierarchy,
        physics.polarity_ab,
        physics.polarity_ba,
    )

    # Apply intensifier
    intensity = compute_intensity(
        physics.permanence,
        physics.polarity_ab,
        physics.polarity_ba,
    )
    verb = apply_intensifier(verb_key, intensity)

    # Get modifiers
    pre_mods = get_pre_modifiers(physics)
    post_mods = get_post_modifiers(physics)

    # Assemble
    parts = []
    if pre_mods:
        parts.append(' '.join(pre_mods))
    parts.append(verb)
    if post_mods:
        parts.append(' and '.join(post_mods))

    result = ' '.join(parts)

    # Add weight annotation
    weight_ann = get_weight_annotation(physics.weight)
    if weight_ann:
        result = f"{result} {weight_ann}"

    return result


def synthesize_from_dict(link_dict: Dict[str, Any]) -> str:
    """
    Generate synthesis from link dictionary.

    Args:
        link_dict: Link with physics fields

    Returns:
        Natural language description
    """
    physics = LinkPhysics(
        polarity_ab=link_dict.get('polarity_ab', link_dict.get('polarity', [0.5, 0.5])[0] if isinstance(link_dict.get('polarity'), list) else 0.5),
        polarity_ba=link_dict.get('polarity_ba', link_dict.get('polarity', [0.5, 0.5])[1] if isinstance(link_dict.get('polarity'), list) else 0.5),
        hierarchy=link_dict.get('hierarchy', 0.0),
        permanence=link_dict.get('permanence', link_dict.get('weight', 1.0) / (link_dict.get('weight', 1.0) + 1)),
        energy=link_dict.get('energy', 1.0),
        weight=link_dict.get('weight', 1.0),
    )
    return synthesize_link(physics)


# =============================================================================
# BACKWARD PARSING (Phrases → Floats)
# =============================================================================

@dataclass
class ParsedPhysics:
    """Parsed physics values with confidence."""
    polarity_ab: float = 0.5
    polarity_ba: float = 0.5
    hierarchy: float = 0.0
    permanence: float = 0.5
    energy: float = 1.0
    weight: float = 1.0
    confidence: float = 0.0  # 0-1 how confident in parse


# Reverse mappings for parsing
VERB_TO_PHYSICS = {
    'encompasses': {'hierarchy': -0.8},
    'contains': {'hierarchy': -0.6},
    'elaborates': {'hierarchy': 0.6},
    'exemplifies': {'hierarchy': 0.8},
    'acts on': {'polarity_ab': 0.9, 'polarity_ba': 0.1},
    'influences': {'polarity_ab': 0.8, 'polarity_ba': 0.5},
    'interacts with': {'polarity_ab': 0.8, 'polarity_ba': 0.8},
    'receives from': {'polarity_ab': 0.5, 'polarity_ba': 0.8},
    'undergoes': {'polarity_ab': 0.1, 'polarity_ba': 0.9},
    'is linked to': {'polarity_ab': 0.5, 'polarity_ba': 0.5},
    'coexists with': {'polarity_ab': 0.2, 'polarity_ba': 0.2},

    # Intensified forms
    'firmly believes': {'polarity_ab': 0.9, 'permanence': 0.9},
    'believes in': {'polarity_ab': 0.8},
    'tends to believe': {'polarity_ab': 0.6, 'permanence': 0.3},
    'doubts': {'polarity_ab': 0.7},
    'rejects': {'polarity_ab': 0.9, 'permanence': 0.9},
    'contradicts': {'permanence': 0.8},
    'radically contradicts': {'permanence': 0.95},
    'confirms': {'permanence': 0.8},
    'absolutely confirms': {'permanence': 0.95},
    'supports': {'permanence': 0.6},
    'dominates': {'polarity_ab': 0.95, 'hierarchy': 0.6},
    'touches': {'polarity_ab': 0.5, 'permanence': 0.3},
    'demonstrates': {'permanence': 0.95},
    'suggests': {'permanence': 0.5},
    'proclaims': {'polarity_ab': 0.9, 'permanence': 0.9},
    'expresses': {'polarity_ab': 0.8},
    'sketches': {'polarity_ab': 0.5, 'permanence': 0.3},
}

PRE_MODIFIER_TO_PHYSICS = {
    'definitely': {'permanence': 0.9},
    'clearly': {'permanence': 0.7},
    'probably': {'permanence': 0.3},
    'perhaps': {'permanence': 0.1},
    'intensely': {'energy': 9.0},
    'actively': {'energy': 6.0},
    'weakly': {'energy': 1.0},
    'barely': {'energy': 0.3},
}

POST_MODIFIER_TO_PHYSICS = {}

WEIGHT_TO_PHYSICS = {
    'fundamental': 6.0,
    'important': 4.0,
    'minor': 0.5,
}


def parse_phrase(phrase: str) -> ParsedPhysics:
    """
    Parse natural language phrase into physics values.

    Args:
        phrase: Natural language description (e.g., "definitely influences with confidence")

    Returns:
        ParsedPhysics with estimated values and confidence
    """
    result = ParsedPhysics()
    phrase_lower = phrase.lower().strip()
    matches = 0

    # Check weight annotations
    for annotation, weight in WEIGHT_TO_PHYSICS.items():
        if f'({annotation})' in phrase_lower:
            result.weight = weight
            phrase_lower = phrase_lower.replace(f'({annotation})', '').strip()
            matches += 1

    # Check pre-modifiers
    for modifier, physics in PRE_MODIFIER_TO_PHYSICS.items():
        if modifier in phrase_lower:
            for key, value in physics.items():
                setattr(result, key, value)
            matches += 1

    # Check post-modifiers
    for modifier, physics in POST_MODIFIER_TO_PHYSICS.items():
        if modifier in phrase_lower:
            for key, value in physics.items():
                setattr(result, key, value)
            matches += 1

    # Check verbs (longest match first)
    verb_matches = sorted(VERB_TO_PHYSICS.keys(), key=len, reverse=True)
    for verb in verb_matches:
        if verb in phrase_lower:
            for key, value in VERB_TO_PHYSICS[verb].items():
                setattr(result, key, value)
            matches += 1
            break

    # Calculate confidence based on matches
    # More matches = higher confidence
    result.confidence = min(1.0, matches / 4.0)

    return result


def parse_and_merge(
    phrase: str,
    existing: Optional[Dict[str, float]] = None,
    merge_weight: float = 0.5,
) -> Dict[str, float]:
    """
    Parse phrase and optionally merge with existing physics.

    Args:
        phrase: Natural language description
        existing: Existing physics values to merge with
        merge_weight: Weight for parsed values (0-1)

    Returns:
        Merged physics dictionary
    """
    parsed = parse_phrase(phrase)

    result = {
        'polarity_ab': parsed.polarity_ab,
        'polarity_ba': parsed.polarity_ba,
        'hierarchy': parsed.hierarchy,
        'permanence': parsed.permanence,
        'energy': parsed.energy,
        'weight': parsed.weight,
    }

    if existing:
        # Merge with weighted average
        existing_weight = 1.0 - merge_weight
        for key in result:
            if key in existing:
                result[key] = existing_weight * existing[key] + merge_weight * result[key]

    return result


# =============================================================================
# NARRATIVE SYNTHESIS FROM CRYSTALLIZATION
# =============================================================================

def synthesize_narrative_name(
    found_narratives: List[Tuple[str, str, float]],  # (id, name, alignment)
    intention_text: str,
) -> str:
    """
    Generate name for crystallized narrative.

    Args:
        found_narratives: List of (id, name, alignment) tuples
        intention_text: Original intention text

    Returns:
        Generated narrative name
    """
    if not found_narratives:
        # Use intention as basis
        words = intention_text.split()[:5]
        return ' '.join(words).title()

    # Combine top aligned narratives
    sorted_narr = sorted(found_narratives, key=lambda x: x[2], reverse=True)
    top_names = [name for _, name, align in sorted_narr[:2] if align > 0.5]

    if len(top_names) >= 2:
        return f"{top_names[0]} through {top_names[1]}"
    elif top_names:
        return f"Path to {top_names[0]}"
    else:
        words = intention_text.split()[:4]
        return ' '.join(words).title()


def synthesize_narrative_content(
    found_narratives: List[Tuple[str, str, float]],  # (id, content, alignment)
    intention_text: str,
    path_summary: Optional[str] = None,
) -> str:
    """
    Generate content for crystallized narrative.

    Args:
        found_narratives: List of (id, content, alignment) tuples
        intention_text: Original intention text
        path_summary: Optional summary of traversal path

    Returns:
        Generated narrative content
    """
    parts = []

    # Start with intention
    parts.append(f"Exploration of: {intention_text}")

    # Add found narratives with alignment
    if found_narratives:
        sorted_narr = sorted(found_narratives, key=lambda x: x[2], reverse=True)
        connections = []
        for _, content, align in sorted_narr[:3]:
            if align > 0.7:
                connections.append(f"strongly connected to: {content[:100]}")
            elif align > 0.4:
                connections.append(f"relates to: {content[:80]}")
        if connections:
            parts.append("Discovered: " + "; ".join(connections))

    # Add path if provided
    if path_summary:
        parts.append(f"Through: {path_summary}")

    return ". ".join(parts)


def synthesize_from_crystallization(
    intention_text: str,
    found_narratives: List[Tuple[str, str, str, float]],  # (id, name, content, alignment)
    path_summary: Optional[str] = None,
) -> Tuple[str, str]:
    """
    Generate name and content for crystallized narrative.

    Args:
        intention_text: Original intention text
        found_narratives: List of (id, name, content, alignment) tuples
        path_summary: Optional summary of traversal path

    Returns:
        Tuple of (name, content)
    """
    name_tuples = [(id, name, align) for id, name, _, align in found_narratives]
    content_tuples = [(id, content, align) for id, _, content, align in found_narratives]

    name = synthesize_narrative_name(name_tuples, intention_text)
    content = synthesize_narrative_content(content_tuples, intention_text, path_summary)

    return name, content


# =============================================================================
# NODE SYNTHESIS
# =============================================================================

NODE_ENERGY_STATES = {
    'actor': {
        (8.0, float('inf')): 'intensely present',
        (6.0, 8.0): 'very active',
        (0.0, 1.0): 'withdrawn',
    },
    'space': {
        (6.0, float('inf')): 'charged',
        (0.0, 2.0): 'calm',
    },
    'thing': {
        (6.0, float('inf')): 'burning',
        (0.0, 2.0): 'dormant',
    },
    'narrative': {
        (8.0, float('inf')): 'incandescent',
        (6.0, 8.0): 'burning',
        (4.0, 6.0): 'active',
        (0.0, 2.0): 'latent',
    },
    'moment': {
        (8.0, float('inf')): 'incandescent',
        (6.0, 8.0): 'burning',
    },
}


def _get_energy_state(energy: float, node_type: str) -> Optional[str]:
    """Get energy state modifier for node type."""
    states = NODE_ENERGY_STATES.get(node_type, {})
    for (low, high), state in states.items():
        if low <= energy < high:
            return state
    return None


def _get_importance(weight: float) -> Optional[str]:
    """Get importance modifier from weight."""
    if weight > 5.0:
        return '(central)'
    elif weight > 3.0:
        return '(important)'
    elif weight < 1.0:
        return '(minor)'
    return None


def synthesize_node(node: Dict[str, Any]) -> str:
    """
    Generate natural language synthesis for a node from its physics state.

    Format: "name, energy_state (importance)"
    Example: "Edmund, intensely present (central)"

    Args:
        node: Dict with name, energy, weight, node_type/label

    Returns:
        Natural language synthesis
    """
    name = node.get("name", "")
    node_id = node.get("id", "")
    energy = node.get("energy", 0.0)
    weight = node.get("weight", 1.0)

    # Determine node type
    node_type = node.get("node_type")
    if not node_type:
        node_type = node.get("label", "").lower()
    if not node_type and node_id and ":" in node_id:
        node_type = node_id.split(":")[0]
    node_type = node_type or "thing"

    # Get name from id if not provided
    if not name and node_id:
        name = node_id.split(":")[-1].replace("_", " ")

    parts = [name.capitalize() if name and len(name) > 2 else name or node_id]

    # Energy state
    energy_state = _get_energy_state(energy, node_type)
    if energy_state:
        parts.append(energy_state)

    # Importance
    importance = _get_importance(weight)
    if importance:
        parts.append(importance)

    return ", ".join(parts)


def synthesize_link_full(link: Dict[str, Any], from_node: Dict[str, Any] = None, to_node: Dict[str, Any] = None) -> str:
    """
    Generate full synthesis for a link including node names.

    Format: "from_name verb to_name, with modifiers"
    Example: "Edmund definitely influences the King, with confidence"

    Args:
        link: Link dict with physics fields
        from_node: Optional source node dict (for name)
        to_node: Optional target node dict (for name)

    Returns:
        Full natural language synthesis
    """
    # Get names
    from_id = link.get("from", link.get("node_a", ""))
    to_id = link.get("to", link.get("node_b", ""))

    if from_node:
        from_name = from_node.get("name", from_id.split(":")[-1] if ":" in from_id else from_id)
    else:
        from_name = from_id.split(":")[-1].replace("_", " ") if ":" in from_id else from_id

    if to_node:
        to_name = to_node.get("name", to_id.split(":")[-1] if ":" in to_id else to_id)
    else:
        to_name = to_id.split(":")[-1].replace("_", " ") if ":" in to_id else to_id

    # Get verb synthesis
    verb_synthesis = synthesize_from_dict(link)

    return f"{from_name} {verb_synthesis} {to_name}"


# =============================================================================
# GRAMMAR v2 — Full 6-stage pipeline (ALGORITHM_Grammar.md)
# =============================================================================

# Plutchik emotion → (dimensions that drive intensity, modifier tiers)
_PLUTCHIK_EMOTIONS = {
    "fear":         {"dims": ("energy", "valence"),    "sign": (1, -1), "tiers": ("with apprehension", "with fear", "with terror")},
    "anger":        {"dims": ("friction", "energy"),   "sign": (1,  1), "tiers": ("with annoyance", "with hostility", "with rage")},
    "trust":        {"dims": ("trust", "valence"),     "sign": (1,  1), "tiers": ("with acceptance", "with confidence", "with admiration")},
    "disgust":      {"dims": ("aversion", "valence"),  "sign": (1, -1), "tiers": ("with distaste", "with distrust", "with disgust")},
    "joy":          {"dims": ("affinity", "valence"),  "sign": (1,  1), "tiers": ("with serenity", "with satisfaction", "with euphoria")},
    "sadness":      {"dims": ("energy", "valence"),    "sign": (-1,-1), "tiers": ("with pensiveness", "with sadness", "with despair")},
    "surprise":     {"dims": ("surprise",),            "sign": (1,),    "tiers": ("with distraction", "with surprise", "with amazement")},
    "anticipation": {"dims": ("energy", "valence"),    "sign": (1,  1), "tiers": ("with interest", "with anticipation", "with vigilance")},
}

# Contextual verb overrides: (source_type, target_type) → [(condition_fn, verb)]
_CONTEXTUAL_OVERRIDES: Dict[Tuple[str, str], list] = {
    ("actor", "space"): [
        (lambda d: d.get("hierarchy", 0) < -0.5, "created"),
        (lambda d: d.get("permanence", 0) > 0.8, "inhabits"),
        (lambda d: d.get("recency", 999999) < 3600, "visits"),
        (lambda d: d.get("trust", 0) > 0.7, "administers"),
        (lambda d: d.get("energy", 1) < 0.5, "left"),
    ],
    ("actor", "actor"): [
        (lambda d: d.get("trust", 0) > 0.8 and d.get("affinity", 0) > 0.7, "trusted collaborator of"),
        (lambda d: d.get("hierarchy", 0) > 0.5, "mentors"),
        (lambda d: d.get("friction", 0) > 0.7, "in conflict with"),
        (lambda d: d.get("hierarchy", 0) < -0.5 and d.get("trust", 0) > 0.5, "employs"),
    ],
    ("space", "space"): [
        (lambda d: d.get("hierarchy", 0) < -0.5, "contains"),
        (lambda d: d.get("hierarchy", 0) > 0.5, "is nested in"),
        (lambda d: d.get("friction", 0) > 0.5, "borders"),
    ],
    ("thing", "thing"): [
        (lambda d: d.get("hierarchy", 0) < -0.5, "is a component of"),
        (lambda d: d.get("affinity", 0) > 0.7, "accompanies"),
        (lambda d: d.get("friction", 0) > 0.5, "competes with"),
    ],
}


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(value, hi))


def select_plutchik_modifier(
    energy: float = 0.0,
    valence: float = 0.0,
    friction: float = 0.0,
    trust: float = 0.0,
    affinity: float = 0.0,
    aversion: float = 0.0,
    surprise: float = 0.0,
) -> Optional[str]:
    """Select the single strongest Plutchik emotion modifier.

    Spec: ALGORITHM_Grammar.md § Step 5 (L1 context).
    Maps 7 dimensions to 8 Plutchik emotions, returns the modifier
    string for the highest-scoring emotion.
    """
    dim_vals = {
        "energy": energy, "valence": valence, "friction": friction,
        "trust": trust, "affinity": affinity, "aversion": aversion,
        "surprise": surprise,
    }

    best_emotion = None
    best_score = 0.0

    for emo, spec in _PLUTCHIK_EMOTIONS.items():
        score = 0.0
        for i, dim_name in enumerate(spec["dims"]):
            raw = dim_vals.get(dim_name, 0.0)
            sign = spec["sign"][i]
            score += raw * sign
        score = abs(score) / len(spec["dims"])

        if score > best_score:
            best_score = score
            best_emotion = emo

    if best_emotion is None or best_score < 0.1:
        return None

    tiers = _PLUTCHIK_EMOTIONS[best_emotion]["tiers"]
    if best_score > 0.7:
        return tiers[2]  # high
    elif best_score > 0.3:
        return tiers[1]  # medium
    else:
        return tiers[0]  # low


def select_structural_modifier(
    friction: float = 0.0,
    affinity: float = 0.0,
    valence: float = 0.0,
) -> List[str]:
    """Produce L3 post-verb modifiers from structural dimensions.

    Spec: ALGORITHM_Grammar.md § Step 5 (L3 context).
    Multiple modifiers can co-occur.
    """
    modifiers = []

    if friction > 0.7:
        modifiers.append("(high friction)")
    elif friction > 0.3:
        modifiers.append("(some friction)")

    if affinity > 0.7:
        modifiers.append("(strong affinity)")
    elif affinity < -0.7:
        modifiers.append("(structural tension)")
    elif -0.3 <= affinity <= 0.3 and abs(affinity) > 0.01:
        modifiers.append("(ambiguous)")

    if valence > 0.5:
        modifiers.append("(constructive)")
    elif valence < -0.5:
        modifiers.append("(destructive)")

    return modifiers


def lookup_contextual_verb(
    source_type: str,
    target_type: str,
    dimensions: Dict[str, float],
) -> Optional[str]:
    """Find domain-specific verb override based on node type pair.

    Spec: ALGORITHM_Grammar.md § Step 6.
    Evaluates conditions in priority order; first match wins.
    Returns override verb or None.
    """
    key = (source_type.lower(), target_type.lower())
    overrides = _CONTEXTUAL_OVERRIDES.get(key, [])

    for condition_fn, verb in overrides:
        if condition_fn(dimensions):
            return verb

    return None


def load_seed_dictionary(
    identity_keys: List[str],
    language: str = "en",
) -> Dict[str, str]:
    """Load native-language translations for citizen identity keys.

    Spec: ALGORITHM_Grammar.md § SeedDictionary.
    Looks for seed_dictionary.json in .mind/ or falls back to
    identity key text extraction.
    """
    result: Dict[str, str] = {}

    # Try loading from seed dictionary file
    seed_paths = [
        Path(".mind") / "seed_dictionary.json",
        Path(__file__).parent.parent.parent / ".mind" / "seed_dictionary.json",
    ]

    seed_data: Dict[str, Dict[str, str]] = {}
    for path in seed_paths:
        if path.exists():
            try:
                with open(path) as f:
                    raw = json.load(f)
                seed_data = raw.get("lookup", raw)
                break
            except (json.JSONDecodeError, OSError):
                continue

    for key in identity_keys:
        if key in seed_data and language in seed_data[key]:
            result[key] = seed_data[key][language]
        else:
            # Fallback: extract readable text from key
            # "desire:grow_personally" → "grow personally"
            text = key.split(":")[-1] if ":" in key else key
            result[key] = text.replace("_", " ")

    return result


def synthesize_link_phrase(
    link: Dict[str, Any],
    context: str = "L3",
    source_type: Optional[str] = None,
    target_type: Optional[str] = None,
    language: str = "en",
) -> str:
    """Transform link dimensions into a natural-language verb phrase.

    Implements the full 6-stage pipeline from ALGORITHM_Grammar.md:
    1. Dimension extraction & clamping
    2. Temporal modifier selection
    3. Pre-verb modifier assembly
    4. Base verb lookup (hierarchy × polarity)
    5. Post-verb modifier selection (L1: Plutchik | L3: structural)
    6. Contextual semantic override

    Args:
        link: Dict with physics dimensions (hierarchy, polarity, permanence,
              energy, surprise, recency, trust, friction, affinity, aversion,
              valence, weight, moment_status, link_age)
        context: "L1" for subjective/emotional or "L3" for structural
        source_type: Source node type (actor, space, thing, narrative, moment)
        target_type: Target node type
        language: "en" or "fr" (currently en only)

    Returns:
        Assembled verb phrase string
    """
    # ── Step 1: Dimension extraction & clamping ──
    polarity = link.get("polarity", [0.5, 0.5])
    if isinstance(polarity, (list, tuple)) and len(polarity) >= 2:
        pol_ab, pol_ba = float(polarity[0]), float(polarity[1])
    else:
        pol_ab = float(link.get("polarity_ab", 0.5))
        pol_ba = float(link.get("polarity_ba", 0.5))

    hierarchy = _clamp(float(link.get("hierarchy", 0.0)), -1.0, 1.0)
    permanence = _clamp(float(link.get("permanence", 0.5)), 0.0, 1.0)
    energy = _clamp(float(link.get("energy", 1.0)), 0.0, 10.0)
    surprise = _clamp(float(link.get("surprise", 0.0)), -1.0, 1.0)
    recency = float(link.get("recency", 999999))
    link_age = float(link.get("link_age", 86400))
    moment_status = link.get("moment_status", "")
    trust = float(link.get("trust", 0.0))
    friction = float(link.get("friction", 0.0))
    affinity = float(link.get("affinity", 0.0))
    aversion = float(link.get("aversion", 0.0))
    valence = float(link.get("valence", 0.0))

    # ── Step 2: Temporal modifiers ──
    temporal_parts: List[str] = []

    if recency < 60:
        temporal_parts.append("just now")
    elif recency < 3600:
        temporal_parts.append("recently")
    elif recency < 86400:
        temporal_parts.append("today")
    elif recency < 604800:
        temporal_parts.append("this week")
    elif recency >= 604800 and recency < 999999:
        temporal_parts.append("long ago")

    if link_age < 3600:
        temporal_parts.append("newly")
    elif link_age < 86400:
        temporal_parts.append("freshly")
    elif link_age >= 2592000 and link_age < 31536000:
        temporal_parts.append("anciently")
    elif link_age >= 31536000:
        temporal_parts.append("timelessly")

    status_map = {"BRIEF": "briefly", "ONGOING": "ongoing", "PENDING": "pending", "WELL_TRODDEN": "well-trodden"}
    if moment_status in status_map:
        temporal_parts.append(status_map[moment_status])

    # ── Step 3: Pre-verb modifiers ──
    pre_verb: List[str] = []

    if permanence >= 0.8:
        pre_verb.append("definitely")
    elif permanence >= 0.6:
        pre_verb.append("clearly")
    elif permanence < 0.2:
        pre_verb.append("maybe")
    elif permanence < 0.4:
        pre_verb.append("probably")

    if surprise > 0.7:
        pre_verb.append("suddenly")
    elif surprise > 0.3:
        pre_verb.append("unexpectedly")
    elif surprise < -0.7:
        pre_verb.append("inevitably")
    elif surprise < -0.3:
        pre_verb.append("as expected")

    if energy > 8.0:
        pre_verb.append("intensely")
    elif energy > 5.0:
        pre_verb.append("actively")
    elif energy <= 0.5:
        pre_verb.append("barely")
    elif energy <= 2.0:
        pre_verb.append("weakly")

    # ── Step 4: Base verb ──
    base_verb = get_base_verb_key(hierarchy, pol_ab, pol_ba)

    # Special overrides
    if energy > 8.0 and abs(hierarchy) <= 0.5:
        base_verb = "reinforces"
    elif pol_ab < 0.1 and pol_ba < 0.1:
        base_verb = "absorbs"

    verb_str = VERBS.get(base_verb, base_verb.replace("_", " "))

    # Apply intensifier
    intensity = compute_intensity(permanence, pol_ab, pol_ba)
    verb_str = apply_intensifier(base_verb, intensity)

    # ── Step 5: Post-verb modifiers ──
    post_verb: List[str] = []

    if context.upper() == "L1":
        plutchik = select_plutchik_modifier(
            energy=energy, valence=valence, friction=friction,
            trust=trust, affinity=affinity, aversion=aversion,
            surprise=surprise,
        )
        if plutchik:
            post_verb.append(plutchik)
    else:
        post_verb.extend(select_structural_modifier(friction, affinity, valence))

    # ── Step 6: Contextual semantic override ──
    if source_type and target_type:
        dims = {
            "hierarchy": hierarchy, "permanence": permanence,
            "energy": energy, "recency": recency, "trust": trust,
            "friction": friction, "affinity": affinity,
        }
        override = lookup_contextual_verb(source_type, target_type, dims)
        if override:
            verb_str = override

    # ── Assemble ──
    parts: List[str] = []
    if temporal_parts:
        parts.append(", ".join(temporal_parts[:2]))
    if pre_verb:
        parts.append(" ".join(pre_verb[:2]))
    parts.append(verb_str)
    if post_verb:
        parts.append(" ".join(post_verb))

    return " ".join(parts)
