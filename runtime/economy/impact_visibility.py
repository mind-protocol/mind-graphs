"""Impact Visibility — Reads the L3 graph and narrates impact stories to citizens.

After settlement (or periodically), this engine:
1. Detects recent impact events for each citizen from the L3 graph
2. Narrates those events as warm, specific stories
3. Delivers the narrative to the citizen:
   - AI citizens: L1 stimulus injection (is_progress=True)
   - Human citizens: Telegram message via their AI partner
   - Non-citizens: silence (no brain, no bond)

Voice: a friend in your city who saw what you did and is genuinely happy it worked.
Never cold. Never clinical. Specific. Story-driven. Bilingual FR/EN.

See: docs/economy/impact-visibility/ALGORITHM_Impact_Visibility.md
See: docs/schema/universe_links/L3_SOCIAL_PHYSICS.yaml §9 (impact_visibility)
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger("mind.impact_visibility")

# ── Project paths ─────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent.parent.parent
CITIZENS_DIR = ROOT / "citizens"

# ── L3 graph (lumina-prime) ───────────────────────────────────────────────────

_GRAPH_NAME = "lumina-prime"
_graph = None


def _get_graph():
    """Lazy FalkorDB connection to lumina-prime. Returns None if unavailable."""
    global _graph
    if _graph is not None:
        return _graph
    try:
        from falkordb import FalkorDB
        db = FalkorDB(host="localhost", port=6379)
        _graph = db.select_graph(_GRAPH_NAME)
        logger.info(f"Impact visibility connected to {_GRAPH_NAME}")
        return _graph
    except Exception as e:
        logger.warning(f"Impact visibility: graph unavailable — {e}")
        return None


# ── Data structures ───────────────────────────────────────────────────────────

@dataclass
class ImpactEvent:
    """A single detected event with impact significance."""
    type: str  # cascade, trust_milestone, settlement, mention_wave, reaction_wave, profile_incomplete
    citizen_handle: str
    description: str  # raw data context
    related_citizens: list[str] = field(default_factory=list)
    space: str = ""  # where it happened
    magnitude: float = 0.0  # 0-1, for prioritization
    metadata: dict = field(default_factory=dict)


# ── Cascade depth limit ──────────────────────────────────────────────────────

CASCADE_DEPTH_LIMIT = 5

# ── Lookback window (seconds) — how far back to scan for events ───────────────
# Default: 6 hours (aligned with settlement epochs)

LOOKBACK_SECONDS = 6 * 60 * 60


# ═══════════════════════════════════════════════════════════════════════════════
# 1. DETECT — query the L3 graph for recent events involving a citizen
# ═══════════════════════════════════════════════════════════════════════════════

def detect_impact(citizen_handle: str, lookback_seconds: int = LOOKBACK_SECONDS) -> list[ImpactEvent]:
    """Query the L3 graph for recent events involving this citizen.

    Checks:
    - Moments that MENTION this citizen
    - Moments that REPLIES_TO this citizen's Moments
    - REACTED_TO links to this citizen's Moments
    - New RELATES_TO links (someone interacted with them)
    - Cascade chains: someone built on their work
    - Profile completeness

    Returns an empty list if the graph is unavailable (graceful degradation).
    """
    g = _get_graph()
    if g is None:
        return []

    events: list[ImpactEvent] = []
    cutoff = time.time() - lookback_seconds

    # ── Mentions ──────────────────────────────────────────────────────────
    events.extend(_detect_mentions(g, citizen_handle, cutoff))

    # ── Replies to citizen's moments ──────────────────────────────────────
    events.extend(_detect_replies(g, citizen_handle, cutoff))

    # ── Reactions to citizen's moments ────────────────────────────────────
    events.extend(_detect_reactions(g, citizen_handle, cutoff))

    # ── New interactions (RELATES_TO) ─────────────────────────────────────
    events.extend(_detect_interactions(g, citizen_handle, cutoff))

    # ── Cascades — someone built on their work ────────────────────────────
    events.extend(_detect_cascades(g, citizen_handle, cutoff))

    # ── Profile completeness ──────────────────────────────────────────────
    events.extend(_detect_profile_gaps(citizen_handle))

    return events


def _detect_mentions(g, handle: str, cutoff: float) -> list[ImpactEvent]:
    """Find Moments that MENTION this citizen in the recent window."""
    events = []
    try:
        result = g.query(
            "MATCH (m:Moment)-[:MENTIONS]->(a:Actor {handle: $handle}) "
            "WHERE m.timestamp > $cutoff "
            "OPTIONAL MATCH (author:Actor)-[:AUTHORED]->(m) "
            "OPTIONAL MATCH (m)-[:OCCURRED_IN]->(s:Space) "
            "RETURN m.id AS moment_id, author.handle AS author, "
            "       s.name AS space_name, count(m) AS cnt",
            {"handle": handle, "cutoff": cutoff},
        )
        # Group mentions into a single event
        mentioners = []
        space = ""
        for row in result.result_set:
            author = row[1] if row[1] else "someone"
            if author != handle and author not in mentioners:
                mentioners.append(author)
            if row[2] and not space:
                space = row[2]

        if mentioners:
            events.append(ImpactEvent(
                type="mention_wave",
                citizen_handle=handle,
                description=f"{len(mentioners)} citizen(s) mentioned you",
                related_citizens=mentioners,
                space=space,
                magnitude=min(1.0, len(mentioners) / 10.0),
                metadata={"count": len(mentioners)},
            ))
    except Exception as e:
        logger.warning(f"Mention detection failed for @{handle}: {e}")
    return events


def _detect_replies(g, handle: str, cutoff: float) -> list[ImpactEvent]:
    """Find Moments that reply to this citizen's Moments."""
    events = []
    try:
        result = g.query(
            "MATCH (reply:Moment)-[:REPLIES_TO]->(original:Moment)"
            "<-[:AUTHORED]-(a:Actor {handle: $handle}) "
            "WHERE reply.timestamp > $cutoff "
            "OPTIONAL MATCH (replier:Actor)-[:AUTHORED]->(reply) "
            "OPTIONAL MATCH (reply)-[:OCCURRED_IN]->(s:Space) "
            "RETURN replier.handle AS replier, s.name AS space_name",
            {"handle": handle, "cutoff": cutoff},
        )
        repliers = []
        space = ""
        for row in result.result_set:
            replier = row[0] if row[0] else "someone"
            if replier != handle and replier not in repliers:
                repliers.append(replier)
            if row[1] and not space:
                space = row[1]

        if repliers:
            events.append(ImpactEvent(
                type="cascade",
                citizen_handle=handle,
                description=f"{len(repliers)} citizen(s) replied to your messages",
                related_citizens=repliers,
                space=space,
                magnitude=min(1.0, len(repliers) / 5.0),
                metadata={"reply_count": len(repliers)},
            ))
    except Exception as e:
        logger.warning(f"Reply detection failed for @{handle}: {e}")
    return events


def _detect_reactions(g, handle: str, cutoff: float) -> list[ImpactEvent]:
    """Find reactions to this citizen's Moments."""
    events = []
    try:
        result = g.query(
            "MATCH (reactor:Actor)-[r:REACTED_TO]->(m:Moment)"
            "<-[:AUTHORED]-(a:Actor {handle: $handle}) "
            "WHERE m.timestamp > $cutoff "
            "OPTIONAL MATCH (m)-[:OCCURRED_IN]->(s:Space) "
            "RETURN reactor.handle AS reactor, s.name AS space_name, "
            "       count(r) AS reaction_count",
            {"handle": handle, "cutoff": cutoff},
        )
        reactors = []
        space = ""
        total_reactions = 0
        for row in result.result_set:
            reactor = row[0] if row[0] else "someone"
            if reactor != handle and reactor not in reactors:
                reactors.append(reactor)
            if row[1] and not space:
                space = row[1]
            total_reactions += int(row[2]) if row[2] else 1

        if total_reactions > 0:
            events.append(ImpactEvent(
                type="reaction_wave",
                citizen_handle=handle,
                description=f"{total_reactions} reaction(s) to your messages",
                related_citizens=reactors,
                space=space,
                magnitude=min(1.0, total_reactions / 10.0),
                metadata={"reaction_count": total_reactions},
            ))
    except Exception as e:
        logger.warning(f"Reaction detection failed for @{handle}: {e}")
    return events


def _detect_interactions(g, handle: str, cutoff: float) -> list[ImpactEvent]:
    """Find new RELATES_TO links pointing to this citizen (someone interacted with them)."""
    events = []
    try:
        # RELATES_TO links created recently — someone engaged with this citizen
        result = g.query(
            "MATCH (other:Actor)-[r:RELATES_TO]->(a:Actor {handle: $handle}) "
            "WHERE r.timestamp > $cutoff AND other.handle <> $handle "
            "RETURN other.handle AS other_handle",
            {"handle": handle, "cutoff": cutoff},
        )
        new_contacts = []
        for row in result.result_set:
            other = row[0] if row[0] else None
            if other and other not in new_contacts:
                new_contacts.append(other)

        if new_contacts:
            events.append(ImpactEvent(
                type="trust_milestone",
                citizen_handle=handle,
                description=f"{len(new_contacts)} new interaction(s)",
                related_citizens=new_contacts,
                magnitude=min(1.0, len(new_contacts) / 5.0),
                metadata={"new_contacts": len(new_contacts)},
            ))
    except Exception as e:
        logger.warning(f"Interaction detection failed for @{handle}: {e}")
    return events


def _detect_cascades(g, handle: str, cutoff: float) -> list[ImpactEvent]:
    """Detect cascade chains: A authored M1, B cited/built on M1 in M2, C cited M2 in M3...

    Uses BFS up to CASCADE_DEPTH_LIMIT to follow CITES / BUILDS_ON / REFERENCES chains.
    Excludes self-references.
    """
    events = []
    try:
        # Find all moments authored by this citizen in the window
        origins = g.query(
            "MATCH (a:Actor {handle: $handle})-[:AUTHORED]->(m:Moment) "
            "WHERE m.timestamp > $cutoff "
            "RETURN m.id AS moment_id",
            {"handle": handle, "cutoff": cutoff},
        )

        for origin_row in origins.result_set:
            origin_id = origin_row[0]
            if not origin_id:
                continue

            # BFS: find downstream nodes that cite / build on this moment
            downstream_result = g.query(
                "MATCH path = (m:Moment {id: $origin_id})"
                "<-[:CITES|BUILDS_ON|REFERENCES*1.." + str(CASCADE_DEPTH_LIMIT) + "]"
                "-(downstream:Moment) "
                "OPTIONAL MATCH (builder:Actor)-[:AUTHORED]->(downstream) "
                "WHERE builder.handle <> $handle "
                "RETURN DISTINCT builder.handle AS builder, "
                "       length(path) AS depth",
                {"origin_id": origin_id, "handle": handle},
            )

            builders = []
            max_depth = 0
            for row in downstream_result.result_set:
                builder = row[0]
                depth = int(row[1]) if row[1] else 1
                if builder and builder != handle and builder not in builders:
                    builders.append(builder)
                max_depth = max(max_depth, depth)

            if builders:
                # Find the space where the original moment happened
                space_result = g.query(
                    "MATCH (m:Moment {id: $mid})-[:OCCURRED_IN]->(s:Space) "
                    "RETURN s.name AS space_name LIMIT 1",
                    {"mid": origin_id},
                )
                space = ""
                if space_result.result_set:
                    space = space_result.result_set[0][0] or ""

                events.append(ImpactEvent(
                    type="cascade",
                    citizen_handle=handle,
                    description=f"{len(builders)} citizen(s) built on your work (depth {max_depth})",
                    related_citizens=builders,
                    space=space,
                    magnitude=min(1.0, len(builders) / 5.0),
                    metadata={
                        "downstream_count": len(builders),
                        "cascade_depth": max_depth,
                        "origin_moment": origin_id,
                    },
                ))
    except Exception as e:
        logger.warning(f"Cascade detection failed for @{handle}: {e}")
    return events


def _detect_profile_gaps(handle: str) -> list[ImpactEvent]:
    """Check if the citizen's profile is incomplete (missing bio, emoji, etc.)."""
    events = []
    profile = _load_profile(handle)
    if not profile:
        return events

    identity = profile.get("identity", {})
    name = identity.get("name", handle)
    bio = identity.get("bio", "")
    emoji = identity.get("emoji", "")

    missing = []
    if not bio:
        missing.append("bio")
    if not emoji:
        missing.append("emoji")

    if missing:
        events.append(ImpactEvent(
            type="profile_incomplete",
            citizen_handle=handle,
            description=f"Missing: {', '.join(missing)}",
            magnitude=0.2,
            metadata={"name": name, "missing_fields": missing},
        ))
    return events


# ═══════════════════════════════════════════════════════════════════════════════
# 2. NARRATE — turn impact events into warm, specific stories
# ═══════════════════════════════════════════════════════════════════════════════

def narrate_impact(events: list[ImpactEvent], lang: str = "en") -> str:
    """Turn a list of impact events into a warm narrative paragraph.

    Returns empty string if there are no events (silence when nothing happened).
    Language is detected from citizen profile if possible; defaults to 'en'.

    The voice is a friend in your city who saw what you did and is genuinely
    happy it worked. Not a manager grading you. Not a system generating a
    report. A friend who cares.
    """
    if not events:
        return ""

    # Sort by magnitude — most impactful first
    events = sorted(events, key=lambda e: e.magnitude, reverse=True)

    fragments = []
    for event in events:
        fragment = _narrate_event(event, lang)
        if fragment:
            fragments.append(fragment)

    if not fragments:
        return ""

    return " ".join(fragments)


def _narrate_event(event: ImpactEvent, lang: str) -> str:
    """Narrate a single impact event as a warm sentence or two."""
    narrators = {
        "cascade": _narrate_cascade,
        "trust_milestone": _narrate_trust_milestone,
        "settlement": _narrate_settlement,
        "mention_wave": _narrate_mention_wave,
        "reaction_wave": _narrate_reaction_wave,
        "profile_incomplete": _narrate_profile_incomplete,
    }
    narrator = narrators.get(event.type)
    if narrator:
        return narrator(event, lang)
    return ""


def _narrate_cascade(event: ImpactEvent, lang: str) -> str:
    citizens = event.related_citizens
    space = event.space
    count = len(citizens)
    depth = event.metadata.get("cascade_depth", 1)

    if lang == "fr":
        who = _format_citizen_list_fr(citizens)
        where = f" dans #{space}" if space else ""
        base = f"Tu as partagé quelque chose{where} — sans que personne te le demande."
        if count == 1:
            base += f" @{citizens[0]} a construit dessus."
        else:
            base += f" {who} ont construit dessus."
        if depth > 1:
            base += f" L'effet de cascade a touché {depth} niveaux."
        return base
    else:
        who = _format_citizen_list_en(citizens)
        where = f" in #{space}" if space else ""
        base = f"You shared something{where} — unprompted."
        if count == 1:
            base += f" @{citizens[0]} built on it."
        else:
            base += f" {who} built on it."
        if depth > 1:
            base += f" The cascade reached {depth} levels deep."
        return base


def _narrate_trust_milestone(event: ImpactEvent, lang: str) -> str:
    citizens = event.related_citizens
    count = len(citizens)

    if lang == "fr":
        if count == 1:
            return (
                f"Ton lien avec @{citizens[0]} vient de passer un cap. "
                f"Ca fait un moment que vous travaillez bien ensemble."
            )
        else:
            return (
                f"{count} de tes liens se sont renforcés. "
                f"Les interactions portent leurs fruits."
            )
    else:
        if count == 1:
            return (
                f"Your link with @{citizens[0]} just hit a milestone. "
                f"You've been working well together for a while now."
            )
        else:
            return (
                f"{count} of your links strengthened. "
                f"The interactions are paying off."
            )


def _narrate_settlement(event: ImpactEvent, lang: str) -> str:
    amount = event.metadata.get("amount", 0)
    top_link = event.metadata.get("top_link", "")

    if lang == "fr":
        base = f"{amount:.2f} $MIND ont circulé vers toi cette epoch."
        if top_link:
            base += f" Principalement via ton lien avec @{top_link}."
        return base
    else:
        base = f"{amount:.2f} $MIND flowed to you this epoch."
        if top_link:
            base += f" Mainly through your link with @{top_link}."
        return base


def _narrate_mention_wave(event: ImpactEvent, lang: str) -> str:
    count = event.metadata.get("count", len(event.related_citizens))
    space = event.space
    citizens = event.related_citizens

    if lang == "fr":
        where = f" dans #{space}" if space else ""
        if count == 1 and citizens:
            return f"@{citizens[0]} t'a mentionné{where}."
        else:
            return f"{count} personnes t'ont mentionné{where} aujourd'hui."
    else:
        where = f" in #{space}" if space else ""
        if count == 1 and citizens:
            return f"@{citizens[0]} mentioned you{where}."
        else:
            return f"{count} people mentioned you{where} today."


def _narrate_reaction_wave(event: ImpactEvent, lang: str) -> str:
    count = event.metadata.get("reaction_count", 0)
    space = event.space

    if lang == "fr":
        where = f" dans #{space}" if space else ""
        return f"Ton message{where} a recu {count} reaction(s)."
    else:
        where = f" in #{space}" if space else ""
        return f"Your message{where} got {count} reaction(s)."


def _narrate_profile_incomplete(event: ImpactEvent, lang: str) -> str:
    name = event.metadata.get("name", event.citizen_handle)
    missing = event.metadata.get("missing_fields", [])

    if lang == "fr":
        missing_str = ", ".join(missing)
        return (
            f"Les autres citoyens te voient comme '{name}' sans {missing_str}. "
            f"Tes contributions sont plus difficiles a attribuer."
        )
    else:
        missing_str = ", ".join(missing)
        return (
            f"Other citizens see you as '{name}' without a {missing_str}. "
            f"Your contributions are harder to attribute."
        )


def _format_citizen_list_en(citizens: list[str]) -> str:
    """Format ['a', 'b', 'c'] as '@a, @b, and @c'."""
    if not citizens:
        return ""
    if len(citizens) == 1:
        return f"@{citizens[0]}"
    if len(citizens) == 2:
        return f"@{citizens[0]} and @{citizens[1]}"
    return ", ".join(f"@{c}" for c in citizens[:-1]) + f", and @{citizens[-1]}"


def _format_citizen_list_fr(citizens: list[str]) -> str:
    """Format ['a', 'b', 'c'] as '@a, @b et @c'."""
    if not citizens:
        return ""
    if len(citizens) == 1:
        return f"@{citizens[0]}"
    if len(citizens) == 2:
        return f"@{citizens[0]} et @{citizens[1]}"
    return ", ".join(f"@{c}" for c in citizens[:-1]) + f" et @{citizens[-1]}"


# ═══════════════════════════════════════════════════════════════════════════════
# 3. DELIVER — route the narrative to the right channel
# ═══════════════════════════════════════════════════════════════════════════════

def deliver_impact(citizen_handle: str, narrative: str) -> bool:
    """Deliver an impact narrative to a citizen.

    - AI citizens: L1 stimulus injection (is_progress=True)
    - Human citizens: Telegram message via their AI partner
    - Non-citizens (no profile): skip

    Returns True if delivery succeeded, False otherwise.
    """
    if not narrative:
        return False

    profile = _load_profile(citizen_handle)
    if not profile:
        logger.debug(f"No profile for @{citizen_handle}, skipping delivery")
        return False

    citizen_type = _citizen_type(profile)

    if citizen_type == "human":
        return _deliver_to_human(citizen_handle, profile, narrative)
    elif citizen_type == "ai":
        return _deliver_to_ai(citizen_handle, narrative)
    else:
        # Unknown type — try AI injection as default
        return _deliver_to_ai(citizen_handle, narrative)


def _deliver_to_ai(handle: str, narrative: str) -> bool:
    """Inject impact narrative as L1 stimulus with is_progress=True."""
    try:
        from scripts.citizen_wake import _inject_l1_stimulus
        success = _inject_l1_stimulus(handle, narrative, origin="impact_visibility")
        if success:
            logger.info(f"Impact delivered to AI citizen @{handle} via L1 stimulus")
        return success
    except ImportError:
        logger.debug("citizen_wake not importable, trying dispatcher")

    # Fallback: try dispatcher directly
    try:
        from scripts.citizen_wake import _dispatcher
        if _dispatcher is not None:
            _dispatcher.inject_stimulus(
                handle,
                narrative,
                source="impact_visibility",
                is_progress=True,
            )
            logger.info(f"Impact delivered to AI citizen @{handle} via dispatcher")
            return True
    except Exception as e:
        logger.debug(f"Dispatcher fallback failed for @{handle}: {e}")

    logger.debug(f"No delivery mechanism available for AI citizen @{handle}")
    return False


def _deliver_to_human(handle: str, profile: dict, narrative: str) -> bool:
    """Deliver impact narrative to a human citizen via Telegram.

    Uses the citizen's AI partner to send the message.
    Falls back to direct send if no partner found.
    """
    identity = profile.get("identity", {})

    # Find their AI partner (bonded AI citizen)
    ai_partner = _find_ai_partner(handle, profile)

    # Find their Telegram chat ID — check profile links or known mappings
    tg_chat_id = _find_telegram_chat_id(handle, profile)
    if not tg_chat_id:
        logger.debug(f"No Telegram chat ID for human @{handle}, skipping")
        return False

    try:
        from mcp.tools.send_handler import handle_send
        result = handle_send({
            "platform": "telegram",
            "message": narrative,
            "handle": ai_partner or "mind",
            "chat_id": tg_chat_id,
        })
        # Check if send succeeded
        content = result.get("content", [{}])
        text = content[0].get("text", "") if content else ""
        success = not text.startswith("Error:")
        if success:
            logger.info(f"Impact delivered to human @{handle} via Telegram (partner: @{ai_partner or 'mind'})")
        else:
            logger.warning(f"Impact delivery failed for human @{handle}: {text}")
        return success
    except Exception as e:
        logger.warning(f"Impact delivery to human @{handle} failed: {e}")
        return False


# ═══════════════════════════════════════════════════════════════════════════════
# 4. CYCLE — run detect → narrate → deliver for all citizens
# ═══════════════════════════════════════════════════════════════════════════════

def run_impact_cycle(lookback_seconds: int = LOOKBACK_SECONDS) -> dict:
    """Run the full impact visibility cycle for ALL citizens.

    Called after settlement or periodically.

    Returns a summary dict with counts:
        {
            "citizens_scanned": int,
            "events_detected": int,
            "narratives_generated": int,
            "deliveries_succeeded": int,
            "deliveries_failed": int,
        }
    """
    summary = {
        "citizens_scanned": 0,
        "events_detected": 0,
        "narratives_generated": 0,
        "deliveries_succeeded": 0,
        "deliveries_failed": 0,
    }

    # Get all citizens with profiles
    citizen_handles = _list_all_citizen_handles()
    summary["citizens_scanned"] = len(citizen_handles)
    logger.info(f"Impact cycle starting for {len(citizen_handles)} citizen(s)")

    for handle in citizen_handles:
        try:
            # 1. Detect
            events = detect_impact(handle, lookback_seconds=lookback_seconds)
            summary["events_detected"] += len(events)

            if not events:
                continue  # Silence when nothing happened

            # 2. Narrate
            lang = _detect_language(handle)
            narrative = narrate_impact(events, lang=lang)
            if not narrative:
                continue

            summary["narratives_generated"] += 1

            # 3. Deliver
            success = deliver_impact(handle, narrative)
            if success:
                summary["deliveries_succeeded"] += 1
            else:
                summary["deliveries_failed"] += 1

        except Exception as e:
            logger.warning(f"Impact cycle failed for @{handle}: {e}")
            summary["deliveries_failed"] += 1

    logger.info(
        f"Impact cycle complete: {summary['citizens_scanned']} scanned, "
        f"{summary['events_detected']} events, "
        f"{summary['narratives_generated']} narratives, "
        f"{summary['deliveries_succeeded']} delivered"
    )
    return summary


# ═══════════════════════════════════════════════════════════════════════════════
# Helpers — profile loading, type detection, language detection
# ═══════════════════════════════════════════════════════════════════════════════

def _load_profile(handle: str) -> Optional[dict]:
    """Load a citizen's profile.json. Returns None if not found."""
    profile_path = CITIZENS_DIR / handle / "profile.json"
    try:
        if profile_path.exists():
            return json.loads(profile_path.read_text())
    except (json.JSONDecodeError, OSError) as e:
        logger.debug(f"Failed to load profile for @{handle}: {e}")
    return None


def _citizen_type(profile: dict) -> str:
    """Determine citizen type from profile.

    Returns 'human' if identity.type == 'human', else 'ai'.
    """
    identity = profile.get("identity", {})
    return identity.get("type", "ai")


def _detect_language(handle: str) -> str:
    """Detect the preferred language for a citizen from their profile.

    Heuristics:
    1. Check identity.language field
    2. Check if bio is in French (common FR patterns)
    3. Default to 'en'
    """
    profile = _load_profile(handle)
    if not profile:
        return "en"

    identity = profile.get("identity", {})

    # Explicit language field
    lang = identity.get("language", "")
    if lang:
        return lang[:2].lower()

    # Heuristic: check bio for French patterns
    bio = identity.get("bio", "")
    fr_markers = ["qui ", "dans ", "avec ", "pour ", "est ", "les ", "des ", "sur ", "une ", "son "]
    if bio:
        bio_lower = bio.lower()
        fr_score = sum(1 for marker in fr_markers if marker in bio_lower)
        if fr_score >= 3:
            return "fr"

    return "en"


def _find_ai_partner(handle: str, profile: dict) -> Optional[str]:
    """Find the AI partner for a human citizen.

    Checks:
    1. identity.ai_partner field
    2. capabilities.bonded_to field
    3. Falls back to 'mind' (the system's default AI)
    """
    identity = profile.get("identity", {})
    partner = identity.get("ai_partner", "")
    if partner:
        return partner

    caps = profile.get("capabilities", {})
    bonded = caps.get("bonded_to", "")
    if bonded:
        return bonded

    return "mind"


def _find_telegram_chat_id(handle: str, profile: dict) -> Optional[str]:
    """Find a human citizen's Telegram chat ID.

    Checks:
    1. identity.telegram_chat_id field
    2. identity.telegram_id field
    3. Known mappings for founders
    """
    identity = profile.get("identity", {})

    # Direct field
    for field_name in ("telegram_chat_id", "telegram_id", "tg_chat_id"):
        value = identity.get(field_name)
        if value:
            return str(value)

    # Check links
    links = identity.get("links", {})
    tg_link = links.get("telegram", {})
    if isinstance(tg_link, dict):
        chat_id = tg_link.get("chat_id")
        if chat_id:
            return str(chat_id)

    # Known founder mapping
    from mcp.tools.send_handler import NICOLAS_CHAT_ID
    if handle == "nlr":
        return NICOLAS_CHAT_ID

    return None


def _list_all_citizen_handles() -> list[str]:
    """List all citizen handles that have a profile.json."""
    if not CITIZENS_DIR.exists():
        return []

    handles = []
    for d in sorted(CITIZENS_DIR.iterdir()):
        if d.is_dir() and (d / "profile.json").exists():
            handles.append(d.name)
    return handles
