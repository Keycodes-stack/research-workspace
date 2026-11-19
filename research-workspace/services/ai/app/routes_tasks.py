"""Projects, tasks (with the researcher approval lock), threads and the ask endpoint."""
import asyncio
import logging
import time
import json
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field

from .access import (
    compute_lock_hash, project_for_user, project_with, task_for_user, task_sources, thread_for_user,
)
from .auth import require_user
from .config import get_settings
from .governance import Meter, audit, check_budget
from .clients import get_pool
from .deps import get_embedder, get_llms, get_tokenizer
from .online_evidence import online_passages, persist_cited
from .ingest import store
from .orchestration.engine import CrossCheckFailed, DualResult, run_dual
from .orchestration.schema import ContextChunk
from .orchestration.prompts import fit_to_budget
from .verification.verifier import VerifyConfig
from .retrieval.pipeline import REQUEST_WORDS, _WORD, search_papers, search_query
import re

log = logging.getLogger(__name__)
router = APIRouter(tags=["tasks"])


# ---- projects --------------------------------------------------------------

class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    mode: Literal["open_discovery", "closed_repository"]
    meta: dict = Field(default_factory=dict)        # sector, lead, question, method... (descriptive only)


def _clean_meta(meta: dict) -> dict:
    """Keep descriptive fields short, flat and textual."""
    return {str(k)[:40]: str(v)[:2000] for k, v in list(meta.items())[:20] if v is not None}


@router.post("/projects", status_code=201)
async def create_project(body: ProjectIn, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    pid = await pool.fetchval(
        "INSERT INTO projects (owner_id, name, mode, meta) VALUES ($1, $2, $3, $4::jsonb) RETURNING id",
        user, body.name.strip(), body.mode, json.dumps(_clean_meta(body.meta)),
    )
    await audit(pool, pid, user, "project.create", "project", pid, name=body.name, mode=body.mode)
    return {"id": pid, "name": body.name.strip(), "mode": body.mode, "meta": _clean_meta(body.meta)}


@router.get("/projects")
async def list_projects(user: UUID = Depends(require_user), pool=Depends(get_pool)):
    rows = await pool.fetch(
        """SELECT p.id, p.name, p.mode::text AS mode, p.meta, p.created_at, m.role::text AS role
           FROM projects p JOIN project_members m ON m.project_id = p.id AND m.user_id=$1
           ORDER BY (SELECT max(ms.created_at) FROM messages ms JOIN threads th ON th.id = ms.thread_id
                       JOIN tasks t ON t.id = th.task_id WHERE t.project_id = p.id) DESC NULLS LAST,
                    p.created_at DESC""",
        user,
    )
    out = []
    for r in rows:
        d = dict(r)
        if isinstance(d.get("meta"), str):
            d["meta"] = json.loads(d["meta"])
        out.append(d)
    return {"projects": out}


@router.get("/projects/{project_id}")
async def get_project(project=Depends(project_for_user)):
    return {"id": project["id"], "name": project["name"], "mode": project["mode"], "role": project["role"]}


@router.get("/projects/{project_id}/tasks")
async def list_tasks(project=Depends(project_for_user), pool=Depends(get_pool)):
    rows = await pool.fetch(
        """SELECT id, title, brief, status::text AS status, created_at
           FROM tasks WHERE project_id=$1 AND kind='research' ORDER BY created_at DESC""", project["id"])
    return {"tasks": [dict(r) for r in rows]}


@router.get("/projects/{project_id}/sources")
async def list_sources(project=Depends(project_for_user), pool=Depends(get_pool)):
    rows = await pool.fetch(
        """SELECT s.id, s.title, s.doi, s.filename, s.origin::text AS origin, s.fulltext::text AS fulltext,
                  s.year, s.page_count, (SELECT count(*) FROM chunks c WHERE c.source_id=s.id) AS chunks
           FROM sources s WHERE s.project_id=$1 AND s.in_library ORDER BY s.created_at""",
        project["id"],
    )
    return {"sources": [dict(r) for r in rows]}


# ---- tasks and the approval lock ----------------------------------------------

class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    brief: str | None = None


@router.post("/projects/{project_id}/tasks", status_code=201)
async def create_task(body: TaskIn, project=Depends(project_with("researcher")), user: UUID = Depends(require_user),
                      pool=Depends(get_pool)):
    tid = await pool.fetchval(
        "INSERT INTO tasks (project_id, title, brief) VALUES ($1, $2, $3) RETURNING id",
        project["id"], body.title, body.brief,
    )
    await audit(pool, project["id"], user, "task.create", "task", tid, title=body.title)
    return {"id": tid, "status": "draft"}


class TaskSourcesIn(BaseModel):
    source_ids: list[UUID]


@router.get("/tasks/{task_id}")
async def get_task(task_id: UUID, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    task = await task_for_user(pool, task_id, user)
    src = await task_sources(pool, task_id)
    threads = await pool.fetch(
        "SELECT id, title, created_at FROM threads WHERE task_id=$1 ORDER BY created_at DESC", task_id)
    return {
        "id": task["id"], "project_id": task["project_id"], "title": task["title"],
        "status": task["status"], "mode": task["mode"], "source_lock_hash": task["source_lock_hash"],
        "source_ids": [r["id"] for r in src], "threads": [dict(t) for t in threads],
    }


@router.put("/tasks/{task_id}/sources")
async def set_task_sources(
    task_id: UUID, body: TaskSourcesIn, user: UUID = Depends(require_user), pool=Depends(get_pool)
):
    """Choose which documents scope the AI. Locked once the task is approved."""
    task = await task_for_user(pool, task_id, user, "researcher")
    if task["status"] != "draft":
        raise HTTPException(409, "task is approved and its sources are locked")
    valid = await pool.fetch(
        "SELECT id FROM sources WHERE project_id=$1 AND id = ANY($2::uuid[])",
        task["project_id"], body.source_ids,
    )
    if len(valid) != len(set(body.source_ids)):
        raise HTTPException(422, "some sources do not exist in this project")
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM task_sources WHERE task_id=$1", task_id)
            await conn.executemany(
                "INSERT INTO task_sources (task_id, source_id) VALUES ($1, $2)",
                [(task_id, r["id"]) for r in valid],
            )
    return {"task_id": task_id, "source_ids": [r["id"] for r in valid]}


@router.post("/tasks/{task_id}/approve")
async def approve_task(task_id: UUID, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    """Lead-scientist approval: seals the AI to the selected sources. Needs the lead_scientist role or above."""
    task = await task_for_user(pool, task_id, user, "lead_scientist")
    if task["status"] != "draft":
        raise HTTPException(409, f"task is already {task['status']}")
    sources = await task_sources(pool, task_id)
    if not sources:
        raise HTTPException(422, "select at least one source before approving")
    empty = await pool.fetchval(
        """SELECT count(*) FROM task_sources ts WHERE ts.task_id=$1
           AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source_id = ts.source_id)""",
        task_id,
    )
    if empty:
        raise HTTPException(422, f"{empty} selected source(s) have no ingested text")
    lock = compute_lock_hash(sources)
    await pool.execute(
        """UPDATE tasks SET status='approved', approved_by=$2, approved_at=now(), source_lock_hash=$3
           WHERE id=$1""",
        task_id, user, lock,
    )
    await audit(pool, task["project_id"], user, "task.approve", "task", task_id, sources=len(sources), lock=lock)
    return {"task_id": task_id, "status": "approved", "source_lock_hash": lock}


# ---- threads and ask ---------------------------------------------------------------

class ThreadIn(BaseModel):
    title: str | None = None


@router.post("/tasks/{task_id}/threads", status_code=201)
async def create_thread(
    task_id: UUID, body: ThreadIn, user: UUID = Depends(require_user), pool=Depends(get_pool)
):
    await task_for_user(pool, task_id, user, "researcher")
    tid = await pool.fetchval(
        "INSERT INTO threads (task_id, title) VALUES ($1, $2) RETURNING id", task_id, body.title)
    return {"id": tid}


@router.get("/threads/{thread_id}")
async def get_thread(
    thread_id: UUID, user: UUID = Depends(require_user), pool=Depends(get_pool)
):
    row = await thread_for_user(pool, thread_id, user)
    return {"id": str(thread_id), "task_id": str(row["task_id"]), "project_id": str(row["project_id"])}


# "How to cure this syndrome?" names no topic: the search would look for any syndrome. Such questions borrow the
# topic from the project name, or from the chat's previous question when the project name says nothing.
_REFERS = re.compile(r"\b(this|that|these|those|it|its|they|them|their|such|the same)\b", re.I)
_GENERIC_NAMES = {"new project", "untitled", "my project", "project", "test"}


def topic_context(question: str, project_name: str | None, previous_questions: list[str] | None = None) -> str:
    """Topic to add to a question that refers back to something or is too short to search on its own ('' if none).

    In a conversation "it"/"this" means what was just discussed, so the most recent earlier question that names a
    topic itself wins; the project name is the fallback for a chat's first question."""
    if not _REFERS.search(question) and len(search_query(question).split()) >= 3:
        return ""
    for prev in previous_questions or []:                    # newest first; skip filler like "and why?"
        if prev and not _REFERS.search(prev) and any(w.lower() not in REQUEST_WORDS for w in _WORD.findall(prev)):
            return prev.strip()[:200]
    name = (project_name or "").strip()
    return name if name and name.lower() not in _GENERIC_NAMES else ""


MAX_PASSAGES_PER_SOURCE = 2   # one long PDF must not crowd every other paper out of the models' context


def diversify(hits: list, top_k: int, per_source: int = MAX_PASSAGES_PER_SOURCE) -> list:
    """Best-first hits, at most `per_source` from any one source, so the answer draws on more papers."""
    seen: dict = {}
    out = []
    for h in hits:
        if seen.get(h.source_id, 0) < per_source:
            seen[h.source_id] = seen.get(h.source_id, 0) + 1
            out.append(h)
            if len(out) == top_k:
                break
    return out


class AskIn(BaseModel):
    question: str = Field(min_length=3, max_length=4000)
    top_k: int = Field(default=5, ge=1, le=20)
    # open discovery only: restrict to uploaded PDFs, to discovered papers, or both
    scope: Literal["uploads", "api", "both"] = "both"
    # open discovery only: search just these sources (e.g. the PDFs attached to this question)
    source_ids: list[UUID] | None = None
    # open discovery only: also search the literature online; found papers are kept only if the answer cites them
    online: bool = False


def render_content(r: DualResult) -> str:
    if r.reason == "below_similarity_threshold":
        return ("INSUFFICIENT_SOURCE_EVIDENCE: none of the selected sources is similar enough "
                "to the question to answer it.")
    if r.kind == "insufficient_evidence":
        # Say why: the models' own reason (e.g. "the sources discuss management of Down syndrome but give no cure")
        # tells the reader what the papers do cover, instead of a bare refusal.
        why = [n.strip() for n in ((r.model_a or {}).get("notes"), (r.model_b or {}).get("notes")) if n and n.strip()]
        text = "INSUFFICIENT_SOURCE_EVIDENCE: the selected sources do not contain enough information to answer."
        if why:
            text += " Why: " + why[0].rstrip(".") + "."
            if len(why) > 1 and why[1].lower() != why[0].lower():
                text += " Second model: " + why[1].rstrip(".") + "."
        return text + " Try asking about what these papers do cover, or rephrase the question."
    if r.kind == "disagreement":
        topics = [c["topic"] for c in (r.disagreement or {}).get("conflicts", [])]
        head = "The two models did not agree, so no single answer is given."
        return head + ("\nPoints of conflict: " + "; ".join(topics) if topics else "")
    lines = []
    for c in r.claims:
        cites = ", ".join(str(i) for i in c.chunk_ids)
        lines.append(f"- {c.text} [cite: {cites}]" + ("" if c.confirmed else " (single-model)"))
    return "\n".join(lines)


def _cross_check_note(detail: str) -> str:
    """A plain-language reason the two-model check could not finish (the raw detail stays in the response and the log)."""
    d = detail.lower()
    if "http 429" in d or "rate limit" in d:
        return ("The AI models are busy right now (the provider's usage limit was reached). "
                "No answer is shown because it could not be cross-checked. Wait about a minute and ask again.")
    if "http 413" in d or "request too large" in d:
        return ("The question pulled in more source text than the AI provider accepts in one request. "
                "Ask a narrower question, or ask again in a minute.")
    if "http 401" in d or "http 403" in d:
        return ("The AI provider rejected the access key, so the models could not be reached. "
                "Ask an administrator to check the API key.")
    if "json_validate_failed" in d or "invalid output" in d or "malformed" in d:
        return ("One of the models returned an unusable reply. No answer is shown because it could not be "
                "cross-checked. Please ask again.")
    if "timeout" in d or "connect" in d or "transport" in d or "readerror" in d:
        return "The AI models could not be reached. Check the connection and try again."
    return "No answer is shown because it could not be cross-checked. Please try again."


@router.post("/threads/{thread_id}/ask")
async def ask(
    thread_id: UUID,
    body: AskIn,
    user: UUID = Depends(require_user),
    pool=Depends(get_pool),
    embedder=Depends(get_embedder),
    tokenizer=Depends(get_tokenizer),
    llms=Depends(get_llms),
):
    t0 = time.monotonic()
    th = await thread_for_user(pool, thread_id, user, "researcher")
    sources = await task_sources(pool, th["task_id"])

    if th["mode"] == "closed_repository":
        if th["status"] not in ("approved", "running", "complete"):
            raise HTTPException(409, "task must be approved before asking questions")
        if compute_lock_hash(sources) != th["source_lock_hash"]:
            raise HTTPException(409, "source lock mismatch: the task's sources changed after approval")
        source_ids = [s["id"] for s in sources]
    else:
        # Open discovery: explicit selection, else the project's whole source of truth,
        # narrowed by the requested scope (user uploads vs papers found via the APIs).
        cond = {"uploads": "origin = 'user_upload'", "api": "origin <> 'user_upload'", "both": "true"}[body.scope]
        if body.source_ids:
            rows = await pool.fetch(
                f"SELECT id FROM sources WHERE project_id=$1 AND id = ANY($2::uuid[]) AND {cond}",
                th["project_id"], body.source_ids)
        elif sources:
            rows = await pool.fetch(f"SELECT id FROM sources WHERE id = ANY($1::uuid[]) AND {cond}",
                                    [s["id"] for s in sources])
        else:
            rows = await pool.fetch(f"SELECT id FROM sources WHERE project_id=$1 AND {cond}", th["project_id"])
        source_ids = [r["id"] for r in rows]

    await pool.execute(
        "INSERT INTO messages (thread_id, role, content) VALUES ($1, 'user', $2)", thread_id, body.question)

    cfg = get_settings()
    context = topic_context(
        body.question,
        await pool.fetchval("SELECT name FROM projects WHERE id=$1", th["project_id"]),
        [r["content"] for r in await pool.fetch("""SELECT content FROM messages WHERE thread_id=$1 AND role='user'
                                                   ORDER BY created_at DESC OFFSET 1 LIMIT 5""", thread_id)])
    # The search and ranking get the topic first ("down syndrome cure"); the models get it as a note. The stored
    # question stays as the user wrote it.
    search_text = f"{context} {body.question}" if context else body.question
    question = f"{body.question} (topic: {context})" if context else body.question
    q = await asyncio.to_thread(embedder.embed_query, search_text)
    online = body.online and th["mode"] != "closed_repository" and body.scope != "uploads"
    passages, online_stats = [], None
    if online:
        known = {r["doi"] for r in await pool.fetch(
            "SELECT doi FROM sources WHERE project_id=$1 AND doi IS NOT NULL", th["project_id"])}
        stored, (passages, online_stats) = await asyncio.gather(
            store.search_chunks(pool, q, source_ids, body.top_k * 3),
            online_passages(search_text, q, embedder, tokenizer, exclude_dois=known,
                            contact_email=cfg.contact_email, chunk_tokens=cfg.chunk_tokens,
                            chunk_overlap=cfg.chunk_overlap))
        all_hits = diversify(sorted(stored + [op.hit for op in passages], key=lambda h: h.similarity, reverse=True),
                             body.top_k)
    else:
        all_hits = diversify(await store.search_chunks(pool, q, source_ids, body.top_k * 3), body.top_k)
    by_online = {op.hit.chunk_id: op for op in passages}
    # Integrity filter: a chunk whose text no longer matches its seal is never shown to a model.
    t_retrieved = time.monotonic()
    hits = [h for h in all_hits if h.intact()]
    dropped = len(all_hits) - len(hits)
    top = max((h.similarity for h in hits), default=None)
    gate = {"threshold": cfg.similarity_threshold, "top_similarity": top, "passed": False,
            "corrupt_chunks_dropped": dropped, "online": online_stats, "topic_context": context}

    if top is None:
        result = DualResult("insufficient_evidence",
                            "integrity_failure" if dropped else "no_source_chunks")
    elif top < cfg.similarity_threshold:
        # Refuse without calling any model.
        result = DualResult("insufficient_evidence", "below_similarity_threshold")
    else:
        gate["passed"] = True
        meta = await store.fetch_chunks(pool, [h.chunk_id for h in hits if h.chunk_id not in by_online])
        chunks = []
        for h in hits:
            if h.chunk_id in by_online:
                label = by_online[h.chunk_id].label
            else:
                m = meta[h.chunk_id]
                label = m["title"] or m["filename"] or "untitled"
                if m["doi"]:
                    label += f", doi:{m['doi']}"
            chunks.append(ContextChunk(h.chunk_id, h.text, label, h.page_start, h.page_end, h.sha256))
        chunks, trimmed = fit_to_budget(chunks, cfg.llm_context_token_budget)
        gate["passages_trimmed_for_budget"] = trimmed
        gate["passages_sent"] = len(chunks)
        gate["papers_read"] = len({c.label for c in chunks})     # distinct papers the models actually read
        await check_budget(pool, th["project_id"])
        meter = Meter(llms)
        a, b = meter.llms
        vcfg = VerifyConfig(cfg.fuzzy_threshold, cfg.min_quote_tokens, cfg.min_support, cfg.strict_numbers)
        try:
            result = await run_dual(question, chunks, a, b, judge=a, verify=vcfg)  # the stronger model matches claims; it never decides who is right
        except CrossCheckFailed as e:
            await meter.record(pool, th["project_id"], user, "ask")
            log.warning("ask cross-check unavailable: %s", e)
            raise HTTPException(503, {
                "error": "cross_check_unavailable", "detail": str(e),
                "note": _cross_check_note(str(e)),
            })

    t_models = time.monotonic()
    if gate["passed"]:
        await meter.record(pool, th["project_id"], user, "ask")
        if by_online:   # store the online papers this answer cites (and only those) before citing them
            saved = await persist_cited(pool, th["project_id"], passages, _chunk_ids(result))
            gate["online_papers_saved"] = len(saved)
    content = render_content(result)
    async with pool.acquire() as conn, conn.transaction():
        mid = await conn.fetchval(
            """INSERT INTO messages (thread_id, role, content, answer_kind, model_a_raw, model_b_raw,
                                     disagreement, top_similarity)
               VALUES ($1, 'assistant', $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7) RETURNING id""",
            thread_id, content, result.kind,
            json.dumps(jsonable_encoder(result.model_a)),
            json.dumps(jsonable_encoder({"answer": result.model_b, "judge": result.judge,
                                         "gate": gate})),
            json.dumps(jsonable_encoder(result.disagreement)) if result.disagreement else None,
            top,
        )
        rows = []
        for model, checks in result.checks.items():
            for c in checks:
                seals = _seals_for(result, model, c)
                for cid in c.chunk_ids:
                    rows.append((mid, cid, c.claim_text, c.quote,
                                 "verified" if c.verified else "purged", seals.get(cid),
                                 model, c.match_kind, c.match_score, c.reason))
        if rows:
            await conn.executemany(
                """INSERT INTO citations (message_id, chunk_id, claim_text, quoted_span, status,
                                          hash_checked, model, match_kind, match_score, reason)
                   VALUES ($1,$2,$3,$4,$5::verify_status,$6,$7,$8,$9,$10)""", rows)

    n_ok = sum(c.verified for cs in result.checks.values() for c in cs)
    n_bad = sum(not c.verified for cs in result.checks.values() for c in cs)
    payload = jsonable_encoder({
        "message_id": mid, "kind": result.kind, "reason": result.reason, "content": content,
        "claims": result.claims, "disagreement": result.disagreement, "top_similarity": top,
        "verification": {"status": "complete", "verified": n_ok, "purged": n_bad},
        "gate": gate,
        "models": _model_breakdown(result),
        "chunks": await _chunk_meta(pool, result),
        # Measured, so the UI shows real numbers: passages read and seconds spent per step.
        "timings": {"retrieve_s": round(t_retrieved - t0, 1), "models_s": round(t_models - t_retrieved, 1),
                    "total_s": round(time.monotonic() - t0, 1), "passages_used": len(hits),
                    "online_papers_searched": (online_stats or {}).get("found", 0)},
    })
    await audit(pool, th["project_id"], user, "ask", "message", mid, kind=result.kind, reason=result.reason,
                verified=n_ok, purged=n_bad)
    # keep the display payload with the message so history renders identically
    await pool.execute(
        "UPDATE messages SET model_b_raw = model_b_raw || jsonb_build_object('final', $2::jsonb) WHERE id=$1",
        mid, json.dumps(payload))
    return payload


class PapersIn(BaseModel):
    question: str = Field(min_length=3, max_length=4000)
    limit: int = Field(default=400, ge=1, le=1000)


def _paper_row(p) -> dict:
    return {"title": p.title, "year": p.year, "venue": p.venue, "authors": p.authors[:3],
            "cited_by_count": p.cited_by_count, "doi": p.doi, "origin": p.origin,
            "url": f"https://doi.org/{p.doi}" if p.doi else p.source_url, "pdf_url": p.pdf_url,
            "score": p.score}


@router.post("/threads/{thread_id}/papers")
async def list_papers(thread_id: UUID, body: PapersIn, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    """'Find papers on X': return every relevant paper the literature APIs know (title, year, links).
    No model call and nothing is indexed, so it is fast; papers are stored only when an answer cites them."""
    th = await thread_for_user(pool, thread_id, user, "researcher")
    found = await search_papers(body.question, contact_email=get_settings().contact_email, limit=body.limit)
    content = f"Found {len(found.papers)} papers for: {found.stats['query']}"
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("INSERT INTO messages (thread_id, role, content) VALUES ($1, 'user', $2)",
                           thread_id, body.question)
        mid = await conn.fetchval(
            "INSERT INTO messages (thread_id, role, content) VALUES ($1, 'assistant', $2) RETURNING id",
            thread_id, content)
    payload = jsonable_encoder({"message_id": mid, "kind": "papers", "content": content,
                                "papers": [_paper_row(p) for p in found.papers],
                                "stats": found.stats, "errors": found.errors})
    await pool.execute("UPDATE messages SET model_b_raw = jsonb_build_object('final', $2::jsonb) WHERE id=$1",
                       mid, json.dumps(payload))
    await audit(pool, th["project_id"], user, "papers.search", "message", mid,
                question=body.question[:200], found=len(found.papers))
    return payload


@router.post("/threads/{thread_id}/messages/{message_id}/flag")
async def flag_message(
    thread_id: UUID, message_id: UUID,
    user: UUID = Depends(require_user),
    pool=Depends(get_pool),
):
    """Record that a person asked for this answer to be reviewed (kept in the project's audit log)."""
    th = await thread_for_user(pool, thread_id, user, "researcher")
    msg = await pool.fetchrow(
        "SELECT id, answer_kind FROM messages WHERE id=$1 AND thread_id=$2 AND role='assistant'", message_id, thread_id)
    if not msg:
        raise HTTPException(404, "answer not found")
    await audit(pool, th["project_id"], user, "answer.flag", "message", message_id, kind=msg["answer_kind"])
    return {"message_id": str(message_id), "flagged": True}


def _chunk_ids(result: DualResult) -> set:
    ids = {cid for c in result.claims for cid in c.chunk_ids}
    d = result.disagreement or {}
    for cl in (*d.get("model_a_claims", []), *d.get("model_b_claims", [])):
        ids.update(cl["chunk_ids"])
    for checks in result.checks.values():       # the expanded model view shows each model's own claims
        for c in checks:
            ids.update(c.chunk_ids)
    return ids


def _model_breakdown(result: DualResult) -> dict:
    """What each model itself claimed and how every claim fared against the source text (empty if no model ran)."""
    if not result.checks:
        return {}
    return {
        key: {
            "verified": sum(c.verified for c in checks),
            "purged": sum(not c.verified for c in checks),
            "claims": [{"text": c.claim_text, "quote": c.quote, "verified": c.verified, "reason": c.reason,
                        "match_kind": c.match_kind, "chunk_ids": c.chunk_ids} for c in checks],
        }
        for key, checks in result.checks.items()
    }


async def _chunk_meta(pool, result: DualResult) -> dict:
    """Source label, pages and passage text for every chunk the answer cites (for the UI)."""
    rows = await store.fetch_chunks(pool, list(_chunk_ids(result)))
    return {
        str(cid): {
            "label": (r["title"] or r["filename"] or "untitled") + (f", doi:{r['doi']}" if r["doi"] else ""),
            "source_id": str(r["source_id"]), "filename": r["filename"], "doi": r["doi"], "origin": str(r["origin"]),
            "url": f"https://doi.org/{r['doi']}" if r["doi"] else r["source_url"], "in_library": r["in_library"],
            "page_start": r["page_start"], "page_end": r["page_end"],
            "sha256": r["sha256"], "text": r["text"],
        } for cid, r in rows.items()
    }


def _seals_for(result: DualResult, model: str, check) -> dict:
    """chunk_id -> sha256 that a verified claim was checked against."""
    rec = result.model_a if model == "model_a" else result.model_b
    if not check.verified:
        return {}
    for cl in rec.get("claims", []):
        if cl["text"] == check.claim_text and cl["quote"] == check.quote:
            return cl.get("seals", {})
    return {}


@router.get("/threads/{thread_id}/messages")
async def list_messages(thread_id: UUID, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    await thread_for_user(pool, thread_id, user)
    rows = await pool.fetch(
        """SELECT id, role::text AS role, content, answer_kind::text AS answer_kind,
                  disagreement, top_similarity, created_at, model_b_raw -> 'final' AS final
           FROM messages WHERE thread_id=$1 ORDER BY created_at""",
        thread_id,
    )
    out = []
    for r in rows:
        d = dict(r)
        for k in ("disagreement", "final"):
            if isinstance(d[k], str):
                d[k] = json.loads(d[k])
        out.append(d)
    return jsonable_encoder({"messages": out})
