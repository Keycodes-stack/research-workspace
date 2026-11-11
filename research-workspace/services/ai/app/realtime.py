"""Live events over Postgres LISTEN/NOTIFY, delivered as server-sent events.

One NOTIFY channel; payloads are tiny (type + ids, never content) and the browser refetches what changed. That keeps
every authorisation check in the normal read endpoints: an event can't leak text, only that something changed."""
import asyncio
import json

import anyio
from typing import AsyncIterator
from uuid import UUID

CHANNEL = "rw_events"


async def notify(pool, concept_id: UUID, type_: str, **data) -> None:
    payload = json.dumps({"concept_id": str(concept_id), "type": type_, **{k: str(v) for k, v in data.items()}})
    try:
        await pool.execute("SELECT pg_notify($1, $2)", CHANNEL, payload)
    except Exception:       # pragma: no cover - a lost notification must never fail the user's action
        import logging
        logging.getLogger("realtime").exception("notify failed: %s", type_)


def sse(event: str, data: dict | str = "", id_: int | None = None) -> str:
    body = data if isinstance(data, str) else json.dumps(data)
    return (f"id: {id_}\n" if id_ is not None else "") + f"event: {event}\ndata: {body}\n\n"


async def stream_events(pool, concept_id: UUID, user: UUID, heartbeat: float = 15.0,
                        presence_ttl: int = 45) -> AsyncIterator[str]:
    """Yield SSE frames for one concept until the consumer stops iterating. Registers presence on open and removes it
    on close, and sends a comment frame every `heartbeat` seconds so proxies keep the connection."""
    queue: asyncio.Queue = asyncio.Queue(maxsize=200)
    cid = str(concept_id)

    def on_notify(_conn, _pid, _channel, payload):
        try:
            msg = json.loads(payload)
        except ValueError:
            return
        if msg.get("concept_id") == cid:
            try:
                queue.put_nowait(msg)
            except asyncio.QueueFull:           # a slow client is told to resync rather than blocking the database
                while not queue.empty():
                    queue.get_nowait()
                queue.put_nowait({"type": "resync", "concept_id": cid})

    conn = await pool.acquire()
    try:
        await conn.add_listener(CHANNEL, on_notify)
        await pool.execute(
            """INSERT INTO concept_presence (concept_id, user_id) VALUES ($1,$2)
               ON CONFLICT (concept_id, user_id) DO UPDATE SET last_seen=now()""", concept_id, user)
        await notify(pool, concept_id, "presence", user=user, state="joined")
        yield sse("ready", {"concept_id": cid, "heartbeat_seconds": heartbeat})
        n = 0
        while True:
            try:
                msg = await asyncio.wait_for(queue.get(), timeout=heartbeat)
            except asyncio.TimeoutError:
                await pool.execute("UPDATE concept_presence SET last_seen=now() WHERE concept_id=$1 AND user_id=$2", concept_id, user)
                yield ": keep-alive\n\n"
                continue
            n += 1
            yield sse(msg.pop("type"), msg, n)
    finally:
        # A client disconnect cancels this task; without a shield every await below would be cancelled again at once
        # and the connection would leak and presence would linger.
        with anyio.CancelScope(shield=True):
            try:
                await conn.remove_listener(CHANNEL, on_notify)
            finally:
                await pool.release(conn)
            try:
                await pool.execute("DELETE FROM concept_presence WHERE concept_id=$1 AND user_id=$2", concept_id, user)
                await notify(pool, concept_id, "presence", user=user, state="left")
            except Exception:       # pragma: no cover - pool may already be closing at shutdown
                pass
