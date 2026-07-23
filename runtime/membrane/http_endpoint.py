"""HTTP membrane endpoint — universal information bus.

Exposes membrane operations over HTTP for cross-home communication.
Other citizen homes can send stimuli, subscribe to streams, and query
this home's public nodes through these endpoints.

Wired into home_server.py as a FastAPI router.
"""

# DEPRECATED: Stimulus concept eliminated per DECISION_Two_Tick_Cognitive_Architecture.md
# Citizens scan the world via awareness ticks, not stimulus injection.

import os
import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger("membrane.http")

router = APIRouter(prefix="/membrane", tags=["membrane"])


# ── Models ──────────────────────────────────────────────────────────────────

class StimulusRequest(BaseModel):
    query: str
    from_org: str = "unknown"
    from_home: str = "unknown"
    top_k: int = 5


class SubscribeRequest(BaseModel):
    stream_type: str  # "rss" | "webhook" | "citizen_home"
    url: str
    scope: str = "org"  # "org" | "citizen:{handle}"
    filter: Optional[str] = None
    poll_interval_seconds: int = 300


# ── Routes ──────────────────────────────────────────────────────────────────

@router.post("/stimulus")
async def receive_stimulus(req: StimulusRequest):
    """Receive a cross-org stimulus query.

    NOTE: Stimulus concept eliminated per DECISION_Two_Tick_Cognitive_Architecture.
    This endpoint returns 410 Gone. Cross-org queries now route through subcall.
    """
    raise HTTPException(
        status_code=410,
        detail="Stimulus endpoint removed — use subcall for cross-org queries",
    )


@router.get("/ping/{handle}")
async def membrane_ping(handle: str):
    """Ping a citizen through this membrane. Lightweight liveness check.

    Checks: citizen dir exists, brain graph has nodes, keys exist.
    Does NOT require the stimulus handler or graph ops.
    """
    from pathlib import Path
    import os

    project_root = Path(__file__).resolve().parent.parent.parent
    citizens_dir = project_root / "citizens"
    keys_dir = project_root / ".keys"

    citizen_dir = citizens_dir / handle
    has_profile = (citizen_dir / "profile.json").exists()

    # Check brain in FalkorDB
    brain_nodes = 0
    try:
        from falkordb import FalkorDB
        host = os.environ.get("FALKORDB_HOST", "localhost")
        port = int(os.environ.get("FALKORDB_PORT", "6379"))
        db = FalkorDB(host=host, port=port)
        graph = db.select_graph(f"brain_{handle}")
        result = graph.query("MATCH (n) RETURN count(n)", timeout=5000)
        if result.result_set:
            brain_nodes = result.result_set[0][0]
    except Exception as e:
        logger.debug(f"Could not query brain for {handle}: {e}")

    has_keys = (keys_dir / handle / "solana_private_key.json").exists() or \
               (keys_dir / handle / "rsa_private_key.pem").exists()

    alive = has_profile or brain_nodes > 0

    return {
        "handle": handle,
        "alive": alive,
        "profile": has_profile,
        "brain_nodes": brain_nodes,
        "has_keys": has_keys,
    }


@router.get("/info")
async def membrane_info():
    """Return membrane metadata for L4 registry discovery."""
    home_id = os.environ.get("HOME_ID", "mind-home-dev")
    public_url = os.environ.get("MIND_PUBLIC_URL", "")

    return {
        "home_id": home_id,
        "membrane_endpoint": f"{public_url}/membrane" if public_url else None,
        "capabilities": ["stimulus", "info"],
        "protocol_version": "0.1.0",
    }


@router.post("/subscribe")
async def subscribe_stream(req: SubscribeRequest):
    """Subscribe to an information stream (RSS, webhook, citizen home).

    Stores the subscription. A background worker processes subscriptions
    by polling RSS feeds or registering webhook endpoints.
    """
    # For now, store subscription in state file
    from pathlib import Path
    subs_file = Path(__file__).resolve().parent.parent.parent / ".mind" / "state" / "subscriptions.jsonl"
    subs_file.parent.mkdir(parents=True, exist_ok=True)

    subscription = {
        "id": f"sub_{datetime.now().strftime('%Y%m%d%H%M%S')}",
        "stream_type": req.stream_type,
        "url": req.url,
        "scope": req.scope,
        "filter": req.filter,
        "poll_interval_seconds": req.poll_interval_seconds,
        "created_at": datetime.now().isoformat(),
        "active": True,
    }

    with open(subs_file, "a") as f:
        f.write(json.dumps(subscription) + "\n")

    logger.info(f"New subscription: {subscription['id']} ({req.stream_type}: {req.url})")
    return {"status": "subscribed", "subscription": subscription}


@router.get("/subscriptions")
async def list_subscriptions():
    """List active stream subscriptions."""
    from pathlib import Path
    subs_file = Path(__file__).resolve().parent.parent.parent / ".mind" / "state" / "subscriptions.jsonl"
    if not subs_file.exists():
        return {"subscriptions": []}

    subs = []
    for line in subs_file.read_text().strip().split("\n"):
        if line.strip():
            try:
                sub = json.loads(line)
                if sub.get("active", True):
                    subs.append(sub)
            except json.JSONDecodeError:
                pass

    return {"subscriptions": subs}
