"""Measurements with units and the refinement allowlist: pure functions, no database."""
from app.measurements import extract_measurements, measurements_for
from app.refine import clean_changes

WP = "11111111-1111-4111-8111-111111111111"


def texts(s):
    return [m["text"] for m in extract_measurements(s)]


def test_temperature_viscosity_and_money_are_found_with_values():
    found = extract_measurements("Storage at 480 °C, viscosity 32.4 cP, CAPEX $142k")
    assert [m["text"] for m in found] == ["480 °C", "32.4 cP", "$142k"]
    assert found[0]["value"] == 480 and found[0]["unit"] == "°C"
    assert found[1]["value"] == 32.4 and found[1]["unit"] == "cP"
    assert found[2]["value"] == 142_000 and found[2]["unit"] == "$"


def test_longer_units_win_over_their_prefixes():
    assert texts("pipe 300 mm, flow 2 mPa·s, pressure 4 MPa") == ["300 mm", "2 mPa·s", "4 MPa"]


def test_decimal_comma_is_read_as_a_decimal_point():
    assert extract_measurements("drop of 1,5 bar")[0]["value"] == 1.5


def test_plain_numbers_without_units_are_not_measurements():
    assert extract_measurements("In 2024, 12 studies and 3 authors reported results.") == []


def test_the_same_figure_twice_in_one_text_is_listed_once():
    assert texts("480 °C and again 480 °C") == ["480 °C"]


def test_each_measurement_keeps_its_evidence_record():
    items = [{"evidence_id": "Evidence 007", "claim_text": "Melts at 800 °C", "quote": "",
              "work_package_code": "WP-1", "source_title": "Salt study"}]
    rows = measurements_for(items)
    assert rows[0]["evidence_id"] == "Evidence 007" and rows[0]["work_package_code"] == "WP-1"
    assert rows[0]["source_title"] == "Salt study"


def test_only_allowed_fields_with_valid_values_pass_the_allowlist():
    raw = [
        {"target": "project", "field": "lead", "value": "Sara Chen"},
        {"target": "project", "field": "owner_id", "value": "x"},                  # not allowed
        {"target": "work_package", "work_package_id": WP, "field": "due_date", "value": "2026-12-31"},
        {"target": "work_package", "work_package_id": WP, "field": "due_date", "value": "31/12/2026"},  # bad date
        {"target": "work_package", "work_package_id": "not-ours", "field": "title", "value": "Hijack"},
        {"target": "project", "field": "name", "value": "   "},                     # blank
        "not a dict",
    ]
    out = clean_changes(raw, {WP})
    assert [(c["target"], c["field"], c["value"]) for c in out] == [
        ("project", "lead", "Sara Chen"), ("work_package", "due_date", "2026-12-31")]


def test_values_are_trimmed_to_the_field_limit():
    out = clean_changes([{"target": "project", "field": "priority", "value": "x" * 500}], set())
    assert len(out[0]["value"]) == 40


def test_a_non_list_is_nothing():
    assert clean_changes("changes", set()) == []
