"""PDF -> ordered text lines with page number, line number and bounding box.

Line numbers count extracted (non-empty) lines on each page, 1-based. Together
with the bbox they let the Citation Inspector highlight the exact passage.
"""
import re
import unicodedata
from dataclasses import dataclass

import pymupdf  # PyMuPDF >= 1.24.3


class PdfError(Exception):
    """Unreadable, encrypted or corrupt PDF."""


class NoExtractableText(PdfError):
    """PDF opened fine but has no text layer (e.g. a scanned document)."""


@dataclass(frozen=True)
class Line:
    text: str
    page: int | None = None          # 1-based; None for non-PDF text (abstracts)
    number: int | None = None        # 1-based line index on the page
    bbox: tuple[float, float, float, float] | None = None


def clean(text: str) -> str:
    """NFKC (fixes ligatures like 'ﬁ') and collapse whitespace."""
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", text)).strip()


def extract_lines(pdf_bytes: bytes) -> tuple[list[Line], int]:
    """Return (lines, page_count). Raises PdfError / NoExtractableText."""
    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    except Exception as e:  # PyMuPDF raises several exception types
        raise PdfError(f"cannot open PDF: {e}") from e

    with doc:
        if doc.needs_pass:
            raise PdfError("PDF is password-protected")

        lines: list[Line] = []
        for page_no, page in enumerate(doc, start=1):
            number = 0
            # sort=True restores reading order for multi-column layouts
            for block in page.get_text("dict", sort=True)["blocks"]:
                if block.get("type") != 0:   # skip image blocks
                    continue
                for ln in block["lines"]:
                    text = clean("".join(s["text"] for s in ln["spans"]))
                    if not text:
                        continue
                    number += 1
                    bbox = tuple(round(v, 1) for v in ln["bbox"])
                    lines.append(Line(text=text, page=page_no, number=number, bbox=bbox))
        page_count = doc.page_count

    if not lines:
        raise NoExtractableText("no text layer found (scanned PDF? OCR is not supported)")
    return lines, page_count
