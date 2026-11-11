"""Dev/E2E harness: the real FastAPI app and database, with scripted models, the hashing
embedder and an in-memory S3, so the whole stack runs offline.  NOT for production.

    cd services/ai && DATABASE_URL=... INTERNAL_TOKEN=... python ../../infra/e2e/fake_ai_app.py
"""
import json
import sys
from pathlib import Path

import uvicorn

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "ai"))

from app.clients import get_s3  # noqa: E402
from app.deps import get_embedder, get_llms, get_tokenizer  # noqa: E402
from app.ingest.embeddings import HashEmbedder  # noqa: E402
from app.ingest.tokenizer import RegexTokenizer  # noqa: E402
from app.main import app  # noqa: E402
from tests.fakes import FakeS3  # noqa: E402

QUOTE = "stable at 4 C for twelve weeks"
AGREED = json.dumps({"a_claims": [{"id": 1, "status": "agreed", "b_ids": [1]}], "conflicts": []})
CONFLICT = json.dumps({
    "a_claims": [{"id": 1, "status": "contradicted", "b_ids": [1]}],
    "conflicts": [{"topic": "Storage duration", "a_id": 1, "b_id": 1,
                   "explanation": "The models disagree on how long the injection is stable."}]})


def claim(text, quote=QUOTE, cond=None):
    return {"text": text, "cites": ["C1"], "quote": quote, "conditions": cond}


class Scripted:
    """Chooses its behaviour from keywords in the question."""

    def __init__(self, name):
        self.name = name

    async def complete(self, system, user):
        judge = "cross-checker" in system
        if "conflict" in user:
            if judge:
                return CONFLICT
            text = ("Stable at 4 C for twelve weeks" if self.name == "A" else "Stable for twelve weeks, no longer")
            return json.dumps({"status": "answered", "claims": [claim(text, cond="refrigerated")]})
        if judge:
            return AGREED
        claims = [claim("Stable at 4 C for twelve weeks", cond="refrigerated storage")]
        if "fabricate" in user and self.name == "A":
            claims.append(claim("Stable for 52 weeks at 4 C", quote="stable for 52 weeks at 4 C"))
        return json.dumps({"status": "answered", "claims": claims})


s3 = FakeS3()
app.dependency_overrides[get_s3] = lambda: s3
app.dependency_overrides[get_embedder] = lambda: HashEmbedder()
app.dependency_overrides[get_tokenizer] = lambda: RegexTokenizer()
app.dependency_overrides[get_llms] = lambda: (Scripted("A"), Scripted("B"))

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")
