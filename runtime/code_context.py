"""Read-only FalkorDB context enrichment for code files.

The enrichment is deliberately path-first: a code file only receives graph
context when a Thing node explicitly points at the same path.  This avoids a
semantic search silently attaching plausible but unrelated design context.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Iterable, Optional


PATH_PROPERTIES = ("path", "sourcePath", "source_path", "filePath", "file_path")
DEFAULT_DEPTH = 1
MAX_DEPTH = 3
DEFAULT_LIMIT = 50
MAX_LIMIT = 100


def env_enabled(value: Optional[str] = None) -> bool:
    """Return whether code-context enrichment is enabled globally."""
    raw = os.environ.get("MIND_CODE_CONTEXT_ENABLED", "false") if value is None else value
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def path_candidates(file_path: str, project_root: Optional[Path] = None) -> list[str]:
    """Build exact, case-insensitive path variants for graph matching."""
    supplied = Path(file_path).expanduser()
    root = Path(project_root or Path.cwd()).resolve()
    absolute = supplied.resolve() if supplied.is_absolute() else (root / supplied).resolve()

    values = {str(supplied), str(absolute)}
    try:
        values.add(str(absolute.relative_to(root)))
    except ValueError:
        pass

    normalized: set[str] = set()
    for value in values:
        normalized.add(value.replace("\\", "/").lower())
        normalized.add(value.replace("/", "\\").lower())
    return sorted(item for item in normalized if item)


def configured_graph_names(explicit: Optional[Iterable[str]] = None) -> list[str]:
    """Return an explicit graph allow-list, or the configured graph hints."""
    if explicit:
        return list(dict.fromkeys(name.strip() for name in explicit if name and name.strip()))

    configured = os.environ.get("MIND_CODE_CONTEXT_GRAPHS", "")
    if configured.strip():
        return list(dict.fromkeys(name.strip() for name in configured.split(",") if name.strip()))
    return []


def _plain(value: Any) -> Any:
    """Convert FalkorDB values into JSON-safe Python values."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): _plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    if hasattr(value, "properties"):
        return {
            "labels": list(getattr(value, "labels", []) or []),
            "properties": _plain(getattr(value, "properties", {}) or {}),
        }
    return str(value)


def _result_rows(result: Any) -> list[list[Any]]:
    rows = getattr(result, "result_set", result)
    return list(rows or [])


def _discover_graph_names(client: Any) -> list[str]:
    names = client.list_graphs()
    return sorted(str(name) for name in names)


def create_falkor_client() -> Any:
    """Create a FalkorDB client from the shared MCP environment."""
    from falkordb import FalkorDB

    return FalkorDB(
        host=os.environ.get("FALKORDB_HOST", "localhost"),
        port=int(os.environ.get("FALKORDB_PORT", "6379")),
    )


def enrich_code_path(
    file_path: str,
    *,
    project_root: Optional[Path] = None,
    graph_names: Optional[Iterable[str]] = None,
    depth: int = DEFAULT_DEPTH,
    limit: int = DEFAULT_LIMIT,
    client: Any = None,
) -> dict[str, Any]:
    """Find matching Thing nodes in every selected graph and traverse locally.

    Database failures are reported per graph and never raise: graph augmentation
    is optional context, so an unavailable database must not block a code edit.
    """
    depth = max(0, min(int(depth), MAX_DEPTH))
    limit = max(1, min(int(limit), MAX_LIMIT))
    root = Path(project_root or Path.cwd()).resolve()
    candidates = path_candidates(file_path, root)

    if client is None:
        client = create_falkor_client()

    selected_graphs = configured_graph_names(graph_names)
    discovery_error = None
    if not selected_graphs:
        try:
            selected_graphs = _discover_graph_names(client)
        except Exception as exc:  # optional, fail-open enrichment
            discovery_error = str(exc)

    path_checks = " OR ".join(
        f"toLower(coalesce(root.{prop}, '')) IN $paths" for prop in PATH_PROPERTIES
    )
    root_query = f"""
        MATCH (root)
        WHERE ('Thing' IN labels(root)
               OR toLower(coalesce(root.node_type, '')) = 'thing'
               OR toLower(coalesce(root.nodeType, '')) = 'thing')
          AND ({path_checks})
        RETURN id(root), labels(root), properties(root)
        LIMIT $limit
    """

    graph_results = []
    total_matches = 0
    for graph_name in selected_graphs:
        try:
            graph = client.select_graph(graph_name)
            root_rows = _result_rows(graph.query(root_query, {"paths": candidates, "limit": limit}))
            matches = []
            for row in root_rows:
                root_id, labels, properties = row[0], row[1], row[2]
                item = {
                    "root": {"internal_id": root_id, "labels": _plain(labels), "properties": _plain(properties)},
                    "neighbors": [],
                    "paths": [],
                }
                if depth:
                    traversal_query = f"""
                        MATCH (root) WHERE id(root) = $root_id
                        MATCH path=(root)-[*1..{depth}]-(neighbor)
                        RETURN id(neighbor), labels(neighbor), properties(neighbor),
                               [rel IN relationships(path) | type(rel)],
                               [rel IN relationships(path) | properties(rel)],
                               [node IN nodes(path) | id(node)]
                        LIMIT $limit
                    """
                    traversal_rows = _result_rows(
                        graph.query(traversal_query, {"root_id": root_id, "limit": limit})
                    )
                    neighbors: dict[Any, dict[str, Any]] = {}
                    for traversal in traversal_rows:
                        neighbor_id = traversal[0]
                        neighbors[neighbor_id] = {
                            "internal_id": neighbor_id,
                            "labels": _plain(traversal[1]),
                            "properties": _plain(traversal[2]),
                        }
                        item["paths"].append({
                            "relationship_types": _plain(traversal[3]),
                            "relationships": _plain(traversal[4]),
                            "node_ids": _plain(traversal[5]),
                        })
                    item["neighbors"] = list(neighbors.values())
                matches.append(item)

            total_matches += len(matches)
            graph_results.append({"graph": graph_name, "matches": matches})
        except Exception as exc:  # optional, fail-open enrichment
            graph_results.append({"graph": graph_name, "matches": [], "error": str(exc)})

    result = {
        "enabled": True,
        "file": str(file_path),
        "project_root": str(root),
        "path_candidates": candidates,
        "depth": depth,
        "graphs_scanned": len(selected_graphs),
        "matches": total_matches,
        "graphs": graph_results,
    }
    if discovery_error:
        result["discovery_error"] = discovery_error
    return result


def _node_summary(internal_id: Any, labels: Any, properties: Any) -> dict[str, Any]:
    return {
        "internal_id": internal_id,
        "labels": _plain(labels),
        "properties": _plain(properties),
    }


def _classify_node(node: dict[str, Any]) -> set[str]:
    props = node.get("properties", {})
    tokens = " ".join(str(props.get(key, "")) for key in (
        "nodeType", "node_type", "semanticType", "semantic_type", "type", "name", "family"
    )).lower()
    categories = set()
    if re.search(r"\b(decision|option|arbitrage)\b", tokens):
        categories.add("decisions")
    if re.search(r"\b(risk|risque|hazard|threat|danger)\b", tokens):
        categories.add("risks")
    if re.search(r"\b(test|validation|verification|probe|sonde|health|experiment)\b", tokens):
        categories.add("tests")
    return categories


def _paths_from_node(node: dict[str, Any]) -> set[str]:
    props = node.get("properties", {})
    paths = {str(props.get(key)) for key in PATH_PROPERTIES if props.get(key)}
    changed = props.get("changedPaths") or props.get("changed_paths") or []
    if isinstance(changed, list):
        paths.update(str(item) for item in changed if item)
    return paths


def _inspect_anchor(graph: Any, root: dict[str, Any], *, limit: int) -> dict[str, Any]:
    """Return deterministic immediate dependencies for one concrete graph node."""
    root_id = root["internal_id"]
    queries = {
        "outgoing": """
            MATCH (root) WHERE id(root) = $root_id
            MATCH (root)-[rel]->(neighbor)
            RETURN id(neighbor), labels(neighbor), properties(neighbor), type(rel), properties(rel)
            LIMIT $limit
        """,
        "incoming": """
            MATCH (root) WHERE id(root) = $root_id
            MATCH (neighbor)-[rel]->(root)
            RETURN id(neighbor), labels(neighbor), properties(neighbor), type(rel), properties(rel)
            LIMIT $limit
        """,
    }
    dependencies: dict[str, list[dict[str, Any]]] = {"incoming": [], "outgoing": []}
    categorized: dict[str, dict[str, dict[str, Any]]] = {
        "decisions": {}, "risks": {}, "tests": {}
    }
    affected_files = _paths_from_node(root)

    for direction, cypher in queries.items():
        for row in _result_rows(graph.query(cypher, {"root_id": root_id, "limit": limit})):
            neighbor = _node_summary(row[0], row[1], row[2])
            edge = {
                "direction": direction,
                "type": row[3],
                "properties": _plain(row[4]),
                "node": neighbor,
            }
            dependencies[direction].append(edge)
            affected_files.update(_paths_from_node(neighbor))
            stable_key = str(neighbor.get("properties", {}).get("id") or neighbor["internal_id"])
            for category in _classify_node(neighbor):
                categorized[category][stable_key] = neighbor

    return {
        "root": root,
        "dependencies": dependencies,
        "decisions": list(categorized["decisions"].values()),
        "risks": list(categorized["risks"].values()),
        "graph_tests": list(categorized["tests"].values()),
        "affected_files": sorted(affected_files),
    }


def impact(
    *,
    file_path: Optional[str] = None,
    node_id: Optional[str] = None,
    project_root: Optional[Path] = None,
    graph_names: Optional[Iterable[str]] = None,
    limit: int = DEFAULT_LIMIT,
    client: Any = None,
) -> dict[str, Any]:
    """Compute deterministic one-hop impact from a file path or node ID."""
    if not file_path and not node_id:
        raise ValueError("impact requires file_path or node_id")
    limit = max(1, min(int(limit), MAX_LIMIT))
    root_path = Path(project_root or Path.cwd()).resolve()
    client = client or create_falkor_client()
    selected_graphs = configured_graph_names(graph_names)
    if not selected_graphs:
        selected_graphs = _discover_graph_names(client)

    candidates = path_candidates(file_path, root_path) if file_path else []
    path_checks = " OR ".join(
        f"toLower(coalesce(root.{prop}, '')) IN $paths" for prop in PATH_PROPERTIES
    )
    if file_path:
        anchor_query = f"""
            MATCH (root)
            WHERE ('Thing' IN labels(root)
                   OR toLower(coalesce(root.node_type, '')) = 'thing'
                   OR toLower(coalesce(root.nodeType, '')) = 'thing')
              AND ({path_checks})
            RETURN id(root), labels(root), properties(root)
            LIMIT $limit
        """
        params = {"paths": candidates, "limit": limit}
    else:
        anchor_query = """
            MATCH (root {id: $node_id})
            RETURN id(root), labels(root), properties(root)
            LIMIT $limit
        """
        params = {"node_id": node_id, "limit": limit}

    graphs = []
    total_anchors = 0
    for graph_name in selected_graphs:
        try:
            graph = client.select_graph(graph_name)
            anchors = []
            for row in _result_rows(graph.query(anchor_query, params)):
                anchors.append(_inspect_anchor(graph, _node_summary(row[0], row[1], row[2]), limit=limit))
            total_anchors += len(anchors)
            graphs.append({"graph": graph_name, "anchors": anchors})
        except Exception as exc:
            graphs.append({"graph": graph_name, "anchors": [], "error": str(exc)})

    return {
        "input": {"file_path": file_path, "node_id": node_id},
        "path_candidates": candidates,
        "graphs_scanned": len(selected_graphs),
        "anchors": total_anchors,
        "graphs": graphs,
    }


def related_tests(file_path: str, project_root: Optional[Path] = None, *, limit: int = 50) -> list[str]:
    """Find related tests through deterministic filename and source-reference rules."""
    root = Path(project_root or Path.cwd()).resolve()
    target = Path(file_path)
    absolute = target if target.is_absolute() else root / target
    try:
        relative = absolute.resolve().relative_to(root).as_posix()
    except ValueError:
        return []
    stem = absolute.stem
    module_ref = relative.rsplit(".", 1)[0].replace("/", ".")
    name_patterns = {
        f"test_{stem}.py", f"{stem}_test.py", f"{stem}.test.js", f"{stem}.test.ts",
        f"{stem}.spec.js", f"{stem}.spec.ts", f"{stem}.test.jsx", f"{stem}.test.tsx",
    }
    test_roots = [candidate for candidate in (root / "tests", root / "test", root / "__tests__") if candidate.exists()]
    matches: set[str] = set()
    reference_needles = {relative.lower(), absolute.name.lower(), module_ref.lower()}

    for test_root in test_roots:
        for candidate in test_root.rglob("*"):
            if not candidate.is_file() or candidate.suffix.lower() not in {".py", ".js", ".jsx", ".ts", ".tsx"}:
                continue
            if candidate.name in name_patterns:
                matches.add(candidate.relative_to(root).as_posix())
            elif len(matches) < limit:
                try:
                    content = candidate.read_text(encoding="utf-8", errors="ignore").lower()
                except OSError:
                    continue
                if any(needle and needle in content for needle in reference_needles):
                    matches.add(candidate.relative_to(root).as_posix())
            if len(matches) >= limit:
                break
    return sorted(matches)[:limit]


def change_context(
    *,
    file_paths: Optional[Iterable[str]] = None,
    node_ids: Optional[Iterable[str]] = None,
    project_root: Optional[Path] = None,
    graph_names: Optional[Iterable[str]] = None,
    limit: int = DEFAULT_LIMIT,
    client: Any = None,
) -> dict[str, Any]:
    """Batch pre-edit context: exact anchors, impact, risks, decisions and tests."""
    paths = list(dict.fromkeys(str(item) for item in (file_paths or []) if item))
    ids = list(dict.fromkeys(str(item) for item in (node_ids or []) if item))
    if not paths and not ids:
        raise ValueError("change_context requires file_paths or node_ids")
    root = Path(project_root or Path.cwd()).resolve()
    client = client or create_falkor_client()
    items = []
    for file_path in paths:
        graph_impact = impact(
            file_path=file_path,
            project_root=root,
            graph_names=graph_names,
            limit=limit,
            client=client,
        )
        filesystem_tests = related_tests(file_path, root, limit=limit)
        items.append({"file_path": file_path, "impact": graph_impact, "related_tests": filesystem_tests})
    for node_id in ids:
        items.append({
            "node_id": node_id,
            "impact": impact(node_id=node_id, graph_names=graph_names, limit=limit, client=client),
            "related_tests": [],
        })
    return {"project_root": str(root), "items": items}
