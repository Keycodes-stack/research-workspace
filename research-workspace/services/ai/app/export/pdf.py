"""Renders a ReportData as a formal, print-ready PDF (A4). Pure layout: no content is generated here."""
import io
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import (
    HRFlowable, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)

from .data import Cite, Conflict, Finding, Position, QA, ReportData
from .finance import project, q2

FONTS = Path(__file__).parent / "fonts"
INK, MUTED, LINE = colors.HexColor("#14202b"), colors.HexColor("#5b6b7a"), colors.HexColor("#c9d2dc")
ACCENT, OK, WARN, BAD = (colors.HexColor(c) for c in ("#0b5cad", "#14733d", "#8a5a00", "#a12b2b"))
PAD = colors.HexColor("#f2f5f8")
W = A4[0] - 40 * mm          # usable width

_registered = False


def _fonts() -> None:
    global _registered
    if _registered:
        return
    for name, f in (("DV", "DejaVuSans"), ("DV-B", "DejaVuSans-Bold"), ("DV-I", "DejaVuSans-Oblique"),
                    ("DV-BI", "DejaVuSans-BoldOblique"), ("DV-M", "DejaVuSansMono")):
        pdfmetrics.registerFont(TTFont(name, str(FONTS / f"{f}.ttf")))
    pdfmetrics.registerFontFamily("DV", normal="DV", bold="DV-B", italic="DV-I", boldItalic="DV-BI")
    _registered = True


def _styles() -> dict[str, ParagraphStyle]:
    b = dict(fontName="DV", textColor=INK, fontSize=9.5, leading=13.5, alignment=TA_LEFT)
    return {
        "body": ParagraphStyle("body", **b),
        "small": ParagraphStyle("small", **{**b, "fontSize": 8, "leading": 11}),
        "muted": ParagraphStyle("muted", **{**b, "fontSize": 8.5, "leading": 12, "textColor": MUTED}),
        "mono": ParagraphStyle("mono", **{**b, "fontName": "DV-M", "fontSize": 7.5, "leading": 10, "textColor": MUTED}),
        "title": ParagraphStyle("title", **{**b, "fontName": "DV-B", "fontSize": 22, "leading": 27, "spaceAfter": 4}),
        "sub": ParagraphStyle("sub", **{**b, "fontSize": 11, "leading": 15, "textColor": MUTED, "spaceAfter": 10}),
        "h1": ParagraphStyle("h1", **{**b, "fontName": "DV-B", "fontSize": 14, "leading": 18, "spaceBefore": 14,
                                      "spaceAfter": 6, "textColor": ACCENT, "keepWithNext": 1}),
        "h2": ParagraphStyle("h2", **{**b, "fontName": "DV-B", "fontSize": 10.5, "leading": 14, "spaceBefore": 8,
                                      "spaceAfter": 3, "keepWithNext": 1}),
        "q": ParagraphStyle("q", **{**b, "fontName": "DV-B", "fontSize": 10, "leading": 14}),
        "cell": ParagraphStyle("cell", **{**b, "fontSize": 8, "leading": 10.5}),
        "cellh": ParagraphStyle("cellh", **{**b, "fontName": "DV-B", "fontSize": 8, "leading": 10.5, "textColor": colors.white}),
        "bullet": ParagraphStyle("bullet", **{**b, "leftIndent": 12, "bulletIndent": 2, "spaceAfter": 2}),
    }


def esc(s) -> str:
    return escape(str(s)) if s is not None else ""


def _date(d) -> str:
    return d.strftime("%d %b %Y, %H:%M UTC") if d else "n/a"


def _pages(c: Cite) -> str:
    if c.page_start is None:
        return "page n/a"
    p = f"p. {c.page_start}" if c.page_end in (None, c.page_start) else f"pp. {c.page_start}–{c.page_end}"
    if c.line_start is not None:
        p += f", lines {c.line_start}–{c.line_end}" if c.line_end not in (None, c.line_start) else f", line {c.line_start}"
    return p


def _refs(ns: list[int]) -> str:
    return " ".join(f'<link href="#cite{n}" color="#0b5cad">[{n}]</link>' for n in ns)


class _Numbered(rl_canvas.Canvas):
    """Two-pass canvas so the footer can say 'Page x of y'."""
    footer_left = ""
    confidential = False

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._saved = []

    def showPage(self):
        self._saved.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved)
        for st in self._saved:
            self.__dict__.update(st)
            self.setFont("DV", 7.5)
            self.setFillColor(MUTED)
            self.setStrokeColor(LINE)
            self.line(20 * mm, 14 * mm, A4[0] - 20 * mm, 14 * mm)
            self.drawString(20 * mm, 9.5 * mm, self.footer_left)
            self.drawRightString(A4[0] - 20 * mm, 9.5 * mm, f"Page {self._pageNumber} of {total}")
            if self.confidential:
                self.drawCentredString(A4[0] / 2, A4[1] - 11 * mm, "CONFIDENTIAL — derived from proprietary documents")
            super().showPage()
        super().save()


def _table(rows, widths, st, header=True, zebra=True, extra=()):
    t = Table(rows, colWidths=widths, repeatRows=1 if header else 0)
    style = [("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
             ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
             ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5)]
    if header:
        style += [("BACKGROUND", (0, 0), (-1, 0), ACCENT)]
    if zebra:
        style += [("ROWBACKGROUNDS", (0, 1 if header else 0), (-1, -1), [colors.white, PAD])]
    t.setStyle(TableStyle(style + list(extra)))
    return t


def _p(text, style):
    return Paragraph(text, style)


# ---- sections -----------------------------------------------------------------------------------

def _cover(d: ReportData, S):
    meta = [
        ["Project", d.project_name], ["Research task", d.task_title],
        ["Source of truth", "Closed repository (organisation's own documents)" if d.mode == "closed_repository"
         else "Open discovery (public literature)"],
        ["Prepared by", d.prepared_by or "Not specified"], ["Organisation", d.organization or "Not specified"],
        ["Generated", _date(d.generated_at)], ["Report fingerprint", d.fingerprint[:32] + "…"],
    ]
    rows = [[_p(f"<b>{k}</b>", S["cell"]), _p(esc(v), S["mono"] if k == "Report fingerprint" else S["cell"])] for k, v in meta]
    t = _table(rows, [38 * mm, W - 38 * mm], S, header=False, zebra=False)
    return [_p(esc(d.title), S["title"]), _p("Business Case — evidence-verified research summary", S["sub"]),
            HRFlowable(width="100%", color=ACCENT, thickness=1.5, spaceAfter=8), t]


def _executive(d: ReportData, S):
    m = d.metrics
    out = [_p("1. Executive summary", S["h1"])]
    if not d.qas:
        out.append(_p("No answers from this research session were available, so this report contains no findings.", S["body"]))
        return out
    out.append(_p(
        f"This report summarises {m['questions']} research question{'s' * (m['questions'] != 1)} on "
        f"<b>{esc(d.task_title)}</b>. For <b>{m['consensus']}</b> the two independent AI models agreed on findings "
        f"that were then verified against the source text; <b>{m['disagreement']}</b> produced a disagreement that is "
        f"reported in full rather than resolved; <b>{m['insufficient_evidence']}</b> could not be answered from the "
        f"approved sources.", S["body"]))
    seen, uniq = set(), []
    for f in sorted((f for q in d.qas for f in q.findings), key=lambda f: not f.confirmed):
        key = (f.text.strip().lower(), tuple(f.cite_ns))
        if key not in seen:
            seen.add(key)
            uniq.append(f)
    top = uniq[:8]
    if top:
        out.append(Spacer(1, 4))
        out.append(_p("Key verified findings", S["h2"]))
        for f in top:
            cond = f' <font color="#5b6b7a">(conditions: {esc(f.conditions)})</font>' if f.conditions else ""
            tag = "" if f.confirmed else ' <font color="#8a5a00">[single model]</font>'
            out.append(Paragraph(f"{esc(f.text)}{cond}{tag} {_refs(f.cite_ns)}", S["bullet"], bulletText="•"))
    if m["disagreement"]:
        out.append(_p(f"<font color='#8a5a00'><b>Note:</b></font> {m['disagreement']} question(s) have unresolved model "
                      "disagreements (section 4). They should not be treated as established findings.", S["body"]))
    if m["withheld"] or d.integrity["failed"]:
        out.append(_p(f"<font color='#a12b2b'><b>Integrity notice:</b></font> {m['withheld']} finding(s) were withheld because "
                      "the cited passage failed the integrity re-check at export (see section 8).", S["body"]))
    out.append(Spacer(1, 3))
    out.append(_p("Finding statements were written by the AI models. Each is backed by a verbatim source quote, shown in "
                  "the citations table (section 6), which was verified against the stored source text.", S["muted"]))
    return out


def _metrics(d: ReportData, S):
    m = d.metrics
    sim = f"{m['avg_top_similarity']:.2f}" if m["avg_top_similarity"] is not None else "n/a"
    rows = [
        ("Research questions asked", m["questions"]), ("Answered with agreed, verified findings", m["consensus"]),
        ("Model disagreements reported", m["disagreement"]), ("Insufficient source evidence", m["insufficient_evidence"]),
        ("Verified findings in this report", f"{m['findings']} ({m['confirmed']} confirmed by both models)"),
        ("Model claims verified / removed", f"{m['model_claims_verified']} / {m['model_claims_purged']}"),
        ("Citations (distinct source quotes)", m["citations"]),
        ("Sources cited / approved", f"{m['sources_cited']} / {m['sources_approved']}"),
        ("Average best source similarity", sim),
        ("Integrity re-check at export", f"{d.integrity['passed']} of {d.integrity['checked']} citations passed"),
    ]
    t = _table([[_p("Measure", S["cellh"]), _p("Value", S["cellh"])]] +
               [[_p(esc(a), S["cell"]), _p(esc(b), S["cell"])] for a, b in rows], [W * 0.62, W * 0.38], S)
    return [_p("2. Key metrics", S["h1"]), t,
            _p("“Removed” are model claims that failed automated citation verification and were never shown.", S["muted"])]


def _qa_block(i: int, q: QA, S, lead=()):
    badge = {"consensus": ("Agreed and verified", OK), "disagreement": ("Models disagree", WARN),
             "insufficient_evidence": ("Insufficient source evidence", MUTED)}[q.kind]
    head = [_p(f"Q{i}. {esc(q.question)}", S["q"]),
            _p(f'<font color="{badge[1].hexval().replace("0x", "#")}"><b>{badge[0]}</b></font> · asked {_date(q.asked_at)}', S["muted"])]
    body = []
    for f in q.findings:
        cond = f'<br/><font color="#5b6b7a" size="8">Conditions: {esc(f.conditions)}</font>' if f.conditions else ""
        tag = "" if f.confirmed else ' <font color="#8a5a00">[single model, not independently confirmed]</font>'
        body.append(Paragraph(f"{esc(f.text)}{tag} {_refs(f.cite_ns)}{cond}", S["bullet"], bulletText="•"))
    if q.kind == "insufficient_evidence" and not q.findings:
        body.append(_p("The approved sources do not contain enough verifiable information to answer this question.", S["body"]))
    if q.withheld:
        body.append(_p(f'<font color="#a12b2b">{q.withheld} finding(s) withheld: source integrity re-check failed.</font>', S["small"]))
    return [KeepTogether(list(lead) + head + body[:1])] + body[1:] + [Spacer(1, 6)]


def _findings(d: ReportData, S):
    heading = _p("3. Findings by question", S["h1"])
    shown = [(i, q) for i, q in enumerate(d.qas, 1) if q.kind == "consensus" or q.findings]
    if not shown:
        return [heading, _p("No question produced an agreed, verified finding.", S["body"])]
    out = []
    for n, (i, q) in enumerate(shown):
        # the first block carries the heading so it can never be stranded at the foot of a page
        out += _qa_block(i, q, S, lead=[heading] if n == 0 else ())
    return out


def _pos(p: Position | None, S):
    if p is None:
        return _p("No corresponding finding.", S["cell"])
    cond = f"<br/><font color='#5b6b7a'>Conditions: {esc(p.conditions)}</font>" if p.conditions else ""
    return _p(f"{esc(p.text)}{cond}<br/>{_refs(p.cite_ns)}", S["cell"])


def _disagreements(d: ReportData, S):
    out = [_p("4. Unresolved disagreements and open questions", S["h1"])]
    any_item = False
    for i, q in enumerate(d.qas, 1):
        if q.kind == "consensus":
            continue
        any_item = True
        out.append(_p(f"Q{i}. {esc(q.question)}", S["q"]))
        if q.kind == "insufficient_evidence":
            out.append(_p("Open question: the approved sources did not support an answer. "
                          "Additional sources would be needed.", S["body"]))
        for c in q.conflicts:
            t = _table([[_p("Model A (lead scientist)", S["cellh"]), _p("Model B (speed auditor)", S["cellh"])],
                        [_pos(c.a, S), _pos(c.b, S)]], [W / 2, W / 2], S, zebra=False)
            out.append(KeepTogether([_p(esc(c.topic), S["h2"]), t,
                                     _p(esc(c.explanation), S["muted"])]))
        for who, lst in (("Model A", q.single_a), ("Model B", q.single_b)):
            for f in lst:
                out.append(Paragraph(f"<b>{who} only:</b> {esc(f.text)} {_refs(f.cite_ns)}", S["bullet"], bulletText="•"))
        if q.kind == "disagreement" and not q.conflicts and not q.single_a and not q.single_b:
            out.append(_p("The models did not agree and no finding survived verification.", S["body"]))
        out.append(Spacer(1, 6))
    if not any_item:
        out.append(_p("None. Every question in this report was answered with agreed, verified findings.", S["body"]))
    return out


def _fmt(x, cur):
    return f"{q2(x):,.2f}"


def _financial(d: ReportData, S):
    out = [_p("5. Financial projection", S["h1"])]
    f = d.financial
    if f is None:
        out.append(_p("No financial assumptions were provided for this report, so no projection is shown. "
                      "The research findings above contain no financial figures that have been used here.", S["body"]))
        return out
    p = project(f)
    cur = f.currency
    out.append(_p("<b>User-supplied assumptions.</b> These figures were entered by the report's author. They are not derived "
                  "from the research sources and are not verified by the system. All results below are plain arithmetic on them.", S["body"]))
    assum = [("Currency", cur), ("Horizon", f"{f.horizon_years} year(s)"), ("Upfront cost", f"{f.upfront_cost:,.2f}"),
             ("Annual benefit (year 1)", f"{f.annual_benefit:,.2f}"), ("Annual running cost", f"{f.annual_running_cost:,.2f}"),
             ("Benefit growth per year", f"{f.benefit_growth_pct:g}%"), ("Discount rate", f"{f.discount_rate_pct:g}%")]
    out.append(_table([[_p(esc(a), S["cell"]), _p(esc(b), S["cell"])] for a, b in assum], [W * 0.5, W * 0.5], S, header=False))
    if f.note:
        out.append(_p(f"Author's note: {esc(f.note)}", S["muted"]))
    out.append(Spacer(1, 6))
    head = ["Year", f"Benefit ({cur})", f"Cost ({cur})", f"Net ({cur})", f"Cumulative ({cur})", f"Discounted net ({cur})"]
    rows = [[_p(h, S["cellh"]) for h in head]]
    for r in p.rows:
        rows.append([_p(str(r.year), S["cell"])] + [_p(_fmt(x, cur), S["cell"]) for x in (r.benefit, r.cost, r.net, r.cumulative, r.discounted)])
    out.append(_table(rows, [14 * mm] + [(W - 14 * mm) / 5] * 5, S))
    out.append(Spacer(1, 6))
    summ = [("Total benefit", _fmt(p.total_benefit, cur)), ("Total cost (incl. upfront)", _fmt(p.total_cost, cur)),
            ("Net over horizon", _fmt(p.net_total, cur)),
            (f"Net present value @ {f.discount_rate_pct:g}%", _fmt(p.npv, cur)),
            ("Return on upfront cost", f"{q2(p.roi_pct):,.1f}%" if p.roi_pct is not None else "n/a (no upfront cost)"),
            ("Payback", f"{q2(p.payback_years)} years" if p.payback_years is not None else "not within the horizon")]
    out.append(KeepTogether([_table([[_p(esc(a), S["cell"]), _p(f"<b>{esc(b)}</b>", S["cell"])] for a, b in summ],
                                    [W * 0.5, W * 0.5], S, header=False)]))
    return out


def _source_cell(c: Cite, S):
    parts = [f"<b>{esc(c.label)}</b>"]
    if c.doi:
        parts.append(f'<link href="https://doi.org/{esc(c.doi)}" color="#0b5cad">doi:{esc(c.doi)}</link>')
    if c.url:
        parts.append(f'<link href="{esc(c.url)}" color="#0b5cad">{esc(c.url)}</link>')
    if c.filename and not (c.doi or c.url):
        parts.append(f"Document: {esc(c.filename)}")
    return _p("<br/>".join(parts), S["cell"])


def _citations(d: ReportData, S):
    out = [_p("6. Citations", S["h1"])]
    if not d.cites:
        out.append(_p("No citations: the report contains no verified findings.", S["body"]))
        return out
    note = ("Each row is a verbatim quote from the stored source text. “SHA-256” is the checksum of the exact "
            "passage the quote was checked against; section headings are not extracted, so location is given as page and line range.")
    out.append(_p(note, S["muted"]))
    rows = [[_p(h, S["cellh"]) for h in ("#", "Source", "Location", "Verbatim quote", "Check")]]
    for c in d.cites:
        kind = {"exact": "Exact", "normalized": "Exact (formatting differs)", "fuzzy": "Approximate"}.get(c.match_kind or "", "Verified")
        rows.append([_p(f'<a name="cite{c.n}"/>[{c.n}]', S["cell"]), _source_cell(c, S), _p(esc(_pages(c)), S["cell"]),
                     _p(f"“{esc(c.quote)}”", S["cell"]), _p(f"{kind}<br/><font name='DV-M' size='6.5'>{c.sha256[:16]}…</font>", S["cell"])])
    out.append(_table(rows, [9 * mm, 48 * mm, 24 * mm, W - 9 * mm - 48 * mm - 24 * mm - 27 * mm, 27 * mm], S))
    return out


def _sources(d: ReportData, S):
    out = [_p("7. Source register", S["h1"]),
           _p("Documents the AI was permitted to use. File checksums let a reader confirm they hold the same files.", S["muted"])]
    if not d.sources:
        return out + [_p("No sources.", S["body"])]
    rows = [[_p(h, S["cellh"]) for h in ("Source", "Identifier", "Cited", "File SHA-256")]]
    for s in d.sources:
        ident = []
        if s.doi:
            ident.append(f'<link href="https://doi.org/{esc(s.doi)}" color="#0b5cad">doi:{esc(s.doi)}</link>')
        if s.url:
            ident.append(f'<link href="{esc(s.url)}" color="#0b5cad">{esc(s.url)}</link>')
        if s.filename:
            ident.append(f"File: {esc(s.filename)}")
        title = esc(s.title) + (f" ({s.year})" if s.year else "")
        rows.append([_p(title, S["cell"]), _p("<br/>".join(ident) or "n/a", S["cell"]), _p("Yes" if s.cited else "No", S["cell"]),
                     _p(f"<font name='DV-M' size='6.5'>{esc(s.file_sha256[:32] + '…') if s.file_sha256 else 'n/a'}</font>", S["cell"])])
    out.append(_table(rows, [W * 0.33, W * 0.33, W * 0.08, W * 0.26], S))
    return out


def _approval(d: ReportData, S):
    a = d.approval
    approved = a["status"] != "draft"
    lock = "n/a"
    if a["lock_hash"]:
        lock = f"{a['lock_hash'][:16]}… — " + ("verified unchanged at export" if a["lock_ok"] else "<font color='#a12b2b'>MISMATCH: sources changed after approval</font>")
    qdates = [q.asked_at for q in d.qas]
    steps = [
        ("1. Task defined", f"Project owner {esc(str(a['owner_id'])[:8])}…", _date(a["created_at"]), f"Task: {esc(d.task_title)}"),
        ("2. Sources approved and locked",
         f"User {esc(str(a['approved_by'])[:8])}…" if approved and a["approved_by"] else "Not approved",
         _date(a["approved_at"]) if approved else "n/a",
         f"{a['n_sources']} source(s). Lock: {lock}" if approved else "Sources were not locked for this task."),
        ("3. Answers produced", "AI Model A and Model B (independent), cross-checked",
         (_date(min(qdates)) if _date(min(qdates)) == _date(max(qdates)) else f"{_date(min(qdates))} – {_date(max(qdates))}") if qdates else "n/a", f"{d.metrics['questions']} question(s)"),
        ("4. Automated citation verification", "System", _date(d.generated_at),
         f"{d.integrity['passed']} of {d.integrity['checked']} citations re-verified at export"
         + (f"; {d.metrics['withheld']} finding(s) withheld" if d.metrics["withheld"] else "")),
    ]
    rows = [[_p(h, S["cellh"]) for h in ("Step", "By", "When", "Evidence")]]
    rows += [[_p(esc(s[0]), S["cell"]), _p(s[1], S["cell"]), _p(esc(s[2]), S["cell"]), _p(s[3], S["cell"])] for s in steps]
    sign = Table([[_p("<b>Scientific review and sign-off</b>", S["cell"]), "", ""],
                  [_p("Lead scientist", S["cell"]), _p("Signature: ________________________", S["cell"]), _p("Date: ______________", S["cell"])],
                  [_p("Reviewer", S["cell"]), _p("Signature: ________________________", S["cell"]), _p("Date: ______________", S["cell"])]],
                 colWidths=[W * 0.25, W * 0.45, W * 0.30])
    sign.setStyle(TableStyle([("SPAN", (0, 0), (-1, 0)), ("BOX", (0, 0), (-1, -1), 0.6, LINE),
                              ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
                              ("BACKGROUND", (0, 0), (-1, 0), PAD)]))
    notes = []
    if d.integrity["failed"]:
        notes.append(_p("<b>Integrity failures at export:</b> " + esc("; ".join(sorted(set(d.integrity["failed"])))), S["small"]))
    if d.skipped_messages:
        notes.append(_p(f"{d.skipped_messages} earlier answer(s) were not included because they have no stored citation data.", S["small"]))
    return [_p("8. Approval chain", S["h1"]), _table(rows, [W * 0.22, W * 0.24, W * 0.22, W * 0.32], S), Spacer(1, 10),
            KeepTogether([sign])] + notes


def _method(d: ReportData, S):
    pts = [
        "Two open-weight AI models answered each question independently, using only passages retrieved from the approved sources.",
        "Every claim was required to carry a verbatim quote. Automated code (not an AI model) checked the quote against the stored "
        "passage, the passage’s SHA-256 checksum, and that every number in the claim appears in the cited source. Failing claims were removed.",
        "A second model then cross-checked the verified claims, and a numeric check compared values for the same units. Disagreements are reported, not resolved.",
        "At export, each citation was checked again against the live database; anything that no longer matched was withheld.",
        "Limits: automated checks confirm that a claim is quoted from, and numerically consistent with, the source. They cannot confirm that the "
        "source itself is correct, or that an inference drawn from a quote is scientifically sound. Expert review is required before reliance.",
        "The report fingerprint is a SHA-256 over the findings and citations in this report; it changes if any of them change.",
    ]
    return [_p("9. Verification method and limitations", S["h1"])] + [Paragraph(esc(t), S["bullet"], bulletText="•") for t in pts] + [
        Spacer(1, 4), _p(f"Full fingerprint: <font name='DV-M' size='7'>{d.fingerprint}</font>", S["small"])]


def render_pdf(d: ReportData) -> bytes:
    _fonts()
    S = _styles()
    buf = io.BytesIO()

    class Canvas(_Numbered):
        footer_left = f"Keycodes AI Research Workspace · report {d.fingerprint[:12]}"
        confidential = d.mode == "closed_repository"

    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=20 * mm, bottomMargin=20 * mm,
                            title=d.title, author=d.prepared_by or "Keycodes AI Research Workspace",
                            subject="Business Case — evidence-verified research summary")
    story = _cover(d, S) + _executive(d, S) + _metrics(d, S) + _findings(d, S) + _disagreements(d, S) + _financial(d, S) \
        + _citations(d, S) + _sources(d, S) + _approval(d, S) + _method(d, S)
    doc.build(story, canvasmaker=Canvas)
    return buf.getvalue()
