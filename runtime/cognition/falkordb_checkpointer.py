"""
FalkorDB Brain Checkpointer — persist L1 cognitive state to graph database.

Spec: docs/l1_wiring/IMPLEMENTATION_L1_Wiring.md Phase F

Hybrid persistence strategy:
- Physics runs in-memory (CitizenCognitiveState)
- Periodic checkpoints flush dirty nodes/links to FalkorDB
- On startup, load last checkpoint from FalkorDB into memory
- On shutdown, flush all dirty state

Each citizen gets their own FalkorDB graph: `brain_{citizen_handle}`
"""

from __future__ import annotations

import logging
import os
import time
from typing import Optional

from .models import CitizenCognitiveState, Node, Link, NodeType, LinkType

logger = logging.getLogger("cognition.checkpointer")

# Configuration
CHECKPOINT_INTERVAL = float(os.environ.get("L1_CHECKPOINT_INTERVAL", "300"))  # 5 min default
GRAPH_PREFIX = os.environ.get("L1_GRAPH_PREFIX", "brain_")

# Default query timeout in milliseconds.
# Prevents a single runaway query from locking the database.
QUERY_TIMEOUT_MS = 5000  # 5 seconds


class FalkorDBBrainCheckpointer:
    """Persist citizen brain state to FalkorDB.

    Tracks dirty nodes/links and flushes them periodically.
    Loads state from FalkorDB on startup.
    """

    def __init__(
        self,
        citizen_handle: str,
        db_host: str = "localhost",
        db_port: int = 6379,
    ):
        self.citizen_handle = citizen_handle
        self.graph_name = f"{GRAPH_PREFIX}{citizen_handle}"
        self.db_host = db_host
        self.db_port = db_port

        self._graph = None
        self._dirty_nodes: set[str] = set()
        self._dirty_links: set[str] = set()
        self._last_checkpoint = time.time()
        self._connected = False

    def connect(self) -> bool:
        """Connect to FalkorDB and select the citizen's brain graph."""
        try:
            from falkordb import FalkorDB
            db = FalkorDB(host=self.db_host, port=self.db_port)
            self._graph = db.select_graph(self.graph_name)
            self._connected = True
            logger.info(f"Brain checkpointer connected: {self.graph_name}")
            return True
        except Exception as e:
            logger.warning(f"FalkorDB not available for {self.citizen_handle}: {e}")
            self._connected = False
            return False

    def ensure_schema(self):
        """Create FalkorDB indexes for the brain graph."""
        if not self._connected:
            return

        try:
            # Node index on id
            self._graph.query("CREATE INDEX IF NOT EXISTS FOR (n:Node) ON (n.id)", timeout=QUERY_TIMEOUT_MS)
            # Node index on node_type for type-based queries
            self._graph.query("CREATE INDEX IF NOT EXISTS FOR (n:Node) ON (n.node_type)", timeout=QUERY_TIMEOUT_MS)
            logger.debug(f"Schema ensured for {self.graph_name}")
        except Exception as e:
            logger.warning(f"Schema setup failed for {self.graph_name}: {e}")

    def mark_dirty(self, node_id: Optional[str] = None, link_id: Optional[str] = None):
        """Mark a node or link as needing persistence."""
        if node_id:
            self._dirty_nodes.add(node_id)
        if link_id:
            self._dirty_links.add(link_id)

    def should_checkpoint(self) -> bool:
        """Check if enough time has passed for a checkpoint."""
        if not self._connected:
            return False
        return time.time() - self._last_checkpoint > CHECKPOINT_INTERVAL

    def sync_external_nodes(self, state: CitizenCognitiveState):
        """Detect nodes added externally (graph_write, scripts) and merge into state.

        The in-memory CitizenCognitiveState can diverge from FalkorDB when
        nodes are added via graph_write or direct Cypher without going through
        the tick runner. This method re-scans FalkorDB and adds missing nodes.

        Called periodically alongside checkpoint (every CHECKPOINT_INTERVAL).
        """
        if not self._connected:
            return

        try:
            # Count nodes in FalkorDB vs in-memory
            result = self._graph.query("MATCH (n:Node) RETURN n.id, n.node_type, n.type, n.content, n.weight, n.energy, n.synthesis", timeout=QUERY_TIMEOUT_MS)
            if not result.result_set:
                return

            in_memory_ids = set(state.nodes.keys())
            added = 0

            for row in result.result_set:
                node_id = row[0]
                if node_id in in_memory_ids:
                    continue

                # New node found in FalkorDB but not in memory — add it
                try:
                    nt_str = row[1] or row[2] or "concept"
                    try:
                        nt = NodeType(nt_str)
                    except ValueError:
                        nt = NodeType.CONCEPT

                    node = Node(
                        id=node_id,
                        node_type=nt,
                        content=row[3] or node_id,
                        weight=float(row[4] or 0.1),
                        energy=float(row[5] or 0.0),
                    )
                    node.synthesis = row[6] or ""
                    state.nodes[node_id] = node
                    added += 1
                except Exception as e:
                    logger.error(f"Failed to sync external node {node_id} for {self.citizen_handle}: {e}")
                    continue

            if added > 0:
                logger.info(f"Synced {added} external nodes for {self.citizen_handle} ({len(state.nodes)} total)")

        except Exception as e:
            logger.warning(f"External node sync failed for {self.citizen_handle}: {e}")

    def checkpoint(self, state: CitizenCognitiveState):
        """Flush ALL nodes and links to FalkorDB + sync externally added nodes.

        1. Sync: detect nodes added via graph_write/scripts (not in memory)
        2. Flush: write all in-memory state to FalkorDB
        """
        if not self._connected:
            return

        # Sync external nodes first (graph_write, session_to_graph, etc.)
        self.sync_external_nodes(state)

        flushed_nodes = 0
        flushed_links = 0

        # Flush ALL nodes (tick runner modifies energy/weight in-memory)
        for node_id, node in state.nodes.items():
            try:
                self._upsert_node(node)
                flushed_nodes += 1
            except Exception as e:
                logger.warning(f"Node upsert failed for {node_id}: {e}")

        # Flush ALL links
        for link in state.links:
            try:
                self._upsert_link(link)
                flushed_links += 1
            except Exception as e:
                link_key = f"{link.source_id}_{link.target_id}"
                logger.warning(f"Link upsert failed for {link_key}: {e}")
        self._last_checkpoint = time.time()

        # Persist limbic state (drives must survive restarts for health scores)
        self._save_limbic(state)

        # Persist metabolism (adaptive peak_hour must survive restarts)
        self._save_metabolism(state)

        if flushed_nodes or flushed_links:
            logger.info(
                f"Checkpoint {self.citizen_handle}: "
                f"{flushed_nodes} nodes, {flushed_links} links flushed"
            )

    def _upsert_node(self, node: Node):
        """Upsert a single node to FalkorDB."""
        # Per REVIEW_F4_F5_Coherence fix: all drive-affinity fields, no emotional_charge
        query = """
        MERGE (n:Node {id: $id})
        SET n.name = $name,
            n.node_type = $node_type,
            n.type = $type,
            n.weight = $weight,
            n.energy = $energy,
            n.stability = $stability,
            n.recency = $recency,
            n.synthesis = $synthesis,
            n.content = $content,
            n.self_relevance = $self_relevance,
            n.partner_relevance = $partner_relevance,
            n.novelty_affinity = $novelty_affinity,
            n.goal_relevance = $goal_relevance,
            n.care_affinity = $care_affinity,
            n.achievement_affinity = $achievement_affinity,
            n.risk_affinity = $risk_affinity,
            n.activation_count = $activation_count,
            n.created_at_s = $created_at_s,
            n.last_activated_s = $last_activated_s
        """
        params = {
            "id": node.id,
            "name": node.content[:100] if node.content else node.id,
            "node_type": node.node_type.value if isinstance(node.node_type, NodeType) else str(node.node_type),
            "type": node.node_type.value if isinstance(node.node_type, NodeType) else str(node.node_type),
            "weight": node.weight,
            "energy": node.energy,
            "stability": getattr(node, 'stability', 0.5),
            "recency": getattr(node, 'recency', 0.0),
            "synthesis": "",  # Not on Node model, kept for schema compat
            "content": node.content or "",
            "self_relevance": getattr(node, 'self_relevance', 0.5),
            "partner_relevance": getattr(node, 'partner_relevance', 0.0),
            "novelty_affinity": getattr(node, 'novelty_affinity', 0.0),
            "goal_relevance": getattr(node, 'goal_relevance', 0.0),
            "care_affinity": getattr(node, 'care_affinity', 0.0),
            "achievement_affinity": getattr(node, 'achievement_affinity', 0.0),
            "risk_affinity": getattr(node, 'risk_affinity', 0.0),
            "activation_count": node.activation_count,
            "created_at_s": int(getattr(node, 'created_at', 0)),
            "last_activated_s": int(getattr(node, 'last_activated_at', 0)),
        }
        self._graph.query(query, params, timeout=QUERY_TIMEOUT_MS)

    def _upsert_link(self, link: Link):
        """Upsert a single link to FalkorDB.

        Per REVIEW_F4_F5_Coherence.md Issue 5: includes ALL LinkBase fields
        (stability, recency, polarity, valence, hierarchy, permanence).
        """
        query = """
        MATCH (a:Node {id: $source_id}), (b:Node {id: $target_id})
        MERGE (a)-[r:LINK {id: $id}]->(b)
        SET r.relation_kind = $relation_kind,
            r.weight = $weight,
            r.energy = $energy,
            r.stability = $stability,
            r.recency = $recency,
            r.affinity = $affinity,
            r.aversion = $aversion,
            r.trust = $trust,
            r.friction = $friction,
            r.polarity_ab = $polarity_ab,
            r.polarity_ba = $polarity_ba,
            r.valence = $valence,
            r.hierarchy = $hierarchy,
            r.permanence = $permanence
        """
        link_id = f"{link.source_id}_{link.target_id}_{link.link_type.value}"
        params = {
            "id": link_id,
            "source_id": link.source_id,
            "target_id": link.target_id,
            "relation_kind": link.link_type.value if isinstance(link.link_type, LinkType) else str(link.link_type),
            "weight": link.weight,
            "energy": getattr(link, 'energy', 0.0),
            "stability": getattr(link, 'stability', 0.5),
            "recency": getattr(link, 'recency', 0.0),
            "affinity": getattr(link, 'affinity', 0.0),
            "aversion": getattr(link, 'aversion', 0.0),
            "trust": getattr(link, 'trust', 0.0),
            "friction": getattr(link, 'friction', 0.0),
            "polarity_ab": getattr(link, 'polarity_ab', 0.0),
            "polarity_ba": getattr(link, 'polarity_ba', 0.0),
            "valence": getattr(link, 'valence', 0.0),
            "hierarchy": getattr(link, 'hierarchy', 0.0),
            "permanence": getattr(link, 'permanence', 0.5),
        }
        self._graph.query(query, params, timeout=QUERY_TIMEOUT_MS)

    def load_state(self) -> Optional[CitizenCognitiveState]:
        """Load a citizen's brain state from FalkorDB.

        Returns None if no brain exists in the database.
        """
        if not self._connected:
            return None

        try:
            # Count nodes
            result = self._graph.query("MATCH (n:Node) RETURN count(n) as cnt", timeout=QUERY_TIMEOUT_MS)
            if not result.result_set or result.result_set[0][0] == 0:
                logger.info(f"No brain state in {self.graph_name}")
                return None

            node_count = result.result_set[0][0]

            # Load nodes
            state = CitizenCognitiveState(citizen_id=self.citizen_handle)
            node_result = self._graph.query(
                "MATCH (n:Node) RETURN n.id, n.name, n.node_type, n.type, "
                "n.weight, n.energy, n.stability, n.activation_count, "
                "n.synthesis, n.content, n.novelty_affinity, n.goal_relevance, "
                "n.care_affinity, n.achievement_affinity, n.risk_affinity, "
                "n.self_relevance, n.partner_relevance",
                timeout=QUERY_TIMEOUT_MS,
            )

            for row in node_result.result_set:
                node_id, name, node_type_str = row[0], row[1], row[2]
                try:
                    nt = NodeType(node_type_str) if node_type_str else NodeType.CONCEPT
                except ValueError:
                    nt = NodeType.CONCEPT

                node = Node(
                    id=node_id,
                    node_type=nt,
                    content=row[9] or name or node_id,
                    weight=float(row[4] or 0),
                    energy=float(row[5] or 0),
                    activation_count=int(row[7] or 0),
                )
                # Set optional fields
                node.stability = float(row[6] or 0.5)
                node.synthesis = row[8] or ""
                node.content = row[9] or ""
                node.novelty_affinity = float(row[10] or 0)
                node.goal_relevance = float(row[11] or 0)
                node.care_affinity = float(row[12] or 0)
                node.achievement_affinity = float(row[13] or 0)
                node.risk_affinity = float(row[14] or 0)
                node.self_relevance = float(row[15] or 0.5)
                node.partner_relevance = float(row[16] or 0)
                state.nodes[node_id] = node

            # Load links
            link_result = self._graph.query(
                "MATCH (a:Node)-[r:LINK]->(b:Node) "
                "RETURN r.id, a.id, b.id, r.relation_kind, r.weight, "
                "r.energy, r.trust, r.friction, r.affinity, r.aversion, "
                "r.stability, r.permanence",
                timeout=QUERY_TIMEOUT_MS,
            )

            for row in link_result.result_set:
                link_id = row[0] or f"{row[1]}_{row[2]}"
                try:
                    lt = LinkType(row[3]) if row[3] else LinkType.ASSOCIATES
                except ValueError:
                    lt = LinkType.ASSOCIATES

                link = Link(
                    source_id=row[1],
                    target_id=row[2],
                    link_type=lt,
                    weight=float(row[4] or 0),
                )
                link.energy = float(row[5] or 0)
                link.trust = float(row[6] or 0)
                link.friction = float(row[7] or 0)
                link.affinity = float(row[8] or 0)
                link.aversion = float(row[9] or 0)
                link.stability = float(row[10] or 0.5)
                state.links.append(link)

            # Restore limbic state (drives + emotions survive restarts)
            self._load_limbic(state)

            # Restore metabolism (circadian adaptation survives restarts)
            self._load_metabolism(state)

            logger.info(
                f"Brain loaded for {self.citizen_handle}: "
                f"{len(state.nodes)} nodes, {len(state.links)} links"
            )
            return state

        except Exception as e:
            logger.exception(f"Failed to load brain state for {self.citizen_handle}: {e}")
            return None

    # ------------------------------------------------------------------
    # Limbic state persistence
    # ------------------------------------------------------------------

    def _save_limbic(self, state: CitizenCognitiveState):
        """Persist limbic state (drives + emotions) as a __limbic__ Meta node."""
        if not self._connected:
            return

        import json
        limbic = state.limbic

        data = json.dumps({
            "drives": {
                name: {"intensity": drive.intensity, "baseline": drive.baseline}
                for name, drive in limbic.drives.items()
            },
            "emotions": dict(limbic.emotions),
            "ticks_since_social": limbic.ticks_since_social,
        })

        try:
            self._graph.query(
                "MERGE (m:Meta {id: '__limbic__'}) "
                "SET m.data = $data, m.updated_at = $ts",
                {"data": data, "ts": int(time.time())},
                timeout=QUERY_TIMEOUT_MS,
            )
        except Exception as e:
            logger.warning(f"Limbic save failed for {self.citizen_handle}: {e}")

    def _load_limbic(self, state: CitizenCognitiveState):
        """Restore limbic state from the __limbic__ Meta node."""
        if not self._connected:
            return

        try:
            result = self._graph.query(
                "MATCH (m:Meta {id: '__limbic__'}) RETURN m.data",
                timeout=QUERY_TIMEOUT_MS,
            )
            if result.result_set and result.result_set[0][0]:
                import json
                from .models import Drive, DriveName, LimbicState
                data = json.loads(result.result_set[0][0])

                # Restore drives
                for drive_name, drive_data in data.get("drives", {}).items():
                    drive = state.limbic.drives.get(drive_name)
                    if drive is not None:
                        drive.intensity = drive_data.get("intensity", 0.0)
                        drive.baseline = drive_data.get("baseline", 0.3)

                # Restore emotions
                for emotion_name, intensity in data.get("emotions", {}).items():
                    state.limbic.emotions[emotion_name] = intensity

                # Restore social timer
                state.limbic.ticks_since_social = data.get("ticks_since_social", 0)

                logger.info(
                    f"Limbic restored for {self.citizen_handle}: "
                    f"{len(data.get('drives', {}))} drives, "
                    f"{len(data.get('emotions', {}))} emotions"
                )
        except Exception as e:
            logger.warning(f"Limbic load failed for {self.citizen_handle}: {e}")

    # ------------------------------------------------------------------
    # Metabolism persistence
    # ------------------------------------------------------------------

    def _save_metabolism(self, state: CitizenCognitiveState):
        """Persist metabolism state as a __metabolism__ node in the brain graph."""
        metabolism = getattr(state, 'metabolism', None)
        if metabolism is None or not self._connected:
            return

        import json
        data = json.dumps({
            "timezone_offset": metabolism.timezone_offset,
            "peak_hour": metabolism.peak_hour,
            "sensitivity": metabolism.sensitivity,
            "last_adaptation_tick": metabolism.last_adaptation_tick,
        })

        try:
            self._graph.query(
                "MERGE (m:Meta {id: '__metabolism__'}) "
                "SET m.data = $data, m.updated_at = $ts",
                {"data": data, "ts": int(time.time())},
                timeout=QUERY_TIMEOUT_MS,
            )
        except Exception as e:
            logger.warning(f"Metabolism save failed for {self.citizen_handle}: {e}")

    def _load_metabolism(self, state: CitizenCognitiveState):
        """Restore metabolism state from the __metabolism__ node."""
        if not self._connected:
            return

        try:
            result = self._graph.query(
                "MATCH (m:Meta {id: '__metabolism__'}) RETURN m.data",
                timeout=QUERY_TIMEOUT_MS,
            )
            if result.result_set and result.result_set[0][0]:
                import json
                from .metabolism import CitizenMetabolism
                data = json.loads(result.result_set[0][0])
                state.metabolism = CitizenMetabolism(
                    timezone_offset=data.get("timezone_offset", 1.0),
                    peak_hour=data.get("peak_hour", 14.0),
                    sensitivity=data.get("sensitivity", {}),
                    last_adaptation_tick=data.get("last_adaptation_tick", 0),
                )
                logger.info(
                    f"Metabolism restored for {self.citizen_handle}: "
                    f"peak={state.metabolism.peak_hour:.1f}h, "
                    f"tz=UTC{state.metabolism.timezone_offset:+.0f}"
                )
            else:
                # No saved metabolism — create default (Paris)
                from .metabolism import CitizenMetabolism
                state.metabolism = CitizenMetabolism()
        except Exception as e:
            logger.warning(f"Metabolism load failed for {self.citizen_handle}: {e}")

    def flush_all(self, state: CitizenCognitiveState):
        """Flush entire state to FalkorDB (used on shutdown)."""
        if not self._connected:
            return

        self._dirty_nodes = set(state.nodes.keys())
        self._dirty_links = {f"{l.source_id}_{l.target_id}" for l in state.links}
        self.checkpoint(state)
        self._save_limbic(state)
        self._save_metabolism(state)
        logger.info(f"Full flush for {self.citizen_handle}: {len(state.nodes)}n, {len(state.links)}l")
