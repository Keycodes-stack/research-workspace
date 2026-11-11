"""Business Case export: PDF content, integrity re-check, ownership, financial section."""
import json
import os
from datetime import datetime, timezone

import pymupdf

from app.config import get_settings
from app.export.data import (
    Cite, Conflict, ExportOptions, Finding, Position, QA, ReportData,
)
from app.export.finance import FinancialInputs
from app.export.pdf import render_pdf
from tests.fakes import USER_B, ScriptedLLM, answer_json, db_exec, hdr
from tests.test_tasks_api import AGREED, Q, QUOTE, ask, models, setup


def pdf_text(content: bytes) -> str:
    doc = pymupdf.open(stream=content, filetype="pdf")
    return "\n".join(p.get_text() for p in doc)


def squash(t: str) -> str:
    return " ".join(t.split())


def export(api, thread, body=None, user=None):
    return api.post(f"/threads/{thread}/export/business-case", headers=hdr(user) if user else hdr(), json=body or {})


def db(fn):
    return db_exec(os.environ["TEST_DATABASE_URL"], fn)


def approved_session(api):
    p, s1, s2, t, th = setup(api)
    api.put(f"/tasks/{t}/sources", headers=hdr(), json={"source_ids": [s1]})
    api.post(f"/tasks/{t}/approve", headers=hdr())
    return p, s1, t, th


def test_report_contains_verified_content_citations_approval_and_fingerprint(api, monkeypatch):
    api.llms = models()
    p, s1, t, th = approved_session(api)
    lock = api.get(f"/tasks/{t}", headers=hdr()).json()["source_lock_hash"]

    async def add_doi(pool):
        await pool.execute("UPDATE sources SET doi='10.1000/xyz123', source_url='https://example.org/a?x=1&y=2' WHERE filename='liquid.pdf'")
    db(add_doi)

    ask(api, th)                                                           # consensus
    judge = json.dumps({"a_claims": [{"id": 1, "status": "contradicted", "b_ids": [1]}], "conflicts": [
        {"topic": "Storage duration", "a_id": 1, "b_id": 1, "explanation": "twelve weeks versus no longer"}]})
    api.llms = models("Stable at 4 C", "Stable for twelve weeks of refrigerated storage", judge=judge)
    ask(api, th)                                                           # disagreement
    monkeypatch.setattr(get_settings(), "similarity_threshold", 0.99)
    ask(api, th)                                                           # refused by the gate

    r = export(api, th, {"title": "Injection stability case", "prepared_by": "J. Akbar", "organization": "Keycodes"})
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF") and "business_case.pdf" in r.headers["content-disposition"]
    text = squash(pdf_text(r.content))

    for must in ["Injection stability case", "J. Akbar", "1. Executive summary", "2. Key metrics", "3. Findings by question",
                 "4. Unresolved disagreements", "5. Financial projection", "6. Citations", "7. Source register",
                 "8. Approval chain", "9. Verification method", "Stable at 4 C for twelve weeks", "Q1.",
                 "Storage duration", "Model A (lead scientist)", "Stable for twelve weeks of refrigerated storage",
                 "Insufficient source evidence", "CONFIDENTIAL", "Scientific review and sign-off",
                 "No financial assumptions were provided", "10.1000/xyz123", "liquid.pdf", lock[:16], "verified unchanged at export"]:
        assert must in text, must
    assert "stable at 4 C for twelve weeks" in text            # verbatim quote (collapsed line break)
    assert "summarises 3 research questions" in text

    # clickable DOI and source URL links, and internal citation links
    doc = pymupdf.open(stream=r.content, filetype="pdf")
    uris = {l.get("uri") for pg in doc for l in pg.get_links() if l.get("uri")}
    assert "https://doi.org/10.1000/xyz123" in uris and "https://example.org/a?x=1&y=2" in uris
    assert any(l.get("kind") == pymupdf.LINK_GOTO for pg in doc for l in pg.get_links())
    assert doc.metadata["title"] == "Injection stability case"
    assert f"Page {doc.page_count} of {doc.page_count}" in pdf_text(r.content)

    fp = r.headers["x-report-fingerprint"]
    assert len(fp) == 64 and fp[:12] in text.replace(" ", "")
    assert export(api, th, {"title": "other title"}).headers["x-report-fingerprint"] == fp   # content-addressed


def test_integrity_recheck_withholds_findings_whose_source_changed(api):
    api.llms = models()
    p, s1, t, th = approved_session(api)
    ask(api, th)

    async def tamper(pool):
        async with pool.acquire() as c:
            await c.execute("ALTER TABLE chunks DISABLE TRIGGER USER")
            await c.execute("UPDATE chunks SET text = replace(text, 'twelve', 'fourteen')")
            await c.execute("ALTER TABLE chunks ENABLE TRIGGER USER")
    db(tamper)

    text = squash(pdf_text(export(api, th).content))
    assert "Stable at 4 C for twelve weeks" not in text
    assert "Integrity notice" in text and "withheld" in text and "0 of 1 citations passed" in text
    assert "No citations" in text


def test_financial_section_is_arithmetic_on_user_inputs_only(api):
    api.llms = models()
    p, s1, t, th = approved_session(api)
    ask(api, th)
    fin = {"currency": "USD", "horizon_years": 3, "upfront_cost": 1000, "annual_benefit": 600,
           "annual_running_cost": 100, "note": "Illustrative"}
    text = squash(pdf_text(export(api, th, {"financial": fin}).content))
    for must in ["User-supplied assumptions", "not derived from the research sources", "Illustrative", "1,800.00",
                 "1,300.00", "500.00", "50.0%", "2.00 years"]:
        assert must in text, must
    assert export(api, th, {"financial": {"horizon_years": 99}}).status_code == 422


def test_message_filter_empty_thread_and_ownership(api):
    api.llms = models()
    p, s1, t, th = approved_session(api)
    text = squash(pdf_text(export(api, th).content))
    assert "No answers from this research session were available" in text and "No citations" in text

    first = ask(api, th).json()["message_id"]
    ask(api, th)
    msgs = api.get(f"/threads/{th}/messages", headers=hdr()).json()["messages"]
    assert len([m for m in msgs if m["role"] == "assistant"]) == 2
    one = squash(pdf_text(export(api, th, {"message_ids": [first]}).content))
    assert "1 research question " in one + " "

    assert export(api, th, user=USER_B).status_code == 404
    assert api.post(f"/threads/{th}/export/business-case", json={}).status_code == 401


def test_old_messages_without_citation_data_are_skipped_and_reported(api):
    api.llms = models()
    p, s1, t, th = approved_session(api)
    ask(api, th)

    async def strip(pool):
        await pool.execute("UPDATE messages SET model_b_raw = model_b_raw - 'final' WHERE role='assistant'")
    db(strip)
    text = squash(pdf_text(export(api, th).content))
    assert "1 earlier answer(s) were not included" in text


# ---- renderer only (no database) ------------------------------------------------------------

def synthetic(**over) -> ReportData:
    c = Cite(1, "c1", "α-Synuclein <study> & “aggregation”", "α-Synuclein <study> & “aggregation”", None, "10.1/ab",
             None, 4, 5, 10, 14, "aggregated at 25 °C with 5 µg/mL & <b>bold</b>", "f" * 64, "exact")
    qa = QA("Does α-synuclein aggregate at 25 °C?", datetime(2026, 1, 1, tzinfo=timezone.utc), "consensus", "models_agree",
            findings=[Finding("Aggregation occurs at ≥25 °C (β-sheet) <script>&", "5 µg/mL; pH 7.4", [1])], verified=2)
    dq = QA("Disputed?", datetime(2026, 1, 2, tzinfo=timezone.utc), "disagreement", "conflicting_claims",
            conflicts=[Conflict("Rate", "differs", "judge", Position("fast", None, [1]), None)])
    base = dict(title="Synthetic", project_name="P", mode="open_discovery", task_title="T", task_brief=None,
                generated_at=datetime(2026, 1, 3, tzinfo=timezone.utc), prepared_by=None, organization=None,
                qas=[qa, dq], cites=[c], sources=[], metrics={
                    "questions": 2, "consensus": 1, "disagreement": 1, "insufficient_evidence": 0, "findings": 1,
                    "confirmed": 1, "model_claims_verified": 2, "model_claims_purged": 0, "citations": 1,
                    "sources_cited": 1, "sources_approved": 1, "avg_top_similarity": 0.81, "withheld": 0},
                approval={"status": "draft", "created_at": None, "approved_by": None, "approved_at": None,
                          "lock_hash": None, "lock_ok": None, "n_sources": 0, "owner_id": "0" * 8},
                integrity={"checked": 1, "passed": 1, "failed": []}, financial=None, skipped_messages=0,
                fingerprint="a" * 64, thread_id="t")
    base.update(over)
    return ReportData(**base)


def test_unicode_and_markup_in_content_render_literally():
    text = squash(pdf_text(render_pdf(synthetic())))
    for lit in ["α-Synuclein", "≥25 °C", "β-sheet", "5 µg/mL", "<script>&", "<b>bold</b>", "“aggregation”"]:
        assert lit in text, lit
    assert "CONFIDENTIAL" not in text
    assert "Sources were not locked for this task" in text            # unapproved task is stated, not hidden
    assert "No corresponding finding" in text


def test_long_reports_paginate_and_keep_footer():
    many = [synthetic().qas[0] for _ in range(60)]
    pdf = render_pdf(synthetic(qas=many))
    doc = pymupdf.open(stream=pdf, filetype="pdf")
    assert doc.page_count > 3
    for i, pg in enumerate(doc, 1):
        assert f"Page {i} of {doc.page_count}" in pg.get_text()


def test_repeated_findings_are_listed_once_in_the_summary(api):
    api.llms = models()
    p, s1, t, th = approved_session(api)
    ask(api, th)
    ask(api, th)
    text = squash(pdf_text(export(api, th).content))
    summary = text.split("Key verified findings")[1].split("Finding statements were written")[0]
    assert summary.count("Stable at 4 C for twelve weeks") == 1
