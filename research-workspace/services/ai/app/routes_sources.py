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


class DiscoverIngestRequest(BaseModel):
    question: str = Field(min_length=3)
    required_terms: list[str] = []
    exclude_terms: list[str] = []
    from_year: int | None = None
    top_n: int = Field(default=8, ge=1, le=25)


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
    """Mode A: find papers (OpenAlex -> Unpaywall -> Europe PMC), then chunk,
    embed and store them as this project's source of truth."""
    s = get_settings()
    found = await discover(
        DiscoveryQuery(req.question, req.required_terms, req.exclude_terms, req.from_year),
        contact_email=s.contact_email, top_n=req.top_n,
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
