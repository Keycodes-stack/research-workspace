"""Access control. Membership + role per project. A non-member gets 404 (the API never confirms a project
exists); a member whose role is too low gets 403."""
import hashlib
from uuid import UUID

import asyncpg
from fastapi import Depends, HTTPException

from .auth import require_user
from .config import get_settings
from .clients import get_pool

ROLES = ["viewer", "researcher", "lead_scientist", "admin", "owner"]


def rank(role: str) -> int:
    return ROLES.index(role)


def restrictions_on() -> bool:
    """Role checks apply only when the setting ROLE_RESTRICTIONS is on. Membership is always required."""
    return get_settings().role_restrictions


def check_role(role: str | None, minimum: str, what: str = "project"):
    if role is None:
        raise HTTPException(404, f"{what} not found")
    if restrictions_on() and rank(role) < rank(minimum):
        raise HTTPException(403, {"error": "forbidden", "required_role": minimum, "your_role": role})


async def role_in(pool, project_id: UUID, user: UUID) -> str | None:
    return await pool.fetchval(
        "SELECT role::text FROM project_members WHERE project_id=$1 AND user_id=$2", project_id, user)


def project_with(minimum: str):
    """Dependency factory: the project, if the caller is a member with at least `minimum`."""
    async def dep(project_id: str, user: UUID = Depends(require_user), pool=Depends(get_pool)) -> asyncpg.Record:
        # the path may carry the project id or its slug (spec route /projects/[slug])
        try:
            key = UUID(project_id)
            where = "p.id = $1"
        except ValueError:
            key, where = project_id, "p.slug = $1"
        row = await pool.fetchrow(
            f"""SELECT p.id, p.owner_id, p.name, p.slug, p.status, p.mode::text AS mode, m.role::text AS role
                FROM projects p JOIN project_members m ON m.project_id = p.id AND m.user_id = $2
                WHERE {where}""", key, user)
        check_role(row["role"] if row else None, minimum)
        return row
    return dep


project_for_user = project_with("viewer")


async def task_for_user(pool, task_id: UUID, user: UUID, minimum: str = "viewer") -> asyncpg.Record:
    row = await pool.fetchrow(
        """SELECT t.id, t.project_id, t.title, t.status::text AS status, t.source_lock_hash,
                  p.mode::text AS mode, m.role::text AS role
           FROM tasks t JOIN projects p ON p.id = t.project_id
           JOIN project_members m ON m.project_id = p.id AND m.user_id = $2
           WHERE t.id=$1""",
        task_id, user,
    )
    check_role(row["role"] if row else None, minimum, "task")
    return row


async def thread_for_user(pool, thread_id: UUID, user: UUID, minimum: str = "viewer") -> asyncpg.Record:
    row = await pool.fetchrow(
        """SELECT th.id, th.task_id, t.project_id, t.status::text AS status,
                  t.source_lock_hash, p.mode::text AS mode, m.role::text AS role
           FROM threads th JOIN tasks t ON t.id = th.task_id
           JOIN projects p ON p.id = t.project_id
           JOIN project_members m ON m.project_id = p.id AND m.user_id = $2
           WHERE th.id=$1""",
        thread_id, user,
    )
    check_role(row["role"] if row else None, minimum, "thread")
    return row


def compute_lock_hash(sources: list[asyncpg.Record]) -> str:
    """Seal over the exact set of sources (and their file hashes) a task may use."""
    lines = sorted(f"{s['id']}:{s['file_sha256'] or '-'}" for s in sources)
    return hashlib.sha256("\n".join(lines).encode()).hexdigest()


async def task_sources(pool, task_id: UUID) -> list[asyncpg.Record]:
    return await pool.fetch(
        """SELECT s.id, s.file_sha256 FROM task_sources ts
           JOIN sources s ON s.id = ts.source_id WHERE ts.task_id=$1""",
        task_id,
    )


def can_manage(actor_role: str, target_role: str, new_role: str | None = None) -> bool:
    """Owners manage anyone. Admins manage members at or below lead_scientist and can only grant up to lead_scientist."""
    if not restrictions_on() or actor_role == "owner":
        return True
    if actor_role != "admin":
        return False
    return rank(target_role) <= rank("lead_scientist") and (new_role is None or rank(new_role) <= rank("lead_scientist"))


async def resolve_role(pool, project_id, role: str | None, role_id) -> tuple[str, object]:
    """A member's role: a custom role of this project (its permission level comes with it), or a level alone."""
    if role_id is not None:
        row = await pool.fetchrow("SELECT id, level::text AS level FROM project_roles WHERE id=$1 AND project_id=$2",
                                  role_id, project_id)
        if row is None:
            raise HTTPException(422, "that role does not belong to this project")
        return row["level"], row["id"]
    if role is None:
        raise HTTPException(422, "choose a role")
    rid = await pool.fetchval(
        "SELECT id FROM project_roles WHERE project_id=$1 AND level=$2::project_role ORDER BY created_at LIMIT 1",
        project_id, role)
    return role, rid
