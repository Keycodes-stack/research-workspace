"""Online evidence for /ask: search the literature, rank abstracts in memory, store only what an answer cites.

Nothing found online touches pgvector unless a model cites it. A cited paper is saved with every passage that
was shown to the models (sealed with sha256), so its citations stay verifiable and auditable later.
"""
import asyncio
import json
import time
import uuid
from dataclasses import dataclass
from uuid import UUID

import numpy as np

from .ingest.chunking import Chunk, chunk_lines
from .ingest.embeddings import Embedder
from .ingest.extraction import Line, clean
from .ingest.store import Hit
from .ingest.tokenizer import Tokenizer
from .retrieval.models import Paper
from .retrieval.pipeline import search_papers

SEARCH_LIMIT = 200      # papers fetched (one OpenAlex page + Europe PMC, ~5-12 s)
EMBED_LIMIT = 40        # best-ranked abstracts scored in memory; the models read ~10-15 passages anyway
VECTOR_TTL_S = 15 * 60  # follow-up questions reuse vectors already computed for the same abstracts
VECTOR_CACHE_MAX = 5000
_vectors: dict[str, tuple[float, np.ndarray]] = {}      # chunk sha256 -> (time computed, embedding)


async def _embed_cached(embedder: Embedder, chunks: list[Chunk]) -> tuple[np.ndarray, int]:
    """Embeddings for the chunks, computing only those not cached. Returns (embeddings, how many were new)."""
    now = time.monotonic()
    missing = [c for c in chunks if not (c.sha256 in _vectors and now - _vectors[c.sha256][0] < VECTOR_TTL_S)]
    if missing:
        new = await asyncio.to_thread(embedder.embed_documents, [c.text for c in missing])
        if len(_vectors) + len(missing) > VECTOR_CACHE_MAX:     # drop expired entries, then the oldest
            for k in [k for k, (t, _) in _vectors.items() if now - t >= VECTOR_TTL_S]:
                del _vectors[k]
            for k in sorted(_vectors, key=lambda k: _vectors[k][0])[: max(0, len(_vectors) + len(missing) - VECTOR_CACHE_MAX)]:
                del _vectors[k]
        for c, e in zip(missing, new):
            _vectors[c.sha256] = (now, e)
    return np.stack([_vectors[c.sha256][1] for c in chunks]), len(missing)


@dataclass
class OnlinePassage:
    hit: Hit
    paper: Paper
    chunk: Chunk
    embedding: np.ndarray

    @property
    def label(self) -> str:
        return self.paper.title + (f", doi:{self.paper.doi}" if self.paper.doi else "")


async def online_passages(
    question: str, query_embedding: np.ndarray, embedder: Embedder, tokenizer: Tokenizer, *,
    exclude_dois: set[str], contact_email: str = "", chunk_tokens: int = 512, chunk_overlap: int = 64,
) -> tuple[list[OnlinePassage], dict]:
    """Abstract passages of the papers best matching the question, scored against it in memory."""
    found = await search_papers(question, contact_email=contact_email, limit=SEARCH_LIMIT, with_abstracts=True)
    papers = [p for p in found.papers if not (p.doi and p.doi in exclude_dois)][:EMBED_LIMIT]
    pairs = [(p, c) for p in papers
             for c in chunk_lines([Line(text=clean(p.abstract or ""))], tokenizer, size=chunk_tokens, overlap=chunk_overlap)]
    stats = {**found.stats, "embedded": len(pairs), "papers_ranked": len(papers), "errors": found.errors}
    if not pairs:
        return [], stats
    t = time.monotonic()
    embs, stats["newly_embedded"] = await _embed_cached(embedder, [c for _, c in pairs])
    stats["embed_s"] = round(time.monotonic() - t, 1)
    sims = embs @ query_embedding                      # embeddings are normalized: dot product = cosine
    out, paper_ids = [], {}
    for (p, c), e, s in zip(pairs, embs, sims):
        # placeholder source id, one per paper (lets /ask cap passages per paper); the real id is set on save
        hit = Hit(chunk_id=uuid.uuid4(), source_id=paper_ids.setdefault(id(p), uuid.uuid4()), chunk_index=c.index, text=c.text, sha256=c.sha256,
                  page_start=None, page_end=None, line_start=None, line_end=None, similarity=float(s))
        out.append(OnlinePassage(hit, p, c, e))
    return out, stats


async def persist_cited(pool, project_id: UUID, passages: list[OnlinePassage], cited: set) -> list[UUID]:
    """Save each cited paper (research cache, not the Knowledge Library) with its passages, keeping the chunk ids
    the answer already refers to. Returns the new source ids."""
    cited = {c if isinstance(c, UUID) else UUID(str(c)) for c in cited}
    by_paper: dict[int, list[OnlinePassage]] = {}
    for op in passages:
        by_paper.setdefault(id(op.paper), []).append(op)
    saved = []
    async with pool.acquire() as conn, conn.transaction():
        for ops in by_paper.values():
            if not any(op.hit.chunk_id in cited for op in ops):
                continue
            p = ops[0].paper
            sid = await conn.fetchval(
                """INSERT INTO sources (project_id, origin, doi, title, authors, venue, year, cited_by_count,
                                        abstract, source_url, pdf_url, fulltext, in_library)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'abstract_only',FALSE)
                   ON CONFLICT (project_id, doi) DO NOTHING RETURNING id""",
                project_id, p.origin, p.doi, p.title, p.authors, p.venue, p.year, p.cited_by_count,
                p.abstract, p.source_url, p.pdf_url)
            if sid is None:   # saved meanwhile by another question: add these passages to it
                sid = await conn.fetchval("SELECT id FROM sources WHERE project_id=$1 AND doi=$2", project_id, p.doi)
            base = await conn.fetchval("SELECT COALESCE(max(chunk_index) + 1, 0) FROM chunks WHERE source_id=$1", sid)
            await conn.executemany(
                """INSERT INTO chunks (id, source_id, chunk_index, text, sha256, page_start, page_end,
                                       line_start, line_end, token_count, embedding, line_refs)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)""",
                [(op.hit.chunk_id, sid, base + op.chunk.index, op.chunk.text, op.chunk.sha256, None, None,
                  op.chunk.line_start, op.chunk.line_end, op.chunk.token_count, op.embedding,
                  json.dumps(op.chunk.line_refs)) for op in ops])
            saved.append(sid)
    return saved
