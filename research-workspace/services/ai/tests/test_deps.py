import pytest
from fastapi import HTTPException

from app import deps
from app.config import get_settings
from app.ingest.embeddings import HashEmbedder


@pytest.fixture(autouse=True)
def _fresh_cache():
    deps._load_embedder.cache_clear()
    deps._load_tokenizer.cache_clear()
    yield
    deps._load_embedder.cache_clear()
    deps._load_tokenizer.cache_clear()


def test_bge_unavailable_fails_loudly_instead_of_falling_back(monkeypatch):
    def boom(*_a, **_k):
        raise ImportError("sentence_transformers")

    monkeypatch.setattr(get_settings(), "embedder", "bge")
    monkeypatch.setattr(deps, "BgeEmbedder", boom)
    with pytest.raises(HTTPException) as e:
        deps.get_embedder()
    assert e.value.status_code == 503


def test_hash_only_when_explicitly_configured(monkeypatch):
    monkeypatch.setattr(get_settings(), "embedder", "hash")
    assert isinstance(deps.get_embedder(), HashEmbedder)
