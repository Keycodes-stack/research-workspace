"""A Home chat is saved as one work package in its project (database tests; CI and the local test database run them)."""
from uuid import UUID

import app.chat_work_package as cwp
from tests.fakes import ScriptedLLM, answer_json, db_exec, hdr
from tests.test_tasks_api import AGREED, QUOTE, ask, models, setup


def enable(monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "chat_work_packages", True)


def wp_count(db_url, project):
    return db_exec(db_url, lambda c: c.fetchval(
        "SELECT count(*) FROM work_packages WHERE project_id=$1", UUID(project)))


def test_first_answer_creates_one_work_package_with_evidence(api, db_url, monkeypatch):
    enable(monkeypatch)
    p, s1, s2, t, th = setup(api, mode="open_discovery")
    api.llms = models()
    body = ask(api, th).json()
    wp = body["work_package"]
    assert wp["code"] == "WP-1" and wp["title"]
    assert wp_count(db_url, p) == 1
    run = db_exec(db_url, lambda c: c.fetchrow(
        "SELECT status FROM evidence_runs WHERE task_id=$1", UUID(wp["task_id"])))
    assert run["status"] == "complete"
    assert db_exec(db_url, lambda c: c.fetchval(
        "SELECT count(*) FROM evidence_items WHERE task_id=$1", UUID(wp["task_id"]))) >= 1


def test_a_follow_up_in_the_same_chat_updates_the_same_work_package(api, db_url, monkeypatch):
    enable(monkeypatch)
    p, s1, s2, t, th = setup(api, mode="open_discovery")
    api.llms = models()
    first = ask(api, th).json()["work_package"]
    second = ask(api, th).json()["work_package"]
    assert first["task_id"] == second["task_id"] and second["code"] == "WP-1"
    assert wp_count(db_url, p) == 1


def test_a_chat_with_no_verified_claims_still_creates_its_work_package(api, db_url, monkeypatch):
    enable(monkeypatch)
    p, s1, s2, t, th = setup(api, mode="open_discovery")
    none = answer_json("n/a", QUOTE, status="insufficient_source_evidence")
    api.llms = (ScriptedLLM("A", none, judge=AGREED), ScriptedLLM("B", none, judge=AGREED))
    body = ask(api, th).json()
    assert body.get("work_package", {}).get("code") == "WP-1"


def test_an_edited_overview_is_not_rewritten(api, db_url, monkeypatch):
    enable(monkeypatch)
    p, s1, s2, t, th = setup(api, mode="open_discovery")
    api.llms = models()
    tid = ask(api, th).json()["work_package"]["task_id"]
    edited = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"My edit"}]}]}'
    db_exec(db_url, lambda c: c.execute(
        "UPDATE work_package_documents SET body=$2, version=1 WHERE task_id=$1", UUID(tid), edited))
    ask(api, th)
    body = db_exec(db_url, lambda c: c.fetchval(
        "SELECT body FROM work_package_documents WHERE task_id=$1", UUID(tid)))
    assert "My edit" in body                          # the user's own text is kept
    assert "Findings" in body                         # the generated sections are refreshed in place


def test_the_switch_off_creates_nothing(api, db_url, monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "chat_work_packages", False)
    p, s1, s2, t, th = setup(api, mode="open_discovery")
    api.llms = models()
    body = ask(api, th).json()
    assert "work_package" not in body and wp_count(db_url, p) == 0


def test_a_failing_save_never_breaks_the_answer(api, db_url, monkeypatch):
    enable(monkeypatch)

    async def boom(*args, **kwargs):
        raise RuntimeError("database hiccup")
    monkeypatch.setattr(cwp, "sync_chat_work_package", boom)
    p, s1, s2, t, th = setup(api, mode="open_discovery")
    api.llms = models()
    r = ask(api, th)
    assert r.status_code == 200 and r.json()["kind"] == "consensus" and "work_package" not in r.json()


def test_the_on_demand_route_is_safe_to_repeat(api, db_url, monkeypatch):
    enable(monkeypatch)
    p, s1, s2, t, th = setup(api, mode="open_discovery")
    api.llms = models()
    ask(api, th)
    url = f"/projects/{p}/chats/{th}/work-package"
    first = api.post(url, headers=hdr()).json()
    again = api.post(url, headers=hdr()).json()
    assert first["task_id"] == again["task_id"] and wp_count(db_url, p) == 1
