"""Auth, ownership, the approval lock and the ask endpoint (fake models, real DB)."""
import json
from uuid import UUID

from app.config import Settings
from app.orchestration.llm import LLMError
from tests.fakes import (
    AGREED, USER_A, USER_B, ScriptedLLM, answer_json, db_exec, hdr,
)
from tests.helpers import make_pdf
from tests.test_sources_api import mk_project, upload

LIQUID = make_pdf([["Liquid injection samples were stable at 4 C", "for twelve weeks of refrigerated storage"]])
SECRET = make_pdf([["Confidential assay protocol", "internal compound zeta nine"]])
QUOTE = "stable at 4 C for twelve weeks"
Q = "How stable is the liquid injection?"


def models(a_text="Stable at 4 C for twelve weeks", b_text=None, **kw):
    b_text = b_text or a_text
    a = ScriptedLLM("A", answer_json(a_text, QUOTE))
    b = ScriptedLLM("B", answer_json(b_text, QUOTE), judge=kw.get("judge", AGREED))
    return a, b


def setup(api, mode="closed_repository", user=USER_A):
    p = mk_project(api, user, mode)
    s1 = upload(api, p, LIQUID, "liquid.pdf", user=user).json()["source_id"]
    s2 = upload(api, p, SECRET, "secret.pdf", user=user).json()["source_id"]
    t = api.post(f"/projects/{p}/tasks", headers=hdr(user), json={"title": "t"}).json()["id"]
    th = api.post(f"/tasks/{t}/threads", headers=hdr(user), json={}).json()["id"]
    return p, s1, s2, t, th


def ask(api, thread, user=USER_A):
    return api.post(f"/threads/{thread}/ask", headers=hdr(user), json={"question": Q})


# ---- auth ------------------------------------------------------------------

def test_auth_is_required_and_fails_closed(api, monkeypatch):
    assert api.get("/projects").status_code == 401
    assert api.get("/projects", headers=hdr(token="wrong")).status_code == 401
    assert api.get("/projects", headers={"X-Internal-Token": "test-internal-token"}).status_code == 401
    assert api.get("/projects", headers=hdr(USER_A) | {"X-User-Id": "not-a-uuid"}).status_code == 401
    assert api.post("/discover", json={"question": "abc"}).status_code == 401
    assert api.get("/projects", headers=hdr()).status_code == 200

    import app.auth
    monkeypatch.setattr(app.auth, "get_settings", lambda: Settings(_env_file=None, internal_token=""))
    assert api.get("/projects", headers=hdr()).status_code == 503


def test_users_only_see_and_touch_their_own_work(api):
    p, s1, s2, t, th = setup(api, user=USER_A)
    assert api.get("/projects", headers=hdr(USER_B)).json()["projects"] == []
    assert len(api.get("/projects", headers=hdr(USER_A)).json()["projects"]) == 1

    b = hdr(USER_B)
    assert api.post(f"/projects/{p}/tasks", headers=b, json={"title": "x"}).status_code == 404
    assert api.put(f"/tasks/{t}/sources", headers=b, json={"source_ids": [s1]}).status_code == 404
    assert api.post(f"/tasks/{t}/approve", headers=b).status_code == 404
    assert api.post(f"/tasks/{t}/threads", headers=b, json={}).status_code == 404
    assert ask(api, th, USER_B).status_code == 404
    assert api.get(f"/threads/{th}/messages", headers=b).status_code == 404


# ---- approval lock -----------------------------------------------------------

def test_closed_repository_requires_approval_then_locks_sources(api):
    api.llms = models()
    p, s1, s2, t, th = setup(api)

    assert ask(api, th).status_code == 409                                   # not approved yet
    assert api.post(f"/tasks/{t}/approve", headers=hdr()).status_code == 422  # no sources chosen

    r = api.put(f"/tasks/{t}/sources", headers=hdr(), json={"source_ids": [s1]})
    assert r.status_code == 200
    bogus = "00000000-0000-0000-0000-000000000000"
    assert api.put(f"/tasks/{t}/sources", headers=hdr(), json={"source_ids": [bogus]}).status_code == 422

    r = api.post(f"/tasks/{t}/approve", headers=hdr())
    assert r.status_code == 200 and len(r.json()["source_lock_hash"]) == 64
    assert api.post(f"/tasks/{t}/approve", headers=hdr()).status_code == 409           # only once
    assert api.put(f"/tasks/{t}/sources", headers=hdr(), json={"source_ids": [s1, s2]}).status_code == 409

    r = ask(api, th)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "consensus"
    assert body["verification"] == {"status": "complete", "verified": 2, "purged": 0}
    assert body["claims"][0]["match_kind"] == "normalized"        # PDF line break vs the model's single space
    chunk_id = body["claims"][0]["chunk_ids"][0]
    assert f"[cite: {chunk_id}]" in body["content"]

    # the models only ever saw the locked source, never the other document
    prompt = api.llms[0].calls[0][1]
    assert "Liquid injection samples" in prompt and "Confidential assay" not in prompt

    async def owner(pool):
        return await pool.fetchval("SELECT source_id FROM chunks WHERE id=$1", UUID(chunk_id))
    assert str(db_exec_owner(api, owner)) == s1


def db_exec_owner(api, fn):
    import os
    return db_exec(os.environ["TEST_DATABASE_URL"], fn)


def test_tampering_with_sources_after_approval_is_refused(api):
    api.llms = models()
    p, s1, s2, t, th = setup(api)
    api.put(f"/tasks/{t}/sources", headers=hdr(), json={"source_ids": [s1]})
    api.post(f"/tasks/{t}/approve", headers=hdr())
    assert ask(api, th).status_code == 200

    async def sneak(pool):   # someone bypasses the API and adds a source
        await pool.execute("INSERT INTO task_sources (task_id, source_id) VALUES ($1, $2)", UUID(t), UUID(s2))
    db_exec_owner(api, sneak)

    r = ask(api, th)
    assert r.status_code == 409 and "lock mismatch" in r.json()["detail"]


# ---- ask outcomes ------------------------------------------------------------------

def test_messages_are_stored_with_kind_and_both_model_outputs(api):
    api.llms = models()
    p, s1, s2, t, th = setup(api)
    api.put(f"/tasks/{t}/sources", headers=hdr(), json={"source_ids": [s1]})
    api.post(f"/tasks/{t}/approve", headers=hdr())
    ask(api, th)

    msgs = api.get(f"/threads/{th}/messages", headers=hdr()).json()["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert msgs[1]["answer_kind"] == "consensus" and msgs[1]["top_similarity"] > 0

    async def raw(pool):
        return await pool.fetchrow(
            "SELECT model_a_raw::text a, model_b_raw::text b FROM messages WHERE role='assistant'")
    row = db_exec_owner(api, raw)
    assert json.loads(row["a"])["status"] == "answered"
    assert "judge" in json.loads(row["b"]) and json.loads(row["b"])["answer"]["status"] == "answered"


def test_disagreement_is_returned_and_stored(api):
    judge = json.dumps({"a_claims": [{"id": 1, "status": "contradicted", "b_ids": [1]}], "conflicts": [
        {"topic": "Storage temperature", "a_id": 1, "b_id": 1, "explanation": "4 C vs 25 C"}]})
    api.llms = models("Stable at 4 C", "Stable for twelve weeks of refrigerated storage", judge=judge)
    p, s1, s2, t, th = setup(api, mode="open_discovery")

    r = ask(api, th)           # open discovery: no approval, whole session is the source of truth
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "disagreement" and body["claims"] == []
    assert body["disagreement"]["conflicts"][0]["topic"] == "Storage temperature"
    assert "did not agree" in body["content"]

    msgs = api.get(f"/threads/{th}/messages", headers=hdr()).json()["messages"]
    assert msgs[-1]["answer_kind"] == "disagreement"
    assert msgs[-1]["disagreement"]["conflicts"][0]["position_a"]["text"] == "Stable at 4 C"


def test_insufficient_evidence(api):
    none = answer_json("", "", status="insufficient_source_evidence")
    api.llms = (ScriptedLLM("A", none), ScriptedLLM("B", none))
    p, s1, s2, t, th = setup(api, mode="open_discovery")
    body = ask(api, th).json()
    assert body["kind"] == "insufficient_evidence" and body["content"].startswith("INSUFFICIENT_SOURCE_EVIDENCE")


def test_cross_check_failure_withholds_the_answer(api):
    a = ScriptedLLM("A", "", error=LLMError("A: down"))
    api.llms = (a, ScriptedLLM("B", answer_json("x", QUOTE), judge=AGREED))
    p, s1, s2, t, th = setup(api, mode="open_discovery")

    r = ask(api, th)
    assert r.status_code == 503
    assert r.json()["detail"]["error"] == "cross_check_unavailable"
    msgs = api.get(f"/threads/{th}/messages", headers=hdr()).json()["messages"]
    assert [m["role"] for m in msgs] == ["user"]            # no assistant answer was stored


# ---- Phase 5: gate, integrity, citations -----------------------------------------

def _closed(api):
    p, s1, s2, t, th = setup(api)
    api.put(f"/tasks/{t}/sources", headers=hdr(), json={"source_ids": [s1]})
    api.post(f"/tasks/{t}/approve", headers=hdr())
    return th


def test_loose_matches_still_go_to_the_models(api, monkeypatch):
    # Passages below the usual match level are never refused: both models read them, and the quote check decides.
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "similarity_threshold", 0.99)
    api.llms = models()
    th = _closed(api)
    body = ask(api, th).json()
    assert body["gate"]["passed"] is True and body["gate"]["below_threshold"] is True
    assert body["reason"] != "below_similarity_threshold"
    assert api.llms[0].calls and api.llms[1].calls
    msgs = api.get(f"/threads/{th}/messages", headers=hdr()).json()["messages"]
    assert msgs[-1]["top_similarity"] < 0.99


def test_gate_passes_when_similarity_is_high_enough(api, monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "similarity_threshold", 0.01)
    api.llms = models()
    body = ask(api, _closed(api)).json()
    assert body["kind"] == "consensus" and body["gate"]["passed"] is True


def test_corrupted_chunk_is_never_shown_to_a_model(api):
    api.llms = models()
    th = _closed(api)

    async def corrupt(pool):
        async with pool.acquire() as c:
            await c.execute("ALTER TABLE chunks DISABLE TRIGGER USER")
            await c.execute("UPDATE chunks SET text = text || ' TAMPERED'")
            await c.execute("ALTER TABLE chunks ENABLE TRIGGER USER")
    db_exec_owner(api, corrupt)

    body = ask(api, th).json()
    assert body["kind"] == "insufficient_evidence" and body["reason"] == "integrity_failure"
    assert body["gate"]["corrupt_chunks_dropped"] >= 1
    assert api.llms[0].calls == []


def test_citations_are_persisted_with_hash_and_match_info(api):
    api.llms = models()
    th = _closed(api)
    body = ask(api, th).json()
    assert body["verification"]["verified"] == 2

    async def rows(pool):
        return await pool.fetch(
            """SELECT c.model, c.status::text AS status, c.match_kind, c.reason, c.hash_checked,
                      c.quoted_span, k.sha256 AS chunk_sha
               FROM citations c JOIN chunks k ON k.id = c.chunk_id ORDER BY c.model""")
    got = db_exec_owner(api, rows)
    assert [r["model"] for r in got] == ["model_a", "model_b"]
    for r in got:
        assert r["status"] == "verified" and r["reason"] == "ok" and r["match_kind"] == "normalized"
        assert r["hash_checked"] == r["chunk_sha"] and r["quoted_span"] == QUOTE


def test_fabricated_claim_is_purged_and_recorded(api):
    two = json.dumps({"status": "answered", "claims": [
        {"text": "Stable at 4 C for twelve weeks", "cites": ["C1"], "quote": QUOTE},
        {"text": "Stable for 52 weeks at 4 C", "cites": ["C1"], "quote": "stable for 52 weeks at 4 C"}]})
    agreed = json.dumps({"a_claims": [{"id": 1, "status": "agreed", "b_ids": [1]}], "conflicts": []})
    api.llms = (ScriptedLLM("A", two), ScriptedLLM("B", answer_json("Stable at 4 C for twelve weeks", QUOTE),
                                                    judge=agreed))
    th = _closed(api)
    body = ask(api, th).json()
    assert body["kind"] == "consensus" and len(body["claims"]) == 1
    assert body["verification"] == {"status": "complete", "verified": 2, "purged": 1}
    assert "52 weeks" not in body["content"] and body["claims"][0]["text"] == "Stable at 4 C for twelve weeks"

    async def rows(pool):
        return await pool.fetch("SELECT claim_text, status::text AS status, reason, hash_checked "
                                "FROM citations WHERE status='purged'")
    got = db_exec_owner(api, rows)
    assert len(got) == 1 and got[0]["reason"] == "quote_not_found" and "52" in got[0]["claim_text"]
    assert got[0]["hash_checked"] is None


def test_ui_read_endpoints_and_citation_metadata_in_history(api):
    api.llms = models()
    p, s1, s2, t, th = setup(api)
    api.put(f"/tasks/{t}/sources", headers=hdr(), json={"source_ids": [s1]})
    api.post(f"/tasks/{t}/approve", headers=hdr())

    assert api.get(f"/projects/{p}", headers=hdr()).json()["mode"] == "closed_repository"
    assert api.get(f"/projects/{p}/tasks", headers=hdr()).json()["tasks"][0]["status"] == "approved"
    task = api.get(f"/tasks/{t}", headers=hdr()).json()
    assert task["source_ids"] == [s1] and task["threads"][0]["id"] == th and task["source_lock_hash"]
    assert api.get(f"/tasks/{t}", headers=hdr(USER_B)).status_code == 404
    assert api.get(f"/projects/{p}", headers=hdr(USER_B)).status_code == 404

    body = ask(api, th).json()
    cid = body["claims"][0]["chunk_ids"][0]
    meta = body["chunks"][cid]
    assert meta["filename"] == "liquid.pdf" and meta["page_start"] == 1 and "stable at 4 C" in meta["text"]

    hist = api.get(f"/threads/{th}/messages", headers=hdr()).json()["messages"]
    assert hist[0]["final"] is None
    assert hist[1]["final"]["claims"][0]["quote"] == QUOTE and hist[1]["final"]["chunks"][cid]["sha256"]


# ---- sources: My uploads / Online / Uploads + online ----------------------------------------------------------

def _fake_online(monkeypatch, n=12):
    """Replace the literature APIs with n papers (relevance order 0..n-1). Returns the list of searches made."""
    import app.routes_tasks as rt
    from app.retrieval.models import DiscoveryResult, Paper
    calls = []

    async def fake_search(question, **kw):
        calls.append(question)
        papers = [Paper(title=f"Liquid injection study {i}", doi=f"10.9/{i}", relevance=1 - i / 50,
                        abstract=f"Liquid injection samples were stable at 4 C for twelve weeks in study {i}.")
                  for i in range(n)]
        return DiscoveryResult(papers=papers, dropped=[], stats={"query": question, "found": n, "seconds": 0.1},
                               errors=[])
    monkeypatch.setattr(rt, "search_papers", fake_search)
    return calls


def _open_chat(api, project):
    t = api.post(f"/projects/{project}/tasks", headers=hdr(), json={"title": "t"}).json()["id"]
    return lambda: api.post(f"/tasks/{t}/threads", headers=hdr(), json={}).json()["id"]


def _ask(api, th, **body):
    r = api.post(f"/threads/{th}/ask", headers=hdr(), json={"question": Q, "online": True, "top_k": 5, **body})
    assert r.status_code == 200, r.text
    return r.json()


def _strict(monkeypatch):
    import app.routes_tasks as rt
    strict = rt.get_settings().model_copy(update={"similarity_threshold": 1.01})
    monkeypatch.setattr(rt, "get_settings", lambda: strict)


def _user_msgs(db_url, th):
    return db_exec(db_url, lambda c: c.fetchval(
        "SELECT count(*) FROM messages WHERE thread_id=$1 AND role='user'", UUID(th)))


def test_uploads_mode_uses_every_project_upload_and_never_searches(api, monkeypatch):
    calls = _fake_online(monkeypatch)
    api.llms = models()
    p = mk_project(api, mode="open_discovery")
    upload(api, p, LIQUID, "liquid.pdf")                  # uploaded earlier, e.g. in another chat
    new_chat = _open_chat(api, p)
    for th in (new_chat(), new_chat()):
        r = _ask(api, th, scope="uploads")
        assert r["gate"]["evidence_from"] == "saved_sources" and r["gate"]["passed"]
    assert calls == []


def test_online_mode_searches_first_then_answers_followups_from_stored_papers(api, db_url, monkeypatch):
    calls = _fake_online(monkeypatch)
    api.llms = models()
    p = mk_project(api, mode="open_discovery")
    upload(api, p, SECRET, "private-upload.pdf")
    new_chat = _open_chat(api, p)
    th = new_chat()

    # first question: fresh search; the APIs' top 10 are stored for the project (kept, listed in the library)
    r = _ask(api, th, scope="api")
    assert len(calls) == 1 and r["gate"]["evidence_from"] == "online_search"
    papers = db_exec(db_url, lambda c: c.fetch(
        "SELECT title, in_library FROM sources WHERE project_id=$1 AND origin <> 'user_upload'", UUID(p)))
    assert sorted(x["title"] for x in papers) == sorted(f"Liquid injection study {i}" for i in range(10))
    assert all(x["in_library"] for x in papers)

    # follow-up: answered from the stored papers, no search
    r = _ask(api, th, scope="api")
    assert len(calls) == 1 and r["gate"]["evidence_from"] == "saved_sources"
    # the first question of another chat searches again; papers already stored are reused, not duplicated
    r = _ask(api, new_chat(), scope="api")
    assert len(calls) == 2 and r["gate"]["online"]["reused"] == 10 and r["gate"]["online"]["stored"] == 10
    assert db_exec(db_url, lambda c: c.fetchval("SELECT count(*) FROM sources WHERE project_id=$1", UUID(p))) == 11
    # uploads are never shown to the models in Online mode
    assert all("Confidential assay protocol" not in prompt for _, prompt in api.llms[0].calls)

    # loosely matching stored papers are never refused: the models read them; nothing is searched, the answer is stored
    _strict(monkeypatch)
    before = _user_msgs(db_url, th)
    r = _ask(api, th, scope="api")
    assert r["kind"] != "not_in_saved_sources" and r["gate"]["below_threshold"] is True
    assert r["gate"]["evidence_from"] == "saved_sources" and len(calls) == 2
    assert _user_msgs(db_url, th) == before + 1


def test_uploads_and_online_combines_uploads_and_papers_then_answers_followups_from_them(api, db_url, monkeypatch):
    calls = _fake_online(monkeypatch)
    api.llms = models()
    p = mk_project(api, mode="open_discovery")
    upload(api, p, LIQUID, "liquid.pdf")
    th = _open_chat(api, p)()

    # first question: uploads + a fresh search, one combined answer from both
    r = _ask(api, th, scope="both")
    assert len(calls) == 1 and r["gate"]["evidence_from"] == "online_search" and r["gate"]["saved_sources"] == 11
    # Model A's answer prompt (its other call is the cross-check) holds upload text and online paper text
    assert any("refrigerated storage" in prompt and "in study" in prompt for _, prompt in api.llms[0].calls)

    # follow-up: uploads + stored papers answer it, no search
    r = _ask(api, th, scope="both")
    assert len(calls) == 1 and r["gate"]["evidence_from"] == "saved_sources" and r["gate"]["saved_sources"] == 11
    # loosely matching sources are never refused: the models read them; nothing new is searched
    _strict(monkeypatch)
    before = _user_msgs(db_url, th)
    r = _ask(api, th, scope="both")
    assert r["kind"] != "not_in_saved_sources" and r["gate"]["below_threshold"] is True
    assert len(calls) == 1 and _user_msgs(db_url, th) == before + 1


def test_uploads_and_online_without_uploads_goes_straight_online(api, monkeypatch):
    calls = _fake_online(monkeypatch)
    api.llms = models()
    th = _open_chat(api, mk_project(api, mode="open_discovery"))()
    r = _ask(api, th, scope="both")
    assert len(calls) == 1 and r["gate"]["evidence_from"] == "online_search"


def test_uploads_and_online_search_run_concurrently(api, db_url, monkeypatch):
    import asyncio
    import app.routes_tasks as rt
    from app.retrieval.models import DiscoveryResult, Paper

    saved_started, online_started = asyncio.Event(), asyncio.Event()
    real_search = rt.store.search_per_source

    async def gated_search(pool, query, source_ids, per_source):
        if not online_started.is_set():
            saved_started.set()
            await asyncio.wait_for(online_started.wait(), timeout=3)
        return await real_search(pool, query, source_ids, per_source)

    async def fake_search(question, **kw):
        await asyncio.wait_for(saved_started.wait(), timeout=3)
        online_started.set()
        papers = [Paper(title="Parallel online study", doi="10.7/parallel", relevance=1,
                        abstract="Liquid injection samples were stable at 4 C for twelve weeks.")]
        return DiscoveryResult(papers=papers, dropped=[], stats={"query": question, "found": 1, "seconds": 0.1},
                               errors=[])

    monkeypatch.setattr(rt.store, "search_per_source", gated_search)
    monkeypatch.setattr(rt, "search_papers", fake_search)
    api.llms = models()

    p = mk_project(api, mode="open_discovery")
    upload(api, p, SECRET, "private-upload.pdf")
    th = _open_chat(api, p)()
    r = _ask(api, th, scope="both")
    assert online_started.is_set() and r["gate"]["evidence_from"] == "online_search"
    assert r["gate"]["saved_sources"] == 2


def test_nothing_to_read_cases(api, monkeypatch):
    import app.routes_tasks as rt
    from app.retrieval.models import DiscoveryResult
    api.llms = models()
    p = mk_project(api, mode="open_discovery")
    new_chat = _open_chat(api, p)
    # My uploads with no uploads in the project
    r = _ask(api, new_chat(), scope="uploads")
    assert r["reason"] == "no_uploads" and "no uploaded documents" in r["content"]

    # the literature APIs return nothing
    async def empty(question, **kw):
        return DiscoveryResult(papers=[], dropped=[], stats={"query": question, "found": 0, "seconds": 0.1},
                               errors=["openalex:page1:HTTPStatusError", "europe_pmc:search:timeout"])
    monkeypatch.setattr(rt, "search_papers", empty)
    r = _ask(api, new_chat(), scope="api")
    assert r["reason"] == "online_search_failed" and "try again" in r["content"]

    # storing online papers crashes: Uploads + online still answers from the uploads
    _fake_online(monkeypatch)
    upload(api, p, LIQUID, "liquid.pdf")

    async def broken(*a, **kw):
        raise RuntimeError("storage down")
    monkeypatch.setattr(rt, "build_session_sources", broken)
    r = _ask(api, new_chat(), scope="both")
    assert r["gate"]["passed"] and r["gate"]["online"]["errors"] == ["online:RuntimeError"]


def test_saved_sources_on_topic_but_without_an_answer_lead_to_an_online_search(api, db_url, monkeypatch):
    calls = _fake_online(monkeypatch)
    p = mk_project(api, mode="open_discovery")
    th = _open_chat(api, p)()
    api.llms = models()
    _ask(api, th, scope="api")                                  # first question: stores papers
    assert len(calls) == 1
    before = _user_msgs(db_url, th)

    # follow-up: the stored papers are on topic, but both models find no answer in them
    no_answer = answer_json("n/a", QUOTE, status="insufficient_source_evidence")
    api.llms = (ScriptedLLM("A", no_answer, judge=AGREED), ScriptedLLM("B", no_answer, judge=AGREED))
    r = _ask(api, th, scope="api")
    assert r["kind"] == "not_in_saved_sources" and r["reason"] == "saved_sources_did_not_answer"
    assert len(calls) == 1 and _user_msgs(db_url, th) == before     # nothing searched yet, question not stored

    # the client asks again online: searched, and the question is stored once
    api.llms = models()
    r = _ask(api, th, scope="api", evidence="online")
    assert len(calls) == 2 and r["gate"]["evidence_from"] == "online_search" and _user_msgs(db_url, th) == before + 1


def test_uploads_mode_never_searches_even_without_an_answer_or_when_asked_online(api, monkeypatch):
    calls = _fake_online(monkeypatch)
    p = mk_project(api, mode="open_discovery")
    upload(api, p, LIQUID, "liquid.pdf")
    th = _open_chat(api, p)()
    no_answer = answer_json("n/a", QUOTE, status="insufficient_source_evidence")
    api.llms = (ScriptedLLM("A", no_answer, judge=AGREED), ScriptedLLM("B", no_answer, judge=AGREED))
    for _ in range(2):                                      # first question and follow-up
        r = _ask(api, th, scope="uploads")
        assert r["kind"] == "insufficient_evidence" and r["gate"]["evidence_from"] == "saved_sources"
    r = _ask(api, th, scope="uploads", evidence="online")   # a client asking online with My uploads
    assert r["gate"]["evidence_from"] == "saved_sources" and calls == []
