from app.access import can_manage, check_role, restrictions_on


def test_role_restrictions_are_off_by_default():
    assert restrictions_on() is False


def test_nobody_is_blocked_by_role_while_restrictions_are_off():
    assert can_manage("viewer", "owner", "owner") is True
    check_role("viewer", "owner")  # no error: membership is enough
