"""Token-window chunking with page/line provenance and SHA-256 hashing."""
import hashlib
from bisect import bisect_right
from dataclasses import dataclass, field

from .extraction import Line
from .tokenizer import Tokenizer


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass
class Chunk:
    index: int
    text: str                    # exact slice of the document text
    sha256: str                  # sha256(text), re-checked at citation time
    token_count: int
    page_start: int | None
    page_end: int | None
    line_start: int | None       # line number on page_start
    line_end: int | None         # line number on page_end
    # One entry per source line the chunk touches: {page, line, bbox}
    line_refs: list[dict] = field(default_factory=list)


def build_document(lines: list[Line]) -> tuple[str, list[int]]:
    """Join lines with '\\n'. Returns (text, start offset of each line)."""
    starts: list[int] = []
    pos = 0
    for ln in lines:
        starts.append(pos)
        pos += len(ln.text) + 1
    return "\n".join(ln.text for ln in lines), starts


def chunk_lines(
    lines: list[Line],
    tokenizer: Tokenizer,
    *,
    size: int = 512,
    overlap: int = 64,
) -> list[Chunk]:
    if not 0 <= overlap < size:
        raise ValueError("overlap must satisfy 0 <= overlap < size")
    if not lines:
        return []

    text, starts = build_document(lines)
    spans = tokenizer.offsets(text)
    if not spans:
        return []

    step = size - overlap
    chunks: list[Chunk] = []
    i = 0
    while i < len(spans):
        j = min(i + size, len(spans))
        start, end = spans[i][0], spans[j - 1][1]
        chunks.append(_make_chunk(len(chunks), text, start, end, j - i, lines, starts))
        if j == len(spans):
            break
        i += step
    return chunks


def _make_chunk(
    index: int, text: str, start: int, end: int, tokens: int,
    lines: list[Line], starts: list[int],
) -> Chunk:
    first = bisect_right(starts, start) - 1
    last = bisect_right(starts, end - 1) - 1
    touched = lines[first : last + 1]
    body = text[start:end]
    return Chunk(
        index=index,
        text=body,
        sha256=sha256_hex(body),
        token_count=tokens,
        page_start=touched[0].page,
        page_end=touched[-1].page,
        line_start=touched[0].number,
        line_end=touched[-1].number,
        line_refs=[
            {"page": ln.page, "line": ln.number, "bbox": list(ln.bbox) if ln.bbox else None}
            for ln in touched
        ],
    )
