"""Postgres persistence and cosine top-K search for chunks."""
import json
from dataclasses import dataclass
from uuid import UUID

import asyncpg
import numpy as np

from .chunking import Chunk, sha256_hex

INSERT_CHUNK = """
INSERT INTO chunks (source_id, chunk_index, text, sha256, page_start, page_end,
                    line_start, line_end, token_count, embedding, line_refs)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
"""

SEARCH = """
SELECT c.id, c.source_id, c.chunk_index, c.text, c.sha256,
       c.page_start, c.page_end, c.line_start, c.line_end,
       1 - (c.embedding <=> $1) AS similarity
FROM chunks c
WHERE c.source_id = ANY($2::uuid[])
ORDER BY c.embedding <=> $1
LIMIT $3
"""


class AlreadyIngested(Exception):
    pass


@dataclass
class Hit:
    chunk_id: UUID
    source_id: UUID
    chunk_index: int
    text: str
    sha256: str
    page_start: int | None
    page_end: int | None
    line_start: int | None
    line_end: int | None
    similarity: float

    def intact(self) -> bool:
        """Recompute the hash: does the stored text still match its seal?"""
        return sha256_hex(self.text) == self.sha256


async def insert_chunks(
    conn: asyncpg.Connection, source_id: UUID, chunks: list[Chunk], embeddings: np.ndarray
) -> None:
    """Insert all chunks for a source. Call inside a transaction."""
    if await conn.fetchval("SELECT 1 FROM chunks WHERE source_id = $1 LIMIT 1", source_id):
        raise AlreadyIngested(f"source {source_id} already has chunks")
    if len(chunks) != len(embeddings):
        raise ValueError("chunks and embeddings length mismatch")
    await conn.executemany(
        INSERT_CHUNK,
        [
            (
                source_id, c.index, c.text, c.sha256, c.page_start, c.page_end,
                c.line_start, c.line_end, c.token_count, emb, json.dumps(c.line_refs),
            )
            for c, emb in zip(chunks, embeddings)
        ],
    )


async def search_chunks(
    pool: asyncpg.Pool,
    query_embedding: np.ndarray,
    source_ids: list[UUID],
    top_k: int = 8,
) -> list[Hit]:
    """Cosine top-K restricted to the given sources (the task's locked source set).

    Similarity is 1 - cosine distance, in [-1, 1]. The refuse-below-0.76 gate is
    applied by the caller (Phase 5), not here.
    """
    if not source_ids:
        return []
    async with pool.acquire() as conn:
        async with conn.transaction():
            # pgvector >= 0.8: keep scanning the HNSW index until enough rows
            # survive the source filter, instead of returning fewer than top_k.
            await conn.execute("SELECT set_config('hnsw.iterative_scan', 'strict_order', true)")
            await conn.execute("SELECT set_config('hnsw.ef_search', '100', true)")
            rows = await conn.fetch(SEARCH, query_embedding, source_ids, top_k)
    return [
        Hit(
            chunk_id=r["id"], source_id=r["source_id"], chunk_index=r["chunk_index"],
            text=r["text"], sha256=r["sha256"],
            page_start=r["page_start"], page_end=r["page_end"],
            line_start=r["line_start"], line_end=r["line_end"],
            similarity=float(r["similarity"]),
        )
        for r in rows
    ]


async def fetch_chunks(pool: asyncpg.Pool, chunk_ids: list[UUID]) -> dict[UUID, asyncpg.Record]:
    """Chunks by id, with source info. Used by citation verification and the Inspector."""
    if not chunk_ids:
        return {}
    rows = await pool.fetch(
        """SELECT c.id, c.text, c.sha256, c.page_start, c.page_end, c.line_start, c.line_end,
                  c.line_refs, s.id AS source_id, s.doi, s.title, s.filename, s.source_url
           FROM chunks c JOIN sources s ON s.id = c.source_id
           WHERE c.id = ANY($1::uuid[])""",
        chunk_ids,
    )
    return {r["id"]: r for r in rows}
