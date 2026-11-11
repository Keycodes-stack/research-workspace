"""Tier 3: Europe PMC. Preprint search (SRC:PPR) and DOI -> PDF lookup."""
import httpx

from .http import get_json
from .models import Paper, normalize_doi

BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
FREE = {"Open access", "Free"}


def parse_result(r: dict) -> Paper | None:
    title = (r.get("title") or "").strip().rstrip(".")
    if not title:
        return None
    urls = (r.get("fullTextUrlList") or {}).get("fullTextUrl") or []
    pdf = next(
        (
            u["url"]
            for u in urls
            if u.get("documentStyle") == "pdf" and u.get("availability") in FREE
        ),
        None,
    )
    doi = normalize_doi(r.get("doi"))
    authors = [
        a.strip()
        for a in (r.get("authorString") or "").rstrip(".").split(",")
        if a.strip()
    ]
    year = int(r["pubYear"]) if str(r.get("pubYear") or "").isdigit() else None
    return Paper(
        title=title,
        doi=doi,
        authors=authors,
        venue=r.get("journalTitle") or r.get("bookOrReportDetails", {}).get("publisher"),
        year=year,
        cited_by_count=int(r.get("citedByCount") or 0),
        abstract=(r.get("abstractText") or None),
        source_url=f"https://doi.org/{doi}" if doi else None,
        pdf_url=pdf,
        origin="europe_pmc",
    )


async def _search(client: httpx.AsyncClient, query: str, page_size: int) -> list[Paper]:
    params = {
        "query": query,
        "format": "json",
        "resultType": "core",
        "pageSize": page_size,
    }
    data = await get_json(client, BASE, params)
    if not data:
        return []
    results = (data.get("resultList") or {}).get("result") or []
    papers = (parse_result(r) for r in results)
    return [p for p in papers if p]


async def search_preprints(
    client: httpx.AsyncClient, query: str, *, page_size: int = 15
) -> list[Paper]:
    """Search bioRxiv, medRxiv, Research Square, ChemRxiv etc. (SRC:PPR)."""
    return await _search(client, f"({query}) AND SRC:PPR", page_size)


async def find_pdf(client: httpx.AsyncClient, doi: str) -> str | None:
    """Look up a DOI in Europe PMC and return a free PDF URL if one exists."""
    papers = await _search(client, f'DOI:"{doi}"', 1)
    return papers[0].pdf_url if papers else None
