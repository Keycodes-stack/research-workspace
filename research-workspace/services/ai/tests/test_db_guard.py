"""The test helpers drop the schema, so they must refuse a live database. Pure check, no connection."""
import pytest

from tests.helpers import guard_test_url


@pytest.mark.parametrize("url", [
    "postgresql://rw:x@localhost:5432/rwtest",        # local
    "postgresql://rw:x@127.0.0.1:5432/research",      # local
    "postgresql://u:p@ep-cool-1.neon.tech/rwtest",    # hosted, but clearly a test database
])
def test_local_or_test_databases_are_allowed(url, monkeypatch):
    monkeypatch.delenv("ALLOW_REMOTE_TEST_DB", raising=False)
    guard_test_url(url)


def test_a_hosted_database_with_a_normal_name_is_refused(monkeypatch):
    monkeypatch.delenv("ALLOW_REMOTE_TEST_DB", raising=False)
    with pytest.raises(RuntimeError, match="Refusing to reset"):
        guard_test_url("postgresql://u:p@ep-live-1.neon.tech/neondb")


def test_the_override_is_explicit(monkeypatch):
    monkeypatch.setenv("ALLOW_REMOTE_TEST_DB", "1")
    guard_test_url("postgresql://u:p@ep-live-1.neon.tech/neondb")
