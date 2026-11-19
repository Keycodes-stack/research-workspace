"""Offline tests: every external API is mocked with httpx.MockTransport."""
import asyncio

import httpx

from app.retrieval import europepmc, openalex, unpaywall
from app.retrieval.http import get_json
from app.retrieval.models import DiscoveryQuery, Paper, normalize_doi
from app.retrieval.pipeline import discover, merge_papers
from app.retrieval.ranking import rank


def run(coro):
    return asyncio.run(coro)


def work(doi, title, year, cites, pdf=None, abstract="word " * 5):
    inv = {}
    for i, w in enumerate(abstract.split()):
        inv.setdefault(w, []).append(i)
    return {
        "doi": f"https://doi.org/{doi}",
        "title": title,
        "publication_year": year,
        "cited_by_count": cites,
        "authorships": [{"author": {"display_name": "A. Author"}}],
        "primary_location": {"source": {"display_name": "J. Test"}},
        "best_oa_location": {"pdf_url": pdf} if pdf else None,
        "abstract_inverted_index": inv or None,
    }


def make_client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


# ---- unit tests ----------------------------------------------------------

def test_normalize_doi():
    assert normalize_doi("https://doi.org/10.1000/ABC") == "10.1000/abc"
    assert normalize_doi("doi:10.1/x") == "10.1/x"
    assert normalize_doi("") is None and normalize_doi(None) is None


def test_abstract_reconstruction():
    inv = {"Stability": [0], "of": [1, 4], "mRNA": [2], "vaccines": [3, 5]}
    assert openalex.reconstruct_abstract(inv) == "Stability of mRNA vaccines of vaccines"
    assert openalex.reconstruct_abstract(None) is None


def test_ranking_prefers_authority_and_recency():
    q = DiscoveryQuery(question="x")
    old_cited = Paper(title="a", year=2005, cited_by_count=900)
    new_uncited = Paper(title="b", year=2025, cited_by_count=2)
    new_cited = Paper(title="c", year=2024, cited_by_count=600)
    ranked, _ = rank([old_cited, new_uncited, new_cited], q, now_year=2026)
    assert ranked[0].title == "c"
    assert all(p.score_breakdown for p in ranked)


def test_condition_filters():
    q = DiscoveryQuery(
        question="x", required_terms=["liquid injection"], exclude_terms=["powder"]
    )
    ok = Paper(title="Liquid injection stability", year=2024)
    powder = Paper(title="Liquid injection vs powder", year=2024)
    other = Paper(title="Tablet coating", year=2024)
    ranked, dropped = rank([ok, powder, other], q, now_year=2026)
    assert [p.title for p in ranked] == ["Liquid injection stability"]
    reasons = {p.title: r for p, r in dropped}
    assert reasons["Liquid injection vs powder"] == "excluded_condition:powder"
    assert reasons["Tablet coating"] == "condition_mismatch"


def test_merge_dedupes_and_keeps_richest():
    a = Paper(title="T", doi="10.1/x", cited_by_count=3, abstract=None)
    b = Paper(title="T", doi="10.1/x", cited_by_count=9, abstract="abs",
              pdf_url="http://p", origin="europe_pmc")
    merged = merge_papers([a], [b])
    assert len(merged) == 1
    m = merged[0]
    assert (m.cited_by_count, m.abstract, m.pdf_url, m.origin) == (9, "abs", "http://p", "europe_pmc")


def test_retry_on_429_then_success():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(429)
        return httpx.Response(200, json={"ok": True})

    async def go():
        async with make_client(handler) as c:
            return await get_json(c, "https://x.test/a", backoff=0)

    assert run(go()) == {"ok": True} and calls["n"] == 3


def test_404_returns_none():
    async def go():
        async with make_client(lambda r: httpx.Response(404)) as c:
            return await get_json(c, "https://x.test/a", backoff=0)

    assert run(go()) is None


def test_unpaywall_needs_email_and_picks_pdf():
    def handler(request):
        return httpx.Response(200, json={
            "is_oa": True,
            "best_oa_location": {"url_for_pdf": None},
            "oa_locations": [{"url_for_pdf": "https://repo.test/p.pdf"}],
        })

    async def go():
        async with make_client(handler) as c:
            return (
                await unpaywall.resolve(c, "10.1/x", ""),
                await unpaywall.resolve(c, "10.1/x", "me@example.com"),
            )

    none_url, url = run(go())
    assert none_url is None and url == "https://repo.test/p.pdf"


def test_europepmc_parse_only_free_pdf():
    r = {
        "title": "Preprint.", "doi": "10.1101/abc", "pubYear": "2025",
        "authorString": "Smith J, Doe A.", "citedByCount": 4,
        "fullTextUrlList": {"fullTextUrl": [
            {"documentStyle": "html", "availability": "Free", "url": "http://h"},
            {"documentStyle": "pdf", "availability": "Subscription", "url": "http://paid"},
            {"documentStyle": "pdf", "availability": "Open access", "url": "http://free.pdf"},
        ]},
    }
    p = europepmc.parse_result(r)
    assert p.pdf_url == "http://free.pdf"
    assert p.authors == ["Smith J", "Doe A"] and p.year == 2025 and p.title == "Preprint"


# ---- pipeline: all three tiers + fallback --------------------------------

def pipeline_handler(request: httpx.Request) -> httpx.Response:
    host, path = request.url.host, request.url.path
    qs = dict(request.url.params)

    if host == "api.openalex.org":
        return httpx.Response(200, json={"results": [
            work("10.1/oa", "A open access", 2024, 300, pdf="https://oa.test/a.pdf"),
            work("10.1/unp", "B paywalled unpaywall", 2023, 200),
            work("10.1/epmc", "C paywalled europepmc", 2022, 150),
            work("10.1/abs", "D abstract only", 2021, 100),
            work("10.1/none", "E no text at all", 2020, 90, abstract=""),
        ]})

    if host == "api.unpaywall.org":
        if path.endswith("10.1/unp"):
            return httpx.Response(200, json={
                "is_oa": True, "best_oa_location": {"url_for_pdf": "https://repo.test/b.pdf"}})
        return httpx.Response(200, json={"is_oa": False})

    if host == "www.ebi.ac.uk":
        query = qs["query"]
        if "SRC:PPR" in query:
            return httpx.Response(200, json={"resultList": {"result": []}})
        if '"10.1/epmc"' in query:
            return httpx.Response(200, json={"resultList": {"result": [{
                "title": "C", "doi": "10.1/epmc", "fullTextUrlList": {"fullTextUrl": [
                    {"documentStyle": "pdf", "availability": "Free", "url": "https://epmc.test/c.pdf"}]}}]}})
        return httpx.Response(200, json={"resultList": {"result": []}})

    return httpx.Response(500)


def test_three_tier_pipeline_and_fallbacks():
    events = []

    async def go():
        async with make_client(pipeline_handler) as c:
            return await discover(
                DiscoveryQuery(question="mRNA stability"),
                contact_email="team@example.com", top_n=8, client=c,
                on_event=lambda s, d: events.append(s),
            )

    res = run(go())
    by_doi = {p.doi: p for p in res.papers}

    assert by_doi["10.1/oa"].origin == "openalex" and by_doi["10.1/oa"].fulltext == "full_text"
    assert by_doi["10.1/unp"].origin == "unpaywall" and by_doi["10.1/unp"].pdf_url.endswith("b.pdf")
    assert by_doi["10.1/epmc"].origin == "europe_pmc" and by_doi["10.1/epmc"].pdf_url.endswith("c.pdf")
    assert by_doi["10.1/abs"].fulltext == "abstract_only"
    assert "10.1/none" not in by_doi
    assert any(r == "no_text_available" for _, r in res.dropped)

    assert res.stats["full_text"] == 3 and res.stats["abstract_only"] == 1
    assert res.stats["by_origin"] == {"openalex": 1, "unpaywall": 1, "europe_pmc": 1}
    assert res.errors == []
    assert events[0] == "searching" and events[-1] == "done"


def test_no_email_skips_unpaywall_but_still_uses_europepmc():
    async def go():
        async with make_client(pipeline_handler) as c:
            return await discover(DiscoveryQuery(question="x"), contact_email="", client=c)

    by_doi = {p.doi: p for p in run(go()).papers}
    assert by_doi["10.1/unp"].fulltext == "abstract_only"       # unpaywall skipped
    assert by_doi["10.1/epmc"].origin == "europe_pmc"


def test_one_tier_failing_does_not_kill_discovery():
    def handler(request):
        if request.url.host == "www.ebi.ac.uk":
            return httpx.Response(500)
        return pipeline_handler(request)

    async def go():
        async with make_client(handler) as c:
            return await discover(
                DiscoveryQuery(question="x"), contact_email="t@example.com", client=c)

    res = run(go())
    assert res.papers                                   # OpenAlex still delivered
    assert any(e.startswith("europe_pmc") for e in res.errors)


# ---- search query from a chat request ------------------------------------

from app.retrieval.pipeline import search_query


def test_search_query_strips_request_wording():
    q = ("Find as many research papers as possible on mRNA vaccine stability, including thermal degradation, "
         "storage conditions, LNP instability, and RNA integrity. Return the maximum number of unique papers "
         "with titles, publication years, and source links.")
    assert search_query(q) == ("mRNA vaccine stability thermal degradation storage conditions "
                               "LNP instability RNA integrity")


def test_search_query_keeps_plain_topics_and_never_returns_empty():
    assert search_query("How does high temperature affect DNA stability?") == "high temperature affect DNA stability"
    assert search_query("find papers") == "find papers"


def test_discover_sends_keywords_and_searches_all_of_europepmc():
    seen = {}

    def handler(request):
        if request.url.host == "api.openalex.org":
            seen["openalex"] = request.url.params["search"]
        if request.url.host == "www.ebi.ac.uk" and "DOI:" not in request.url.params["query"]:
            seen["europepmc"] = request.url.params["query"]
        return pipeline_handler(request)

    async def go():
        async with make_client(handler) as c:
            await discover(DiscoveryQuery(question="Find papers on mRNA vaccine stability"),
                           contact_email="t@example.com", client=c)

    run(go())
    assert seen["openalex"] == "mRNA vaccine stability"
    assert seen["europepmc"] == "mRNA vaccine stability"      # journals + preprints, not SRC:PPR only


# ---- fast paper search (lists, and online passages for /ask) -------------

from app.retrieval.pipeline import search_papers


def _oa_page(n, start, pdf_every=0):
    return {"results": [work(f"10.9/{start + i}", f"Paper {start + i}", 2024, 10,
                             pdf=(f"https://oa.test/{start + i}.pdf" if pdf_every and i % pdf_every == 0 else None))
                        for i in range(n)]}


def test_search_papers_pages_openalex_and_keeps_relevance_order():
    pages = []

    def handler(request):
        if request.url.host == "api.openalex.org":
            p = int(request.url.params["page"])
            pages.append(p)
            assert request.url.params["per-page"] == "200"
            return httpx.Response(200, json=_oa_page(200 if p == 1 else 50, (p - 1) * 200, pdf_every=2))
        return httpx.Response(200, json={"resultList": {"result": []}})

    async def go():
        async with make_client(handler) as c:
            return await search_papers("Find papers on mRNA vaccine stability", limit=400, client=c)

    res = run(go())
    assert sorted(pages) == [1, 2]
    assert len(res.papers) == 250 and res.papers[0].title == "Paper 0"       # most relevant first
    assert res.stats["found"] == 250 and res.stats["with_pdf"] == 125
    assert res.stats["query"] == "mRNA vaccine stability"


def test_search_papers_does_not_wait_for_a_slow_europepmc():
    def handler(request):
        if request.url.host == "www.ebi.ac.uk":
            raise httpx.ReadTimeout("slow")
        return httpx.Response(200, json=_oa_page(3, 0))

    async def go():
        async with make_client(handler) as c:
            return await search_papers("mRNA", limit=50, client=c)

    res = run(go())
    assert len(res.papers) == 3 and any(e.startswith("europe_pmc") for e in res.errors)


def test_long_rate_limit_fails_fast_instead_of_waiting():
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(429, headers={"Retry-After": "32"})

    async def go():
        async with make_client(handler) as c:
            return await search_papers("mRNA", limit=50, client=c)

    import time
    t = time.time()
    res = run(go())
    assert time.time() - t < 3 and len(calls) == 2          # one OpenAlex call + one Europe PMC call, no retries
    assert any(e.startswith("openalex") for e in res.errors)


def test_search_cache_serves_the_followup_without_calling_apis(monkeypatch):
    from app.retrieval import pipeline
    pipeline._cache.clear()
    calls = []

    def handler(request):
        calls.append(request.url.host)
        return httpx.Response(200, json=_oa_page(3, 0)) if request.url.host == "api.openalex.org" \
            else httpx.Response(200, json={"resultList": {"result": []}})

    monkeypatch.setattr(pipeline, "make_client", lambda email="": make_client(handler))
    first = run(search_papers("mRNA vaccine stability", limit=50))
    n = len(calls)
    again = run(search_papers("Find papers on mRNA vaccine stability", limit=50, with_abstracts=True))
    assert len(calls) == n and again.stats["cached"] and len(again.papers) == len(first.papers) == 3
    pipeline._cache.clear()
