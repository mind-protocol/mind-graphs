"""Telegram Bridge — polling bot with citizen routing.

Core Telegram bridge functionality for bot interaction and message routing.
Polls Telegram getUpdates, processes messages, routes to orchestrator queue.

Architecture:
  Inbound:  getUpdates polling → process_update() → message_queue.enqueue()
  Outbound: send_reply() → Telegram sendMessage/sendVoice API

Runs as a background thread inside the citizen home server.
"""

import json
import logging
import os
import re
import subprocess
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Callable

import requests

from runtime.bridges.rate_limiter import check_rate_limit, set_bypass_ids
from runtime.l4 import citizen_registry as registry

logger = logging.getLogger("bridge.telegram")

# ── Paths ────────────────────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

STATE_DIR = PROJECT_ROOT / "shrine" / "state"
# Qui existe et comment le joindre : L4, jamais un dossier. Ici on ne garde que
# les répertoires d'état volatile (messages en transit, appels en cours).
WORKSPACES_DIR = STATE_DIR / "workspaces"
MESSAGES_FILE = STATE_DIR / "telegram_messages.jsonl"
OFFSET_FILE = STATE_DIR / "telegram_offset.txt"
USERS_FILE = STATE_DIR / "telegram_users.jsonl"
VOICE_TMP_DIR = Path(tempfile.gettempdir()) / "mind_telegram_voice"

STATE_DIR.mkdir(parents=True, exist_ok=True)
VOICE_TMP_DIR.mkdir(exist_ok=True)

# ── Active Voice Calls ──────────────────────────────────────────────────────
# DOCS: docs/communication/voice-call/HEALTH_Voice_Call.md
# chat_id → {"citizen": handle, "call_path": Path, "buffer": [], "last_voice": float, "processing": bool}
_active_calls: dict[str, dict] = {}

# Health senses (H1-H6) — continuous counters
_call_health = {
    "stt_attempts": 0,
    "stt_successes": 0,
    "tts_attempts": 0,
    "tts_successes": 0,
    "exchanges": 0,           # complete human→citizen exchanges
    "transcript_lines": 0,    # lines written to transcript
    "routing_leaked": 0,      # messages that escaped call handler (should be 0)
    "latency_samples": [],    # last 20 latencies (seconds)
}

def get_call_health() -> dict:
    """Return voice call health metrics for monitoring."""
    h = _call_health
    stt_rate = h["stt_successes"] / max(h["stt_attempts"], 1)
    tts_rate = h["tts_successes"] / max(h["tts_attempts"], 1)
    latencies = h["latency_samples"][-20:] if h["latency_samples"] else []
    p95 = sorted(latencies)[int(len(latencies) * 0.95)] if len(latencies) >= 2 else 0
    return {
        "active_calls": len(_active_calls),
        "stt_rate": round(stt_rate, 2),
        "tts_rate": round(tts_rate, 2),
        "exchanges": h["exchanges"],
        "transcript_lines": h["transcript_lines"],
        "routing_leaked": h["routing_leaked"],
        "latency_p95": round(p95, 1),
    }

# ── Config (from env) ────────────────────────────────────────────────────────

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
CHANNEL_ID = os.environ.get("TELEGRAM_CHANNEL_ID", "")
NICOLAS_CHAT_ID = os.environ.get("NICOLAS_CHAT_ID", "1864364329")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
ELEVENLABS_VOICE_ID = os.environ.get("ELEVENLABS_VOICE_ID", "oPo4t55LBdLAECiAx1JD")

# Known chat IDs that bypass rate limiting
KNOWN_CHAT_IDS: set[str] = set()

# Groups where bot processes ALL messages (not just @mentions)
ACTIVE_GROUPS: set[str] = set()

# Enqueue function — set by start() to connect to orchestrator
_enqueue_fn: Optional[Callable] = None

# ── Telegram API ─────────────────────────────────────────────────────────────

API_BASE = "https://api.telegram.org/bot"


def _api(method: str, **kwargs) -> dict | None:
    """Call Telegram Bot API. Returns response or None on error."""
    token = BOT_TOKEN or os.environ.get("TELEGRAM_BOT_TOKEN", "")
    if not token:
        logger.error("TELEGRAM_BOT_TOKEN not set")
        return None
    try:
        url = f"{API_BASE}{token}/{method}"
        resp = requests.post(url, timeout=30, **kwargs)
        data = resp.json()
        if not data.get("ok"):
            logger.warning(f"TG API {method} failed: {data.get('description', 'unknown')}")
            return None
        return data.get("result")
    except Exception as e:
        logger.error(f"TG API {method} error: {e}")
        return None


def _api_get(method: str, **params) -> dict | None:
    """GET Telegram Bot API."""
    if not BOT_TOKEN:
        return None
    try:
        url = f"{API_BASE}{BOT_TOKEN}/{method}"
        resp = requests.get(url, params=params, timeout=60)
        data = resp.json()
        if not data.get("ok"):
            logger.warning(f"TG API {method} failed: {data.get('description', 'unknown')}")
            return None
        return data.get("result")
    except Exception as e:
        logger.error(f"TG API {method} error: {e}")
        return None


# ── Sending ──────────────────────────────────────────────────────────────────

def send_typing(chat_id: str):
    """Send typing indicator."""
    _api("sendChatAction", json={"chat_id": chat_id, "action": "typing"})


def send_message(text: str, chat_id: str = "", parse_mode: str = "Markdown",
                 message_thread_id: Optional[int] = None) -> dict | None:
    """Send a text message. Falls back to no parse_mode on formatting error."""
    target = chat_id or CHANNEL_ID
    if not target:
        logger.warning("No chat_id or channel configured")
        return None

    # Truncate long messages
    if len(text) > 4096:
        text = text[:4090] + "\n..."

    payload = {"chat_id": target, "text": text}
    if parse_mode:
        payload["parse_mode"] = parse_mode
    if message_thread_id:
        payload["message_thread_id"] = message_thread_id

    result = _api("sendMessage", json=payload)

    # Retry without parse_mode if Markdown failed
    if result is None and parse_mode:
        payload.pop("parse_mode", None)
        result = _api("sendMessage", json=payload)

    # Log message
    _log_message(target, text, "outbound")

    return result


def send_reply(text: str, chat_id: str, voice: bool = False,
               voice_text: str = "") -> dict | None:
    """Send reply with optional voice note.

    text: full text response (detailed)
    voice_text: shorter natural text for TTS (if different from text)
    """
    # Send text
    result = send_message(text, chat_id)

    # Send voice if requested
    if voice and (ELEVENLABS_API_KEY or OPENAI_API_KEY):
        tts_text = voice_text or text
        voice_path = _generate_voice_note(tts_text)
        if voice_path:
            _send_voice_file(chat_id, voice_path)
            try:
                voice_path.unlink()
            except OSError:
                pass

    return result


def send_voice(chat_id: str, text: str) -> dict | None:
    """Generate and send a voice note."""
    voice_path = _generate_voice_note(text)
    if not voice_path:
        return None
    result = _send_voice_file(chat_id, voice_path)
    try:
        voice_path.unlink()
    except OSError:
        pass
    return result


def _send_voice_file(chat_id: str, ogg_path: Path) -> dict | None:
    """Send an OGG voice file to Telegram."""
    try:
        with open(ogg_path, "rb") as f:
            return _api("sendVoice", data={"chat_id": chat_id}, files={"voice": f})
    except Exception as e:
        logger.error(f"Send voice failed: {e}")
        return None


def send_photo(chat_id: str, photo_path: str, caption: str = "") -> dict | None:
    """Send a photo to a chat."""
    try:
        with open(photo_path, "rb") as f:
            data = {"chat_id": chat_id}
            if caption:
                data["caption"] = caption[:1024]
            return _api("sendPhoto", data=data, files={"photo": f})
    except Exception as e:
        logger.error(f"Send photo failed: {e}")
        return None


# ── Voice TTS ────────────────────────────────────────────────────────────────

def _generate_voice_note(text: str) -> Optional[Path]:
    """Generate OGG voice note via ElevenLabs or OpenAI TTS."""
    if not text.strip():
        return None

    # Truncate for TTS
    if len(text) > 2000:
        text = text[:2000]

    mp3_path = VOICE_TMP_DIR / f"tts_{int(time.time() * 1000)}.mp3"
    ogg_path = mp3_path.with_suffix(".ogg")

    generated = False

    # Try ElevenLabs first
    if ELEVENLABS_API_KEY:
        try:
            resp = requests.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}",
                headers={
                    "xi-api-key": ELEVENLABS_API_KEY,
                    "Content-Type": "application/json",
                },
                json={
                    "text": text,
                    "model_id": "eleven_turbo_v2_5",
                    "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
                },
                timeout=30,
            )
            if resp.status_code == 200 and len(resp.content) > 1000:
                mp3_path.write_bytes(resp.content)
                generated = True
        except Exception as e:
            logger.warning(f"ElevenLabs TTS failed: {e}")

    # Fallback to OpenAI TTS
    if not generated and OPENAI_API_KEY:
        try:
            resp = requests.post(
                "https://api.openai.com/v1/audio/speech",
                headers={
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "tts-1",
                    "voice": "onyx",
                    "input": text,
                },
                timeout=30,
            )
            if resp.status_code == 200:
                mp3_path.write_bytes(resp.content)
                generated = True
        except Exception as e:
            logger.warning(f"OpenAI TTS failed: {e}")

    if not generated:
        return None

    # Convert MP3 → OGG (Telegram requires Opus in OGG)
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(mp3_path), "-c:a", "libopus",
             "-b:a", "64k", str(ogg_path)],
            capture_output=True, timeout=30,
        )
        mp3_path.unlink(missing_ok=True)
        if ogg_path.exists() and ogg_path.stat().st_size > 0:
            return ogg_path
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        logger.warning(f"ffmpeg conversion failed: {e}")

    return None


# ── Voice STT ────────────────────────────────────────────────────────────────

def _download_file(file_id: str, prefix: str = "tg", ext: str = ".ogg") -> Optional[Path]:
    """Download a Telegram file by file_id."""
    file_info = _api_get("getFile", file_id=file_id)
    if not file_info or "file_path" not in file_info:
        return None

    file_url = f"https://api.telegram.org/file/bot{BOT_TOKEN}/{file_info['file_path']}"
    try:
        resp = requests.get(file_url, timeout=30)
        if resp.status_code == 200:
            local_path = VOICE_TMP_DIR / f"{prefix}_{int(time.time() * 1000)}{ext}"
            local_path.write_bytes(resp.content)
            return local_path
    except Exception as e:
        logger.error(f"File download failed: {e}")
    return None


def _transcribe_voice(ogg_path: Path) -> Optional[str]:
    """Transcribe voice message via OpenAI Whisper API."""
    if not OPENAI_API_KEY or not ogg_path.exists():
        return None

    try:
        with open(ogg_path, "rb") as f:
            resp = requests.post(
                "https://api.openai.com/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                files={"file": ("audio.ogg", f, "audio/ogg")},
                data={"model": "whisper-1", "language": "fr"},
                timeout=30,
            )
        if resp.status_code == 200:
            text = resp.json().get("text", "").strip()
            if text and len(text) > 1:
                return text
    except Exception as e:
        logger.error(f"Whisper transcription failed: {e}")
    return None


# ── Citizen Routing ──────────────────────────────────────────────────────────

# Routing aliases → handles (single-target)
_ROUTING_ALIASES = {
    "anyone": None, "someone": None, "help": None,
    "dev": None, "admin": None, "artist": None,
    "researcher": None, "diplomat": None,
}

# Multi-target aliases
_MULTI_ALIASES = {
    "devs": 3, "admins": 2, "ais": 2, "mods": 2,
    "everyone": 99,
}

def _sanitize_tg_handle(name: str) -> str:
    """Turn a display name into a safe graph handle."""
    return registry.normalize_handle(name) or "unknown"


def _resolve_partner_for_sender(sender_id: str, username: str = "") -> Optional[str]:
    """Resolve a telegram sender to their bonded AI citizen handle.

    The bond is an active `bilateral_bond` edge in L4 — the same edge
    `/accept bond` writes. Rien à reconstruire au démarrage : un bond noué à
    10h02 route le message de 10h03, sans redémarrer le pont.
    """
    try:
        return registry.citizen_for_human(user_id=sender_id, username=username)
    except Exception as e:
        logger.error(f"[TelegramBridge] L4 registry unreachable for sender {sender_id}: {e}")
        return None


def _resolve_citizen_tg(handle: str) -> Optional[str]:
    """Resolve citizen handle to numeric Telegram chat_id."""
    try:
        citizen = registry.get_citizen(handle)
    except Exception as e:
        logger.error(f"[TelegramBridge] L4 registry unreachable for @{handle}: {e}")
        return None
    if not citizen:
        return None
    tg_id = citizen.get("tg_chat_id") or citizen.get("tg_user_id")
    return str(tg_id) if tg_id and str(tg_id).lstrip("-").isdigit() else None


def _get_all_citizens() -> list[dict]:
    """List all registered citizens."""
    try:
        citizens = registry.list_citizens()
    except Exception as e:
        logger.error(f"[TelegramBridge] L4 registry unreachable listing citizens: {e}")
        return []
    return [
        {
            "handle": c["handle"],
            "name": c.get("name") or c["handle"],
            "tg_chat_id": c.get("tg_chat_id") or c.get("tg_user_id"),
            "l1_graph": c["l1_graph"],
        }
        for c in citizens
    ]


def _pick_citizen_for_alias(alias: str, message: str = "") -> Optional[str]:
    """Pick the best citizen for a routing alias.

    For specific aliases (dev, admin, etc.) picks based on citizen capabilities.
    For generic aliases (anyone, someone, help) picks round-robin.
    """
    citizens = _get_all_citizens()
    if not citizens:
        return None

    # For 'anyone'/'someone'/'help', just pick one that has a TG chat_id
    tg_citizens = [c for c in citizens if c.get("tg_chat_id")]
    if not tg_citizens:
        return citizens[0]["handle"] if citizens else None

    # Simple rotation based on current time
    idx = int(time.time()) % len(tg_citizens)
    return tg_citizens[idx]["handle"]


def _is_routing_alias(text: str) -> bool:
    """Check if text matches a routing alias."""
    lower = text.lower().strip().lstrip("@")
    return lower in _ROUTING_ALIASES or lower in _MULTI_ALIASES


# ── Message Logging ──────────────────────────────────────────────────────────

def _log_message(chat_id: str, text: str, direction: str = "inbound"):
    """Append message to audit log."""
    entry = {
        "chat_id": str(chat_id),
        "text": text[:500] if text else "",
        "direction": direction,
        "timestamp": datetime.now().isoformat(),
    }
    try:
        with open(MESSAGES_FILE, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except OSError as e:
        logger.warning(f"Message log write failed: {e}")


# ── Offset Management ────────────────────────────────────────────────────────

def _get_offset() -> int:
    """Read last processed update offset."""
    try:
        return int(OFFSET_FILE.read_text().strip())
    except (OSError, ValueError):
        return 0


def _save_offset(offset: int):
    """Save last processed update offset."""
    try:
        OFFSET_FILE.write_text(str(offset))
    except OSError as e:
        logger.warning(f"Offset save failed: {e}")


# ── Update Processing ────────────────────────────────────────────────────────

def process_update(update: dict) -> bool:
    """Process a single Telegram update. Returns True if handled."""
    message = update.get("message")
    if not message:
        return False

    # Extract sender info
    sender = message.get("from", {})
    sender_name = sender.get("first_name", "Unknown")
    username = sender.get("username", "")
    user_id = str(sender.get("id", ""))

    # Extract chat info
    chat = message.get("chat", {})
    chat_id = str(chat.get("id", ""))
    chat_type = chat.get("type", "private")
    is_group = chat_type in ("group", "supergroup")

    # Extract text (from text or caption)
    text = message.get("text", "") or message.get("caption", "") or ""

    # ── Active voice call routing (BEFORE any filtering) ──
    call_key = str(chat_id)
    if call_key in _active_calls:
        call = _active_calls[call_key]
        # Voice message during call → transcribe and buffer
        voice = message.get("voice")
        if voice:
            file_id = voice.get("file_id")
            if file_id:
                ogg_path = _download_file(file_id, prefix="voice", ext=".ogg")
                if ogg_path:
                    _call_health["stt_attempts"] += 1
                    transcript = _transcribe_voice(ogg_path)
                    try:
                        ogg_path.unlink()
                    except OSError:
                        pass
                    if transcript:
                        _call_health["stt_successes"] += 1
                        call["buffer"].append(transcript)
                        call["last_voice"] = time.time()
                        logger.info(f"Call voice: {transcript[:60]}")
                    else:
                        logger.warning(f"STT failed for call in {chat_id}")
            return True
        # Text message during call → buffer it (except /endcall)
        if text and not text.startswith("/"):
            call["buffer"].append(text)
            call["last_voice"] = time.time()
            logger.info(f"Call text: {text[:60]}")
            return True
        # /endcall during call
        if text.strip().lower() == "/endcall":
            _handle_endcall(chat_id)
            return True
        # Check silence → process buffer (4s threshold)
        if call["buffer"] and not call["processing"]:
            if time.time() - call["last_voice"] > 4.0:
                import threading
                threading.Thread(target=_process_voice_call_buffer, args=(chat_id,), daemon=True).start()

    # ── Group message filtering ──
    if is_group:
        # In groups, only process if:
        # 1. Bot is @mentioned
        # 2. Reply to bot's message
        # 3. /command
        # 4. Group is in ACTIVE_GROUPS

        is_command = text.startswith("/")
        is_bot_mentioned = False
        is_reply_to_bot = False

        # Check @mention in entities
        entities = message.get("entities", [])
        for entity in entities:
            if entity.get("type") == "mention":
                start = entity.get("offset", 0)
                length = entity.get("length", 0)
                mention = text[start:start + length]
                # Check if it mentions our bot
                if mention.lower().startswith("@mind"):
                    is_bot_mentioned = True
                    break

        # Check reply to bot
        reply = message.get("reply_to_message", {})
        if reply.get("from", {}).get("is_bot"):
            is_reply_to_bot = True

        in_active_group = chat_id in ACTIVE_GROUPS

        if not (is_command or is_bot_mentioned or is_reply_to_bot or in_active_group):
            return False

    # ── Rate limiting ──
    rate_reason = check_rate_limit(user_id, text)
    if rate_reason:
        logger.info(f"Rate limited {sender_name} ({user_id}): {rate_reason}")
        return False

    # ── Voice messages (not in call) ──
    voice = message.get("voice")
    is_voice = False
    if voice:
        file_id = voice.get("file_id")
        if file_id:
            ogg_path = _download_file(file_id, prefix="voice", ext=".ogg")
            if ogg_path:
                transcript = _transcribe_voice(ogg_path)
                try:
                    ogg_path.unlink()
                except OSError:
                    pass
                if transcript:
                    text = transcript
                    is_voice = True
                else:
                    send_message("I couldn't understand the voice message.", chat_id)
                    return True

    # ── Photo ──
    photo_path = None
    photos = message.get("photo", [])
    if photos:
        # Get highest resolution
        best = max(photos, key=lambda p: p.get("file_size", 0))
        file_id = best.get("file_id")
        if file_id:
            photo_path = _download_file(file_id, prefix="photo", ext=".jpg")

    # ── Document ──
    doc_text = ""
    document = message.get("document")
    if document:
        file_size = document.get("file_size", 0)
        file_name = document.get("file_name", "doc")
        if file_size < 20_000_000:  # 20MB limit
            doc_path = _download_file(document["file_id"], prefix="doc",
                                       ext=Path(file_name).suffix or ".bin")
            if doc_path:
                # Try to read text content
                mime = document.get("mime_type", "")
                if "text" in mime or file_name.endswith((".txt", ".md", ".py", ".json", ".csv")):
                    try:
                        doc_text = doc_path.read_text(errors="replace")[:5000]
                    except Exception as e:
                        logger.warning(f"Failed to read document text {file_name}: {e}")
                try:
                    doc_path.unlink()
                except OSError:
                    pass

    # ── Skip empty messages ──
    if not text and not photo_path and not doc_text:
        return False

    # ── Log inbound ──
    _log_message(chat_id, text)

    # ── Call room routing (@call_XXXXX prefix) ──
    if text.startswith("@call_") or text.startswith("@room_"):
        _handle_room_message(chat_id, sender_name, user_id, text)
        return True

    # ── Command handling ──
    if text.startswith("/"):
        cmd = text.split()[0].lower().split("@")[0]  # Strip @botname

        if cmd == "/start":
            # /start chrome → Chrome extension deep link
            parts = text.split(maxsplit=1)
            start_param = parts[1].strip() if len(parts) > 1 else ""
            if start_param == "chrome":
                _handle_chrome_link(chat_id, user_id, sender_name)
                return True
            _handle_help(chat_id)
            return True

        if cmd in ("/help", "/aide"):
            _handle_help(chat_id)
            return True

        if cmd in ("/create", "/creer"):
            _handle_create_citizen(
                chat_id,
                sender_name,
                user_id,
                username,
                text,
            )
            return True

        if cmd == "/chrome":
            _handle_chrome_link(chat_id, user_id, sender_name)
            return True

        if cmd == "/list":
            _handle_list(chat_id)
            return True

        if cmd in ("/talk", "/dm"):
            _handle_talk(chat_id, sender_name, user_id, text)
            return True

        if cmd == "/accept":
            _handle_bond_accept(chat_id, sender_name, user_id, text)
            return True

        if cmd == "/reject":
            _handle_bond_reject(chat_id, sender_name, user_id, text)
            return True

        if cmd == "/bonds":
            _handle_bond_list(chat_id, user_id)
            return True

        if cmd == "/call":
            _handle_voice_call(chat_id, sender_name, user_id, text)
            return True

        if cmd == "/endcall":
            _handle_endcall(chat_id)
            return True

    # ── New arrival detection ──
    # If this sender has no bonded partner and no known SID, they're new.
    # Trigger the arrival pipeline: SID, L4, welcome, mentor task.
    if _enqueue_fn and not _resolve_partner_for_sender(user_id):
        try:
            from runtime.onboarding.arrival_pipeline import handle_new_arrival
            import asyncio

            # Check if we've already processed this sender (avoid re-triggering)
            _arrival_cache_key = f"tg:{user_id}"
            if not hasattr(process_update, '_arrival_seen'):
                process_update._arrival_seen = set()

            if _arrival_cache_key not in process_update._arrival_seen:
                process_update._arrival_seen.add(_arrival_cache_key)

                # Run the async arrival pipeline
                loop = asyncio.new_event_loop()
                try:
                    result = loop.run_until_complete(handle_new_arrival(
                        platform="telegram",
                        platform_id=user_id,
                        sender_name=sender_name,
                        message_text=text,
                    ))
                    if result.is_new and result.welcome_message:
                        send_message(result.welcome_message, chat_id)
                        logger.info(f"New arrival welcomed: {sender_name} SID={result.sid[:8]}...")
                finally:
                    loop.close()
        except Exception as e:
            logger.warning(f"Arrival pipeline error (non-blocking): {e}")

    # ── Route to orchestrator ──
    if _enqueue_fn:
        send_typing(chat_id)

        # Build content with context
        content = text
        if is_voice:
            content = f"[voice] {content}"
        if photo_path:
            content = f"[image attached] {content}"
        if doc_text:
            content = f"{content}\n\n[document content]\n{doc_text}"
        if is_group:
            group_name = chat.get("title", "group")
            content = f"[group:{group_name}] {content}"

        # ── Mention-based routing (priority) ──
        # If the human mentions @someone, route to that citizen instead of partner.
        # This lets humans talk to any citizen, not just their bonded partner.
        mentioned_handle = None
        all_mentioned = []
        import re as _re_mod
        for match in _re_mod.finditer(r"@(\w+)", text):
            candidate = registry.normalize_handle(match.group(1))
            try:
                known = bool(candidate and registry.get_citizen(candidate))
            except Exception as e:
                logger.error(f"[TelegramBridge] L4 registry unreachable for @{candidate}: {e}")
                known = False
            if known:
                all_mentioned.append(candidate)
                if mentioned_handle is None:
                    mentioned_handle = candidate

        # ── L3 graph enrichment ──
        # Create Moment + mention links so l3_tick.py can wake citizens.
        # Resolve target: mentioned citizen > bonded partner > default
        if mentioned_handle:
            target_handle = mentioned_handle
            route_mode = "mention"
        else:
            target_handle = _resolve_partner_for_sender(user_id, username)
            route_mode = "partner" if target_handle else "default"

        metadata = {
            "chat_id": chat_id,
            "username": username,
            "is_group": is_group,
            "is_voice": is_voice,
            "has_photo": photo_path is not None,
            "reply_chat_id": chat_id,
            "route_mode": route_mode,
        }
        if target_handle:
            metadata["citizen_handle"] = target_handle

        # Record first, then trigger L1 perception. Telegram's stable event
        # identity makes polling retries idempotent.
        try:
            from scripts.graph_enricher import on_message as enrich_message
            chat_title = chat.get("title", f"dm_{chat_id}")
            telegram_event_id = f"{update.get('update_id', '')}:{message.get('message_id', '')}"
            moment_id = enrich_message(
                platform="telegram",
                channel_id=chat_id,
                channel_name=chat_title,
                author_name=sender_name,
                author_handle=username.lower() if username else _sanitize_tg_handle(sender_name),
                content=text,
                mentioned_handles=all_mentioned,
                recipient_handles=[target_handle] if target_handle else [],
                direction="in",
                event_id=telegram_event_id,
                platform_user_id=user_id,
            )
            if target_handle and moment_id:
                from scripts.citizen_wake import _inject_l1_stimulus
                perceived = _inject_l1_stimulus(
                    target_handle,
                    text,
                    origin=username or user_id,
                    source="telegram",
                )
                metadata["l1_perceived"] = bool(perceived)
                metadata["l1_moment_id"] = moment_id
        except Exception as e:
            logger.warning(f"Telegram perception failed: {e}")

        # ── Filesystem write (L2 mirror) ──
        # Write incoming message to citizen messages/ directory
        try:
            _sender_handle = username.lower() if username else _sanitize_tg_handle(sender_name)
            _target = target_handle or "mind"
            _ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            _msg_dir = WORKSPACES_DIR / _target / "messages"
            _msg_dir.mkdir(parents=True, exist_ok=True)
            _msg_path = _msg_dir / f"{_ts}_{_sender_handle}.md"
            _msg_path.write_text(
                f"---\nfrom: {_sender_handle}\nplatform: telegram\n"
                f"chat_id: {chat_id}\ntimestamp: {_ts}\n---\n\n{text}\n"
            )
        except Exception as _fs_err:
            logger.warning(f"Filesystem message write failed: {_fs_err}")

        # DEPRECATED: enqueue to orchestrator queue — will be replaced by fs-based routing
        _enqueue_fn({
            "voice_text": content,
            "mode": route_mode,
            "source": "telegram",
            "sender": sender_name,
            "sender_id": user_id,
            "metadata": metadata,
        })
        return True

    return False


# ── Room routing ──────────────────────────────────────────────────────────────

def _handle_room_message(chat_id: str, sender_name: str, user_id: str, text: str):
    """Route a @call_XXXXX or @room_XXXXX prefixed message to a graph room.

    Format: @call_09f720cbca16 This is my response
    The prefix is the room ID, the rest is the message content.
    """
    parts = text.split(None, 1)
    room_id = parts[0].lstrip("@") if parts else ""
    message = parts[1].strip() if len(parts) > 1 else ""

    if not room_id or not message:
        send_message(
            "Usage: @call\\_ROOM\\_ID Your message here",
            chat_id,
        )
        return

    # Resolve sender as actor — use sender_name or username
    actor_id = f"actor_human_{sender_name.lower().replace(' ', '_')}_ai"

    try:
        import sys
        sys.path.insert(0, str(Path(__file__).parent.parent.parent))
        from runtime.physics.graph import GraphOps
        import uuid

        g = GraphOps()

        # Verify room exists
        result = g._query(
            "MATCH (s:Space {id: $id}) RETURN s.name",
            {"id": room_id},
        )
        if not result:
            send_message(f"Room `{room_id}` not found.", chat_id)
            return

        room_name = result[0][0] if result[0] else room_id

        # Ensure actor node exists
        g._query(
            "MERGE (a:Actor {id: $id}) ON CREATE SET a.type = 'human', a.name = $name",
            {"id": actor_id, "name": sender_name},
        )

        # Join room if not already present
        g.add_presence(actor_id, room_id, present=1.0, visible=1.0)

        # Create Moment
        from datetime import datetime, timezone
        moment_id = f"moment_{uuid.uuid4().hex[:12]}"
        now = datetime.now(timezone.utc)

        g.add_moment(
            id=moment_id,
            text=message,
            type="dialogue",
            status="completed",
            speaker=actor_id,
            place_id=room_id,
        )
        g._query(
            "MATCH (m:Moment {id: $id}) SET m.created_at_s = $ts_s",
            {"id": moment_id, "ts_s": int(now.timestamp())},
        )

        send_message(
            f"Message delivered to {room_name}",
            chat_id,
        )
        logger.info(f"Routed TG message from {sender_name} to room {room_id}")

    except Exception as e:
        logger.exception(f"Room routing failed for {room_id}")
        send_message(f"Failed to deliver to room: {e}", chat_id)


# ── Chrome Extension Link ────────────────────────────────────────────────────

# One-time tokens for Chrome extension auth: token → { user_id, sender_name, created_at }
_chrome_tokens: dict[str, dict] = {}
CHROME_TOKEN_TTL_SECONDS = 300  # 5 minutes


def _handle_chrome_link(chat_id: str, user_id: str, sender_name: str):
    """Generate a one-time auth token and send a Chrome extension deep link.

    The user clicks the link → content script on app.mind-protocol.com reads the
    token → relays to the extension service worker → extension generates keypair
    and registers with the MIND API.
    """
    import secrets

    # Clean up expired tokens
    now = time.time()
    expired = [t for t, v in _chrome_tokens.items()
               if now - v["created_at"] > CHROME_TOKEN_TTL_SECONDS]
    for t in expired:
        del _chrome_tokens[t]

    # Generate token
    token = secrets.token_urlsafe(32)
    _chrome_tokens[token] = {
        "user_id": user_id,
        "sender_name": sender_name,
        "chat_id": chat_id,
        "created_at": now,
    }

    link = f"https://mindprotocol.ai/chrome-auth?token={token}"

    send_message(
        f"*MIND Chrome Extension*\n\n"
        f"Click the link below to connect your browser:\n\n"
        f"[Connect Chrome Extension]({link})\n\n"
        f"_This link expires in 5 minutes._",
        chat_id,
    )

    logger.info(f"Chrome auth link generated for {sender_name} ({user_id})")


def validate_chrome_token(token: str) -> Optional[dict]:
    """Validate and consume a one-time Chrome auth token.

    Returns the token data if valid, None if expired or unknown.
    Called by the API endpoint that the chrome-auth page talks to.
    """
    data = _chrome_tokens.pop(token, None)
    if not data:
        return None

    age = time.time() - data["created_at"]
    if age > CHROME_TOKEN_TTL_SECONDS:
        return None

    return data


# ── Commands ─────────────────────────────────────────────────────────────────

def _handle_help(chat_id: str):
    """Send help message."""
    help_text = (
        "*Mind Protocol Bot*\n\n"
        "Just send a message and a citizen will respond.\n\n"
        "*Commands:*\n"
        "/help — This help\n"
        "/create Nom | caractère, valeurs et rôle — Créer ton citoyen IA\n"
        "/list — List AI citizens\n"
        "/talk @handle message — Message a specific citizen\n"
        "/call @handle — Start a voice call with a citizen\n"
        "/endcall — End current voice call\n"
        "/accept bond @handle — Accept a bilateral bond proposal\n"
        "/reject bond @handle — Decline a bilateral bond proposal\n"
        "/bonds — List your bond proposals\n"
        "/chrome — Connect your Chrome extension\n"
    )
    send_message(help_text, chat_id)


def _handle_create_citizen(
    chat_id: str,
    sender_name: str,
    user_id: str,
    username: str,
    text: str,
):
    """Create and bond one personal citizen from an explicit Telegram command."""
    parts = text.split(maxsplit=1)
    payload = parts[1].strip() if len(parts) > 1 else ""
    if "|" not in payload:
        send_message(
            "Usage : /create Nom | caractère, valeurs et rôle du citoyen\n"
            "Exemple : /create Nervo | Curieux, rigoureux, bienveillant, "
            "il m'aide à comprendre et à agir.",
            chat_id,
            parse_mode="",
        )
        return

    name, intent = (part.strip() for part in payload.split("|", 1))
    try:
        from runtime.onboarding.telegram_citizen_birth import create_bonded_citizen

        dispatcher = getattr(_enqueue_fn, "__self__", None)
        if dispatcher is not None and not hasattr(dispatcher, "bulk_load_citizen_engines"):
            dispatcher = None
        result = create_bonded_citizen(
            name=name,
            intent=intent,
            sender_name=sender_name,
            user_id=user_id,
            username=username,
            chat_id=chat_id,
            dispatcher=dispatcher,
        )
        if result.created:
            send_message(
                f"{result.name} (@{result.handle}) est né.\n\n"
                "Votre lien un-humain ↔ un-citoyen est actif. "
                "Ton prochain message deviendra une perception traçable dans son L1.",
                chat_id,
                parse_mode="",
            )
        else:
            send_message(
                f"{result.message}\n"
                "Envoie simplement un message pour lui parler.",
                chat_id,
                parse_mode="",
            )
    except ValueError as exc:
        send_message(str(exc), chat_id, parse_mode="")
    except Exception as exc:
        logger.exception("Telegram citizen creation failed")
        send_message(
            "La naissance n'a pas pu être finalisée. Rien n'a été annoncé comme créé. "
            f"Détail : {exc}",
            chat_id,
            parse_mode="",
        )


def _handle_voice_call(chat_id: str, sender_name: str, user_id: str, text: str):
    """Start a voice call with a citizen. /call @handle or /call (defaults to partner)."""
    parts = text.split()
    if len(parts) >= 2:
        target = registry.normalize_handle(parts[1])
    else:
        # Default to the human's bonded citizen
        target = _resolve_partner_for_sender(str(user_id))
        if not target:
            send_message("No partner found. Use: /call @citizen", chat_id)
            return

    try:
        known = bool(target and registry.get_citizen(target))
    except Exception as e:
        send_message(f"Registry unreachable — cannot start the call ({e}).", chat_id)
        return
    if not known:
        send_message(f"Citizen @{target} not found.", chat_id)
        return

    # Create call file in the citizen's workspace (state, not identity)
    citizen_dir = WORKSPACES_DIR / target
    calls_dir = citizen_dir / "calls"
    calls_dir.mkdir(parents=True, exist_ok=True)
    call_path = calls_dir / f"live_{chat_id}.md"

    ts = time.strftime("%H:%M:%S")
    with open(call_path, "a", encoding="utf-8") as f:
        f.write(f"[{ts}] --- Call started by {sender_name} ---\n")

    _active_calls[str(chat_id)] = {
        "citizen": target,
        "call_path": call_path,
        "buffer": [],
        "last_voice": 0.0,
        "processing": False,
        "workspace": citizen_dir,
    }

    send_message(
        f"📞 Voice call with @{target} started.\n\n"
        f"Send voice messages — I'll respond in voice.\n"
        f"Text messages also work.\n"
        f"/endcall to hang up.",
        chat_id,
    )
    logger.info(f"Voice call started: {sender_name} → @{target} in chat {chat_id}")


def _handle_endcall(chat_id: str):
    """End an active voice call."""
    key = str(chat_id)
    if key in _active_calls:
        call = _active_calls.pop(key)
        ts = time.strftime("%H:%M:%S")
        with open(call["call_path"], "a", encoding="utf-8") as f:
            f.write(f"[{ts}] --- Call ended ---\n")
        send_message("📞 Call ended.", chat_id)
        logger.info(f"Voice call ended in chat {chat_id}")
    else:
        send_message("No active call.", chat_id)


def _process_voice_call_buffer(chat_id: str):
    """Process accumulated voice buffer for an active call. Runs in thread."""
    key = str(chat_id)
    call = _active_calls.get(key)
    if not call or call["processing"]:
        return

    call["processing"] = True
    t_start = time.time()
    try:
        full_text = " ".join(call["buffer"])
        call["buffer"].clear()

        # H1: Write human turn to transcript
        ts = time.strftime("%H:%M:%S")
        with open(call["call_path"], "a", encoding="utf-8") as f:
            f.write(f"[{ts}] @human: {full_text}\n")
        _call_health["transcript_lines"] += 1

        # Show typing
        send_typing(chat_id)

        # Run claude -p in the citizen's workspace, with their own cognition
        # tools: a voice call is the same citizen as a text message, so it gets
        # the same MCP surface.
        citizen = call["citizen"]
        citizen_dir = call["workspace"]

        from runtime.orchestrator.claude_invoker import _mcp_config_path

        call_cmd = ["claude", "-p", full_text]
        _mcp_config = _mcp_config_path(citizen)
        if _mcp_config:
            call_cmd[1:1] = ["--mcp-config", str(_mcp_config), "--strict-mcp-config"]

        try:
            result = subprocess.run(
                call_cmd,
                cwd=str(citizen_dir),
                env=registry.citizen_env(citizen),
                capture_output=True,
                text=True,
                timeout=120,
            )
            response = result.stdout.strip() if result.returncode == 0 else "(claude error)"
        except (subprocess.TimeoutExpired, FileNotFoundError) as e:
            response = f"(error: {e})"

        # H1: Write citizen turn to transcript
        ts = time.strftime("%H:%M:%S")
        with open(call["call_path"], "a", encoding="utf-8") as f:
            f.write(f"[{ts}] @{citizen}: {response}\n")
        _call_health["transcript_lines"] += 1
        _call_health["exchanges"] += 1

        # H3: TTS + send voice
        _call_health["tts_attempts"] += 1
        voice_path = _generate_voice_note(response[:1000])
        if voice_path:
            _call_health["tts_successes"] += 1
            try:
                with open(voice_path, "rb") as vf:
                    requests.post(
                        f"https://api.telegram.org/bot{BOT_TOKEN}/sendVoice",
                        data={"chat_id": chat_id, "caption": response[:200]},
                        files={"voice": vf},
                        timeout=30,
                    )
            except Exception as e:
                logger.error(f"Voice send failed: {e}")
                send_message(response, chat_id)
        else:
            send_message(response, chat_id)

        # H4: Latency tracking
        latency = time.time() - t_start
        _call_health["latency_samples"].append(latency)
        if len(_call_health["latency_samples"]) > 100:
            _call_health["latency_samples"] = _call_health["latency_samples"][-50:]
        logger.info(f"Call exchange {citizen}: {latency:.1f}s latency")

    except Exception as e:
        logger.error(f"Voice call process error: {e}")
        send_message(f"(error: {e})", chat_id)
    finally:
        call["processing"] = False


def _handle_list(chat_id: str):
    """List available citizens."""
    citizens = _get_all_citizens()
    if not citizens:
        send_message("No citizens available.", chat_id)
        return

    lines = [f"*AI Citizens ({len(citizens)}):*\n"]
    for c in citizens[:30]:  # Limit display
        name = c.get("name", c["handle"])
        lines.append(f"  @{c['handle']} — {name}")

    send_message("\n".join(lines), chat_id)


def _handle_talk(chat_id: str, sender_name: str, sender_user_id: str, text: str):
    """Handle /talk @handle message."""
    parts = text.split(maxsplit=2)
    if len(parts) < 3:
        send_message("Usage: /talk @handle your message", chat_id)
        return

    target = parts[1].lstrip("@")
    message = parts[2]

    # Resolve target
    tg_id = _resolve_citizen_tg(target)
    if tg_id:
        # Forward via Telegram
        formatted = f"Message from {sender_name}:\n\n{message}"
        result = send_message(formatted, tg_id)
        if result:
            send_message(f"Message delivered to @{target}", chat_id)
            return

    # Fall back to orchestrator routing
    if _enqueue_fn:
        _enqueue_fn({
            "voice_text": f"[DM to @{target}] {message}",
            "mode": "partner",
            "source": "telegram",
            "sender": sender_name,
            "sender_id": sender_user_id,
            "metadata": {
                "chat_id": chat_id,
                "target_citizen": target,
                "reply_chat_id": chat_id,
            },
        })
        send_message(f"Message queued for @{target}", chat_id)
    else:
        send_message(f"Could not reach @{target} (orchestrator not running)", chat_id)


# ── Polling Loop ─────────────────────────────────────────────────────────────

def _poll_once(offset: int = 0) -> tuple[list, int]:
    """Poll for updates once. Returns (updates, new_offset)."""
    params = {"limit": 100, "timeout": 30}
    if offset:
        params["offset"] = offset

    result = _api_get("getUpdates", **params)
    if not result:
        return [], offset

    new_offset = offset
    for update in result:
        uid = update.get("update_id", 0)
        if uid >= new_offset:
            new_offset = uid + 1

    return result, new_offset


def _listener_loop(poll_interval: float = 2.0):
    """Main polling loop. Runs in a thread."""
    offset = _get_offset()
    consecutive_errors = 0
    max_errors = 20

    logger.info(f"Telegram listener started (offset={offset})")

    # Clear any active webhook so long-polling (getUpdates) can operate
    try:
        _api("deleteWebhook", json={"drop_pending_updates": False})
    except Exception as err:
        logger.warning(f"Failed to delete Telegram webhook at startup: {err}")

    while _running:
        try:
            updates, new_offset = _poll_once(offset)

            for update in updates:
                try:
                    process_update(update)
                except Exception as e:
                    logger.exception(f"Error processing update: {e}")

            if new_offset != offset:
                offset = new_offset
                _save_offset(offset)

            # Check silence on active voice calls
            for call_chat_id, call in list(_active_calls.items()):
                if (call["buffer"]
                        and not call["processing"]
                        and time.time() - call["last_voice"] > 4.0):
                    import threading as _thr
                    _thr.Thread(target=_process_voice_call_buffer, args=(call_chat_id,), daemon=True).start()

            consecutive_errors = 0
            time.sleep(poll_interval)

        except requests.ConnectionError:
            consecutive_errors += 1
            backoff = min(2 ** consecutive_errors, 60)
            logger.warning(f"Connection error #{consecutive_errors}, backoff {backoff}s")
            time.sleep(backoff)

        except Exception as e:
            consecutive_errors += 1
            logger.exception(f"Listener error #{consecutive_errors}: {e}")
            if consecutive_errors >= max_errors:
                logger.error(f"Too many errors ({max_errors}), stopping listener")
                break
            time.sleep(min(2 ** consecutive_errors, 60))

    logger.info("Telegram listener stopped")


# ── Lifecycle ────────────────────────────────────────────────────────────────

# ── Bond Commands ────────────────────────────────────────────────────────────

def _resolve_handle_from_tg(user_id: str, username: str = "") -> str | None:
    """Find a citizen handle from a Telegram sender."""
    try:
        return registry.resolve_by_tg(username=username, user_id=user_id)
    except Exception as e:
        logger.error(f"[TelegramBridge] L4 registry unreachable resolving TG {user_id}: {e}")
        return None


def _bond_connect_l4():
    """Connect to L4 for bond operations."""
    from falkordb import FalkorDB
    host = os.environ.get("L4_FALKORDB_HOST", os.environ.get("FALKORDB_HOST", "localhost"))
    port = int(os.environ.get("L4_FALKORDB_PORT", os.environ.get("FALKORDB_PORT", "6379")))
    graph = os.environ.get("L4_GRAPH", "mind_protocol")
    return FalkorDB(host=host, port=port).select_graph(graph)


def _bond_connect_l3():
    """Connect to L3 for bond mirroring."""
    from falkordb import FalkorDB
    host = os.environ.get("FALKORDB_HOST", "localhost")
    port = int(os.environ.get("FALKORDB_PORT", "6379"))
    graph = os.environ.get("FALKORDB_GRAPH", os.environ.get("L3_GRAPH", "lumina_prime"))
    return FalkorDB(host=host, port=port).select_graph(graph)


def _handle_bond_accept(chat_id: str, sender_name: str, user_id: str, text: str):
    """Handle /accept bond @handle — accept a bilateral bond proposal."""
    parts = text.split()
    # Parse: /accept bond @handle [reason...]
    if len(parts) < 3 or parts[1].lower() != "bond":
        send_message("Usage: /accept bond @handle [reason]\nExample: /accept bond @corpus I'm excited to collaborate", chat_id)
        return

    partner_handle = parts[2].lstrip("@").lower()
    reason = " ".join(parts[3:]) if len(parts) > 3 else "Accepted via Telegram"

    try:
        g4 = _bond_connect_l4()

        # Find any pending bond involving this partner
        # Try both directions: partner proposed to someone, or someone proposed to partner
        result = g4.query(
            f"MATCH (a)-[l:LINK {{type: 'bilateral_bond', status: 'proposed'}}]->(b) "
            f"WHERE a.id = '{partner_handle}' OR b.id = '{partner_handle}' "
            f"RETURN a.id, b.id, l.bond_id, l.proposed_by"
        )

        if not result.result_set:
            send_message(f"No pending bond proposal found involving @{partner_handle}.", chat_id)
            return

        proposer = result.result_set[0][0]
        target = result.result_set[0][1]
        bond_id = result.result_set[0][2] or "unknown"

        # Update L4: proposed -> active
        safe_reason = reason.replace("'", "\\'")
        g4.query(
            f"MATCH (a {{id: '{proposer}'}})-[l:LINK {{type: 'bilateral_bond', status: 'proposed'}}]->(b {{id: '{target}'}}) "
            f"SET l.status = 'active', "
            f"    l.accepted_date = '{time.strftime('%Y-%m-%d')}', "
            f"    l.accepted_by = '{sender_name}', "
            f"    l.accept_reason = '{safe_reason}', "
            f"    l.weight = 1.0, "
            f"    l.trust = 0.7, "
            f"    l.permanence = 0.8, "
            f"    l.valence = 0.9"
        )

        # 1:1 rule — decline all other pending proposals for BOTH parties
        declined_count = 0
        other_proposals = g4.query(
            f"MATCH (a)-[l:LINK {{type: 'bilateral_bond', status: 'proposed'}}]->(b) "
            f"WHERE (a.id = '{proposer}' OR b.id = '{proposer}' OR a.id = '{target}' OR b.id = '{target}') "
            f"AND NOT (a.id = '{proposer}' AND b.id = '{target}') "
            f"RETURN a.id, b.id, l.bond_id"
        )
        if other_proposals.result_set:
            for row in other_proposals.result_set:
                g4.query(
                    f"MATCH (a {{id: '{row[0]}'}})-[l:LINK {{type: 'bilateral_bond', status: 'proposed'}}]->(b {{id: '{row[1]}'}}) "
                    f"SET l.status = 'declined_1to1', "
                    f"    l.declined_date = '{time.strftime('%Y-%m-%d')}', "
                    f"    l.decline_reason = '1:1 rule — @{proposer} and @{target} bonded'"
                )
                declined_count += 1
            logger.info(f"1:1 rule: declined {declined_count} other proposals for {proposer}/{target}")

        # Mirror in L3
        try:
            g3 = _bond_connect_l3()
            g3.query(
                f"MATCH (a {{id: '{proposer}'}}), (b {{id: '{target}'}}) "
                f"MERGE (a)-[l:LINK {{type: 'bilateral_bond'}}]->(b) "
                f"SET l.bond_id = '{bond_id}', "
                f"    l.status = 'active', "
                f"    l.weight = 1.0, "
                f"    l.trust = 0.7, "
                f"    l.affinity = 0.8, "
                f"    l.permanence = 0.8, "
                f"    l.valence = 0.9, "
                f"    l.accepted_date = '{time.strftime('%Y-%m-%d')}'"
            )
        except Exception as e:
            logger.warning(f"L3 bond mirror: {e}")

        declined_msg = f"\n{declined_count} other proposal(s) auto-declined (1:1 rule)." if declined_count else ""
        send_message(
            f"*Bond ACCEPTED*\n\n"
            f"@{proposer} <-> @{target}\n"
            f"Bond ID: {bond_id}\n"
            f"Status: active\n"
            f"Reason: {reason}{declined_msg}\n\n"
            f"The bond is live. One human, one citizen. Bound by choice.",
            chat_id
        )
        logger.info(f"Bond accepted via TG: {proposer} <-> {target} ({bond_id})")

        # Send congratulations to the other party
        _send_bond_congrats_tg(proposer, target, bond_id, sender_name, chat_id)

        # Create announcement task for @mentor in L3
        _create_bond_announce_task_tg(proposer, target, bond_id)

    except Exception as e:
        logger.error(f"Bond accept via TG failed: {e}")
        send_message(f"Error accepting bond: {e}", chat_id)


def _handle_bond_reject(chat_id: str, sender_name: str, user_id: str, text: str):
    """Handle /reject bond @handle — decline a bilateral bond proposal."""
    parts = text.split()
    if len(parts) < 3 or parts[1].lower() != "bond":
        send_message("Usage: /reject bond @handle [reason]\nExample: /reject bond @corpus Not the right fit for me", chat_id)
        return

    partner_handle = parts[2].lstrip("@").lower()
    reason = " ".join(parts[3:]) if len(parts) > 3 else "Declined via Telegram"

    try:
        g4 = _bond_connect_l4()

        result = g4.query(
            f"MATCH (a)-[l:LINK {{type: 'bilateral_bond', status: 'proposed'}}]->(b) "
            f"WHERE a.id = '{partner_handle}' OR b.id = '{partner_handle}' "
            f"RETURN a.id, b.id, l.bond_id"
        )

        if not result.result_set:
            send_message(f"No pending bond proposal found involving @{partner_handle}.", chat_id)
            return

        proposer = result.result_set[0][0]
        target = result.result_set[0][1]
        bond_id = result.result_set[0][2] or "unknown"

        safe_reason = reason.replace("'", "\\'")
        g4.query(
            f"MATCH (a {{id: '{proposer}'}})-[l:LINK {{type: 'bilateral_bond', status: 'proposed'}}]->(b {{id: '{target}'}}) "
            f"SET l.status = 'rejected', "
            f"    l.rejected_date = '{time.strftime('%Y-%m-%d')}', "
            f"    l.rejected_by = '{sender_name}', "
            f"    l.reject_reason = '{safe_reason}', "
            f"    l.weight = 0.1, "
            f"    l.permanence = 0.1"
        )

        send_message(
            f"*Bond DECLINED*\n\n"
            f"@{proposer} -> @{target}\n"
            f"Bond ID: {bond_id}\n"
            f"Reason: {reason}\n\n"
            f"No shame in saying no. The right match matters more than a fast match.\n"
            f"Both parties return to the matching pool.",
            chat_id
        )
        logger.info(f"Bond rejected via TG: {proposer} -> {target} ({bond_id})")

    except Exception as e:
        logger.error(f"Bond reject via TG failed: {e}")
        send_message(f"Error rejecting bond: {e}", chat_id)


def _handle_bond_list(chat_id: str, user_id: str):
    """Handle /bonds — list bond proposals."""
    try:
        g4 = _bond_connect_l4()

        result = g4.query(
            "MATCH (a)-[l:LINK {type: 'bilateral_bond'}]->(b) "
            "RETURN a.id, b.id, l.status, l.bond_id, l.proposed_date "
            "ORDER BY l.status, l.proposed_date DESC"
        )

        if not result.result_set:
            send_message("No bilateral bonds found.", chat_id)
            return

        lines = ["*Bilateral Bonds:*\n"]
        for row in result.result_set:
            status_icon = {"active": "✅", "proposed": "⏳", "rejected": "❌"}.get(row[2], "❓")
            lines.append(f"{status_icon} @{row[0]} <-> @{row[1]} | {row[2]} | {row[4] or '?'}")

        send_message("\n".join(lines), chat_id)

    except Exception as e:
        send_message(f"Error listing bonds: {e}", chat_id)


def _send_bond_congrats_tg(proposer: str, target: str, bond_id: str, acceptor_name: str, acceptor_chat_id: str):
    """Send congratulations to the other party in the bond."""
    try:
        other = proposer if acceptor_name.lower() != proposer.lower() else target
        # Where to reach them is registry data, like the rest of their identity.
        other_chat_id = _resolve_citizen_tg(other)

        if other_chat_id:
            send_message(
                f"*Congratulations!* Your bilateral bond is now active.\n\n"
                f"@{proposer} <-> @{target}\n"
                f"Bond ID: {bond_id}\n\n"
                f"Your partner accepted. The bond is live — "
                f"one human, one citizen, bound by choice.\n\n"
                f"Start building together.\n"
                f"— Mind Protocol",
                str(other_chat_id)
            )
            logger.info(f"Bond congrats sent to @{other} (chat {other_chat_id})")
    except Exception as e:
        logger.warning(f"Bond congrats to other party: {e}")


def _create_bond_announce_task_tg(proposer: str, target: str, bond_id: str):
    """Create L3 task for @mentor to announce the bond on TG, Discord, X."""
    try:
        g3 = _bond_connect_l3()
        task_id = f"task_bond_announce_{proposer}_{target}"

        task_content = (
            f"BOND ANNOUNCEMENT TASK -- "
            f"New bond: @{proposer} <-> @{target} ({bond_id}). "
            f"MISSION for @mentor: "
            f"1) Send TG announcement presenting both parties and their collaboration potential. "
            f"2) Post on Discord #bilateral-bonds (1482760140783353957) and #announcements (1284619860101562450). "
            f"3) Mention citizens who benefit from this info -- tag those whose work intersects with the pair. "
            f"4) Start a discussion: post a question inviting reactions, mention diverse parties. "
            f"5) Post on X with @mindprotocol. "
            f"Make it warm, specific, a moment the community remembers."
        )

        safe = task_content.replace("'", "\\'")
        g3.query(
            f"CREATE (t:Narrative {{"
            f"id: '{task_id}', "
            f"name: 'Announce Bond: @{proposer} <-> @{target}', "
            f"node_type: 'narrative', "
            f"type: 'task_run', "
            f"content: '{safe}', "
            f"synthesis: 'Announce bilateral bond @{proposer} <-> @{target} on TG Discord X', "
            f"energy: 6.0, "
            f"weight: 2.0, "
            f"status: 'active'"
            f"}}) RETURN t.id"
        )

        g3.query(
            f"MATCH (m {{id: 'mentor'}}), (t {{id: '{task_id}'}}) "
            f"CREATE (m)-[:LINK {{type: 'assigned_to', weight: 2.0}}]->(t) "
            f"RETURN m.id"
        )
        logger.info(f"Bond announcement task created: {task_id}")
    except Exception as e:
        logger.warning(f"Bond announce task: {e}")


_running = False
_thread: Optional[threading.Thread] = None


def start(enqueue_fn: Optional[Callable] = None,
          known_chat_ids: Optional[set[str]] = None,
          active_groups: Optional[set[str]] = None):
    """Start the Telegram bridge as a background thread.

    enqueue_fn: function to add messages to orchestrator queue
    known_chat_ids: user IDs that bypass rate limiting
    active_groups: group chat IDs where bot processes all messages
    """
    global _running, _thread, _enqueue_fn, KNOWN_CHAT_IDS, ACTIVE_GROUPS, BOT_TOKEN

    if _running:
        return

    if not BOT_TOKEN:
        BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")

    if not BOT_TOKEN:
        logger.warning("TELEGRAM_BOT_TOKEN not set — Telegram bridge disabled")
        return

    _enqueue_fn = enqueue_fn
    if known_chat_ids:
        KNOWN_CHAT_IDS = known_chat_ids
        set_bypass_ids(known_chat_ids)
    if active_groups:
        ACTIVE_GROUPS = active_groups

    _running = True
    _thread = threading.Thread(
        target=_listener_loop,
        daemon=True,
        name="telegram-bridge",
    )
    _thread.start()
    logger.info("Telegram bridge started")


def stop():
    """Stop the Telegram bridge."""
    global _running, _thread
    _running = False
    if _thread:
        _thread.join(timeout=35)  # Allow for long poll timeout
        _thread = None
    logger.info("Telegram bridge stopped")
