"""Trusted-gateway authentication.

The Go gateway verifies the user's JWT, then forwards the request with
X-Internal-Token (shared secret) and X-User-Id. This service never sees the JWT.
Without the secret nobody can forge X-User-Id, so the secret fails closed.
"""
from hmac import compare_digest
from uuid import UUID

from fastapi import Header, HTTPException

from .config import get_settings


def require_user(
    x_internal_token: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> UUID:
    expected = get_settings().internal_token
    if not expected:
        raise HTTPException(503, "INTERNAL_TOKEN is not configured")
    if not x_internal_token or not compare_digest(x_internal_token.encode(), expected.encode()):
        raise HTTPException(401, "unauthorized")
    try:
        return UUID(x_user_id or "")
    except ValueError:
        raise HTTPException(401, "invalid user identity")
