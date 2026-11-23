import pytest

from app.access import can_manage, check_role, restrictions_on
from app.config import Settings, get_settings


@pytest.fixture
def switch(monkeypatch):
    """Set ROLE_RESTRICTIONS for one test (settings are cached, so the cache is cleared around it)."""
    def set_value(value: str | None):
        if value is None:
            monkeypatch.delenv("ROLE_RESTRICTIONS", raising=False)
        else:
            monkeypatch.setenv("ROLE_RESTRICTIONS", value)
        get_settings.cache_clear()
    yield set_value
    get_settings.cache_clear()


def test_the_app_ships_with_role_restrictions_off(switch):
    switch(None)
    assert Settings().role_restrictions is False


def test_while_off_nobody_is_blocked_by_role(switch):
    switch("false")
    assert restrictions_on() is False
    assert can_manage("viewer", "owner", "owner") is True
    check_role("viewer", "owner")  # membership is enough


def test_when_on_roles_are_enforced(switch):
    switch("true")
    assert restrictions_on() is True
    assert can_manage("viewer", "owner", "owner") is False
    with pytest.raises(Exception):
        check_role("viewer", "owner")
