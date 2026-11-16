"""Tests for the Python gateway (the one the Windows launcher runs). Run: python -m pytest services/gateway -q"""
import base64, hashlib, hmac, json, os, time

os.environ["JWT_SECRET"] = "s" * 40
os.environ["INTERNAL_TOKEN"] = "internal-token-1234"
os.environ["AI_URL"] = "http://127.0.0.1:9"        # nothing listens: forwarding fails with 502
os.environ["RATE_LIMIT_BURST"] = "3"
os.environ["RATE_LIMIT_RPS"] = "0.001"

from fastapi.testclient import TestClient  # noqa: E402

import gateway  # noqa: E402

c = TestClient(gateway.app)


def tok(alg="HS256", exp=3600, nbf=-30, sub="11111111-1111-4111-8111-111111111111", secret=None):
    b = lambda d: base64.urlsafe_b64encode(json.dumps(d, separators=(",", ":")).encode()).rstrip(b"=").decode()
    now = int(time.time())
    body = {"sub": sub, "nbf": now + nbf, **({"exp": now + exp} if exp is not None else {})}
    si = f"{b({'alg': alg, 'typ': 'JWT'})}.{b(body)}"
    sig = hmac.new((secret or os.environ["JWT_SECRET"]).encode(), si.encode(), hashlib.sha256).digest()
    return si + "." + base64.urlsafe_b64encode(sig).rstrip(b"=").decode()


def get(path, token=None):
    return c.get(path, headers={"Authorization": f"Bearer {token}"} if token else {})


def test_health_is_public_and_unknown_paths_are_hidden():
    assert c.get("/healthz").json() == {"ok": True}
    assert get("/docs", tok()).status_code == 404 and get("/health", tok()).status_code == 404


def test_rejects_missing_forged_expired_and_unsigned_tokens():
    assert get("/projects").status_code == 401
    assert get("/projects", tok(secret="x" * 40)).status_code == 401
    assert get("/projects", tok(exp=-10)).status_code == 401
    assert get("/projects", tok(exp=None)).status_code == 401          # no expiry
    assert get("/projects", tok(nbf=3600)).status_code == 401          # not valid yet
    assert get("/projects", tok(alg="none")).status_code == 401


def test_valid_token_is_forwarded_and_ai_outage_hides_internals():
    r = get("/projects", tok(sub="22222222-2222-4222-8222-222222222222"))
    assert r.status_code == 502 and r.json() == {"detail": "AI service unavailable"}


def test_oversized_body_is_refused_and_rate_limit_applies_per_user():
    big = c.post("/projects", headers={"Authorization": f"Bearer {tok(sub='33333333-3333-4333-8333-333333333333')}",
                                       "Content-Length": str(gateway.MAX_BODY + 1)}, content=b"x")
    assert big.status_code == 413
    t = tok(sub="44444444-4444-4444-8444-444444444444")
    codes = [get("/projects", t).status_code for _ in range(5)]
    assert codes[:3] == [502, 502, 502] and codes[3:] == [429, 429]
    assert get("/projects", tok(sub="55555555-5555-4555-8555-555555555555")).status_code == 502   # other user unaffected


def test_every_path_the_web_app_calls_is_forwarded():
    for path in ("/comments/x/resolve", "/concepts/x/approval", "/projects/x/executive", "/signals/x", "/threads/x/ask"):
        assert get(path, tok(sub="66666666-6666-4666-8666-666666666666")).status_code != 404, path
