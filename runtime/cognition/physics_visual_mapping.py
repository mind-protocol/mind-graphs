"""
Physics → Visual Mapping — canonical translation from graph physics to visual properties.

DOCS: docs/cognition/metabolism/PATTERNS_Metabolism.md (Principle 5: Sensory Channels)

This module defines HOW physics dimensions map to visual effects.
It is the authoritative source for any renderer (Three.js, Plotly, Blender, etc.)
that wants to display a brain or universe graph.

The mapping is designed so that a practitioner (GraphCare) or a citizen
can look at the visualization and READ the physics — without knowing
the numbers.

Three consumers:
  1. graphcare/services/brain_scan/ — static HTML renders
  2. mind-ops/detection/observability/ — monitoring dashboards
  3. cities-of-light engine/ — live 3D world rendering

Co-Authored-By: Tomaso Nervo (@nervo) <nervo@mindprotocol.ai>
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional


# =========================================================================
# Node Visual Properties
# =========================================================================

# Anatomy: which brain layer a node belongs to
ANATOMY_LAYER = {
    "process":   "stem",       # z = 0.0-0.2 — basic machinery, habits
    "desire":    "limbic",     # z = 0.2-0.4 — wants, attractors
    "narrative": "distributed", # z = 0.3-0.7 — stories span layers
    "value":     "cortex",     # z = 0.6-0.8 — principles, identity
    "concept":   "cortex",     # z = 0.8-1.0 — abstractions, knowledge
    "memory":    "distributed", # z varies — memories attach to what they're about
    "state":     "limbic",     # z = 0.2-0.4 — transient emotional coloring
}

# Color: node type → base color (hex)
# The color IS the type. A glance tells you what kind of node this is.
NODE_COLOR = {
    "process":   "#22c55e",  # green — machinery, habits
    "desire":    "#ef4444",  # red — wants, tension
    "narrative": "#a855f7",  # purple — stories, interpretation
    "value":     "#f59e0b",  # amber — principles, identity (warm gold)
    "concept":   "#3b82f6",  # blue — abstractions, knowledge
    "memory":    "#6b7280",  # gray — past, fading
    "state":     "#ec4899",  # pink — current feeling
    "gap":       "#f97316",  # orange — missing knowledge
}

# Size: weight → visual radius
# weight IS consolidated importance. Heavy nodes are big. Light nodes are small.
def node_radius(weight: float) -> float:
    """Map weight [0, ∞) → radius [2, 20] pixels.

    Logarithmic: the difference between 0.1 and 1.0 is as visible
    as the difference between 1.0 and 10.0.
    """
    return 2.0 + 6.0 * math.log1p(weight * 5.0)


# Glow: energy → emissive intensity
# energy IS current activation. Active nodes glow. Dormant nodes are matte.
def node_glow(energy: float) -> float:
    """Map energy [0, ∞) → glow intensity [0, 1].

    Sigmoid: gradual onset, saturates at 1.0.
    Below 0.1 energy: no glow. Above 2.0: full glow.
    """
    if energy < 0.1:
        return 0.0
    return min(1.0, 1.0 / (1.0 + math.exp(-3.0 * (energy - 0.5))))


# Opacity: stability → visual solidity
# stability IS resistance to forgetting. Stable nodes are solid. Fragile nodes are translucent.
def node_opacity(stability: float) -> float:
    """Map stability [0, 1] → opacity [0.3, 1.0].

    Linear. Even the most fragile node is 30% visible.
    """
    return 0.3 + 0.7 * stability


# Pulse: recency → animation frequency
# recency IS freshness. Recently activated nodes pulse faster.
def node_pulse_hz(recency: float) -> float:
    """Map recency [0, 1] → pulse frequency [0, 2] Hz.

    0 recency = no pulse (old). 1 recency = 2Hz pulse (just activated).
    """
    return 2.0 * recency


# =========================================================================
# Link Visual Properties
# =========================================================================

# Color: relation_kind → link color
LINK_COLOR = {
    # Cognitive
    "activates":        "#22c55e",  # green — energy flow
    "supports":         "#3b82f6",  # blue — reinforcement
    "contradicts":      "#ef4444",  # red — conflict
    "reminds_of":       "#a855f7",  # purple — association
    "causes":           "#f59e0b",  # amber — causation
    "conflicts_with":   "#ef4444",  # red — tension
    "regulates":        "#06b6d4",  # cyan — modulation
    "projects_toward":  "#8b5cf6",  # violet — future
    "depends_on":       "#6b7280",  # gray — dependency
    "exemplifies":      "#10b981",  # emerald — instance
    "specializes":      "#6366f1",  # indigo — taxonomy
    "associates":       "#9ca3af",  # light gray — generic
    # Crystallization
    "contains":         "#f59e0b",  # amber — hierarchy (hub→child)
    "abstracts":        "#fbbf24",  # yellow — hierarchy (child→hub)
    # Default
    "default":          "#6b7280",  # gray
}


# Width: weight → visual thickness
# weight IS link strength. Strong links are thick. Weak links are thin.
def link_width(weight: float) -> float:
    """Map weight [0, ∞) → width [0.5, 5] pixels.

    Logarithmic scale.
    """
    return 0.5 + 1.5 * math.log1p(weight * 3.0)


# Opacity: trust → visual transparency
# trust IS confidence in the relationship. Trusted links are solid. Untrusted are ghostly.
def link_opacity(trust: float, weight: float) -> float:
    """Map trust [0, 1] × weight → opacity [0.1, 1.0].

    Trust dominates. A high-trust weak link is more visible than
    a low-trust strong link.
    """
    return 0.1 + 0.6 * trust + 0.3 * min(1.0, weight)


# Glow: energy → emissive on the link
# energy IS active flow. Links carrying energy glow.
def link_glow(energy: float) -> float:
    """Map link energy [0, ∞) → glow [0, 1]."""
    if energy < 0.05:
        return 0.0
    return min(1.0, energy * 2.0)


# Wave: friction → visual turbulence
# friction IS resistance. High-friction links wave/distort. Smooth links are straight.
def link_wave_amplitude(friction: float) -> float:
    """Map friction [0, 1] → wave amplitude [0, 3] pixels.

    0 friction = perfectly straight. 1 friction = wavy, turbulent.
    """
    return 3.0 * friction


# Direction: polarity → animated flow direction
# polarity IS flow asymmetry. [0.8, 0.2] = strong A→B flow (particles move A→B).
def link_flow_direction(polarity: list[float]) -> float:
    """Map polarity [a→b, b→a] → flow speed [-1, 1].

    -1 = strong B→A flow. 0 = symmetric. +1 = strong A→B flow.
    """
    if not polarity or len(polarity) < 2:
        return 0.0
    return polarity[0] - polarity[1]


# Dash: permanence → line style
# permanence IS how stable the link is. Permanent = solid. Speculative = dashed.
def link_dash(permanence: float) -> float:
    """Map permanence [0, 1] → dash gap [0, 10].

    0 = fully dashed (speculative). 1 = solid (definitive).
    """
    return 10.0 * (1.0 - permanence)


# =========================================================================
# Circadian Visual Overlay
# =========================================================================

def circadian_ambient(phase: float) -> dict:
    """Map circadian phase [0, 1] → ambient lighting.

    At peak (1.0): bright warm light, full saturation.
    At trough (0.0): dim cool light, desaturated — the brain is resting.
    """
    brightness = 0.3 + 0.7 * phase
    warmth = 0.5 + 0.5 * phase  # warm at peak, cool at trough
    return {
        "brightness": round(brightness, 2),
        "warmth": round(warmth, 2),
        "fog_density": round(0.02 + 0.08 * (1.0 - phase), 3),  # more fog at night
        "particle_speed": round(0.2 + 0.8 * phase, 2),  # slow particles at night
    }


# =========================================================================
# Drive Visual Overlay
# =========================================================================

DRIVE_VISUAL = {
    "curiosity":        {"hue_shift": 0,    "particle": "sparkle"},
    "achievement":      {"hue_shift": 30,   "particle": "arrow"},
    "affiliation":      {"hue_shift": 300,  "particle": "heart"},
    "self_preservation": {"hue_shift": 60,  "particle": "shield"},
    "novelty_hunger":   {"hue_shift": 180,  "particle": "star"},
    "frustration":      {"hue_shift": 0,    "particle": "crack"},
    "rest_regulation":  {"hue_shift": 240,  "particle": "wave"},
    "care":             {"hue_shift": 330,  "particle": "droplet"},
}


def dominant_drive_overlay(drives: dict[str, float]) -> dict:
    """Map limbic drives → visual overlay for the brain ambient.

    The dominant drive colors the ambient atmosphere.
    High frustration = red tint. High curiosity = sparkles. High rest = blue calm.
    """
    if not drives:
        return {"hue_shift": 0, "particle": "none", "intensity": 0.0}

    dominant = max(drives, key=drives.get)
    intensity = drives[dominant]
    visual = DRIVE_VISUAL.get(dominant, {"hue_shift": 0, "particle": "none"})

    return {
        "dominant_drive": dominant,
        "hue_shift": visual["hue_shift"],
        "particle": visual["particle"],
        "intensity": round(intensity, 2),
    }


# =========================================================================
# Composite: full visual spec for one node or link
# =========================================================================

@dataclass
class NodeVisual:
    color: str
    radius: float
    glow: float
    opacity: float
    pulse_hz: float
    layer: str

    @classmethod
    def from_physics(cls, node_type: str, weight: float, energy: float,
                     stability: float, recency: float) -> "NodeVisual":
        return cls(
            color=NODE_COLOR.get(node_type, "#6b7280"),
            radius=round(node_radius(weight), 1),
            glow=round(node_glow(energy), 2),
            opacity=round(node_opacity(stability), 2),
            pulse_hz=round(node_pulse_hz(recency), 2),
            layer=ANATOMY_LAYER.get(node_type, "distributed"),
        )


@dataclass
class LinkVisual:
    color: str
    width: float
    opacity: float
    glow: float
    wave_amplitude: float
    flow_direction: float
    dash_gap: float

    @classmethod
    def from_physics(cls, relation_kind: str, weight: float, energy: float,
                     trust: float, friction: float, polarity: list[float],
                     permanence: float) -> "LinkVisual":
        return cls(
            color=LINK_COLOR.get(relation_kind, LINK_COLOR["default"]),
            width=round(link_width(weight), 1),
            opacity=round(link_opacity(trust, weight), 2),
            glow=round(link_glow(energy), 2),
            wave_amplitude=round(link_wave_amplitude(friction), 1),
            flow_direction=round(link_flow_direction(polarity), 2),
            dash_gap=round(link_dash(permanence), 1),
        )
