import json

import pytest

from app.routes_signals import confidence
from tests.fakes import USER_A, USER_B, db_exec, hdr
from tests.helpers import make_pdf
from tests.test_sources_api import mk_project, upload

LIQUID = make_pdf([["Liquid injection samples were stable at 4 C", "for twelve weeks of refrigerated storage"]])
GOOD = "stable at 4 C for twelve weeks"


class ByCategory:
    """Answers per scan category: finds 'TRENDS' / 'OPPORTUNITIES' / 'RISKS' in the system prompt."""
    def __init__(self, name, by_cat):
        self.name, self.by_cat, self.calls = name, by_cat, 0

    async def complete(self, system, user):
        self.calls += 1
        for key, cat in (("TRENDS", "trend"), ("OPPORTUNITIES", "opportunity"), ("RISKS", "risk")):
            if key in system:
                return self.by_cat.get(cat, json.dumps({"status": "insufficient_source_evidence", "claims": []}))
        raise AssertionError("not a scan prompt")


@pytest.fixture(autouse=True)
def no_gate(monkeypatch):
    # the hash embedder gives near-zero/negative cosine for generic scan queries; the gate has its own test
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "similarity_threshold", -1.0)


def ans(text, quote=GOOD):
    return json.dumps({"status": "answered", "claims": [{"text": text, "cites": ["C1"], "quote": quote, "conditions": None}]})


def proj(api, user=USER_A):
    p = mk_project(api, user, "open_discovery")
    upload(api, p, LIQUID, "liquid.pdf", user=user)
    return p


def scan(api, p, user=USER_A, **kw):
    return api.post(f"/projects/{p}/signals/scan", headers=hdr(user), json=kw)


def sigs(api, p, user=USER_A, **q):
    return api.get(f"/projects/{p}/signals", headers=hdr(user), params=q).json()["signals"]


def test_confidence_rule():
    assert confidence(2, 2) == "high" and confidence(2, 1) == "medium" and confidence(1, 2) == "medium"
    assert confidence(1, 1) == "low"


def test_scan_stores_only_verified_signals_with_evidence(api):
    p = proj(api)
    good = ans("Samples were stable at 4 C for twelve weeks")
    fake = ans("Samples were stable at 4 C for fifty weeks", "stable at 4 C for fifty weeks")
    api.llms = (ByCategory("A", {"trend": good, "risk": fake}), ByCategory("B", {"trend": good, "risk": fake}))
    r = scan(api, p, categories=["trend", "risk"])
    assert r.status_code == 200 and r.json()["created"] == 1
    got = sigs(api, p)
    assert len(got) == 1 and got[0]["category"] == "trend"
    assert got[0]["models_agree"] is True and got[0]["confidence"] == "medium"   # one source
    d = api.get(f"/signals/{got[0]['id']}", headers=hdr()).json()
    assert {e["model"] for e in d["evidence"]} == {"model_a", "model_b"}
    assert all(e["intact"] and e["quote"] == GOOD for e in d["evidence"])


def test_single_model_is_low_and_rescan_is_idempotent(api):
    p = proj(api)
    only_a = ans("Samples were stable at 4 C for twelve weeks")
    none = {}
    api.llms = (ByCategory("A", {"trend": only_a}), ByCategory("B", none))
    assert scan(api, p, categories=["trend"]).json()["created"] == 1
    assert sigs(api, p)[0]["confidence"] == "low"
    r = scan(api, p, categories=["trend"]).json()
    assert r["created"] == 0 and r["already_known"] == 1 and len(sigs(api, p)) == 1
    # now B also finds it: confidence is recomputed from all evidence
    api.llms = (ByCategory("A", {"trend": only_a}), ByCategory("B", {"trend": only_a}))
    scan(api, p, categories=["trend"])
    assert sigs(api, p)[0]["confidence"] == "medium"


def test_decisions_and_transitions(api):
    p = proj(api)
    a1, a2 = ans("Samples were stable at 4 C for twelve weeks"), ans("Samples were stable at 4 C for twelve weeks of refrigerated storage")
    api.llms = (ByCategory("A", {"trend": a1}), ByCategory("B", {"trend": a1}))
    scan(api, p, categories=["trend"])
    api.llms = (ByCategory("A", {"risk": a2}), ByCategory("B", {"risk": a2}))
    scan(api, p, categories=["risk"])
    trend, risk = sigs(api, p, category="trend")[0], sigs(api, p, category="risk")[0]
    h = hdr()
    assert api.post(f"/signals/{trend['id']}/dismiss", headers=h, json={"reason": "x"}).status_code == 422   # reason too short
    assert api.post(f"/signals/{trend['id']}/dismiss", headers=h, json={"reason": "not relevant"}).status_code == 200
    assert api.post(f"/signals/{trend['id']}/dismiss", headers=h, json={"reason": "again"}).status_code == 409
    assert api.post(f"/signals/{trend['id']}/promote", headers=h, json={"reason": "go ahead"}).status_code == 409
    assert sigs(api, p, status="dismissed")[0]["id"] == trend["id"]
    assert api.post(f"/signals/{trend['id']}/restore", headers=h).status_code == 200
    assert api.post(f"/signals/{trend['id']}/promote", headers=h, json={"reason": "worth a concept"}).status_code == 200
    # cross-category merge refused
    assert api.post(f"/signals/{risk['id']}/merge", headers=h, json={"into": trend["id"]}).status_code == 400
    assert api.post(f"/signals/{risk['id']}/merge", headers=h, json={"into": risk["id"]}).status_code == 400


def test_merge_moves_evidence(api):
    p = proj(api)
    t1 = ans("Samples were stable at 4 C for twelve weeks")
    t2 = ans("Refrigerated samples were stable at 4 C for twelve weeks")
    api.llms = (ByCategory("A", {"trend": t1}), ByCategory("B", {}))
    scan(api, p, categories=["trend"])
    api.llms = (ByCategory("A", {}), ByCategory("B", {"trend": t2}))
    scan(api, p, categories=["trend"])
    rows = sigs(api, p)
    assert len(rows) == 2
    keep = next(r for r in rows if r["text"].startswith("Samples"))
    drop = next(r for r in rows if r["text"].startswith("Refrigerated"))
    assert api.post(f"/signals/{drop['id']}/merge", headers=hdr(), json={"into": keep["id"]}).json()["status"] == "merged"
    d = api.get(f"/signals/{keep['id']}", headers=hdr()).json()
    assert {e["model"] for e in d["evidence"]} == {"model_a", "model_b"} and d["confidence"] == "medium"
    assert api.get(f"/signals/{drop['id']}", headers=hdr()).json()["merged_into"] == keep["id"]


def test_other_users_get_404(api):
    p = proj(api)
    g = ans("Samples were stable at 4 C for twelve weeks")
    api.llms = (ByCategory("A", {"trend": g}), ByCategory("B", {"trend": g}))
    scan(api, p, categories=["trend"])
    sid = sigs(api, p)[0]["id"]
    b = hdr(USER_B)
    assert scan(api, p, USER_B).status_code == 404
    assert api.get(f"/projects/{p}/signals", headers=b).status_code == 404
    assert api.get(f"/signals/{sid}", headers=b).status_code == 404
    assert api.post(f"/signals/{sid}/dismiss", headers=b, json={"reason": "nope nope"}).status_code == 404


def test_tampered_chunk_flags_evidence(api, db_url):
    p = proj(api)
    g = ans("Samples were stable at 4 C for twelve weeks")
    api.llms = (ByCategory("A", {"trend": g}), ByCategory("B", {"trend": g}))
    scan(api, p, categories=["trend"])
    sid = sigs(api, p)[0]["id"]

    async def tamper(pool):
        async with pool.acquire() as c:
            await c.execute("ALTER TABLE chunks DISABLE TRIGGER USER")
            await c.execute("UPDATE chunks SET text = replace(text, 'twelve', 'fifty')")
            await c.execute("ALTER TABLE chunks ENABLE TRIGGER USER")
    db_exec(db_url, tamper)
    d = api.get(f"/signals/{sid}", headers=hdr()).json()
    assert d["evidence"] and not any(e["intact"] for e in d["evidence"])
    # and a fresh scan will not use the corrupted chunk at all
    assert scan(api, p, categories=["trend"]).json()["created"] == 0


def test_gate_skips_scan_without_calling_models(api, monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "similarity_threshold", 0.99)
    p = proj(api)
    a, b = ByCategory("A", {}), ByCategory("B", {})
    api.llms = (a, b)
    r = scan(api, p, categories=["trend"]).json()
    assert r["created"] == 0 and r["skipped"][0]["reason"] == "below_similarity_threshold" and a.calls == b.calls == 0
