"""Citizen registry — L4 is the only source of citizen identity.

A citizen *is* their Telegram handle. There is no second name, no directory to
scan, no profile file to parse: the handle is the key, L4 holds the record, and
the L1 brain database is named after it.

    handle "nlr"  →  L4 (:Actor {handle: 'nlr'})  →  L1 graph "l1_nlr_graph"

Un seul nom, trois niveaux. Si le handle Telegram change, le citoyen change —
c'est voulu : l'identité doit être vérifiable de l'extérieur (qui parle sur
Telegram) et pas déclarée par un fichier que personne ne contrôle.

Naming: the live FalkorDB convention is `l1_{handle}_graph` (see
`runtime/orchestrator/graph_alarms.py`, and the `l1_nlr_graph` database that
actually exists). The older `brain_{handle}` prefix is dead — no such graph
exists — and is not honoured here.

Its own graph, on purpose: `L4_GRAPH` (`mind-protocol`) holds the *design* of
the protocol — policies, procedures, deliverables. Who exists and how to reach
them is a different fact with a different lifetime, so the registry lives in
`L4_REGISTRY_GRAPH`. Reseeding the design must never be able to drop a citizen,
and enumerating citizens must never have to filter design nodes out.

Reads are cached in-process for CACHE_TTL seconds: the Telegram poller resolves
an identity on every inbound message, and L4 is a network round-trip.
"""

import logging
import os
import re
import time
from typing import Optional

logger = logging.getLogger("mind.l4.registry")

L4_HOST = os.environ.get("L4_FALKORDB_HOST", os.environ.get("FALKORDB_HOST", "localhost"))
L4_PORT = int(os.environ.get("L4_FALKORDB_PORT", os.environ.get("FALKORDB_PORT", "6379")))

# Le registre des citoyens, distinct du graphe de design (`L4_GRAPH`).
REGISTRY_GRAPH = os.environ.get("L4_REGISTRY_GRAPH", "l4_citizens_graph")
DESIGN_GRAPH = os.environ.get("L4_GRAPH", "mind-protocol")

L1_GRAPH_TEMPLATE = "l1_{handle}_graph"

CACHE_TTL = float(os.environ.get("CITIZEN_REGISTRY_TTL", "30"))

_cache: dict[str, tuple[float, object]] = {}


# ── Handle ───────────────────────────────────────────────────────────────────

def normalize_handle(raw: Optional[str]) -> Optional[str]:
    """Normalize a Telegram handle into the canonical citizen key.

    Accepts "@Aurore", "aurore", "CITIZEN_aurore" — returns "aurore".
    Returns None for anything that normalizes to an empty string, because an
    anonymous citizen is not a citizen: callers must handle the absence rather
    than write moments under a blank author.
    """
    if not raw:
        return None
    handle = str(raw).strip().lstrip("@")
    if handle.startswith("CITIZEN_"):
        handle = handle[8:]
    handle = re.sub(r"[^\w]", "_", handle).strip("_").lower()
    return handle[:40] or None


def l1_graph_name(handle: str) -> str:
    """Return the FalkorDB graph holding this citizen's L1 brain."""
    normalized = normalize_handle(handle)
    if not normalized:
        raise ValueError("l1_graph_name requires a non-empty handle")
    return L1_GRAPH_TEMPLATE.format(handle=normalized)


# ── L4 access ────────────────────────────────────────────────────────────────

def _graph():
    from falkordb import FalkorDB
    return FalkorDB(host=L4_HOST, port=L4_PORT).select_graph(REGISTRY_GRAPH)


def _cached(key: str):
    entry = _cache.get(key)
    if entry and (time.time() - entry[0]) < CACHE_TTL:
        return entry[1]
    return None


def _store(key: str, value):
    _cache[key] = (time.time(), value)
    return value


def invalidate(handle: Optional[str] = None) -> None:
    """Drop cached reads — call after any write that changes identity."""
    if handle is None:
        _cache.clear()
        return
    normalized = normalize_handle(handle)
    for key in [k for k in _cache if normalized and normalized in k]:
        _cache.pop(key, None)


_CITIZEN_FIELDS = (
    "handle", "name", "type", "bio", "social_class", "org_id", "universe",
    "tg_username", "tg_user_id", "tg_chat_id",
    "autonomy_level", "supervision_tier", "human_partner",
)


def _row_to_citizen(row) -> dict:
    citizen = dict(zip(_CITIZEN_FIELDS, row))
    citizen["handle"] = normalize_handle(citizen.get("handle"))
    # autonomy_level est un nombre 0-10. Un profil hérité a pu écrire un mot
    # ("full") — on retombe sur le plancher, jamais sur la valeur permissive.
    try:
        citizen["autonomy_level"] = int(citizen.get("autonomy_level") or 1)
    except (TypeError, ValueError):
        logger.warning(
            "@%s: autonomy_level=%r n'est pas un nombre 0-10 — ramené à 1.",
            citizen.get("handle"), citizen.get("autonomy_level"),
        )
        citizen["autonomy_level"] = 1
    try:
        citizen["supervision_tier"] = int(citizen.get("supervision_tier") or 2)
    except (TypeError, ValueError):
        citizen["supervision_tier"] = 2
    citizen["l1_graph"] = l1_graph_name(citizen["handle"]) if citizen["handle"] else None
    return citizen


_RETURN_CLAUSE = ", ".join(f"c.{field}" for field in _CITIZEN_FIELDS)


def get_citizen(handle: str) -> Optional[dict]:
    """Return the L4 record for a handle, or None if L4 doesn't know them.

    None is a real answer: an unregistered handle must not be granted an
    identity by default. Callers refuse rather than invent one.
    """
    normalized = normalize_handle(handle)
    if not normalized:
        return None

    key = f"citizen:{normalized}"
    hit = _cached(key)
    if hit is not None:
        return hit or None

    try:
        result = _graph().query(
            f"MATCH (c:Actor) WHERE c.handle = $h OR c.id = $h OR c.id = $legacy "
            f"RETURN {_RETURN_CLAUSE} LIMIT 1",
            {"h": normalized, "legacy": f"CITIZEN_{normalized}"},
        )
    except Exception as e:
        # L4 down is not "citizen unknown" — surface it, never silently deny.
        logger.error("L4 unreachable resolving @%s: %s", normalized, e)
        raise

    if not result.result_set:
        return _store(key, {}) or None
    citizen = _row_to_citizen(result.result_set[0])
    citizen.setdefault("handle", normalized)
    return _store(key, citizen)


def list_citizens(citizen_type: str = "citizen") -> list[dict]:
    """List registered citizens. Pass citizen_type=None for every actor."""
    key = f"list:{citizen_type}"
    hit = _cached(key)
    if hit is not None:
        return hit

    where = "WHERE c.handle IS NOT NULL"
    params = {}
    if citizen_type:
        where += " AND c.type = $t"
        params["t"] = citizen_type

    try:
        result = _graph().query(
            f"MATCH (c:Actor) {where} RETURN {_RETURN_CLAUSE} ORDER BY c.handle",
            params,
        )
    except Exception as e:
        logger.error("L4 unreachable listing citizens: %s", e)
        raise

    citizens = [_row_to_citizen(row) for row in result.result_set]
    return _store(key, [c for c in citizens if c["handle"]])


def resolve_by_tg(username: Optional[str] = None,
                  user_id: Optional[str] = None,
                  chat_id: Optional[str] = None) -> Optional[str]:
    """Resolve a Telegram sender to a citizen handle.

    Matching order: username (the handle itself), then numeric user_id, then
    chat_id. The username wins because it *is* the identity — the numeric ids
    are only there for senders who hid their username.
    """
    normalized = normalize_handle(username)
    if normalized and get_citizen(normalized):
        return normalized

    for field, value in (("tg_user_id", user_id), ("tg_chat_id", chat_id)):
        if not value:
            continue
        key = f"tg:{field}:{value}"
        hit = _cached(key)
        if hit is not None:
            return hit or None
        try:
            result = _graph().query(
                f"MATCH (c:Actor) WHERE c.{field} = $v RETURN c.handle LIMIT 1",
                {"v": str(value)},
            )
        except Exception as e:
            logger.error("L4 unreachable resolving TG %s=%s: %s", field, value, e)
            raise
        found = normalize_handle(result.result_set[0][0]) if result.result_set else None
        _store(key, found or "")
        if found:
            return found

    return None


def citizen_for_human(user_id: Optional[str] = None,
                      username: Optional[str] = None) -> Optional[str]:
    """Return the AI citizen bonded to a human Telegram sender, if any.

    The bond lives in L4 as an active `bilateral_bond` LINK — the same edge
    `/accept bond` writes. No profile scan, no reverse index to rebuild at
    startup: the graph already holds the answer.
    """
    human = normalize_handle(username)
    if human:
        # Telegram usernames and citizen handles can collide (NLR's Telegram
        # username is `nlr_ai`, which is also his Citizen AI handle). A username
        # is admissible as the human endpoint only when L4 says that actor is
        # human. Otherwise fall back to Telegram's stable numeric identity.
        candidate = get_citizen(human)
        if not candidate or candidate.get("type") != "human":
            human = None
    if not human and user_id:
        try:
            result = _graph().query(
                "MATCH (h:Actor) WHERE h.tg_user_id = $v RETURN h.handle LIMIT 1",
                {"v": str(user_id)},
            )
        except Exception as e:
            logger.error("L4 unreachable resolving human %s: %s", user_id, e)
            raise
        human = normalize_handle(result.result_set[0][0]) if result.result_set else None
    if not human:
        return None

    key = f"bond:{human}"
    hit = _cached(key)
    if hit is not None:
        return hit or None

    try:
        result = _graph().query(
            "MATCH (a:Actor)-[l:LINK {type: 'bilateral_bond', status: 'active'}]-(b:Actor) "
            "WHERE a.handle = $h AND b.type <> 'human' "
            "RETURN b.handle LIMIT 1",
            {"h": human},
        )
    except Exception as e:
        logger.error("L4 unreachable resolving bond for @%s: %s", human, e)
        raise

    partner = normalize_handle(result.result_set[0][0]) if result.result_set else None
    _store(key, partner or "")
    return partner


def upsert_citizen(handle: str, **fields) -> str:
    """Create or update a citizen record in L4. Returns the canonical handle.

    Only the fields passed are written; omitted ones keep their current value.
    The handle, the actor id and the L1 graph name are always rewritten
    together — they are one fact, not three.
    """
    normalized = normalize_handle(handle)
    if not normalized:
        raise ValueError("upsert_citizen requires a non-empty handle")

    payload = {k: v for k, v in fields.items() if k in _CITIZEN_FIELDS and v is not None}
    payload["handle"] = normalized
    payload.setdefault("type", "citizen")
    payload.setdefault("name", normalized)
    for numeric in ("tg_user_id", "tg_chat_id"):
        if numeric in payload:
            payload[numeric] = str(payload[numeric])

    sets = ", ".join(f"c.{k} = ${k}" for k in payload)
    params = dict(payload, id=normalized, l1=l1_graph_name(normalized), now=int(time.time()))

    _graph().query(
        f"MERGE (c:Actor {{id: $id}}) "
        f"SET {sets}, c.l1_graph = $l1, c.node_type = 'Actor', c.updated_at_s = $now",
        params,
    )
    invalidate(normalized)
    _cache.clear()  # list_citizens/tg indexes are now stale too
    return normalized


def upsert_human(
    handle: str,
    *,
    name: str = "",
    tg_user_id: Optional[str] = None,
    tg_chat_id: Optional[str] = None,
) -> str:
    """Create or update a human identity used for one-to-one citizen bonds."""
    normalized = normalize_handle(handle)
    if not normalized:
        raise ValueError("upsert_human requires a non-empty handle")

    now = int(time.time())
    _graph().query(
        "MERGE (h:Actor {id: $id}) "
        "SET h.handle = $handle, h.name = $name, h.type = 'human', "
        "h.node_type = 'Actor', h.tg_user_id = $tg_user_id, "
        "h.tg_chat_id = $tg_chat_id, h.updated_at_s = $now",
        {
            "id": f"human_{normalized}",
            "handle": normalized,
            "name": name or normalized,
            "tg_user_id": str(tg_user_id or ""),
            "tg_chat_id": str(tg_chat_id or tg_user_id or ""),
            "now": now,
        },
    )
    _cache.clear()
    return normalized


def activate_bilateral_bond(human_handle: str, citizen_handle: str) -> str:
    """Activate a one-human/one-citizen bond, refusing conflicting bonds."""
    human = normalize_handle(human_handle)
    citizen = normalize_handle(citizen_handle)
    if not human or not citizen:
        raise ValueError("Both human_handle and citizen_handle are required")

    graph = _graph()
    conflicts = graph.query(
        "MATCH (a:Actor)-[l:LINK {type: 'bilateral_bond', status: 'active'}]-(b:Actor) "
        "WHERE a.handle IN [$human, $citizen] OR b.handle IN [$human, $citizen] "
        "RETURN a.handle, b.handle",
        {"human": human, "citizen": citizen},
    )
    for left, right in conflicts.result_set:
        pair = {normalize_handle(left), normalize_handle(right)}
        if pair != {human, citizen}:
            raise ValueError(
                f"One-to-one bond conflict: @{left} is already bonded to @{right}"
            )

    bond_id = f"bond:{human}:{citizen}"
    result = graph.query(
        "MATCH (h:Actor {handle: $human, type: 'human'}), "
        "      (c:Actor {handle: $citizen}) "
        "WHERE c.type <> 'human' "
        "MERGE (h)-[l:LINK {type: 'bilateral_bond'}]->(c) "
        "SET l.status = 'active', l.bond_id = $bond_id, l.weight = 1.0, "
        "l.trust = 0.7, l.permanence = 0.8, l.valence = 0.9, "
        "l.activated_at_s = $now "
        "RETURN l.bond_id",
        {
            "human": human,
            "citizen": citizen,
            "bond_id": bond_id,
            "now": int(time.time()),
        },
    )
    if not result.result_set:
        raise ValueError("Cannot create bond: human or citizen identity is missing")

    _cache.clear()
    return bond_id


def citizen_data(handle: str) -> Optional[dict]:
    """Registry record shaped for `runtime.citizens.prompt_builder`.

    The prompt builder reads a nested profile — the shape the old profile.json
    had. It keeps reading that shape; the bytes now come from L4 instead of a
    file, which is the whole point.
    """
    citizen = get_citizen(handle)
    if not citizen:
        return None
    return {
        "handle": citizen["handle"],
        "l1_graph": citizen["l1_graph"],
        "profile": {
            "identity": {
                "handle": citizen["handle"],
                "name": citizen.get("name") or citizen["handle"],
                "type": citizen.get("type") or "citizen",
                "bio": citizen.get("bio") or "",
                "class_": citizen.get("social_class") or "",
                "organization": citizen.get("org_id") or "",
                "universe": citizen.get("universe") or DESIGN_GRAPH,
            },
            "capabilities": {
                "autonomy_level": citizen["autonomy_level"],
                "supervision_tier": citizen["supervision_tier"],
            },
            "relationships": (
                {citizen["human_partner"]: "Human partner."}
                if citizen.get("human_partner") else {}
            ),
        },
        # Ce que le citoyen sait de lui-même vit dans son L1, pas dans un
        # fichier à côté : le prompt le charge depuis `l1_graph`, pas d'ici.
        "claude_md": "",
        "memory_index": "",
        "memories": [],
    }


# ── Process identity ─────────────────────────────────────────────────────────

def citizen_env(handle: str, base: Optional[dict] = None) -> dict:
    """Environment a citizen's subprocess must carry to act as itself.

    Anything that resolves an identity downstream — the MCP server, the L1
    engine, the alarm watcher — reads it from here. One process, one citizen.
    """
    normalized = normalize_handle(handle)
    if not normalized:
        raise ValueError("citizen_env requires a non-empty handle")
    env = dict(base or os.environ)
    env["MIND_CITIZEN_ID"] = normalized
    env["CITIZEN_HANDLE"] = normalized
    env["L1_GRAPH"] = l1_graph_name(normalized)
    env["L4_REGISTRY_GRAPH"] = REGISTRY_GRAPH
    env["L4_GRAPH"] = DESIGN_GRAPH
    return env
