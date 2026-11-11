import asyncio
import json
from uuid import UUID

from app.realtime import notify, stream_events
from tests.fakes import USER_A, USER_B, db_exec, hdr
from tests.helpers import make_pool
from tests.test_admin import USER_C, USER_D, add
from tests.test_concepts import make_concept, no_gate  # noqa: F401


def team(api):
    p, _, cid = make_concept(api)
    add(api, p, USER_B, "researcher")
    add(api, p, USER_C, "viewer")
    add(api, p, USER_D, "lead_scientist")
    return p, cid


def comment(api, cid, user=USER_A, body="Looks plausible", stance="support", **kw):
    return api.post(f"/concepts/{cid}/comments", headers=hdr(user), json={"body": body, "stance": stance, **kw})


# ---- comments -------------------------------------------------------------------------------------------

def test_threads_inherit_section_and_summary_counts_open_roots(api):
    p, cid = team(api)
    root = comment(api, cid, USER_A, "The 12 weeks claim needs a control", "challenge", section="hypothesis").json()["id"]
    reply = comment(api, cid, USER_B, "Table 2 has the control arm", "support", parent_id=root, section="risks")
    assert reply.status_code == 201
    comment(api, cid, USER_B, "What storage temperature?", "question", section="problem")
    got = api.get(f"/concepts/{cid}/comments", headers=hdr(USER_C)).json()           # viewers can read
    by_id = {c["id"]: c for c in got["comments"]}
    assert by_id[reply.json()["id"]]["section"] == "hypothesis" and by_id[reply.json()["id"]]["parent_id"] == root
    assert got["summary"] == {"hypothesis": {"support": 0, "challenge": 1, "question": 0, "note": 0},
                              "problem": {"support": 0, "challenge": 0, "question": 1, "note": 0}}
    assert "not source-verified" in got["note"]


def test_comment_permissions_and_validation(api):
    p, cid = team(api)
    assert comment(api, cid, USER_C).status_code == 403                                    # viewer
    assert comment(api, cid, "99999999-9999-4999-8999-999999999999").status_code == 404    # non-member
    assert comment(api, cid, body="   ").status_code == 422 and comment(api, cid, body="").status_code == 422
    assert comment(api, cid, stance="agree").status_code == 422
    assert comment(api, cid, parent_id="00000000-0000-4000-8000-000000000000").status_code == 400


def test_resolve_needs_author_or_lead_scientist(api):
    p, cid = team(api)
    root = comment(api, cid, USER_A, "Needs a control", "challenge", section="hypothesis").json()["id"]
    assert api.post(f"/comments/{root}/resolve", headers=hdr(USER_B), json={"resolved": True}).status_code == 403
    assert api.post(f"/comments/{root}/resolve", headers=hdr(USER_D), json={"resolved": True}).status_code == 200   # lead scientist
    assert api.get(f"/concepts/{cid}/comments", headers=hdr()).json()["summary"] == {}                             # no open roots left
    assert api.post(f"/comments/{root}/resolve", headers=hdr(USER_A), json={"resolved": False}).status_code == 200  # author reopens
    assert api.get(f"/concepts/{cid}/comments", headers=hdr()).json()["summary"]["hypothesis"]["challenge"] == 1


# ---- locks -----------------------------------------------------------------------------------------------

def test_lock_is_advisory_exclusive_and_expires(api, db_url):
    p, cid = team(api)
    url = f"/concepts/{cid}/sections/problem/lock"
    assert api.post(url, headers=hdr(USER_A)).status_code == 200
    r = api.post(url, headers=hdr(USER_B))
    assert r.status_code == 409 and r.json()["detail"]["held_by"] == USER_A
    assert api.post(url, headers=hdr(USER_A)).status_code == 200                      # holder refreshes
    assert api.post(url, headers=hdr(USER_C)).status_code == 403                      # viewers can't lock
    assert api.delete(url, headers=hdr(USER_B)).json() == {"released": False}         # not the holder
    # advisory: B can still save, and the version check is what protects the text
    ok = api.put(f"/concepts/{cid}/sections/problem", headers=hdr(USER_B), json={"body": "B text", "base_version": 0})
    assert ok.status_code == 200
    assert api.get(f"/concepts/{cid}/locks", headers=hdr()).json()["locks"][0]["user_id"] == USER_A

    async def expire(pool):
        await pool.execute("UPDATE section_locks SET expires_at = now() - interval '1 second'")
    db_exec(db_url, expire)
    assert api.get(f"/concepts/{cid}/locks", headers=hdr()).json()["locks"] == []
    assert api.post(url, headers=hdr(USER_B)).status_code == 200                      # expired lock can be taken
    assert api.delete(url, headers=hdr(USER_B)).json() == {"released": True}


def test_saving_releases_your_own_lock(api):
    p, cid = team(api)
    api.post(f"/concepts/{cid}/sections/risks/lock", headers=hdr(USER_A))
    api.put(f"/concepts/{cid}/sections/risks", headers=hdr(USER_A), json={"body": "x", "base_version": 0})
    assert api.get(f"/concepts/{cid}/locks", headers=hdr()).json()["locks"] == []


# ---- presence --------------------------------------------------------------------------------------------

def test_presence_lists_recent_users_only(api, db_url):
    p, cid = team(api)
    api.post(f"/concepts/{cid}/presence", headers=hdr(USER_A), json={"section": "problem"})
    api.post(f"/concepts/{cid}/presence", headers=hdr(USER_B), json={})
    users = {u["user_id"]: u["section"] for u in api.get(f"/concepts/{cid}/presence", headers=hdr(USER_C)).json()["users"]}
    assert users == {USER_A: "problem", USER_B: None}

    async def age(pool):
        await pool.execute("UPDATE concept_presence SET last_seen = now() - interval '2 minutes' WHERE user_id=$1", UUID(USER_B))
    db_exec(db_url, age)
    assert [u["user_id"] for u in api.get(f"/concepts/{cid}/presence", headers=hdr()).json()["users"]] == [USER_A]
    assert api.post(f"/concepts/{cid}/presence", headers=hdr(USER_B), json={"section": "bogus"}).status_code == 422
    assert api.get(f"/concepts/{cid}/presence", headers=hdr("99999999-9999-4999-8999-999999999999")).status_code == 404


# ---- the live stream -----------------------------------------------------------------------------------------

def test_event_stream_delivers_other_users_changes_and_cleans_up(api, db_url):
    p, cid = team(api)

    async def scenario():
        pool = await make_pool(db_url)
        gen = stream_events(pool, UUID(cid), UUID(USER_C), heartbeat=30)
        frames = []

        async def next_frame(timeout=5):
            return await asyncio.wait_for(gen.__anext__(), timeout)

        first = await next_frame()
        assert first.startswith("event: ready")
        # presence announced on join: we see our own "joined" event
        # B edits a section and A comments, both through the real HTTP API in another thread
        await asyncio.to_thread(api.put, f"/concepts/{cid}/sections/problem", headers=hdr(USER_B), json={"body": "Live edit", "base_version": 0})
        await asyncio.to_thread(comment, api, cid, USER_A, "Please cite the source", "challenge", section="problem")
        seen = set()
        for _ in range(8):
            f = await next_frame()
            frames.append(f)
            for line in f.splitlines():
                if line.startswith("event: "):
                    seen.add(line[7:])
            if {"section", "comment"} <= seen:
                break
        assert {"section", "comment"} <= seen, frames
        sec = next(f for f in frames if "event: section" in f)
        data = json.loads(sec.split("data: ", 1)[1].split("\n", 1)[0])
        assert data == {"concept_id": cid, "key": "problem", "version": "1", "user": USER_B}   # ids only, never text
        assert "Live edit" not in "".join(frames)

        # events for a different concept are not delivered
        await notify(pool, UUID("00000000-0000-4000-8000-000000000000"), "section", key="problem")
        try:
            await asyncio.wait_for(gen.__anext__(), 0.5)
            leaked = True
        except asyncio.TimeoutError:
            leaked = False
        assert not leaked

        await gen.aclose()
        left = await pool.fetchval("SELECT count(*) FROM concept_presence WHERE concept_id=$1 AND user_id=$2", UUID(cid), UUID(USER_C))
        await pool.close()
        return left
    assert asyncio.run(scenario()) == 0


def test_event_stream_heartbeat_and_overflow_resync(api, db_url):
    p, cid = team(api)

    async def scenario():
        pool = await make_pool(db_url)
        gen = stream_events(pool, UUID(cid), UUID(USER_A), heartbeat=0.2)
        assert (await gen.__anext__()).startswith("event: ready")
        # drain our own "joined" notification, then expect a keep-alive when nothing happens
        frames = [await asyncio.wait_for(gen.__anext__(), 2) for _ in range(2)]
        assert any(f.startswith(": keep-alive") for f in frames)
        # flood past the queue size without reading: the stream degrades to a single resync, not unbounded memory
        for i in range(300):
            await notify(pool, UUID(cid), "comment", id=i)
        await asyncio.sleep(0.3)
        types = []
        for _ in range(250):
            f = await asyncio.wait_for(gen.__anext__(), 2)
            if f.startswith(": keep-alive"):
                break
            types.append(f.split("\n")[1] if f.startswith("id:") else f.split("\n")[0])
        await gen.aclose()
        await pool.close()
        return types
    types = asyncio.run(scenario())
    assert "event: resync" in types and len(types) < 250


def test_events_endpoint_checks_membership_before_streaming(api):
    p, cid = team(api)
    r = api.get(f"/concepts/{cid}/events", headers=hdr("99999999-9999-4999-8999-999999999999"))
    assert r.status_code == 404


def test_cancelled_stream_cleans_up_presence_and_returns_its_connection(api, db_url):
    """A browser closing the tab cancels the server task; cleanup must still run (regression found in a live run)."""
    p, cid = team(api)

    async def scenario():
        pool = await make_pool(db_url)
        idle_before = pool.get_idle_size()

        async def consume():
            async for _ in stream_events(pool, UUID(cid), UUID(USER_B), heartbeat=30):
                pass
        task = asyncio.create_task(consume())
        await asyncio.sleep(0.5)
        assert await pool.fetchval("SELECT count(*) FROM concept_presence WHERE user_id=$1", UUID(USER_B)) == 1
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        await asyncio.sleep(0.2)
        left = await pool.fetchval("SELECT count(*) FROM concept_presence WHERE user_id=$1", UUID(USER_B))
        free = pool.get_idle_size()
        await pool.close()
        return left, free >= idle_before
    assert asyncio.run(scenario()) == (0, True)
