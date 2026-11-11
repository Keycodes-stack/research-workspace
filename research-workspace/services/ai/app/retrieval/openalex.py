"""Tier 1: OpenAlex discovery (metadata, abstracts, open-access PDF links)."""
import httpx

from .http import get_json
from .models import Paper, normalize_doi

BASE = "https://api.openalex.org/works"
SELECT = (
    "id,doi,title,publication_year,cited_by_count,authorships,"
    "primary_location,best_oa_location,open_access,abstract_inverted_index"
)


def reconstruct_abstract(inverted: dict | None) -> str | None:
    """OpenAlex ships abstracts as {word: [positions]}; rebuild the text."""
    if not inverted:
        return None
    slots: dict[int, str] = {}
    for word, positions in inverted.items():
        for pos in positions:
            slots[pos] = word
    return " ".join(slots[i] for i in sorted(slots)) or None


def parse_work(w: dict) -> Paper | None:
    title = (w.get("title") or "").strip()
    if not title:
        return None
    doi = normalize_doi(w.get("doi"))
    best = w.get("best_oa_location") or {}
    primary = w.get("primary_location") or {}
    source = primary.get("source") or {}
    authors = [
        (a.get("author") or {}).get("display_name", "")
        for a in (w.get("authorships") or [])
    ]
    return Paper(
        title=title,
        doi=doi,
        authors=[a for a in authors if a],
        venue=source.get("display_name"),
        year=w.get("publication_year"),
        cited_by_count=w.get("cited_by_count") or 0,
        abstract=reconstruct_abstract(w.get("abstract_inverted_index")),
        source_url=f"https://doi.org/{doi}" if doi else primary.get("landing_page_url"),
        # Only a real PDF link counts as full text; oa_url may be a landing page.
        pdf_url=best.get("pdf_url"),
        origin="openalex",
    )


async def search(
    client: httpx.AsyncClient,
    query: str,
    *,
    per_page: int = 25,
    from_year: int | None = None,
    mailto: str = "",
) -> list[Paper]:
    filters = ["has_abstract:true"]
    if from_year:
        filters.append(f"from_publication_date:{from_year}-01-01")
    params = {
        "search": query,
        "per-page": per_page,
        "select": SELECT,
        "filter": ",".join(filters),
    }
    if mailto:
        params["mailto"] = mailto
    data = await get_json(client, BASE, params)
    if not data:
        return []
    papers = (parse_work(w) for w in data.get("results", []))
    return [p for p in papers if p]
