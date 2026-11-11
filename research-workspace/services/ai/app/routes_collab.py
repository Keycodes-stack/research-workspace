"""Phase 13 - live collaboration on a concept: event stream, presence, advisory section locks, threaded comments.

Honest scope: this is NOT character-level co-editing. Concurrent edits are guarded by section versions (a stale save
gets 409 and the other person's text). Locks are advisory hints that expire; the version check is the real guard."""
from datetime import timedelta
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .access import rank
from .auth import require_user
from .clients import get_pool
from .governance import audit
from .realtime import notify, stream_events
from .routes_concepts import SECTIONS, concept_for_user

router = APIRouter(tags=["collaboration"])
LOCK_SECONDS = 60
PRESENCE_SECONDS = 45
SectionKey = Literal["problem", "hypothesis", "approach", "risks", "next_steps"]


@router.get("/concepts/{concept_id}/events")
async def events(concept_id: UUID, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    await concept_for_user(pool, concept_id, user)               # 404 for non-members, before any stream opens
    return StreamingResponse(
        stream_events(pool, concept_id, user), media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no", "Connection": "keep-alive"})


# ---- presence -----------------------------------------------------------------------------------------

class PresenceIn(BaseModel):
    section: SectionKey | None = None


@router.post("/concepts/{concept_id}/presence")
async def heartbeat(concept_id: UUID, body: PresenceIn, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    await concept_for_user(pool, concept_id, user)
    prev = await pool.fetchval("SELECT section_key FROM concept_presence WHERE concept_id=$1 AND user_id=$2", concept_id, user)
    await pool.execute(
        """INSERT INTO concept_presence (concept_id, user_id, section_key) VALUES ($1,$2,$3)
           ON CONFLICT (concept_id, user_id) DO UPDATE SET section_key=$3, last_seen=now()""", concept_id, user, body.section)
    if prev != body.section:                                    # only announce moves, not every heartbeat
        await notify(pool, concept_id, "presence", user=user, section=body.section or "")
    return {"ok": True}


@router.get("/concepts/{concept_id}/presence")
async def presence(concept_id: UUID, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    await concept_for_user(pool, concept_id, user)
    rows = await pool.fetch(
        """SELECT user_id, section_key AS section, last_seen FROM concept_presence
           WHERE concept_id=$1 AND last_seen > now() - make_interval(secs => $2) ORDER BY last_seen DESC""",
        concept_id, float(PRESENCE_SECONDS))
    return jsonable_encoder({"users": [dict(r) for r in rows]})


# ---- advisory locks -----------------------------------------------------------------------------------

@router.post("/concepts/{concept_id}/sections/{key}/lock")
async def lock(concept_id: UUID, key: SectionKey, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    await concept_for_user(pool, concept_id, user, "researcher")
    row = await pool.fetchrow(
        """INSERT INTO section_locks (concept_id, section_key, user_id, expires_at)
           VALUES ($1,$2,$3, now() + make_interval(secs => $4))
           ON CONFLICT (concept_id, section_key) DO UPDATE SET user_id=$3, expires_at=now() + make_interval(secs => $4)
             WHERE section_locks.user_id = $3 OR section_locks.expires_at < now()
           RETURNING expires_at""", concept_id, key, user, float(LOCK_SECONDS))
    if not row:
        holder = await pool.fetchrow("SELECT user_id, expires_at FROM section_locks WHERE concept_id=$1 AND section_key=$2", concept_id, key)
        raise HTTPException(409, {"error": "locked", "held_by": str(holder["user_id"]), "expires_at": holder["expires_at"].isoformat()})
    await notify(pool, concept_id, "lock", section=key, user=user, state="held")
    return {"section": key, "expires_at": row["expires_at"].isoformat(), "seconds": LOCK_SECONDS}


@router.delete("/concepts/{concept_id}/sections/{key}/lock")
async def unlock(concept_id: UUID, key: SectionKey, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    await concept_for_user(pool, concept_id, user)
    n = await pool.fetchval(
        "WITH d AS (DELETE FROM section_locks WHERE concept_id=$1 AND section_key=$2 AND user_id=$3 RETURNING 1) SELECT count(*) FROM d",
        concept_id, key, user)
    if n:
        await notify(pool, concept_id, "lock", section=key, user=user, state="released")
    return {"released": bool(n)}


@router.get("/concepts/{concept_id}/locks")
async def locks(concept_id: UUID, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    await concept_for_user(pool, concept_id, user)
    rows = await pool.fetch(
        "SELECT section_key AS section, user_id, expires_at FROM section_locks WHERE concept_id=$1 AND expires_at > now()", concept_id)
    return jsonable_encoder({"locks": [dict(r) for r in rows]})


# ---- threaded comments with stances -----------------------------------------------------------------------

class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    stance: Literal["support", "challenge", "question", "note"]
    section: Literal["problem", "hypothesis", "approach", "risks", "next_steps", "evidence", "scoring"] | None = None
    parent_id: UUID | None = None


@router.post("/concepts/{concept_id}/comments", status_code=201)
async def add_comment(concept_id: UUID, body: CommentIn, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    c = await concept_for_user(pool, concept_id, user, "researcher")
    section = body.section
    if body.parent_id:
        parent = await pool.fetchrow("SELECT section_key FROM concept_comments WHERE id=$1 AND concept_id=$2", body.parent_id, concept_id)
        if not parent:
            raise HTTPException(400, "parent comment not found in this concept")
        section = parent["section_key"]                          # a reply stays in its thread's section
    if not body.body.strip():
        raise HTTPException(422, "comment is empty")
    cid = await pool.fetchval(
        """INSERT INTO concept_comments (concept_id, section_key, parent_id, author, stance, body)
           VALUES ($1,$2,$3,$4,$5::comment_stance,$6) RETURNING id""",
        concept_id, section, body.parent_id, user, body.stance, body.body.strip())
    await notify(pool, concept_id, "comment", id=cid, section=section or "")
    await audit(pool, c["project_id"], user, "comment.add", "concept", concept_id, stance=body.stance, section=section)
    return {"id": cid}


@router.get("/concepts/{concept_id}/comments")
async def comments(concept_id: UUID, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    await concept_for_user(pool, concept_id, user)
    rows = await pool.fetch(
        """SELECT id, parent_id, section_key AS section, author, stance::text AS stance, body, resolved, resolved_by, created_at
           FROM concept_comments WHERE concept_id=$1 ORDER BY created_at, id""", concept_id)
    items = [dict(r) for r in rows]
    # Unresolved ROOT threads per section and stance: the "state of the debate". Not a vote and not a score.
    summary: dict = {}
    for r in items:
        if r["parent_id"] is None and not r["resolved"]:
            s = summary.setdefault(r["section"] or "general", {"support": 0, "challenge": 0, "question": 0, "note": 0})
            s[r["stance"]] += 1
    return jsonable_encoder({
        "comments": items, "summary": summary,
        "note": "Comments are written by people and are not source-verified.",
    })


class ResolveIn(BaseModel):
    resolved: bool


@router.post("/comments/{comment_id}/resolve")
async def resolve(comment_id: UUID, body: ResolveIn, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    row = await pool.fetchrow("SELECT concept_id, author, parent_id FROM concept_comments WHERE id=$1", comment_id)
    if not row:
        raise HTTPException(404, "comment not found")
    c = await concept_for_user(pool, row["concept_id"], user, "researcher")
    if row["author"] != user and rank(c["role"]) < rank("lead_scientist"):
        raise HTTPException(403, {"error": "forbidden", "required_role": "lead_scientist",
                                  "note": "Only the author or a lead scientist can resolve a comment."})
    await pool.execute("UPDATE concept_comments SET resolved=$2, resolved_by=$3 WHERE id=$1", comment_id, body.resolved, user if body.resolved else None)
    await notify(pool, row["concept_id"], "comment", id=comment_id)
    return {"id": comment_id, "resolved": body.resolved}
