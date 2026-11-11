import json
import re

from app.routes_concepts import evidence_score
from tests.fakes import USER_A, USER_B, db_exec, hdr
from tests.helpers import make_pdf
from tests.test_signals import ByCategory, ans, no_gate, proj, scan, sigs  # noqa: F401  (no_gate is an autouse fixture)
from tests.test_sources_api import upload

COST = make_pdf([["Cold storage of the liquid injection costs 40 dollars per vial per year", "in the pilot facility"]])


class Finder:
    """Answers with the first (system-keyword, text, quote) rule whose keyword is in the system prompt;
    cites whichever chunk alias actually contains the quote."""
    def __init__(self, name, rules):
        self.name, self.rules, self.calls = name, rules, 0

    async def complete(self, system, user):
        self.calls += 1
        for kw, text, quote in self.rules:
            if kw in system:
                m = next((a for a, body in re.findall(r"\[(C\d+)\] \(.*?\)\n(.*?)(?=\n\n\[C\d+\]|\n</source_chunks>)", user, re.S)
                          if quote.lower() in " ".join(body.lower().split())), None)
                if m:
                    return json.dumps({"status": "answered", "claims": [{"text": text, "cites": [m], "quote": quote, "conditions": None}]})
        return json.dumps({"status": "insufficient_source_evidence", "claims": []})


def make_concept(api, user=USER_A, extra_pdf=None):
    p = proj(api, user)
    if extra_pdf:
        upload(api, p, extra_pdf, "cost.pdf", user=user)
    rule = ("TRENDS", "Samples were stable at 4 C for twelve weeks", "stable at 4 C for twelve weeks")
    api.llms = (Finder("A", [rule]), Finder("B", [rule]))
    scan(api, p, user, categories=["trend"])
    sid = sigs(api, p, user)[0]["id"]
    r = api.post(f"/projects/{p}/concepts", headers=hdr(user), json={"title": "Cold chain formulation", "signal_ids": [sid]})
    assert r.status_code == 201, r.text
    return p, sid, r.json()["id"]


def get(api, cid, user=USER_A):
    return api.get(f"/concepts/{cid}", headers=hdr(user)).json()


def test_evidence_score_is_deterministic():
    mk = lambda t, s, m, ok=True: {"claim_text": t, "source_id": s, "model": m, "intact": ok}
    assert evidence_score([])["score"] == 0
    both = [mk("a", "s1", "model_a"), mk("a", "s1", "model_b")]
    assert evidence_score(both)["score"] == 10 + 10 + 20
    assert evidence_score(both + [mk("b", "s2", "model_a", ok=False)])["excluded_changed_sources"] == 1


def test_create_copies_verified_evidence_and_rejects_bad_signals(api):
    p, sid, cid = make_concept(api)
    c = get(api, cid)
    assert {e["model"] for e in c["evidence"]} == {"model_a", "model_b"} and all(e["intact"] for e in c["evidence"])
    assert set(c["sections"]) == {"problem", "hypothesis", "approach", "risks", "next_steps"}
    assert c["rubric"]["evidence"]["statements"] == 1 and c["rubric"]["evidence"]["score"] == 10 + 10 + 20
    h = hdr()
    assert api.post(f"/signals/{sid}/dismiss", headers=h, json={"reason": "no longer relevant"}).status_code == 200
    r = api.post(f"/projects/{p}/concepts", headers=h, json={"title": "Another", "signal_ids": [sid]})
    assert r.status_code == 409 and r.json()["detail"]["error"] == "inactive_signals"
    assert api.post(f"/projects/{p}/concepts", headers=h, json={"title": "Another", "signal_ids": ["00000000-0000-4000-8000-000000000000"]}).status_code == 400


def test_sections_use_optimistic_versions(api):
    _, _, cid = make_concept(api)
    h = hdr()
    r = api.put(f"/concepts/{cid}/sections/problem", headers=h, json={"body": "Cold chain is costly", "base_version": 0})
    assert r.status_code == 200 and r.json()["version"] == 1
    stale = api.put(f"/concepts/{cid}/sections/problem", headers=h, json={"body": "other", "base_version": 0})
    assert stale.status_code == 409 and stale.json()["detail"]["current"] == {"body": "Cold chain is costly", "version": 1}
    assert api.put(f"/concepts/{cid}/sections/nonsense", headers=h, json={"body": "x", "base_version": 0}).status_code == 422


def test_activation_requires_problem_and_hypothesis(api):
    _, _, cid = make_concept(api)
    h = hdr()
    assert api.put(f"/concepts/{cid}/status", headers=h, json={"status": "active"}).status_code == 409
    api.put(f"/concepts/{cid}/sections/problem", headers=h, json={"body": "p", "base_version": 0})
    api.put(f"/concepts/{cid}/sections/hypothesis", headers=h, json={"body": "h", "base_version": 0})
    assert api.put(f"/concepts/{cid}/status", headers=h, json={"status": "active"}).status_code == 200


def test_scores_average_and_stay_separate_from_evidence(api):
    _, _, cid = make_concept(api)
    h = hdr()
    assert api.put(f"/concepts/{cid}/scores", headers=h, json={"criterion": "impact", "score": 6}).status_code == 422
    api.put(f"/concepts/{cid}/scores", headers=h, json={"criterion": "impact", "score": 4})
    api.put(f"/concepts/{cid}/scores", headers=h, json={"criterion": "impact", "score": 5})     # same user updates, not duplicates
    r = get(api, cid)["rubric"]
    assert r["human"]["impact"] == {"average": 5.0, "raters": 1, "mine": 5} and r["human"]["novelty"]["average"] is None
    assert "score" in r["evidence"] and "total" not in r


def test_lenses_keep_only_verified_and_never_invent_figures(api):
    p, _, cid = make_concept(api, extra_pdf=COST)
    good = ("COSTS", "Cold storage costs 40 dollars per vial per year", "costs 40 dollars per vial per year")
    bad = ("COSTS", "Cold storage costs 400 dollars per vial per year", "costs 40 dollars per vial per year")
    legal = ("regulation", "Samples were stable at 4 C", "stable at 4 C for twelve weeks")
    api.llms = (Finder("A", [good, legal]), Finder("B", [good, legal]))
    r = api.post(f"/concepts/{cid}/lenses/generate", headers=hdr(), json={"departments": ["finance", "legal", "marketing"]})
    assert r.status_code == 200, r.text
    assert r.json()["finance"] == {"status": "ok", "statements": 1} and r.json()["marketing"]["status"] == "no_evidence"
    lens = api.get(f"/concepts/{cid}/lenses", headers=hdr()).json()
    fin = lens["finance"]["items"]
    assert len(fin) == 1 and fin[0]["models_agree"] and fin[0]["evidence"][0]["intact"]
    assert lens["rnd"]["status"] == "not_generated"

    # a model that invents a figure: purged, so regenerating REPLACES the department with nothing
    api.llms = (Finder("A", [bad]), Finder("B", [bad]))
    r = api.post(f"/concepts/{cid}/lenses/generate", headers=hdr(), json={"departments": ["finance"]}).json()
    assert r["finance"] == {"status": "no_evidence", "statements": 0}
    assert api.get(f"/concepts/{cid}/lenses", headers=hdr()).json()["finance"]["items"] == []


def test_changed_source_is_flagged_and_excluded_from_score(api, db_url):
    _, _, cid = make_concept(api)

    async def tamper(pool):
        async with pool.acquire() as c:
            await c.execute("ALTER TABLE chunks DISABLE TRIGGER USER")
            await c.execute("UPDATE chunks SET text = replace(text, 'twelve', 'fifty')")
            await c.execute("ALTER TABLE chunks ENABLE TRIGGER USER")
    db_exec(db_url, tamper)
    c = get(api, cid)
    assert not any(e["intact"] for e in c["evidence"])
    assert c["rubric"]["evidence"]["score"] == 0 and c["rubric"]["evidence"]["excluded_changed_sources"] == 2


def test_other_users_get_404(api):
    p, _, cid = make_concept(api)
    b = hdr(USER_B)
    for call in (api.get(f"/concepts/{cid}", headers=b), api.get(f"/projects/{p}/concepts", headers=b),
                 api.put(f"/concepts/{cid}/scores", headers=b, json={"criterion": "impact", "score": 3}),
                 api.put(f"/concepts/{cid}/sections/problem", headers=b, json={"body": "x", "base_version": 0}),
                 api.post(f"/concepts/{cid}/lenses/generate", headers=b, json={}), api.get(f"/concepts/{cid}/lenses", headers=b)):
        assert call.status_code == 404
