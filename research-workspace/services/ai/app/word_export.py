"""Word (.docx) documents for projects and for work packages. Built from saved data only; nothing is invented."""
from __future__ import annotations

import io
import json
from datetime import date
from typing import Any

from docx import Document
from docx.shared import Pt

DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _text(value: Any) -> str:
    if value is None or value == "":
        return "Not set"
    if isinstance(value, list):
        return ", ".join(str(v) for v in value) if value else "Not set"
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def _bullets(doc: Document, items: list[str]) -> None:
    if not items:
        doc.add_paragraph("Not set")
        return
    for item in items:
        doc.add_paragraph(item, style="List Bullet")


def _table(doc: Document, headers: list[str], rows: list[list[Any]]) -> None:
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = "Light Grid Accent 1"
    for cell, header in zip(table.rows[0].cells, headers):
        cell.text = header
        for run in cell.paragraphs[0].runs:
            run.bold = True
    for row in rows:
        cells = table.add_row().cells
        for cell, value in zip(cells, row):
            cell.text = _text(value)


def build_project_docx(project: dict[str, Any], packages: list[dict[str, Any]],
                       gates: list[dict[str, Any]], risks: list[dict[str, Any]]) -> bytes:
    """Project charter, work packages, decision gates and risks, in the order of the spec's wizard."""
    doc = Document()
    doc.styles["Normal"].font.size = Pt(10)
    doc.add_heading(project["name"], level=0)
    doc.add_paragraph(f"Project charter · status {_text(project.get('status'))} · governance stage "
                      f"{_text(project.get('governance_stage'))}")

    doc.add_heading("1. Charter, scope and measures", level=1)
    _table(doc, ["Field", "Value"], [
        ["Project type", project.get("project_type")], ["Governance level", project.get("governance_level")],
        ["Priority", project.get("priority")], ["Programme / portfolio", project.get("programme")],
        ["Business unit / facility", project.get("business_unit")], ["Business objective", project.get("business_objective")],
        ["Background and business case", project.get("business_case")], ["Expected outcome", project.get("expected_outcome")],
        ["Planned start", project.get("start_date")], ["Target completion", project.get("target_date")],
    ])
    doc.add_heading("In scope", level=2)
    _bullets(doc, list(project.get("in_scope") or []))
    doc.add_heading("Out of scope", level=2)
    _bullets(doc, list(project.get("out_of_scope") or []))
    doc.add_heading("Success measures", level=2)
    _bullets(doc, list(project.get("success_measures") or []))
    doc.add_heading("Assumptions and constraints", level=2)
    doc.add_paragraph(_text(project.get("assumptions")))
    doc.add_heading("External dependencies", level=2)
    doc.add_paragraph(_text(project.get("external_dependencies")))

    doc.add_heading("2. Organization and stakeholders", level=1)
    _table(doc, ["Field", "Value"], [
        ["Executive sponsor", project.get("executive_sponsor")], ["Project lead", project.get("project_lead")],
        ["Departments", project.get("departments")], ["Stakeholder notes", project.get("stakeholder_notes")],
        ["External organizations", project.get("external_organizations")],
    ])

    doc.add_heading("3. Delivery", level=1)
    _table(doc, ["Budget", "Currency", "Delivery approach", "Reporting", "Resources"], [[
        project.get("budget_indicative"), project.get("currency"), project.get("delivery_approach"),
        project.get("reporting_frequency"), project.get("resource_allocation")]])
    doc.add_heading("Work packages", level=2)
    _table(doc, ["Code", "Work package", "Lead", "Due", "Stage", "Progress"], [
        [p["code"], p["title"], p.get("lead_id"), p.get("due_date"), p.get("stage"), f'{p.get("progress", 0)}%']
        for p in packages])
    doc.add_heading("Decision gates", level=2)
    _table(doc, ["Gate", "Target date", "Decision owner", "Approver", "Acceptance criteria", "Gate scope", "Status"], [
        [g.get("gate_name"), g.get("target_date"), g.get("decision_owner"), g.get("approver"),
         g.get("acceptance_criteria"), g.get("gate_scope"), g.get("status")] for g in gates])
    doc.add_heading("Risks", level=2)
    _table(doc, ["Risk", "Owner", "Severity", "Response"], [
        [r.get("risk"), r.get("owner"), r.get("severity"), r.get("response")] for r in risks])

    doc.add_heading("4. Controls, governance and compliance", level=1)
    _table(doc, ["Field", "Value"], [
        ["Standards and regulatory basis", project.get("standards")], ["Quality lead", project.get("quality_lead")],
        ["Security classification", project.get("security_classification")], ["Data handling region", project.get("data_region")],
        ["Retention", project.get("retention")], ["External partner evidence ingestion",
                                                    "Allowed" if project.get("external_partner_ingestion") else "Not allowed"],
    ])
    return _save(doc)


def build_package_docx(title: str, body: str, project_name: str) -> bytes:
    """A work package's working document, as text paragraphs."""
    doc = Document()
    doc.styles["Normal"].font.size = Pt(10)
    doc.add_heading(title or "Work package", level=0)
    doc.add_paragraph(project_name)
    for paragraph in (body or "").split("\n"):
        doc.add_paragraph(paragraph)
    return _save(doc)


def _save(doc: Document) -> bytes:
    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


def risks_from_charter(meta: Any) -> list[dict[str, Any]]:
    """Risks are kept in the charter snapshot (meta.charter.risks); the spec has no risks table."""
    if isinstance(meta, str):
        meta = json.loads(meta)
    charter = (meta or {}).get("charter") or {}
    return [r for r in (charter.get("risks") or []) if isinstance(r, dict)]


# ---- structured (rich text) documents from the Workspace editor -----------------------------

_BLOCKS = {"paragraph", "heading", "bulletList", "orderedList", "listItem", "hardBreak", "text"}
_MARKS = {"bold", "italic", "underline"}
_MAX_DEPTH = 12


def validate_rich_document(body: str) -> None:
    """Accept only the elements the editor offers. Anything else is refused, so stored content is always safe to render."""
    data = json.loads(body)
    if not isinstance(data, dict) or data.get("type") != "doc":
        raise ValueError("the document must be a rich-text document")

    def walk(node: Any, depth: int) -> None:
        if depth > _MAX_DEPTH or not isinstance(node, dict):
            raise ValueError("the document is nested too deeply or is malformed")
        kind = node.get("type")
        if kind not in _BLOCKS:
            raise ValueError(f"'{kind}' is not supported in work package documents")
        if kind == "text":
            if not isinstance(node.get("text"), str):
                raise ValueError("text must be a string")
            for mark in node.get("marks") or []:
                if not isinstance(mark, dict):
                    raise ValueError("unsupported text formatting")
                if mark.get("type") == "comment":
                    # a comment anchor: the id of a comment on this work package (validated when read)
                    comment_id = (mark.get("attrs") or {}).get("id")
                    if not isinstance(comment_id, str) or not 1 <= len(comment_id) <= 64:
                        raise ValueError("a comment anchor needs an id")
                elif mark.get("type") not in _MARKS:
                    raise ValueError("unsupported text formatting")
        if kind == "heading" and (node.get("attrs") or {}).get("level") not in (1, 2, 3):
            raise ValueError("headings must be level 1 to 3")
        for child in node.get("content") or []:
            walk(child, depth + 1)

    for child in data.get("content") or []:
        walk(child, 1)


def _runs(paragraph, nodes: list[Any]) -> None:
    for node in nodes or []:
        if node.get("type") == "hardBreak":
            paragraph.add_run().add_break()
            continue
        run = paragraph.add_run(node.get("text", ""))
        marks = {m.get("type") for m in node.get("marks") or []}
        run.bold = "bold" in marks or None
        run.italic = "italic" in marks or None
        run.underline = "underline" in marks or None


def add_rich_document(doc: Document, data: dict[str, Any]) -> None:
    for node in data.get("content") or []:
        kind = node.get("type")
        if kind == "heading":
            _runs(doc.add_heading("", level=node["attrs"]["level"]), node.get("content"))
        elif kind == "paragraph":
            _runs(doc.add_paragraph(), node.get("content"))
        elif kind in ("bulletList", "orderedList"):
            style = "List Bullet" if kind == "bulletList" else "List Number"
            for item in node.get("content") or []:
                for para in item.get("content") or []:
                    _runs(doc.add_paragraph(style=style), para.get("content"))


def build_rich_package_docx(title: str, body: str, project_name: str, fmt: str) -> bytes:
    """A work package's Workspace document. Structured documents keep their headings, lists and emphasis."""
    if fmt != "tiptap":
        return build_package_docx(title, body, project_name)
    doc = Document()
    doc.styles["Normal"].font.size = Pt(10)
    doc.add_heading(title or "Work package", level=0)
    doc.add_paragraph(project_name)
    add_rich_document(doc, json.loads(body or '{"type":"doc","content":[]}'))
    return _save(doc)
