"""Approval chain and the VP view.

Researcher requests review -> every named VP approves or requests changes (remarks mandatory for changes) ->
when all VPs approved, the CEO (if one was named) signs off. Changes requested end the round; the researcher
revises and requests again (a new round). Every step is written to the audit log."""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field, model_validator

from .access import project_for_user
from .auth import require_user
from .clients import get_pool
from .governance import audit
from .routes_concepts import concept_for_user
from .routes_pipeline import FLOW

router = APIRouter(tags=["approvals"])


def chain_status(rows: list) -> str:
    """none | awaiting_vps | awaiting_ceo | changes_requested | approved, from one round's rows."""
    if not rows:
        return "none"
    if any(r["decision"] == "changes_requested" for r in rows):
        return "changes_requested"
    vps = [r for r in rows if r["stage"] == "vp"]
    ceo = [r for r in rows if r["stage"] == "ceo"]
    if any(r["decision"] == "pending" for r in vps):
        return "awaiting_vps"
    if any(r["decision"] == "pending" for r in ceo):
        return "awaiting_ceo"
    return "approved"


def actionable(rows: list, user: UUID) -> dict | None:
    """The user's pending row, if it is their turn (the CEO only after every VP approved)."""
    mine = next((r for r in rows if r["reviewer_id"] == user and r["decision"] == "pending"), None)
    if not mine:
        return None
    if mine["stage"] == "ceo" and chain_status(rows) != "awaiting_ceo":
        return None
    return mine


async def _latest(pool, concept_id) -> tuple[int, list]:
    rnd = await pool.fetchval("SELECT coalesce(max(round), 0) FROM concept_approvals WHERE concept_id=$1", concept_id)
    rows = await pool.fetch(
        "SELECT * FROM concept_approvals WHERE concept_id=$1 AND round=$2 ORDER BY stage, requested_at, reviewer_id",
        concept_id, rnd) if rnd else []
    return rnd, rows


class RequestIn(BaseModel):
    vp_ids: list[UUID] = Field(min_length=1, max_length=10)
    ceo_id: UUID | None = None

    @model_validator(mode="after")
    def distinct(self):
        everyone = [*self.vp_ids, *([self.ceo_id] if self.ceo_id else [])]
        if len(set(everyone)) != len(everyone):
            raise ValueError("each reviewer can appear only once")
        return self


@router.post("/concepts/{concept_id}/approval/request", status_code=201)
async def request_approval(concept_id: UUID, body: RequestIn, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    c = await concept_for_user(pool, concept_id, user, "researcher")
    people = [*body.vp_ids, *([body.ceo_id] if body.ceo_id else [])]
    known = {r["user_id"] for r in await pool.fetch(
        "SELECT user_id FROM project_members WHERE project_id=$1 AND user_id = ANY($2::uuid[])", c["project_id"], people)}
    if known != set(people):
        raise HTTPException(422, "every reviewer must be a member of this project")
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT 1 FROM concepts WHERE id=$1 FOR UPDATE", concept_id)
        rnd, rows = await _latest(conn, concept_id)
        if rows and chain_status(rows) != "changes_requested":
            raise HTTPException(409, f"an approval round is already {chain_status(rows)}")
        rnd += 1
        await conn.executemany(
            "INSERT INTO concept_approvals (concept_id, round, stage, reviewer_id, requested_by) VALUES ($1,$2,$3,$4,$5)",
            [(concept_id, rnd, "vp", v, user) for v in body.vp_ids]
            + ([(concept_id, rnd, "ceo", body.ceo_id, user)] if body.ceo_id else []))
    await audit(pool, c["project_id"], user, "approval.request", "concept", concept_id, round=rnd,
                vps=len(body.vp_ids), ceo=bool(body.ceo_id))
    return {"round": rnd, "status": "awaiting_vps"}


class DecideIn(BaseModel):
    decision: Literal["approved", "changes_requested"]
    remarks: str = Field(default="", max_length=4000)


@router.post("/concepts/{concept_id}/approval/decide")
async def decide_approval(concept_id: UUID, body: DecideIn, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    c = await concept_for_user(pool, concept_id, user)
    if body.decision == "changes_requested" and len(body.remarks.strip()) < 10:
        raise HTTPException(422, "remarks of at least 10 characters are required when requesting changes")
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT 1 FROM concepts WHERE id=$1 FOR UPDATE", concept_id)
        rnd, rows = await _latest(conn, concept_id)
        mine = next((r for r in rows if r["reviewer_id"] == user and r["decision"] == "pending"), None)
        if not mine:
            raise HTTPException(403, {"error": "forbidden", "note": "you have no pending review on this concept"})
        if not actionable(rows, user):
            raise HTTPException(409, "the CEO signs off only after every VP has approved")
        await conn.execute(
            "UPDATE concept_approvals SET decision=$2, remarks=$3, decided_at=now() WHERE id=$1",
            mine["id"], body.decision, body.remarks.strip() or None)
        _, rows = await _latest(conn, concept_id)
    status = chain_status(rows)
    await audit(pool, c["project_id"], user, f"approval.{body.decision}", "concept", concept_id,
                round=rnd, stage=mine["stage"], remarks=body.remarks.strip(), status=status)
    return {"round": rnd, "status": status}


@router.get("/concepts/{concept_id}/approval")
async def approval(concept_id: UUID, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    await concept_for_user(pool, concept_id, user)
    rnd, rows = await _latest(pool, concept_id)
    history = await pool.fetch(
        """SELECT round, stage, reviewer_id, decision, remarks, decided_at FROM concept_approvals
           WHERE concept_id=$1 AND round < $2 AND decision <> 'pending' ORDER BY round, decided_at""", concept_id, rnd)
    return jsonable_encoder({
        "round": rnd, "status": chain_status(rows),
        "reviewers": [{k: r[k] for k in ("stage", "reviewer_id", "decision", "remarks", "decided_at")} for r in rows],
        "awaiting_you": actionable(rows, user) is not None,
        "history": [dict(h) for h in history],
    })


@router.get("/projects/{project_id}/executive")
async def executive(project=Depends(project_for_user), user: UUID = Depends(require_user), pool=Depends(get_pool)):
    """VP view: every concept with progress, approval state, whether it waits for you, and what blocks it."""
    concepts = await pool.fetch(
        "SELECT id, title, stage::text AS stage, status::text AS status, updated_at FROM concepts WHERE project_id=$1 "
        "ORDER BY updated_at DESC", project["id"])
    approvals = await pool.fetch(
        """SELECT a.* FROM concept_approvals a JOIN concepts c ON c.id=a.concept_id
           WHERE c.project_id=$1 AND a.round = (SELECT max(round) FROM concept_approvals WHERE concept_id=a.concept_id)""",
        project["id"])
    by: dict = {}
    for a in approvals:
        by.setdefault(a["concept_id"], []).append(a)
    out, waiting = [], 0
    last = len(FLOW) - 1
    for c in concepts:
        rows = by.get(c["id"], [])
        status = chain_status(rows)
        mine = actionable(rows, user) is not None
        waiting += mine
        blockers = [{"by": r["reviewer_id"], "stage": r["stage"], "remarks": r["remarks"]}
                    for r in rows if r["decision"] == "changes_requested"]
        progress = round(100 * FLOW.index(c["stage"]) / last) if c["stage"] in FLOW else 0
        out.append({"id": c["id"], "title": c["title"], "stage": c["stage"], "status": c["status"],
                    "progress": progress, "approval": status, "awaiting_you": mine, "blockers": blockers})
    active = [o for o in out if o["stage"] not in ("launched", "parked", "rejected")]
    return jsonable_encoder({
        "summary": {"active": len(active), "awaiting_you": waiting,
                    "blocked": sum(bool(o["blockers"]) for o in out),
                    "approved": sum(o["approval"] == "approved" for o in out)},
        "concepts": out,
    })
