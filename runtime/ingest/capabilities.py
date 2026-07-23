"""
Capability ingestion — L2 organization graph.

Creates nodes for the capability system:
- capabilities (root)
- capability:{name} for each capability
- doc:{type}:{capability} for doc chain files
- task:{name} for tasks
- skill:{name} for skills
- procedure:{name} for procedures

All nodes go to L2 (organization graph), not the universe graph.
Names use camelCase, no abbreviations.

DOCS: docs/capabilities/PATTERNS_Capabilities.md
"""

import logging
import os
from pathlib import Path
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

def _to_camel(name: str) -> str:
    """Convert snake_case or kebab-case to camelCase."""
    parts = name.replace("-", "_").split("_")
    return parts[0].lower() + "".join(p.capitalize() for p in parts[1:])


DOC_CHAIN_ORDER = [
    "OBJECTIVES", "PATTERNS", "VOCABULARY", "BEHAVIORS",
    "ALGORITHM", "VALIDATION", "IMPLEMENTATION", "HEALTH", "SYNC",
]


def ingest_capabilities(
    target_dir: Path,
    graph_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Ingest capabilities into the L2 (organization) graph."""
    from ..infrastructure.database import get_database_adapter
    from ..inject import inject

    capabilities_dir = target_dir / ".mind" / "capabilities"
    if not capabilities_dir.exists():
        return {"capabilities": 0, "nodes_changed": 0, "nodes_unchanged": 0, "links_created": 0}

    if not graph_name:
        graph_name = os.environ.get("L2_GRAPH", "mind_protocol")

    adapter = get_database_adapter(graph_name=graph_name)

    stats = {
        "capabilities": 0,
        "nodes_changed": 0,
        "nodes_unchanged": 0,
        "links_created": 0,
    }

    # Root node
    result = inject(adapter, {
        "id": "capabilities",
        "label": "Space",
        "name": "Capabilities",
        "type": "system",
        "content": "Root space for capabilities, tasks, skills, and procedures",
        "weight": 10.0,
        "energy": 0.0,
    }, with_context=False)
    stats["nodes_changed" if result in ("created", "updated") else "nodes_unchanged"] += 1

    capabilities = [d for d in capabilities_dir.iterdir() if d.is_dir()]
    stats["capabilities"] = len(capabilities)

    for cap_dir in sorted(capabilities):
        cap_stats = _ingest_capability(adapter, cap_dir, cap_dir.name)
        stats["nodes_changed"] += cap_stats["changed"]
        stats["nodes_unchanged"] += cap_stats["unchanged"]
        stats["links_created"] += cap_stats["links"]

    return stats


def _ingest_capability(adapter, cap_dir: Path, cap_name: str) -> Dict[str, int]:
    """Ingest a single capability folder into L2."""
    from ..inject import inject

    stats = {"changed": 0, "unchanged": 0, "links": 0}
    cap_id = f"capability:{_to_camel(cap_name)}"

    # Capability space
    result = inject(adapter, {
        "id": cap_id,
        "label": "Space",
        "name": cap_name,
        "type": "capability",
        "content": f"Capability: {cap_name} — health checks, tasks, skills",
        "weight": 8.0,
        "energy": 0.0,
    })
    stats["changed" if result in ("created", "updated") else "unchanged"] += 1

    inject(adapter, {"from": "capabilities", "to": cap_id, "nature": "contains"})
    stats["links"] += 1

    # Doc chain
    doc_ids = []
    for doc_type in DOC_CHAIN_ORDER:
        doc_file = cap_dir / f"{doc_type}.md"
        if doc_file.exists():
            doc_id = f"doc:{doc_type.lower()}:{_to_camel(cap_name)}"
            synthesis = _generate_synthesis(doc_file, doc_type, cap_name)

            result = inject(adapter, {
                "id": doc_id,
                "label": "Narrative",
                "name": f"{doc_type} — {cap_name}",
                "type": doc_type.lower(),
                "synthesis": synthesis,
                "path": str(doc_file),
                "weight": 5.0,
                "energy": 0.0,
            })
            stats["changed" if result in ("created", "updated") else "unchanged"] += 1
            doc_ids.append(doc_id)

            inject(adapter, {"from": cap_id, "to": doc_id, "nature": "defines"})
            stats["links"] += 1

    # Doc chain IMPLEMENTS links
    for i in range(len(doc_ids) - 1):
        inject(adapter, {"from": doc_ids[i + 1], "to": doc_ids[i], "nature": "implements"})
        stats["links"] += 1

    # Tasks
    tasks_dir = cap_dir / "tasks"
    if tasks_dir.exists():
        for task_file in tasks_dir.glob("TASK_*.md"):
            raw_name = task_file.stem
            # TASK_add_tests → add_tests
            clean_name = _to_camel(raw_name.replace("TASK_", ""))
            task_id = f"task:{clean_name}"
            synthesis = _generate_synthesis(task_file, "task", cap_name)

            result = inject(adapter, {
                "id": task_id,
                "label": "Narrative",
                "name": clean_name,
                "type": "task",
                "synthesis": synthesis,
                "path": str(task_file),
                "capability": cap_name,
                "weight": 6.0,
                "energy": 0.0,
            })
            stats["changed" if result in ("created", "updated") else "unchanged"] += 1

            inject(adapter, {"from": cap_id, "to": task_id, "nature": "provides"})
            stats["links"] += 1

    # Skills
    skills_dir = cap_dir / "skills"
    if skills_dir.exists():
        for skill_file in skills_dir.glob("SKILL_*.md"):
            raw_name = skill_file.stem
            # SKILL_write_tests → write_tests
            clean_name = _to_camel(raw_name.replace("SKILL_", ""))
            skill_id = f"skill:{clean_name}"
            synthesis = _generate_synthesis(skill_file, "skill", cap_name)

            result = inject(adapter, {
                "id": skill_id,
                "label": "Narrative",
                "name": clean_name,
                "type": "skill",
                "synthesis": synthesis,
                "path": str(skill_file),
                "capability": cap_name,
                "weight": 6.0,
                "energy": 0.0,
            })
            stats["changed" if result in ("created", "updated") else "unchanged"] += 1

            inject(adapter, {"from": cap_id, "to": skill_id, "nature": "provides"})
            stats["links"] += 1

            # Skill → procedure link
            proc_ref = _extract_procedure_reference(skill_file)
            if proc_ref:
                proc_id = f"procedure:{_to_camel(proc_ref.replace('PROCEDURE_', ''))}"
                inject(adapter, {"from": skill_id, "to": proc_id, "nature": "executes"})
                stats["links"] += 1

            # Task → skill links
            for task_ref in _extract_task_references(skill_file):
                task_id = f"task:{_to_camel(task_ref.replace('TASK_', ''))}"
                inject(adapter, {"from": task_id, "to": skill_id, "nature": "uses"})
                stats["links"] += 1

    # Procedures
    procedures_dir = cap_dir / "procedures"
    if procedures_dir.exists():
        for proc_file in procedures_dir.glob("PROCEDURE_*.yaml"):
            raw_name = proc_file.stem
            # PROCEDURE_fix_drift → fix_drift
            clean_name = _to_camel(raw_name.replace("PROCEDURE_", ""))
            proc_id = f"procedure:{clean_name}"
            proc_info = _parse_procedure_yaml(proc_file)

            purpose = proc_info.get("purpose", "").strip()
            content = purpose if purpose else f"Procedure: {clean_name}"

            result = inject(adapter, {
                "id": proc_id,
                "label": "Space",
                "name": clean_name,
                "type": "procedure",
                "content": content,
                "path": str(proc_file),
                "capability": cap_name,
                "status": proc_info.get("status", "active"),
                "weight": 7.0,
                "energy": 0.0,
            })
            stats["changed" if result in ("created", "updated") else "unchanged"] += 1

            inject(adapter, {"from": cap_id, "to": proc_id, "nature": "provides"})
            stats["links"] += 1

    return stats


def _generate_synthesis(md_file: Path, doc_type: str, cap_name: str) -> str:
    """Generate synthesis text from markdown file content."""
    try:
        content = md_file.read_text()[:2000]
        lines = content.split("\n")

        in_code_block = False
        paragraph_lines = []

        for line in lines:
            if line.startswith("```"):
                in_code_block = not in_code_block
                continue
            if in_code_block or line.startswith("#") or line.startswith("---"):
                continue

            stripped = line.strip()
            if not stripped:
                if paragraph_lines:
                    break
                continue
            paragraph_lines.append(stripped)

        if paragraph_lines:
            desc = " ".join(paragraph_lines)
            if len(desc) > 200:
                desc = desc[:197] + "..."
            return f"{doc_type} {cap_name} — {desc}"
    except Exception as e:
        logger.debug(f"Could not generate synthesis for {md_file}: {e}")
    return f"{doc_type} {cap_name}"


def _parse_procedure_yaml(yaml_file: Path) -> Dict[str, Any]:
    try:
        import yaml
        with open(yaml_file) as f:
            return yaml.safe_load(f) or {}
    except Exception:
        return {}


def _extract_procedure_reference(skill_file: Path) -> str:
    try:
        import re
        content = skill_file.read_text()
        match = re.search(r"procedure:\s*(PROCEDURE_\w+)", content)
        if match:
            return match.group(1)
    except Exception as e:
        logger.debug(f"Could not extract procedure ref from {skill_file}: {e}")
    return ""


def _extract_task_references(skill_file: Path) -> List[str]:
    try:
        import re
        content = skill_file.read_text()
        match = re.search(r"used_by:.*?tasks:(.*?)(?:\n\w|\n##|\Z)", content, re.DOTALL)
        if match:
            return re.findall(r"-\s*(TASK_\w+)", match.group(1))
    except Exception as e:
        logger.debug(f"Could not extract task refs from {skill_file}: {e}")
    return []
