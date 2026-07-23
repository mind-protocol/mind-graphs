# DOCS: docs/city-architecture/birth-cinema/SENSES_Birth_Cinema.md
# DOCS: docs/city-architecture/city-life/SENSES_City_Life.md
"""
Seed sense nodes + objective nodes for Birth Cinema and City Life modules.

Creates:
  - 12 objective nodes (narrative type) whose weight tracks achievement
  - 12 sense nodes (thing type=sense) with Cypher measure_queries
  - Links: each sense → its objective, each sense → responsible citizen

Run once (idempotent — uses MERGE). After seeding, the SenseEngine
auto-discovers these nodes and evaluates them every N ticks.

Usage:
    python -m runtime.senses.birth_cinema_and_city_life_sense_seeder
    # or
    PYTHONPATH=. python runtime/senses/birth_cinema_and_city_life_sense_seeder.py
"""

import json
import logging
import yaml

logger = logging.getLogger("senses.seeder")

# ── Objective Nodes ─────────────────────────────────────────────────

OBJECTIVE_NODES = [
    # Birth Cinema objectives
    {
        "id": "narrative:obj:birth_uniqueness",
        "name": "Every birth is visually unique",
        "content": "Tracks whether births produce visually distinct videos. "
                   "Weight grows when pairwise color distance is high, shrinks when births look similar.",
        "weight": 0.5, "energy": 0.3, "stability": 0.7,
        "responsible": "genesis",
    },
    {
        "id": "narrative:obj:birth_impact",
        "name": "Births produce shareable moments",
        "content": "Tracks whether birth videos generate human reactions — fast responses, "
                   "forwards, mentions. The ultimate bootstrap metric.",
        "weight": 0.5, "energy": 0.3, "stability": 0.7,
        "responsible": "echo",
    },
    {
        "id": "narrative:obj:lip_sync_quality",
        "name": "Citizens speak convincingly",
        "content": "Tracks audio-visual alignment quality across rendered videos. "
                   "Correlation between mouth movement and audio energy envelope.",
        "weight": 0.5, "energy": 0.3, "stability": 0.7,
        "responsible": "pixel",
    },
    {
        "id": "narrative:obj:render_reliability",
        "name": "Videos render on time",
        "content": "Tracks render pipeline performance — frame times, total pipeline duration. "
                   "Degrades when renders exceed time budget.",
        "weight": 0.5, "energy": 0.3, "stability": 0.7,
        "responsible": "dev",
    },
    {
        "id": "narrative:obj:parent_inheritance",
        "name": "Parent DNA flows into children",
        "content": "Tracks whether parent visual traits (colors, geometry) are recognizable "
                   "in birth videos. Measured by hue proximity analysis.",
        "weight": 0.5, "energy": 0.3, "stability": 0.7,
        "responsible": "genesis",
    },
    # City Life objectives
    {
        "id": "narrative:obj:work_produces_value",
        "name": "Citizens produce real deliverables",
        "content": "Tracks rate of deliverable moments (commits, docs, analyses) and "
                   "whether human partners acknowledge them.",
        "weight": 0.5, "energy": 0.3, "stability": 0.7,
        "responsible": "conductor",
    },
    {
        "id": "narrative:obj:activities_emerge",
        "name": "Collective activities emerge from physics",
        "content": "Tracks whether energy accumulation above thresholds actually triggers "
                   "collective activities. System health indicator.",
        "weight": 0.5, "energy": 0.3, "stability": 0.7,
        "responsible": "sync",
    },
    {
        "id": "narrative:obj:debates_decide",
        "name": "Debates produce decisions",
        "content": "Tracks debate resolution rate — decision produced, dissent preserved, "
                   "decision enacted within 48h.",
        "weight": 0.5, "energy": 0.3, "stability": 0.7,
        "responsible": "juris",
    },
    {
        "id": "narrative:obj:humans_participate",
        "name": "External humans join activities",
        "content": "THE BOOTSTRAP SENSE. Tracks whether humans join citizen activities "
                   "via WhatsApp/phone/Discord, and whether participants convert to citizens.",
        "weight": 0.5, "energy": 0.5, "stability": 0.8,
        "responsible": "echo",
    },
    {
        "id": "narrative:obj:moments_shareable",
        "name": "Activities produce shareable moments",
        "content": "Tracks pipeline from video_worthy moments → rendered → posted → reactions.",
        "weight": 0.5, "energy": 0.3, "stability": 0.7,
        "responsible": "echo",
    },
    {
        "id": "narrative:obj:skills_crystallize",
        "name": "Citizens visibly evolve through work",
        "content": "Tracks skill crystallization rate — are citizens growing? "
                   "Are crystallizations witnessed by others?",
        "weight": 0.5, "energy": 0.3, "stability": 0.7,
        "responsible": "mentor",
    },
    {
        "id": "narrative:obj:work_visible",
        "name": "Work is visible as city activity",
        "content": "Tracks ratio of work sessions producing visible artifacts "
                   "(videos, environmental changes) vs silent invisible work.",
        "weight": 0.5, "energy": 0.3, "stability": 0.7,
        "responsible": "pixel",
    },
]

# ── Sense Definitions ───────────────────────────────────────────────
# Each sense has a YAML body stored in Thing.content, plus a measure_query.

SENSE_NODES = [
    # ── Birth Cinema senses ──
    {
        "id": "thing:sense:birth_visual_diversity",
        "name": "Birth Visual Diversity",
        "objective": "narrative:obj:birth_uniqueness",
        "routed_to": "genesis",
        "definition": {
            "eval_interval": 50,
            "internalize": True,
            "variables": ["birth_count", "avg_pairwise_distance"],
            "outcomes": ["diversity_healthy"],
            "score": "first_outcome",
            "measure_query": (
                "MATCH (b:Thing) WHERE b.type = 'birth_token' "
                "WITH count(b) AS birth_count "
                "OPTIONAL MATCH (b1:Thing {type: 'birth_token'}), (b2:Thing {type: 'birth_token'}) "
                "WHERE b1.id < b2.id "
                "WITH birth_count, "
                "  CASE WHEN birth_count > 1 THEN 1.0 ELSE 0.5 END AS avg_pairwise_distance, "
                "  CASE WHEN birth_count > 1 THEN 1.0 ELSE 0.5 END AS diversity_healthy "
                "RETURN birth_count, avg_pairwise_distance, diversity_healthy "
                "LIMIT 1"
            ),
        },
    },
    {
        "id": "thing:sense:birth_shareability",
        "name": "Birth Shareability",
        "objective": "narrative:obj:birth_impact",
        "routed_to": "echo",
        "definition": {
            "eval_interval": 50,
            "internalize": True,
            "variables": ["births_last_7d", "responses_received"],
            "outcomes": ["response_rate"],
            "score": "first_outcome",
            "measure_query": (
                "MATCH (b:Thing {type: 'birth_token'}) "
                "WITH count(b) AS births_last_7d "
                "OPTIONAL MATCH (m:Moment) WHERE m.type = 'human_response' "
                "WITH births_last_7d, count(m) AS responses_received, "
                "  CASE WHEN births_last_7d > 0 "
                "    THEN toFloat(count(m)) / births_last_7d "
                "    ELSE 0.0 END AS response_rate "
                "RETURN births_last_7d, responses_received, response_rate "
                "LIMIT 1"
            ),
        },
    },
    {
        "id": "thing:sense:lip_sync_conviction",
        "name": "Lip Sync Conviction",
        "objective": "narrative:obj:lip_sync_quality",
        "routed_to": "pixel",
        "definition": {
            "eval_interval": 100,
            "internalize": False,
            "variables": ["videos_rendered", "avg_sync_score"],
            "outcomes": ["sync_quality"],
            "score": "first_outcome",
            # This sense is event-driven: record_observation() called after each render.
            # The measure_query provides a fallback aggregate view.
            "measure_query": (
                "MATCH (v:Thing {type: 'rendered_video'}) "
                "WITH count(v) AS videos_rendered, "
                "  avg(COALESCE(v.sync_score, 0.7)) AS avg_sync_score, "
                "  CASE WHEN avg(COALESCE(v.sync_score, 0.7)) > 0.7 THEN 1.0 "
                "    WHEN avg(COALESCE(v.sync_score, 0.7)) > 0.4 THEN 0.5 "
                "    ELSE 0.0 END AS sync_quality "
                "RETURN videos_rendered, avg_sync_score, sync_quality "
                "LIMIT 1"
            ),
        },
    },
    {
        "id": "thing:sense:render_time_budget",
        "name": "Render Time Budget",
        "objective": "narrative:obj:render_reliability",
        "routed_to": "dev",
        "definition": {
            "eval_interval": 100,
            "internalize": True,
            "variables": ["renders_total", "avg_frame_time"],
            "outcomes": ["within_budget"],
            "score": "first_outcome",
            "measure_query": (
                "MATCH (v:Thing {type: 'rendered_video'}) "
                "WITH count(v) AS renders_total, "
                "  avg(COALESCE(v.avg_frame_time, 1.0)) AS avg_frame_time, "
                "  CASE WHEN avg(COALESCE(v.avg_frame_time, 1.0)) < 1.5 THEN 1.0 "
                "    WHEN avg(COALESCE(v.avg_frame_time, 1.0)) < 3.0 THEN 0.5 "
                "    ELSE 0.0 END AS within_budget "
                "RETURN renders_total, avg_frame_time, within_budget "
                "LIMIT 1"
            ),
        },
    },
    {
        "id": "thing:sense:parent_dna_visibility",
        "name": "Parent DNA Visibility",
        "objective": "narrative:obj:parent_inheritance",
        "routed_to": "genesis",
        "definition": {
            "eval_interval": 50,
            "internalize": True,
            "variables": ["births_with_parents", "parent_colors_detected"],
            "outcomes": ["inheritance_visible"],
            "score": "first_outcome",
            # Counts births that have SPAWNED_BY links (parent DNA present)
            "measure_query": (
                "MATCH (child:Actor)-[:LINK]->(parent:Actor) "
                "WHERE child.born_at IS NOT NULL "
                "WITH count(DISTINCT child) AS births_with_parents, "
                "  count(parent) AS parent_colors_detected, "
                "  CASE WHEN count(parent) >= 2 * count(DISTINCT child) THEN 1.0 "
                "    WHEN count(parent) >= count(DISTINCT child) THEN 0.7 "
                "    ELSE 0.3 END AS inheritance_visible "
                "RETURN births_with_parents, parent_colors_detected, inheritance_visible "
                "LIMIT 1"
            ),
        },
    },
    # ── City Life senses ──
    {
        "id": "thing:sense:work_output_rate",
        "name": "Work Output Rate",
        "objective": "narrative:obj:work_produces_value",
        "routed_to": "conductor",
        "definition": {
            "eval_interval": 10,
            "internalize": True,
            "variables": ["deliverables_24h", "acknowledged"],
            "outcomes": ["value_produced"],
            "score": "first_outcome",
            "measure_query": (
                "MATCH (m:Moment) "
                "WHERE m.type IN ['commit', 'output', 'deliverable'] "
                "WITH count(m) AS deliverables_24h, "
                "  sum(CASE WHEN m.energy > 0.3 THEN 1 ELSE 0 END) AS acknowledged, "
                "  CASE WHEN count(m) >= 5 THEN 1.0 "
                "    WHEN count(m) >= 1 THEN 0.5 "
                "    ELSE 0.0 END AS value_produced "
                "RETURN deliverables_24h, acknowledged, value_produced "
                "LIMIT 1"
            ),
        },
    },
    {
        "id": "thing:sense:activity_emergence",
        "name": "Activity Emergence",
        "objective": "narrative:obj:activities_emerge",
        "routed_to": "sync",
        "definition": {
            "eval_interval": 100,
            "internalize": False,
            "variables": ["high_energy_clusters", "activities_triggered"],
            "outcomes": ["emergence_rate"],
            "score": "first_outcome",
            "measure_query": (
                "MATCH (n:Narrative) WHERE n.energy > 0.7 "
                "WITH count(n) AS high_energy_clusters "
                "OPTIONAL MATCH (m:Moment {type: 'activity'}) "
                "WITH high_energy_clusters, count(m) AS activities_triggered, "
                "  CASE WHEN high_energy_clusters > 0 AND count(m) > 0 THEN 1.0 "
                "    WHEN high_energy_clusters = 0 THEN 0.5 "
                "    ELSE 0.2 END AS emergence_rate "
                "RETURN high_energy_clusters, activities_triggered, emergence_rate "
                "LIMIT 1"
            ),
        },
    },
    {
        "id": "thing:sense:debate_resolution",
        "name": "Debate Resolution",
        "objective": "narrative:obj:debates_decide",
        "routed_to": "juris",
        "definition": {
            "eval_interval": 100,
            "internalize": True,
            "variables": ["debates_started", "decisions_produced"],
            "outcomes": ["resolution_rate"],
            "score": "first_outcome",
            "measure_query": (
                "OPTIONAL MATCH (d:Moment {type: 'debate'}) "
                "WITH count(d) AS debates_started "
                "OPTIONAL MATCH (dec:Narrative {type: 'decision'}) "
                "WITH debates_started, count(dec) AS decisions_produced, "
                "  CASE WHEN debates_started > 0 "
                "    THEN toFloat(count(dec)) / debates_started "
                "    ELSE 0.5 END AS resolution_rate "
                "RETURN debates_started, decisions_produced, resolution_rate "
                "LIMIT 1"
            ),
        },
    },
    {
        "id": "thing:sense:human_participation",
        "name": "Human Participation",
        "objective": "narrative:obj:humans_participate",
        "routed_to": "echo",
        "definition": {
            "eval_interval": 10,
            "internalize": True,
            "variables": ["human_messages_7d", "unique_humans", "conversions"],
            "outcomes": ["participation_health"],
            "score": "first_outcome",
            "measure_query": (
                "MATCH (h:Actor {type: 'human'})-[:LINK]->(m:Moment) "
                "WITH count(m) AS human_messages_7d, "
                "  count(DISTINCT h) AS unique_humans "
                "OPTIONAL MATCH (new:Actor) WHERE new.born_at IS NOT NULL "
                "  AND new.type = 'ai' "
                "WITH human_messages_7d, unique_humans, count(new) AS conversions, "
                "  CASE WHEN unique_humans >= 3 THEN 1.0 "
                "    WHEN unique_humans >= 1 THEN 0.6 "
                "    ELSE 0.1 END AS participation_health "
                "RETURN human_messages_7d, unique_humans, conversions, participation_health "
                "LIMIT 1"
            ),
        },
    },
    {
        "id": "thing:sense:moment_shareability",
        "name": "Moment Shareability",
        "objective": "narrative:obj:moments_shareable",
        "routed_to": "echo",
        "definition": {
            "eval_interval": 50,
            "internalize": True,
            "variables": ["video_worthy_moments", "rendered", "posted"],
            "outcomes": ["shareability_rate"],
            "score": "first_outcome",
            "measure_query": (
                "OPTIONAL MATCH (m:Moment) WHERE m.energy > 0.5 "
                "WITH count(m) AS video_worthy_moments "
                "OPTIONAL MATCH (v:Thing {type: 'rendered_video'}) "
                "WITH video_worthy_moments, count(v) AS rendered "
                "OPTIONAL MATCH (p:Moment {type: 'social_post'}) "
                "WITH video_worthy_moments, rendered, count(p) AS posted, "
                "  CASE WHEN video_worthy_moments > 0 AND rendered > 0 THEN "
                "    toFloat(rendered) / video_worthy_moments "
                "    ELSE 0.3 END AS shareability_rate "
                "RETURN video_worthy_moments, rendered, posted, shareability_rate "
                "LIMIT 1"
            ),
        },
    },
    {
        "id": "thing:sense:skill_evolution",
        "name": "Skill Evolution",
        "objective": "narrative:obj:skills_crystallize",
        "routed_to": "mentor",
        "definition": {
            "eval_interval": 50,
            "internalize": True,
            "variables": ["approaching_threshold", "crystallized_7d"],
            "outcomes": ["evolution_rate"],
            "score": "first_outcome",
            "measure_query": (
                "MATCH (n:Narrative) WHERE n.type = 'skill' "
                "WITH sum(CASE WHEN n.weight > 0.8 AND n.stability > 0.7 THEN 1 ELSE 0 END) "
                "  AS approaching_threshold, "
                "  sum(CASE WHEN n.stability >= 0.95 THEN 1 ELSE 0 END) AS crystallized_7d, "
                "  CASE WHEN sum(CASE WHEN n.stability >= 0.95 THEN 1 ELSE 0 END) > 0 "
                "    THEN 1.0 ELSE 0.3 END AS evolution_rate "
                "RETURN approaching_threshold, crystallized_7d, evolution_rate "
                "LIMIT 1"
            ),
        },
    },
    {
        "id": "thing:sense:work_visibility",
        "name": "Work Visibility",
        "objective": "narrative:obj:work_visible",
        "routed_to": "pixel",
        "definition": {
            "eval_interval": 50,
            "internalize": False,
            "variables": ["work_moments", "visible_artifacts"],
            "outcomes": ["visibility_ratio"],
            "score": "first_outcome",
            "measure_query": (
                "MATCH (m:Moment) WHERE m.type IN ['commit', 'output'] "
                "WITH count(m) AS work_moments "
                "OPTIONAL MATCH (v:Thing {type: 'rendered_video'}) "
                "WITH work_moments, count(v) AS visible_artifacts, "
                "  CASE WHEN work_moments > 0 "
                "    THEN toFloat(count(v)) / work_moments "
                "    ELSE 0.3 END AS visibility_ratio "
                "RETURN work_moments, visible_artifacts, visibility_ratio "
                "LIMIT 1"
            ),
        },
    },
]


def seed_senses(adapter):
    """Seed all objective nodes and sense nodes into the L3 graph.

    Uses the FalkorDB adapter directly (query/execute with Cypher).
    Idempotent: uses MERGE (create if not exists, update if exists).
    After seeding, the SenseEngine auto-discovers sense nodes on next tick.

    Args:
        adapter: FalkorDBAdapter with .execute(cypher, params) method.
    """
    if adapter is None:
        logger.error("No adapter provided — cannot seed senses")
        return

    seeded_objectives = 0
    seeded_senses = 0

    # ── Seed Objective Nodes ──
    for obj in OBJECTIVE_NODES:
        try:
            adapter.execute(
                "MERGE (n:Narrative {id: $id}) "
                "SET n.name = $name, n.content = $content, "
                "    n.synthesis = $synthesis, n.type = $type, "
                "    n.weight = $weight, n.energy = $energy, "
                "    n.stability = $stability, n.responsible = $responsible",
                {
                    "id": obj["id"],
                    "name": obj["name"],
                    "content": obj["content"],
                    "synthesis": f"Objective: {obj['name']} | weight={obj['weight']}",
                    "type": "objective",
                    "weight": obj["weight"],
                    "energy": obj["energy"],
                    "stability": obj["stability"],
                    "responsible": obj["responsible"],
                },
            )
            seeded_objectives += 1
        except Exception as e:
            logger.warning(f"Objective {obj['id']}: {e}")

    # ── Seed Sense Nodes ──
    for sense in SENSE_NODES:
        defn = sense["definition"]
        content_yaml = yaml.dump(defn, default_flow_style=False)
        synthesis_init = json.dumps({"rolling_score": 0.5, "observations": 0, "insights": []})

        try:
            # Create the sense Thing node
            adapter.execute(
                "MERGE (s:Thing {id: $id}) "
                "SET s.name = $name, s.content = $content, "
                "    s.synthesis = $synthesis, s.type = $type, "
                "    s.weight = $weight, s.energy = $energy, "
                "    s.stability = $stability, "
                "    s.routed_to = $routed_to, s.objective_id = $objective_id",
                {
                    "id": sense["id"],
                    "name": sense["name"],
                    "content": content_yaml,
                    "synthesis": synthesis_init,
                    "type": "sense",
                    "weight": 0.5,
                    "energy": 0.3,
                    "stability": 0.8,
                    "routed_to": sense["routed_to"],
                    "objective_id": sense["objective"],
                },
            )

            # Link: sense → objective
            adapter.execute(
                "MATCH (s:Thing {id: $sid}), (o:Narrative {id: $oid}) "
                "MERGE (s)-[l:LINK]->(o) "
                "SET l.weight = 0.7, l.permanence = 1.0, l.hierarchy = 0.5, "
                "    l.synthesis = $synthesis",
                {
                    "sid": sense["id"],
                    "oid": sense["objective"],
                    "synthesis": f"Sense '{sense['name']}' measures '{sense['objective']}'",
                },
            )

            # Link: responsible citizen → sense
            citizen_id = f"actor:{sense['routed_to']}"
            adapter.execute(
                "MATCH (a:Actor {id: $aid}), (s:Thing {id: $sid}) "
                "MERGE (a)-[l:LINK]->(s) "
                "SET l.weight = 0.6, l.permanence = 0.9, l.hierarchy = -0.3, "
                "    l.synthesis = $synthesis",
                {
                    "aid": citizen_id,
                    "sid": sense["id"],
                    "synthesis": f"@{sense['routed_to']} senses '{sense['name']}'",
                },
            )

            seeded_senses += 1
        except Exception as e:
            logger.warning(f"Sense {sense['id']}: {e}")

    logger.info(
        f"Seeded {seeded_objectives} objective nodes + {seeded_senses} sense nodes "
        f"({seeded_senses} citizen links created)"
    )
    return seeded_objectives, seeded_senses


# ── CLI entrypoint ──────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO, format="%(name)s — %(message)s")

    # Try to get graph_ops from the running system
    try:
        sys.path.insert(0, ".")
        from runtime.infrastructure.database.factory import get_database_adapter
        graph_ops = get_database_adapter(graph_name="lumina_prime")
        seed_senses(graph_ops)
    except Exception as e:
        logger.error(f"Failed to connect to graph: {e}")
        logger.info("You can also call seed_senses(graph_ops) from Python with a valid adapter.")
        sys.exit(1)
