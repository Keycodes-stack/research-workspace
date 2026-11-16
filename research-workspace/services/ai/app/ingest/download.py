import httpx


class PdfDownloadError(Exception):
    pass


# Many open-access publishers answer 403 to API-style clients but serve the same public PDF to a browser.
# Only links that OpenAlex / Unpaywall / Europe PMC list as open access reach this code.
_BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/124.0 Safari/537.36",
    "Accept": "application/pdf,*/*;q=0.8",
}


async def _fetch(client: httpx.AsyncClient, url: str, max_bytes: int, headers: dict | None) -> bytes:
    buf = bytearray()
    async with client.stream("GET", url, headers=headers) as r:
        if r.status_code != 200:
            raise PdfDownloadError(f"HTTP {r.status_code}")
        async for part in r.aiter_bytes():
            buf.extend(part)
            if len(buf) > max_bytes:
                raise PdfDownloadError(f"larger than {max_bytes} bytes")
    if not buf.startswith(b"%PDF"):
        raise PdfDownloadError("response is not a PDF")
    return bytes(buf)


async def download_pdf(client: httpx.AsyncClient, url: str, max_bytes: int) -> bytes:
    """Download a PDF, enforcing a size cap and checking the %PDF magic bytes
    (open-access 'PDF' links frequently return an HTML landing page instead).
    A 403/401/406 is retried once with browser-like headers."""
    try:
        return await _fetch(client, url, max_bytes, None)
    except PdfDownloadError as e:
        if str(e) not in ("HTTP 403", "HTTP 401", "HTTP 406"):
            raise
    return await _fetch(client, url, max_bytes, _BROWSER_HEADERS)
