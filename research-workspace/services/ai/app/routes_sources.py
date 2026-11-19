import asyncio
from dataclasses import asdict
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .access import project_for_user, project_with
from .auth import require_user
from .governance import audit
from .clients import get_pool, get_s3
from .config import get_settings
from .deps import get_embedder, get_tokenizer, make_ingest_config
from .ingest import store
from .ingest.extraction import NoExtractableText, PdfError
from .ingest.service import build_session_sources, ingest_pdf
from .retrieval.http import make_client
from .retrieval.models import DiscoveryQuery
from .retrieval.pipeline import discover

MIN_SOURCES_TO_SKIP = 10

# Every route here is scoped to a project the caller is a member of (404 otherwise); writing needs 'researcher'.
router = APIRouter(
    prefix="/projects/{project_id}", tags=["sources"], dependencies=[Depends(project_for_user)]
)


@router.post("/sources/upload", status_code=201, dependencies=[Depends(project_with("researcher"))])
async def upload_pdf(
    project_id: UUID,
    user: UUID = Depends(require_user),
    file: UploadFile = File(...),
    title: str | None = Form(None),
    pool=Depends(get_pool),
    s3=Depends(get_s3),
    embedder=Depends(get_embedder),
    tokenizer=Depends(get_tokenizer),
):
    """Mode B: add a PDF to a project's private repository."""
    s = get_settings()

    limit = s.max_pdf_mb * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"PDF larger than {s.max_pdf_mb} MB")
    if not data.startswith(b"%PDF"):
        raise HTTPException(415, "not a PDF file")

    filename = file.filename or "upload.pdf"
    source_id = await pool.fetchval(
        """INSERT INTO sources (project_id, origin, title, filename, fulltext)
           VALUES ($1, 'user_upload', $2, $3, 'pending') RETURNING id""",
        project_id, title or filename.rsplit(".", 1)[0], filename,
    )
    key = f"projects/{project_id}/sources/{source_id}.pdf"
    await asyncio.to_thread(s3.put_object, Bucket=s.s3_bucket, Key=key, Body=data)
    await pool.execute("UPDATE sources SET storage_key=$2 WHERE id=$1", source_id, key)

    try:
        n = await ingest_pdf(pool, source_id, data, make_ingest_config(embedder, tokenizer))
    except NoExtractableText as e:
        raise HTTPException(422, str(e))
    except PdfError as e:
        raise HTTPException(422, str(e))
    await audit(pool, project_id, user, "source.upload", "source", source_id, filename=filename, chunks=n)
    return {"source_id": str(source_id), "chunks": n, "filename": filename}


class SearchRequest(BaseModel):
    query: str = Field(min_length=2)
    source_ids: list[UUID]
    top_k: int = Field(default=8, ge=1, le=50)


@router.post("/search", dependencies=[Depends(project_with("researcher"))])
async def search(
    project_id: UUID,
    req: SearchRequest,
    pool=Depends(get_pool),
    embedder=Depends(get_embedder),
):
    """Cosine top-K over the chosen sources. Sources outside this project are
    silently ignored, so one project can never read another's documents."""
    allowed = await pool.fetch(
        "SELECT id FROM sources WHERE project_id=$1 AND id = ANY($2::uuid[])",
        project_id, req.source_ids,
    )
    q = await asyncio.to_thread(embedder.embed_query, req.query)
    hits = await store.search_chunks(pool, q, [r["id"] for r in allowed], req.top_k)
    return {
        "hits": [{**asdict(h), "intact": h.intact()} for h in hits],
    }


CACHE_TTL_DAYS = 14

PURGE_STALE_CACHE = """
WITH stale AS (
  SELECT s.id FROM sources s
  WHERE s.project_id=$1 AND NOT s.in_library AND s.created_at < now() - make_interval(days => $2)
    AND NOT EXISTS (SELECT 1 FROM chunks c JOIN citations ci ON ci.chunk_id=c.id WHERE c.source_id=s.id)
    AND NOT EXISTS (SELECT 1 FROM chunks c JOIN concept_evidence e ON e.chunk_id=c.id WHERE c.source_id=s.id)
    AND NOT EXISTS (SELECT 1 FROM chunks c JOIN lens_items l ON l.chunk_id=c.id WHERE c.source_id=s.id)
    AND NOT EXISTS (SELECT 1 FROM chunks c JOIN signal_evidence e ON e.chunk_id=c.id WHERE c.source_id=s.id)
    AND NOT EXISTS (SELECT 1 FROM task_sources ts WHERE ts.source_id=s.id)
), gone AS (DELETE FROM chunks WHERE source_id IN (SELECT id FROM stale))
DELETE FROM sources WHERE id IN (SELECT id FROM stale)
"""


async def purge_stale_cache(pool, project_id: UUID) -> str:
    """Drop cached online papers that were never cited, saved or used by a task and are older than CACHE_TTL_DAYS."""
    return await pool.execute(PURGE_STALE_CACHE, project_id, CACHE_TTL_DAYS)


@router.post("/sources/{source_id}/save-to-library", dependencies=[Depends(project_with("researcher"))])
async def save_to_library(project_id: UUID, source_id: UUID, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    """Keep a paper that was found online: it moves from the research cache into the Knowledge Library."""
    row = await pool.fetchrow(
        "UPDATE sources SET in_library=TRUE WHERE id=$1 AND project_id=$2 RETURNING id, title", source_id, project_id)
    if not row:
        raise HTTPException(404, "source not found")
    await audit(pool, project_id, user, "source.save", "source", source_id, title=(row["title"] or "")[:120])
    return {"source_id": str(source_id), "in_library": True}


class DiscoverIngestRequest(BaseModel):
    question: str = Field(min_length=3)
    required_terms: list[str] = []
    exclude_terms: list[str] = []
    from_year: int | None = None
    top_n: int = Field(default=20, ge=1, le=100)
    candidate_pool: int = Field(default=120, ge=10, le=300)
    # False (default): skip the (slow) paper search when the project's discovered papers already answer
    # the question well. True: always search for more papers ("find more papers").
    force: bool = False


@router.post("/discover-and-ingest", dependencies=[Depends(project_with("researcher"))])
async def discover_and_ingest(
    project_id: UUID,
    req: DiscoverIngestRequest,
    user: UUID = Depends(require_user),
    pool=Depends(get_pool),
    s3=Depends(get_s3),
    embedder=Depends(get_embedder),
    tokenizer=Depends(get_tokenizer),
):
    """Mode A: find papers (OpenAlex -> Unpaywall -> Europe PMC), then chunk and embed them into the project's
    research cache (hidden from the Knowledge Library) so answers can be verified and cited with a link."""
    s = get_settings()
    await purge_stale_cache(pool, project_id)
    if not req.force:
        # Already covered? Reuse what is indexed instead of re-searching and re-embedding on every question.
        known = await pool.fetch(
            "SELECT id FROM sources WHERE project_id=$1 AND origin <> 'user_upload'", project_id)
        if len(known) >= MIN_SOURCES_TO_SKIP:
            q = await asyncio.to_thread(embedder.embed_query, req.question)
            hits = await store.search_chunks(pool, q, [r["id"] for r in known], 3)
            top = max((h.similarity for h in hits), default=0.0)
            if top >= s.similarity_threshold:
                return {"sources": [], "skipped": True, "reason": "already_covered",
                        "top_similarity": top, "existing_sources": len(known),
                        "discovery": {}, "dropped": [], "errors": []}
    found = await discover(
        DiscoveryQuery(req.question, req.required_terms, req.exclude_terms, req.from_year),
        contact_email=s.contact_email, top_n=req.top_n, candidate_pool=req.candidate_pool,
    )
    async with make_client(s.contact_email) as client:
        results = await build_session_sources(
            pool, project_id, found.papers, make_ingest_config(embedder, tokenizer),
            client=client, max_pdf_bytes=s.max_pdf_mb * 1024 * 1024,
            store_pdf=lambda key, data: s3.put_object(Bucket=s.s3_bucket, Key=key, Body=data),
        )
    await audit(pool, project_id, user, "source.discover", "project", project_id, question=req.question[:200], found=len(results))
    return {
        "sources": [{**asdict(r), "source_id": str(r.source_id)} for r in results],
        "discovery": found.stats,
        "dropped": [{"title": p.title, "doi": p.doi, "reason": r} for p, r in found.dropped],
        "errors": found.errors,
    }
