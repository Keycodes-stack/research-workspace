from app.routes_tasks import _core_questions
from app.word_export import drafted_document, validate_rich_document


def test_timeline_budget_scope_and_deliverable_are_always_asked_first():
    headers = [q["header"] for q in _core_questions({})]
    assert headers == ["Timeline", "Budget", "Scope", "Deliverable"]


def test_the_four_questions_are_asked_even_when_the_draft_has_answers():
    # The four fixed questions come first, before the AI fills the charter, so they are always asked.
    headers = [q["header"] for q in _core_questions({"start": "2027-01-01", "target": "2027-06-30", "budget": "$50k", "deliverable": "Report"})]
    assert headers == ["Timeline", "Budget", "Scope", "Deliverable"]


def test_ai_sections_become_a_valid_document():
    body = drafted_document("Site survey", [
        {"heading": "Research objective", "paragraphs": ["Measure noise at every zone."], "bullets": ["Zone map"]},
        {"heading": "Method", "paragraphs": ["Sound-level meters at fixed points."]},
    ])
    assert body is not None
    validate_rich_document(body)
    assert "Measure noise at every zone." in body and "Zone map" in body


def test_unusable_ai_output_falls_back_to_the_template():
    assert drafted_document("X", None) is None
    assert drafted_document("X", [{"heading": "h", "paragraphs": []}]) is None
    assert drafted_document("X", [{"heading": "h", "paragraphs": ["<script>x</script>"], "bullets": []}]) is not None


def test_ribbon_formatting_is_accepted_and_bad_style_refused():
    import json as _json
    import pytest as _pytest
    ok = _json.dumps({"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 2, "textAlign": "center"}, "content": [{"type": "text", "text": "Plan",
            "marks": [{"type": "textStyle", "attrs": {"fontFamily": "Arial", "color": "#101D37"}}, {"type": "highlight", "attrs": {"color": "#FEF0C7"}}, {"type": "strike"}]}]},
        {"type": "table", "content": [{"type": "tableRow", "content": [
            {"type": "tableHeader", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Zone"}]}]},
            {"type": "tableCell", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "85 dB"}]}]}]}]},
    ]})
    validate_rich_document(ok)
    with _pytest.raises(ValueError):
        validate_rich_document(_json.dumps({"type": "doc", "content": [{"type": "paragraph", "attrs": {"textAlign": "sideways"}, "content": []}]}))
    with _pytest.raises(ValueError):
        validate_rich_document(_json.dumps({"type": "doc", "content": [{"type": "paragraph", "content": [
            {"type": "text", "text": "x", "marks": [{"type": "textStyle", "attrs": {"onclick": "alert(1)"}}]}]}]}))
