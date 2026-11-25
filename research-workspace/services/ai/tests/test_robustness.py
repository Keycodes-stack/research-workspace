"""Answers never end in an error page: a model outage gets a clear answer that says what happened."""
from app.orchestration.engine import DualResult
from app.routes_tasks import render_content


def test_a_model_outage_has_a_readable_answer():
    text = render_content(DualResult("insufficient_evidence", "models_unavailable"))
    assert "did not respond" in text and "ask it again" in text
    assert text.strip()


def test_unknown_reasons_still_produce_text():
    assert render_content(DualResult("insufficient_evidence", "some_future_reason")).strip()
