"""Tier 2: Unpaywall. DOI -> legal free PDF (preprints, accepted manuscripts)."""
from urllib.parse import quote

import httpx

from .http import get_json

BASE = "https://api.unpaywall.org/v2/"


async def resolve(client: httpx.AsyncClient, doi: str, email: str) -> str | None:
    """Return a direct PDF URL for a DOI, or None. Unpaywall requires an email."""
    if not email:
        return None
    data = await get_json(client, BASE + quote(doi, safe="/"), {"email": email})
    if not data or not data.get("is_oa"):
        return None
    locations = [data.get("best_oa_location"), *(data.get("oa_locations") or [])]
    for loc in locations:
        if loc and loc.get("url_for_pdf"):
            return loc["url_for_pdf"]
    return None
