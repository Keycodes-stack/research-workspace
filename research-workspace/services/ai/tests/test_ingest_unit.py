"""Unit tests for extraction, chunking, embeddings and download (no database)."""
import asyncio

import httpx
import numpy as np
import pytest

from app.ingest.chunking import chunk_lines, sha256_hex
from app.ingest.download import PdfDownloadError, download_pdf
from app.ingest.embeddings import HashEmbedder
from app.ingest.extraction import Line, NoExtractableText, PdfError, extract_lines
from app.ingest.tokenizer import RegexTokenizer
from tests.helpers import make_pdf

TOK = RegexTokenizer()


def words_lines(n_lines, per_line=6, page_every=None):
    lines, n, page, num = [], 0, 1, 0
    for i in range(n_lines):
        if page_every and i and i % page_every == 0:
            page, num = page + 1, 0
        num += 1
        text = " ".join(f"w{n + k}" for k in range(per_line))
        n += per_line
        lines.append(Line(text=text, page=page, number=num, bbox=(0, num * 10, 100, num * 10 + 9)))
    return lines


# ---- extraction ----------------------------------------------------------

def test_extract_lines_pages_and_numbers():
    pdf = make_pdf([["Alpha beta", "Gamma delta"], ["Epsilon zeta"]])
    lines, pages = extract_lines(pdf)
    assert pages == 2
    assert [(l.page, l.number, l.text) for l in lines] == [
        (1, 1, "Alpha beta"), (1, 2, "Gamma delta"), (2, 1, "Epsilon zeta"),
    ]
    assert all(l.bbox and len(l.bbox) == 4 for l in lines)


def test_pdf_without_text_layer():
    with pytest.raises(NoExtractableText):
        extract_lines(make_pdf([[]]))


def test_garbage_and_encrypted_pdfs():
    with pytest.raises(PdfError):
        extract_lines(b"%PDF-1.4 this is not really a pdf")
    with pytest.raises(PdfError, match="password"):
        extract_lines(make_pdf([["secret text"]], user_pw="hunter2"))


# ---- chunking ------------------------------------------------------------

def test_chunks_are_exact_slices_with_valid_hashes():
    lines = words_lines(40)
    text = "\n".join(l.text for l in lines)
    chunks = chunk_lines(lines, TOK, size=30, overlap=6)
    assert len(chunks) > 3
    for c in chunks:
        assert c.text in text
        assert c.sha256 == sha256_hex(c.text)
        assert 0 < c.token_count <= 30


def test_chunks_cover_document_and_overlap():
    lines = words_lines(40)
    text = "\n".join(l.text for l in lines)
    chunks = chunk_lines(lines, TOK, size=30, overlap=6)
    assert text.startswith(chunks[0].text)
    assert text.endswith(chunks[-1].text)
    for a, b in zip(chunks, chunks[1:]):
        # the last 6 tokens of a are the first 6 tokens of b
        tail = TOK.offsets(a.text)[-6][0]
        assert b.text.startswith(a.text[tail:][: len(a.text) - tail][:10])
    assert [c.index for c in chunks] == list(range(len(chunks)))


def test_provenance_spans_pages():
    lines = words_lines(20, page_every=10)          # lines 1-10 page 1, 11-20 page 2
    chunks = chunk_lines(lines, TOK, size=100, overlap=10)
    crossing = [c for c in chunks if c.page_start == 1 and c.page_end == 2]
    assert crossing, "expected a chunk spanning the page boundary"
    c = crossing[0]
    assert c.line_start >= 1 and c.line_end >= 1
    assert {r["page"] for r in c.line_refs} == {1, 2}
    assert all(r["bbox"] for r in c.line_refs)
    first_ref = c.line_refs[0]
    assert c.text.startswith(lines[(first_ref["page"] - 1) * 10 + first_ref["line"] - 1].text[:5])


def test_short_document_is_one_chunk_and_bad_overlap_rejected():
    chunks = chunk_lines(words_lines(2), TOK, size=512, overlap=64)
    assert len(chunks) == 1
    with pytest.raises(ValueError):
        chunk_lines(words_lines(2), TOK, size=10, overlap=10)
    assert chunk_lines([], TOK) == []


def test_chunking_a_real_pdf_end_to_end():
    pdf = make_pdf([[f"Line {i} of page one" for i in range(20)],
                    [f"Line {i} of page two" for i in range(20)]])
    lines, _ = extract_lines(pdf)
    chunks = chunk_lines(lines, TOK, size=40, overlap=8)
    assert chunks[0].page_start == 1 and chunks[-1].page_end == 2


# ---- embeddings ----------------------------------------------------------

def test_hash_embedder_normalised_and_ordered():
    e = HashEmbedder()
    docs = e.embed_documents([
        "liquid injection stability at refrigerated temperature",
        "polymer tablet coating thickness",
    ])
    assert docs.shape == (2, 768)
    assert np.allclose(np.linalg.norm(docs, axis=1), 1.0, atol=1e-5)
    q = e.embed_query("stability of liquid injection")
    assert float(q @ docs[0]) > float(q @ docs[1])
    assert e.embed_documents([]).shape == (0, 768)


# ---- download ------------------------------------------------------------

def _dl(handler, max_bytes=1000):
    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            return await download_pdf(c, "https://x.test/p.pdf", max_bytes)
    return asyncio.run(go())


def test_download_pdf_ok_and_rejections():
    assert _dl(lambda r: httpx.Response(200, content=b"%PDF-1.7 body")) == b"%PDF-1.7 body"
    with pytest.raises(PdfDownloadError, match="not a PDF"):
        _dl(lambda r: httpx.Response(200, content=b"<html>paywall</html>"))
    with pytest.raises(PdfDownloadError, match="HTTP 403"):
        _dl(lambda r: httpx.Response(403))
    with pytest.raises(PdfDownloadError, match="larger"):
        _dl(lambda r: httpx.Response(200, content=b"%PDF" + b"x" * 5000), max_bytes=1000)
