"""Audit log, usage metering and the monthly call budget."""
import json
from uuid import UUID

from fastapi import HTTPException


async def audit(pool, project_id: UUID | None, actor: UUID, action: str, target_type: str | None = None,
                target_id=None, **detail) -> None:
    """Append one row to the audit log. Never raises into the caller's request: a failed audit write is loud in logs
    but must not corrupt a user action that already succeeded."""
    try:
        await pool.execute(
            "INSERT INTO audit_log (project_id, actor, action, target_type, target_id, detail) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
            project_id, actor, action, target_type, str(target_id) if target_id is not None else None,
            json.dumps(detail, default=str))
    except Exception:       # pragma: no cover
        import logging
        logging.getLogger("audit").exception("audit write failed: %s", action)


class Metered:
    def __init__(self, llm, meter):
        self._llm, self._meter, self.name = llm, meter, llm.name

    async def complete(self, system: str, user: str) -> str:
        self._meter.calls += 1
        self._meter.chars_in += len(system) + len(user)
        out = await self._llm.complete(system, user)       # a failed call is still counted (it was attempted)
        self._meter.chars_out += len(out)
        return out


class Meter:
    """Wraps the model pair and counts every call, including retries."""
    def __init__(self, llms):
        self.calls = self.chars_in = self.chars_out = 0
        self.llms = tuple(Metered(l, self) for l in llms)

    async def record(self, pool, project_id: UUID, user: UUID, kind: str) -> None:
        if self.calls:
            await pool.execute(
                "INSERT INTO usage_events (project_id, user_id, kind, model_calls, chars_in, chars_out) VALUES ($1,$2,$3,$4,$5,$6)",
                project_id, user, kind, self.calls, self.chars_in, self.chars_out)


async def calls_this_month(pool, project_id: UUID) -> int:
    return await pool.fetchval(
        "SELECT COALESCE(sum(model_calls),0) FROM usage_events WHERE project_id=$1 AND created_at >= date_trunc('month', now())",
        project_id)


async def check_budget(pool, project_id: UUID) -> None:
    """Refuse BEFORE any model is called when the monthly budget is spent. An operation that starts under the cap may
    finish over it (a single ask is about three calls)."""
    budget = await pool.fetchval("SELECT monthly_call_budget FROM projects WHERE id=$1", project_id)
    if budget is None:
        return
    used = await calls_this_month(pool, project_id)
    if used >= budget:
        raise HTTPException(429, {"error": "budget_exceeded", "used": used, "budget": budget,
                                  "note": "This project's monthly model-call budget is used up. An admin can raise it."})
