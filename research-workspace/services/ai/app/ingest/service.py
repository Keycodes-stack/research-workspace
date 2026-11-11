"""Ingestion: PDF/abstract -> chunks -> embeddings -> Postgres (one transaction)."""
import asyncio
import hashlib
from collections.abc import Callable
from dataclasses import dataclass
from uuid import UUID

import asyncpg
import httpx

from ..retrieval.models import Paper
from . import store
from .chunking import chunk_lines
from .download import PdfDownloadError, download_pdf
from .embeddings import Embedder
from .extraction import Line, NoExtractableText, PdfError, clean, extract_lines
from .tokenizer import Tokenizer


@dataclass
class IngestConfig:
    embedder: Embedder
    tokenizer: Tokenizer
    chunk_tokens: int = 512
    chunk_overlap: int = 64
    expected_dim: int = 768


async def _persist(
    pool: asyncpg.Pool, source_id: UUID, lines: list[Line], cfg: IngestConfig,
    *, fulltext: str, file_sha256: str | None = None, page_count: int | None = None,
) -> int:
    chunks = chunk_lines(lines, cfg.tokenizer, size=cfg.chunk_tokens, overlap=cfg.chunk_overlap)
    if not chunks:
        raise NoExtractableText("document produced no chunks")
    embeddings = await asyncio.to_thread(cfg.embedder.embed_documents, [c.text for c in chunks])
    if embeddings.shape != (len(chunks), cfg.expected_dim):
        raise ValueError(
            f"embedder returned {embeddings.shape}, expected ({len(chunks)}, {cfg.expected_dim}); "
            "the chunks.embedding column is vector(768)"
        )
    async with pool.acquire() as conn:
        async with conn.transaction():
            await store.insert_chunks(conn, source_id, chunks, embeddings)
            await conn.execute(
                "UPDATE sources SET fulltext=$2, file_sha256=$3, page_count=$4 WHERE id=$1",
                source_id, fulltext, file_sha256, page_count,
            )
    return len(chunks)


async def ingest_pdf(pool: asyncpg.Pool, source_id: UUID, pdf_bytes: bytes, cfg: IngestConfig) -> int:
    """Extract, chunk, embed and store a PDF. Returns the chunk count.
    Marks the source 'failed' if the PDF is unreadable or has no text layer."""
    try:
        lines, page_count = await asyncio.to_thread(extract_lines, pdf_bytes)
        return await _persist(
            pool, source_id, lines, cfg, fulltext="full_text",
            file_sha256=hashlib.sha256(pdf_bytes).hexdigest(), page_count=page_count,
        )
    except PdfError:
        await pool.execute("UPDATE sources SET fulltext='failed' WHERE id=$1", source_id)
        raise


async def ingest_abstract(pool: asyncpg.Pool, source_id: UUID, abstract: str, cfg: IngestConfig) -> int:
    """Fallback when no full text exists: ground answers in the verified abstract."""
    return await _persist(
        pool, source_id, [Line(text=clean(abstract))], cfg, fulltext="abstract_only"
    )


# ---- Mode A: turn discovered papers into the session's source of truth -----

@dataclass
class SourceResult:
    source_id: UUID
    doi: str | None
    title: str
    fulltext: str          # full_text | abstract_only | failed
    chunks: int
    note: str = ""


INSERT_SOURCE = """
INSERT INTO sources (project_id, origin, doi, title, authors, venue, year,
                     cited_by_count, abstract, source_url, pdf_url, fulltext)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')
ON CONFLICT (project_id, doi) DO NOTHING
RETURNING id
"""


async def build_session_sources(
    pool: asyncpg.Pool,
    project_id: UUID,
    papers: list[Paper],
    cfg: IngestConfig,
    *,
    client: httpx.AsyncClient,
    max_pdf_bytes: int = 50 * 1024 * 1024,
    store_pdf: Callable[[str, bytes], None] | None = None,
    on_event: Callable[[str, dict], None] | None = None,
    concurrency: int = 3,
) -> list[SourceResult]:
    """Persist discovered papers as sources and ingest them. Tries the PDF first;
    on any download/parse failure falls back to the abstract."""
    emit = on_event or (lambda s, d: None)
    sem = asyncio.Semaphore(concurrency)

    async def one(p: Paper) -> SourceResult:
        async with sem:
            sid = await pool.fetchval(
                INSERT_SOURCE, project_id, p.origin, p.doi, p.title, p.authors, p.venue,
                p.year, p.cited_by_count, p.abstract, p.source_url, p.pdf_url,
            )
            if sid is None:  # same DOI already in this project: reuse it
                row = await pool.fetchrow(
                    """SELECT s.id, s.fulltext::text AS fulltext,
                              (SELECT count(*) FROM chunks c WHERE c.source_id = s.id) AS n
                       FROM sources s WHERE project_id=$1 AND doi=$2""",
                    project_id, p.doi,
                )
                return SourceResult(row["id"], p.doi, p.title, row["fulltext"], row["n"], "reused")

            note = ""
            if p.pdf_url:
                try:
                    data = await download_pdf(client, p.pdf_url, max_pdf_bytes)
                    if store_pdf:
                        key = f"projects/{project_id}/sources/{sid}.pdf"
                        await asyncio.to_thread(store_pdf, key, data)
                        await pool.execute("UPDATE sources SET storage_key=$2 WHERE id=$1", sid, key)
                    n = await ingest_pdf(pool, sid, data, cfg)
                    emit("ingested", {"doi": p.doi, "fulltext": "full_text", "chunks": n})
                    return SourceResult(sid, p.doi, p.title, "full_text", n)
                except (PdfDownloadError, PdfError, httpx.HTTPError) as e:
                    note = f"pdf failed ({e.__class__.__name__}: {e}); "

            if p.abstract:
                n = await ingest_abstract(pool, sid, p.abstract, cfg)
                emit("ingested", {"doi": p.doi, "fulltext": "abstract_only", "chunks": n})
                return SourceResult(sid, p.doi, p.title, "abstract_only", n, note + "abstract fallback")

            await pool.execute("UPDATE sources SET fulltext='failed' WHERE id=$1", sid)
            return SourceResult(sid, p.doi, p.title, "failed", 0, note + "no text available")

    return list(await asyncio.gather(*(one(p) for p in papers)))
