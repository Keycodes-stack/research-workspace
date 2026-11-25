"""Evidence library: every research work package is researched by the AI engine, automatically.

Flow per work package: the top papers by API relevance are stored (open discovery; closed repositories use only their
locked sources) -> the best passages go to both models -> the verified claims become evidence items. Model A is the
judge, as in /ask. The result is shown on the project's Evidence page and its references are added to the work
package document."""
import asyncio
import json
import logging
from datetime import date, datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from .access import task_for_user, project_for_user, task_sources
from .auth import require_user
from .clients import get_pool, get_s3
from .config import get_settings
from .deps import get_embedder, get_llms, get_tokenizer
from .governance import Meter, check_budget, audit
from .ingest import store
from .measurements import measurements_for
from .orchestration.engine import CrossCheckFailed, run_dual
from .orchestration.prompts import fit_to_budget
from .orchestration.schema import ContextChunk
from .routes_tasks import MAX_PASSAGES_PER_SOURCE, progress, reading_order, search_and_store
from .verification.verifier import VerifyConfig
from .word_export import validate_rich_document

log = logging.getLogger(__name__)
router = APIRouter(tags=["evidence"])

REFERENCES_HEADING = "Evidence references"
STALE_AFTER_MINUTES = 15
_PROVIDER_NAMES = {"mistral": "Mistral", "groq": "Groq", "gemini": "Gemini", "ollama": "Ollama", "compat": "Compat"}
_background: set[asyncio.Task] = set()     # strong references, so running tasks are not garbage-collected
_slots: asyncio.Semaphore | None = None    # at most two work packages researched at once (provider rate limits)


def _limit() -> asyncio.Semaphore:
    global _slots
    if _slots is None:
        _slots = asyncio.Semaphore(2)
    return _slots


# ---- what the research asks -----------------------------------------------------------------------------------

def model_label(provider: str, name: str) -> str:
    """The name shown on evidence tags, from the configured provider and model (e.g. 'Mistral mistral-small-latest')."""
    base = _PROVIDER_NAMES.get(provider, provider.title() if provider else "Model")
    return f"{base} {name}".strip() if name else base


def configured_models() -> dict[str, dict[str, str]]:
    s = get_settings()
    return {"model_a": {"label": model_label(s.model_a_provider, s.model_a_name)},
            "model_b": {"label": model_label(s.model_b_provider, s.model_b_name)}}


def _items(value: Any) -> list[str]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return [value] if value.strip() else []
    return [str(x).strip() for x in value or [] if str(x).strip()]


def build_question(project: dict, wp: dict) -> str:
    """The research question, composed from the project's and the work package's own fields."""
    parts = [
        ("Project", project.get("name")),
        ("Objective", project.get("business_objective")),
        ("Background", project.get("business_case")),
        ("Expected outcome", project.get("expected_outcome")),
        ("In scope", "; ".join(_items(project.get("in_scope")))),
        ("Out of scope", "; ".join(_items(project.get("out_of_scope")))),
        ("Work package", wp.get("title")),
        ("Brief", wp.get("brief")),
        ("Stage", wp.get("stage")),
        ("Due", str(wp["due_date"]) if wp.get("due_date") else None),
    ]
    return "\n".join(f"{k}: {str(v).strip()}" for k, v in parts if v and str(v).strip())


def search_text(project: dict, wp: dict) -> str:
    """Short text for the paper search: the work package title first, then the project objective."""
    text = " ".join(x for x in (wp.get("title"), project.get("business_objective") or project.get("name")) if x)
    return " ".join(text.split())[:300]


# ---- scheduling -----------------------------------------------------------------------------------------------

async def schedule_runs(pool, project_id: UUID, task_ids: list[UUID], requested_by: UUID | None) -> list[UUID]:
    """Mark the work packages as queued and start each research run in the background. A run already in progress
    is left alone."""
    queued = []
    for tid in task_ids:
        row = await pool.fetchrow(
            """INSERT INTO evidence_runs (task_id, project_id, status, requested_by, started_at, finished_at, error)
               VALUES ($1, $2, 'queued', $3, now(), NULL, NULL)
               ON CONFLICT (task_id) DO UPDATE
                 SET status = 'queued', requested_by = EXCLUDED.requested_by, started_at = now(),
                     finished_at = NULL, error = NULL, references_added = false
                 WHERE evidence_runs.status NOT IN ('queued', 'running')
               RETURNING task_id""",
            tid, project_id, requested_by)
        if row is None:
            continue
        queued.append(tid)
        job = asyncio.create_task(_run_guarded(tid, requested_by))
        _background.add(job)
        job.add_done_callback(_background.discard)
    return queued


async def schedule_project_runs(pool, project_id: UUID, requested_by: UUID | None) -> list[UUID]:
    """Called when a project is created: one run for every work package it was created with."""
    rows = await pool.fetch("SELECT id FROM tasks WHERE project_id=$1 AND work_package_id IS NOT NULL", project_id)
    return await schedule_runs(pool, project_id, [r["id"] for r in rows], requested_by)


async def sweep_stale(pool) -> None:
    """At start-up: runs that were still going when the service stopped are marked failed, so none stays stuck."""
    await pool.execute(
        """UPDATE evidence_runs SET status='failed', error='The research was interrupted. Run it again.',
                  finished_at=now()
           WHERE status IN ('queued', 'running') AND started_at < now() - make_interval(mins => $1)""",
        STALE_AFTER_MINUTES)


async def _run_guarded(task_id: UUID, requested_by: UUID | None) -> None:
    async with _limit():
        try:
            await run_evidence(task_id, requested_by)
        except Exception as exc:                       # never leave the row stuck in 'running'
            log.exception("evidence run failed for task %s", task_id)
            pool = await get_pool()
            await _finish(pool, task_id, "failed", error=str(exc)[:500] or exc.__class__.__name__)


async def _finish(pool, task_id: UUID, status: str, *, statement: str | None = None, papers_read: int = 0,
                  models: dict | None = None, error: str | None = None) -> None:
    await pool.execute(
        """UPDATE evidence_runs SET status=$2, statement=$3, papers_read=$4, models=$5::jsonb, error=$6,
                  finished_at=now()
           WHERE task_id=$1""",
        task_id, status, statement, papers_read, json.dumps(models or {}), error)


# ---- the research itself --------------------------------------------------------------------------------------

async def _research_row(pool, task_id: UUID):
    """The project and work package fields the research question is built from. The brief lives on the task."""
    return await pool.fetchrow(
        """SELECT t.id AS task_id, t.project_id, p.mode::text AS mode, p.name, p.business_objective,
                  p.business_case, p.expected_outcome, p.in_scope, p.out_of_scope,
                  w.title, t.brief, w.stage, w.due_date
           FROM tasks t JOIN projects p ON p.id = t.project_id
           LEFT JOIN work_packages w ON w.id = t.work_package_id
           WHERE t.id = $1""", task_id)


async def run_evidence(task_id: UUID, requested_by: UUID | None) -> None:
    pool = await get_pool()
    cfg = get_settings()
    row = await _research_row(pool, task_id)
    if row is None:
        return
    project_id = row["project_id"]
    project, wp = dict(row), dict(row)
    question = build_question(project, wp)
    await pool.execute("UPDATE evidence_runs SET status='running', question=$2 WHERE task_id=$1", task_id, question)
    progress(task_id, "Reading the project and the work package...", reset=True)

    # 1. Sources: closed repositories use their locked sources only; open discovery stores the top papers.
    if row["mode"] == "closed_repository":
        source_ids = [s["id"] for s in await task_sources(pool, task_id)]
        if not source_ids:
            await _finish(pool, task_id, "waiting", statement="Waiting for sources: approve the work package's sources.")
            return
        uploads = []
    else:
        uploads = [r["id"] for r in await pool.fetch(
            "SELECT id FROM sources WHERE project_id=$1 AND origin = 'user_upload'", project_id)]
        source_ids = uploads

    embedder, tokenizer, s3 = get_embedder(), get_tokenizer(), get_s3()
    if row["mode"] != "closed_repository":
        results, _picked, _found, _stats = await search_and_store(
            pool, s3, embedder, tokenizer, cfg, project_id, task_id, search_text(project, wp), reuse_known=True)
        source_ids = list(dict.fromkeys([*source_ids, *[r.source_id for r in results if r.chunks]]))

    # 2. Passages: the best passage of each source, in reading order, within the evidence token budget.
    q = await asyncio.to_thread(embedder.embed_query, search_text(project, wp))
    hits = [h for h in await store.search_per_source(pool, q, source_ids, cfg.evidence_passages_per_source)
            if h.intact()]
    best = max((h.similarity for h in hits), default=None)
    if best is None:
        await _finish(pool, task_id, "complete", statement="No passage in the sources matches this work package yet.",
                      models=configured_models())
        await _add_references(pool, task_id, [])
        return
    if best < cfg.similarity_threshold and cfg.similarity_gate == "strict":
        await _finish(pool, task_id, "complete", models=configured_models(),
                      statement="No passage is close enough to the work package, so no model was asked.")
        return
    # Lenient gate: loose matches go to the models; the quote check removes whatever the sources do not support.
    ordered = reading_order(hits, cfg.evidence_passages_per_source)
    meta = await store.fetch_chunks(pool, [h.chunk_id for h in ordered])
    chunks = []
    for h in ordered:
        m = meta[h.chunk_id]
        label = (m["title"] or m["filename"] or "untitled") + (f", doi:{m['doi']}" if m["doi"] else "")
        chunks.append(ContextChunk(h.chunk_id, h.text, label, h.page_start, h.page_end, h.sha256))
    chunks, _trimmed = fit_to_budget(chunks, cfg.evidence_context_token_budget)
    papers_read = len({c.label for c in chunks})

    # 3. Both models read the passages; model A also judges the two answers (as in /ask).
    await check_budget(pool, project_id)
    progress(task_id, f"Two models are reading {papers_read} papers...")
    meter = Meter(get_llms())
    a, b = meter.llms
    vcfg = VerifyConfig(cfg.fuzzy_threshold, cfg.min_quote_tokens, cfg.min_support, cfg.strict_numbers)
    try:
        result = await run_dual(question, chunks, a, b, judge=a, verify=vcfg, lenient=cfg.judge_lenient)
    except CrossCheckFailed as exc:
        await meter.record(pool, project_id, requested_by, "evidence")
        await _finish(pool, task_id, "failed", papers_read=papers_read, models=configured_models(),
                      error=f"The models could not finish the check: {str(exc)[:300]}")
        return
    await meter.record(pool, project_id, requested_by, "evidence")

    # 4. Evidence items: one per claim the judge kept, numbered per project.
    progress(task_id, "Saving the evidence...")
    items = await _build_items(pool, result)
    # Nothing verified, but papers were read: keep the closest passages as pending items, so the library shows them.
    fallback = not items and bool(ordered)
    if fallback:
        items = fallback_items(_fallback_passages(ordered, meta))
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("DELETE FROM evidence_items WHERE task_id=$1", task_id)
        run_id = await conn.fetchval("SELECT id FROM evidence_runs WHERE task_id=$1", task_id)
        offset = await conn.fetchval(
            "SELECT COALESCE(max(seq), 0) FROM evidence_items WHERE project_id=$1 AND task_id<>$2", project_id, task_id)
        for seq, item in enumerate(items, start=offset + 1):
            await conn.execute(
                """INSERT INTO evidence_items (run_id, task_id, project_id, seq, claim_text, quote, status, found_by,
                       confirmed, chunk_ids, source_id, source_title, doi, source_url, origin, pub_year, accessed_on)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)""",
                run_id, task_id, project_id, seq, item["claim_text"], item["quote"], item["status"],
                item["found_by"], item["confirmed"], item["chunk_ids"], item["source_id"], item["source_title"],
                item["doi"], item["source_url"], item["origin"], item["pub_year"], item["accessed_on"])
    models = configured_models()
    await _finish(pool, task_id, "complete", statement=result.statement or (UNVERIFIED_NOTE if fallback else None),
                  papers_read=papers_read, models=models)
    await _add_references(pool, task_id, items)
    await audit(pool, project_id, requested_by or project_id, "evidence.run", "task", task_id,
                items=len(items), papers_read=papers_read)


UNVERIFIED_NOTE = "No claim could be verified against the sources. The closest passages are listed as unverified evidence."


def _fallback_passages(hits, meta) -> list[dict[str, Any]]:
    """The passages a run read, with the source fields the library shows."""
    rows = []
    for h in hits:
        m = meta.get(h.chunk_id)
        if m is None:
            continue
        rows.append({"chunk_id": h.chunk_id, "text": h.text, "source_id": m["source_id"],
                     "source_title": m["title"] or m["filename"] or "untitled",
                     "doi": m["doi"], "source_url": (f"https://doi.org/{m['doi']}" if m["doi"] else m["source_url"]),
                     "origin": str(m["origin"]) if m["origin"] is not None else None})
    return rows


def fallback_items(passages: list[dict[str, Any]], limit: int = 6) -> list[dict[str, Any]]:
    """The closest passages as PENDING evidence items: visible, labelled, never presented as verified claims."""
    today = datetime.now(timezone.utc).date()
    out = []
    for p in passages[:limit]:
        text = " ".join(str(p.get("text") or "").split())
        out.append({
            "claim_text": f"Closest passage, not verified: {text[:240]}", "quote": "", "status": "pending",
            "found_by": [], "confirmed": False, "chunk_ids": [p["chunk_id"]], "source_id": p.get("source_id"),
            "source_title": p.get("source_title"), "doi": p.get("doi"), "source_url": p.get("source_url"),
            "origin": p.get("origin"), "pub_year": p.get("pub_year"), "accessed_on": today,
        })
    return out


async def _build_items(pool, result) -> list[dict[str, Any]]:
    chunk_ids = list({cid for claim in result.claims for cid in claim.chunk_ids})
    chunk_rows = await store.fetch_chunks(pool, [UUID(str(c)) for c in chunk_ids])
    source_ids = list({r["source_id"] for r in chunk_rows.values()})
    years = {r["id"]: r["year"] for r in await pool.fetch(
        "SELECT id, year FROM sources WHERE id = ANY($1::uuid[])", source_ids)} if source_ids else {}
    out = []
    for claim in result.claims:
        ids = [UUID(str(c)) for c in claim.chunk_ids]
        first = chunk_rows.get(ids[0]) if ids else None
        found_by = sorted({m for m, checks in result.checks.items() for c in checks
                           if c.verified and (c.quote == claim.quote or c.claim_text == claim.text)})
        source_id = first["source_id"] if first else None
        out.append({
            "claim_text": claim.text, "quote": claim.quote or "",
            "status": "verified" if claim.confirmed else "pending",
            "found_by": found_by, "confirmed": bool(claim.confirmed), "chunk_ids": ids,
            "source_id": source_id,
            "source_title": (first["title"] or first["filename"] or "untitled") if first else None,
            "doi": first["doi"] if first else None,
            "source_url": (f"https://doi.org/{first['doi']}" if first["doi"] else first["source_url"]) if first else None,
            "origin": str(first["origin"]) if first else None,
            "pub_year": years.get(source_id),
            "accessed_on": datetime.now(timezone.utc).date(),
        })
    return out


# ---- references in the work package document ------------------------------------------------------------------

def _text_block(kind: str, text: str, level: int | None = None) -> dict[str, Any]:
    node: dict[str, Any] = {"type": kind, "content": [{"type": "text", "text": text[:600]}]}
    if level:
        node["attrs"] = {"level": level}
    return node


def references_block(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """A heading and one numbered entry per source the evidence cites."""
    seen: dict[str, dict[str, Any]] = {}
    for it in items:
        key = str(it.get("source_id") or it.get("source_title"))
        entry = seen.setdefault(key, {"title": it.get("source_title") or "untitled", "year": it.get("pub_year"),
                                      "ref": it.get("doi") or it.get("source_url") or "",
                                      "accessed": it.get("accessed_on"), "both": False})
        entry["both"] = entry["both"] or bool(it.get("confirmed"))
    nodes = [_text_block("heading", REFERENCES_HEADING, level=2)]
    if not seen:
        nodes.append(_text_block("paragraph", "No evidence has been found for this work package yet."))
        return nodes
    entries = []
    for n, e in enumerate(seen.values(), start=1):
        year = f" ({e['year']})" if e["year"] else ""
        ref = f" {e['ref']}." if e["ref"] else ""
        accessed = f" Accessed {e['accessed']}." if e["accessed"] else ""
        verdict = "confirmed by both models" if e["both"] else "single model"
        entries.append({"type": "listItem", "content": [_text_block(
            "paragraph", f"[{n}] {e['title']}{year}.{ref}{accessed} {verdict}.")]})
    nodes.append({"type": "bulletList", "content": entries})
    return nodes


async def _add_references(pool, task_id: UUID, items: list[dict[str, Any]]) -> None:
    """Put the references at the end of the work package document, replacing an earlier list. Only for documents the
    editor stores as rich text; a document saved in the editor's own format gets an 'Insert references' action instead."""
    block = references_block(items)
    for _ in range(2):                                   # one retry if someone saved in between
        row = await pool.fetchrow("SELECT body, format, version FROM work_package_documents WHERE task_id=$1", task_id)
        if row is None or row["format"] != "tiptap":
            await pool.execute("UPDATE evidence_runs SET references_added=false WHERE task_id=$1", task_id)
            return
        try:
            doc = json.loads(row["body"] or "null")
            content = doc.get("content") or []
        except (ValueError, AttributeError):
            await pool.execute("UPDATE evidence_runs SET references_added=false WHERE task_id=$1", task_id)
            return
        cut = next((i for i, n in enumerate(content)
                    if n.get("type") == "heading" and _plain(n) == REFERENCES_HEADING), len(content))
        new_body = json.dumps({"type": "doc", "content": content[:cut] + block})
        try:
            validate_rich_document(new_body)
        except ValueError:
            await pool.execute("UPDATE evidence_runs SET references_added=false WHERE task_id=$1", task_id)
            return
        status = await pool.execute(
            """UPDATE work_package_documents SET body=$2, version=version+1, updated_at=now()
               WHERE task_id=$1 AND version=$3""", task_id, new_body, row["version"])
        if status.endswith(" 1"):
            await pool.execute("UPDATE evidence_runs SET references_added=true WHERE task_id=$1", task_id)
            return
    await pool.execute("UPDATE evidence_runs SET references_added=false WHERE task_id=$1", task_id)


def _plain(node: dict[str, Any]) -> str:
    return "".join(c.get("text", "") for c in node.get("content") or [] if isinstance(c, dict))


# ---- API ------------------------------------------------------------------------------------------------------

def _run_out(r) -> dict[str, Any]:
    d = dict(r)
    d["models"] = json.loads(d["models"]) if isinstance(d.get("models"), str) else (d.get("models") or {})
    for k in ("task_id", "project_id", "id"):
        if d.get(k) is not None:
            d[k] = str(d[k])
    for k in ("started_at", "finished_at"):
        if isinstance(d.get(k), datetime):
            d[k] = d[k].isoformat()
    return d


def _item_out(r) -> dict[str, Any]:
    d = dict(r)
    for k in ("id", "task_id", "project_id", "source_id"):
        if d.get(k) is not None:
            d[k] = str(d[k])
    d["chunk_ids"] = [str(c) for c in d.get("chunk_ids") or []]
    d["evidence_id"] = f"Evidence {d.pop('seq'):03d}"
    d["created_at"] = d["created_at"].isoformat() if d.get("created_at") else None
    d["accessed_on"] = d["accessed_on"].isoformat() if isinstance(d.get("accessed_on"), date) else None
    return d


_ITEM_SQL = """SELECT i.id, i.task_id, i.project_id, i.seq, i.claim_text, i.quote, i.status, i.found_by, i.confirmed,
                      i.chunk_ids, i.source_id, i.source_title, i.doi, i.source_url, i.origin, i.pub_year, i.accessed_on,
                      i.created_at, w.code AS work_package_code, w.title AS work_package_title
               FROM evidence_items i JOIN tasks t ON t.id = i.task_id
               LEFT JOIN work_packages w ON w.id = t.work_package_id"""


@router.get("/projects/{project_id}/evidence")
async def project_evidence(q: str | None = None, work_package: str | None = None, model: str | None = None,
                           status: str | None = None, project=Depends(project_for_user), pool=Depends(get_pool)):
    """Evidence Library: totals, the runs of every work package, and the evidence items (with filters)."""
    pid = project["id"]
    sources = await pool.fetchval(
        "SELECT count(*) FROM sources WHERE project_id=$1 AND (in_library OR origin='user_upload')", pid)
    # Every work package appears, even one whose research never started (status 'not_started'), so the page
    # always offers a Run button for it.
    runs = await pool.fetch(
        """SELECT t.id AS task_id, t.project_id, COALESCE(r.status, 'not_started') AS status, r.question,
                  r.statement, COALESCE(r.papers_read, 0) AS papers_read, r.models, r.error,
                  COALESCE(r.references_added, false) AS references_added,
                  r.started_at, r.finished_at, w.code, w.title AS work_package_title
           FROM tasks t JOIN work_packages w ON w.id = t.work_package_id
           LEFT JOIN evidence_runs r ON r.task_id = t.id
           WHERE t.project_id=$1 ORDER BY w.code NULLS LAST, r.started_at NULLS FIRST""", pid)
    clauses, args = ["i.project_id = $1"], [pid]
    if q and q.strip():
        args.append(f"%{q.strip()}%")
        clauses.append(f"(i.claim_text ILIKE ${len(args)} OR i.quote ILIKE ${len(args)} OR i.source_title ILIKE ${len(args)})")
    if work_package:
        args.append(work_package)
        clauses.append(f"(i.task_id::text = ${len(args)} OR w.code = ${len(args)})")
    if model in ("model_a", "model_b"):
        args.append(model)
        clauses.append(f"${len(args)} = ANY(i.found_by)")
    if status in ("verified", "pending"):
        args.append(status)
        clauses.append(f"i.status = ${len(args)}")
    rows = await pool.fetch(f"{_ITEM_SQL} WHERE {' AND '.join(clauses)} ORDER BY i.seq", *args)
    everything = await pool.fetch("SELECT status FROM evidence_items WHERE project_id=$1", pid)
    counts = await _source_counts(pool, pid)
    runs_out = [_run_out(r) for r in runs]
    for run in runs_out:
        run["sources"] = counts.get(run["task_id"], {"papers": 0, "uploads": 0})
    items_out = [_item_out(r) for r in rows]
    return {
        "summary": {
            "total_sources": sources,
            "claims_supported": sum(r["status"] == "verified" for r in everything),
            "need_verification": sum(r["status"] == "pending" for r in everything),
        },
        "models": configured_models(),
        "runs": runs_out,
        "items": items_out,
        "measurements": measurements_for(items_out),
    }


async def _source_counts(pool, project_id: UUID) -> dict[str, dict[str, int]]:
    """Per work package: the papers it selected, and the documents uploaded to it (the source register counts)."""
    rows = await pool.fetch(
        """SELECT ts.task_id, s.origin::text AS origin, count(*) AS n
           FROM task_sources ts JOIN sources s ON s.id = ts.source_id JOIN tasks t ON t.id = ts.task_id
           WHERE t.project_id=$1 GROUP BY ts.task_id, s.origin""", project_id)
    out: dict[str, dict[str, int]] = {}
    for r in rows:
        counts = out.setdefault(str(r["task_id"]), {"papers": 0, "uploads": 0})
        counts["uploads" if r["origin"] == "user_upload" else "papers"] += r["n"]
    return out


@router.get("/tasks/{task_id}/evidence")
async def task_evidence(task_id: UUID, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    await task_for_user(pool, task_id, user, "viewer")
    run = await pool.fetchrow(
        """SELECT task_id, status, question, statement, papers_read, models, error, references_added, started_at,
                  finished_at FROM evidence_runs WHERE task_id=$1""", task_id)
    rows = await pool.fetch(f"{_ITEM_SQL} WHERE i.task_id=$1 ORDER BY i.seq", task_id)
    return {"run": _run_out(run) if run else None, "items": [_item_out(r) for r in rows]}


@router.post("/tasks/{task_id}/evidence/run", status_code=202)
async def run_task_evidence(task_id: UUID, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    """Run (or run again) the research for one work package."""
    task = await task_for_user(pool, task_id, user, "researcher")
    queued = await schedule_runs(pool, task["project_id"], [task_id], user)
    if not queued:
        raise HTTPException(409, "This work package is already being researched.")
    return {"task_id": str(task_id), "status": "queued"}


@router.get("/tasks/{task_id}/evidence/references")
async def task_references(task_id: UUID, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    """The references block for one work package, as rich text, for the Workspace's 'Insert references' action.
    Declared before the item route so 'references' is not read as an item id."""
    await task_for_user(pool, task_id, user, "viewer")
    rows = await pool.fetch(f"{_ITEM_SQL} WHERE i.task_id=$1 ORDER BY i.seq", task_id)
    return {"heading": REFERENCES_HEADING,
            "doc": {"type": "doc", "content": references_block([dict(r) for r in rows])}}


@router.get("/tasks/{task_id}/evidence/report")
async def task_report(task_id: UUID, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    """The gate report for one work package: research outcome, evidence, sources, measurements and the audit trail.
    Approval is shown as not recorded: this app has no approval step to report on."""
    await task_for_user(pool, task_id, user, "viewer")
    wp = await pool.fetchrow(
        """SELECT w.code, w.title, w.stage, w.due_date FROM tasks t
           LEFT JOIN work_packages w ON w.id = t.work_package_id WHERE t.id=$1""", task_id)
    run = await pool.fetchrow(
        """SELECT status, statement, papers_read, error, started_at, finished_at FROM evidence_runs WHERE task_id=$1""",
        task_id)
    items = [_item_out(r) for r in await pool.fetch(f"{_ITEM_SQL} WHERE i.task_id=$1 ORDER BY i.seq", task_id)]
    sources = await pool.fetch(
        """SELECT s.title, s.doi, s.origin::text AS origin, s.year, s.source_url
           FROM task_sources ts JOIN sources s ON s.id = ts.source_id WHERE ts.task_id=$1 ORDER BY s.title""", task_id)
    audit_rows = await pool.fetch(
        """SELECT created_at, action, detail FROM audit_log
           WHERE target_type='task' AND target_id=$1 AND action LIKE 'evidence.%' ORDER BY id""", str(task_id))

    def iso(value):
        return value.isoformat() if value else None

    verified = sum(i["status"] == "verified" for i in items)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "work_package": {"code": wp["code"] if wp else None, "title": wp["title"] if wp else None,
                         "stage": wp["stage"] if wp else None, "due_date": iso(wp["due_date"]) if wp else None},
        "research": {"status": run["status"] if run else "not_started", "statement": run["statement"] if run else None,
                     "papers_read": run["papers_read"] if run else 0, "error": run["error"] if run else None,
                     "started_at": iso(run["started_at"]) if run else None,
                     "finished_at": iso(run["finished_at"]) if run else None},
        "approval": {"status": "not_recorded", "note": "No approval has been recorded for this work package."},
        "evidence": {"total": len(items), "verified": verified, "pending": len(items) - verified, "items": items},
        "measurements": measurements_for(items),
        "sources": [{"title": s["title"], "doi": s["doi"], "origin": s["origin"], "year": s["year"],
                     "url": s["source_url"]} for s in sources],
        "audit": [{"at": iso(a["created_at"]), "action": a["action"]} for a in audit_rows],
    }


@router.get("/tasks/{task_id}/evidence/{item_id}")
async def evidence_detail(task_id: UUID, item_id: UUID, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    """One evidence item with the passages it cites (text, page, seal) and the judge's statement."""
    await task_for_user(pool, task_id, user, "viewer")
    row = await pool.fetchrow(f"{_ITEM_SQL} WHERE i.id=$1 AND i.task_id=$2", item_id, task_id)
    if row is None:
        raise HTTPException(404, "evidence item not found")
    chunks = await store.fetch_chunks(pool, list(row["chunk_ids"] or []))
    run = await pool.fetchrow("SELECT statement, models FROM evidence_runs WHERE task_id=$1", task_id)
    return {
        "item": _item_out(row),
        "passages": [{"chunk_id": str(cid), "source_title": c["title"] or c["filename"], "page_start": c["page_start"],
                      "page_end": c["page_end"], "sha256": c["sha256"], "text": c["text"]}
                     for cid, c in chunks.items()],
        "statement": run["statement"] if run else None,
        "models": (json.loads(run["models"]) if isinstance(run["models"], str) else run["models"]) if run else {},
    }
