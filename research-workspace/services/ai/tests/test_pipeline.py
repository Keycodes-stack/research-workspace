import asyncpg
import pytest

from tests.fakes import USER_A, USER_B, db_exec, hdr
from tests.test_concepts import Finder, get, make_concept, no_gate  # noqa: F401
from tests.test_concepts import COST

R = "Reviewed the evidence and agree"          # >= 10 chars
LONG = "Overriding because the pilot partner needs an answer this week"


def dec(api, cid, action, reason=R, user=USER_A, **kw):
    return api.post(f"/concepts/{cid}/decisions", headers=hdr(user), json={"action": action, "reason": reason, **kw})


def write_brief(api, cid):
    for k in ("problem", "hypothesis"):
        api.put(f"/concepts/{cid}/sections/{k}", headers=hdr(), json={"body": f"{k} text", "base_version": 0})
    assert api.put(f"/concepts/{cid}/status", headers=hdr(), json={"status": "active"}).status_code == 200


def score_all(api, cid, user=USER_A, v=4):
    for k in ("novelty", "feasibility", "impact", "evidence_strength"):
        api.put(f"/concepts/{cid}/scores", headers=hdr(user), json={"criterion": k, "score": v})


def gates(api, cid):
    return api.get(f"/concepts/{cid}/gates", headers=hdr()).json()


def test_advance_is_blocked_until_gate_passes_and_logged(api):
    _, _, cid = make_concept(api)
    r = dec(api, cid, "advance")
    assert r.status_code == 409 and r.json()["detail"]["error"] == "gate_failed"
    assert [g["name"] for g in r.json()["detail"]["gates"] if not g["passed"]] == ["concept is active"]
    write_brief(api, cid)
    assert gates(api, cid)["ready"] is True
    r = dec(api, cid, "advance")
    assert r.status_code == 201 and (r.json()["from"], r.json()["to"], r.json()["override"]) == ("ideation", "evaluation", False)
    log = api.get(f"/concepts/{cid}/decisions", headers=hdr()).json()["decisions"]
    assert len(log) == 1 and log[0]["gates"][0]["name"] == "source integrity" and log[0]["reason"] == R


def test_reason_is_mandatory(api):
    _, _, cid = make_concept(api)
    assert dec(api, cid, "park", "too short").status_code == 422


def test_override_needs_long_reason_and_is_recorded(api):
    _, _, cid = make_concept(api)
    write_brief(api, cid)
    dec(api, cid, "advance")                                              # -> evaluation
    r = dec(api, cid, "advance")                                          # validation gates fail (score, ratings)
    assert r.status_code == 409
    assert dec(api, cid, "advance", "Short but valid", override=True).status_code == 422  # reason too short for an override
    r = dec(api, cid, "advance", LONG, override=True)
    assert r.status_code == 201 and r.json()["override"] is True and r.json()["to"] == "validation"
    assert api.get(f"/concepts/{cid}/decisions", headers=hdr()).json()["decisions"][-1]["override"] is True


def test_source_integrity_can_never_be_overridden(api, db_url):
    _, _, cid = make_concept(api)
    write_brief(api, cid)

    async def tamper(pool):
        async with pool.acquire() as c:
            await c.execute("ALTER TABLE chunks DISABLE TRIGGER USER")
            await c.execute("UPDATE chunks SET text = replace(text, 'twelve', 'fifty')")
            await c.execute("ALTER TABLE chunks ENABLE TRIGGER USER")
    db_exec(db_url, tamper)
    r = dec(api, cid, "advance", LONG, override=True)
    assert r.status_code == 409 and "cannot be overridden" in r.json()["detail"]["note"]
    assert api.get(f"/concepts/{cid}/decisions", headers=hdr()).json()["decisions"] == []


def test_full_path_to_launch_with_real_gates(api):
    p, _, cid = make_concept(api, extra_pdf=COST)
    write_brief(api, cid)
    assert dec(api, cid, "advance").status_code == 201                       # evaluation
    # validation needs evidence score >= 40 (this concept scores 40) and one full rater
    assert dec(api, cid, "advance").status_code == 409
    score_all(api, cid)
    assert dec(api, cid, "advance").status_code == 201                       # validation
    # pilot needs score >= 60, two raters and four lenses
    assert dec(api, cid, "advance").status_code == 409
    rule = ("regulation", "Samples were stable at 4 C", "stable at 4 C for twelve weeks")
    api.llms = (Finder("A", [rule]), Finder("B", [rule]))
    api.post(f"/concepts/{cid}/lenses/generate", headers=hdr(), json={})
    names = {g["name"]: g["passed"] for g in gates(api, cid)["gates"]}
    assert names["all four department lenses reviewed"] is True
    assert names["evidence score >= 60"] is False                           # honest: one statement, one source


def test_park_reject_reopen_return_to_previous_stage(api):
    _, _, cid = make_concept(api)
    write_brief(api, cid)
    dec(api, cid, "advance")
    assert dec(api, cid, "reopen").status_code == 409
    assert dec(api, cid, "park").json()["to"] == "parked"
    assert dec(api, cid, "advance").status_code == 409                       # parked cannot advance
    assert dec(api, cid, "reopen").json()["to"] == "evaluation"
    assert dec(api, cid, "reject").json()["to"] == "rejected"
    assert dec(api, cid, "park").status_code == 409
    assert dec(api, cid, "reopen").json()["to"] == "evaluation"
    board = api.get(f"/projects/{get(api, cid)['project_id']}/pipeline", headers=hdr()).json()
    assert [c["id"] for c in board["stages"]["evaluation"]] == [cid]


def test_log_is_append_only_in_the_database(api, db_url):
    _, _, cid = make_concept(api)
    dec(api, cid, "park")

    async def attack(pool):
        for sql in ("UPDATE pipeline_decisions SET reason='rewritten history'", "DELETE FROM pipeline_decisions"):
            with pytest.raises(asyncpg.RaiseError):
                await pool.execute(sql)
        n = await pool.fetchval("SELECT count(*) FROM pipeline_decisions")
        await pool.execute("DELETE FROM concepts WHERE id=$1", __import__("uuid").UUID(cid))   # cascade is allowed
        return n, await pool.fetchval("SELECT count(*) FROM pipeline_decisions")
    assert db_exec(db_url, attack) == (1, 0)


def test_other_users_get_404(api):
    p, _, cid = make_concept(api)
    b = hdr(USER_B)
    assert dec(api, cid, "park", user=USER_B).status_code == 404
    assert api.get(f"/concepts/{cid}/gates", headers=b).status_code == 404
    assert api.get(f"/concepts/{cid}/decisions", headers=b).status_code == 404
    assert api.get(f"/projects/{p}/pipeline", headers=b).status_code == 404
