"""Shared FastAPI dependencies (overridable in tests)."""
from functools import lru_cache

from fastapi import HTTPException

from .config import get_settings
from .orchestration.llm import LLM, LLMError, build_llms
from .ingest.embeddings import BgeEmbedder, Embedder, HashEmbedder
from .ingest.service import IngestConfig
from .ingest.tokenizer import HFTokenizer, RegexTokenizer, Tokenizer


@lru_cache
def get_embedder() -> Embedder:
    try:
        return BgeEmbedder(get_settings().embedding_model)
    except Exception:
        return HashEmbedder()


@lru_cache
def get_tokenizer() -> Tokenizer:
    try:
        return HFTokenizer(get_settings().embedding_model)
    except Exception:
        return RegexTokenizer()


def get_llms() -> tuple[LLM, LLM]:
    try:
        return build_llms(get_settings())
    except LLMError as e:
        raise HTTPException(503, f"models not configured: {e}")


def make_ingest_config(embedder: Embedder, tokenizer: Tokenizer) -> IngestConfig:
    s = get_settings()
    return IngestConfig(
        embedder=embedder, tokenizer=tokenizer,
        chunk_tokens=s.chunk_tokens, chunk_overlap=s.chunk_overlap,
        expected_dim=s.embedding_dim,
    )
