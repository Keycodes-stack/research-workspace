"""Tokenizers used for chunk sizing. They return character offsets, so a chunk's
text is always an exact slice of the document (required for exact-match citation
verification and SHA-256 hashing)."""
import re
from typing import Protocol


class Tokenizer(Protocol):
    def offsets(self, text: str) -> list[tuple[int, int]]:
        """Character (start, end) span of every token, in order."""


class RegexTokenizer:
    """Dependency-free approximation: words and punctuation marks.

    Good for tests and as a fallback; use HFTokenizer in production so chunk
    sizes match the embedding model's real 512-token limit.
    """

    _pat = re.compile(r"\w+|[^\w\s]")

    def offsets(self, text: str) -> list[tuple[int, int]]:
        return [m.span() for m in self._pat.finditer(text)]


class HFTokenizer:
    """Hugging Face fast tokenizer (the embedding model's own vocabulary)."""

    def __init__(self, model_name: str):
        from tokenizers import Tokenizer as _Tok  # lazy: optional dependency

        self._tok = _Tok.from_pretrained(model_name)

    def offsets(self, text: str) -> list[tuple[int, int]]:
        enc = self._tok.encode(text, add_special_tokens=False)
        return [(s, e) for s, e in enc.offsets if e > s]
