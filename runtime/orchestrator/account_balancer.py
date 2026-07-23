"""Claude Code account load balancer.

Round-robins `claude --print` calls across multiple Max accounts
by setting HOME per subprocess to point to different credential dirs.

Account dirs: ~/.claude-accounts/{a,b,...}/.claude/.credentials.json
Each dir is a minimal HOME with just the .claude/ credentials.
Shared config (settings.json) is symlinked from the real home.

Proactive token refresh: calls the OAuth token endpoint to renew
access tokens BEFORE they expire. When the refresh token itself is
dead, alerts aggressively and repeatedly until manual re-login.

OAuth endpoint: https://platform.claude.com/v1/oauth/token
Client ID: 9d1c250a-e61b-44d9-88ed-5944d1962f5e (Claude CLI)
"""

import json
import os
import subprocess
import time
import threading
import logging
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path
from typing import Optional, Callable

logger = logging.getLogger("orchestrator.accounts")

ACCOUNTS_DIR = Path.home() / ".claude-accounts"
OAUTH_TOKEN_URL = "https://platform.claude.com/v1/oauth/token"
OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
REFRESH_THRESHOLD_S = 14400   # 4 hours — attempt refresh well before expiry
REFRESH_RETRY_INTERVAL_S = 600  # 10 minutes — retry failed refreshes
REFRESH_CHECK_INTERVAL_S = 900  # 15 minutes between refresh sweeps (was 30)
ALERT_REPEAT_INTERVAL_S = 1800  # re-alert every 30 min if still expired (not just once)
_lock = threading.Lock()
_counter = 0
_account_slots: list[dict] = []
_last_refresh_check = 0.0
_alerted_accounts: dict[str, float] = {}  # account_id → last alert timestamp


def _discover_accounts() -> list[dict]:
    """Find all account dirs with valid credentials."""
    accounts = []
    if not ACCOUNTS_DIR.exists():
        return accounts

    for d in sorted(ACCOUNTS_DIR.iterdir()):
        creds = d / ".claude" / ".credentials.json"
        if creds.exists():
            try:
                data = json.loads(creds.read_text())
                oauth = data.get("claudeAiOauth", {})
                tier = oauth.get("rateLimitTier", "unknown")
                sub = oauth.get("subscriptionType", "unknown")
                exp_ms = oauth.get("expiresAt", 0)
                expired = exp_ms < time.time() * 1000
                accounts.append({
                    "id": d.name,
                    "home": str(d),
                    "creds_path": str(creds),
                    "tier": tier,
                    "subscription": sub,
                    "expired": expired,
                    "_expires_at_ms": exp_ms,
                    "active_count": 0,
                    "total_calls": 0,
                    "errors": 0,
                    "last_used": 0,
                    "_exhausted": False,
                    "_exhausted_at": 0.0,
                })
            except (json.JSONDecodeError, OSError):
                continue
    return accounts


def init() -> list[dict]:
    """Initialize account discovery. Call once at startup."""
    global _account_slots
    with _lock:
        _account_slots = _discover_accounts()
    logger.info(f"Discovered {len(_account_slots)} Claude accounts")
    return _account_slots


def rescan() -> list[dict]:
    """Re-discover accounts (picks up newly added credentials)."""
    global _account_slots
    fresh = _discover_accounts()
    with _lock:
        old_by_id = {a["id"]: a for a in _account_slots}
        merged = []
        for acct in fresh:
            if acct["id"] in old_by_id:
                old = old_by_id[acct["id"]]
                old["expired"] = acct["expired"]
                old["tier"] = acct["tier"]
                old["subscription"] = acct["subscription"]
                merged.append(old)
            else:
                merged.append(acct)
        _account_slots = merged
    return _account_slots


def get_accounts() -> list[dict]:
    """Return current account list."""
    if not _account_slots:
        init()
    return _account_slots


def get_account_env(base_env: Optional[dict] = None) -> dict:
    """Return an env dict with HOME set to the next account's home dir.

    Round-robin across available, non-expired accounts.
    Falls back to real HOME if no accounts configured.
    """
    global _counter

    if not _account_slots:
        init()

    if not _account_slots:
        env = dict(base_env or os.environ)
        return env

    # Auto-clear exhaustion after 1 hour
    now = time.time()
    now_ms = int(now * 1000)
    for a in _account_slots:
        if a.get("_exhausted") and now - a.get("_exhausted_at", 0) > 3600:
            a["_exhausted"] = False
        # Re-check expiry in real-time
        exp = a.get("_expires_at_ms", 0)
        if exp:
            a["expired"] = exp < now_ms
        elif a.get("creds_path"):
            try:
                data = json.loads(Path(a["creds_path"]).read_text())
                exp_ms = data.get("claudeAiOauth", {}).get("expiresAt", 0)
                a["_expires_at_ms"] = exp_ms
                a["expired"] = exp_ms < now_ms
            except (json.JSONDecodeError, OSError):
                pass

    # Filter to non-expired, non-exhausted accounts
    valid = [a for a in _account_slots if not a["expired"] and not a.get("_exhausted")]
    if not valid:
        valid = [a for a in _account_slots if not a.get("_exhausted")]
    if not valid:
        valid = _account_slots  # Last resort

    with _lock:
        idx = _counter % len(valid)
        _counter += 1
        account = valid[idx]
        account["active_count"] += 1
        account["total_calls"] += 1
        account["last_used"] = time.time()

    env = dict(base_env or os.environ)
    env["HOME"] = account["home"]
    env["_CLAUDE_ACCOUNT_ID"] = account["id"]
    return env


def release_account(env: dict, error: bool = False):
    """Call after a claude process finishes to update counters."""
    account_id = env.get("_CLAUDE_ACCOUNT_ID")
    if not account_id:
        return

    with _lock:
        for a in _account_slots:
            if a["id"] == account_id:
                a["active_count"] = max(0, a["active_count"] - 1)
                if error:
                    a["errors"] += 1
                break


def mark_account_exhausted(account_id: str):
    """Mark an account as exhausted (credit/quota depleted)."""
    with _lock:
        for a in _account_slots:
            if a["id"] == account_id:
                a["_exhausted"] = True
                a["_exhausted_at"] = time.time()
                logger.warning(f"Account {account_id} marked exhausted")
                break


def get_failover_env(exclude_id: str, base_env: Optional[dict] = None) -> Optional[dict]:
    """Get an account env excluding a specific account (for failover)."""
    global _counter

    if not _account_slots:
        init()

    valid = [
        a for a in _account_slots
        if not a.get("expired")
        and not a.get("_exhausted")
        and a["id"] != exclude_id
    ]

    if not valid:
        valid = [a for a in _account_slots if a["id"] != exclude_id and not a.get("_exhausted")]

    if not valid:
        return None

    with _lock:
        valid.sort(key=lambda a: a["last_used"])
        account = valid[0]
        account["active_count"] += 1
        account["total_calls"] += 1
        account["last_used"] = time.time()

    env = dict(base_env or os.environ)
    env["HOME"] = account["home"]
    env["_CLAUDE_ACCOUNT_ID"] = account["id"]
    return env


def all_accounts_exhausted() -> bool:
    """Return True if every known account is currently marked exhausted."""
    if not _account_slots:
        return False
    with _lock:
        return all(a.get("_exhausted") for a in _account_slots)


def healthy_account_count() -> int:
    """Return the number of non-exhausted, non-expired accounts."""
    if not _account_slots:
        return 0
    with _lock:
        return sum(1 for a in _account_slots if not a.get("_exhausted") and not a.get("expired"))


def status_line() -> str:
    """One-line status for display."""
    if not _account_slots:
        return "no accounts"
    parts = []
    for a in _account_slots:
        flag = "X" if a.get("_exhausted") else ("!" if a["expired"] else "")
        parts.append(f"{a['id']}{flag}:{a['total_calls']}({a['active_count']})")
    return " | ".join(parts)


def refresh_credentials(account_id: str):
    """Re-read credentials for a specific account (after token refresh)."""
    with _lock:
        for a in _account_slots:
            if a["id"] == account_id:
                creds_path = Path(a["creds_path"])
                if creds_path.exists():
                    try:
                        data = json.loads(creds_path.read_text())
                        oauth = data.get("claudeAiOauth", {})
                        exp_ms = oauth.get("expiresAt", 0)
                        a["_expires_at_ms"] = exp_ms
                        a["expired"] = exp_ms < time.time() * 1000
                        a["tier"] = oauth.get("rateLimitTier", "unknown")
                    except (json.JSONDecodeError, OSError):
                        pass
                break


def _reread_expiry(account: dict) -> int:
    """Re-read token expiry from disk (catches manual re-logins)."""
    try:
        data = json.loads(Path(account["creds_path"]).read_text())
        exp_ms = data.get("claudeAiOauth", {}).get("expiresAt", 0)
        with _lock:
            account["_expires_at_ms"] = exp_ms
            account["expired"] = exp_ms < time.time() * 1000
        return exp_ms
    except (json.JSONDecodeError, OSError):
        return account.get("_expires_at_ms", 0)


def _attempt_oauth_refresh(account: dict) -> bool:
    """Attempt to refresh an account's OAuth token via the token endpoint.

    Reads the refresh_token from disk, calls platform.claude.com/v1/oauth/token,
    and writes the new credentials back if successful.

    IMPORTANT: When all accounts share the same token (cloned credentials),
    only refresh once and propagate to all accounts. Otherwise the refresh
    token rotation invalidates the token for all other accounts.

    Returns True if refresh succeeded, False otherwise.
    """
    account_id = account["id"]
    creds_path = Path(account["creds_path"])

    try:
        creds_data = json.loads(creds_path.read_text())
        oauth = creds_data.get("claudeAiOauth", {})
        refresh_token = oauth.get("refreshToken")
        if not refresh_token:
            logger.warning(f"Account {account_id}: no refresh token on disk")
            return False
    except (json.JSONDecodeError, OSError) as e:
        logger.warning(f"Account {account_id}: failed to read credentials: {e}")
        return False

    # Call the OAuth token endpoint
    data = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": OAUTH_CLIENT_ID,
    }).encode()

    req = urllib.request.Request(
        OAUTH_TOKEN_URL,
        data=data,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "claude-cli/2.1.79",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode()[:200]
        except Exception:
            pass
        logger.warning(f"Account {account_id}: OAuth refresh HTTP {e.code}: {body}")
        return False
    except Exception as e:
        logger.warning(f"Account {account_id}: OAuth refresh failed: {e}")
        return False

    # Write new credentials back to disk
    new_access = result.get("access_token")
    new_refresh = result.get("refresh_token")
    new_expires_in = result.get("expires_in", 0)  # seconds

    if not new_access:
        logger.warning(f"Account {account_id}: OAuth response missing access_token")
        return False

    new_expires_at_ms = int((time.time() + new_expires_in) * 1000)

    # Preserve existing fields, update tokens
    oauth["accessToken"] = new_access
    if new_refresh:
        oauth["refreshToken"] = new_refresh
    oauth["expiresAt"] = new_expires_at_ms

    creds_data["claudeAiOauth"] = oauth

    try:
        # Atomic write: write to temp then rename
        tmp_path = creds_path.with_suffix(".tmp")
        tmp_path.write_text(json.dumps(creds_data, indent=2))
        tmp_path.rename(creds_path)
    except OSError as e:
        logger.error(f"Account {account_id}: failed to write refreshed credentials: {e}")
        return False

    # Update in-memory state
    with _lock:
        account["_expires_at_ms"] = new_expires_at_ms
        account["expired"] = False
        account["_last_refresh_attempt"] = time.time()

    # Propagate to sibling accounts that share the same token.
    # All accounts in ~/.claude-accounts/ may be clones of the same credential.
    # After refresh, the old refresh_token is invalidated — siblings must get the new one.
    for sibling in _account_slots:
        if sibling["id"] == account_id:
            continue
        sibling_path = Path(sibling["creds_path"])
        try:
            import shutil
            shutil.copy2(str(creds_path), str(sibling_path))
            sibling["_expires_at_ms"] = new_expires_at_ms
            sibling["expired"] = False
            logger.info(f"Propagated refresh from {account_id} → {sibling['id']}")
        except OSError as e:
            logger.warning(f"Failed to propagate to {sibling['id']}: {e}")

    remaining_h = new_expires_in / 3600
    logger.info(f"Account {account_id}: OAuth refresh SUCCESS — valid for {remaining_h:.1f}h")
    return True


def proactive_refresh(notify_fn: Optional[Callable] = None):
    """Monitor all accounts and actively refresh tokens before they expire.

    Strategy:
    1. Re-read credentials from disk (catches manual re-logins)
    2. If token expires within REFRESH_THRESHOLD_S: attempt OAuth refresh
    3. If OAuth refresh fails (dead refresh token): alert REPEATEDLY
    4. Auto-clear alerts when recovery detected (manual re-login or successful refresh)

    Call periodically from the dispatcher tick loop (every 15 min).
    """
    global _last_refresh_check

    now = time.time()
    if now - _last_refresh_check < REFRESH_CHECK_INTERVAL_S:
        return
    _last_refresh_check = now

    if not _account_slots:
        init()
    if not _account_slots:
        return

    now_ms = int(now * 1000)
    threshold_ms = int((now + REFRESH_THRESHOLD_S) * 1000)
    healthy = 0
    refreshed = 0
    failed = 0

    # Detect cloned accounts (same refresh token) — only refresh the first one
    _refresh_tokens_seen = {}
    _clone_leader = {}  # refresh_token_prefix → account_id that refreshes

    for account in _account_slots:
        account_id = account["id"]

        # Re-read from disk — catches manual re-logins
        exp_ms = _reread_expiry(account)

        # Detect clones: if multiple accounts share the same refresh token,
        # only the first one should attempt OAuth refresh (others get propagated)
        try:
            _rt = json.loads(Path(account["creds_path"]).read_text()).get("claudeAiOauth", {}).get("refreshToken", "")[:30]
        except Exception:
            _rt = ""
        if _rt:
            if _rt in _refresh_tokens_seen:
                # This is a clone — skip refresh, it'll be propagated
                if exp_ms < threshold_ms:
                    logger.debug(f"Account {account_id}: clone of {_refresh_tokens_seen[_rt]} — skipping refresh (will propagate)")
                    continue
            else:
                _refresh_tokens_seen[_rt] = account_id

        # Healthy — token valid well beyond threshold
        if exp_ms > threshold_ms:
            if account_id in _alerted_accounts:
                logger.info(f"Account {account_id} recovered (re-login or refresh detected)")
                del _alerted_accounts[account_id]
            healthy += 1
            continue

        # Token expiring within threshold or already expired — attempt refresh
        is_expired = exp_ms < now_ms
        remaining_min = max(0, (exp_ms - now_ms) / 60000)

        if is_expired:
            logger.warning(f"Account {account_id}: EXPIRED — attempting OAuth refresh")
        else:
            logger.info(f"Account {account_id}: expires in {remaining_min:.0f}min — attempting OAuth refresh")

        # Don't retry too fast on known-failing accounts
        last_attempt = account.get("_last_refresh_attempt", 0)
        if now - last_attempt < REFRESH_RETRY_INTERVAL_S and is_expired:
            # Still in retry cooldown for this account
            pass
        else:
            account["_last_refresh_attempt"] = now
            if _attempt_oauth_refresh(account):
                refreshed += 1
                if account_id in _alerted_accounts:
                    del _alerted_accounts[account_id]
                continue

        # Refresh failed — alert (repeatedly, not just once)
        failed += 1
        last_alert = _alerted_accounts.get(account_id, 0)
        if now - last_alert > ALERT_REPEAT_INTERVAL_S:
            _alerted_accounts[account_id] = now
            msg = (
                f"CRITICAL: Claude account '{account_id}' token expired and auto-refresh FAILED. "
                f"Manual re-login required: HOME={account['home']} claude auth login"
            )
            logger.error(msg)
            if notify_fn:
                try:
                    notify_fn(f"[account-balancer] {msg}")
                except Exception as e:
                    logger.warning(f"Failed to send alert: {e}")

    summary = (
        f"Account health: {healthy}/{len(_account_slots)} healthy, "
        f"{refreshed} refreshed, {failed} need manual re-login "
        f"({accounts_healthy_line()})"
    )
    logger.info(summary)


def accounts_healthy_line() -> str:
    """Short health summary for logs."""
    if not _account_slots:
        return "no accounts"
    parts = []
    now_ms = int(time.time() * 1000)
    for a in _account_slots:
        exp = a.get("_expires_at_ms", 0)
        if exp > now_ms:
            remaining_h = (exp - now_ms) / 3600000
            parts.append(f"{a['id']}:{remaining_h:.1f}h")
        else:
            parts.append(f"{a['id']}:EXPIRED")
    return " ".join(parts)


def clear_alert(account_id: str):
    """Clear the alert flag for an account (after manual re-login)."""
    _alerted_accounts.pop(account_id, None)


def account_health_value() -> float:
    """Return aggregate account health as a 0.0–1.0 value for HEALTH signal H8.

    1.0 = all accounts healthy (token valid > REFRESH_THRESHOLD_S)
    0.5 = some accounts expiring soon but refresh is working
    0.0 = all accounts expired and refresh failing (CRITICAL)
    """
    if not _account_slots:
        return 0.0

    now_ms = int(time.time() * 1000)
    threshold_ms = int((time.time() + REFRESH_THRESHOLD_S) * 1000)

    scores = []
    for a in _account_slots:
        exp = a.get("_expires_at_ms", 0)
        if exp > threshold_ms:
            scores.append(1.0)  # healthy
        elif exp > now_ms:
            # Expiring soon — proportional score
            remaining = (exp - now_ms) / (REFRESH_THRESHOLD_S * 1000)
            scores.append(max(0.2, remaining))
        else:
            scores.append(0.0)  # expired

    return sum(scores) / len(scores) if scores else 0.0


def stagger_warning() -> Optional[str]:
    """Check if all accounts expire within the same 1h window — stagger risk.

    Returns a warning message if accounts aren't staggered, None otherwise.
    """
    if len(_account_slots) < 2:
        return None

    expiries = [a.get("_expires_at_ms", 0) for a in _account_slots if a.get("_expires_at_ms", 0) > 0]
    if len(expiries) < 2:
        return None

    spread_ms = max(expiries) - min(expiries)
    spread_h = spread_ms / 3600000

    if spread_h < 1.0:
        return (
            f"All {len(expiries)} accounts expire within {spread_h:.1f}h of each other. "
            f"Stagger re-logins to prevent simultaneous expiry."
        )
    return None
