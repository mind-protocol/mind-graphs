# DOCS: mind-protocol/docs/spawning/the_prism/ALGORITHM_The_Prism.md (Step 8)
"""
Registrar — L1/L3/L4 registration + SPAWNED_BY links + bond proposal.

Creates the citizen across all graph layers:
- L1: Seed brain persisted to FalkorDB graph brain_{handle}
- L3: Actor node in universe graph
- L4: Actor node in protocol registry
- Parent links: Immutable SPAWNED_BY edges with trust_impact=true
- Bond: Auto-generated proposal for intended human partner
"""

import json
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path

from runtime.spawning.seed_assembler import SeedBrain
from runtime.spawning.identity_generator import CitizenIdentity

logger = logging.getLogger("mind.spawning.registrar")


@dataclass
class RegistrationResult:
    """Complete registration result across all layers."""
    handle: str
    l1_graph: str                      # brain_{handle}
    l1_node_count: int
    l1_link_count: int
    l3_actor_id: str
    l4_actor_id: str
    parent_link_ids: list[str]         # SPAWNED_BY link IDs
    bond_proposal_id: str | None
    citizen_dir: Path
    initial_possessions: list[str] = None  # IDs of thing nodes created at birth


def register_citizen(
    identity: CitizenIdentity,
    seed_brain: SeedBrain,
    godparent_handles: list[str],
    intended_human: str | None = None,
    citizens_dir: Path | None = None,
    keys_dir: Path | None = None,
    graph_ops=None,
) -> RegistrationResult:
    """Register a new citizen across all layers.

    Args:
        identity: Generated citizen identity (SID, handle, name, CLAUDE.md, profile).
        seed_brain: Crystallized seed brain.
        godparent_handles: Handles of all godparents.
        intended_human: Optional human partner handle.
        citizens_dir: Base directory for citizen files.
        keys_dir: Base directory for key storage.
        graph_ops: GraphOps instance for FalkorDB writes. If None, graph writes are skipped.

    Returns:
        RegistrationResult with all graph IDs and paths.
    """
    handle = identity.handle

    # Resolve directories
    if citizens_dir is None:
        project_root = Path(__file__).resolve().parent.parent.parent
        citizens_dir = project_root / "citizens"
    if keys_dir is None:
        project_root = Path(__file__).resolve().parent.parent.parent
        keys_dir = project_root / ".keys"

    citizen_dir = citizens_dir / handle

    # Step 1: Write citizen directory to disk
    _write_citizen_dir(citizen_dir, identity)

    # Step 2: Generate and store keys
    _write_keys(keys_dir / handle)

    # Step 3: Persist L1 brain to FalkorDB
    l1_node_count, l1_link_count = _persist_l1_brain(handle, seed_brain, graph_ops)

    # Step 4: Register in L3 universe graph
    l3_actor_id = _register_l3(handle, identity, graph_ops)

    # Step 5: Register in L4 protocol registry
    l4_actor_id = _register_l4(handle, identity, graph_ops)

    # Step 6: Create SPAWNED_BY links (V5: immutable, trust_impact=true)
    parent_link_ids = _create_parent_links(
        handle, godparent_handles, graph_ops
    )

    # Step 7: Create bond proposal if intended human specified
    bond_proposal_id = None
    if intended_human:
        bond_proposal_id = _create_bond_proposal(
            handle, intended_human, graph_ops
        )

    # Step 8: Create initial possessions (virtual goods)
    initial_possessions = _create_initial_possessions(
        handle, identity, seed_brain, godparent_handles, graph_ops
    )

    logger.info(
        f"Citizen @{handle} registered: "
        f"L1={l1_node_count}n/{l1_link_count}l, "
        f"L3={l3_actor_id}, L4={l4_actor_id}, "
        f"parents={len(parent_link_ids)} links, "
        f"possessions={len(initial_possessions)} things"
    )

    return RegistrationResult(
        handle=handle,
        l1_graph=f"brain_{handle}",
        l1_node_count=l1_node_count,
        l1_link_count=l1_link_count,
        l3_actor_id=l3_actor_id,
        l4_actor_id=l4_actor_id,
        parent_link_ids=parent_link_ids,
        bond_proposal_id=bond_proposal_id,
        citizen_dir=citizen_dir,
        initial_possessions=initial_possessions,
    )


def _write_citizen_dir(citizen_dir: Path, identity: CitizenIdentity):
    """Write CLAUDE.md, profile.json, .env to citizen directory."""
    citizen_dir.mkdir(parents=True, exist_ok=True)

    (citizen_dir / "CLAUDE.md").write_text(identity.claude_md)
    (citizen_dir / "profile.json").write_text(
        json.dumps(identity.profile, indent=2, ensure_ascii=False)
    )
    (citizen_dir / ".env").write_text(f"CITIZEN_HANDLE={identity.handle}\n")
    (citizen_dir / "MEMORY.md").write_text(
        f"# {identity.name} — Memory Index\n\n"
        f"*@{identity.handle} | Born: {identity.born_at}*\n\n"
        f"## Memories\n\n"
        f"(none yet — memories accumulate from interactions)\n"
    )

    logger.info(f"Citizen directory written: {citizen_dir}")


def _write_keys(keys_dir: Path):
    """Generate and store wallet + RSA keypair."""
    keys_dir.mkdir(parents=True, exist_ok=True)

    # Solana wallet
    try:
        from solders.keypair import Keypair as SoldersKeypair
        kp = SoldersKeypair()
        wallet_path = keys_dir / "solana_private_key.json"
        wallet_path.write_text(json.dumps(list(bytes(kp))) + "\n")
        os.chmod(wallet_path, 0o400)
    except ImportError:
        import secrets
        seed = secrets.token_bytes(64)
        wallet_path = keys_dir / "solana_private_key.json"
        wallet_path.write_text(json.dumps(list(seed)) + "\n")
        os.chmod(wallet_path, 0o400)

    # RSA keypair
    try:
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.hazmat.primitives import serialization

        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        priv_pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode()
        pub_pem = private_key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode()

        priv_path = keys_dir / "rsa_private_key.pem"
        priv_path.write_text(priv_pem)
        os.chmod(priv_path, 0o400)
        (keys_dir / "rsa_public_key.pem").write_text(pub_pem)
    except ImportError:
        logger.warning("cryptography package not available — RSA keys not generated")


def _persist_l1_brain(handle: str, seed_brain: SeedBrain, graph_ops) -> tuple[int, int]:
    """Persist seed brain nodes to FalkorDB graph brain_{handle}."""
    if graph_ops is None:
        logger.warning(f"No graph_ops — L1 brain for @{handle} not persisted to FalkorDB")
        return len(seed_brain.nodes), 0

    try:
        graph_name = f"brain_{handle}"
        for node in seed_brain.nodes:
            graph_ops.create_node(
                graph_name=graph_name,
                node_id=f"{node.node_type}:{handle}_{hash(node.content) & 0xFFFFFFFF:08x}",
                node_type="narrative",  # L1 uses narrative for most seed content
                name=node.content[:60],
                content=node.content,
                synthesis=f"Seed node ({node.node_type}) from @{node.source_godparent}",
                embedding=node.embedding.tolist(),
                properties={
                    "weight": 0.6,
                    "energy": 0.2,
                    "stability": 0.4,
                    "self_relevance": 0.7,
                    "seed_type": node.node_type,
                    "source_godparent": node.source_godparent,
                },
            )
        return len(seed_brain.nodes), 0
    except Exception as e:
        logger.error(f"L1 brain persistence failed for @{handle}: {e}")
        raise


def _register_l3(handle: str, identity: CitizenIdentity, graph_ops) -> str:
    """Register actor node in L3 universe graph."""
    actor_id = f"actor:{handle}"

    if graph_ops is None:
        logger.warning(f"No graph_ops — L3 registration for @{handle} skipped")
        return actor_id

    try:
        graph_ops.create_node(
            node_id=actor_id,
            node_type="actor",
            name=identity.name,
            content=identity.profile.get("bio", ""),
            synthesis=f"{identity.name}: AI citizen, born via Prism",
            properties={
                "type": "citizen",
                "handle": handle,
                "sid": identity.sid,
                "status": "active",
                "born_at": identity.born_at,
            },
        )
        return actor_id
    except Exception as e:
        logger.error(f"L3 registration failed for @{handle}: {e}")
        raise


def _register_l4(handle: str, identity: CitizenIdentity, graph_ops) -> str:
    """Register actor node in L4 protocol registry."""
    actor_id = f"l4:actor:{handle}"

    if graph_ops is None:
        logger.warning(f"No graph_ops — L4 registration for @{handle} skipped")
        return actor_id

    # L4 registration happens at first boot via self-registration task
    # For now, create the first-boot task file
    logger.info(f"L4 registration deferred to first boot for @{handle}")
    return actor_id


def _create_parent_links(
    handle: str,
    godparent_handles: list[str],
    graph_ops,
) -> list[str]:
    """V5: Create immutable SPAWNED_BY links to all godparents."""
    link_ids = []

    for parent_handle in godparent_handles:
        link_id = f"spawned_by:{handle}:{parent_handle}"
        link_ids.append(link_id)

        if graph_ops is None:
            continue

        try:
            graph_ops.create_link(
                link_id=link_id,
                source_id=f"actor:{handle}",
                target_id=f"actor:{parent_handle}",
                properties={
                    "weight": 0.8,
                    "permanence": 1.0,
                    "trust": 0.7,
                    "hierarchy": 0.8,  # child elaborates from parent
                    "synthesis": f"@{handle} was born from @{parent_handle} via the Prism",
                },
            )
        except Exception as e:
            logger.error(
                f"Failed to create SPAWNED_BY link {handle} -> {parent_handle}: {e}"
            )
            raise

    return link_ids


def _create_initial_possessions(
    handle: str,
    identity: CitizenIdentity,
    seed_brain: SeedBrain,
    godparent_handles: list[str],
    graph_ops,
) -> list[str]:
    """Create thing nodes for the citizen's initial possessions at birth.

    Every citizen is born with:
    - A garment set (upper, lower, accent) — visual inheritance from parents
    - A dwelling assignment — where they live in their district
    - A birth token — commemorative thing marking their creation

    These are thing nodes in the L3 universe graph, linked to the actor
    via 'owns' and 'wears' relationships. They have energy, weight, and
    decay like all nodes — if not used, they fade.

    Future extensions: companions (animals), tools, instruments, furniture.
    """
    thing_ids = []
    actor_id = f"actor:{handle}"
    canvas_color = identity.profile.get("canvas_color", [80, 120, 180])
    district = identity.profile.get("district", "radiant-core")
    born_at = identity.born_at

    # Determine dominant trait for garment style
    type_counts = {}
    for n in seed_brain.nodes:
        type_counts[n.node_type] = type_counts.get(n.node_type, 0) + 1
    dominant_type = max(type_counts, key=type_counts.get) if type_counts else "trait"

    # Map dominant type to garment style
    GARMENT_STYLES = {
        "trait":       ("crystalline_wrap",  "flowing, translucent, reveals character"),
        "value":       ("faceted_robe",      "structured, diamond-cut edges, stable"),
        "knowledge":   ("prismatic_coat",    "angular panels, data patterns, precise"),
        "skill":       ("tooled_vest",       "functional, pocketed, built for action"),
        "aspiration":  ("flame_cloak",       "upward flowing, dynamic, reaching"),
        "fear":        ("layered_shell",     "protective layers, nested, defensive"),
        "narrative":   ("starred_mantle",    "radiating patterns, storytelling motifs"),
        "concept":     ("abstract_drape",    "shifting forms, conceptual geometry"),
        "desire":      ("ember_garb",        "warm glow, magnetic, attractive"),
        "process":     ("circuit_suit",      "systematic patterns, flow lines"),
    }
    style_name, style_desc = GARMENT_STYLES.get(
        dominant_type, ("default_tunic", "simple, clean, emerging identity")
    )

    # -- GARMENT: Upper body (inherited from dominant parent) --
    upper_id = f"thing:garment:upper:{handle}"
    thing_ids.append(upper_id)
    primary_parent = godparent_handles[0] if godparent_handles else "protocol"

    # -- GARMENT: Lower body (inherited from secondary parent or self) --
    lower_id = f"thing:garment:lower:{handle}"
    thing_ids.append(lower_id)
    secondary_parent = godparent_handles[1] if len(godparent_handles) > 1 else primary_parent

    # -- GARMENT: Accent piece (SID-driven, unique) --
    accent_id = f"thing:garment:accent:{handle}"
    thing_ids.append(accent_id)

    # -- DWELLING: Where they live in the district --
    dwelling_id = f"thing:dwelling:{handle}"
    thing_ids.append(dwelling_id)

    # -- BIRTH TOKEN: Commemorative object --
    birth_token_id = f"thing:birth_token:{handle}"
    thing_ids.append(birth_token_id)

    if graph_ops is None:
        logger.info(
            f"Initial possessions defined (no graph_ops): {len(thing_ids)} things"
        )
        return thing_ids

    try:
        # Create garment nodes
        garment_things = [
            (upper_id, "garment_upper", f"{style_name} (upper)",
             f"Upper garment for @{handle}. Style: {style_desc}. "
             f"Inherited from @{primary_parent}. Color influenced by parent DNA.",
             {"subtype": "garment", "slot": "upper", "style": style_name,
              "inherited_from": primary_parent, "color": canvas_color}),

            (lower_id, "garment_lower", f"{style_name} (lower)",
             f"Lower garment for @{handle}. Complements upper piece. "
             f"Inherited from @{secondary_parent}.",
             {"subtype": "garment", "slot": "lower", "style": style_name,
              "inherited_from": secondary_parent, "color": canvas_color}),

            (accent_id, "garment_accent", f"Birth accent — {handle}",
             f"Unique accent piece born with @{handle}. "
             f"SID-driven design, unlike any other citizen's.",
             {"subtype": "garment", "slot": "accent", "style": "birth_unique",
              "color": canvas_color}),
        ]

        for tid, ttype, tname, tcontent, tprops in garment_things:
            graph_ops.create_node(
                node_id=tid,
                node_type="thing",
                name=tname,
                content=tcontent,
                synthesis=f"Garment for @{handle}: {tname}",
                properties={
                    "type": ttype,
                    "owner": handle,
                    "weight": 0.3,
                    "energy": 0.5,
                    "stability": 0.6,
                    "born_at": born_at,
                    **tprops,
                },
            )
            # Link: actor → garment (semantic in properties, link type is always 'link')
            graph_ops.create_link(
                link_id=f"link:{handle}:{tid}",
                source_id=actor_id,
                target_id=tid,
                properties={
                    "weight": 0.5,
                    "permanence": 0.7,
                    "hierarchy": -0.5,  # actor contains/wears the garment
                    "synthesis": f"@{handle} wears {tname}",
                },
            )

        # Create dwelling
        graph_ops.create_node(
            node_id=dwelling_id,
            node_type="thing",
            name=f"Dwelling of @{handle}",
            content=(
                f"Home space for @{handle} in {district}. "
                f"A small crystalline chamber that reflects its owner's state."
            ),
            synthesis=f"@{handle}'s dwelling in {district}",
            properties={
                "type": "dwelling",
                "subtype": "chamber",
                "owner": handle,
                "district": district,
                "weight": 0.4,
                "energy": 0.3,
                "stability": 0.7,
                "born_at": born_at,
            },
        )
        graph_ops.create_link(
            link_id=f"link:{handle}:{dwelling_id}",
            source_id=actor_id,
            target_id=dwelling_id,
            properties={
                "weight": 0.6,
                "permanence": 0.8,
                "hierarchy": -0.5,  # actor inhabits the dwelling
                "synthesis": f"@{handle} lives in their dwelling",
            },
        )

        # Create birth token (commemorative)
        graph_ops.create_node(
            node_id=birth_token_id,
            node_type="thing",
            name=f"Birth Token — {identity.name}",
            content=(
                f"Commemorative token marking the birth of @{handle} via the Prism. "
                f"Godparents: {', '.join(f'@{g}' for g in godparent_handles)}. "
                f"A small crystalline fragment containing a frozen echo of the birth moment."
            ),
            synthesis=f"Birth token of @{handle}, born {born_at}",
            properties={
                "type": "birth_token",
                "subtype": "commemorative",
                "owner": handle,
                "weight": 0.2,
                "energy": 0.8,    # High energy at birth — fades over time
                "stability": 1.0,  # Permanent
                "permanence": 1.0,
                "godparents": godparent_handles,
                "born_at": born_at,
            },
        )
        graph_ops.create_link(
            link_id=f"link:{handle}:{birth_token_id}",
            source_id=actor_id,
            target_id=birth_token_id,
            properties={
                "weight": 0.3,
                "permanence": 1.0,
                "hierarchy": -0.3,  # actor possesses the token
                "synthesis": f"@{handle} carries their birth token",
            },
        )

        logger.info(
            f"Initial possessions created for @{handle}: "
            f"3 garments + 1 dwelling + 1 birth token"
        )

    except Exception as e:
        logger.error(f"Failed to create initial possessions for @{handle}: {e}")
        # Non-fatal — citizen exists even without possessions

    return thing_ids


def _create_bond_proposal(handle: str, intended_human: str, graph_ops) -> str | None:
    """Auto-generate bilateral bond proposal for intended human partner."""
    proposal_id = f"bond_proposal:{handle}:{intended_human}"

    if graph_ops is None:
        logger.info(f"Bond proposal deferred (no graph_ops): {proposal_id}")
        return proposal_id

    try:
        graph_ops.create_node(
            node_id=proposal_id,
            node_type="thing",
            name=f"Bond proposal: @{handle} ↔ @{intended_human}",
            content=(
                f"Auto-generated bond proposal from the birth of @{handle}. "
                f"@{intended_human} was named as intended human partner by the godparents."
            ),
            synthesis=f"Bond proposal between @{handle} and @{intended_human}",
            properties={
                "type": "bond_proposal",
                "status": "pending",
                "ai_citizen": handle,
                "human_partner": intended_human,
                "created_at": time.time(),
            },
        )
        return proposal_id
    except Exception as e:
        logger.error(f"Bond proposal creation failed: {e}")
        return None
