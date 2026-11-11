import asyncio

import httpx

RETRY_STATUS = {429, 500, 502, 503, 504}


def make_client(contact_email: str = "") -> httpx.AsyncClient:
    ua = "KeycodesResearchWorkspace/0.1"
    if contact_email:
        ua += f" (mailto:{contact_email})"
    return httpx.AsyncClient(
        headers={"User-Agent": ua}, timeout=30.0, follow_redirects=True
    )


async def get_json(
    client: httpx.AsyncClient,
    url: str,
    params: dict | None = None,
    *,
    retries: int = 3,
    backoff: float = 1.0,
) -> dict | None:
    """GET JSON with retry on 429/5xx and transport errors. 404 returns None."""
    for attempt in range(retries):
        last = attempt == retries - 1
        try:
            r = await client.get(url, params=params)
        except httpx.TransportError:
            if last:
                raise
            await asyncio.sleep(backoff * 2**attempt)
            continue

        if r.status_code in RETRY_STATUS and not last:
            wait = backoff * 2**attempt
            retry_after = r.headers.get("Retry-After")
            if retry_after and retry_after.isdigit():
                wait = max(wait, float(retry_after))
            await asyncio.sleep(wait)
            continue
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()
    return None
