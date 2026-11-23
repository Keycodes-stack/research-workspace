import logging
import os
import json
import base64
import hmac
import hashlib
import time
from pathlib import Path
from dotenv import load_dotenv
import httpx
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

JWT_SECRET = os.environ.get("JWT_SECRET", "").encode('utf-8')
INTERNAL_TOKEN = os.environ.get("INTERNAL_TOKEN", "")
AI_URL = os.environ.get("AI_URL", "http://localhost:8000").rstrip("/")
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]

app = FastAPI(title="Research Workspace - Gateway Proxy", docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Report-Fingerprint"],
)

# Parity with the Go gateway (same env names and defaults).
RATE_RPS = float(os.environ.get("RATE_LIMIT_RPS", "10"))
RATE_BURST = int(float(os.environ.get("RATE_LIMIT_BURST", "60")))
MAX_BODY = int(float(os.environ.get("MAX_BODY_MB", "55")) * 1024 * 1024)

if len(JWT_SECRET) < 32:
    raise SystemExit("JWT_SECRET must be at least 32 characters (set it in .env)")
if len(INTERNAL_TOKEN) < 16:
    raise SystemExit("INTERNAL_TOKEN must be at least 16 characters (set it in .env)")

_buckets: dict[str, tuple[float, float]] = {}   # user -> (tokens, last_refill)


def allow(user: str) -> bool:
    """Per-user token bucket."""
    now = time.monotonic()
    tokens, last = _buckets.get(user, (float(RATE_BURST), now))
    tokens = min(float(RATE_BURST), tokens + (now - last) * RATE_RPS)
    if tokens < 1:
        _buckets[user] = (tokens, now)
        return False
    _buckets[user] = (tokens - 1, now)
    if len(_buckets) > 10_000:                  # bound memory: drop idle users
        for k in [k for k, (_, t) in _buckets.items() if now - t > 300]:
            _buckets.pop(k, None)
    return True


ALLOWED_PREFIXES = ("/projects", "/tasks", "/threads", "/discover", "/signals", "/concepts", "/comments", "/people", "/attachments")

def b64url_decode(s: str) -> bytes:
    padding = '=' * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + padding)

def verify_jwt(token: str) -> str:
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Malformed token")
    header_b64, payload_b64, sig_b64 = parts
    signing_input = f"{header_b64}.{payload_b64}".encode('utf-8')
    expected_sig = hmac.new(JWT_SECRET, signing_input, hashlib.sha256).digest()
    actual_sig = b64url_decode(sig_b64)
    if not hmac.compare_digest(expected_sig, actual_sig):
        raise ValueError("Invalid signature")
    header = json.loads(b64url_decode(header_b64))
    if header.get("alg") != "HS256":
        raise ValueError("Unsupported algorithm")
    payload = json.loads(b64url_decode(payload_b64))
    exp, nbf = payload.get("exp"), payload.get("nbf")
    if not exp:
        raise ValueError("Token has no expiry")
    if time.time() > exp:
        raise ValueError("Token expired")
    if nbf and time.time() < nbf - 30:
        raise ValueError("Token not valid yet")
    sub = payload.get("sub")
    if not sub:
        raise ValueError("Missing sub")
    return str(sub)

# keepalive_expiry stays below uvicorn's 5 s keep-alive, so a pooled connection is never reused after the AI
# service closed it (that race produced spurious 502s); retries covers a connection that still fails to open.
client = httpx.AsyncClient(
    base_url=AI_URL, timeout=300.0,
    limits=httpx.Limits(keepalive_expiry=2.0),
    transport=httpx.AsyncHTTPTransport(retries=2, limits=httpx.Limits(keepalive_expiry=2.0)),
)
log = logging.getLogger("gateway")

@app.get("/healthz")
async def healthz():
    return {"ok": True}


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy_all(request: Request, path: str):
    req_path = f"/{path}"
    if not any(req_path.startswith(prefix) for prefix in ALLOWED_PREFIXES):
        return Response(status_code=404, content=json.dumps({"detail": "Not found"}), media_type="application/json")

    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return Response(status_code=401, content=json.dumps({"detail": "Missing bearer token"}), media_type="application/json")

    token = auth[len("Bearer "):].strip()
    try:
        user_id = verify_jwt(token)
    except Exception as e:
        return Response(status_code=401, content=json.dumps({"detail": f"Unauthorized: {str(e)}"}), media_type="application/json")

    if not allow(user_id):
        return Response(status_code=429, content=json.dumps({"detail": "rate limit exceeded"}), media_type="application/json")

    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BODY:
        return Response(status_code=413, content=json.dumps({"detail": "request too large"}), media_type="application/json")

    # Never forward the caller's own identity headers or cookies: identity comes only from the verified token.
    headers = {k: v for k, v in request.headers.items()
               if k.lower() not in {"authorization", "host", "cookie", "x-user-id", "x-internal-token", "content-length"}}
    headers["x-internal-token"] = INTERNAL_TOKEN
    headers["x-user-id"] = user_id

    body = await request.body()
    if len(body) > MAX_BODY:
        return Response(status_code=413, content=json.dumps({"detail": "request too large"}), media_type="application/json")
    url = f"{AI_URL}{req_path}"
    if request.url.query:
        url += f"?{request.url.query}"

    try:
        upstream_resp = await client.request(
            method=request.method,
            url=url,
            headers=headers,
            content=body,
        )
        resp_headers = dict(upstream_resp.headers)
        resp_headers.pop("content-length", None)
        resp_headers.pop("transfer-encoding", None)
        resp_headers.pop("content-encoding", None)
        return Response(
            content=upstream_resp.content,
            status_code=upstream_resp.status_code,
            headers=resp_headers,
            media_type=upstream_resp.headers.get("content-type"),
        )
    except Exception as e:
        log.warning("upstream failure on %s %s: %s", request.method, req_path, e.__class__.__name__)
        return Response(status_code=502, content=json.dumps({"detail": "AI service unavailable"}), media_type="application/json")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8080)
