"""Lenient cross-check: differences between papers (or conditions) are shown with citations, not as a disagreement.
Scripted fake models, no network, no database. Strict mode (lenient=False) is covered by test_orchestration.py."""
import asyncio
import json
from uuid import UUID

from app.ingest.chunking import sha256_hex
from app.orchestration.engine import build_statement, decide_full, run_dual
from app.orchestration.llm import LLMError
from app.orchestration.schema import Claim, ContextChunk, JudgeVerdict, ParsedAnswer, parse_verdict
from app.orchestration.engine import FinalClaim

C1, C2, C3 = UUID(int=1), UUID(int=2), UUID(int=3)
SOURCES = {C1: "Smith 2024", C2: "Lee 2023", C3: "Smith 2024"}  # C1 and C3 are two passages of one paper
T1 = "Liquid injection samples were stable at 4 C for twelve weeks."
T2 = "With a citrate stabilizer the injection tolerated 25 C."
T3 = "Injection samples were stable at 4 C in a second experiment."
CHUNKS = [
    ContextChunk(C1, T1, "Smith 2024", 3, 3, sha256_hex(T1)),
    ContextChunk(C2, T2, "Lee 2023", 5, 5, sha256_hex(T2)),
]


def cl(text, chunk, quote="q", cond=None):
    return Claim(text, [chunk], ["C1"], quote, cond)


def fc(text, chunk, confirmed=False):
    return FinalClaim(text, [chunk], "q", None, confirmed=confirmed)


def answered(*claims):
    return ParsedAnswer("answered", list(claims))


def verdict(status_a, conflicts=(), statement=None, b_ids=(1,)):
    body = {"a_claims": [{"id": 1, "status": status_a, "b_ids": list(b_ids)}], "conflicts": list(conflicts)}
    if statement is not None:
        body["statement"] = statement
    return JudgeVerdict.model_validate(body)


def conflict(topic="Stability temperature", a_id=1, b_id=1):
    return {"topic": topic, "a_id": a_id, "b_id": b_id, "explanation": "The two papers report different temperatures."}


# ---- papers that differ -----------------------------------------------------------

def test_different_papers_disagreeing_become_a_difference_when_lenient():
    a = answered(cl("Stable at 4 C", C1))
    b = answered(cl("Tolerates 25 C", C2))
    v = verdict("contradicted", [conflict()])
    kind, reason, claims, dis, diffs = decide_full(a, b, v, [], SOURCES, lenient=True)
    assert (kind, reason, dis) == ("consensus", "no_overlap", None)
    assert len(diffs) == 1 and diffs[0]["detected_by"] == "judge"
    assert [c.confirmed for c in claims] == [False, False]           # shown, each with its own citation


def test_same_paper_disagreeing_stays_a_disagreement_even_when_lenient():
    a = answered(cl("Stable at 4 C", C1))
    b = answered(cl("Tolerates 25 C", C3))                             # same paper, another passage
    v = verdict("contradicted", [conflict(b_id=1)])
    kind, _, claims, dis, diffs = decide_full(a, b, v, [], SOURCES, lenient=True)
    assert kind == "disagreement" and claims == [] and diffs == []
    assert dis["conflicts"][0]["detected_by"] == "judge"


def test_strict_mode_keeps_different_papers_as_a_disagreement():
    a = answered(cl("Stable at 4 C", C1))
    b = answered(cl("Tolerates 25 C", C2))
    v = verdict("contradicted", [conflict()])
    kind, reason, claims, dis, diffs = decide_full(a, b, v, [], SOURCES, lenient=False)
    assert (kind, reason, claims, diffs) == ("disagreement", "conflicting_claims", [], [])


def test_same_claim_under_different_conditions_is_a_difference_when_lenient():
    a = answered(cl("Stable at 4 C", C1, cond="buffer"))
    b = answered(cl("Stable at 4 C", C3, cond="formamide"))
    v = verdict("contradicted", [conflict(b_id=1)])
    kind, _, _, _, diffs = decide_full(a, b, v, [], SOURCES, lenient=True)
    assert kind == "consensus" and len(diffs) == 1


def test_contradicted_claim_without_a_listed_conflict_is_a_difference_when_lenient():
    a = answered(cl("Stable at 4 C", C1))
    b = answered(cl("Tolerates 25 C", C2))
    v = verdict("contradicted", [])                                    # judge marked it, but listed no conflict
    kind, _, _, _, diffs = decide_full(a, b, v, [], SOURCES, lenient=True)
    assert kind == "consensus" and len(diffs) == 1


def test_numeric_mismatch_stays_a_disagreement_even_when_lenient():
    from app.orchestration.numeric import NumericConflict
    a = answered(cl("Stable at 4 C", C1))
    b = answered(cl("Stable at 25 C", C1))
    v = verdict("agreed")
    num = [NumericConflict(a_index=0, b_index=0, unit="°C", a_values=[4.0], b_values=[25.0], chunk_id=C1)]
    kind, _, _, dis, _ = decide_full(a, b, v, num, SOURCES, lenient=True)
    assert kind == "disagreement" and dis["conflicts"][0]["detected_by"] == "numeric"


def test_source_value_difference_between_papers_is_a_difference_when_lenient():
    from app.orchestration.numeric import SourceConflict
    a = answered(cl("Denatures above 90 C", C1))
    b = answered(cl("Denatures above 85 C", C2))
    v = verdict("agreed")
    sc = SourceConflict(first=a.claims[0], second=b.claims[0], unit="°C",
                        first_values=[90.0], second_values=[85.0])
    import app.orchestration.engine as eng
    original = eng.source_conflicts
    eng.source_conflicts = lambda claims, source_of: [sc]
    try:
        kind_l, _, _, _, diffs_l = decide_full(a, b, v, [], SOURCES, lenient=True)
        kind_s, _, _, dis_s, _ = decide_full(a, b, v, [], SOURCES, lenient=False)
    finally:
        eng.source_conflicts = original
    assert kind_l == "consensus" and diffs_l[0]["detected_by"] == "sources"
    assert kind_s == "disagreement" and dis_s["conflicts"][0]["detected_by"] == "sources"


# ---- one model answers, the other finds nothing -------------------------------------

class Fake:
    def __init__(self, name, handler):
        self.name, self.handler, self.calls = name, handler, []

    async def complete(self, system, user):
        self.calls.append(user)
        out = self.handler(system, user)
        if isinstance(out, Exception):
            raise out
        return out


def ans(*claims, status="answered", notes=None):
    body = {"status": status, "claims": [
        {"text": t, "cites": ["C1"], "quote": "stable at 4 C for twelve weeks", "conditions": None}
        for t in claims]}
    if notes:
        body["notes"] = notes
    return json.dumps(body)


def test_one_model_answers_and_the_other_finds_nothing_is_a_single_model_answer_when_lenient():
    a = Fake("model_a:x", lambda s, u: ans("Stable at 4 C"))
    b = Fake("model_b:x", lambda s, u: ans(status="insufficient_source_evidence", notes="Only the abstract."))
    r = asyncio.run(run_dual("How stable is it?", CHUNKS, a, b, lenient=True))
    assert (r.kind, r.reason) == ("consensus", "model_b_insufficient")
    assert [(c.text, c.confirmed) for c in r.claims] == [("Stable at 4 C", False)]
    assert "Model B found the sources insufficient" in r.statement


def test_one_model_answers_and_the_other_finds_nothing_stays_a_disagreement_when_strict():
    a = Fake("model_a:x", lambda s, u: ans("Stable at 4 C"))
    b = Fake("model_b:x", lambda s, u: ans(status="insufficient_source_evidence"))
    r = asyncio.run(run_dual("How stable is it?", CHUNKS, a, b, lenient=False))
    assert (r.kind, r.reason, r.claims) == ("disagreement", "model_b_insufficient", [])


def test_both_insufficient_is_unchanged_when_lenient():
    insuff = lambda s, u: ans(status="insufficient_source_evidence")
    r = asyncio.run(run_dual("q?", CHUNKS, Fake("A", insuff), Fake("B", insuff), lenient=True))
    assert (r.kind, r.reason) == ("insufficient_evidence", "both_models_insufficient")
    assert r.statement == "The sources do not contain a verified answer to this question."


# ---- the judge's statement -----------------------------------------------------------

def test_judge_statement_is_parsed_and_optional():
    assert parse_verdict('{"a_claims": [], "conflicts": []}').statement == ""
    assert parse_verdict('{"a_claims": [], "conflicts": [], "statement": null}').statement == ""
    text = parse_verdict('{"a_claims": [], "conflicts": [], "statement": "Both agree."}').statement
    assert text == "Both agree."


def test_judge_statement_is_used_when_it_adds_no_new_number():
    c = [fc("Stable at 4 C", C1)]
    s = build_statement("consensus", c, [], None, judge_text="Both models say the sample is stable at 4 C.")
    assert s == "Both models say the sample is stable at 4 C."


def test_judge_statement_with_a_new_number_is_replaced_by_the_counted_text():
    c = [fc("Stable at 4 C", C1)]
    s = build_statement("consensus", c, [], None, judge_text="Stable at 99 C for a year.")
    assert "99" not in s and "1 finding verified" in s


def test_long_judge_statement_is_replaced():
    c = [fc("Stable at 4 C", C1)]
    s = build_statement("consensus", c, [], None, judge_text="word " * 200)
    assert "finding" in s and len(s) < 600


def test_deterministic_statement_names_differences_and_one_model_findings():
    c = [fc("x", C1, confirmed=True), fc("y", C2)]
    diffs = [{"topic": "Stability temperature"}]
    s = build_statement("consensus", c, diffs, None)
    assert "1 confirmed by both models, 1 from one model only" in s
    assert "Stability temperature" in s
