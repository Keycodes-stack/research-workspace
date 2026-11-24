"""Evidence library: pure logic (question, labels, references). The database flow is covered by the DB tests."""
import json
from datetime import date

from app.evidence import (
    REFERENCES_HEADING, _plain, build_question, configured_models, model_label, references_block, search_text,
)
from app.word_export import validate_rich_document


PROJECT = {
    "name": "Corolla 2030", "business_objective": "Cut chassis mass by 10%", "business_case": "Fuel economy targets",
    "expected_outcome": "A feasibility report", "in_scope": json.dumps(["aluminium", "steel"]),
    "out_of_scope": ["engine"],
}
WP = {"title": "Chassis research", "brief": "Compare alloys", "stage": "Discovery", "due_date": date(2027, 3, 1)}


def test_question_uses_project_and_work_package_fields():
    q = build_question(PROJECT, WP)
    assert "Objective: Cut chassis mass by 10%" in q
    assert "In scope: aluminium; steel" in q
    assert "Out of scope: engine" in q
    assert "Work package: Chassis research" in q
    assert "Due: 2027-03-01" in q


def test_question_skips_empty_fields():
    q = build_question({"name": "P"}, {"title": "W"})
    assert q.splitlines() == ["Project: P", "Work package: W"]


def test_search_text_is_short_and_starts_with_the_work_package():
    text = search_text(PROJECT, WP)
    assert text.startswith("Chassis research")
    assert len(text) <= 300
    assert "  " not in text


def test_model_label_names_provider_and_model():
    assert model_label("mistral", "mistral-small-latest") == "Mistral mistral-small-latest"
    assert model_label("groq", "") == "Groq"
    assert model_label("", "x") == "Model x"


def test_configured_models_has_both_slots():
    labels = configured_models()
    assert set(labels) == {"model_a", "model_b"}
    assert all(v["label"] for v in labels.values())


def test_references_block_is_valid_rich_text_and_numbered_per_source():
    items = [
        {"source_id": "s1", "source_title": "Alloy study", "pub_year": 2024, "doi": "10.1/a", "confirmed": True},
        {"source_id": "s1", "source_title": "Alloy study", "pub_year": 2024, "doi": "10.1/a", "confirmed": False},
        {"source_id": "s2", "source_title": "Steel report", "pub_year": None, "source_url": "https://x.org/r",
         "confirmed": False},
    ]
    block = references_block(items)
    assert _plain(block[0]) == REFERENCES_HEADING
    body = json.dumps({"type": "doc", "content": block})
    validate_rich_document(body)                       # would raise if the editor could not show it
    entries = [_plain(li["content"][0]) for li in block[1]["content"]]
    assert entries[0].startswith("[1] Alloy study (2024). 10.1/a. confirmed by both models.")
    assert entries[1].startswith("[2] Steel report. https://x.org/r. single model.")
    assert len(entries) == 2                           # one entry per source, not per claim


def test_references_block_without_evidence_says_so():
    block = references_block([])
    assert _plain(block[0]) == REFERENCES_HEADING
    assert "No evidence" in _plain(block[1])
    validate_rich_document(json.dumps({"type": "doc", "content": block}))


def test_references_show_the_access_date_when_known():
    from datetime import date
    items = [{"source_id": "s1", "source_title": "Alloy study", "pub_year": 2024, "doi": "10.1/a",
              "accessed_on": date(2026, 11, 24), "confirmed": True}]
    entries = [_plain(li["content"][0]) for li in references_block(items)[1]["content"]]
    assert entries[0] == "[1] Alloy study (2024). 10.1/a. Accessed 2026-11-24. confirmed by both models."
