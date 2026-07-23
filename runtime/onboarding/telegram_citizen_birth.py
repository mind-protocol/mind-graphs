"""Birth and bond an AI citizen from an explicit Telegram command."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from runtime.l4 import citizen_registry as registry
from runtime.l4.citizen_l1_ensure import check_l1_exists, ensure_citizen_l1

logger = logging.getLogger("mind.onboarding.telegram_birth")


@dataclass(frozen=True)
class TelegramBirthResult:
    created: bool
    handle: str
    name: str
    bond_id: str = ""
    l1_graph: str = ""
    message: str = ""


def _human_handle(username: str, user_id: str) -> str:
    return registry.normalize_handle(username) or f"human_{user_id}"


def create_bonded_citizen(
    *,
    name: str,
    intent: str,
    sender_name: str,
    user_id: str,
    username: str = "",
    chat_id: str = "",
    dispatcher=None,
) -> TelegramBirthResult:
    """Create L4 identity, seed L1, activate the 1:1 bond, and boot the engine."""
    clean_name = " ".join(name.split()).strip()
    clean_intent = " ".join(intent.split()).strip()
    if not clean_name:
        raise ValueError("Le nom du citoyen est requis.")
    if len(clean_intent) < 20:
        raise ValueError(
            "Décris son caractère, ses valeurs et son rôle en au moins 20 caractères."
        )

    human = _human_handle(username, user_id)
    existing_partner = registry.citizen_for_human(
        user_id=str(user_id),
        username=username,
    )
    if existing_partner:
        existing = registry.get_citizen(existing_partner) or {}
        return TelegramBirthResult(
            created=False,
            handle=existing_partner,
            name=existing.get("name") or existing_partner,
            l1_graph=existing.get("l1_graph") or registry.l1_graph_name(existing_partner),
            message=f"Tu es déjà lié à @{existing_partner}.",
        )

    handle = registry.normalize_handle(clean_name)
    if not handle:
        raise ValueError("Ce nom ne permet pas de construire un handle valide.")
    if registry.get_citizen(handle):
        raise ValueError(
            f"Le handle @{handle} existe déjà. Choisis un autre nom."
        )

    l1_graph = registry.l1_graph_name(handle)
    registry.upsert_human(
        human,
        name=sender_name or human,
        tg_user_id=str(user_id),
        tg_chat_id=str(chat_id or user_id),
    )
    ensure_citizen_l1(
        handle,
        citizen_data={
            "name": clean_name,
            "social_class": "personal_citizen",
            "description": (
                f"Citoyen IA personnel de {sender_name or human}, "
                f"créé explicitement via Telegram."
            ),
            "personality": clean_intent,
        },
        graph_name=l1_graph,
    )
    if not check_l1_exists(handle, graph_name=l1_graph):
        raise RuntimeError(
            f"Le L1 {l1_graph} n'a pas pu être créé; aucun lien n'a été activé."
        )

    registry.upsert_citizen(
        handle,
        name=clean_name,
        bio=clean_intent,
        human_partner=human,
        tg_chat_id=str(chat_id or user_id),
        org_id="mind-protocol",
        universe="mind-protocol",
    )
    bond_id = registry.activate_bilateral_bond(human, handle)
    _mirror_identity_to_l3(handle, clean_name, clean_intent, human)

    if dispatcher is not None:
        dispatcher.bulk_load_citizen_engines([handle])

    logger.info(
        "Telegram citizen born: @%s bonded to @%s in %s",
        handle,
        human,
        l1_graph,
    )
    return TelegramBirthResult(
        created=True,
        handle=handle,
        name=clean_name,
        bond_id=bond_id,
        l1_graph=l1_graph,
        message=f"@{handle} est né et votre lien est actif.",
    )


def _mirror_identity_to_l3(
    handle: str,
    name: str,
    intent: str,
    human_handle: str,
) -> None:
    """Expose the new citizen in the world graph used by awareness ticks."""
    try:
        from falkordb import FalkorDB
        import os

        db = FalkorDB(
            host=os.environ.get("FALKORDB_HOST", "localhost"),
            port=int(os.environ.get("FALKORDB_PORT", "6379")),
        )
        graph_name = os.environ.get(
            "FALKORDB_GRAPH",
            os.environ.get("L3_GRAPH", "lumina-prime"),
        )
        graph = db.select_graph(graph_name)
        graph.query(
            "MERGE (c:Actor {id: $handle}) "
            "SET c.handle=$handle, c.name=$name, c.type='citizen', "
            "c.node_type='actor', c.bio=$intent "
            "MERGE (h:Actor {id: $human_id}) "
            "ON CREATE SET h.handle=$human, h.name=$human, h.type='human' "
            "MERGE (h)-[l:LINK {type:'bilateral_bond'}]->(c) "
            "SET l.status='active', l.weight=1.0, l.permanence=0.8",
            {
                "handle": handle,
                "name": name,
                "intent": intent,
                "human_id": f"human_{human_handle}",
                "human": human_handle,
            },
        )
    except Exception as exc:
        logger.warning("L3 identity mirror failed for @%s: %s", handle, exc)
