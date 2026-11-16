import asyncio

import httpx
import pytest

from app.ingest.download import PdfDownloadError, download_pdf


def run(handler, url="https://x.test/p.pdf"):
    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            return await download_pdf(c, url, 1000)
    return asyncio.run(go())


def test_retries_403_with_browser_headers():
    def h(req):
        if "Mozilla" in req.headers.get("user-agent", ""):
            return httpx.Response(200, content=b"%PDF-1.7 ok")
        return httpx.Response(403)
    assert run(h).startswith(b"%PDF")


def test_404_is_not_retried_and_html_is_rejected():
    with pytest.raises(PdfDownloadError, match="404"):
        run(lambda r: httpx.Response(404))
    with pytest.raises(PdfDownloadError, match="not a PDF"):
        run(lambda r: httpx.Response(200, content=b"<html>"))
