"""Deterministic comparison of FalkorDB runtime state and canonical JSON datasets."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Iterable, Optional

from runtime.code_context import _plain, _result_rows, create_falkor_client


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _canonical_graph(manifest_path: Path, graph_spec: dict[str, Any]) -> tuple[dict[str, dict], dict[tuple, dict]]:
    root = manifest_path.parent
    data_dir = root / graph_spec["dataDir"]
    nodes: dict[str, dict] = {}
    links: dict[tuple[str, str, str], dict] = {}
    for dataset in graph_spec.get("datasets", []):
        payload = _load_json(data_dir / dataset["file"])
        dataset_nodes = [payload["node"]] if isinstance(payload.get("node"), dict) else payload.get("nodes", [])
        for node in dataset_nodes:
            if node.get("id"):
                nodes[str(node["id"])] = node
        for link in payload.get("links", []):
            if all(link.get(key) for key in ("source", "type", "target")):
                links[(str(link["source"]), str(link["type"]), str(link["target"]))] = link
    return nodes, links


def _runtime_graph(graph: Any) -> tuple[dict[str, dict], dict[tuple, dict]]:
    nodes = {}
    node_query = "MATCH (node) WHERE node.id IS NOT NULL RETURN node.id, labels(node), properties(node)"
    for node_id, labels, properties in _result_rows(graph.query(node_query)):
        nodes[str(node_id)] = {"labels": _plain(labels), "properties": _plain(properties)}

    links = {}
    link_query = """
        MATCH (source)-[rel]->(target)
        WHERE source.id IS NOT NULL AND target.id IS NOT NULL
        RETURN source.id, type(rel), target.id, properties(rel)
    """
    for source, relation_type, target, properties in _result_rows(graph.query(link_query)):
        links[(str(source), str(relation_type), str(target))] = _plain(properties)
    return nodes, links


def _normalized(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _normalized(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        return [_normalized(item) for item in value]
    return value


def _canonical_node_runtime_projection(node: dict[str, Any], runtime: dict[str, Any]) -> dict[str, Any]:
    """Project the corpus node contract onto the properties stored by FalkorDB.

    The canonical corpus calls the semantic class ``nodeType`` and may declare
    a display/traversal ``role``. The seeded runtime stores that role as
    ``nodeType`` and preserves the corpus class as ``semanticType``.
    """
    projected = dict(node)
    role = projected.pop("role", None)
    semantic_type = projected.get("nodeType")
    if role:
        projected["nodeType"] = role
        if semantic_type:
            projected["semanticType"] = semantic_type
    elif semantic_type and runtime.get("semanticType") == semantic_type:
        # Some legacy/root records do not persist a role. The runtime projection
        # still preserves their semantic type and chooses a traversal role. Since
        # that role has no canonical value, only compare the preserved facet.
        projected.pop("nodeType", None)
        projected["semanticType"] = semantic_type
    return projected


def _property_changes(
    canonical: dict,
    runtime: dict,
    *,
    excluded: Iterable[str] = (),
    include_unmaterialized: bool = False,
) -> dict[str, dict[str, Any]]:
    excluded_keys = set(excluded)
    changes = {}
    for key, canonical_value in canonical.items():
        if key in excluded_keys:
            continue
        if key not in runtime and not include_unmaterialized:
            continue
        runtime_value = runtime.get(key)
        if _normalized(canonical_value) != _normalized(runtime_value):
            changes[key] = {"canonical": canonical_value, "runtime": runtime_value}
    return changes


def graph_diff(
    manifest_path: Optional[str | Path] = None,
    *,
    graph_ids: Optional[Iterable[str]] = None,
    include_property_changes: bool = True,
    include_unmaterialized_properties: bool = False,
    limit: int = 100,
    client: Any = None,
) -> dict[str, Any]:
    """Compare declared canonical datasets with their live FalkorDB graphs."""
    configured = manifest_path or os.environ.get("MIND_GRAPH_MANIFEST")
    if not configured:
        raise ValueError("graph_diff requires manifest_path or MIND_GRAPH_MANIFEST")
    manifest = Path(configured).expanduser().resolve()
    document = _load_json(manifest)
    selected = set(graph_ids or [])
    limit = max(1, min(int(limit), 1000))
    client = client or create_falkor_client()
    graphs = []

    for spec in document.get("graphs", []):
        if spec.get("status") != "active" or (selected and spec.get("id") not in selected):
            continue
        graph_id = str(spec["id"])
        graph_name = str(spec["falkorGraph"])
        try:
            canonical_nodes, canonical_links = _canonical_graph(manifest, spec)
            runtime_nodes, runtime_links = _runtime_graph(client.select_graph(graph_name))
            canonical_node_ids = set(canonical_nodes)
            runtime_node_ids = set(runtime_nodes)
            canonical_link_ids = set(canonical_links)
            runtime_link_ids = set(runtime_links)

            changed_nodes = []
            changed_links = []
            if include_property_changes:
                for node_id in sorted(canonical_node_ids & runtime_node_ids):
                    changes = _property_changes(
                        _canonical_node_runtime_projection(
                            canonical_nodes[node_id], runtime_nodes[node_id]["properties"]
                        ),
                        runtime_nodes[node_id]["properties"],
                        include_unmaterialized=include_unmaterialized_properties,
                    )
                    if changes:
                        changed_nodes.append({"id": node_id, "properties": changes})
                for link_id in sorted(canonical_link_ids & runtime_link_ids):
                    changes = _property_changes(
                        canonical_links[link_id],
                        runtime_links[link_id],
                        excluded=("source", "type", "target"),
                        include_unmaterialized=include_unmaterialized_properties,
                    )
                    if changes:
                        changed_links.append({
                            "source": link_id[0], "type": link_id[1], "target": link_id[2], "properties": changes
                        })

            runtime_only_nodes = sorted(runtime_node_ids - canonical_node_ids)
            runtime_only_links = sorted(runtime_link_ids - canonical_link_ids)
            missing_nodes = sorted(canonical_node_ids - runtime_node_ids)
            missing_links = sorted(canonical_link_ids - runtime_link_ids)
            entry = {
                "graph_id": graph_id,
                "falkor_graph": graph_name,
                "canonical": {"nodes": len(canonical_nodes), "links": len(canonical_links)},
                "runtime": {"nodes": len(runtime_nodes), "links": len(runtime_links)},
                "runtime_only": {
                    "node_count": len(runtime_only_nodes),
                    "nodes": runtime_only_nodes[:limit],
                    "link_count": len(runtime_only_links),
                    "links": [dict(zip(("source", "type", "target"), item)) for item in runtime_only_links[:limit]],
                    "truncated": len(runtime_only_nodes) > limit or len(runtime_only_links) > limit,
                    "warning": "These runtime mutations are not canonical and may disappear at the next destructive seed.",
                },
                "missing_from_runtime": {
                    "node_count": len(missing_nodes),
                    "nodes": missing_nodes[:limit],
                    "link_count": len(missing_links),
                    "links": [
                        dict(zip(("source", "type", "target"), item))
                        for item in missing_links[:limit]
                    ],
                    "truncated": len(missing_nodes) > limit or len(missing_links) > limit,
                },
                "property_changes": {
                    "node_count": len(changed_nodes),
                    "nodes": changed_nodes[:limit],
                    "link_count": len(changed_links),
                    "links": changed_links[:limit],
                    "truncated": len(changed_nodes) > limit or len(changed_links) > limit,
                },
            }
            entry["clean"] = not any((
                runtime_only_nodes,
                runtime_only_links,
                entry["missing_from_runtime"]["nodes"],
                entry["missing_from_runtime"]["links"],
                changed_nodes,
                changed_links,
            ))
            graphs.append(entry)
        except Exception as exc:
            graphs.append({"graph_id": graph_id, "falkor_graph": graph_name, "clean": False, "error": str(exc)})

    return {
        "manifest": str(manifest),
        "limit": limit,
        "include_unmaterialized_properties": include_unmaterialized_properties,
        "graphs": graphs,
        "clean": bool(graphs) and all(graph.get("clean", False) for graph in graphs),
    }
