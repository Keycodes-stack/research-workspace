import io
from datetime import date
from decimal import Decimal

from docx import Document

from app.word_export import build_package_docx, build_project_docx, risks_from_charter


def _project(**overrides):
    base = {
        "name": "Heat Recovery", "status": "Active", "governance_stage": "Discovery",
        "project_type": "Technical Feasibility", "governance_level": "Standard", "priority": "High",
        "business_objective": "Recover waste heat", "in_scope": ["Site surveys"], "out_of_scope": [],
        "success_measures": ["MWh per year"], "start_date": date(2027, 1, 1), "target_date": date(2027, 6, 30),
        "budget_indicative": Decimal("150000.00"), "currency": "USD", "departments": ["Finance & Cost Modeling"],
        "external_partner_ingestion": False, "meta": {"charter": {"risks": [
            {"risk": "Low irradiance", "owner": "Sarah", "severity": "Medium", "response": "Study"}]}},
    }
    base.update(overrides)
    return base


def _text(data: bytes) -> str:
    doc = Document(io.BytesIO(data))
    parts = [p.text for p in doc.paragraphs]
    for table in doc.tables:
        for row in table.rows:
            parts.extend(cell.text for cell in row.cells)
    return "\n".join(parts)


def test_project_document_has_every_section_and_values():
    packages = [{"code": "WP-1", "title": "Site Assessment", "lead_id": "Sarah", "due_date": date(2027, 2, 15),
                 "stage": "Discovery", "progress": 0}]
    gates = [{"gate_name": "Preliminary Review", "target_date": date(2027, 2, 20), "decision_owner": "Ibrahim",
              "approver": "Sarah", "acceptance_criteria": "Accepted", "gate_scope": "Site Assessment", "status": "Pending"}]
    risks = [{"risk": "Low irradiance", "owner": "Sarah", "severity": "Medium", "response": "Study"}]
    text = _text(build_project_docx(_project(), packages, gates, risks))
    for heading_text in ["Charter, scope and measures", "Organization and stakeholders", "Delivery",
                         "Work packages", "Decision gates", "Risks", "Controls, governance and compliance"]:
        assert heading_text in text
    for value in ["Recover waste heat", "Site Assessment", "Preliminary Review", "Low irradiance", "2027-06-30", "Not set"]:
        assert value in text


def test_risks_come_from_the_charter_snapshot_and_bad_json_is_ignored():
    assert risks_from_charter({"charter": {"risks": [{"risk": "A"}, "junk"]}}) == [{"risk": "A"}]
    assert risks_from_charter('{"charter": {"risks": [{"risk": "B"}]}}') == [{"risk": "B"}]
    assert risks_from_charter(None) == []


def test_work_package_document_keeps_its_paragraphs():
    text = _text(build_package_docx("Site Assessment", "First line\nSecond line", "Heat Recovery"))
    assert "Site Assessment" in text and "First line" in text and "Second line" in text and "Heat Recovery" in text


import json as _json
import pytest as _pytest

from app.word_export import validate_rich_document


def _doc(*nodes):
    return _json.dumps({"type": "doc", "content": list(nodes)})


def test_rich_document_with_headings_lists_and_marks_is_accepted_and_exported():
    body = _doc(
        {"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Findings"}]},
        {"type": "paragraph", "content": [{"type": "text", "text": "Bold point", "marks": [{"type": "bold"}]}]},
        {"type": "bulletList", "content": [{"type": "listItem", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "Item one"}]}]}]},
    )
    validate_rich_document(body)
    from app.word_export import build_rich_package_docx
    text = _text(build_rich_package_docx("WP", body, "Project", "tiptap"))
    assert "Findings" in text and "Bold point" in text and "Item one" in text


@_pytest.mark.parametrize("body", [
    _doc({"type": "image", "attrs": {"src": "https://example.com/x.png"}}),
    _doc({"type": "paragraph", "content": [{"type": "text", "text": "x", "marks": [{"type": "link"}]}]}),
    _doc({"type": "heading", "attrs": {"level": 7}, "content": []}),
    "not json",
    _json.dumps({"type": "page"}),
])
def test_unsupported_content_is_refused(body):
    with _pytest.raises((ValueError, KeyError, TypeError)):
        validate_rich_document(body)


def test_comment_anchor_needs_an_id_and_other_marks_stay_refused():
    anchored = _doc({"type": "paragraph", "content": [
        {"type": "text", "text": "x", "marks": [{"type": "comment", "attrs": {"id": "c-1"}}]}]})
    validate_rich_document(anchored)
    with _pytest.raises(ValueError):
        validate_rich_document(_doc({"type": "paragraph", "content": [
            {"type": "text", "text": "x", "marks": [{"type": "comment", "attrs": {}}]}]}))
    with _pytest.raises(ValueError):
        validate_rich_document(_doc({"type": "paragraph", "content": [
            {"type": "text", "text": "x", "marks": [{"type": "link", "attrs": {"href": "https://x"}}]}]}))


def test_work_package_starts_with_its_own_details_and_is_a_valid_document():
    import json as _json
    from app.word_export import build_rich_package_docx, work_package_template
    brief = _json.dumps({"objective": "Cut noise to 70 dB(A)", "workstream": {
        "name": "Site survey", "output": "Noise map", "owner": "Sara Lee", "reviewer": "Omar Patel",
        "department": "Operations", "team": "", "start": "2027-01-05", "due": "2027-02-15", "dependencies": "Site access"}})
    body = work_package_template(brief, "Site survey")
    validate_rich_document(body)
    text = _text(build_rich_package_docx("Site survey", body, "Heat", "tiptap"))
    for expected in ["Cut noise to 70 dB(A)", "Noise map", "Sara Lee", "Omar Patel", "2027-02-15", "Site access"]:
        assert expected in text
    # a brief that is not JSON still gives a valid, blank-ready document
    validate_rich_document(work_package_template("not json", "Plain"))
