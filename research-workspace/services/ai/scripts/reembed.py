"""Recompute every chunk embedding with the configured embedder.

Run after changing EMBEDDER/EMBEDDING_MODEL (e.g. chunks ingested while the service
silently used the hash embedder). Only `chunks.embedding` changes: text, sha256 and
ids stay the same, so existing citations remain valid.

    cd services/ai && python -m scripts.reembed
"""
import asyncio

from app.clients import close_all, get_pool
from app.deps import _load_embedder

BATCH = 64


async def main() -> None:
    embedder = _load_embedder()
    pool = await get_pool()
    ids = [r["id"] for r in await pool.fetch("SELECT id FROM chunks ORDER BY source_id, chunk_index")]
    print(f"re-embedding {len(ids)} chunks with {type(embedder).__name__}")
    for i in range(0, len(ids), BATCH):
        rows = await pool.fetch("SELECT id, text FROM chunks WHERE id = ANY($1::uuid[])", ids[i:i + BATCH])
        vecs = await asyncio.to_thread(embedder.embed_documents, [r["text"] for r in rows])
        await pool.executemany("UPDATE chunks SET embedding = $2 WHERE id = $1",
                               [(r["id"], v) for r, v in zip(rows, vecs)])
        print(f"  {min(i + BATCH, len(ids))}/{len(ids)}")
    await close_all()


if __name__ == "__main__":
    asyncio.run(main())
