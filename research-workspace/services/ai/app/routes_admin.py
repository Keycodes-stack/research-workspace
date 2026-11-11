"""Phase 12 - members and roles, audit log, usage and budget. Identity itself (who a user_id is) comes from the
JWT issued outside this system; members are added by user id."""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field

from .access import ROLES, project_for_user, project_with, rank
from .auth import require_user
from .clients import get_pool
from .governance import audit, calls_this_month

router = APIRouter(tags=["admin"])
Role = Literal["viewer", "researcher", "lead_scientist", "admin", "owner"]

PERMISSIONS = [
    {"capability": "View everything in the project", "min_role": "viewer"},
    {"capability": "Upload/discover sources, create tasks and threads, ask questions, scan signals, build and score concepts, generate lenses", "min_role": "researcher"},
    {"capability": "Approve tasks (lock sources), move concepts through pipeline gates, export the Business Case PDF", "min_role": "lead_scientist"},
    {"capability": "Manage members up to lead scientist, set the budget, read audit log and usage, override failed pipeline gates", "min_role": "admin"},
    {"capability": "Manage all members including admins and owners; the last owner cannot be removed", "min_role": "owner"},
]


def can_manage(actor_role: str, target_role: str, new_role: str | None = None) -> bool:
    """Owners manage anyone. Admins manage members at or below lead_scientist and can only grant up to lead_scientist."""
    if actor_role == "owner":
        return True
    if actor_role != "admin":
        return False
    return rank(target_role) <= rank("lead_scientist") and (new_role is None or rank(new_role) <= rank("lead_scientist"))


@router.get("/projects/{project_id}/members")
async def members(project=Depends(project_for_user), pool=Depends(get_pool)):
    rows = await pool.fetch(
        "SELECT user_id, role::text AS role, created_at FROM project_members WHERE project_id=$1 ORDER BY role DESC, created_at",
        project["id"])
    return jsonable_encoder({"you": project["role"], "members": [dict(r) for r in rows], "permissions": PERMISSIONS})


class MemberIn(BaseModel):
    user_id: UUID
    role: Role


@router.post("/projects/{project_id}/members", status_code=201)
async def add_member(body: MemberIn, project=Depends(project_with("admin")), user: UUID = Depends(require_user),
                     pool=Depends(get_pool)):
    if not can_manage(project["role"], "viewer", body.role):
        raise HTTPException(403, {"error": "forbidden", "note": f"{project['role']} cannot grant {body.role}"})
    if await pool.fetchval("SELECT 1 FROM project_members WHERE project_id=$1 AND user_id=$2", project["id"], body.user_id):
        raise HTTPException(409, "already a member; change their role instead")
    await pool.execute("INSERT INTO project_members (project_id, user_id, role, added_by) VALUES ($1,$2,$3::project_role,$4)",
                       project["id"], body.user_id, body.role, user)
    await audit(pool, project["id"], user, "member.add", "user", body.user_id, role=body.role)
    return {"user_id": body.user_id, "role": body.role}


class RoleIn(BaseModel):
    role: Role


async def _owners(pool, project_id) -> int:
    return await pool.fetchval("SELECT count(*) FROM project_members WHERE project_id=$1 AND role='owner'", project_id)


@router.put("/projects/{project_id}/members/{member_id}")
async def change_role(member_id: UUID, body: RoleIn, project=Depends(project_with("admin")),
                      user: UUID = Depends(require_user), pool=Depends(get_pool)):
    cur = await pool.fetchval("SELECT role::text FROM project_members WHERE project_id=$1 AND user_id=$2", project["id"], member_id)
    if cur is None:
        raise HTTPException(404, "member not found")
    if not can_manage(project["role"], cur, body.role):
        raise HTTPException(403, {"error": "forbidden", "note": f"{project['role']} cannot change {cur} to {body.role}"})
    if cur == "owner" and body.role != "owner" and await _owners(pool, project["id"]) <= 1:
        raise HTTPException(409, "a project must keep at least one owner")
    await pool.execute("UPDATE project_members SET role=$3::project_role WHERE project_id=$1 AND user_id=$2",
                       project["id"], member_id, body.role)
    await audit(pool, project["id"], user, "member.role", "user", member_id, **{"from": cur, "to": body.role})
    return {"user_id": member_id, "role": body.role}


@router.delete("/projects/{project_id}/members/{member_id}")
async def remove_member(member_id: UUID, project=Depends(project_for_user), user: UUID = Depends(require_user),
                        pool=Depends(get_pool)):
    cur = await pool.fetchval("SELECT role::text FROM project_members WHERE project_id=$1 AND user_id=$2", project["id"], member_id)
    if cur is None:
        raise HTTPException(404, "member not found")
    if member_id != user:                         # anyone may leave; removing someone else needs admin rights over them
        if rank(project["role"]) < rank("admin"):
            raise HTTPException(403, {"error": "forbidden", "required_role": "admin", "your_role": project["role"]})
        if not can_manage(project["role"], cur):
            raise HTTPException(403, {"error": "forbidden", "note": f"{project['role']} cannot remove a {cur}"})
    if cur == "owner" and await _owners(pool, project["id"]) <= 1:
        raise HTTPException(409, "a project must keep at least one owner")
    await pool.execute("DELETE FROM project_members WHERE project_id=$1 AND user_id=$2", project["id"], member_id)
    await audit(pool, project["id"], user, "member.remove", "user", member_id, role=cur)
    return {"removed": member_id}


@router.get("/projects/{project_id}/audit")
async def audit_log(action: str | None = None, before: int | None = None, limit: int = 50,
                    project=Depends(project_with("admin")), pool=Depends(get_pool)):
    limit = max(1, min(limit, 200))
    rows = await pool.fetch(
        """SELECT id, actor, action, target_type, target_id, detail, created_at FROM audit_log
           WHERE project_id=$1 AND ($2::text IS NULL OR action=$2) AND ($3::bigint IS NULL OR id < $3)
           ORDER BY id DESC LIMIT $4""", project["id"], action, before, limit)
    out = [dict(r) for r in rows]
    for d in out:
        if isinstance(d["detail"], str):
            d["detail"] = __import__("json").loads(d["detail"])
    return jsonable_encoder({"entries": out, "next_before": out[-1]["id"] if len(out) == limit else None})


class BudgetIn(BaseModel):
    monthly_call_budget: int | None = Field(ge=0, le=10_000_000)


@router.put("/projects/{project_id}/budget")
async def set_budget(body: BudgetIn, project=Depends(project_with("admin")), user: UUID = Depends(require_user),
                     pool=Depends(get_pool)):
    await pool.execute("UPDATE projects SET monthly_call_budget=$2 WHERE id=$1", project["id"], body.monthly_call_budget)
    await audit(pool, project["id"], user, "budget.set", "project", project["id"], monthly_call_budget=body.monthly_call_budget)
    return {"monthly_call_budget": body.monthly_call_budget}


@router.get("/projects/{project_id}/usage")
async def usage(project=Depends(project_with("admin")), pool=Depends(get_pool)):
    used = await calls_this_month(pool, project["id"])
    budget = await pool.fetchval("SELECT monthly_call_budget FROM projects WHERE id=$1", project["id"])
    by_kind = await pool.fetch(
        """SELECT kind, count(*) operations, sum(model_calls) model_calls, sum(chars_in) chars_in, sum(chars_out) chars_out
           FROM usage_events WHERE project_id=$1 AND created_at >= date_trunc('month', now()) GROUP BY kind ORDER BY kind""", project["id"])
    by_user = await pool.fetch(
        """SELECT user_id, sum(model_calls) model_calls FROM usage_events
           WHERE project_id=$1 AND created_at >= date_trunc('month', now()) GROUP BY user_id ORDER BY 2 DESC""", project["id"])
    return jsonable_encoder({
        "month_calls": used, "monthly_call_budget": budget, "remaining": None if budget is None else max(0, budget - used),
        "by_kind": [dict(r) for r in by_kind], "by_user": [dict(r) for r in by_user],
        "note": "Counts model calls and characters, not tokens or money: providers bill differently. Retries and failed calls are counted.",
    })
