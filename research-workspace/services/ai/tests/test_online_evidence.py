"""/ask online evidence: abstracts are ranked in memory; nothing is stored until cited."""
import asyncio

import numpy as np

from app.ingest.chunking import sha256_hex
from app.ingest.embeddings import HashEmbedder
from app.ingest.tokenizer import RegexTokenizer
from app.retrieval.models import DiscoveryResult, Paper


def test_diversify_caps_passages_per_paper():
    from types import SimpleNamespace as H
    from app.routes_tasks import diversify
    hits = [H(source_id="big", similarity=0.9 - i / 100) for i in range(6)] + [H(source_id="b", similarity=0.5),
                                                                              H(source_id="c", similarity=0.4)]
    out = diversify(hits, top_k=5)
    assert [h.source_id for h in out] == ["big", "big", "b", "c"]


def test_vague_questions_borrow_the_topic():
    from app.retrieval.pipeline import search_query
    from app.routes_tasks import topic_context
    # first question in a chat: the project name is the topic
    assert topic_context("how to cure this syndrome?", "down syndrome", []) == "down syndrome"
    assert search_query("down syndrome how to cure this syndrome?") == "down syndrome cure"
    # follow-ups: what was just discussed beats the project title
    assert topic_context("Is it inherited?", "DNA and RNA", ["What is Down syndrome?"]) == "What is Down syndrome?"
    # an earlier vague follow-up is skipped in favour of the last question that names a topic
    assert topic_context("and the side effects?", "New Project", ["and why?", "How is mRNA vaccine stored?"])         == "How is mRNA vaccine stored?"
    # a generic project name and no usable history: no topic rather than a wrong one
    assert topic_context("is it safe?", "New Project", []) == ""
    # self-contained questions are left alone
    assert topic_context("What are the key findings on mRNA vaccine stability?", "down syndrome", ["x y z"]) == ""
    assert topic_context("Does heat break DNA strands?", "DNA and RNA", []) == ""



def test_refusal_says_why():
    from app.orchestration.engine import DualResult
    from app.routes_tasks import render_content
    r = DualResult("insufficient_evidence", "both_models_insufficient")
    r.model_a = {"notes": "The sources discuss management of Down syndrome but give no method to cure it."}
    r.model_b = {"notes": ""}
    text = render_content(r)
    assert "Why: The sources discuss management of Down syndrome but give no method to cure it." in text
    assert "Second model" not in text and "rephrase" in text
    assert render_content(DualResult("insufficient_evidence", "no_source_chunks")).startswith(
        "INSUFFICIENT_SOURCE_EVIDENCE: the selected sources do not contain enough information to answer.")


def test_top_10_keep_the_apis_relevance_order_and_skip_known_papers():
    from app.retrieval.models import Paper
    from app.routes_tasks import top_by_api_relevance

    def paper(i, **kw):
        return Paper(title=f"Paper {i}", doi=f"10.1/{i}", abstract="text", relevance=1 - i / 100,
                     cited_by_count=1000 * i, **kw)
    papers = [paper(i) for i in range(30)]
    papers[2].abstract = None                      # nothing to read: skipped
    picked = top_by_api_relevance(papers[::-1], known_dois={"10.1/0"}, known_titles={"paper 1"})
    # highest API relevance first, citations ignored; known and unreadable papers skipped
    assert [p.title for p in picked] == [f"Paper {i}" for i in range(3, 13)]
