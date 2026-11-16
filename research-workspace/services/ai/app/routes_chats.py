"""Chats belong to a project: project -> (hidden) chat task -> threads -> messages.

The server is the source of truth for chat history, so every browser and session that can open the project
sees the same chats. A chat is a thread under the project's chat task (tasks.kind = 'chat')."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field

from .access import project_for_user, project_with
from .auth import require_user
from .clients import get_pool
from .governance import audit

CHAT_TASK_TITLE = "Halden chat"

router = APIRouter(prefix="/projects/{project_id}", tags=["chats"], dependencies=[Depends(project_for_user)])

LIST_CHATS = """
SELECT th.id,
       COALESCE(NULLIF(NULLIF(th.title, ''), $2),
                (SELECT left(m.content, 120) FROM messages m
                  WHERE m.thread_id = th.id AND m.role = 'user' ORDER BY m.created_at LIMIT 1),
                'New chat') AS title,
       th.created_at,
       COALESCE((SELECT max(m.created_at) FROM messages m WHERE m.thread_id = th.id), th.created_at) AS updated_at,
       (SELECT count(*) FROM messages m WHERE m.thread_id = th.id AND m.role = 'user') AS turns
FROM threads th JOIN tasks t ON t.id = th.task_id
WHERE t.project_id = $1 AND t.kind = 'chat'
  AND EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = th.id AND m.role = 'assistant')   -- a chat is saved once it has an answer
ORDER BY updated_at DESC
"""


@router.get("/chats")
async def list_chats(project_id: UUID, pool=Depends(get_pool)):
    """This project's chats, most recently active first (a chat appears once it has an answer)."""
    rows = await pool.fetch(LIST_CHATS, project_id, CHAT_TASK_TITLE)
    return jsonable_encoder({"chats": [dict(r) for r in rows]})


class ChatIn(BaseModel):
    title: str | None = Field(default=None, max_length=200)


async def chat_task_id(conn, project_id: UUID) -> UUID:
    """The project's chat task, created on first use (the oldest one wins if an earlier version made several)."""
    await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", f"chat-task:{project_id}")
    tid = await conn.fetchval(
        "SELECT id FROM tasks WHERE project_id=$1 AND kind='chat' ORDER BY created_at LIMIT 1", project_id)
    if tid:
        return tid
    return await conn.fetchval(
        "INSERT INTO tasks (project_id, title, kind) VALUES ($1, $2, 'chat') RETURNING id", project_id, CHAT_TASK_TITLE)


@router.post("/chats", status_code=201, dependencies=[Depends(project_with("researcher"))])
async def create_chat(project_id: UUID, body: ChatIn, project=Depends(project_for_user), pool=Depends(get_pool)):
    if project["mode"] != "open_discovery":
        raise HTTPException(409, "chat is available in open-discovery projects; closed-repository projects "
                                 "ask questions through an approved research task")
    title = (body.title or "").strip() or None
    async with pool.acquire() as conn, conn.transaction():
        task_id = await chat_task_id(conn, project_id)
        thread_id = await conn.fetchval(
            "INSERT INTO threads (task_id, title) VALUES ($1, $2) RETURNING id", task_id, title)
    return {"id": str(thread_id), "title": title or "New chat"}


async def _own_chat(pool, project_id: UUID, thread_id: UUID):
    row = await pool.fetchrow(
        """SELECT th.id FROM threads th JOIN tasks t ON t.id = th.task_id
           WHERE th.id=$1 AND t.project_id=$2 AND t.kind='chat'""", thread_id, project_id)
    if not row:
        raise HTTPException(404, "chat not found")


@router.delete("/chats/{thread_id}", dependencies=[Depends(project_with("researcher"))])
async def delete_chat(project_id: UUID, thread_id: UUID, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    """Delete a chat with its messages and the citations recorded for them."""
    await _own_chat(pool, project_id, thread_id)
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute(
            "DELETE FROM citations WHERE message_id IN (SELECT id FROM messages WHERE thread_id=$1)", thread_id)
        await conn.execute("DELETE FROM messages WHERE thread_id=$1", thread_id)
        await conn.execute("DELETE FROM threads WHERE id=$1", thread_id)
    await audit(pool, project_id, user, "chat.delete", "thread", thread_id)
    return {"deleted": str(thread_id)}
