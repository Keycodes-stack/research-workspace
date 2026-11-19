"""3-tier hybrid retrieval: OpenAlex -> Unpaywall -> Europe PMC -> abstract fallback."""
import asyncio
import math
import re
import time
from collections.abc import Callable

import httpx

from . import europepmc, openalex, unpaywall
from .http import make_client
from .models import DiscoveryQuery, DiscoveryResult, Paper
from .ranking import authority_score, rank, recency_score

EventCb = Callable[[str, dict], None]


# Chat wording that is not the research topic. Sent verbatim, a request like "Find as many papers as possible
# on X ... Return titles and links" matches nothing: both APIs require every word to appear in a paper.
REQUEST_WORDS = frozenset("""
a an the and or of on in for to with about by from as at into is are was were be been do does did how what which
who why when where can could should would will may might it its this that these those i me my we our you your please
find search discover compile gather collect identify list look give show return get provide
many much possible maximum number unique all any more most
research papers paper studies study articles article publications publication literature
titles title years year source sources links link including include includes related regarding
key main findings finding summarize summarise summary overview tell explain known
""".split())
_WORD = re.compile(r"[^\W_](?:[\w+\-/]*[^\W_])?")   # any script's letters/digits, not just A-Z


def search_query(question: str) -> str:
    """Reduce a chat question to its topic keywords for the paper APIs (falls back to the question itself)."""
    seen: set[str] = set()
    words = []
    for w in _WORD.findall(question):
        k = w.lower()
        if k not in REQUEST_WORDS and k not in seen:
            seen.add(k)
            words.append(w)
    return " ".join(words) or question.strip()


def _key(p: Paper) -> str:
    return p.doi or re.sub(r"[^a-z0-9]+", " ", p.title.lower()).strip()


def merge_papers(*lists: list[Paper]) -> list[Paper]:
    """Dedupe by DOI (or normalized title), keeping the richest record."""
    merged: dict[str, Paper] = {}
    for papers in lists:
        for p in papers:
            k = _key(p)
            cur = merged.get(k)
            if cur is None:
                merged[k] = p
                continue
            cur.cited_by_count = max(cur.cited_by_count, p.cited_by_count)
            cur.relevance = max(cur.relevance, p.relevance)
            cur.abstract = cur.abstract or p.abstract
            cur.year = cur.year or p.year
            cur.venue = cur.venue or p.venue
            if not cur.pdf_url and p.pdf_url:
                cur.pdf_url, cur.origin = p.pdf_url, p.origin
    return list(merged.values())


async def _resolve_fulltext(
    client: httpx.AsyncClient, p: Paper, email: str, sem: asyncio.Semaphore, errors: list[str]
) -> None:
    """Tier 2 then Tier 3 for a paper OpenAlex gave us no PDF for."""
    async with sem:
        if not p.pdf_url and p.doi:
            try:
                url = await unpaywall.resolve(client, p.doi, email)
            except httpx.HTTPError as e:
                errors.append(f"unpaywall:{p.doi}:{e.__class__.__name__}")
                url = None
            if url:
                p.pdf_url, p.origin = url, "unpaywall"

        if not p.pdf_url and p.doi:
            try:
                url = await europepmc.find_pdf(client, p.doi)
            except httpx.HTTPError as e:
                errors.append(f"europe_pmc:{p.doi}:{e.__class__.__name__}")
                url = None
            if url:
                p.pdf_url, p.origin = url, "europe_pmc"

    p.fulltext = "full_text" if p.pdf_url else "abstract_only"


async def discover(
    q: DiscoveryQuery,
    *,
    contact_email: str = "",
    top_n: int = 20,
    candidate_pool: int = 80,
    client: httpx.AsyncClient | None = None,
    on_event: EventCb | None = None,
) -> DiscoveryResult:
    """Mode A discovery. Returns the qualified papers, each marked full_text or
    abstract_only, plus everything that was dropped and why."""
    emit = on_event or (lambda stage, data: None)
    own_client = client is None
    client = client or make_client(contact_email)
    errors: list[str] = []

    terms = search_query(q.question)
    try:
        emit("searching", {"tiers": ["openalex", "europe_pmc"], "query": terms})
        results = await asyncio.gather(
            openalex.search(
                client, terms, per_page=candidate_pool,
                from_year=q.from_year, mailto=contact_email,
            ),
            europepmc.search(client, terms, page_size=min(candidate_pool, 100)),
            return_exceptions=True,
        )
        lists: list[list[Paper]] = []
        for name, res in zip(("openalex", "europe_pmc"), results):
            if isinstance(res, Exception):
                errors.append(f"{name}:search:{res.__class__.__name__}")
            else:
                lists.append(res)

        candidates = merge_papers(*lists)
        emit("candidates", {"count": len(candidates)})

        ranked, dropped = rank(candidates, q)
        ranked = ranked[:candidate_pool]
        emit("ranked", {"kept": len(ranked), "dropped": len(dropped)})

        # Resolve full text in batches, back-filling from the ranked list until
        # we have top_n usable papers or run out of candidates.
        sem = asyncio.Semaphore(5)
        usable: list[Paper] = []
        i = 0
        while len(usable) < top_n and i < len(ranked):
            batch = ranked[i : i + (top_n - len(usable))]
            i += len(batch)
            await asyncio.gather(
                *(_resolve_fulltext(client, p, contact_email, sem, errors) for p in batch)
            )
            for p in batch:
                if p.pdf_url or p.abstract:
                    usable.append(p)
                else:
                    dropped.append((p, "no_text_available"))
            emit("resolving", {"usable": len(usable), "target": top_n})

        stats = {
            "candidates": len(candidates),
            "usable": len(usable),
            "full_text": sum(p.fulltext == "full_text" for p in usable),
            "abstract_only": sum(p.fulltext == "abstract_only" for p in usable),
            "by_origin": {
                o: sum(p.origin == o and p.fulltext == "full_text" for p in usable)
                for o in ("openalex", "unpaywall", "europe_pmc")
            },
        }
        emit("done", stats)
        return DiscoveryResult(papers=usable, dropped=dropped, stats=stats, errors=errors)
    finally:
        if own_client:
            await client.aclose()


# ---- fast search: metadata + abstracts only, no per-paper lookups or downloads -------------------------------

OPENALEX_PAGE = 200                      # OpenAlex's maximum page size
EUROPEPMC_BUDGET_S = 12.0                # Europe PMC can take 30-45 s; never let it hold up an answer
EUROPEPMC_PAGE = 25                      # its response time grows with page size: 25 -> 4-7 s, 100 -> 20-30 s
MIN_RESULTS = 25                         # fewer papers than this: retry with the most specific words
MAX_TERMS = 6
LIST_WEIGHTS = {"relevance": 0.6, "authority": 0.25, "recency": 0.15}
CACHE_TTL_S = 15 * 60                    # a paper list and the follow-up questions on it reuse one search
_cache: dict[str, tuple[float, DiscoveryResult]] = {}


def _from_cache(terms: str, limit: int, with_abstracts: bool) -> DiscoveryResult | None:
    hit = _cache.get(terms)
    if not hit or time.monotonic() - hit[0] > CACHE_TTL_S:
        return None
    res = hit[1]
    papers = [p for p in res.papers if p.abstract] if with_abstracts else res.papers
    return DiscoveryResult(papers=papers[:limit], dropped=[], errors=res.errors,
                           stats={**res.stats, "found": len(papers[:limit]), "seconds": 0.0, "cached": True})


async def _timed(aw):
    """(result or the exception it raised, seconds taken)."""
    t = time.monotonic()
    try:
        r = await aw
    except Exception as e:
        r = e
    return r, round(time.monotonic() - t, 1)


def _with_relevance(papers: list[Paper], offset: int = 0, total: int | None = None) -> list[Paper]:
    n = total or len(papers) or 1
    for i, p in enumerate(papers):
        p.relevance = round(1.0 - (offset + i) / n, 4)
    return papers


async def search_papers(
    question: str,
    *,
    contact_email: str = "",
    limit: int = 400,
    with_abstracts: bool = False,
    client: httpx.AsyncClient | None = None,
    _relaxed: bool = False,
) -> DiscoveryResult:
    """Up to `limit` papers for a question in one round of parallel API calls (~5-12 s).

    Ranked mostly by search relevance, then citations and recency. Each paper carries its DOI link and any
    open-access PDF link the APIs already know. with_abstracts=True keeps only papers with an abstract
    (needed when the abstracts are used as evidence)."""
    t0 = time.monotonic()
    terms = search_query(question)
    if client is None and (cached := _from_cache(terms, limit, with_abstracts)):
        return cached
    own_client = client is None
    client = client or make_client(contact_email)
    pages = max(1, math.ceil(limit / OPENALEX_PAGE))
    per_page = min(OPENALEX_PAGE, limit)
    errors: list[str] = []
    try:
        calls = [openalex.search(client, terms, per_page=per_page, page=i + 1, mailto=contact_email,
                                 require_abstract=with_abstracts, max_wait=5.0) for i in range(pages)]
        calls.append(asyncio.wait_for(europepmc.search(client, terms, page_size=min(EUROPEPMC_PAGE, limit)), EUROPEPMC_BUDGET_S))
        timed = await asyncio.gather(*(_timed(c) for c in calls))
    finally:
        if own_client:
            await client.aclose()
    results = [r for r, _ in timed]
    secs = [s for _, s in timed]

    openalex_hits: list[Paper] = []
    for i, res in enumerate(results[:-1]):
        if isinstance(res, BaseException):
            errors.append(f"openalex:page{i + 1}:{res.__class__.__name__}")
        else:
            openalex_hits += res
    epmc = results[-1]
    if isinstance(epmc, BaseException):
        errors.append(f"europe_pmc:search:{'timeout' if isinstance(epmc, TimeoutError) else epmc.__class__.__name__}")
        epmc = []

    papers = merge_papers(_with_relevance(openalex_hits), _with_relevance(epmc))
    if with_abstracts:
        papers = [p for p in papers if p.abstract]
    now = time.gmtime().tm_year
    for p in papers:
        p.fulltext = "full_text" if p.pdf_url else "abstract_only"
        p.score_breakdown = {"relevance": p.relevance, "authority": authority_score(p.cited_by_count),
                             "recency": recency_score(p.year, now)}
        p.score = round(sum(LIST_WEIGHTS[k] * v for k, v in p.score_breakdown.items()), 4)
    papers.sort(key=lambda p: (p.score, p.cited_by_count), reverse=True)
    papers = papers[:limit]
    stats = {"query": terms, "found": len(papers), "openalex": len(openalex_hits), "europe_pmc": len(epmc),
             "with_pdf": sum(bool(p.pdf_url) for p in papers), "seconds": round(time.monotonic() - t0, 1),
             "openalex_s": max(secs[:-1]), "europe_pmc_s": secs[-1],
             "openalex_failed": len(results) - 1 - sum(not isinstance(r, BaseException) for r in results[:-1]),
             "europe_pmc_failed": isinstance(results[-1], BaseException)}
    result = DiscoveryResult(papers=papers, dropped=[], stats=stats, errors=errors)
    # Every search word must appear in a paper, so a long question or a pasted paragraph can match almost nothing.
    # Then search again with its most specific words only (longest first, kept in their original order).
    words = terms.split()
    if len(papers) < MIN_RESULTS and len(words) > MAX_TERMS and not _relaxed:
        keep = sorted(sorted(range(len(words)), key=lambda i: -len(words[i]))[:MAX_TERMS])
        relaxed = await search_papers(" ".join(words[i] for i in keep), contact_email=contact_email, limit=limit,
                                      with_abstracts=with_abstracts, client=None if own_client else client, _relaxed=True)
        if len(relaxed.papers) > len(papers):
            relaxed.stats["relaxed_from"] = terms
            result = relaxed
            papers = relaxed.papers
    if own_client and papers and (terms not in _cache or len(papers) >= len(_cache[terms][1].papers)):
        _cache[terms] = (time.monotonic(), result)
    return result
