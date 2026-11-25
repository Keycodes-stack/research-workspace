"""Refinement bar: a plain-language request ("make Sara the lead") becomes proposed field changes.

Two steps, so nothing is written without the user's confirmation:
  propose -> the model suggests changes; they are checked against an allowlist and shown to the user;
  apply   -> the confirmed changes are checked again (the client is not trusted) and written in one transaction."""
import json
import logging
from datetime import date
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .access import project_with
from .auth import require_user
from .clients import get_pool
from .deps import get_llms
from .governance import Meter, audit
from .orchestration.llm import LLMError
from .orchestration.schema import ParseError, extract_json
from .routes_tasks import _complete_fast

router = APIRouter(tags=["refine"])
log = logging.getLogger(__name__)

PROJECT_FIELDS = {"name": 200, "lead": 120, "priority": 40}     # lead and priority are stored in the project's meta
WORK_PACKAGE_FIELDS = {"title": 300, "due_date": 10}
MAX_CHANGES = 10
SYSTEM = ("You turn a short request about a research project into field changes. Reply with JSON only. "
          "Change only what the request asks for. If the request cannot be done with the allowed fields, "
          "return no changes and say so in the reply.")


class RefineProposeIn(BaseModel):
    instruction: str = Field(min_length=1, max_length=1000)


class RefineApplyIn(BaseModel):
    changes: list[dict[str, Any]] = Field(default_factory=list, max_length=MAX_CHANGES)


def clean_changes(raw: Any, work_package_ids: set[str]) -> list[dict[str, Any]]:
    """Keep only allowed fields with valid values; a work package change must name one of this project's packages."""
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw[:MAX_CHANGES]:
        if not isinstance(item, dict):
            continue
        target, field = item.get("target"), item.get("field")
        if target == "project" and field in PROJECT_FIELDS:
            limit, wp_id = PROJECT_FIELDS[field], None
        elif target == "work_package" and field in WORK_PACKAGE_FIELDS:
            wp_id = str(item.get("work_package_id") or "")
            if wp_id not in work_package_ids:
                continue
            limit = WORK_PACKAGE_FIELDS[field]
        else:
            continue
        value = item.get("value")
        if not isinstance(value, str) or not value.strip():
            continue
        value = value.strip()[:limit]
        if field == "due_date":
            try:
                date.fromisoformat(value)
            except ValueError:
                continue
        out.append({"target": target, "work_package_id": wp_id, "field": field, "value": value})
    return out


async def _current(pool, project_id) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    """The fields the bar can change, as they are now: the project, and its work packages by id."""
    proj = await pool.fetchrow("SELECT name, meta FROM projects WHERE id=$1", project_id)
    meta = proj["meta"] if isinstance(proj["meta"], dict) else {}
    wps = await pool.fetch("SELECT id, code, title, due_date FROM work_packages WHERE project_id=$1 ORDER BY code",
                           project_id)
    project = {"name": proj["name"], "lead": meta.get("lead") or "", "priority": meta.get("priority") or ""}
    packages = {str(w["id"]): {"code": w["code"], "title": w["title"],
                               "due_date": w["due_date"].isoformat() if w["due_date"] else ""} for w in wps}
    return project, packages


def _from_value(change: dict[str, Any], project: dict[str, Any], packages: dict[str, dict[str, Any]]) -> str:
    if change["target"] == "project":
        return str(project.get(change["field"]) or "")
    return str(packages[change["work_package_id"]].get(change["field"]) or "")


@router.post("/projects/{project_id}/refine/propose")
async def refine_propose(body: RefineProposeIn, project=Depends(project_with("researcher")),
                         user=Depends(require_user), pool=Depends(get_pool), llms=Depends(get_llms)):
    """Suggest field changes for a request. Returns the suggestions with their current values; writes nothing."""
    pid = project["id"]
    project_now, packages = await _current(pool, pid)
    meter = Meter(llms)
    llm = meter.llms[0]
    prompt = "\n\n".join([
        "Current project and work packages:\n" + json.dumps(
            {"project": project_now, "work_packages": [{"id": k, **v} for k, v in packages.items()]},
            ensure_ascii=False),
        f"Request: {body.instruction}",
        "Allowed fields: project.name, project.lead, project.priority; work_package.title, work_package.due_date "
        "(YYYY-MM-DD). For a work package change, give its id from the list.",
        'Return JSON: {"changes":[{"target":"project|work_package","work_package_id":"","field":"","value":""}],'
        '"reply":"one short sentence"}',
    ])
    try:
        raw = await _complete_fast(llm, SYSTEM, prompt)
        result = extract_json(raw)
    except (LLMError, ParseError) as exc:   # the assistant being down or answering badly must not break the bar
        log.warning("refine model unavailable (%s): %s", exc.__class__.__name__, str(exc)[:240])
        return {"reply": "The assistant did not respond, so nothing was changed. Try again, or edit the field directly.",
                "changes": []}
    await meter.record(pool, pid, user, "refine")
    changes = clean_changes(result.get("changes"), set(packages))
    for change in changes:
        change["from"] = _from_value(change, project_now, packages)
    reply = result.get("reply") if isinstance(result.get("reply"), str) else ""
    if not changes and not reply:
        reply = "No change could be made from that request."
    return {"reply": reply[:500], "changes": changes}


@router.post("/projects/{project_id}/refine/apply")
async def refine_apply(body: RefineApplyIn, project=Depends(project_with("researcher")),
                       user=Depends(require_user), pool=Depends(get_pool)):
    """Write the confirmed changes. Each one is checked again, so a changed or forged request writes nothing unsafe."""
    pid = project["id"]
    _, packages = await _current(pool, pid)
    changes = clean_changes(body.changes, set(packages))
    if not changes:
        raise HTTPException(422, "Nothing to apply: the changes are not allowed or are empty.")
    async with pool.acquire() as conn, conn.transaction():
        for c in changes:
            if c["target"] == "project" and c["field"] == "name":
                await conn.execute("UPDATE projects SET name=$2 WHERE id=$1", pid, c["value"])
            elif c["target"] == "project":
                await conn.execute(
                    "UPDATE projects SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object($2::text, $3::text) "
                    "WHERE id=$1", pid, c["field"], c["value"])
            elif c["field"] == "title":
                wp_id = UUID(c["work_package_id"])
                await conn.execute("UPDATE work_packages SET title=$2 WHERE id=$1 AND project_id=$3",
                                   wp_id, c["value"], pid)
                await conn.execute("UPDATE tasks SET title=$2 WHERE work_package_id=$1", wp_id, c["value"])
            else:
                await conn.execute("UPDATE work_packages SET due_date=$2::date WHERE id=$1 AND project_id=$3",
                                   UUID(c["work_package_id"]), c["value"], pid)
    await audit(pool, pid, user, "project.refine", "project", pid,
                changes=[{"target": c["target"], "field": c["field"]} for c in changes])
    return {"applied": len(changes), "changes": changes}
