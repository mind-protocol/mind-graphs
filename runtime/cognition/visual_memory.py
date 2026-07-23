"""
Visual Memory Substrate (v2.2)

Fail-loud, never-block visual memory layer for the L1 cognitive substrate.
Handles:
- Flashbulb Vision generation on emotional peaks (Law 6 extension)
- Desire image generation on subentity traversal (Law 17 extension)
- Vision node creation with limbic imprint
- Self-stimulus reinjection (Law 1)

INVARIANTS:
- NEVER stores base64 in FalkorDB — URI only
- NEVER blocks inference or tick execution
- All errors are logged loudly but swallowed
- Image generation is always async (background thread)

Spec: docs/architecture/CONCEPT_Visual_Memory_Substrate.md
Schema: docs/schema/schema.yaml v2.2 (image_uri, image_embedding on NodeBase)
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional, Callable, Any

from .constants import (
    FLASHBULB_THRESHOLD,
    DESIRE_IMAGE_ENERGY_THRESHOLD,
    VISION_INITIAL_ENERGY,
    VISION_INITIAL_WEIGHT,
    VISION_INITIAL_STABILITY,
)
from .models import Node, NodeType, Modality

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------

@dataclass
class FlashbulbVisionResult:
    """Tracks what a Flashbulb Vision generation produced."""
    triggered: bool = False
    vision_node_id: Optional[str] = None
    image_uri: Optional[str] = None
    error: Optional[str] = None
    async_pending: bool = False


@dataclass
class DesireImageResult:
    """Tracks what a Desire image generation produced."""
    triggered: bool = False
    desire_node_id: Optional[str] = None
    image_uri: Optional[str] = None
    error: Optional[str] = None
    async_pending: bool = False


# ---------------------------------------------------------------------------
# Image generation adapter (pluggable backend)
# ---------------------------------------------------------------------------

class ImageGenerationAdapter:
    """Abstract adapter for image generation backends.

    Subclass this for specific APIs (Ideogram, DALL-E, Stable Diffusion, etc.).
    The default implementation is a no-op that logs the prompt.
    """

    def generate(self, prompt: str, reference_image_uris: list[str] | None = None) -> Optional[str]:
        """Generate an image from prompt. Returns URI or None.

        This is called in a background thread — safe to block.
        """
        logger.info(f"[VisualMemory] Image generation requested (no backend configured): {prompt[:100]}...")
        return None

    def compute_embedding(self, image_uri: str) -> list[float]:
        """Compute CLIP/SigLIP embedding for an image. Returns vector or empty list."""
        logger.info(f"[VisualMemory] Embedding requested (no backend configured): {image_uri}")
        return []


class PromptGenerationAdapter:
    """Abstract adapter for micro-agent prompt generation.

    Subclass this for specific LLMs (Claude Haiku, GPT-4o-mini, etc.).
    The default returns a basic prompt from the content.
    """

    def generate_vision_prompt(
        self,
        *,
        self_image_uri: Optional[str],
        wm_contents: list[str],
        wm_image_uris: list[str],
        present_actor_uris: list[str],
        emotional_state: dict[str, float],
        trigger: str,
    ) -> str:
        """Generate an image prompt for a Flashbulb Vision."""
        keywords = ", ".join(wm_contents[:5])
        return f"A vivid vision during {trigger}: {keywords}. Emotional intensity: high."

    def generate_desire_prompt(
        self,
        *,
        self_image_uri: Optional[str],
        desire_content: str,
        neighbor_image_uris: list[str],
        valence: float,
    ) -> str:
        """Generate an image prompt for a Desire node."""
        return f"An aspirational vision: {desire_content}. Emotional tone: {'positive' if valence > 0 else 'intense'}."


# ---------------------------------------------------------------------------
# Global adapters (set by the application at startup)
# ---------------------------------------------------------------------------

_image_adapter: ImageGenerationAdapter = ImageGenerationAdapter()
_prompt_adapter: PromptGenerationAdapter = PromptGenerationAdapter()


def configure(
    image_adapter: ImageGenerationAdapter | None = None,
    prompt_adapter: PromptGenerationAdapter | None = None,
) -> None:
    """Configure visual memory backends. Call once at startup."""
    global _image_adapter, _prompt_adapter
    if image_adapter is not None:
        _image_adapter = image_adapter
    if prompt_adapter is not None:
        _prompt_adapter = prompt_adapter


# ---------------------------------------------------------------------------
# Flashbulb Vision (Law 6 extension)
# ---------------------------------------------------------------------------

def trigger_flashbulb_vision(
    *,
    limbic_delta: float,
    wm_nodes: list[Node],
    self_image_uri: Optional[str] = None,
    present_actor_uris: list[str] | None = None,
    emotional_state: dict[str, float] | None = None,
    trigger_reason: str = "emotional_peak",
    on_vision_created: Callable[[Node], Any] | None = None,
) -> FlashbulbVisionResult:
    """Check if a Flashbulb Vision should fire and generate asynchronously.

    Called from Law 6 consolidation AFTER flashbulb detection.
    NEVER blocks. NEVER crashes the tick.

    Parameters
    ----------
    limbic_delta : float
        The current limbic delta magnitude (already abs'd by caller).
    wm_nodes : list[Node]
        Current Working Memory coalition.
    self_image_uri : str, optional
        The citizen's own profile pic URI (MUST be included in generation).
    present_actor_uris : list[str], optional
        Image URIs of actors in the current Space.
    emotional_state : dict, optional
        Current drive/emotion intensities for prompt context.
    trigger_reason : str
        What caused the peak ("frustration_spike", "satisfaction_peak", etc.).
    on_vision_created : callable, optional
        Callback invoked with the new vision Node when generation completes.
        Called from the background thread — must be thread-safe.

    Returns
    -------
    FlashbulbVisionResult
    """
    result = FlashbulbVisionResult()

    if abs(limbic_delta) < FLASHBULB_THRESHOLD:
        return result

    result.triggered = True

    try:
        # Gather WM context
        wm_contents = [n.content[:200] for n in wm_nodes if n.content]
        wm_image_uris = [n.image_uri for n in wm_nodes if n.image_uri]

        # Generate prompt (fast, synchronous — micro-agent or template)
        prompt = _prompt_adapter.generate_vision_prompt(
            self_image_uri=self_image_uri,
            wm_contents=wm_contents,
            wm_image_uris=wm_image_uris,
            present_actor_uris=present_actor_uris or [],
            emotional_state=emotional_state or {},
            trigger=trigger_reason,
        )

        # Create the vision node immediately (without image — image arrives async)
        vision_id = f"moment:vision_{uuid.uuid4().hex[:12]}"
        vision_node = Node(
            id=vision_id,
            node_type=NodeType.MEMORY,
            content=f"[Flashbulb Vision — {trigger_reason}] {prompt}",
            energy=VISION_INITIAL_ENERGY,
            weight=VISION_INITIAL_WEIGHT,
            stability=VISION_INITIAL_STABILITY,
            recency=1.0,
            modality=Modality.VISUAL,
        )
        result.vision_node_id = vision_id
        result.async_pending = True

        # Async: generate image, compute embedding, update node, callback
        reference_uris = []
        if self_image_uri:
            reference_uris.append(self_image_uri)
        reference_uris.extend(wm_image_uris)
        reference_uris.extend(present_actor_uris or [])

        def _generate_and_attach():
            try:
                uri = _image_adapter.generate(prompt, reference_uris)
                if uri:
                    vision_node.image_uri = uri
                    embedding = _image_adapter.compute_embedding(uri)
                    if embedding:
                        vision_node.image_embedding = embedding
                    logger.info(f"[VisualMemory] Flashbulb Vision generated: {vision_id} -> {uri}")
                else:
                    logger.warning(f"[VisualMemory] Flashbulb Vision: image generation returned None for {vision_id}")

                if on_vision_created:
                    on_vision_created(vision_node)

            except Exception as e:
                logger.error(f"[VisualMemory] Flashbulb Vision generation FAILED for {vision_id}: {e}", exc_info=True)

        thread = threading.Thread(target=_generate_and_attach, daemon=True, name=f"flashbulb-{vision_id}")
        thread.start()

        logger.info(f"[VisualMemory] Flashbulb Vision triggered: {trigger_reason}, node={vision_id}")

    except Exception as e:
        result.error = str(e)
        logger.error(f"[VisualMemory] Flashbulb Vision setup FAILED: {e}", exc_info=True)

    return result


# ---------------------------------------------------------------------------
# Desire Image Generation (Law 17 extension — subentity traversal)
# ---------------------------------------------------------------------------

def check_desire_needs_image(node: Node) -> bool:
    """Check if a desire node needs image generation during traversal.

    Conditions (all must be true):
    1. Node type is DESIRE
    2. Energy above threshold
    3. No image_uri set yet
    """
    return (
        node.node_type == NodeType.DESIRE
        and node.energy > DESIRE_IMAGE_ENERGY_THRESHOLD
        and not node.image_uri
    )


def trigger_desire_image(
    *,
    desire_node: Node,
    self_image_uri: Optional[str] = None,
    neighbor_image_uris: list[str] | None = None,
    on_image_ready: Callable[[Node, str, list[float]], Any] | None = None,
) -> DesireImageResult:
    """Generate an image for a desire node that lacks one.

    Called from subentity traversal when hitting an active desire without image.
    NEVER blocks. NEVER crashes traversal.

    Parameters
    ----------
    desire_node : Node
        The desire node that needs an image.
    self_image_uri : str, optional
        The citizen's own profile pic URI.
    neighbor_image_uris : list[str], optional
        Image URIs of neighboring nodes.
    on_image_ready : callable, optional
        Callback(node, uri, embedding) when generation completes.

    Returns
    -------
    DesireImageResult
    """
    result = DesireImageResult()

    if not check_desire_needs_image(desire_node):
        return result

    result.triggered = True
    result.desire_node_id = desire_node.id

    try:
        # Generate prompt
        prompt = _prompt_adapter.generate_desire_prompt(
            self_image_uri=self_image_uri,
            desire_content=desire_node.content[:500],
            neighbor_image_uris=neighbor_image_uris or [],
            valence=0.0,  # desires are generally positive-aspiring
        )

        result.async_pending = True

        reference_uris = []
        if self_image_uri:
            reference_uris.append(self_image_uri)
        reference_uris.extend(neighbor_image_uris or [])

        def _generate_desire_image():
            try:
                uri = _image_adapter.generate(prompt, reference_uris)
                if uri:
                    desire_node.image_uri = uri
                    embedding = _image_adapter.compute_embedding(uri)
                    if embedding:
                        desire_node.image_embedding = embedding
                    logger.info(f"[VisualMemory] Desire image generated: {desire_node.id} -> {uri}")

                    if on_image_ready:
                        on_image_ready(desire_node, uri, embedding)
                else:
                    logger.warning(f"[VisualMemory] Desire image: generation returned None for {desire_node.id}")

            except Exception as e:
                logger.error(f"[VisualMemory] Desire image generation FAILED for {desire_node.id}: {e}", exc_info=True)

        thread = threading.Thread(target=_generate_desire_image, daemon=True, name=f"desire-img-{desire_node.id}")
        thread.start()

        logger.info(f"[VisualMemory] Desire image generation triggered: {desire_node.id} (energy={desire_node.energy:.2f})")

    except Exception as e:
        result.error = str(e)
        logger.error(f"[VisualMemory] Desire image setup FAILED: {e}", exc_info=True)

    return result
