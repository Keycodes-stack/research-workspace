"""Phase 9 - Signal Board. Signals are trends / opportunities / risks mined from the project's own sources by
both models. Every signal is a verified claim with its evidence; confidence is deterministic, not model-stated."""
import hashlib
import json
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field

from .access import check_role, project_for_user, project_with
from .auth import require_user
from .clients import get_pool
from .config import get_settings
from .governance import Meter, audit, check_budget
from .deps import get_embedder, get_llms
from .orchestration.engine import CrossCheckFailed
from .synth import evidence_intact, project_chunks, verified_items
from .verification.text import normalize
from .ingest.chunking import sha256_hex

router = APIRouter(tags=["signals"])

CATEGORIES = ("trend", "opportunity", "risk")
SCANS = {
    "trend": ("emerging trend increasing adoption growth shift over time improving",
              "List up to 5 distinct TRENDS: changes over time, increases, decreases or shifts that the chunks report."),
    "opportunity": ("opportunity potential benefit improvement advantage unmet need new application",
                    "List up to 5 distinct OPPORTUNITIES: improvements, advantages or unmet needs the chunks report."),
    "risk": ("risk limitation degradation failure adverse event safety concern loss of potency",
             "List up to 5 distinct RISKS: failures, limitations, degradation or safety concerns the chunks report."),
}


def confidence(models: int, sources: int) -> str:
    """Deterministic. high: both models AND >=2 distinct sources. medium: both models OR >=2 sources."""
    if models >= 2 and sources >= 2:
        return "high"
    return "medium" if models >= 2 or sources >= 2 else "low"


def text_key(text: str) -> str:
    return sha256_hex(" ".join(normalize(text).lower().split()))


async def signal_for_user(pool, signal_id: UUID, user: UUID, minimum: str = "viewer"):
    row = await pool.fetchrow(
        """SELECT s.id, s.project_id, s.category::text AS category, s.text, s.status::text AS status,
                  s.confidence::text AS confidence, s.models_agree, s.source_count, s.merged_into,
                  s.status_reason, s.created_at, m.role::text AS role
           FROM signals s JOIN project_members m ON m.project_id = s.project_id AND m.user_id=$2
           WHERE s.id=$1""",
        signal_id, user)
    check_role(row["role"] if row else None, minimum, "signal")
    return row


class ScanIn(BaseModel):
    categories: list[Literal["trend", "opportunity", "risk"]] = list(CATEGORIES)
    top_k: int = Field(6, ge=1, le=20)


@router.post("/projects/{project_id}/signals/scan")
async def scan(body: ScanIn, project=Depends(project_with("researcher")), user: UUID = Depends(require_user), pool=Depends(get_pool),
               embedder=Depends(get_embedder), llms=Depends(get_llms)):
    cfg = get_settings()
    meter = Meter(llms)
    created, updated, skipped = 0, 0, []
    for cat in dict.fromkeys(body.categories):
        query, task = SCANS[cat]
        chunks, src, top = await project_chunks(pool, embedder, project["id"], [query], body.top_k)
        if not chunks:
            skipped.append({"category": cat, "reason": "no_source_chunks"})
            continue
        await check_budget(pool, project["id"])
        try:
            items = await verified_items(f"Identify {cat}s in these sources.", task, chunks, src, meter.llms)
        except CrossCheckFailed as e:
            await meter.record(pool, project["id"], user, "scan")
            raise HTTPException(503, {"error": "models_unavailable", "detail": str(e)})
        for it in items:
            key = text_key(it.text)
            conf = confidence(len(it.models), len(it.source_ids))
            async with pool.acquire() as conn, conn.transaction():
                row = await conn.fetchrow(
                    "SELECT id, status::text AS status FROM signals WHERE project_id=$1 AND category=$2 AND text_key=$3",
                    project["id"], cat, key)
                if row:
                    sid = row["id"]
                    updated += 1
                else:
                    sid = await conn.fetchval(
                        """INSERT INTO signals (project_id, category, text, text_key, confidence, models_agree, source_count)
                           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id""",
                        project["id"], cat, it.text, key, conf, len(it.models) >= 2, len(it.source_ids))
                    created += 1
                for e in it.evidence:
                    await conn.execute(
                        """INSERT INTO signal_evidence (signal_id, chunk_id, quote, sha256, model, match_kind)
                           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING""",
                        sid, e["chunk_id"], e["quote"], e["sha256"], e["model"], e["match_kind"])
                if row:   # re-scan found more support: recompute from all evidence
                    await _recompute(conn, sid)
    await meter.record(pool, project["id"], user, "scan")
    await audit(pool, project["id"], user, "signals.scan", "project", project["id"], created=created, categories=body.categories)
    return {"created": created, "already_known": updated, "skipped": skipped}


async def _recompute(conn, sid):
    r = await conn.fetchrow(
        """SELECT count(DISTINCT c.source_id) AS sources, count(DISTINCT e.model) AS models
           FROM signal_evidence e JOIN chunks c ON c.id = e.chunk_id WHERE e.signal_id=$1""", sid)
    await conn.execute(
        """UPDATE signals SET confidence=$2::signal_confidence, models_agree=$3, source_count=$4, updated_at=now() WHERE id=$1""",
        sid, confidence(r["models"], r["sources"]), r["models"] >= 2, r["sources"])


@router.get("/projects/{project_id}/signals")
async def list_signals(category: str | None = None, status: str | None = None, confidence_: str | None = None,
                       project=Depends(project_for_user), pool=Depends(get_pool)):
    rows = await pool.fetch(
        """SELECT id, category::text AS category, text, status::text AS status, confidence::text AS confidence,
                  models_agree, source_count, merged_into, created_at
           FROM signals WHERE project_id=$1
             AND ($2::text IS NULL OR category::text=$2) AND ($3::text IS NULL OR status::text=$3)
             AND ($4::text IS NULL OR confidence::text=$4)
           ORDER BY CASE confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, created_at DESC""",
        project["id"], category, status, confidence_)
    counts = await pool.fetch(
        "SELECT category::text AS category, status::text AS status, count(*) n FROM signals WHERE project_id=$1 GROUP BY 1,2",
        project["id"])
    return jsonable_encoder({"signals": [dict(r) for r in rows], "counts": [dict(r) for r in counts]})


@router.get("/signals/{signal_id}")
async def get_signal(signal_id: UUID, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    s = await signal_for_user(pool, signal_id, user)
    ev = await pool.fetch(
        """SELECT e.id, e.chunk_id, e.quote, e.sha256 AS sealed_sha256, e.model, e.match_kind,
                  c.text AS chunk_text, c.sha256 AS chunk_sha256, c.page_start, c.page_end,
                  COALESCE(src.title, src.filename, 'untitled') AS label, src.id AS source_id
           FROM signal_evidence e JOIN chunks c ON c.id = e.chunk_id JOIN sources src ON src.id = c.source_id
           WHERE e.signal_id=$1 ORDER BY e.model""", signal_id)
    out = []
    for r in ev:
        d = dict(r)
        # Re-verified on every read: the stored text must still hash to the seal AND still contain the quote.
        d["intact"] = evidence_intact(d["chunk_text"], d["quote"], d["sealed_sha256"], d["chunk_sha256"])
        out.append(d)
    return jsonable_encoder({**dict(s), "evidence": out})


class DecisionIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


async def _set_status(pool, s, user, status, reason, merged_into=None):
    if s["status"] == status:
        raise HTTPException(409, f"signal is already {status}")
    await pool.execute(
        """UPDATE signals SET status=$2::signal_status, status_reason=$3, decided_by=$4, merged_into=$5, updated_at=now()
           WHERE id=$1""", s["id"], status, reason, user, merged_into)
    return {"id": s["id"], "status": status}


@router.post("/signals/{signal_id}/dismiss")
async def dismiss(signal_id: UUID, body: DecisionIn, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    s = await signal_for_user(pool, signal_id, user, "researcher")
    await audit(pool, s["project_id"], user, "signal.dismiss", "signal", signal_id, reason=body.reason)
    return await _set_status(pool, s, user, "dismissed", body.reason)


@router.post("/signals/{signal_id}/restore")
async def restore(signal_id: UUID, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    s = await signal_for_user(pool, signal_id, user, "researcher")
    if s["status"] == "new":
        raise HTTPException(409, "signal is already new")
    return await _set_status(pool, s, user, "new", "restored")


@router.post("/signals/{signal_id}/promote")
async def promote(signal_id: UUID, body: DecisionIn, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    s = await signal_for_user(pool, signal_id, user, "researcher")
    if s["status"] in ("dismissed", "merged"):
        raise HTTPException(409, f"a {s['status']} signal cannot be promoted; restore it first")
    await audit(pool, s["project_id"], user, "signal.promote", "signal", signal_id, reason=body.reason)
    return await _set_status(pool, s, user, "promoted", body.reason)


class MergeIn(BaseModel):
    into: UUID
    reason: str = Field("duplicate", min_length=3, max_length=500)


@router.post("/signals/{signal_id}/merge")
async def merge(signal_id: UUID, body: MergeIn, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    s = await signal_for_user(pool, signal_id, user, "researcher")
    t = await signal_for_user(pool, body.into, user, "researcher")
    if t["id"] == s["id"]:
        raise HTTPException(400, "cannot merge a signal into itself")
    if t["project_id"] != s["project_id"] or t["category"] != s["category"]:
        raise HTTPException(400, "signals must be in the same project and category")
    if t["status"] in ("merged", "dismissed"):
        raise HTTPException(409, "target signal is not active")
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute(
            """INSERT INTO signal_evidence (signal_id, chunk_id, quote, sha256, model, match_kind)
               SELECT $2, chunk_id, quote, sha256, model, match_kind FROM signal_evidence WHERE signal_id=$1
               ON CONFLICT DO NOTHING""", s["id"], t["id"])
        await conn.execute(
            "UPDATE signals SET status='merged', merged_into=$2, status_reason=$3, decided_by=$4, updated_at=now() WHERE id=$1",
            s["id"], t["id"], body.reason, user)
        await _recompute(conn, t["id"])
    await audit(pool, s["project_id"], user, "signal.merge", "signal", signal_id, into=str(t["id"]))
    return {"id": s["id"], "status": "merged", "merged_into": t["id"]}
