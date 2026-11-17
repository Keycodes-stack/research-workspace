"""Shared FastAPI dependencies (overridable in tests)."""
from functools import lru_cache

from fastapi import HTTPException

from .config import get_settings
from .orchestration.llm import LLM, LLMError, build_llms
from .ingest.embeddings import BgeEmbedder, Embedder, HashEmbedder
from .ingest.service import IngestConfig
from .ingest.tokenizer import HFTokenizer, RegexTokenizer, Tokenizer


def _use_hash() -> bool:
    """Keyword hashing only when explicitly configured (EMBEDDER=hash). Falling back
    silently would turn semantic retrieval into keyword overlap without anyone noticing."""
    return get_settings().embedder == "hash"


@lru_cache
def _load_embedder() -> Embedder:
    return HashEmbedder() if _use_hash() else BgeEmbedder(get_settings().embedding_model)


@lru_cache
def _load_tokenizer() -> Tokenizer:
    return RegexTokenizer() if _use_hash() else HFTokenizer(get_settings().embedding_model)


def get_embedder() -> Embedder:
    try:
        return _load_embedder()
    except Exception as e:
        raise HTTPException(503, f"embedding model unavailable ({e.__class__.__name__}: {e}); "
                                 "install requirements-ml.txt or set EMBEDDER=hash for development")


def get_tokenizer() -> Tokenizer:
    try:
        return _load_tokenizer()
    except Exception as e:
        raise HTTPException(503, f"tokenizer unavailable ({e.__class__.__name__}: {e}); "
                                 "install requirements-ml.txt or set EMBEDDER=hash for development")


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
