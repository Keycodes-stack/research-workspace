from app.routes_tasks import charter_over_limits


def test_short_charter_has_no_problems():
    assert charter_over_limits({"objective": "Assess solar.", "workstreams": [{"name": "Site"}]}) == []


def test_long_text_is_reported_not_trimmed():
    problems = charter_over_limits({"objective": "x" * 1201})
    assert problems == ["objective (1201 of 1200 characters)"]


def test_whitespace_does_not_count_toward_the_limit():
    assert charter_over_limits({"objective": " " + "x" * 1200 + "  "}) == []


def test_too_many_workstreams_are_reported():
    problems = charter_over_limits({"workstreams": [{"name": str(i)} for i in range(9)]})
    assert problems == ["workstreams (9 of at most 8)"]


def test_long_object_field_is_reported_with_its_path():
    problems = charter_over_limits({"risks": [{"risk": "y" * 301}]})
    assert problems == ["risks.risk (301 of 300 characters)"]


def test_long_list_item_is_reported():
    problems = charter_over_limits({"departments": ["d" * 101]})
    assert problems == ["departments (an item is over 100 characters)"]
