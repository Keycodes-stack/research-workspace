"""A work package's brief: plain text typed by hand, the wizard's JSON, and the dependency text the wizard saves."""
import json

from app.routes_tasks import _dependency_text
from app.word_export import rich_text, work_package_template


def test_a_plain_text_brief_becomes_the_research_objective():
    assert "Compare cells" in rich_text(work_package_template("Compare cells", "Battery tests"))


def test_a_wizard_brief_keeps_its_objective_and_owner():
    brief = json.dumps({"objective": "Recover heat", "workstream": {"owner": "Sara"}})
    text = rich_text(work_package_template(brief, "Pilot"))
    assert "Recover heat" in text and "Sara" in text


def test_a_missing_brief_still_gives_a_document():
    assert "Not set" in rich_text(work_package_template(None, "Pilot"))


def test_dependency_text_is_read_from_the_workstream():
    brief = json.dumps({"workstream": {"dependencies": "Baseline, Lab Tests"}})
    assert _dependency_text(brief) == "baseline, lab tests"
    assert _dependency_text("Compare cells") == ""
    assert _dependency_text(None) == ""
