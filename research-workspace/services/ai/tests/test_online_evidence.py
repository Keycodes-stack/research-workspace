"""/ask online evidence: abstracts are ranked in memory; nothing is stored until cited."""
import asyncio

import numpy as np

from app import online_evidence
from app.ingest.chunking import sha256_hex
from app.ingest.embeddings import HashEmbedder
from app.ingest.tokenizer import RegexTokenizer
from app.retrieval.models import DiscoveryResult, Paper


def test_online_passages_rank_abstracts_and_skip_known_papers(monkeypatch):
    papers = [Paper(title="Cold chain", doi="10.1/a", abstract="mRNA vaccine degrades at room temperature storage"),
              Paper(title="Known", doi="10.1/known", abstract="mRNA vaccine degrades at room temperature storage"),
              Paper(title="Off topic", doi="10.1/b", abstract="solar cell perovskite moisture")]

    async def fake_search(question, **kw):
        assert kw["with_abstracts"] is True
        return DiscoveryResult(papers=papers, dropped=[], stats={"found": 3}, errors=[])

    monkeypatch.setattr(online_evidence, "search_papers", fake_search)
    emb = HashEmbedder()
    q = emb.embed_query("mRNA vaccine room temperature storage")
    out, stats = asyncio.run(online_evidence.online_passages(
        "mRNA vaccine storage", q, emb, RegexTokenizer(), exclude_dois={"10.1/known"}))

    assert [op.paper.title for op in sorted(out, key=lambda o: -o.hit.similarity)] == ["Cold chain", "Off topic"]
    assert stats["embedded"] == 2
    for op in out:
        assert op.hit.intact() and op.hit.sha256 == sha256_hex(op.hit.text)      # sealed like stored chunks
        assert np.isclose(op.hit.similarity, float(op.embedding @ q))
        assert op.label.endswith(f"doi:{op.paper.doi}")


def test_diversify_caps_passages_per_paper():
    from types import SimpleNamespace as H
    from app.routes_tasks import diversify
    hits = [H(source_id="big", similarity=0.9 - i / 100) for i in range(6)] + [H(source_id="b", similarity=0.5),
                                                                              H(source_id="c", similarity=0.4)]
    out = diversify(hits, top_k=5)
    assert [h.source_id for h in out] == ["big", "big", "b", "c"]


def test_followup_reuses_cached_vectors(monkeypatch):
    online_evidence._vectors.clear()
    papers = [Paper(title=f"P{i}", doi=f"10.2/{i}", abstract=f"mRNA vaccine storage study number {i}") for i in range(3)]

    async def fake_search(question, **kw):
        return DiscoveryResult(papers=papers, dropped=[], stats={"found": 3}, errors=[])

    monkeypatch.setattr(online_evidence, "search_papers", fake_search)
    emb = HashEmbedder()
    calls = []
    real = emb.embed_documents
    monkeypatch.setattr(emb, "embed_documents", lambda texts: calls.append(len(texts)) or real(texts))
    q = emb.embed_query("mRNA vaccine storage")
    run = lambda: asyncio.run(online_evidence.online_passages("q", q, emb, RegexTokenizer(), exclude_dois=set()))
    first, s1 = run()
    second, s2 = run()
    assert calls == [3] and s1["newly_embedded"] == 3 and s2["newly_embedded"] == 0
    assert [round(o.hit.similarity, 6) for o in first] == [round(o.hit.similarity, 6) for o in second]
    online_evidence._vectors.clear()


def test_vague_questions_borrow_the_topic():
    from app.retrieval.pipeline import search_query
    from app.routes_tasks import topic_context
    assert topic_context("how to cure this syndrome?", "down syndrome", None) == "down syndrome"
    assert search_query("down syndrome how to cure this syndrome?") == "down syndrome cure"
    assert topic_context("Is it inherited?", "Down syndrome", None) == "Down syndrome"
    # a generic project name says nothing: use the chat's previous question instead
    assert topic_context("and the side effects?", "New Project", "What is Down syndrome?") == "What is Down syndrome?"
    # self-contained questions are left alone
    assert topic_context("What are the key findings on mRNA vaccine stability?", "down syndrome", None) == ""
    assert topic_context("Does heat break DNA strands?", "DNA and RNA", None) == ""
