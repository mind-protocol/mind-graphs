#!/usr/bin/env python3
"""Sense hook — aggregate the citizen's situated awareness across all L2/L3
graphs and print it as markdown for injection before each response.

Real graph schema (uniform across graphs, confirmed empirically):
  - every node is a MindNode/L1Node discriminated by the `nodeType` property
    (values: space, actor, thing, narrative, moment, ...), case-insensitive.
  - containment / presence is the relationship (x)-[:CONVERGES_IN]->(space).

The citizen can be present in several spaces at once, possibly across several
graphs — so we scan every graph whose name starts with l2/l3 and union the
result, grouped by space.

Never raises: a hiccup must never block the prompt. Prints nothing on failure.
"""
from __future__ import annotations

import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# Which graphs to scan: names starting with these prefixes (case-insensitive).
GRAPH_PREFIXES = ("l2", "l3")
# Citizen handle: an actor node matches if its id or name contains this token.
HANDLE = os.environ.get("MIND_CITIZEN", "nlr").lower()
HOST = os.environ.get("FALKORDB_HOST", "localhost")
PORT = int(os.environ.get("FALKORDB_PORT", "6379"))

# Co-located node kinds we surface, in display order.
KINDS = ("actor", "narrative", "thing", "moment")
KIND_LABEL = {
    "actor": "Nearby",
    "narrative": "Narratives",
    "thing": "Things",
    "moment": "Recent",
}
MAX_PER_KIND = 6


def _rows(graph, cypher, params=None):
    try:
        return graph.query(cypher, params or {}).result_set or []
    except Exception:
        return []


def _spaces_for_citizen(graph):
    """Spaces the citizen actor converges into, in this graph."""
    return _rows(
        graph,
        "MATCH (a) WHERE toLower(a.nodeType)='actor' "
        "AND (toLower(a.id) CONTAINS $h OR toLower(a.name) CONTAINS $h) "
        "MATCH (a)-[:CONVERGES_IN]->(s) WHERE toLower(s.nodeType)='space' "
        "RETURN DISTINCT s.id AS sid, s.name AS sname",
        {"h": HANDLE},
    )


def _colocated(graph, space_id):
    """Nodes that converge into the given space, grouped by kind."""
    rows = _rows(
        graph,
        "MATCH (x)-[:CONVERGES_IN]->(s) WHERE s.id=$sid "
        "AND toLower(x.nodeType) IN ['actor','narrative','thing','moment'] "
        "RETURN toLower(x.nodeType) AS kind, x.name AS name, x.id AS id",
        {"sid": space_id},
    )
    by_kind: dict[str, list[str]] = {k: [] for k in KINDS}
    for kind, name, nid in rows:
        # Skip the citizen actor itself.
        label = (name or nid or "").strip()
        if not label:
            continue
        if kind == "actor" and HANDLE in (label.lower() + " " + (nid or "").lower()):
            continue
        bucket = by_kind.get(kind)
        if bucket is not None and label not in bucket:
            bucket.append(label)
    return by_kind


def _connect():
    from falkordb import FalkorDB
    return FalkorDB(host=HOST, port=PORT)


def main() -> int:
    try:
        db = _connect()
        graph_names = [g for g in db.list_graphs()
                       if g.lower().startswith(GRAPH_PREFIXES)]
    except Exception:
        return 0

    # space_id -> {"name", "graph", "by_kind"}; dedup a space across graphs by id.
    places: dict[str, dict] = {}
    for gname in sorted(graph_names):
        try:
            graph = db.select_graph(gname)
        except Exception:
            continue
        for sid, sname in _spaces_for_citizen(graph):
            if not sid:
                continue
            entry = places.setdefault(
                sid, {"name": sname or sid, "graph": gname, "by_kind": {k: [] for k in KINDS}}
            )
            merged = _colocated(graph, sid)
            for k in KINDS:
                for label in merged[k]:
                    if label not in entry["by_kind"][k]:
                        entry["by_kind"][k].append(label)

    if not places:
        return 0

    lines = ["## What I See Right Now"]
    n = len(places)
    lines.append(f"I'm present in {n} space{'s' if n != 1 else ''} right now:")
    for entry in places.values():
        lines.append("")
        lines.append(f"### {entry['name']}  _({entry['graph']})_")
        for k in KINDS:
            vals = entry["by_kind"][k][:MAX_PER_KIND]
            if vals:
                lines.append(f"- {KIND_LABEL[k]}: {', '.join(vals)}")

    print("<mind-sense>")
    print("\n".join(lines))
    print("</mind-sense>")
    return 0


if __name__ == "__main__":
    sys.exit(main())
