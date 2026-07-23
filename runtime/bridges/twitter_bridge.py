# DOCS: mind-protocol/docs/onboarding/ALGORITHM_Human_Onboarding.md
"""Twitter/X Bridge — polling listener for mentions/replies with citizen routing.

Polls X API v2 for mentions of the bot account. Incoming mentions are:
  1. Logged to L3 as Moment nodes (same graph_enricher as TG/Discord)
  2. Routed to orchestrator queue for citizen response
  3. Trust builds via L5 co-activation (same physics as other platforms)

Architecture:
  Inbound:  GET /2/users/:id/mentions polling → process_mention() → enqueue()
  Outbound: POST /2/tweets via send_handler.py (already exists)

Requires env vars:
  X_BEARER_TOKEN     — App bearer token (read access)
  X_BOT_USER_ID      — Bot's numeric user ID
  X_API_KEY          — For posting (OAuth 1.0a, used by send_handler)
  X_API_SECRET
  X_ACCESS_TOKEN
  X_ACCESS_SECRET
"""

import json
import logging
import os
import re
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Optional, Callable

import requests

logger = logging.getLogger("bridge.twitter")

# ── Paths ────────────────────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
STATE_DIR = PROJECT_ROOT / "shrine" / "state"
CITIZENS_DIR = PROJECT_ROOT / "citizens"
MENTIONS_LOG = STATE_DIR / "twitter_mentions.jsonl"
SINCE_ID_FILE = STATE_DIR / "twitter_since_id.txt"

STATE_DIR.mkdir(parents=True, exist_ok=True)

# ── Config ───────────────────────────────────────────────────────────────────

import urllib.parse as _urlparse
BEARER_TOKEN = _urlparse.unquote(os.environ.get("X_BEARER_TOKEN", ""))
BOT_USER_ID = os.environ.get("X_BOT_USER_ID", "")

# Poll interval (seconds). X API v2 free tier: 10k reads/month ≈ 1 every 4.3 min.
# Conservative default: every 5 minutes.
POLL_INTERVAL = int(os.environ.get("X_POLL_INTERVAL", "300"))

# ── State ────────────────────────────────────────────────────────────────────

_running = False
_thread: Optional[threading.Thread] = None
_enqueue_fn: Optional[Callable] = None


# ── X API v2 ─────────────────────────────────────────────────────────────────

def _api_get(endpoint: str, params: dict = None) -> Optional[dict]:
    """Call X API v2 with bearer token. Returns JSON or None."""
    if not BEARER_TOKEN:
        logger.error("X_BEARER_TOKEN not set")
        return None
    try:
        url = f"https://api.twitter.com/2/{endpoint}"
        headers = {"Authorization": f"Bearer {BEARER_TOKEN}"}
        resp = requests.get(url, headers=headers, params=params or {}, timeout=30)
        if resp.status_code == 429:
            reset = resp.headers.get("x-rate-limit-reset", "")
            logger.warning(f"X rate limited. Reset: {reset}")
            return None
        if resp.status_code != 200:
            logger.warning(f"X API {endpoint} returned {resp.status_code}: {resp.text[:200]}")
            return None
        return resp.json()
    except Exception as e:
        logger.error(f"X API error: {e}")
        return None


# ── Since ID persistence ─────────────────────────────────────────────────────

def _get_since_id() -> Optional[str]:
    """Read last processed tweet ID."""
    try:
        if SINCE_ID_FILE.exists():
            return SINCE_ID_FILE.read_text().strip() or None
    except OSError as e:
        logger.warning(f"Since ID file read failed: {e}")
    return None


def _save_since_id(since_id: str):
    """Persist last processed tweet ID."""
    try:
        SINCE_ID_FILE.write_text(since_id)
    except OSError as e:
        logger.error(f"Failed to save since_id: {e}")


# ── Mention polling ──────────────────────────────────────────────────────────

def poll_mentions() -> list[dict]:
    """Fetch new mentions of the bot account.

    Uses GET /2/users/:id/mentions with since_id to get only new mentions.
    Returns list of tweet dicts with author info.
    """
    if not BOT_USER_ID:
        logger.error("X_BOT_USER_ID not set")
        return []

    params = {
        "tweet.fields": "created_at,author_id,conversation_id,in_reply_to_user_id,text",
        "user.fields": "name,username",
        "expansions": "author_id",
        "max_results": 100,
    }

    since_id = _get_since_id()
    if since_id:
        params["since_id"] = since_id

    data = _api_get(f"users/{BOT_USER_ID}/mentions", params)
    if not data:
        return []

    tweets = data.get("data", [])
    if not tweets:
        return []

    # Build author lookup from includes
    users = {}
    for user in data.get("includes", {}).get("users", []):
        users[user["id"]] = {
            "name": user.get("name", ""),
            "username": user.get("username", ""),
        }

    # Enrich tweets with author info
    results = []
    for tweet in tweets:
        author_id = tweet.get("author_id", "")
        author = users.get(author_id, {"name": "unknown", "username": "unknown"})
        tweet["author_name"] = author["name"]
        tweet["author_username"] = author["username"]
        results.append(tweet)

    # Update since_id to newest tweet
    newest_id = max(t["id"] for t in tweets)
    _save_since_id(newest_id)

    return results


# ── Process a single mention ─────────────────────────────────────────────────

def process_mention(tweet: dict) -> bool:
    """Process an incoming X mention.

    1. Log to JSONL
    2. Create L3 Moment via graph_enricher
    3. Route to orchestrator for citizen response
    """
    tweet_id = tweet.get("id", "")
    text = tweet.get("text", "")
    author_name = tweet.get("author_name", "unknown")
    author_username = tweet.get("author_username", "unknown")
    author_id = tweet.get("author_id", "")
    conversation_id = tweet.get("conversation_id", "")
    is_reply = tweet.get("in_reply_to_user_id") is not None
    created_at = tweet.get("created_at", "")

    logger.info(f"X mention from @{author_username}: {text[:80]}...")

    # 1. Log to JSONL
    _log_mention(tweet_id, author_username, author_name, text, created_at, is_reply)

    # 2. L3 graph enrichment — create Moment + mention links
    mentioned_handles = _extract_citizen_mentions(text)
    try:
        import sys
        sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
        from graph_enricher import on_message
        on_message(
            platform="twitter",
            channel_id=conversation_id or tweet_id,
            channel_name=f"x_thread_{conversation_id}" if conversation_id else f"x_tweet_{tweet_id}",
            author_name=author_name,
            author_handle=author_username.lower(),
            content=text,
            mentioned_handles=mentioned_handles,
            direction="in",
        )
    except Exception as e:
        logger.warning(f"L3 enrichment failed for tweet {tweet_id}: {e}")

    # 2b. Direct L1 stimulus for mentioned citizens (critical — graph_enricher
    #     excludes them from space stimulus, so this is their ONLY wake path)
    if mentioned_handles:
        try:
            import sys
            sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
            from citizen_wake import mention_citizen
            for handle in mentioned_handles:
                mention_citizen(
                    by_handle=author_username.lower(),
                    mentioned_handle=handle,
                    context=f"[X] {text[:300]}",
                )
        except Exception as e:
            logger.warning(f"L1 mention stimulus failed: {e}")

    # 3. Route to orchestrator
    if _enqueue_fn:
        # Determine target citizen: mentioned citizen > default
        target_handle = None
        route_mode = "default"
        if mentioned_handles:
            target_handle = mentioned_handles[0]
            route_mode = "mention"

        metadata = {
            "tweet_id": tweet_id,
            "conversation_id": conversation_id,
            "author_username": author_username,
            "author_id": author_id,
            "is_reply": is_reply,
            "reply_tweet_id": tweet_id,
            "route_mode": route_mode,
            "platform": "twitter",
        }
        if target_handle:
            metadata["citizen_handle"] = target_handle

        _enqueue_fn({
            "voice_text": f"[x/@{author_username}] {text}",
            "mode": route_mode,
            "source": "twitter",
            "sender": author_name,
            "sender_id": author_id,
            "metadata": metadata,
        })

    return True


def _extract_citizen_mentions(text: str) -> list[str]:
    """Extract @mentions that match known citizen handles."""
    mentions = []
    for match in re.finditer(r"@(\w+)", text):
        candidate = match.group(1).lower()
        candidate_dir = CITIZENS_DIR / candidate
        if candidate_dir.is_dir() and (candidate_dir / "profile.json").exists():
            mentions.append(candidate)
    return mentions


def _log_mention(tweet_id, username, name, text, created_at, is_reply):
    """Append mention to JSONL log."""
    try:
        entry = {
            "ts": datetime.now().isoformat(),
            "tweet_id": tweet_id,
            "author_username": username,
            "author_name": name,
            "text": text[:500],
            "created_at": created_at,
            "is_reply": is_reply,
            "direction": "in",
        }
        with open(MENTIONS_LOG, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except OSError as e:
        logger.warning(f"Mention log write failed: {e}")


# ── Polling loop ─────────────────────────────────────────────────────────────

def _listener_loop():
    """Main polling loop. Runs in a background thread."""
    logger.info(f"X/Twitter listener started (interval={POLL_INTERVAL}s, bot_id={BOT_USER_ID})")
    consecutive_errors = 0
    max_errors = 20

    while _running:
        try:
            mentions = poll_mentions()
            for tweet in mentions:
                try:
                    process_mention(tweet)
                except Exception as e:
                    logger.exception(f"Error processing mention: {e}")

            if mentions:
                logger.info(f"Processed {len(mentions)} X mentions")

            consecutive_errors = 0
            time.sleep(POLL_INTERVAL)

        except requests.ConnectionError:
            consecutive_errors += 1
            backoff = min(2 ** consecutive_errors, 300)
            logger.warning(f"X connection error #{consecutive_errors}, backoff {backoff}s")
            time.sleep(backoff)

        except Exception as e:
            consecutive_errors += 1
            if consecutive_errors >= max_errors:
                logger.error(f"X bridge: {max_errors} consecutive errors, stopping.")
                break
            backoff = min(2 ** consecutive_errors, 300)
            logger.error(f"X bridge error #{consecutive_errors}: {e}, backoff {backoff}s")
            time.sleep(backoff)


# ── Start/Stop ───────────────────────────────────────────────────────────────

def start(enqueue_fn: Optional[Callable] = None):
    """Start the X/Twitter bridge as a background thread.

    enqueue_fn: function to add messages to orchestrator queue
    """
    global _running, _thread, _enqueue_fn

    if not BEARER_TOKEN:
        logger.warning("X_BEARER_TOKEN not set — X bridge disabled")
        return
    if not BOT_USER_ID:
        logger.warning("X_BOT_USER_ID not set — X bridge disabled")
        return

    _enqueue_fn = enqueue_fn
    _running = True
    _thread = threading.Thread(target=_listener_loop, daemon=True, name="x-bridge")
    _thread.start()
    logger.info("X/Twitter bridge started")


def stop():
    """Stop the X/Twitter bridge."""
    global _running
    _running = False
    if _thread:
        _thread.join(timeout=10)
    logger.info("X/Twitter bridge stopped")
