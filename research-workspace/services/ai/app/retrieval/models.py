from dataclasses import dataclass, field
from typing import Literal

FullText = Literal["full_text", "abstract_only"]
# Matches the source_origin enum in db/migrations/001_init.sql
Origin = Literal["openalex", "unpaywall", "europe_pmc"]


def normalize_doi(doi: str | None) -> str | None:
    """Return a bare, lower-case DOI ('10.1000/xyz') or None."""
    if not doi:
        return None
    d = doi.strip().lower()
    for prefix in ("https://doi.org/", "http://doi.org/", "https://dx.doi.org/", "doi:"):
        if d.startswith(prefix):
            d = d[len(prefix):]
    return d or None


@dataclass
class Paper:
    title: str
    doi: str | None = None
    authors: list[str] = field(default_factory=list)
    venue: str | None = None
    year: int | None = None
    cited_by_count: int = 0
    abstract: str | None = None
    source_url: str | None = None
    pdf_url: str | None = None
    # Which tier supplied the PDF (or the record, if there is no PDF)
    origin: Origin = "openalex"
    fulltext: FullText = "abstract_only"
    score: float = 0.0
    score_breakdown: dict = field(default_factory=dict)


@dataclass
class DiscoveryQuery:
    question: str
    # Specific-conditions filter. A paper must mention at least one required
    # term (if any are given) and none of the excluded terms.
    required_terms: list[str] = field(default_factory=list)
    exclude_terms: list[str] = field(default_factory=list)
    from_year: int | None = None


@dataclass
class DiscoveryResult:
    papers: list[Paper]
    dropped: list[tuple[Paper, str]]
    stats: dict
    errors: list[str]
