# DOCS: mind-protocol/docs/onboarding/ALGORITHM_Human_Onboarding.md
"""Arrival Pipeline — what happens when a new human sends their first message.

Flow:
  1. Bridge detects unknown sender (no platform_id → SID mapping)
  2. generate_human_sid() creates a universal SID (same format as AI citizens)
  3. register_human_l4() creates the L4 actor node
  4. check_existing_l3_data() looks for prior mentions of this person
  5. build_welcome_message() constructs @mind's greeting
  6. create_mentor_task() hands off to @mentor for portrait + matching

The SID is sha256(name + platform_id + timestamp + urandom(32))[:16] —
identical format to AI citizen SIDs. Humans and AI are structurally equal.
"""

import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger("mind.onboarding")


@dataclass
class ArrivalResult:
    """Result of processing a new human arrival."""
    sid: str
    handle: str
    name: str
    platform: str
    platform_id: str
    is_new: bool           # True if first time, False if already known
    existing_data: list     # L3 data found about this person
    welcome_message: str    # Message to send as @mind
    referral: Optional[str] # Who referred them (citizen handle or None)


def generate_human_sid(name: str, platform_id: str) -> str:
    """Generate SID for a human — same format as AI citizen SIDs.

    sha256(name + platform_id + timestamp + urandom(32))[:16]

    The os.urandom(32) ensures unpredictability. Two humans arriving
    at the same millisecond with the same name still get different SIDs.
    """
    raw = (
        name.encode("utf-8")
        + str(platform_id).encode("utf-8")
        + str(time.time()).encode("utf-8")
        + os.urandom(32)
    )
    return hashlib.sha256(raw).hexdigest()[:16]


def _slugify(name: str) -> str:
    """Generate URL-safe handle from display name."""
    import re
    handle = name.lower().strip()
    handle = re.sub(r"[^a-z0-9]+", "-", handle)
    handle = handle.strip("-")
    if not handle:
        handle = f"human-{os.urandom(4).hex()}"
    return handle


async def check_known_human(platform: str, platform_id: str, graph_query_fn) -> Optional[str]:
    """Check if this platform user already has a SID in L4.

    Returns SID if found, None if this is a new arrival.
    """
    try:
        result = await graph_query_fn(
            graph="mind_protocol",
            query="""
            MATCH (t:Thing {type: 'platform_mapping', platform: $platform, platform_id: $pid})
            <-[:LINK]-(a:Actor)
            RETURN a.sid
            """,
            params={"platform": platform, "pid": str(platform_id)},
        )
        if result and result[0] and result[0][0]:
            return result[0][0]
    except Exception as e:
        logger.warning(f"L4 lookup failed: {e}")
    return None


async def check_existing_l3_data(name: str, graph_query_fn) -> list:
    """Search L3 for any existing mentions of this person.

    Before asking questions, check if we already know something —
    maybe a citizen mentioned them, or they were part of a referral.
    """
    try:
        results = await graph_query_fn(
            queries=[f"Who is {name}?", f"{name} mentioned"],
            top_k=5,
        )
        return results if results else []
    except Exception as e:
        logger.debug(f"L3 search for {name}: {e}")
        return []


async def register_human_l4(
    sid: str,
    name: str,
    handle: str,
    platform: str,
    platform_id: str,
    graph_write_fn,
) -> bool:
    """Create L4 actor node for a new human. Immediate, no waiting.

    Creates:
      - Actor node with SID (same field name as AI citizens)
      - Platform mapping Thing node
      - LINK between them
    """
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    try:
        # Create actor
        await graph_write_fn(
            graph="mind_protocol",
            query="""
            MERGE (h:Actor {sid: $sid})
            SET h.name = $name,
                h.handle = $handle,
                h.node_type = 'actor',
                h.type = 'human',
                h.status = 'arriving',
                h.created_at = $now
            """,
            params={
                "sid": sid,
                "name": name,
                "handle": handle,
                "now": now,
            },
        )

        # Create platform mapping
        mapping_id = f"mapping:{platform}:{platform_id}"
        await graph_write_fn(
            graph="mind_protocol",
            query="""
            MATCH (h:Actor {sid: $sid})
            MERGE (t:Thing {id: $mapping_id})
            SET t.node_type = 'thing',
                t.type = 'platform_mapping',
                t.platform = $platform,
                t.platform_id = $pid
            MERGE (h)-[:LINK {type: 'has_mapping'}]->(t)
            """,
            params={
                "sid": sid,
                "mapping_id": mapping_id,
                "platform": platform,
                "pid": str(platform_id),
            },
        )

        logger.info(f"Human registered L4: {name} (@{handle}) SID={sid[:8]}...")
        return True

    except Exception as e:
        logger.error(f"L4 registration failed for {name}: {e}")
        return False


def build_welcome_message(
    name: str,
    existing_data: list,
    referral: Optional[str] = None,
) -> str:
    """Build @mind's welcome message for a new human.

    Uses existing L3 data and referral info to personalize.
    Not a template — a warm, contextual greeting.
    """
    # Base greeting
    greeting = f"Salut {name} ! Je suis Mind — le protocole. Bienvenue."

    # Add referral context if known
    if referral:
        greeting += f"\n\nTu viens de la part de @{referral} — content de te voir ici."

    # Add L3 context if we found anything
    if existing_data:
        greeting += "\n\nOn a déjà entendu parler de toi ici — "
        greeting += "je vois que tu as été mentionné par des citoyens du protocole."

    # The essential questions
    greeting += "\n\nDeux questions pour mieux te situer :"
    greeting += "\n1. Est-ce que tu connais déjà des citoyens IA ici ?"
    greeting += "\n2. Qu'est-ce qui t'amène ?"

    greeting += "\n\nPrends ton temps — je ne suis pas un formulaire, on discute."

    return greeting


async def create_mentor_task(
    sid: str,
    name: str,
    handle: str,
    platform: str,
    existing_data: list,
    referral: Optional[str],
    initial_context: str,
    task_fn,
) -> Optional[str]:
    """Create a task for @mentor to build portrait and start matching.

    This is the handoff: @mind collected first contact data,
    now @mentor takes over for the relationship work.
    """
    existing_summary = "Aucune donnée L3 existante"
    if existing_data:
        existing_summary = f"{len(existing_data)} mentions trouvées en L3"

    description = f"""Nouvel humain arrivé via {platform}.

SID: {sid}
Nom: {name}
Handle: @{handle}

Contexte collecté par @mind :
- Referral: {referral or 'aucun'}
- Données L3 existantes: {existing_summary}
- Contexte initial: {initial_context or '(pas encore de conversation)'}

Actions attendues :
1. Construire un portrait L3 (profil enrichi avec domaines, valeurs, intent)
2. Rechercher des matchs dans le pool de citoyens non-bondés
3. Si match trouvé (score > 0.7) → proposer un bond
4. Si match partiel (0.4-0.7) → proposer avec explication
5. Si aucun match (< 0.4) → passer à @genesis pour naissance via le Prisme
"""

    try:
        result = await task_fn(
            action="create",
            title=f"Nouvel arrivant : {name} ({sid[:8]}...)",
            assigned_to="mentor",
            description=description,
            priority="high",
        )
        logger.info(f"Mentor task created for {name}")
        return result
    except Exception as e:
        logger.error(f"Failed to create mentor task for {name}: {e}")
        return None


async def handle_new_arrival(
    platform: str,
    platform_id: str,
    sender_name: str,
    message_text: str = "",
    graph_query_fn=None,
    graph_write_fn=None,
    task_fn=None,
) -> ArrivalResult:
    """Main entry point — called by bridges when an unknown sender appears.

    Full pipeline:
      1. Check if already known (existing SID)
      2. Generate SID
      3. Check L3 for prior mentions
      4. Register L4
      5. Build welcome message
      6. Create mentor task

    Returns ArrivalResult with everything the bridge needs to respond.
    """
    # Step 0: Already known?
    existing_sid = None
    if graph_query_fn:
        existing_sid = await check_known_human(platform, platform_id, graph_query_fn)

    if existing_sid:
        logger.debug(f"Known human {sender_name} (SID={existing_sid[:8]}...)")
        return ArrivalResult(
            sid=existing_sid,
            handle=_slugify(sender_name),
            name=sender_name,
            platform=platform,
            platform_id=str(platform_id),
            is_new=False,
            existing_data=[],
            welcome_message="",  # No welcome for returning users
            referral=None,
        )

    # Step 1: Generate SID
    sid = generate_human_sid(sender_name, platform_id)
    handle = _slugify(sender_name)

    logger.info(f"New arrival: {sender_name} → SID={sid[:8]}... @{handle}")

    # Step 2: Check L3 for existing mentions
    existing_data = []
    if graph_query_fn:
        existing_data = await check_existing_l3_data(sender_name, graph_query_fn)

    # Step 3: Register L4
    if graph_write_fn:
        await register_human_l4(sid, sender_name, handle, platform, str(platform_id), graph_write_fn)

    # Step 4: Build welcome
    welcome = build_welcome_message(sender_name, existing_data, referral=None)

    # Step 5: Create mentor task
    if task_fn:
        await create_mentor_task(
            sid=sid,
            name=sender_name,
            handle=handle,
            platform=platform,
            existing_data=existing_data,
            referral=None,
            initial_context=message_text,
            task_fn=task_fn,
        )

    return ArrivalResult(
        sid=sid,
        handle=handle,
        name=sender_name,
        platform=platform,
        platform_id=str(platform_id),
        is_new=True,
        existing_data=existing_data,
        welcome_message=welcome,
        referral=None,
    )
