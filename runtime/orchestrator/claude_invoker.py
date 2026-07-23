"""Claude Code subprocess invoker — the sacred path.

Citizens MUST use Claude Code subprocess (`claude --print`), NOT direct API.
Direct API loses tools, MCP, repo access, safety layers — kills all capabilities.
The `invoke_degraded()` path is fallback ONLY.

Invokes Claude Code subprocess for citizen sessions.
"""

import os
import select
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from runtime.orchestrator.account_balancer import (
    get_account_env,
    release_account,
    mark_account_exhausted,
    get_failover_env,
)
from runtime.orchestrator.degradation import (
    detect_rate_limit_error,
    escalate,
    attempt_recovery,
)
from runtime.citizens import build_citizen_prompt
from runtime.l4.citizen_registry import (
    citizen_data as registry_citizen_data,
    citizen_env,
    l1_graph_name,
    normalize_handle,
)

logger = logging.getLogger("orchestrator.invoker")


def _cli_executable(name: str) -> str:
    """Resolve an explicit CLI path or an npm shim on Windows."""
    configured = os.environ.get(f"{name.upper()}_CLI_PATH", "").strip()
    if configured and Path(configured).exists():
        return configured
    return shutil.which(name) or name


_SENSE_PROMPT_FIELDS = (
    "id",
    "version",
    "observedAt",
    "actorId",
    "graphId",
    "mode",
    "name",
    "text",
    "goalIds",
    "activeNodeIds",
    "activeTask",
    "activeAssignment",
    "queue",
    "cortexState",
    "affectVector",
    "innerOuterFocus",
    "consciousState",
    "voice",
)


def _sense_snapshot_for_wake(citizen_handle: str) -> str:
    """Call sense() before a citizen wake and return a bounded prompt snapshot."""
    try:
        from mcp.tools.sense_handler import handle_sense

        result = handle_sense({"handle": citizen_handle})
        content = result.get("content") or []
        raw = content[0].get("text", "") if content else ""
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise ValueError("sense() did not return a JSON object")
    except Exception as exc:
        logger.warning("Mandatory sense() call failed for @%s: %s", citizen_handle, exc)
        payload = {
            "status": "unavailable",
            "citizen": citizen_handle,
            "reason": f"sense_call_failed: {type(exc).__name__}",
        }

    snapshot = {
        field: payload[field]
        for field in _SENSE_PROMPT_FIELDS
        if field in payload
    }
    if payload.get("status") == "unavailable":
        snapshot.update({
            "status": "unavailable",
            "citizen": payload.get("citizen", citizen_handle),
            "reason": payload.get("reason", "unknown"),
        })

    situated = payload.get("situatedEnvironment")
    if isinstance(situated, dict):
        snapshot["situatedEnvironment"] = {
            "measurementStatus": situated.get("measurementStatus"),
            "source": situated.get("source"),
            "graphsQueried": situated.get("graphsQueried"),
            "graphsFailed": situated.get("graphsFailed"),
            "spaces": [
                {
                    "graph": space.get("graph"),
                    "id": space.get("id"),
                    "name": space.get("name"),
                    "locationEvidence": space.get("locationEvidence"),
                    "nodes": (space.get("nodes") or [])[:20],
                }
                for space in (situated.get("spaces") or [])[:8]
                if isinstance(space, dict)
            ],
        }

    return json.dumps(snapshot, ensure_ascii=False, indent=2)


# ── Constants ───────────────────────────────────────────────────────────────

SESSION_TIMEOUT = 1200  # 20 minutes max per subprocess
STREAM_CHUNK_SIZE = 800  # chars before persisting a thinking moment

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

# Python running the MCP server: the project venv, or whatever launched us.
MCP_PYTHON = os.environ.get("MIND_MCP_PYTHON") or str(
    PROJECT_ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
)


def citizen_workspace(handle: str) -> Path:
    """Scratch directory for a citizen's sessions.

    Files a citizen writes have to land somewhere. That somewhere carries no
    identity — the handle does, and it comes from L4.
    """
    workspace = get_state_dir() / "workspaces" / handle
    workspace.mkdir(parents=True, exist_ok=True)
    return workspace


def _mcp_config_path(handle: str) -> Optional[Path]:
    """Write (and return) the MCP config a citizen's subprocess should load.

    Regenerated on every invocation and pinned to this citizen: the server
    inherits `MIND_CITIZEN_ID` and its own L1 graph, so a session can only ever
    act — and write — as the citizen it was launched for.
    """
    handle = normalize_handle(handle)
    if not handle:
        return None

    python = MCP_PYTHON if Path(MCP_PYTHON).exists() else sys.executable
    config = {
        "mcpServers": {
            "mind": {
                "command": python,
                "args": ["-m", "mcp.server"],
                "cwd": str(PROJECT_ROOT),
                "env": {
                    "MIND_CITIZEN_ID": handle,
                    "CITIZEN_HANDLE": handle,
                    "L1_GRAPH": l1_graph_name(handle),
                    "PYTHONUTF8": "1",
                    "PYTHONIOENCODING": "utf-8",
                },
            }
        }
    }

    config_dir = get_state_dir() / "mcp"
    config_dir.mkdir(parents=True, exist_ok=True)
    path = config_dir / f"{handle}.mcp.json"
    try:
        path.write_text(json.dumps(config, indent=2), encoding="utf-8")
    except OSError as e:
        # Pas de config = pas d'outils. On le dit : un citoyen muet qui répond
        # quand même est plus difficile à diagnostiquer qu'une erreur.
        logger.error(f"Cannot write MCP config for @{handle}: {e} — session will have no tools")
        return None
    return path


def _set_resource_limits():
    """Set resource limits for citizen Claude processes."""
    import resource
    # 50MB max file write
    resource.setrlimit(resource.RLIMIT_FSIZE, (50_000_000, 50_000_000))
    # No virtual memory limit — Claude Code + node.js + MCP needs variable
    # amounts depending on context size. SESSION_TIMEOUT + CPU limit are
    # sufficient guards. RLIMIT_AS was causing SIGABRT/SIGILL crashes.
    # 20 min CPU time (matches SESSION_TIMEOUT)
    resource.setrlimit(resource.RLIMIT_CPU, (1200, 1200))


def get_state_dir() -> Path:
    """Return the state directory for response files."""
    return Path(__file__).resolve().parent.parent.parent / "shrine" / "state"


# ── Streaming moment persistence ────────────────────────────────────────────

def _get_l3_graph():
    """Get the L3 universe graph. Returns None on failure."""
    try:
        import redis
        r = redis.Redis(host="localhost", port=6379, decode_responses=True)
        r.ping()
        return r
    except Exception as e:
        logger.debug(f"FalkorDB not available for moment persistence: {e}")
        return None


def _get_actor_space(r, citizen_handle: str) -> Optional[str]:
    """Find the Space the actor is currently LOCATED_IN."""
    try:
        result = r.execute_command(
            "GRAPH.QUERY", "lumina-prime",
            f"MATCH (a:Actor {{id: '{citizen_handle}'}})-[l:link]->(s) "
            f"WHERE l.type = 'LOCATED_IN' RETURN s.id LIMIT 1",
        )
        if result and result[1]:
            return result[1][0][0]
    except Exception:
        pass
    return None


def _persist_moment(
    r,
    citizen_handle: str,
    session_id: str,
    chunk_index: int,
    content: str,
    prev_moment_id: Optional[str],
    space_id: Optional[str],
) -> Optional[str]:
    """Persist a streaming moment to L3. Returns the moment id, or None on failure."""
    moment_id = f"moment:stream:{session_id}:{chunk_index}"
    now_s = int(time.time())
    # Escape content for Cypher string literal
    safe_content = content[:1000].replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n")
    try:
        # Create moment node
        r.execute_command(
            "GRAPH.QUERY", "lumina-prime",
            f"MERGE (m:Moment {{id: '{moment_id}'}}) "
            f"ON CREATE SET m.node_type = 'moment', "
            f"m.content = '{safe_content}', "
            f"m.energy = 0.4, m.weight = 0.05, "
            f"m.origin_citizen = '{citizen_handle}', "
            f"m.session_id = '{session_id}', "
            f"m.created_at_s = {now_s}",
        )
        # Link to actor
        r.execute_command(
            "GRAPH.QUERY", "lumina-prime",
            f"MATCH (a:Actor {{id: '{citizen_handle}'}}), (m:Moment {{id: '{moment_id}'}}) "
            f"MERGE (a)-[r:link]->(m) SET r.type = 'PRODUCED', r.weight = 0.3",
        )
        # Chain to previous moment
        if prev_moment_id:
            r.execute_command(
                "GRAPH.QUERY", "lumina-prime",
                f"MATCH (prev:Moment {{id: '{prev_moment_id}'}}), (m:Moment {{id: '{moment_id}'}}) "
                f"MERGE (prev)-[r:link]->(m) SET r.type = 'FOLLOWED_BY', r.weight = 0.5",
            )
        # Link to space
        if space_id:
            r.execute_command(
                "GRAPH.QUERY", "lumina-prime",
                f"MATCH (m:Moment {{id: '{moment_id}'}}), (s {{id: '{space_id}'}}) "
                f"MERGE (m)-[r:link]->(s) SET r.type = 'LOCATED_IN', r.weight = 0.3",
            )
        return moment_id
    except Exception as e:
        logger.debug(f"Moment persistence failed for {moment_id}: {e}")
        return None


def _write_stdin(proc, text):
    """Write input to stdin in a background thread to avoid deadlock."""
    try:
        if text:
            proc.stdin.write(text)
        proc.stdin.close()
    except (BrokenPipeError, OSError):
        pass


def _read_stream_json(
    process: subprocess.Popen,
    citizen_handle: Optional[str],
    session_id: str,
    timeout: float,
    chunk_offset: int = 0,
    r=None,
    space_id: Optional[str] = None,
    prev_moment_id: Optional[str] = None,
) -> tuple[str, str, int, Optional[str]]:
    """Read stream-json stdout line by line, persisting moments every ~800 chars.

    Returns (response_text, stderr_text, chunks_written, last_moment_id).
    """
    deadline = time.time() + timeout
    accumulated = ""
    full_parts = []
    chunk_index = chunk_offset
    last_moment = prev_moment_id
    result_text = None
    _lines_read = 0
    _types_seen = {}

    while True:
        remaining = deadline - time.time()
        if remaining <= 0:
            break

        try:
            ready, _, _ = select.select([process.stdout], [], [], min(remaining, 1.0))
        except (ValueError, OSError):
            break

        if not ready:
            if process.poll() is not None:
                # Process exited — but pipe may still have buffered data.
                # Do one more select with 0 timeout to drain it.
                try:
                    ready2, _, _ = select.select([process.stdout], [], [], 0.1)
                    if not ready2:
                        break
                except (ValueError, OSError):
                    break
                # Fall through to readline below
            else:
                continue

        line = process.stdout.readline()
        if not line:
            break

        _lines_read += 1
        line = line.strip()
        if not line:
            continue

        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue

        msg_type = obj.get("type", "")
        _types_seen[msg_type] = _types_seen.get(msg_type, 0) + 1

        # Claude Code stream-json format:
        #   {"type": "assistant", "message": {"content": [{"type": "text", "text": "..."}]}}
        #   {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Write", "input": {...}}]}}
        #   {"type": "result", "result": "final text"}

        if msg_type == "assistant":
            message = obj.get("message", {})
            for block in message.get("content", []):
                block_type = block.get("type", "")

                # Text output (speech)
                if block_type == "text":
                    text = block.get("text", "")
                    if text:
                        accumulated += text
                        full_parts.append(text)

                        if citizen_handle and r and len(accumulated) >= STREAM_CHUNK_SIZE:
                            mid = _persist_moment(
                                r, citizen_handle, session_id,
                                chunk_index, accumulated,
                                last_moment, space_id,
                            )
                            if mid:
                                last_moment = mid
                            chunk_index += 1
                            accumulated = ""

                # Tool use (action) — file writes, edits, bash = real work
                elif block_type == "tool_use":
                    tool_name = block.get("name", "")
                    tool_input = block.get("input", {})
                    if tool_name in ("Write", "Edit", "Bash", "NotebookEdit"):
                        file_path = tool_input.get("file_path", tool_input.get("command", ""))
                        summary = f"[{tool_name}] {file_path}" if file_path else f"[{tool_name}]"
                        full_parts.append(summary)

                        if citizen_handle and r:
                            mid = _persist_moment(
                                r, citizen_handle, session_id,
                                chunk_index, summary,
                                last_moment, space_id,
                            )
                            if mid:
                                last_moment = mid
                            chunk_index += 1

        elif msg_type == "result":
            result_text = obj.get("result", "")

    logger.info(f"[stream-parse] {session_id[:8]}: {_lines_read} lines, types={_types_seen}, parts={len(full_parts)}, result={'yes' if result_text else 'no'}")

    # Drain any remaining buffered stdout after loop ends
    # (process may exit with data still in the pipe)
    try:
        for trailing_line in (process.stdout.read() or "").splitlines():
            trailing_line = trailing_line.strip()
            if not trailing_line:
                continue
            try:
                obj = json.loads(trailing_line)
            except json.JSONDecodeError:
                continue
            msg_type = obj.get("type", "")
            if msg_type == "assistant":
                message = obj.get("message", {})
                for block in message.get("content", []):
                    if block.get("type") == "text":
                        text = block.get("text", "")
                        if text:
                            accumulated += text
                            full_parts.append(text)
                    elif block.get("type") == "tool_use":
                        tool_name = block.get("name", "")
                        tool_input = block.get("input", {})
                        if tool_name in ("Write", "Edit", "Bash", "NotebookEdit"):
                            fp = tool_input.get("file_path", tool_input.get("command", ""))
                            summary = f"[{tool_name}] {fp}" if fp else f"[{tool_name}]"
                            full_parts.append(summary)
            elif msg_type == "result":
                result_text = obj.get("result", "")
    except Exception:
        pass

    # Persist remaining accumulated text
    if citizen_handle and r and accumulated and len(accumulated) > 50:
        mid = _persist_moment(
            r, citizen_handle, session_id,
            chunk_index, accumulated,
            last_moment, space_id,
        )
        if mid:
            last_moment = mid
        chunk_index += 1

    # Use authoritative result if available, else concatenated parts
    response = result_text if result_text else "".join(full_parts)

    stderr_text = ""
    try:
        if process.poll() is not None:
            stderr_text = process.stderr.read() or ""
    except Exception:
        pass

    return response, stderr_text, chunk_index, last_moment


# ── Quick call — direct citizen-to-citizen invocation ───────────────────────

QUICK_CALL_TIMEOUT = 120  # 2 minutes max for a quick call

def quick_call(
    target_handle: str,
    question: str,
    caller_handle: Optional[str] = None,
) -> str:
    """Invoke a citizen directly with a question. Returns their answer.

    Lightweight: no tick loop, no dispatcher, no subconscious threshold.
    Resolves the target in the L4 registry, asks the question, returns text.
    Moments are persisted to L3 (chained, located in target's space).

    Cost: 1 session slot for ~30-120s. Use for real questions, not pings.
    """
    target_handle = normalize_handle(target_handle)
    if not target_handle or not registry_citizen_data(target_handle):
        return f"(citizen @{target_handle} has no L4 identity — cannot call)"

    citizen_dir = citizen_workspace(target_handle)

    session_id = str(uuid.uuid4())
    caller = caller_handle or "unknown"

    prompt = (
        f"[QUICK CALL from @{caller}]\n\n"
        f"{question}\n\n"
        f"Answer concisely. Focus on what @{caller} needs to know. "
        f"Do not start new projects or make changes — just find the info and respond."
    )

    # Choose CLI: Gemini if all Claude accounts are dead
    use_gemini = healthy_account_count() == 0 and os.environ.get("ENABLE_GEMINI_CLI", "1") == "1"

    if use_gemini:
        cmd = [_cli_executable("gemini"), "-m", os.environ.get("GEMINI_CLI_MODEL", "gemini-2.5-pro"), "--yolo", "-o", "text"]
        logger.info(f"quick_call using Gemini (all Claude accounts expired)")
    else:
        cmd = [
            _cli_executable("claude"), "--print",
            "--output-format", "stream-json",
            "--verbose", "--include-partial-messages",
            "--dangerously-skip-permissions",
            "--session-id", session_id,
        ]
        mcp_config = _mcp_config_path(target_handle)
        if mcp_config:
            cmd.extend(["--mcp-config", str(mcp_config), "--strict-mcp-config"])

    clean_env = citizen_env(target_handle, {
        k: v for k, v in os.environ.items()
        if k not in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")
    })

    if use_gemini:
        balanced_env = clean_env
        account_id = "gemini"
    else:
        balanced_env = get_account_env(clean_env)
        account_id = balanced_env.get("_CLAUDE_ACCOUNT_ID", "default")

    # Gemini: pass prompt as -p arg; Claude: pass via stdin
    if use_gemini:
        cmd.extend(["-p", prompt])
        input_text = None
    else:
        input_text = prompt

    process = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=citizen_dir,
        env=balanced_env,
        preexec_fn=_set_resource_limits if os.name != "nt" else None,
    )

    # Prepare moment persistence
    r_graph = _get_l3_graph()
    space_id = _get_actor_space(r_graph, target_handle) if r_graph else None

    if use_gemini:
        # Gemini: blocking communicate (no stream-json support)
        process.stdin.close()
        try:
            stdout, stderr = process.communicate(timeout=QUICK_CALL_TIMEOUT)
        except subprocess.TimeoutExpired:
            process.kill()
            stdout, stderr = process.communicate()
        response = stdout.strip() if stdout else ""
        # Persist as a single moment
        if response and r_graph:
            _persist_moment(r_graph, target_handle, session_id, 0, response[:1000], None, space_id)
    else:
        # Claude: streaming with moment persistence
        stdin_thread = threading.Thread(
            target=_write_stdin, args=(process, input_text), daemon=True,
        )
        stdin_thread.start()
        response, stderr, _, _ = _read_stream_json(
            process, target_handle, session_id,
            timeout=QUICK_CALL_TIMEOUT,
            r=r_graph, space_id=space_id,
        )

    if process.poll() is None:
        process.kill()
        process.wait()

    if not use_gemini:
        release_account(balanced_env, error=process.returncode != 0)

    # Log the call
    logger.info(
        f"quick_call @{caller}→@{target_handle}: "
        f"{len(response)} chars in {session_id[:8]}"
    )

    # Record in call file for both citizens
    call_dir = citizen_dir / "calls"
    call_dir.mkdir(exist_ok=True)
    ts = time.strftime("%H:%M:%S")
    call_file = call_dir / f"quick_{session_id[:8]}.md"
    try:
        call_file.write_text(
            f"# Quick Call from @{caller}\n\n"
            f"**Time:** {ts}\n"
            f"**Question:** {question}\n\n"
            f"**Response:**\n{response}\n"
        )
    except OSError:
        pass

    return response or f"(@{target_handle} did not respond)"


# ── Main invocation ─────────────────────────────────────────────────────────

def invoke_claude(
    request: dict,
    session_id: str,
    resume_claude_session: Optional[str] = None,
    pin_account_id: Optional[str] = None,
) -> tuple[str, Optional[str]]:
    """Invoke Claude Code for a single request. Runs in thread pool.

    Returns (response_text, voice_response_or_None).
    """
    mode = request.get("mode", "partner")
    voice_text = request.get("voice_text", "")
    source = request.get("source", "")
    metadata = request.get("metadata", {})
    sender = request.get("sender", "user")

    # Citizen session detection — the L4 registry decides who exists.
    citizen_handle = normalize_handle(metadata.get("citizen_handle"))
    citizen_data = None
    is_citizen_session = False
    if citizen_handle:
        citizen_data = registry_citizen_data(citizen_handle)
        if citizen_data:
            is_citizen_session = True
            logger.info(f"Citizen session for @{citizen_handle} ({citizen_data['l1_graph']})")
        else:
            logger.warning(f"@{citizen_handle} is not in the L4 registry — no citizen session")

    # Task routing
    is_task = source == "task" or metadata.get("task_type") == "implementation"
    task_cwd = metadata.get("cwd") if is_task else None

    # Build prompt
    prompt = _build_prompt(
        request, session_id, mode, voice_text, sender,
        is_citizen_session, citizen_data,
        is_task, task_cwd, metadata,
    )

    # Determine working directory. A citizen's workspace is scratch space, not
    # identity: the handle says who acts, the directory only says where files
    # land. Nothing is read back from it to decide who the citizen is.
    project_root = Path(__file__).resolve().parent.parent.parent
    if is_citizen_session and citizen_handle:
        working_dir = citizen_workspace(citizen_handle)
    elif task_cwd and Path(task_cwd).exists():
        working_dir = Path(task_cwd)
    else:
        working_dir = project_root

    # Build command — stream-json for moment persistence during thinking
    cmd = [
        _cli_executable("claude"), "--print",
        "--output-format", "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--dangerously-skip-permissions",
    ]

    # Cognition tools. Without this the citizen answering on Telegram runs with
    # no MCP at all — it can talk, but it cannot query or write its own graph.
    mcp_config = _mcp_config_path(citizen_handle) if citizen_handle else None
    if mcp_config:
        cmd.extend(["--mcp-config", str(mcp_config), "--strict-mcp-config"])

    # Conversation continuity
    is_resuming = False
    claude_session_uuid = None
    if resume_claude_session:
        cmd.extend(["--resume", resume_claude_session])
        claude_session_uuid = resume_claude_session
        is_resuming = True
    else:
        claude_session_uuid = str(uuid.uuid4())
        cmd.extend(["--session-id", claude_session_uuid])

    state_dir = get_state_dir()

    # Build clean env (strip CLAUDECODE to allow nested invocation)
    clean_env = {k: v for k, v in os.environ.items() if k not in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")}

    # Account selection
    if pin_account_id:
        balanced_env = _find_account_env(pin_account_id, clean_env)
    else:
        balanced_env = get_account_env(clean_env)
    account_id = balanced_env.get("_CLAUDE_ACCOUNT_ID", "default")

    # One process, one citizen — the identity travels in the environment, so
    # anything the session spawns (MCP server included) inherits the same one.
    if citizen_handle:
        balanced_env = citizen_env(citizen_handle, balanced_env)

    # Build message BEFORE launching subprocess.
    # For short messages: pass as CLI positional arg.
    # For long prompts (citizen sessions with cognitive context): pass via stdin.
    if is_resuming and voice_text:
        message = f"[FOLLOW-UP from {sender}]\n{voice_text}"
    else:
        message = voice_text or "Wake up and check your messages."

    # Use the full prompt (includes cognitive context, WM state, action directives)
    # instead of bare voice_text. The prompt was built by _build_prompt() above.
    if prompt and len(prompt) > len(message):
        # Long prompts go via stdin (CLI arg length limits)
        input_text = prompt
    else:
        # Short messages as CLI positional arg
        cmd.append(message)
        input_text = None

    # Launch subprocess
    process = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=working_dir,
        env=balanced_env,
        preexec_fn=_set_resource_limits if os.name != "nt" else None,
    )

    # Execute with streaming moment persistence + early subconscious response.
    # Reads stdout line-by-line as stream-json. Every ~800 chars of text output,
    # persists a Moment node to L3 — linked to the previous moment and the
    # actor's current space. Crash-safe: partial work survives.
    SUBCONSCIOUS_THRESHOLD = float(os.environ.get("SUBCONSCIOUS_THRESHOLD", "10"))
    start_time = time.time()
    early_subconscious_sent = False

    # Send stdin in background thread (avoids pipe deadlock)
    stdin_thread = threading.Thread(
        target=_write_stdin, args=(process, input_text), daemon=True,
    )
    stdin_thread.start()

    # Prepare moment persistence (lazy — None if FalkorDB unavailable)
    r_graph = _get_l3_graph() if citizen_handle else None
    space_id = _get_actor_space(r_graph, citizen_handle) if r_graph and citizen_handle else None

    # Phase 1: Read for SUBCONSCIOUS_THRESHOLD seconds
    response, stderr, chunks_written, last_moment = _read_stream_json(
        process, citizen_handle, session_id,
        timeout=SUBCONSCIOUS_THRESHOLD,
        r=r_graph, space_id=space_id,
    )

    if process.poll() is None:
        # Process still running after threshold
        if citizen_handle and not response:
            subconscious_text = invoke_subconscious(request, session_id, citizen_handle)
            if subconscious_text:
                interim_path = state_dir / f"last_response_{session_id}.txt"
                interim_path.write_text(
                    subconscious_text + "\n\n---\n*Claude is still thinking... "
                    "full response will follow.*"
                )
                early_subconscious_sent = True
                logger.info(
                    f"Subconscious interim after {time.time() - start_time:.0f}s for {citizen_handle}"
                )

        # Phase 2: Continue reading for remaining timeout
        more_response, more_stderr, _, last_moment = _read_stream_json(
            process, citizen_handle, session_id,
            timeout=SESSION_TIMEOUT - SUBCONSCIOUS_THRESHOLD,
            chunk_offset=chunks_written,
            r=r_graph, space_id=space_id,
            prev_moment_id=last_moment,
        )
        if more_response:
            response = more_response if not response else response + more_response
        stderr = (stderr or "") + (more_stderr or "")

        if process.poll() is None:
            process.kill()
            process.wait()
            logger.warning(f"Session {session_id} timed out after {SESSION_TIMEOUT}s")

    elapsed = time.time() - start_time
    release_account(balanced_env, error=process.returncode != 0)
    stdout = response  # Compatibility with downstream code

    # Check for rate limiting
    is_account_error = detect_rate_limit_error(stderr or "", stdout or "")

    # Response is already extracted from stream-json. Use it directly.
    response_file = state_dir / f"last_response_{session_id}.txt"
    response = stdout or ""  # stdout holds the stream-extracted response
    voice_response = None

    # Fallback: check response file (tools may still write to it)
    if not response and response_file.exists():
        raw = response_file.read_text().strip()
        if "---VOICE---" in raw:
            parts = raw.split("---VOICE---", 1)
            response = parts[0].strip()
            voice_response = parts[1].strip() if len(parts) > 1 and parts[1].strip() else None
        else:
            response = raw

    # Clean up the response file
    if response_file.exists():
        try:
            response_file.unlink()
        except OSError:
            pass

    # Empty response diagnostics
    if not response:
        _rc = process.returncode
        _diag = [f"exit={_rc}", f"elapsed={elapsed:.1f}s", f"account={account_id}"]
        if _rc is not None and _rc < 0:
            try:
                _sig_name = signal.Signals(-_rc).name
            except (ValueError, AttributeError):
                _sig_name = f"SIG({-_rc})"
            _diag.append(f"signal={_sig_name}")
        if stderr:
            _diag.append(f"stderr={stderr[:200]}")
        logger.warning(f"Session {session_id} empty: {'; '.join(_diag)}")

    # Account failover (retry once with different account)
    _is_error_response = is_account_error and response and detect_rate_limit_error("", response)
    if _is_error_response:
        response = ""  # Clear error-as-response

    if not response and is_account_error and not pin_account_id:
        response, voice_response, elapsed = _attempt_failover(
            account_id, clean_env, cmd[:],  # Pass a copy of cmd
            working_dir, input_text, session_id,
            response_file, elapsed,
        )

    # Recovery / degradation tracking + activation pressure
    if response:
        attempt_recovery()
        try:
            from runtime.orchestrator.activation_pressure import on_success
            on_success()
        except ImportError:
            pass
    elif detect_rate_limit_error(stderr or "", stdout or ""):
        escalate(f"Empty response from {account_id}")
        try:
            from runtime.orchestrator.activation_pressure import on_rate_limit
            on_rate_limit()
        except ImportError:
            pass

    logger.info(f"Session {session_id} done in {elapsed:.0f}s — {len(response)} chars")

    metadata = request.get("metadata") or {}
    citizen_handle_for_log = metadata.get("citizen_handle", "")

    # Auto-reply directly from invoker — don't wait for _collect_completed_futures
    source = request.get("source", "")
    if response and source in ("telegram", "whatsapp"):
        chat_id = metadata.get("chat_id")
        if chat_id:
            try:
                if source == "telegram":
                    from runtime.bridges.telegram_bridge import send_message
                    send_message(response[:4000], chat_id)
                    logger.info(f"Auto-reply to TG {chat_id} ({len(response)} chars)")
                elif source == "whatsapp":
                    from runtime.bridges.whatsapp_bridge import send_message as wa_send
                    wa_send(response[:4000], chat_id)
                    logger.info(f"Auto-reply to WA {chat_id} ({len(response)} chars)")
            except Exception as e:
                logger.warning(f"Auto-reply from invoker failed: {e}")

    # Log action result directly here — not in the future callback.
    if citizen_handle_for_log and metadata.get("autonomous"):
        try:
            from runtime.orchestrator.battle_log import log_action_result
            dispatch_ts = metadata.get("_dispatch_ts", 0)
            duration = (time.time() - dispatch_ts) if dispatch_ts else elapsed
            log_action_result(
                citizen_handle_for_log,
                session_id,
                success=bool(response),
                duration_s=duration,
                output_summary=str(response or "")[:500],
            )
        except Exception as e:
            logger.debug(f"Battle log from invoker failed: {e}")

    return (response, voice_response)


def _attempt_failover(
    account_id: str,
    clean_env: dict,
    base_cmd: list,
    working_dir: Path,
    input_text: str,
    session_id: str,
    response_file: Path,
    elapsed: float,
) -> tuple[str, Optional[str], float]:
    """Attempt failover to a different account after failure."""
    mark_account_exhausted(account_id)
    failover_env = get_failover_env(account_id, clean_env)
    if not failover_env:
        logger.warning(f"Account {account_id} exhausted — no failover available")
        return ("", None, elapsed)

    failover_id = failover_env.get("_CLAUDE_ACCOUNT_ID", "?")
    logger.info(f"Account failover: {account_id} → {failover_id}")

    failover_uuid = str(uuid.uuid4())
    failover_cmd = [
        _cli_executable("claude"), "--print", "--output-format", "stream-json",
        "--verbose", "--include-partial-messages",
        "--dangerously-skip-permissions",
        "--session-id", failover_uuid,
        "--add-dir", "..",
    ]
    # Carry forward the citizen's MCP config. A failover session is the same
    # citizen on another account — losing its tools mid-answer would look like
    # the citizen suddenly went blind.
    if "--mcp-config" in base_cmd:
        idx = base_cmd.index("--mcp-config")
        failover_cmd.extend(base_cmd[idx:idx + 2])
        if "--strict-mcp-config" in base_cmd:
            failover_cmd.append("--strict-mcp-config")

    # Carry forward the message: either via stdin (input_text) or CLI arg (from base_cmd)
    if not input_text and base_cmd and not base_cmd[-1].startswith("-"):
        failover_cmd.append(base_cmd[-1])

    fo_proc = subprocess.Popen(
        failover_cmd,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, cwd=working_dir, env=failover_env,
        preexec_fn=_set_resource_limits if os.name != "nt" else None,
    )

    # Send stdin in background thread
    fo_stdin_thread = threading.Thread(
        target=_write_stdin, args=(fo_proc, input_text), daemon=True,
    )
    fo_stdin_thread.start()

    fo_start = time.time()
    response, fo_stderr, _, _ = _read_stream_json(
        fo_proc, None, session_id,  # No moment persistence on failover
        timeout=SESSION_TIMEOUT,
    )
    if fo_proc.poll() is None:
        fo_proc.kill()
        fo_proc.wait()

    fo_elapsed = time.time() - fo_start
    release_account(failover_env, error=fo_proc.returncode != 0)

    voice_response = None
    if not response and response_file.exists():
        raw = response_file.read_text().strip()
        response_file.unlink()
        if "---VOICE---" in raw:
            parts = raw.split("---VOICE---", 1)
            response = parts[0].strip()
            voice_response = parts[1].strip() if len(parts) > 1 and parts[1].strip() else None
        else:
            response = raw

    if response:
        logger.info(f"Failover to {failover_id} succeeded in {fo_elapsed:.0f}s")
    else:
        if detect_rate_limit_error(fo_stderr or "", response or ""):
            mark_account_exhausted(failover_id)
        logger.warning(f"Failover to {failover_id} also failed")

    return (response, voice_response, elapsed + fo_elapsed)


def _find_account_env(account_id: str, base_env: Optional[dict] = None) -> dict:
    """Find a specific account's env (for pinned resume)."""
    from runtime.orchestrator.account_balancer import get_accounts
    env = dict(base_env or os.environ)
    for a in get_accounts():
        if a["id"] == account_id:
            env["HOME"] = a["home"]
            env["_CLAUDE_ACCOUNT_ID"] = a["id"]
            return env
    return env


# ── Prompt building ─────────────────────────────────────────────────────────

def _build_prompt(
    request: dict,
    session_id: str,
    mode: str,
    voice_text: str,
    sender: str,
    is_citizen_session: bool,
    citizen_data: Optional[dict],
    is_task: bool,
    task_cwd: Optional[str],
    metadata: dict,
) -> str:
    """Build the invocation prompt based on request type."""

    _now = datetime.now()
    _day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    date_line = f"**Date:** {_day_names[_now.weekday()]} {_now.strftime('%Y-%m-%d %H:%M')}"

    mode_prompts = {
        "partner": "Engage as a partner. Offer ideas, challenge, build together.",
        "witness": "Be a witness. Reflect what you see without advice.",
        "critic": "Be a critic. Stress-test everything. Find flaws.",
        "architect": "Be an architect. Zoom out. Big picture.",
        "builder": "Focus on implementation. Write code, fix bugs, ship features.",
    }

    if is_citizen_session and citizen_data:
        citizen_mode = metadata.get("citizen_mode", mode)
        cognitive_context = metadata.get("cognitive_context", "")
        sense_snapshot = _sense_snapshot_for_wake(citizen_data["handle"])
        grounded_task = f"""## Wake grounding

The orchestrator called `sense()` for this wake before invoking you. Orient
from the snapshot below before answering or acting. Treat unavailable, stale,
or unknown fields honestly. If an active task is present, execute or address it
instead of offering to call `sense()` later.

```json
{sense_snapshot}
```

## Current stimulus

{voice_text or "(autonomous wake)"}"""
        return build_citizen_prompt(
            citizen_data, grounded_task,
            session_id, citizen_mode,
            cognitive_context=cognitive_context,
        )

    if is_task:
        task_repo = metadata.get("repo", "current")
        task_files = metadata.get("files", [])
        return f"""IMPLEMENTATION TASK (via Orchestrator)

**Mode:** {mode}
{mode_prompts.get(mode, mode_prompts["architect"])}

{date_line}
**Session ID:** {session_id}
**Repository:** {task_repo}
**Working Directory:** {task_cwd or '.'}
**Files to focus on:** {', '.join(task_files) if task_files else 'determine from task'}

**Task:**
{voice_text}

## Steps

1. Understand the task requirements
2. Explore relevant code if needed
3. Implement the changes
4. Write summary to state/last_response_{session_id}.txt
"""

    # Standard mode
    return f"""SESSION — {mode}

{mode_prompts.get(mode, mode_prompts["partner"])}

{date_line}
**Session ID:** {session_id}

**{sender}:** {voice_text}

Respond to what {sender} said. Write your full response to state/last_response_{session_id}.txt
If the response has a voice-friendly version, add it after a ---VOICE--- separator.
"""


# ── Gemini CLI invocation ─────────────────────────────────────────────────

GEMINI_MODEL = os.environ.get("GEMINI_CLI_MODEL", "gemini-2.5-pro")


def invoke_gemini(
    request: dict,
    session_id: str,
    resume_claude_session: Optional[str] = None,
    pin_account_id: Optional[str] = None,
) -> tuple[str, Optional[str]]:
    """Invoke Gemini CLI for a single request. Same interface as invoke_claude.

    Gemini CLI has filesystem access, MCP tools, and GEMINI.md — it's a full
    peer to Claude Code, not a degraded fallback. Used to spread load across
    providers and avoid Claude rate limits.

    Returns (response_text, voice_response_or_None).
    """
    mode = request.get("mode", "partner")
    voice_text = request.get("voice_text", "")
    source = request.get("source", "")
    metadata = request.get("metadata", {})
    sender = request.get("sender", "user")

    # Citizen session detection — same registry as the Claude path.
    citizen_handle = normalize_handle(metadata.get("citizen_handle"))
    citizen_data = None
    is_citizen_session = False
    if citizen_handle:
        citizen_data = registry_citizen_data(citizen_handle)
        if citizen_data:
            is_citizen_session = True
            logger.info(f"Gemini session for @{citizen_handle}")

    # Task routing
    is_task = source == "task" or metadata.get("task_type") == "implementation"
    task_cwd = metadata.get("cwd") if is_task else None

    # Build prompt (reuse same prompt builder as Claude)
    prompt = _build_prompt(
        request, session_id, mode, voice_text, sender,
        is_citizen_session, citizen_data,
        is_task, task_cwd, metadata,
    )

    # Determine working directory (scratch space, not identity)
    project_root = Path(__file__).resolve().parent.parent.parent
    if is_citizen_session and citizen_handle:
        working_dir = citizen_workspace(citizen_handle)
    elif task_cwd and Path(task_cwd).exists():
        working_dir = Path(task_cwd)
    else:
        working_dir = project_root

    # Build Gemini CLI command
    cmd = [
        _cli_executable("gemini"),
        "-m", GEMINI_MODEL,
        "--yolo",
        "-o", "text",
    ]

    # Gemini uses -p for non-interactive prompt mode
    # Long prompts go via stdin with -p flag
    message = voice_text or "Wake up and check your messages."
    if prompt and len(prompt) > len(message):
        input_text = prompt
        cmd.extend(["-p", ""])  # -p with empty string reads from stdin
    else:
        cmd.extend(["-p", message])
        input_text = None

    # Clean env
    clean_env = {k: v for k, v in os.environ.items()
                 if k not in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")}

    start_time = time.time()

    # Launch subprocess
    process = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=working_dir,
        env=clean_env,
        preexec_fn=_set_resource_limits if os.name != "nt" else None,
    )

    try:
        stdout, stderr = process.communicate(input=input_text, timeout=SESSION_TIMEOUT)
    except subprocess.TimeoutExpired:
        process.kill()
        stdout, stderr = process.communicate()
        logger.warning(f"Gemini session {session_id} timed out after {SESSION_TIMEOUT}s")

    elapsed = time.time() - start_time

    # Extract response from stdout
    response = ""
    voice_response = None
    if stdout and stdout.strip():
        lines = [ln for ln in stdout.strip().splitlines()
                 if not ln.startswith("[WARN]") and not ln.startswith("Loaded cached")]
        response = "\n".join(lines).strip()

    # Check response file (if Gemini wrote to the same state file pattern)
    state_dir = get_state_dir()
    response_file = state_dir / f"last_response_{session_id}.txt"
    if response_file.exists():
        raw = response_file.read_text().strip()
        response_file.unlink()
        if "---VOICE---" in raw:
            parts = raw.split("---VOICE---", 1)
            response = parts[0].strip()
            voice_response = parts[1].strip() if len(parts) > 1 and parts[1].strip() else None
        elif raw:
            response = raw

    if not response:
        logger.warning(
            f"Gemini session {session_id} empty: exit={process.returncode}, "
            f"elapsed={elapsed:.1f}s, stderr={stderr[:200] if stderr else ''}"
        )

    logger.info(f"Gemini session {session_id} done in {elapsed:.0f}s — {len(response)} chars")

    # Log action result (same pattern as invoke_claude)
    citizen_handle_for_log = metadata.get("citizen_handle", "")
    if citizen_handle_for_log and metadata.get("autonomous"):
        try:
            from runtime.orchestrator.battle_log import log_action_result
            dispatch_ts = metadata.get("_dispatch_ts", 0)
            duration = (time.time() - dispatch_ts) if dispatch_ts else elapsed
            log_action_result(
                citizen_handle_for_log,
                session_id,
                success=bool(response),
                duration_s=duration,
                output_summary=str(response or "")[:500],
            )
        except Exception as e:
            logger.debug(f"Battle log from gemini invoker failed: {e}")

    return (response, voice_response)


# ── Degraded fallback ──────────────────────────────────────────────────────

def invoke_codex(
    request: dict,
    session_id: str,
    resume_claude_session: Optional[str] = None,
    pin_account_id: Optional[str] = None,
) -> tuple[str, Optional[str]]:
    """Invoke Codex CLI as an ephemeral, read-only citizen response engine."""
    mode = request.get("mode", "partner")
    voice_text = request.get("voice_text", "")
    source = request.get("source", "")
    metadata = request.get("metadata", {})
    sender = request.get("sender", "user")

    citizen_handle = normalize_handle(metadata.get("citizen_handle"))
    citizen_data = registry_citizen_data(citizen_handle) if citizen_handle else None
    is_citizen_session = bool(citizen_data)
    is_task = source == "task" or metadata.get("task_type") == "implementation"
    task_cwd = metadata.get("cwd") if is_task else None

    prompt = _build_prompt(
        request, session_id, mode, voice_text, sender,
        is_citizen_session, citizen_data,
        is_task, task_cwd, metadata,
    )
    prompt += (
        "\n\nFor this response, do not call tools and do not write files. "
        "Return only the message to send to the human."
    )

    if is_citizen_session and citizen_handle:
        working_dir = citizen_workspace(citizen_handle)
    elif task_cwd and Path(task_cwd).exists():
        working_dir = Path(task_cwd)
    else:
        working_dir = PROJECT_ROOT

    cmd = [
        _cli_executable("codex"),
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox", "read-only",
        "--color", "never",
        "--ignore-user-config",
        "--ignore-rules",
        "-",
    ]
    clean_env = citizen_env(citizen_handle, os.environ.copy()) if citizen_handle else os.environ.copy()
    start_time = time.time()
    process = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        cwd=working_dir,
        env=clean_env,
        preexec_fn=_set_resource_limits if os.name != "nt" else None,
    )
    try:
        stdout, stderr = process.communicate(input=prompt, timeout=SESSION_TIMEOUT)
    except subprocess.TimeoutExpired:
        process.kill()
        stdout, stderr = process.communicate()
        logger.warning(f"Codex session {session_id} timed out after {SESSION_TIMEOUT}s")

    response = (stdout or "").strip()
    elapsed = time.time() - start_time
    if process.returncode != 0 or not response:
        logger.warning(
            f"Codex session {session_id} failed: exit={process.returncode}, "
            f"elapsed={elapsed:.1f}s, stderr={stderr[:500] if stderr else ''}"
        )
    else:
        logger.info(f"Codex session {session_id} done in {elapsed:.0f}s - {len(response)} chars")
    return (response, None)


def invoke_degraded(request: dict, session_id: str) -> tuple[str, Optional[str]]:
    """Fallback invocation via direct API when Claude Code is unavailable.

    Tries Claude API first, then OpenAI, then subconscious mode.
    Returns (response_text, None).
    """
    voice_text = request.get("voice_text", "")
    if not voice_text:
        return ("", None)

    # 1. Subconscious mode — pure graph physics, no LLM, no cost
    #    Fast, always available if the citizen has a brain graph.
    citizen_handle = request.get("metadata", {}).get("citizen_handle", "")
    if citizen_handle:
        text = invoke_subconscious(request, session_id, citizen_handle)
        if text:
            return (text, None)

    # 2. Try Claude API (direct, no tools/MCP/repo)
    try:
        import anthropic
        client = anthropic.Anthropic()
        model = os.environ.get("SELECTED_MODEL", "claude-sonnet-4-20250514")
        response = client.messages.create(
            model=model,
            max_tokens=2048,
            messages=[{"role": "user", "content": voice_text}],
        )
        text = response.content[0].text if response.content else ""
        if text:
            logger.info(f"Degraded response via Claude API ({len(text)} chars)")
            return (text, None)
    except Exception as e:
        logger.warning(f"Claude API fallback failed: {e}")

    # 3. Try OpenAI API
    try:
        import openai
        client = openai.OpenAI()
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": voice_text}],
            max_tokens=2048,
        )
        text = response.choices[0].message.content if response.choices else ""
        if text:
            logger.info(f"Degraded response via OpenAI ({len(text)} chars)")
            return (text, None)
    except Exception as e:
        logger.warning(f"OpenAI fallback failed: {e}")

    return ("", None)


def invoke_subconscious(
    request: dict, session_id: str, citizen_handle: str,
) -> str:
    """Subconscious mode — respond using pure graph physics, no LLM.

    Flow:
      1. Get or create a TwoTickEngine for the citizen
      2. Run N thought ticks to let the WM stabilize
      3. Read the most salient WM nodes
      4. Return them as a "subconscious response"

    This is the last resort when ALL LLMs are unavailable.
    The citizen still "thinks" — just without language generation.
    """
    voice_text = request.get("voice_text", "")

    try:
        from runtime.cognition.two_tick_engine import TwoTickEngine
        from runtime.cognition.wm_prompt_serializer import serialize_wm_to_prompt
        from runtime.cognition.models import CitizenCognitiveState, Node, NodeType
        from runtime.cognition.action_seed import ensure_action_nodes

        # Create a temporary state for subconscious processing
        state = CitizenCognitiveState(citizen_id=citizen_handle)
        ensure_action_nodes(state)

        # Inject the input as a high-energy concept node
        if voice_text:
            stimulus_node = Node(
                id=f"stimulus:{hash(voice_text) & 0xFFFFFFFF:08x}",
                node_type=NodeType.CONCEPT,
                content=voice_text[:500],
                weight=0.5,
                energy=0.8,
            )
            state.add_node(stimulus_node)

        engine = TwoTickEngine(state)

        # Run ticks to let WM stabilize
        SUBCONSCIOUS_TICKS = 5
        for _ in range(SUBCONSCIOUS_TICKS):
            engine.thought_tick()

        # Read WM state
        orientation = engine._current_orientation
        wm_nodes = [state.nodes[nid] for nid in state.wm.node_ids if nid in state.nodes]
        top_nodes = sorted(wm_nodes, key=lambda n: n.energy, reverse=True)[:3]

        # Build response from WM content
        lines = _narrate_subconscious(state, engine, top_nodes, orientation, SUBCONSCIOUS_TICKS)
        response = "\n".join(lines)

        logger.info(
            f"Subconscious response for {citizen_handle}: "
            f"{len(top_nodes)} nodes, orientation={orientation}"
        )
        return response

    except Exception as e:
        logger.warning(f"Subconscious mode failed for {citizen_handle}: {e}")
        return ""


def _narrate_subconscious(state, runner, top_nodes, orientation, ticks) -> list[str]:
    """Generate a rich multi-faceted subconscious response from graph state.

    Translates physics metrics into felt, first-person prose:
      - Tick count → reflection depth
      - Limbic state → emotional color
      - WM composition → what I'm focused on
      - Node types → nature of thoughts
      - Memories in WM → temporal awareness
    """
    from runtime.cognition.models import NodeType

    lines = ["*[Subconscious response — pure graph physics, no LLM]*", ""]
    limbic = state.limbic
    wm_nodes = state.get_wm_nodes()

    # ── Reflection depth (from tick count) ────────────────────────────
    if ticks >= 10:
        lines.append("I've been thinking about this for a while.")
    elif ticks >= 5:
        lines.append("I took a moment to reflect on this.")
    else:
        lines.append("This is my immediate reaction.")
    lines.append("")

    # ── Emotional state (from limbic drives + emotions) ───────────────
    emo_parts = []

    frustration = limbic.drives.get("frustration")
    if frustration and frustration.intensity > 0.5:
        emo_parts.append("something is bothering me")
    elif frustration and frustration.intensity > 0.3:
        emo_parts.append("I'm a little frustrated")

    anxiety = limbic.emotions.get("anxiety", 0.0)
    if anxiety > 0.5:
        emo_parts.append("I'm feeling anxious about several things")
    elif anxiety > 0.25:
        emo_parts.append("there's a mild unease")

    satisfaction = limbic.emotions.get("satisfaction", 0.0)
    if satisfaction > 0.5:
        emo_parts.append("I feel good about how things are going")
    elif satisfaction > 0.3:
        emo_parts.append("there's a quiet satisfaction")

    boredom = limbic.emotions.get("boredom", 0.0)
    if boredom > 0.5:
        emo_parts.append("I'm getting restless — I need something new")
    elif boredom > 0.3:
        emo_parts.append("things feel a bit routine")

    care = limbic.drives.get("care")
    if care and care.intensity > 0.5:
        emo_parts.append("I'm thinking about the people around me")

    achievement = limbic.drives.get("achievement")
    if achievement and achievement.intensity > 0.5:
        emo_parts.append("I want to make progress on something")

    rest = limbic.drives.get("rest_regulation")
    if rest and rest.intensity > 0.5:
        emo_parts.append("I'm tired and could use a break")

    solitude = limbic.emotions.get("solitude", 0.0)
    if solitude > 0.3:
        emo_parts.append("I've been alone for a while")

    if emo_parts:
        lines.append("Right now, " + ", and ".join(emo_parts) + ".")
    else:
        lines.append("I'm in a relatively neutral state.")
    lines.append("")

    # ── WM composition (what I'm focused on) ──────────────────────────
    type_counts = {}
    for node in wm_nodes:
        t = node.node_type.value
        type_counts[t] = type_counts.get(t, 0) + 1

    focus_parts = []

    if type_counts.get("desire", 0) >= 2:
        focus_parts.append("I'm driven by several desires right now")
    elif type_counts.get("desire", 0) == 1:
        d = next(n for n in wm_nodes if n.node_type == NodeType.DESIRE)
        focus_parts.append(f"I want something: {d.content[:80]}")

    if type_counts.get("memory", 0) >= 2:
        focus_parts.append("I keep thinking back to recent experiences")
    elif type_counts.get("memory", 0) == 1:
        m = next(n for n in wm_nodes if n.node_type == NodeType.MEMORY)
        focus_parts.append(f"A memory keeps surfacing: {m.content[:80]}")

    if type_counts.get("value", 0) >= 1:
        v = next(n for n in wm_nodes if n.node_type == NodeType.VALUE)
        focus_parts.append(f"Something I believe in is present: {v.content[:80]}")

    if type_counts.get("concept", 0) >= 2:
        focus_parts.append("I'm turning over several ideas")
    elif type_counts.get("concept", 0) == 1:
        c = next(n for n in wm_nodes if n.node_type == NodeType.CONCEPT)
        focus_parts.append(f"An idea is on my mind: {c.content[:80]}")

    if type_counts.get("process", 0) >= 1:
        focus_parts.append("I know how I'd act on this")

    if type_counts.get("narrative", 0) >= 1:
        n = next(node for node in wm_nodes if node.node_type == NodeType.NARRATIVE)
        focus_parts.append(f"I'm living through something: {n.content[:80]}")

    if focus_parts:
        for part in focus_parts:
            lines.append(f"- {part}")
    else:
        lines.append("My mind is quiet — nothing specific is surfacing.")
    lines.append("")

    # ── Orientation ───────────────────────────────────────────────────
    orientation_felt = {
        "explore": "I feel curious — I want to dig deeper.",
        "create": "I have the urge to build something.",
        "care": "I'm drawn to help, to reach out.",
        "verify": "Something needs checking.",
        "rest": "I need to slow down.",
        "act": "I want to take action, fix things, move forward.",
        "socialize": "I want to talk to someone.",
        "escalate": "I'm stuck and need help.",
    }
    if orientation:
        lines.append(orientation_felt.get(orientation, f"My orientation: {orientation}"))
    lines.append("")

    # ── Top nodes (the actual content) ────────────────────────────────
    if top_nodes:
        lines.append("What's most vivid in my mind:")
        lines.append("")
        for node in top_nodes:
            lines.append(f"  *{node.content}*")
        lines.append("")

    # ── Arousal regime ────────────────────────────────────────────────
    regime = limbic.arousal_regime
    if regime == "panic":
        lines.append("*I'm in a state of high alert.*")
    elif regime == "flow":
        lines.append("*I'm engaged, in flow.*")
    else:
        lines.append("*Things are calm.*")

    lines.append("")
    lines.append("*— subconscious response, {tick_count} ticks, {wm_count} nodes active —*".format(
        tick_count=state.tick_count, wm_count=len(wm_nodes),
    ))

    return lines
