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

_BLOCKS = {"paragraph", "heading", "bulletList", "orderedList", "listItem", "hardBreak", "text",
           "table", "tableRow", "tableCell", "tableHeader", "horizontalRule"}
_MARKS = {"bold", "italic", "underline", "strike", "subscript", "superscript", "highlight", "textStyle"}
_ALIGNMENTS = {"left", "center", "right", "justify"}
_STYLE_KEYS = {"fontFamily", "fontSize", "color"}
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
                elif mark.get("type") in ("textStyle", "highlight"):
                    attrs = mark.get("attrs") or {}
                    for key, value in attrs.items():
                        if key not in _STYLE_KEYS or (value is not None and (not isinstance(value, str) or len(value) > 60)):
                            raise ValueError("unsupported text style")
        if kind == "heading" and (node.get("attrs") or {}).get("level") not in (1, 2, 3):
            raise ValueError("headings must be level 1 to 3")
        align = (node.get("attrs") or {}).get("textAlign")
        if align is not None and align not in _ALIGNMENTS:
            raise ValueError("unsupported paragraph alignment")
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
        elif kind == "table":
            rows = [r for r in (node.get("content") or []) if r.get("type") == "tableRow"]
            columns = max((len(r.get("content") or []) for r in rows), default=1)
            table = doc.add_table(rows=len(rows) or 1, cols=max(columns, 1))
            table.style = "Table Grid"
            for row_index, row in enumerate(rows):
                for col_index, cell in enumerate((row.get("content") or [])[:columns]):
                    target = table.rows[row_index].cells[col_index]
                    target.text = " ".join(
                        "".join(t.get("text", "") for t in (p.get("content") or []))
                        for p in (cell.get("content") or []) if p.get("type") == "paragraph").strip()
                    if cell.get("type") == "tableHeader":
                        for run in target.paragraphs[0].runs:
                            run.bold = True


def validate_sfdt(body: str) -> None:
    """The Syncfusion Document Editor's own format (SFDT): a JSON object with a list of sections. Only its shape is
    checked; the editor produces it, and the text is read back with sfdt_paragraphs."""
    data = json.loads(body)
    if not isinstance(data, dict) or not isinstance(data.get("sections"), list):
        raise ValueError("the document must be an editor document")
    if len(json.dumps(data)) > 2_000_000:
        raise ValueError("the document is too large")


def sfdt_paragraphs(body: str) -> list[str]:
    """The text of each paragraph of an SFDT document, in order (tables give one line per row)."""
    try:
        data = json.loads(body or "null")
    except ValueError:
        return []
    out: list[str] = []

    def text_of(node: Any) -> str:
        if isinstance(node, dict):
            if isinstance(node.get("text"), str):
                return node["text"]
            return "".join(text_of(child) for child in node.get("inlines") or [])
        return ""

    def walk(blocks: Any) -> None:
        for block in blocks or []:
            if not isinstance(block, dict):
                continue
            if block.get("rows") is not None:
                for row in block.get("rows") or []:
                    out.append(" | ".join(
                        " ".join(text_of(b) for b in (cell.get("blocks") or [])).strip()
                        for cell in (row.get("cells") or []) if isinstance(cell, dict)))
            else:
                out.append(text_of(block))

    for section in (data or {}).get("sections") or []:
        if isinstance(section, dict):
            walk(section.get("blocks"))
    return out


def build_rich_package_docx(title: str, body: str, project_name: str, fmt: str) -> bytes:
    """A work package's Workspace document. Structured documents keep their headings, lists and emphasis."""
    if fmt == "sfdt":
        doc = Document()
        doc.styles["Normal"].font.size = Pt(10)
        doc.add_heading(title or "Work package", level=0)
        doc.add_paragraph(project_name)
        for line in sfdt_paragraphs(body):
            doc.add_paragraph(line)
        return _save(doc)
    if fmt != "tiptap":
        return build_package_docx(title, body, project_name)
    doc = Document()
    doc.styles["Normal"].font.size = Pt(10)
    doc.add_heading(title or "Work package", level=0)
    doc.add_paragraph(project_name)
    add_rich_document(doc, json.loads(body or '{"type":"doc","content":[]}'))
    return _save(doc)


# ---- starting document of a work package, built from its details at creation time --------------

def work_package_template(brief: str | None, title: str) -> str:
    """The first version of a work package's document: the objective and the workstream's details, from the
    project's own data. Returned as the editor's JSON, so the Workspace is never blank for a new package."""
    try:
        data = json.loads(brief or "{}")
    except ValueError:
        data = {}
    if not isinstance(data, dict):
        data = {}
    workstream = data.get("workstream") if isinstance(data.get("workstream"), dict) else {}

    def text(value: Any) -> str:
        return str(value).strip() if value not in (None, "") else ""

    def label_line(label: str, value: Any) -> dict[str, Any]:
        return {"type": "paragraph", "content": [
            {"type": "text", "text": f"{label}: ", "marks": [{"type": "bold"}]},
            {"type": "text", "text": text(value) or "Not set"},
        ]}

    objective = text(data.get("objective"))
    content: list[dict[str, Any]] = [
        {"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": text(title) or "Work package"}]},
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Research objective"}]},
        {"type": "paragraph", "content": [{"type": "text", "text": objective or "Not set"}]},
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Scope of work"}]},
        label_line("Expected output", workstream.get("output")),
        label_line("Owner", workstream.get("owner")),
        label_line("Reviewer", workstream.get("reviewer")),
        label_line("Department", workstream.get("department")),
        label_line("Team", workstream.get("team")),
        label_line("Start", workstream.get("start")),
        label_line("Due", workstream.get("due")),
        label_line("Dependencies", workstream.get("dependencies")),
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Findings"}]},
        {"type": "paragraph"},
    ]
    return json.dumps({"type": "doc", "content": content})


def rich_text(body: str) -> str:
    """All the text of a rich-text document, in order (empty when the document has no text)."""
    def walk(node: Any) -> list[str]:
        if not isinstance(node, dict):
            return []
        parts = [node.get("text", "")] if node.get("type") == "text" else []
        for child in node.get("content") or []:
            parts.extend(walk(child))
        return parts
    try:
        return "".join(walk(json.loads(body or "null"))).strip()
    except ValueError:
        return ""


def drafted_document(title: str, sections: Any) -> str | None:
    """A work package document from AI-written sections (heading, paragraphs, bullets). None when the sections
    are not usable, so the caller falls back to the template."""
    if not isinstance(sections, list) or not sections:
        return None

    def clean(value: Any, limit: int = 1200) -> str:
        return str(value).strip()[:limit] if isinstance(value, (str, int, float)) else ""

    content: list[dict[str, Any]] = [{"type": "heading", "attrs": {"level": 1},
                                      "content": [{"type": "text", "text": clean(title, 300) or "Work package"}]}]
    for section in sections[:6]:
        if not isinstance(section, dict):
            continue
        heading = clean(section.get("heading"), 120)
        if heading:
            content.append({"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": heading}]})
        for paragraph in (section.get("paragraphs") or [])[:8]:
            text = clean(paragraph)
            if text:
                content.append({"type": "paragraph", "content": [{"type": "text", "text": text}]})
        bullets = [b for b in (clean(x, 300) for x in (section.get("bullets") or [])[:12]) if b]
        if bullets:
            content.append({"type": "bulletList", "content": [
                {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": b}]}]}
                for b in bullets]})
    if len(content) < 3:
        return None
    content.append({"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Findings"}]})
    content.append({"type": "paragraph"})
    body = json.dumps({"type": "doc", "content": content})
    try:
        validate_rich_document(body)
    except ValueError:
        return None
    return body
