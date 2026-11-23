"""Roles a project defines for itself. A role has a name and a permission level; the level decides what its members
can do (see access.py). Members with a role of a level can be changed in one request (routes_admin.py)."""
from typing import Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator

from .access import can_manage, project_for_user, project_with, rank, restrictions_on
from .auth import require_user
from .clients import get_pool
from .governance import audit

router = APIRouter(tags=["roles"])
Level = Literal["viewer", "researcher", "lead_scientist", "admin", "owner"]


class RoleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    level: Level

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("the role needs a name")
        return value


class RoleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    level: Level | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("the role needs a name")
        return value


@router.get("/projects/{project_id}/roles")
async def list_roles(project=Depends(project_for_user), pool=Depends(get_pool)):
    rows = await pool.fetch(
        """SELECT r.id, r.name, r.level::text AS level, count(m.user_id) AS members
           FROM project_roles r LEFT JOIN project_members m ON m.role_id = r.id
           WHERE r.project_id = $1 GROUP BY r.id ORDER BY r.created_at, r.name""", project["id"])
    return {"roles": [dict(r) for r in rows], "your_role": project["role"], "role_restrictions": restrictions_on()}


@router.post("/projects/{project_id}/roles", status_code=201)
async def create_role(body: RoleCreate, project=Depends(project_with("admin")), user: UUID = Depends(require_user),
                      pool=Depends(get_pool)):
    if not can_manage(project["role"], "viewer", body.level):
        raise HTTPException(403, {"error": "forbidden", "note": f"{project['role']} cannot create a {body.level} role"})
    try:
        rid = await pool.fetchval(
            "INSERT INTO project_roles (project_id, name, level, created_by) VALUES ($1, $2, $3::project_role, $4) RETURNING id",
            project["id"], body.name, body.level, user)
    except asyncpg.UniqueViolationError:
        raise HTTPException(409, "A role with this name already exists in the project.")
    await audit(pool, project["id"], user, "role.create", "role", rid, name=body.name, level=body.level)
    return {"id": rid, "name": body.name, "level": body.level}


@router.patch("/projects/{project_id}/roles/{role_id}")
async def update_role(role_id: UUID, body: RoleUpdate, project=Depends(project_with("admin")),
                      user: UUID = Depends(require_user), pool=Depends(get_pool)):
    """Rename a role, or change its level. A level change applies to every member who has the role, at once."""
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(422, "Nothing to change.")
    async with pool.acquire() as conn:
        async with conn.transaction():
            cur = await conn.fetchrow("SELECT level::text AS level FROM project_roles WHERE id=$1 AND project_id=$2 FOR UPDATE",
                                      role_id, project["id"])
            if cur is None:
                raise HTTPException(404, "role not found")
            new_level = changes.get("level") or cur["level"]
            if new_level != cur["level"]:
                if not can_manage(project["role"], cur["level"], new_level):
                    raise HTTPException(403, {"error": "forbidden", "note": f"{project['role']} cannot change a {cur['level']} role to {new_level}"})
                if cur["level"] == "owner" and new_level != "owner":
                    owners = await conn.fetchval(
                        "SELECT count(*) FROM project_members WHERE project_id=$1 AND role='owner'", project["id"])
                    if owners <= 1:
                        raise HTTPException(409, "a project must keep at least one owner")
            try:
                if "name" in changes:
                    await conn.execute("UPDATE project_roles SET name=$2 WHERE id=$1", role_id, changes["name"])
                if new_level != cur["level"]:
                    await conn.execute("UPDATE project_roles SET level=$2::project_role WHERE id=$1", role_id, new_level)
                    await conn.execute("UPDATE project_members SET role=$2::project_role WHERE role_id=$1", role_id, new_level)
            except asyncpg.UniqueViolationError:
                raise HTTPException(409, "A role with this name already exists in the project.")
    await audit(pool, project["id"], user, "role.update", "role", role_id, **{k: v for k, v in changes.items()})
    return {"id": role_id, "name": changes.get("name"), "level": new_level}


@router.delete("/projects/{project_id}/roles/{role_id}", status_code=204)
async def delete_role(role_id: UUID, project=Depends(project_with("admin")), user: UUID = Depends(require_user),
                      pool=Depends(get_pool)):
    row = await pool.fetchrow("SELECT name, level::text AS level FROM project_roles WHERE id=$1 AND project_id=$2",
                              role_id, project["id"])
    if row is None:
        raise HTTPException(404, "role not found")
    if not can_manage(project["role"], row["level"]):
        raise HTTPException(403, {"error": "forbidden", "note": f"{project['role']} cannot delete a {row['level']} role"})
    in_use = await pool.fetchval("SELECT count(*) FROM project_members WHERE role_id=$1", role_id)
    if in_use:
        raise HTTPException(409, f"{in_use} member(s) have this role. Move them to another role first.")
    await pool.execute("DELETE FROM project_roles WHERE id=$1", role_id)
    await audit(pool, project["id"], user, "role.delete", "role", role_id, name=row["name"])
    return Response(status_code=204)
