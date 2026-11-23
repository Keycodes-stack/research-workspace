"""The people directory: who can be chosen as sponsor, project lead or core team member."""
import re
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator

from .auth import require_user
from .clients import get_pool
from .governance import audit

router = APIRouter(tags=["people"])
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _clean_email(value: str | None) -> str | None:
    value = (value or "").strip()
    if not value:
        return None
    if len(value) > 254 or not EMAIL.match(value):
        raise ValueError("the email address is not valid")
    return value


class PersonIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    email: str | None = Field(default=None, max_length=254)
    department: str | None = Field(default=None, max_length=120)
    job_title: str | None = Field(default=None, max_length=120)

    @field_validator("full_name")
    @classmethod
    def _name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("the full name is required")
        return value

    @field_validator("email")
    @classmethod
    def _email(cls, value: str | None) -> str | None:
        return _clean_email(value)


class PersonUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=120)
    email: str | None = Field(default=None, max_length=254)
    department: str | None = Field(default=None, max_length=120)
    job_title: str | None = Field(default=None, max_length=120)
    active: bool | None = None

    @field_validator("full_name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("the full name is required")
        return value

    @field_validator("email")
    @classmethod
    def _email(cls, value: str | None) -> str | None:
        return _clean_email(value)


def _clean_text(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


@router.get("/people")
async def list_people(include_inactive: bool = False, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    rows = await pool.fetch(
        """SELECT id, full_name, email, department, job_title, active FROM people
           WHERE $1 OR active ORDER BY lower(full_name)""", include_inactive)
    return {"people": [dict(r) for r in rows]}


@router.post("/people", status_code=201)
async def add_person(body: PersonIn, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    try:
        pid = await pool.fetchval(
            """INSERT INTO people (full_name, email, department, job_title, created_by)
               VALUES ($1, $2, $3, $4, $5) RETURNING id""",
            body.full_name, body.email, _clean_text(body.department), _clean_text(body.job_title), user)
    except asyncpg.UniqueViolationError:
        raise HTTPException(409, "A person with this name or email address is already in the directory.")
    await audit(pool, None, user, "person.create", "person", pid, name=body.full_name)
    return {"id": pid, "full_name": body.full_name}


@router.patch("/people/{person_id}")
async def update_person(person_id: UUID, body: PersonUpdate, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(422, "Nothing to change.")
    if "department" in changes:
        changes["department"] = _clean_text(changes["department"])
    if "job_title" in changes:
        changes["job_title"] = _clean_text(changes["job_title"])
    sets = ", ".join(f"{column} = ${i}" for i, column in enumerate(changes, start=2))
    try:
        row = await pool.fetchrow(
            f"UPDATE people SET {sets}, updated_at = now() WHERE id = $1 RETURNING id", person_id, *changes.values())
    except asyncpg.UniqueViolationError:
        raise HTTPException(409, "A person with this name or email address is already in the directory.")
    if row is None:
        raise HTTPException(404, "person not found")
    await audit(pool, None, user, "person.update", "person", person_id, fields=sorted(changes))
    return {"id": person_id}


async def check_people_chosen(pool, charter: dict) -> None:
    """The sponsor, lead and core team must be active people in the directory (no stale or invented ids)."""
    ids: list[str] = [str(charter.get(k)) for k in ("sponsor_id", "lead_id") if charter.get(k)]
    ids += [str(x) for x in (charter.get("core_team_ids") or []) if x]
    if not ids:
        return
    try:
        uuids = [UUID(x) for x in ids]
    except ValueError:
        raise HTTPException(422, "A selected person is not valid. Choose them again from the list.")
    found = await pool.fetchval(
        "SELECT count(*) FROM people WHERE id = ANY($1::uuid[]) AND active", uuids)
    if found != len(set(uuids)):
        raise HTTPException(422, "A selected person is no longer in the directory. Choose them again.")
