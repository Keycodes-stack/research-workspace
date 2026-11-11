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

ALLOWED_PREFIXES = ("/projects", "/tasks", "/threads", "/discover", "/signals", "/concepts")

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
    payload = json.loads(b64url_decode(payload_b64))
    exp = payload.get("exp")
    if exp and time.time() > exp:
        raise ValueError("Token expired")
    sub = payload.get("sub")
    if not sub:
        raise ValueError("Missing sub")
    return str(sub)

client = httpx.AsyncClient(base_url=AI_URL, timeout=300.0)

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

    headers = dict(request.headers)
    headers.pop("authorization", None)
    headers.pop("host", None)
    headers["x-internal-token"] = INTERNAL_TOKEN
    headers["x-user-id"] = user_id

    body = await request.body()
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
        return Response(status_code=502, content=json.dumps({"detail": f"AI service unavailable: {str(e)}"}), media_type="application/json")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8080)
