"""
Central authentication-mode switch for the user-facing API.

Flip AUTH_MODE to change how every protected route authenticates, without
touching individual route files:

    AUTH_MODE=none    → no auth; every request runs as an anonymous user
    AUTH_MODE=token   → JWT Bearer token  (default — production behavior)
    AUTH_MODE=oauth   → OAuth             (not implemented yet — placeholder)

Set it via environment variable, e.g. in .env:

    AUTH_MODE=none

All route helpers delegate to require_auth() below, so this one file is the
single place that decides whether/how a request is authenticated.
"""

import logging
import os

from fastapi import Request, HTTPException

from runtime.api import jwt_utils

logger = logging.getLogger("home.auth")

# Payload returned for every request when auth is disabled (AUTH_MODE=none).
# Mirrors the shape of a verified JWT payload (sub / name / trust) so downstream
# route code keeps working unchanged.
ANONYMOUS_PAYLOAD = {
    "sub": "anonymous",
    "name": "Anonymous",
    "trust": "unverified",
}

_VALID_MODES = {"none", "token", "oauth"}


def get_auth_mode() -> str:
    """Return the current auth mode from the environment (default: 'token')."""
    mode = os.environ.get("AUTH_MODE", "token").strip().lower()
    if mode not in _VALID_MODES:
        logger.warning("Unknown AUTH_MODE=%r, falling back to 'token'", mode)
        return "token"
    return mode


def require_auth(request: Request) -> dict:
    """Authenticate a request according to AUTH_MODE.

    Returns a JWT-style payload (keys: sub, name, trust) or raises HTTPException.
    """
    mode = get_auth_mode()

    if mode == "none":
        # Auth disabled — open access. Everyone is the same anonymous user.
        return dict(ANONYMOUS_PAYLOAD)

    if mode == "oauth":
        # TODO: implement OAuth verification. Left as a placeholder for now.
        raise HTTPException(status_code=501, detail="OAuth auth mode not implemented yet")

    # Default: token (JWT Bearer).
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization header with Bearer token required")
    token = auth_header[7:].strip()
    payload = jwt_utils.verify_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return payload
