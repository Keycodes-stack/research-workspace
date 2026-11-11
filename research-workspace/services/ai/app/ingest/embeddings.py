"""Embedding models. All vectors are L2-normalised, so cosine similarity == dot."""
import hashlib
import re
from typing import Protocol

import numpy as np

BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


class Embedder(Protocol):
    dim: int

    def embed_documents(self, texts: list[str]) -> np.ndarray: ...
    def embed_query(self, text: str) -> np.ndarray: ...


class BgeEmbedder:
    """BAAI/bge-base-en-v1.5 via sentence-transformers (768-dim, runs locally)."""

    dim = 768

    def __init__(self, model_name: str = "BAAI/bge-base-en-v1.5"):
        from sentence_transformers import SentenceTransformer  # lazy: heavy

        self._model = SentenceTransformer(model_name)

    def embed_documents(self, texts: list[str]) -> np.ndarray:
        return self._model.encode(
            texts, batch_size=32, normalize_embeddings=True, convert_to_numpy=True
        ).astype(np.float32)

    def embed_query(self, text: str) -> np.ndarray:
        return self._model.encode(
            BGE_QUERY_PREFIX + text, normalize_embeddings=True, convert_to_numpy=True
        ).astype(np.float32)


class HashEmbedder:
    """Deterministic bag-of-words embedder (hashing trick). For tests and local
    development only: texts sharing words get high cosine similarity, but it has
    no semantic understanding."""

    def __init__(self, dim: int = 768):
        self.dim = dim

    def _vec(self, text: str) -> np.ndarray:
        v = np.zeros(self.dim, dtype=np.float32)
        for w in re.findall(r"\w+", text.lower()):
            h = int.from_bytes(hashlib.sha256(w.encode()).digest()[:8], "big")
            v[h % self.dim] += 1.0 if (h >> 63) & 1 else -1.0
        n = np.linalg.norm(v)
        return v / n if n else v

    def embed_documents(self, texts: list[str]) -> np.ndarray:
        return np.stack([self._vec(t) for t in texts]) if texts else np.zeros((0, self.dim), np.float32)

    def embed_query(self, text: str) -> np.ndarray:
        return self._vec(text)
