import httpx


class PdfDownloadError(Exception):
    pass


async def download_pdf(client: httpx.AsyncClient, url: str, max_bytes: int) -> bytes:
    """Download a PDF, enforcing a size cap and checking the %PDF magic bytes
    (open-access 'PDF' links frequently return an HTML landing page instead)."""
    buf = bytearray()
    async with client.stream("GET", url) as r:
        if r.status_code != 200:
            raise PdfDownloadError(f"HTTP {r.status_code}")
        async for part in r.aiter_bytes():
            buf.extend(part)
            if len(buf) > max_bytes:
                raise PdfDownloadError(f"larger than {max_bytes} bytes")
    if not buf.startswith(b"%PDF"):
        raise PdfDownloadError("response is not a PDF")
    return bytes(buf)
