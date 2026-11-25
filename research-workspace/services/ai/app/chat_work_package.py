"""A Home chat is saved to its project as one work package: its evidence, its sources and its overview document.

The chat already holds everything: each answer is stored with its full payload (claims, cited passages, the models'
verdicts, the judge's statement, the closest passages). So nothing here calls a model. The work package is created
once per chat, and each later answer in that chat refreshes its evidence. An edited overview is never overwritten."""
import asyncio
import json
import logging
from datetime import date, datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends

from .access import project_with
from .auth import require_user
from .clients import get_pool
from .evidence import (_add_references, _text_block, configured_models, fallback_items, findings_block,
                       references_block, store_items)
from .governance import audit
from .routes_tasks import insert_work_package
from .word_export import validate_rich_document

log = logging.getLogger(__name__)
router = APIRouter(tags=["chats"])
SAVE_TIMEOUT_S = 10.0
TITLE_CHARS = 120


def _uuid(value: Any) -> UUID | None:
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None


def _item(text: str, quote: str, confirmed: bool, chunk_ids: list[str], meta: dict[str, Any] | None,
          found_by: list[str]) -> dict[str, Any]:
    """One evidence item from a claim and the stored details of its first passage."""
    meta = meta or {}
    label = str(meta.get("label") or "")
    return {
        "claim_text": text, "quote": quote, "status": "verified" if confirmed else "pending",
        "found_by": found_by, "confirmed": confirmed,
        "chunk_ids": [u for u in (_uuid(c) for c in chunk_ids) if u],
        "source_id": _uuid(meta.get("source_id")), "source_title": label.split(", doi:")[0] or None,
        "doi": meta.get("doi"), "source_url": meta.get("url"), "origin": meta.get("origin"),
        "pub_year": None, "accessed_on": datetime.now(timezone.utc).date(),
    }


def chat_items(answers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Evidence items for a whole chat: each distinct claim once. A confirmed claim is verified; one model's claim is
    pending. When no answer has a claim, the closest passages are kept as pending items."""
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for payload in answers:
        chunks = payload.get("chunks") or {}
        models = payload.get("models") or {}
        verified = {key: {c.get("text") for c in ((models.get(key) or {}).get("claims") or []) if c.get("verified")}
                    for key in ("model_a", "model_b")}
        for claim in payload.get("claims") or []:
            text = str(claim.get("text") or "").strip()
            if not text or text in seen:
                continue
            seen.add(text)
            ids = [str(c) for c in claim.get("chunk_ids") or []]
            meta = chunks.get(ids[0]) if ids else None
            found_by = sorted(k for k in ("model_a", "model_b") if text in verified[k])
            items.append(_item(text, str(claim.get("quote") or ""), bool(claim.get("confirmed")), ids, meta, found_by))
    if not items:
        for answer in answers:
            chunks = answer.get("chunks") or {}
            rows = []
            for cid in answer.get("related") or []:
                meta = chunks.get(cid)
                if meta and _uuid(cid):
                    rows.append({"chunk_id": _uuid(cid), "text": meta.get("text") or "",
                                 "source_id": _uuid(meta.get("source_id")),
                                 "source_title": str(meta.get("label") or "").split(", doi:")[0] or None,
                                 "doi": meta.get("doi"), "source_url": meta.get("url"), "origin": meta.get("origin")})
            items.extend(fallback_items(rows))
    return items


def chat_overview_doc(title: str, questions: list[str], statement: str | None, items: list[dict[str, Any]]) -> str:
    """The work package's overview: objective, follow-up questions, the answer summary, the findings with their source
    numbers, and the references. Rich text, checked before it is returned."""
    followups = [{"type": "listItem", "content": [_text_block("paragraph", q)]} for q in questions[1:]]
    nodes = [
        _text_block("heading", title or "Work package", level=1),
        _text_block("heading", "Research objective", level=2),
        _text_block("paragraph", questions[0] if questions else "Not set"),
        _text_block("heading", "Follow-up questions", level=2),
        {"type": "bulletList", "content": followups} if followups else _text_block("paragraph", "None yet."),
        _text_block("heading", "Answer summary", level=2),
        _text_block("paragraph", statement or "No claim could be verified yet. The closest passages are listed as evidence."),
        *findings_block(items),
    ]
    nodes += references_block(items)
    body = json.dumps({"type": "doc", "content": nodes})
    validate_rich_document(body)
    return body


async def sync_chat_work_package(pool, project_id: UUID, thread_id: UUID, user: UUID) -> dict[str, Any] | None:
    """Create the chat's work package on its first answer; refresh its evidence and sources on every answer. The
    overview is written only while the user has not edited it."""
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", f"chat-wp:{thread_id}")
        th = await conn.fetchrow(
            """SELECT th.work_package_task_id FROM threads th JOIN tasks t ON t.id = th.task_id
               WHERE th.id=$1 AND t.project_id=$2""", thread_id, project_id)
        if th is None:
            return None
        questions = [r["content"] for r in await conn.fetch(
            "SELECT content FROM messages WHERE thread_id=$1 AND role='user' ORDER BY created_at", thread_id)]
        finals = []
        for r in await conn.fetch(
                """SELECT model_b_raw -> 'final' AS final FROM messages
                   WHERE thread_id=$1 AND role='assistant' AND model_b_raw ? 'final' ORDER BY created_at""", thread_id):
            final = json.loads(r["final"]) if isinstance(r["final"], str) else r["final"]
            if isinstance(final, dict):
                finals.append(final)
        if not finals or not questions:
            return None
        items = chat_items(finals)
        statement = next((f.get("statement") for f in reversed(finals) if f.get("statement")), None)
        title = questions[0].strip()[:TITLE_CHARS] or "Chat"
        tid = th["work_package_task_id"]
        if tid is None:
            doc = chat_overview_doc(title, questions, statement, items)
            tid, _wp, code = await insert_work_package(conn, project_id, title, None, None, None, doc)
            await conn.execute("UPDATE threads SET work_package_task_id=$2 WHERE id=$1", thread_id, tid)
        else:
            row = await conn.fetchrow(
                """SELECT w.code, w.title, d.version FROM tasks t JOIN work_packages w ON w.id = t.work_package_id
                   LEFT JOIN work_package_documents d ON d.task_id = t.id WHERE t.id=$1""", tid)
            code, title = row["code"], row["title"]
            if row["version"] == 0:       # not edited yet: keep the overview in step with the chat
                await conn.execute(
                    "UPDATE work_package_documents SET body=$2, updated_at=now() WHERE task_id=$1",
                    tid, chat_overview_doc(title, questions, statement, items))
        run_id = await conn.fetchval(
            """INSERT INTO evidence_runs (task_id, project_id, status, question, statement, papers_read, models,
                                          requested_by, started_at, finished_at, error)
               VALUES ($1, $2, 'complete', $3, $4, $5, $6::jsonb, $7, now(), now(), NULL)
               ON CONFLICT (task_id) DO UPDATE SET status='complete', question=EXCLUDED.question,
                 statement=EXCLUDED.statement, papers_read=EXCLUDED.papers_read, models=EXCLUDED.models,
                 finished_at=now(), error=NULL
               RETURNING id""",
            tid, project_id, questions[0], statement,
            len({i["source_id"] for i in items if i.get("source_id")}), json.dumps(configured_models()), user)
        await store_items(conn, run_id, tid, project_id, items)
        for source_id in {i["source_id"] for i in items if i.get("source_id")}:
            await conn.execute(
                "INSERT INTO task_sources (task_id, source_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", tid, source_id)
    await _add_references(pool, tid, items)
    await audit(pool, project_id, user, "chat.work_package", "task", tid, thread=str(thread_id), items=len(items))
    return {"task_id": str(tid), "code": code, "title": title}


async def save_chat_work_package(pool, project_id: UUID, thread_id: UUID, user: UUID) -> dict[str, Any] | None:
    """The sync for the answer path: bounded in time, and never allowed to break the answer. Failure is logged."""
    try:
        return await asyncio.wait_for(sync_chat_work_package(pool, project_id, thread_id, user), SAVE_TIMEOUT_S)
    except Exception as exc:      # the answer is already saved; the work package can be retried from the chat
        log.warning("chat work package not saved for thread %s: %s", thread_id, str(exc)[:240])
        return None


@router.post("/projects/{project_id}/chats/{thread_id}/work-package", status_code=201,
             dependencies=[Depends(project_with("researcher"))])
async def save_chat_work_package_route(project_id: UUID, thread_id: UUID, user: UUID = Depends(require_user),
                                       pool=Depends(get_pool)):
    """Save (or refresh) a chat's work package on demand. Safe to repeat: a chat has one work package."""
    result = await sync_chat_work_package(pool, project_id, thread_id, user)
    if result is None:
        from fastapi import HTTPException
        raise HTTPException(409, "This chat has no answer yet, so there is nothing to save.")
    return result
