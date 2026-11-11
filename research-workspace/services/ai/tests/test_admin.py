import asyncpg
import pytest

from tests.fakes import USER_A, USER_B, db_exec, hdr
from tests.test_concepts import make_concept, no_gate  # noqa: F401
from tests.test_pipeline import LONG, R, dec, write_brief
from tests.test_sources_api import mk_project, upload
from tests.test_tasks_api import LIQUID, Q, ask, models, setup

USER_C = "33333333-3333-4333-8333-333333333333"
USER_D = "44444444-4444-4444-8444-444444444444"


def add(api, p, user, role, actor=USER_A):
    return api.post(f"/projects/{p}/members", headers=hdr(actor), json={"user_id": user, "role": role})


def test_creator_is_owner_and_non_members_see_nothing(api):
    p = mk_project(api, USER_A, "open_discovery")
    m = api.get(f"/projects/{p}/members", headers=hdr(USER_A)).json()
    assert m["you"] == "owner" and [x["role"] for x in m["members"]] == ["owner"]
    assert api.get(f"/projects/{p}/members", headers=hdr(USER_B)).status_code == 404
    assert api.get(f"/projects/{p}/audit", headers=hdr(USER_B)).status_code == 404
    assert add(api, p, USER_B, "viewer").status_code == 201
    assert api.get("/projects", headers=hdr(USER_B)).json()["projects"][0]["role"] == "viewer"


def test_role_matrix_on_core_actions(api):
    p, s1, s2, t, th = setup(api, mode="open_discovery")
    api.llms = models()
    for u, r in ((USER_B, "viewer"), (USER_C, "researcher"), (USER_D, "lead_scientist")):
        assert add(api, p, u, r).status_code == 201

    # viewer: can read, cannot write or spend
    b = hdr(USER_B)
    assert api.get(f"/threads/{th}/messages", headers=b).status_code == 200
    assert ask(api, th, USER_B).status_code == 403
    assert api.post(f"/projects/{p}/tasks", headers=b, json={"title": "x"}).status_code == 403
    assert api.post(f"/projects/{p}/signals/scan", headers=b, json={}).status_code == 403
    assert upload(api, p, LIQUID, "x.pdf", user=USER_B).status_code == 403
    assert api.post(f"/threads/{th}/export/business-case", headers=b, json={}).status_code == 403

    # researcher: can work, cannot approve, export or decide
    assert ask(api, th, USER_C).status_code == 200
    assert api.post(f"/projects/{p}/tasks", headers=hdr(USER_C), json={"title": "mine"}).status_code == 201
    assert api.post(f"/tasks/{t}/approve", headers=hdr(USER_C)).status_code == 403
    assert api.post(f"/threads/{th}/export/business-case", headers=hdr(USER_C), json={}).status_code == 403

    # lead scientist: approves and exports
    api.put(f"/tasks/{t}/sources", headers=hdr(USER_D), json={"source_ids": [s1]})
    assert api.post(f"/tasks/{t}/approve", headers=hdr(USER_D)).status_code == 200
    assert api.post(f"/threads/{th}/export/business-case", headers=hdr(USER_D), json={}).status_code == 200


def test_pipeline_decisions_and_override_need_the_right_role(api):
    p, _, cid = make_concept(api)
    write_brief(api, cid)
    add(api, p, USER_C, "researcher")
    add(api, p, USER_D, "lead_scientist")
    assert dec(api, cid, "park", user=USER_C).status_code == 403
    dec(api, cid, "advance", user=USER_D)                                  # ideation -> evaluation, gates pass
    r = dec(api, cid, "advance", LONG, user=USER_D, override=True)         # evaluation -> validation gates fail
    assert r.status_code == 403 and "admin" in str(r.json())
    assert dec(api, cid, "advance", LONG, user=USER_A, override=True).status_code == 201   # owner may


def test_member_management_rules(api):
    p = mk_project(api, USER_A, "open_discovery")
    add(api, p, USER_B, "admin")
    add(api, p, USER_C, "lead_scientist")
    # admin cannot grant admin/owner, cannot touch the owner
    assert add(api, p, USER_D, "admin", actor=USER_B).status_code == 403
    assert add(api, p, USER_D, "lead_scientist", actor=USER_B).status_code == 201
    assert api.put(f"/projects/{p}/members/{USER_A}", headers=hdr(USER_B), json={"role": "viewer"}).status_code == 403
    assert api.delete(f"/projects/{p}/members/{USER_A}", headers=hdr(USER_B)).status_code == 403
    # a lead scientist cannot manage anyone
    assert add(api, p, "55555555-5555-4555-8555-555555555555", "viewer", actor=USER_C).status_code == 403
    assert api.delete(f"/projects/{p}/members/{USER_D}", headers=hdr(USER_C)).status_code == 403
    # last owner is protected, in both ways
    assert api.put(f"/projects/{p}/members/{USER_A}", headers=hdr(USER_A), json={"role": "admin"}).status_code == 409
    assert api.delete(f"/projects/{p}/members/{USER_A}", headers=hdr(USER_A)).status_code == 409
    # promote a second owner, then the first may step down; anyone may leave
    assert api.put(f"/projects/{p}/members/{USER_B}", headers=hdr(USER_A), json={"role": "owner"}).status_code == 200
    assert api.put(f"/projects/{p}/members/{USER_A}", headers=hdr(USER_B), json={"role": "admin"}).status_code == 200
    assert api.delete(f"/projects/{p}/members/{USER_C}", headers=hdr(USER_C)).status_code == 200
    assert api.get(f"/projects/{p}/members", headers=hdr(USER_C)).status_code == 404       # left: no access any more
    assert add(api, p, USER_B, "viewer").status_code == 409                                  # already a member


def test_audit_records_actions_is_admin_only_and_append_only(api, db_url):
    p, s1, s2, t, th = setup(api, mode="open_discovery")
    api.llms = models()
    add(api, p, USER_B, "researcher")
    add(api, p, USER_C, "viewer")
    ask(api, th, USER_B)
    api.post(f"/tasks/{t}/approve", headers=hdr(USER_B))        # refused: must NOT be audited as an approval
    log = api.get(f"/projects/{p}/audit", headers=hdr(USER_A)).json()["entries"]
    acts = [e["action"] for e in log]
    for a in ("project.create", "task.create", "source.upload", "member.add", "ask"):
        assert a in acts, acts
    assert "task.approve" not in acts
    ask_e = next(e for e in log if e["action"] == "ask")
    assert ask_e["actor"] == USER_B and ask_e["detail"]["kind"] == "consensus"
    only = api.get(f"/projects/{p}/audit", headers=hdr(USER_A), params={"action": "member.add"}).json()["entries"]
    assert len(only) == 2 and all(e["action"] == "member.add" for e in only)
    assert api.get(f"/projects/{p}/audit", headers=hdr(USER_B)).status_code == 403

    async def attack(pool):
        for sql in ("UPDATE audit_log SET actor=gen_random_uuid()", "DELETE FROM audit_log"):
            with pytest.raises(asyncpg.RaiseError):
                await pool.execute(sql)
        return await pool.fetchval("SELECT count(*) FROM audit_log WHERE project_id=$1", __import__("uuid").UUID(p))
    assert db_exec(db_url, attack) == len(api.get(f"/projects/{p}/audit", headers=hdr(USER_A), params={"limit": 200}).json()["entries"])


def test_budget_blocks_before_any_model_call_and_usage_is_metered(api):
    p, s1, s2, t, th = setup(api, mode="open_discovery")
    a, b = models()
    api.llms = (a, b)
    h = hdr(USER_A)
    add(api, p, USER_C, "researcher")
    assert api.put(f"/projects/{p}/budget", headers=hdr(USER_C), json={"monthly_call_budget": 3}).status_code == 403
    assert api.put(f"/projects/{p}/budget", headers=h, json={"monthly_call_budget": 3}).status_code == 200
    assert ask(api, th).status_code == 200                           # A, B and the cross-checker: 3 calls
    u = api.get(f"/projects/{p}/usage", headers=h).json()
    assert u["month_calls"] == 3 and u["remaining"] == 0 and u["by_kind"][0]["kind"] == "ask"
    before = len(a.calls) + len(b.calls)
    r = ask(api, th)
    assert r.status_code == 429 and r.json()["detail"]["error"] == "budget_exceeded"
    assert len(a.calls) + len(b.calls) == before                     # refused without touching a model
    assert api.post(f"/projects/{p}/signals/scan", headers=h, json={"categories": ["trend"]}).status_code == 429
    api.put(f"/projects/{p}/budget", headers=h, json={"monthly_call_budget": None})
    assert ask(api, th).status_code == 200
    assert api.get(f"/projects/{p}/usage", headers=h).json()["by_user"][0]["model_calls"] == 6


def test_gate_refusal_costs_nothing(api, monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "similarity_threshold", 0.99)
    p, s1, s2, t, th = setup(api, mode="open_discovery")
    api.llms = models()
    assert ask(api, th).status_code == 200
    assert api.get(f"/projects/{p}/usage", headers=hdr(USER_A)).json()["month_calls"] == 0
