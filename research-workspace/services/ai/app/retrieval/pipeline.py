"""3-tier hybrid retrieval: OpenAlex -> Unpaywall -> Europe PMC -> abstract fallback."""
import asyncio
import re
from collections.abc import Callable

import httpx

from . import europepmc, openalex, unpaywall
from .http import make_client
from .models import DiscoveryQuery, DiscoveryResult, Paper
from .ranking import rank

EventCb = Callable[[str, dict], None]


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
    top_n: int = 8,
    candidate_pool: int = 30,
    client: httpx.AsyncClient | None = None,
    on_event: EventCb | None = None,
) -> DiscoveryResult:
    """Mode A discovery. Returns the qualified papers, each marked full_text or
    abstract_only, plus everything that was dropped and why."""
    emit = on_event or (lambda stage, data: None)
    own_client = client is None
    client = client or make_client(contact_email)
    errors: list[str] = []

    try:
        emit("searching", {"tiers": ["openalex", "europe_pmc_preprints"]})
        results = await asyncio.gather(
            openalex.search(
                client, q.question, per_page=candidate_pool,
                from_year=q.from_year, mailto=contact_email,
            ),
            europepmc.search_preprints(client, q.question),
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
