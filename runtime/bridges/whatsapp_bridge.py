"""WhatsApp Bridge — webhook-based via WAHA.

Receives inbound messages from WAHA webhooks, routes to orchestrator queue.
Sends replies via WAHA REST API.

Architecture:
  Inbound:  WAHA webhook → process_webhook() → message_queue.enqueue()
  Outbound: send_reply() → WAHA REST API → WhatsApp

Wired into home_server.py as a FastAPI router.
"""

import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Callable

import requests

from runtime.bridges.rate_limiter import check_rate_limit

logger = logging.getLogger("bridge.whatsapp")

# ── Paths ────────────────────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_WORLD_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent
STATE_DIR = PROJECT_ROOT / "shrine" / "state"
MESSAGES_FILE = STATE_DIR / "whatsapp_messages.jsonl"
USERS_FILE = STATE_DIR / "whatsapp_users.jsonl"
LID_CACHE_FILE = STATE_DIR / "whatsapp_lid_cache.json"

STATE_DIR.mkdir(parents=True, exist_ok=True)

# ── Config ───────────────────────────────────────────────────────────────────

WAHA_URL = os.environ.get("WAHA_URL", "http://localhost:3002")
WAHA_SESSION = os.environ.get("WAHA_SESSION", "default")
WAHA_API_KEY = os.environ.get("WAHA_API_KEY", "")
OWNER_PHONE = os.environ.get("OWNER_WHATSAPP_PHONE", "")

# Enqueue function — set by init
_enqueue_fn: Optional[Callable] = None

# Webhook dedup — prevents processing same message twice
_seen_message_ids: dict[str, float] = {}


# ── WAHA API ─────────────────────────────────────────────────────────────────

def _waha_headers() -> dict:
    """Build WAHA API headers. Uses X-Api-Key for local WAHA containers."""
    headers = {"Content-Type": "application/json"}
    if WAHA_API_KEY:
        headers["X-Api-Key"] = WAHA_API_KEY
    return headers


def _resolve_chat_id_to_lid(chat_id: str) -> str:
    """Resolve a phone-based chat_id to LID format if needed.

    WAHA WEBJS engine requires LID (Linked ID) for sending.
    First checks cache, then queries WAHA /api/contacts/check-exists.
    Falls back to original chat_id if resolution fails.
    """
    if not chat_id.endswith("@c.us"):
        return chat_id  # groups or already LID format

    # Check LID cache (reverse: phone → LID)
    cache = _load_lid_cache()
    for lid, phone in cache.items():
        if phone.replace("+", "").replace("@c.us", "") in chat_id:
            logger.debug(f"LID cache hit: {chat_id} → {lid}")
            return lid

    # Query WAHA to check if contact exists and get LID
    try:
        phone = chat_id.replace("@c.us", "")
        resp = requests.get(
            f"{WAHA_URL}/api/contacts/check-exists",
            headers=_waha_headers(),
            params={"phone": phone, "session": WAHA_SESSION},
            timeout=10,
        )
        if resp.status_code == 200:
            data = resp.json()
            lid = data.get("chatId") or data.get("id") or data.get("lid")
            if lid and lid != chat_id:
                _cache_lid(lid, phone)
                logger.info(f"LID resolved: {chat_id} → {lid}")
                return lid
    except Exception as e:
        logger.warning(f"LID resolution query failed: {e}")

    return chat_id


def send_message(chat_id: str, text: str) -> dict | None:
    """Send a text message via WAHA. Resolves LID automatically."""
    if not WAHA_URL:
        logger.error("WAHA_URL not configured")
        return None

    # Resolve phone to LID if needed (WAHA WEBJS requirement)
    resolved_id = _resolve_chat_id_to_lid(chat_id)

    try:
        resp = requests.post(
            f"{WAHA_URL}/api/sendText",
            headers=_waha_headers(),
            json={
                "session": WAHA_SESSION,
                "chatId": resolved_id,
                "text": text,
            },
            timeout=15,
        )
        if resp.status_code == 200:
            _log_message(chat_id, text, "outbound")
            return resp.json()
        else:
            # If LID failed, retry with original chat_id
            if resolved_id != chat_id:
                logger.info(f"LID send failed, retrying with original: {chat_id}")
                resp = requests.post(
                    f"{WAHA_URL}/api/sendText",
                    headers=_waha_headers(),
                    json={
                        "session": WAHA_SESSION,
                        "chatId": chat_id,
                        "text": text,
                    },
                    timeout=15,
                )
                if resp.status_code == 200:
                    _log_message(chat_id, text, "outbound")
                    return resp.json()
            logger.warning(f"WAHA sendText failed {resp.status_code}: {resp.text[:200]}")
            return None
    except Exception as e:
        logger.error(f"WAHA send error: {e}")
        return None


def send_reply(text: str, chat_id: str, voice: bool = False,
               voice_text: str = "") -> dict | None:
    """Send reply to WhatsApp user."""
    return send_message(chat_id, text)


# ── LID Resolution ───────────────────────────────────────────────────────────

def _load_lid_cache() -> dict:
    """Load LID → phone number cache."""
    try:
        if LID_CACHE_FILE.exists():
            return json.loads(LID_CACHE_FILE.read_text())
    except (json.JSONDecodeError, OSError) as e:
        logger.warning(f"LID cache load failed: {e}")
    return {}


def _save_lid_cache(cache: dict):
    """Save LID → phone number cache."""
    try:
        LID_CACHE_FILE.write_text(json.dumps(cache, indent=2))
    except OSError as e:
        logger.warning(f"LID cache save failed: {e}")


def _resolve_lid(lid: str) -> Optional[str]:
    """Resolve a WhatsApp LID to a phone number from cache."""
    cache = _load_lid_cache()
    return cache.get(lid)


def _cache_lid(lid: str, phone: str):
    """Cache a LID → phone mapping."""
    if not lid or not phone:
        return
    cache = _load_lid_cache()
    if cache.get(lid) != phone:
        cache[lid] = phone
        _save_lid_cache(cache)


# ── Citizen Resolution Helpers ────────────────────────────────────────────────

def _resolve_sender_handle(chat_id: str, sender_name: str) -> str:
    """Resolve a WhatsApp chat_id to a citizen handle."""
    import json
    citizens_dir = PROJECT_ROOT / "citizens"
    if not citizens_dir.exists():
        return sender_name.lower().replace(" ", "_") if sender_name else chat_id

    # Search profiles for matching WA contact
    for d in citizens_dir.iterdir():
        pf = d / "profile.json"
        if not pf.exists():
            continue
        try:
            p = json.loads(pf.read_text())
            contacts = p.get("contacts", {})
            if isinstance(contacts, list):
                for c in contacts:
                    if isinstance(c, dict) and c.get("value", "").replace("+", "") in chat_id:
                        return d.name
            elif isinstance(contacts, dict):
                for v in contacts.values():
                    if isinstance(v, str) and v.replace("+", "") in chat_id:
                        return d.name
        except (json.JSONDecodeError, OSError):
            continue

    return sender_name.lower().replace(" ", "_") if sender_name else chat_id


def _resolve_partner_ai(chat_id: str, sender_handle: str) -> str:
    """Find the AI partner of a WhatsApp sender.

    Checks: sender's profile → relationships.human_partner (reverse lookup),
    or direct bilateral bond lookup.
    """
    import json
    citizens_dir = PROJECT_ROOT / "citizens"

    # Check if any AI citizen has this human as their partner
    for d in citizens_dir.iterdir():
        pf = d / "profile.json"
        if not pf.exists():
            continue
        try:
            p = json.loads(pf.read_text())
            identity = p.get("identity", {})
            if identity.get("type") == "human":
                continue
            rels = p.get("relationships", {})
            if rels.get("human_partner") == sender_handle:
                return d.name
        except (json.JSONDecodeError, OSError):
            continue

    # Fallback: @mind is the default partner
    return "mind"


def _extract_mentions(text: str) -> list[str]:
    """Extract @handle mentions from WhatsApp text."""
    import re
    return [m.group(1).lower() for m in re.finditer(r"@(\w+)", text)]


# ── Webhook Processing ───────────────────────────────────────────────────────

def process_webhook(payload: dict) -> bool:
    """Process a WAHA webhook payload. Returns True if handled.

    Only handles 'message' events (not 'message.any' to avoid duplication).
    """
    event = payload.get("event")

    # Only process 'message' events
    if event != "message":
        return False

    message = payload.get("payload", {})
    if not message:
        return False

    # Dedup — skip if we've seen this message_id recently
    msg_id = message.get("id", "")
    if msg_id:
        now = time.time()
        if msg_id in _seen_message_ids:
            return False
        _seen_message_ids[msg_id] = now
        # Cleanup old entries (>5 min)
        expired = [k for k, v in _seen_message_ids.items() if now - v > 300]
        for k in expired:
            del _seen_message_ids[k]

    # Skip outgoing messages (from bot itself)
    if message.get("fromMe", False):
        return False

    # Extract sender info
    chat_id = message.get("from", "")
    sender_name = message.get("_data", {}).get("notifyName", "")
    is_group = "@g.us" in chat_id

    # Extract text
    text = message.get("body", "").strip()
    if not text:
        return False

    # Rate limiting
    rate_reason = check_rate_limit(chat_id, text)
    if rate_reason:
        logger.info(f"Rate limited WhatsApp {chat_id}: {rate_reason}")
        return False

    # Log inbound
    _log_message(chat_id, text)

    # 1. Enrich L3 graph — create Moment + structural links
    try:
        import sys
        sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
        from graph_enricher import on_message
        from citizen_wake import _inject_l1_stimulus

        # Resolve sender to a citizen handle (or use chat_id)
        sender_handle = _resolve_sender_handle(chat_id, sender_name)

        on_message(
            platform="whatsapp",
            channel_id=chat_id,
            channel_name=sender_name or chat_id,
            author_name=sender_name or chat_id,
            author_handle=sender_handle,
            content=text,
            mentioned_handles=_extract_mentions(text),
            direction="in",
        )

        # 2. L1 stimulus is handled by _stimulate_space_citizens() inside on_message
        # The orchestrator's smart_route handles partner routing for the response
        # No duplicate routing logic needed here
    except Exception as e:
        logger.warning(f"Graph enrichment/stimulus failed: {e}")

    # 3. Route to orchestrator queue (for response generation)
    if _enqueue_fn:
        content = text
        if is_group:
            content = f"[whatsapp-group] {content}"

        # ── Filesystem write (L2 mirror) ──
        # Write incoming message to citizen messages/ directory
        try:
            _target = _resolve_partner_ai(chat_id, sender_handle)
            _ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            _msg_dir = _WORLD_ROOT / "citizens" / _target / "messages"
            _msg_dir.mkdir(parents=True, exist_ok=True)
            _msg_path = _msg_dir / f"{_ts}_{sender_handle}.md"
            _msg_path.write_text(
                f"---\nfrom: {sender_handle}\nplatform: whatsapp\n"
                f"chat_id: {chat_id}\ntimestamp: {_ts}\n---\n\n{text}\n"
            )
        except Exception as _fs_err:
            logger.warning(f"Filesystem message write failed: {_fs_err}")

        # DEPRECATED: enqueue to orchestrator queue — will be replaced by fs-based routing
        _enqueue_fn({
            "voice_text": content,
            "mode": "partner",
            "source": "whatsapp",
            "sender": sender_name or chat_id,
            "sender_id": chat_id,
            "metadata": {
                "chat_id": chat_id,
                "is_group": is_group,
                "platform": "whatsapp",
                "reply_chat_id": chat_id,
            },
        })
        return True

    return False


# ── Message Logging ──────────────────────────────────────────────────────────

def _log_message(chat_id: str, text: str, direction: str = "inbound"):
    """Append message to audit log."""
    entry = {
        "chat_id": chat_id,
        "text": text[:500] if text else "",
        "direction": direction,
        "timestamp": datetime.now().isoformat(),
    }
    try:
        with open(MESSAGES_FILE, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except OSError as e:
        logger.warning(f"Message log write failed: {e}")


# ── FastAPI Router ───────────────────────────────────────────────────────────

from fastapi import APIRouter, Request

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])


@router.post("/webhook")
async def webhook(request: Request):
    """Receive WAHA webhook events."""
    try:
        payload = await request.json()
    except Exception:
        return {"status": "error", "detail": "invalid json"}

    handled = process_webhook(payload)
    return {"status": "processed" if handled else "skipped"}


@router.get("/health")
async def whatsapp_health():
    """Check WAHA connection."""
    if not WAHA_URL:
        return {"status": "disabled", "detail": "WAHA_URL not configured"}

    try:
        resp = requests.get(
            f"{WAHA_URL}/api/sessions/{WAHA_SESSION}",
            headers=_waha_headers(),
            timeout=5,
        )
        if resp.status_code == 200:
            data = resp.json()
            return {
                "status": "connected",
                "session": WAHA_SESSION,
                "state": data.get("status", "unknown"),
            }
    except Exception as e:
        return {"status": "error", "detail": str(e)}

    return {"status": "disconnected"}


# ── Lifecycle ────────────────────────────────────────────────────────────────

def init(enqueue_fn: Optional[Callable] = None):
    """Initialize WhatsApp bridge (webhook-based, no polling thread needed)."""
    global _enqueue_fn
    _enqueue_fn = enqueue_fn
    logger.info("WhatsApp bridge initialized (webhook mode)")
