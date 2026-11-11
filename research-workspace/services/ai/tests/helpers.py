import asyncio
from pathlib import Path

import asyncpg
import pymupdf
from pgvector.asyncpg import register_vector

MIGRATIONS = Path(__file__).resolve().parents[3] / "db" / "migrations"


def make_pdf(pages: list[list[str]], *, user_pw: str | None = None) -> bytes:
    """Build a PDF with one text line per list entry. Keep lines short (<80 chars)."""
    doc = pymupdf.open()
    for lines in pages:
        page = doc.new_page()
        y = 72
        for ln in lines:
            page.insert_text((72, y), ln, fontsize=11)
            y += 16
    kwargs = {}
    if user_pw:
        kwargs = dict(encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw=user_pw, owner_pw="owner")
    data = doc.tobytes(**kwargs)
    doc.close()
    return data


async def _init(conn):
    await register_vector(conn)


async def make_pool(url: str) -> asyncpg.Pool:
    return await asyncpg.create_pool(url, min_size=1, max_size=5, init=_init)


def reset_schema(url: str) -> None:
    """Fresh public schema with all migrations applied."""

    async def go():
        conn = await asyncpg.connect(url)
        try:
            await conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
            for f in sorted(MIGRATIONS.glob("*.sql")):
                await conn.execute(f.read_text())
        finally:
            await conn.close()

    asyncio.run(go())


def run_db(url: str, fn):
    """Run `async fn(pool)` on a fresh pool with empty tables."""

    async def go():
        pool = await make_pool(url)
        try:
            await pool.execute("TRUNCATE projects CASCADE")
            return await fn(pool)
        finally:
            await pool.close()

    return asyncio.run(go())
