import os

# Must be set before the app reads settings for the first time.
os.environ.setdefault("INTERNAL_TOKEN", "test-internal-token")
# HashEmbedder similarities are meaningless against the real 0.76 gate; gate tests set it explicitly.
os.environ.setdefault("SIMILARITY_THRESHOLD", "0.0")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from tests.helpers import make_pool, reset_schema, run_db  # noqa: E402


@pytest.fixture(scope="session")
def db_url():
    """Real Postgres + pgvector for integration tests (set TEST_DATABASE_URL)."""
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL not set")
    reset_schema(url)
    return url


class Api:
    """TestClient plus the fakes wired into the app. Set `api.llms` per test."""

    def __init__(self, client, s3):
        self.client, self.s3, self.llms = client, s3, None

    def __getattr__(self, name):       # api.post(...) etc.
        return getattr(self.client, name)


@pytest.fixture
def api(db_url):
    from app.clients import get_pool, get_s3
    from app.deps import get_embedder, get_llms, get_tokenizer
    from app.ingest.embeddings import HashEmbedder
    from app.ingest.tokenizer import RegexTokenizer
    from app.main import app
    from tests.fakes import FakeS3

    async def noop(pool):
        return None

    run_db(db_url, noop)            # empty tables for each test
    state, s3 = {}, FakeS3()

    async def pool_dep():
        # created lazily inside the app's own event loop, then reused
        if "pool" not in state:
            state["pool"] = await make_pool(db_url)
        return state["pool"]

    holder = {}
    app.dependency_overrides[get_pool] = pool_dep
    app.dependency_overrides[get_s3] = lambda: s3
    app.dependency_overrides[get_embedder] = lambda: HashEmbedder()
    app.dependency_overrides[get_tokenizer] = lambda: RegexTokenizer()
    app.dependency_overrides[get_llms] = lambda: holder["api"].llms

    with TestClient(app) as client:
        holder["api"] = Api(client, s3)
        yield holder["api"]
    app.dependency_overrides.clear()
