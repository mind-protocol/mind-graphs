"""
Init command for mind CLI.

Initializes the mind in a project directory by:
- Copying protocol files to .mind/
- Creating/updating .mind/CLAUDE.md with inlined content (standalone)
- Creating/updating root CLAUDE.md with @ references (Claude expands these)
- Creating/updating root AGENTS.md with protocol bootstrap (inlined content)
- Ingesting repo files and capabilities into the graph
"""
# DOCS: docs/cli/core/PATTERNS_Why_CLI_Over_Copy.md

import shutil
import os
import re
import stat
import json
import yaml
import logging
from pathlib import Path
from typing import List, Dict, Any

from .core_utils import get_templates_path
from .repo_overview import generate_and_save

logger = logging.getLogger(__name__)


def _get_mind_root() -> Path:
    """Get the root directory of the mind installation.

    Returns the directory containing tools/mcp/membrane_server.py.
    """
    # In development: mind/mind/init_cmd.py -> mind/
    mind_root = Path(__file__).parent.parent
    if (mind_root / "tools" / "mcp" / "membrane_server.py").exists():
        return mind_root

    # Fallback: try to find via templates path
    try:
        templates = get_templates_path()
        # templates is mind/templates/, so parent is mind/
        if (templates.parent / "tools" / "mcp" / "membrane_server.py").exists():
            return templates.parent
    except FileNotFoundError:
        pass

    raise FileNotFoundError("Could not find mind installation with membrane_server.py")


def _configure_mcp_membrane(target_dir: Path) -> None:
    """Configure membrane MCP server using claude mcp commands."""
    try:
        mind_root = _get_mind_root()
    except FileNotFoundError as e:
        print(f"  ○ MCP config skipped: {e}")
        return

    membrane_script = mind_root / "tools" / "mcp" / "membrane_server.py"

    import subprocess

    # Remove existing membrane server (ignore errors if not found)
    try:
        subprocess.run(
            ["claude", "mcp", "remove", "membrane"],
            capture_output=True,
            cwd=target_dir,
            timeout=10
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass  # claude CLI not available or timed out

    # Add membrane server with correct path
    try:
        result = subprocess.run(
            ["claude", "mcp", "add", "membrane", "--", "python3", str(membrane_script)],
            capture_output=True,
            text=True,
            cwd=target_dir,
            timeout=10
        )
        if result.returncode == 0:
            print(f"✓ Configured MCP: membrane -> {membrane_script}")
        else:
            # Fallback to .mcp.json if claude CLI fails
            print(f"  ○ claude mcp add failed, using .mcp.json fallback")
            _generate_mcp_config_file(target_dir, mind_root)
    except FileNotFoundError:
        # claude CLI not installed, use .mcp.json fallback
        print(f"  ○ claude CLI not found, using .mcp.json fallback")
        _generate_mcp_config_file(target_dir, mind_root)
    except subprocess.TimeoutExpired:
        print(f"  ○ claude mcp timed out, using .mcp.json fallback")
        _generate_mcp_config_file(target_dir, mind_root)


def _generate_mcp_config_file(target_dir: Path, mind_root: Path) -> None:
    """Fallback: generate .mcp.json file directly."""
    mcp_json = target_dir / ".mcp.json"

    config = {
        "mcpServers": {
            "membrane": {
                "command": "python3",
                "args": [str(mind_root / "tools" / "mcp" / "membrane_server.py")],
            }
        }
    }

    # Merge with existing config if present
    if mcp_json.exists():
        try:
            existing = json.loads(mcp_json.read_text())
            if "mcpServers" not in existing:
                existing["mcpServers"] = {}
            existing["mcpServers"]["membrane"] = config["mcpServers"]["membrane"]
            config = existing
        except json.JSONDecodeError:
            pass  # Overwrite invalid JSON

    mcp_json.write_text(json.dumps(config, indent=2) + "\n")
    print(f"✓ Created: {mcp_json}")


def _copy_skills(skills_src: Path, target_dir: Path) -> None:
    if not skills_src.exists():
        return
    target_dir.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copytree(skills_src, target_dir, dirs_exist_ok=True)
        print(f"✓ Updated: {target_dir}")
    except PermissionError:
        print(f"  ○ Skipped (permission): {target_dir}")


def _update_or_add_section(file_path: Path, section_content: str, section_marker: str = "# mind") -> None:
    """Update or add a section to a file.

    If file exists and has the section marker, replaces that section.
    If file exists but doesn't have the section, appends it.
    If file doesn't exist, creates it with the section.

    Args:
        file_path: Path to the file to update
        section_content: The content to add/replace
        section_marker: The heading that marks the start of our section (e.g., "# mind")
    """
    if file_path.exists():
        content = file_path.read_text()

        # Find and replace the section
        # Look for section marker and replace until next "# " heading or end
        pattern = rf'(^{re.escape(section_marker)}\n).*?(?=^# |\Z)'

        if re.search(pattern, content, re.MULTILINE | re.DOTALL):
            # Replace existing section
            new_content = re.sub(pattern, section_content + '\n', content, flags=re.MULTILINE | re.DOTALL)
            file_path.write_text(new_content)
            print(f"✓ Updated {section_marker} section in: {file_path}")
        else:
            # Append section
            new_content = content.rstrip() + '\n\n' + section_content
            file_path.write_text(new_content)
            print(f"✓ Added {section_marker} section to: {file_path}")
    else:
        # Create new file with section
        file_path.write_text(section_content)
        print(f"✓ Created: {file_path}")


def _update_root_claude_md(target_dir: Path, **kwargs) -> None:
    """Generate root CLAUDE.md by merging all prompts/*.md files.

    Reads prompts/00_SYSTEM.md (with {{placeholders}}), fills them,
    then appends 01-05 foundation docs. One file, everything inlined.
    """
    root_claude = target_dir / "CLAUDE.md"
    prompts_dir = Path(__file__).parent.parent / "prompts"

    # Build system section (00_SYSTEM.md with placeholders filled)
    system_src = prompts_dir / "00_SYSTEM.md"
    if system_src.exists():
        content = _fill_placeholders(system_src.read_text(encoding="utf-8"), target_dir)
    else:
        content = f"# {target_dir.name}\n"

    # Append all foundation docs in order
    for doc in sorted(prompts_dir.glob("[0-9][0-9]_*.md")):
        if doc.name == "00_SYSTEM.md":
            continue
        content += "\n\n---\n\n" + doc.read_text(encoding="utf-8")

    root_claude.write_text(content, encoding="utf-8")
    print(f"✓ Generated: {root_claude}")


def _fill_placeholders(template: str, target_dir: Path) -> str:
    """Fill {{PLACEHOLDER}} tokens in system prompt template."""
    import subprocess

    project_name = target_dir.name.replace("-", " ").replace("_", " ").title()

    # Git URL
    github_url = ""
    try:
        result = subprocess.run(
            ["git", "-C", str(target_dir), "remote", "get-url", "origin"],
            capture_output=True, text=True, timeout=2,
        )
        if result.returncode == 0:
            github_url = result.stdout.strip()
    except Exception:
        pass

    # Citizen count
    citizens_dir = target_dir / "citizens"
    citizen_count = str(len([d for d in citizens_dir.iterdir() if d.is_dir()])) if citizens_dir.is_dir() else "0"

    replacements = {
        "{{UNIVERSE_NAME}}": project_name,
        "{{UNIVERSE_DESCRIPTION}}": f"A Mind Protocol world",
        "{{CITIZEN_COUNT}}": citizen_count,
        "{{SPACE_COUNT}}": "—",
        "{{GRAPH_NAME}}": target_dir.name.replace("-", "_"),
    }

    for placeholder, value in replacements.items():
        template = template.replace(placeholder, value)

    return template


def _build_root_claude_section(target_dir: Path = None) -> str:
    """Build CLAUDE.md from the appropriate system prompt template.

    Reads the mode from database_config.yaml (system_prompt_mode):
      "project-team"  → PROJECT_TEAM_SYSTEM.md (default)
      "universe"      → UNIVERSE_CITIZEN.md
      "roleplay"      → ROLEPLAY.md

    Populates placeholders with project-specific data.
    """
    import subprocess

    # Determine mode
    mode = "project-team"
    if target_dir:
        config_file = target_dir / ".mind" / "database_config.yaml"
        if config_file.exists():
            try:
                import yaml
                config = yaml.safe_load(config_file.read_text())
                mode = config.get("system_prompt_mode", "project-team")
            except Exception as e:
                logger.debug(f"Skipped reading system_prompt_mode from config: {e}")  # lint:ignore silent_failure — graceful degradation

    # Load template
    templates_dir = Path(__file__).parent.parent / "templates" / "system_prompts"
    template_map = {
        "project-team": "PROJECT_TEAM_SYSTEM.md",
        "universe": "UNIVERSE_CITIZEN.md",
        "roleplay": "ROLEPLAY.md",
    }
    template_file = templates_dir / template_map.get(mode, "PROJECT_TEAM_SYSTEM.md")

    if template_file.exists():
        template = template_file.read_text(encoding="utf-8")
    else:
        # Fallback
        return "# mind\n\nRun `mind init` to generate the system prompt.\n"

    # Populate placeholders
    project_name = (target_dir.name if target_dir else "project").replace("-", " ").replace("_", " ").title()

    # Git URL
    github_url = ""
    if target_dir:
        try:
            result = subprocess.run(
                ["git", "-C", str(target_dir), "remote", "get-url", "origin"],
                capture_output=True, text=True, timeout=2,
            )
            if result.returncode == 0:
                github_url = result.stdout.strip()
        except Exception as e:
            logger.debug(f"Skipped git remote URL detection: {e}")  # lint:ignore silent_failure — graceful degradation

    # Project structure (top 2 levels)
    project_structure = ""
    if target_dir:
        try:
            result = subprocess.run(
                ["find", str(target_dir), "-maxdepth", "2", "-type", "d",
                 "-not", "-path", "*/.git/*", "-not", "-path", "*/node_modules/*",
                 "-not", "-path", "*/__pycache__/*"],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode == 0:
                lines = sorted(result.stdout.strip().split("\n"))
                rel_lines = [str(Path(l).relative_to(target_dir)) for l in lines if l]
                project_structure = "\n".join(rel_lines[:20])
        except Exception as e:
            logger.debug(f"Skipped project structure discovery: {e}")  # lint:ignore silent_failure — graceful degradation

    # Team roster (from citizens/ or .mind/actors/)
    team_roster = ""
    if target_dir:
        for citizens_dir in [target_dir / "citizens", target_dir / ".mind" / "actors"]:
            if citizens_dir.is_dir():
                members = []
                for member_dir in sorted(citizens_dir.iterdir()):
                    if member_dir.is_dir() and not member_dir.name.startswith("."):
                        claude_md = member_dir / "CLAUDE.md"
                        role = ""
                        if claude_md.exists():
                            for line in claude_md.read_text(encoding="utf-8").split("\n")[:20]:
                                if "Role:" in line:
                                    role = line.split("Role:")[-1].strip()
                                    break
                        members.append(f"- **@{member_dir.name}** — {role or 'team member'}")
                if members:
                    team_roster = "\n".join(members)
                    break

    if not team_roster:
        team_roster = "- (No team members found. Add citizens to `citizens/` or `.mind/actors/`.)"

    # Apply substitutions
    replacements = {
        "{{PROJECT_NAME}}": project_name,
        "{{GITHUB_URL}}": github_url or "(not configured)",
        "{{PROJECT_DESCRIPTION}}": f"A Mind Protocol project at {github_url or target_dir}",
        "{{PROJECT_STRUCTURE}}": project_structure or "(run `mind init` to populate)",
        "{{TEAM_ROSTER}}": team_roster,
        "{{CITIZEN_NAME}}": "AI Citizen",
        "{{CITIZEN_HANDLE}}": "citizen",
        "{{UNIVERSE_NAME}}": project_name,
        "{{UNIVERSE_DESCRIPTION}}": f"A living world powered by Mind Protocol",
        "{{CITIZEN_COUNT}}": "—",
        "{{SPACE_COUNT}}": "—",
        "{{GRAPH_NAME}}": (target_dir.name if target_dir else "default").replace("-", "_"),
    }

    content = template
    for placeholder, value in replacements.items():
        content = content.replace(placeholder, value)

    return content


def _build_system_prompt(templates_path: Path, model: str = "claude") -> str:
    """Build system prompt from SYSTEM.md + model-specific additions.

    Args:
        templates_path: Path to templates directory
        model: "claude", "gemini", or "codex"

    Returns:
        Combined system prompt content
    """
    # Base system prompt
    system_path = templates_path / "mcp" / "SYSTEM.md"
    system_content = system_path.read_text() if system_path.exists() else ""

    # Model-specific addition
    addition_map = {
        "claude": "CLAUDE_SYSTEM_ADDITION.md",
        "gemini": "GEMINI_SYSTEM_ADDITION.md",
        "codex": "CODEX_SYSTEM_ADDITION.md",
    }
    addition_file = addition_map.get(model, "")
    addition_path = templates_path / "mcp" / addition_file
    addition_content = addition_path.read_text() if addition_file and addition_path.exists() else ""

    # Combine
    if addition_content:
        combined = f"{system_content}\n\n---\n\n{addition_content}"
    else:
        combined = system_content

    return combined


def _build_claude_addition(templates_path: Path) -> str:
    """Build CLAUDE.md content from SYSTEM.md + Claude-specific additions."""
    return _build_system_prompt(templates_path, "claude")


def _build_gemini_addition(templates_path: Path) -> str:
    """Build GEMINI.md content from SYSTEM.md + Gemini-specific additions."""
    return _build_system_prompt(templates_path, "gemini")


def _build_agents_addition(templates_path: Path) -> str:
    """Build AGENTS.md content from SYSTEM.md + Codex-specific additions."""
    return _build_system_prompt(templates_path, "codex")


def _build_manager_agents_addition(templates_path: Path) -> str:
    """Build manager AGENTS.md content from manager CLAUDE.md plus Codex guidance."""
    manager_claude_path = templates_path / "agents" / "manager" / "CLAUDE.md"
    manager_content = manager_claude_path.read_text() if manager_claude_path.exists() else ""
    codex_addition_path = templates_path / "mcp" / "CODEX_SYSTEM_ADDITION.md"
    codex_addition = codex_addition_path.read_text() if codex_addition_path.exists() else ""
    if codex_addition:
        return f"{manager_content}\n\n{codex_addition}"
    return manager_content


def _remove_write_permissions(path: Path) -> None:
    """Strip write bits so files/directories become read-only."""
    if not path.exists():
        return
    try:
        current_mode = path.stat().st_mode
        readonly_mode = current_mode & ~(stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH)
        path.chmod(readonly_mode)
        print(f"  ✓ Read-only: {path}")
    except PermissionError:
        print(f"  ○ Skipped (permission): {path}")


def _enforce_readonly_for_views(views_root: Path) -> None:
    """Set view documents read-only unless they are learning artifacts."""
    if not views_root.exists():
        return
    for view_file in views_root.rglob("*.md"):
        if "LEARNING" in view_file.name.upper():
            continue
        _remove_write_permissions(view_file)


def _enforce_readonly_for_templates(templates_root: Path) -> None:
    """Set template tree to read-only so inlined source docs stay stable."""
    if not templates_root.exists():
        return
    for child in templates_root.rglob("*"):
        _remove_write_permissions(child)


def _enforce_readonly_for_runtime(mind_dir: Path) -> None:
    """Lock down the .mind/runtime/ directory after mind init.

    All files become read-only EXCEPT config files (database_config.yaml,
    config.yaml, nature.yaml, modules.yaml) which remain writable.

    This prevents accidental edits to the local copy of the runtime —
    the canonical source is mind-mcp/runtime/, not .mind/runtime/.
    """
    runtime_dir = mind_dir / "runtime"
    if not runtime_dir.exists():
        return

    # Config files that should stay writable
    WRITABLE = {
        "database_config.yaml",
        "config.yaml",
        "nature.yaml",
        "modules.yaml",
        ".env",
    }

    locked = 0
    skipped = 0
    for child in runtime_dir.rglob("*"):
        if child.is_dir():
            continue
        if child.name in WRITABLE:
            skipped += 1
            continue
        if child.name.endswith(".pyc"):
            continue
        try:
            current_mode = child.stat().st_mode
            readonly_mode = current_mode & ~(stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH)
            child.chmod(readonly_mode)
            locked += 1
        except PermissionError:
            pass

    # Also lock the top-level .mind/ protocol files (schema, framework, etc.)
    for proto_file in mind_dir.glob("*.yaml"):
        if proto_file.name in WRITABLE:
            continue
        try:
            current_mode = proto_file.stat().st_mode
            readonly_mode = current_mode & ~(stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH)
            proto_file.chmod(readonly_mode)
            locked += 1
        except PermissionError:
            pass

    for proto_file in mind_dir.glob("*.md"):
        try:
            current_mode = proto_file.stat().st_mode
            readonly_mode = current_mode & ~(stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH)
            proto_file.chmod(readonly_mode)
            locked += 1
        except PermissionError:
            pass

    print(f"✓ Locked {locked} runtime files read-only ({skipped} config files remain writable)")


# =============================================================================
# GRAPH INITIALIZATION
# =============================================================================

def _init_graph(target_dir: Path, clear: bool = False) -> bool:
    """
    Initialize graph named after repo and ingest content.

    Ingests docs/ and templates/ into the graph. Always on, no toggles.

    Args:
        target_dir: Project directory
        clear: If True, delete all nodes/links before ingestion

    Returns:
        True if successful, False if graph connection failed
    """

    repo_name = target_dir.name

    print()
    print(f"Initializing graph: {repo_name}")

    try:
        from runtime.physics.graph.graph_ops import GraphOps
    except ImportError as e:
        print(f"  ○ Graph init skipped (engine not available): {e}")
        return False

    try:
        graph_ops = GraphOps(graph_name=repo_name)
        print(f"  ✓ Connected to graph: {repo_name}")
    except Exception as e:
        print(f"  ○ Graph connection failed: {e}")
        print("    To enable graph features, start FalkorDB:")
        print("      docker run -p 6379:6379 falkordb/falkordb")
        return False

    # Clear graph if requested
    if clear:
        try:
            graph_ops._query("MATCH (n) DETACH DELETE n")
            print(f"  ✓ Cleared all nodes and links")
        except Exception as e:
            print(f"  ✗ Failed to clear graph: {e}")

    # Ingest docs/*.md files into graph
    try:
        from .ingest.docs import ingest_docs_to_graph
        print("  Ingesting docs/*.md files...")
        doc_stats = ingest_docs_to_graph(target_dir, graph_ops)
        docs_count = doc_stats.get('docs_ingested', doc_stats.get('files_ingested', 0))
        spaces_count = doc_stats.get('spaces_created', 0)
        print(f"  ✓ Docs ingested: {docs_count} docs, {spaces_count} spaces")
    except Exception as e:
        print(f"  ○ Doc ingestion failed: {e}")

    # Ingest templates/ into graph
    templates_dir = target_dir / "templates"
    if templates_dir.exists():
        try:
            from .ingest.docs import ingest_docs_to_graph
            print("  Ingesting templates/...")
            tmpl_stats = ingest_docs_to_graph(templates_dir, graph_ops)
            tmpl_count = tmpl_stats.get('docs_ingested', tmpl_stats.get('files_ingested', 0))
            print(f"  ✓ Templates ingested: {tmpl_count} files")
        except Exception as e:
            print(f"  ○ Template ingestion failed: {e}")

    return True


def _clean_legacy(target_dir: Path) -> None:
    """Remove deprecated files and folders from previous mind versions."""
    mind_dir = target_dir / ".mind"
    if not mind_dir.exists():
        return

    legacy_dirs = [
        "actors",           # old agent actor definitions
        "capabilities",     # old capability system
        "swarm",            # old swarm logs
        "views",            # old VIEW files
        "cache",            # embedding cache
        "mcp",              # old MCP system prompts
        "prompts",          # old Force Sprint prompts
        "procedures",       # old structured dialogues
        "runtime",          # local runtime copy (canonical is mind-mcp/runtime/)
        "scripts",          # old scripts
    ]

    legacy_files = [
        "CLAUDE.md",        # replaced by root CLAUDE.md
        "GEMINI.md",        # deprecated
        "STYLE.md",         # replaced by BEHAVIORS.md
        "FRAMEWORK.md",     # replaced by templates/FRAMEWORK.md
        "PRINCIPLES.md",    # merged into templates
        "schema.yaml",      # canonical is docs/schema/schema.yaml
        "doctor-ignore.yaml",
        "problems.yaml",
        "AGENTS.md",
    ]

    # Also clean from project root
    root_legacy = [
        "AGENTS.md",
        "modules.yaml",     # moved to .mind/
        ".mindignore",      # moved to .mind/
    ]

    cleaned = 0
    for d in legacy_dirs:
        path = mind_dir / d
        if path.exists():
            shutil.rmtree(path, ignore_errors=True)
            cleaned += 1

    for f in legacy_files:
        path = mind_dir / f
        if path.exists():
            path.unlink(missing_ok=True)
            cleaned += 1

    # Clean state files
    repair = mind_dir / "state" / "REPAIR_REPORT.md"
    if repair.exists():
        repair.unlink(missing_ok=True)
        cleaned += 1

    for f in root_legacy:
        path = target_dir / f
        if path.exists():
            path.unlink(missing_ok=True)
            cleaned += 1

    if cleaned > 0:
        print(f"✓ Cleaned {cleaned} legacy files/folders")


def init_protocol(target_dir: Path, force: bool = False, clear_graph: bool = False, **kwargs) -> bool:
    """
    Initialize mind in a project directory.

    Merges prompts/ (00_SYSTEM through 05_STYLE) into CLAUDE.md.
    Ingests docs/ into graph. No .mind/ directory.

    Args:
        target_dir: The project directory to initialize
        force: If True, overwrite existing CLAUDE.md
        clear_graph: If True, clear existing graph data before injection
    Returns:
        True if successful, False otherwise
    """
    try:
        templates_path = get_templates_path()
    except FileNotFoundError as e:
        print(f"Error: {e}")
        return False

    # Clean legacy .mind/ if it exists
    legacy_mind = target_dir / ".mind"
    if legacy_mind.exists() and legacy_mind.is_dir():
        shutil.rmtree(legacy_mind, ignore_errors=True)
        print(f"✓ Removed legacy .mind/")

    # Load config from mind.yaml (root level, not .mind/)
    config_path = target_dir / "mind.yaml"
    # Load config (mode, db connection). No behavior toggles — everything runs.
    if config_path.exists():
        try:
            import yaml
            with open(config_path) as f:
                _cfg = yaml.safe_load(f) or {}
        except Exception as e:
            logger.warning(f"Error loading config: {e}")
            _cfg = {}
    else:
        _cfg = {}

    # ── 1. Generate CLAUDE.md (merge all prompts/) ─────────────────────
    _update_root_claude_md(target_dir)

    # ── 2. Generate AGENTS.md (for Codex) ────────────────────────────
    agents_md = target_dir / "AGENTS.md"
    agents_content = _build_agents_addition(templates_path)
    _update_or_add_section(agents_md, agents_content, "# mind")

    # ── 3. Create business/SYNC_Project.md (default call file) ─────────
    business_dir = target_dir / "business"
    business_dir.mkdir(exist_ok=True)
    sync_project = business_dir / "SYNC_Project.md"
    if not sync_project.exists():
        sync_project.write_text(
            f"# {target_dir.name} — Project State\n\n"
            f"```\nLAST_UPDATED: —\nSTATUS: initialized\n```\n\n"
            f"---\n\n## Call Log\n\n"
        )
        print(f"✓ Created: {sync_project}")

    # ── 4. Copy skills into .claude/skills ────────────────────────────
    mind_mcp_root = Path(__file__).parent.parent
    claude_skills_src = mind_mcp_root / ".claude" / "skills"
    if claude_skills_src.exists():
        claude_skills_dest = target_dir / ".claude" / "skills"
        _copy_skills(claude_skills_src, claude_skills_dest)

    # ── 4. Initialize graph (ingest docs/ and templates/) ─────────────
    _init_graph(target_dir, clear=clear_graph)

    # ── 5. Configure MCP ──────────────────────────────────────────────
    _configure_mcp_membrane(target_dir)

    print()
    print("mind initialized!")
    print()
    print(f"  CLAUDE.md: {target_dir / 'CLAUDE.md'}")
    print(f"  Config:    {config_path}")
    print()

    return True
