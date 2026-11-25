"""Evidence library against real Postgres (needs TEST_DATABASE_URL; CI runs these).

The research itself is replaced by a no-op, so no paper search or model call happens. What is tested here is the
scheduling, the run states the API shows, the 409 / retry rules, the start-up sweep and access control."""
import asyncio
from uuid import UUID, uuid4

import pytest

from app import evidence
from tests.fakes import USER_B, hdr
from tests.helpers import make_pool


def on_db(url, fn):
    """Run `async fn(pool)` on its own pool, outside the app's event loop."""
    async def go():
        pool = await make_pool(url)
        try:
            return await fn(pool)
        finally:
            await pool.close()
    return asyncio.run(go())


@pytest.fixture(autouse=True)
def no_research(monkeypatch):
    async def idle(task_id, requested_by):
        return None
    monkeypatch.setattr(evidence, "run_evidence", idle)


def make_project(api, packages):
    body = {
        "name": "Heat recovery", "mode": "open_discovery", "meta": {},
        "charter": {"type": "Technical Feasibility", "objective": "Recover heat"},
        "work_packages": packages,
    }
    r = api.post("/projects/complete", headers=hdr(), json=body)
    assert r.status_code == 201, r.text
    return r.json()


def start_research(api, tid):
    """What the Start research button does."""
    assert api.post(f"/tasks/{tid}/evidence/run", headers=hdr()).status_code == 202


def runs_by_task(api, pid):
    runs = api.get(f"/projects/{pid}/evidence", headers=hdr()).json()["runs"]
    return {r["task_id"]: r for r in runs}


# ---- scheduling on project create and add work package --------------------------------------------------------

def test_new_project_leaves_research_to_the_user_to_start(api):
    p = make_project(api, [{"title": "Pilot study", "brief": "{}"}, {"title": "Costing"}])
    statuses = sorted(r["status"] for r in runs_by_task(api, p["id"]).values())
    assert statuses == ["not_started", "not_started"]


def test_work_package_added_later_gets_next_code_and_a_queued_run(api):
    p = make_project(api, [])
    first = api.post(f"/projects/{p['id']}/work-packages", headers=hdr(), json={"title": "Late one"})
    second = api.post(f"/projects/{p['id']}/work-packages", headers=hdr(), json={"title": "Late two"})
    assert first.status_code == 201 and second.status_code == 201
    assert [first.json()["code"], second.json()["code"]] == ["WP-1", "WP-2"]
    runs = runs_by_task(api, p["id"])
    assert sorted(r["status"] for r in runs.values()) == ["not_started", "not_started"]


def test_work_package_with_no_run_is_listed_as_not_started_and_can_be_run(api, db_url):
    p = make_project(api, [{"title": "Orphan"}])
    (tid, run), = runs_by_task(api, p["id"]).items()
    on_db(db_url, lambda pool: pool.execute("DELETE FROM evidence_runs WHERE task_id=$1", UUID(tid)))

    listed = runs_by_task(api, p["id"])[tid]
    assert listed["status"] == "not_started"
    assert listed["papers_read"] == 0

    r = api.post(f"/tasks/{tid}/evidence/run", headers=hdr())
    assert r.status_code == 202
    assert runs_by_task(api, p["id"])[tid]["status"] == "queued"


# ---- run again / retry rules ----------------------------------------------------------------------------------

def test_run_again_is_refused_while_a_run_is_queued(api):
    p = make_project(api, [{"title": "Busy"}])
    (tid, _), = runs_by_task(api, p["id"]).items()
    start_research(api, tid)
    r = api.post(f"/tasks/{tid}/evidence/run", headers=hdr())
    assert r.status_code == 409


def test_retry_after_failure_requeues_and_keeps_the_error_until_then(api, db_url):
    p = make_project(api, [{"title": "Flaky"}])
    (tid, _), = runs_by_task(api, p["id"]).items()
    start_research(api, tid)                 # the run must exist before it can fail
    on_db(db_url, lambda pool: pool.execute(
        "UPDATE evidence_runs SET status='failed', error='provider down', finished_at=now() WHERE task_id=$1", UUID(tid)))

    before = runs_by_task(api, p["id"])[tid]
    assert before["status"] == "failed" and before["error"] == "provider down"

    assert api.post(f"/tasks/{tid}/evidence/run", headers=hdr()).status_code == 202
    after = runs_by_task(api, p["id"])[tid]
    assert after["status"] == "queued" and after["error"] is None


# ---- start-up sweep -------------------------------------------------------------------------------------------

def test_sweep_fails_only_runs_that_started_long_ago(api, db_url):
    p = make_project(api, [{"title": "Old"}, {"title": "Fresh"}])
    runs = runs_by_task(api, p["id"])
    old_tid, fresh_tid = sorted(runs)  # order is irrelevant; we only need two distinct tasks
    start_research(api, old_tid)
    start_research(api, fresh_tid)
    on_db(db_url, lambda pool: pool.execute(
        "UPDATE evidence_runs SET started_at = now() - interval '2 hours' WHERE task_id=$1", UUID(old_tid)))

    on_db(db_url, evidence.sweep_stale)

    after = runs_by_task(api, p["id"])
    assert after[old_tid]["status"] == "failed"
    assert "interrupted" in after[old_tid]["error"]
    assert after[fresh_tid]["status"] == "queued"


# ---- access and not-found -------------------------------------------------------------------------------------

def test_evidence_library_is_hidden_from_non_members(api):
    p = make_project(api, [{"title": "Private"}])
    r = api.get(f"/projects/{p['id']}/evidence", headers=hdr(USER_B))
    assert r.status_code in (403, 404)


def test_unknown_evidence_item_is_404(api):
    p = make_project(api, [{"title": "Empty"}])
    (tid, _), = runs_by_task(api, p["id"]).items()
    r = api.get(f"/tasks/{tid}/evidence/{uuid4()}", headers=hdr())
    assert r.status_code == 404


def test_references_endpoint_is_served_before_the_item_route(api):
    p = make_project(api, [{"title": "Cited"}])
    (tid, _), = runs_by_task(api, p["id"]).items()
    r = api.get(f"/tasks/{tid}/evidence/references", headers=hdr())
    assert r.status_code == 200
    body = r.json()
    assert body["heading"] == "Evidence references"
    assert body["doc"]["type"] == "doc"


def test_research_inputs_load_against_the_real_schema(api, db_url):
    # The research question is built from this row; a wrong column name here stopped every run in production.
    p = make_project(api, [{"title": "Pilot study", "brief": "Test the pilot"}])
    (tid, _), = runs_by_task(api, p["id"]).items()
    row = on_db(db_url, lambda pool: evidence._research_row(pool, UUID(tid)))
    assert row["title"] == "Pilot study"
    assert row["stage"] == "Discovery"
    assert row["name"] == "Heat recovery"


def test_gate_report_says_approval_is_not_recorded(api):
    p = make_project(api, [{"title": "Reported"}])
    (tid, _), = runs_by_task(api, p["id"]).items()
    r = api.get(f"/tasks/{tid}/evidence/report", headers=hdr())
    assert r.status_code == 200
    body = r.json()
    assert body["work_package"]["code"] == "WP-1"
    assert body["research"]["status"] == "not_started"
    assert body["approval"]["status"] == "not_recorded"
    assert body["evidence"]["total"] == 0 and body["measurements"] == []


def test_refinement_writes_nothing_until_it_is_applied(api):
    from tests.fakes import ScriptedLLM
    p = make_project(api, [])
    proposal = '{"changes":[{"target":"project","field":"lead","value":"Sara Chen"}],"reply":"Sara Chen is the lead."}'
    api.llms = (ScriptedLLM("A", proposal), ScriptedLLM("B", proposal))

    r = api.post(f"/projects/{p['id']}/refine/propose", headers=hdr(), json={"instruction": "make Sara Chen the lead"})
    assert r.status_code == 200
    assert r.json()["changes"][0]["value"] == "Sara Chen"
    listed = api.get("/projects", headers=hdr()).json()["projects"]
    assert next(x for x in listed if x["id"] == p["id"])["meta"].get("lead") != "Sara Chen"

    applied = api.post(f"/projects/{p['id']}/refine/apply", headers=hdr(), json={"changes": r.json()["changes"]})
    assert applied.status_code == 200 and applied.json()["applied"] == 1
    listed = api.get("/projects", headers=hdr()).json()["projects"]
    assert next(x for x in listed if x["id"] == p["id"])["meta"]["lead"] == "Sara Chen"
