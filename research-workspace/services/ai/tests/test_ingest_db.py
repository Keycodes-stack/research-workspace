"""Integration tests against real Postgres + pgvector (needs TEST_DATABASE_URL)."""
import asyncpg
import httpx
import pytest

from app.ingest import store
from app.ingest.embeddings import HashEmbedder
from app.ingest.extraction import NoExtractableText
from app.ingest.service import (
    IngestConfig, build_session_sources, ingest_abstract, ingest_pdf,
)
from app.ingest.tokenizer import RegexTokenizer
from app.retrieval.models import Paper
from tests.helpers import make_pdf, run_db

EMB = HashEmbedder()
CFG = IngestConfig(embedder=EMB, tokenizer=RegexTokenizer(), chunk_tokens=25, chunk_overlap=5)

LIQUID = make_pdf([
    ["Stability of liquid injection formulations", "Liquid injection samples were stored at 4 C",
     "Degradation of the liquid injection was below two percent", "after twelve weeks of refrigerated storage"],
    ["Stabilizer addition permitted storage at 25 C", "for the liquid injection with a citrate stabilizer"],
])
TABLET = make_pdf([
    ["Polymer coating of oral tablets", "Coating thickness was controlled by spray rate",
     "Tablet hardness and dissolution were measured"],
])


async def new_project(pool, mode="closed_repository"):
    return await pool.fetchval(
        "INSERT INTO projects (owner_id, name, mode) VALUES (gen_random_uuid(), 'p', $1) RETURNING id", mode)


async def new_source(pool, pid, title="doc", origin="user_upload", doi=None):
    return await pool.fetchval(
        "INSERT INTO sources (project_id, origin, title, doi) VALUES ($1, $2, $3, $4) RETURNING id",
        pid, origin, title, doi)


def test_chunk_immutability_and_constraints(db_url):
    async def go(pool):
        pid = await new_project(pool)
        sid = await new_source(pool, pid)
        await ingest_abstract(pool, sid, "Some abstract text about stability.", CFG)
        cid = await pool.fetchval("SELECT id FROM chunks WHERE source_id=$1", sid)

        with pytest.raises(asyncpg.RaiseError, match="immutable"):
            await pool.execute("UPDATE chunks SET text='tampered' WHERE id=$1", cid)
        with pytest.raises(asyncpg.RaiseError, match="immutable"):
            await pool.execute("UPDATE chunks SET sha256=repeat('a',64) WHERE id=$1", cid)
        # non-content columns may still change (e.g. re-embedding)
        await pool.execute("UPDATE chunks SET token_count=99 WHERE id=$1", cid)
        with pytest.raises(asyncpg.CheckViolationError):
            await pool.execute(
                "INSERT INTO chunks (source_id, chunk_index, text, sha256) VALUES ($1, 5, 't', 'XYZ')", sid)

    run_db(db_url, go)


def test_ingest_pdf_then_cosine_search(db_url):
    async def go(pool):
        pid = await new_project(pool)
        s1, s2 = await new_source(pool, pid, "liquid"), await new_source(pool, pid, "tablet")
        n1 = await ingest_pdf(pool, s1, LIQUID, CFG)
        n2 = await ingest_pdf(pool, s2, TABLET, CFG)
        assert n1 >= 2 and n2 >= 1

        row = await pool.fetchrow("SELECT fulltext::text f, page_count, file_sha256 FROM sources WHERE id=$1", s1)
        assert (row["f"], row["page_count"], len(row["file_sha256"])) == ("full_text", 2, 64)

        q = EMB.embed_query("stability of liquid injection at 4 C")
        hits = await store.search_chunks(pool, q, [s1, s2], top_k=5)
        assert hits[0].source_id == s1 and "liquid injection" in hits[0].text.lower()
        assert hits[0].similarity > hits[-1].similarity
        assert all(h.intact() for h in hits)
        assert hits[0].page_start in (1, 2) and hits[0].line_start >= 1

        # a task's locked source set is respected
        only2 = await store.search_chunks(pool, q, [s2], top_k=5)
        assert {h.source_id for h in only2} == {s2}
        assert await store.search_chunks(pool, q, [], top_k=5) == []

        fetched = await store.fetch_chunks(pool, [hits[0].chunk_id])
        rec = fetched[hits[0].chunk_id]
        assert rec["title"] == "liquid" and rec["line_refs"]

    run_db(db_url, go)


def test_search_returns_full_top_k_despite_source_filter(db_url):
    """Regression guard for HNSW + WHERE filtering returning too few rows."""
    async def go(pool):
        pid = await new_project(pool)
        noise = await new_source(pool, pid, "noise")
        wanted = await new_source(pool, pid, "wanted")
        await ingest_abstract(pool, noise, " ".join(f"alpha{i}" for i in range(400)), IngestConfig(
            EMB, RegexTokenizer(), chunk_tokens=8, chunk_overlap=0))
        await ingest_abstract(pool, wanted, " ".join(f"beta{i}" for i in range(80)), IngestConfig(
            EMB, RegexTokenizer(), chunk_tokens=8, chunk_overlap=0))
        hits = await store.search_chunks(pool, EMB.embed_query("alpha1 alpha2"), [wanted], top_k=10)
        assert len(hits) == 10 and {h.source_id for h in hits} == {wanted}

    run_db(db_url, go)


def test_double_ingest_scanned_pdf_and_abstract(db_url):
    async def go(pool):
        pid = await new_project(pool)
        sid = await new_source(pool, pid)
        await ingest_pdf(pool, sid, TABLET, CFG)
        with pytest.raises(store.AlreadyIngested):
            await ingest_pdf(pool, sid, TABLET, CFG)

        scanned = await new_source(pool, pid, "scan")
        with pytest.raises(NoExtractableText):
            await ingest_pdf(pool, scanned, make_pdf([[]]), CFG)
        assert await pool.fetchval("SELECT fulltext::text FROM sources WHERE id=$1", scanned) == "failed"

        ab = await new_source(pool, pid, "abs")
        await ingest_abstract(pool, ab, "A short abstract.", CFG)
        row = await pool.fetchrow("SELECT page_start, line_start FROM chunks WHERE source_id=$1", ab)
        assert row["page_start"] is None and row["line_start"] is None
        assert await pool.fetchval("SELECT fulltext::text FROM sources WHERE id=$1", ab) == "abstract_only"

    run_db(db_url, go)


def test_build_session_sources_with_fallbacks(db_url):
    def handler(request: httpx.Request):
        if request.url.path == "/good.pdf":
            return httpx.Response(200, content=LIQUID)
        if request.url.path == "/paywall.pdf":
            return httpx.Response(200, content=b"<html>login</html>")
        return httpx.Response(404)

    papers = [
        Paper(title="Good", doi="10.1/good", abstract="good abs", pdf_url="https://x.test/good.pdf", origin="unpaywall"),
        Paper(title="Paywalled", doi="10.1/pay", abstract="Paywalled abstract text.", pdf_url="https://x.test/paywall.pdf"),
        Paper(title="AbsOnly", doi="10.1/abs", abstract="Only an abstract exists."),
        Paper(title="Nothing", doi="10.1/none"),
    ]
    stored: dict[str, bytes] = {}

    async def go(pool):
        pid = await new_project(pool, "open_discovery")
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            res = await build_session_sources(
                pool, pid, papers, CFG, client=client, store_pdf=stored.__setitem__)
            by = {r.doi: r for r in res}
            assert by["10.1/good"].fulltext == "full_text" and by["10.1/good"].chunks >= 2
            assert by["10.1/pay"].fulltext == "abstract_only" and "pdf failed" in by["10.1/pay"].note
            assert by["10.1/abs"].fulltext == "abstract_only"
            assert by["10.1/none"].fulltext == "failed" and by["10.1/none"].chunks == 0
            assert len(stored) == 1 and next(iter(stored)).endswith(".pdf")

            # re-running the same papers reuses rows instead of duplicating chunks
            again = await build_session_sources(pool, pid, papers, CFG, client=client)
            assert {r.note for r in again} == {"reused"}
            assert await pool.fetchval("SELECT count(*) FROM sources WHERE project_id=$1", pid) == 4

        origin = await pool.fetchval("SELECT origin::text FROM sources WHERE doi='10.1/good'")
        assert origin == "unpaywall"

    run_db(db_url, go)
