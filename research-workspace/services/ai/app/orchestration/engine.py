"""Dual-model orchestration: A and B answer independently and in parallel; B then
cross-checks; a deterministic numeric check backs the judge up. Fails closed:
if the cross-check cannot be completed, nothing is presented as an answer."""
import asyncio
import re
import time
from dataclasses import asdict, dataclass, field
from difflib import SequenceMatcher
from typing import Callable, Literal
from uuid import UUID

from .llm import LLM, LLMError
from .numeric import NumericConflict, numeric_conflicts, source_conflicts
from .prompts import (
    SECOND_LOOK, SYSTEM_A, SYSTEM_B, SYSTEM_JUDGE, build_judge_prompt, build_user_prompt,
)
from ..verification.text import normalize, tokens
from ..verification.verifier import ClaimCheck, VerifyConfig, verify_answer
from .schema import (
    ANSWERED, INSUFFICIENT, Claim, ContextChunk, JudgeVerdict, ParseError,
    ParsedAnswer, parse_answer, parse_verdict,
)

Kind = Literal["consensus", "disagreement", "insufficient_evidence"]


class CrossCheckFailed(Exception):
    """A model or the judge was unavailable or kept returning invalid output."""


@dataclass
class FinalClaim:
    text: str
    chunk_ids: list[UUID]
    quote: str
    conditions: str | None
    confirmed: bool          # True when the other model independently agreed
    match_kind: str | None = None
    match_score: float = 0.0
    seals: dict[UUID, str] = field(default_factory=dict)   # chunk_id -> sha256 verified against


@dataclass
class DualResult:
    kind: Kind
    reason: str
    claims: list[FinalClaim] = field(default_factory=list)
    disagreement: dict | None = None
    model_a: dict = field(default_factory=dict)      # raw replies + parsed claims + issues
    model_b: dict = field(default_factory=dict)
    judge: dict = field(default_factory=dict)
    checks: dict = field(default_factory=dict)       # {"model_a": [ClaimCheck...], "model_b": [...]}
    statement: str = ""                              # what the cross-check found, for the reader
    differences: list[dict] = field(default_factory=list)   # points where sources or conditions differ (lenient mode)


# ---- calling a model with one repair retry ---------------------------------

async def _call(llm: LLM, system: str, user: str, parse: Callable[[str], object]):
    prompt, raws = user, []
    for attempt in range(2):
        try:
            raw = await llm.complete(system, prompt)
        except LLMError as e:
            raise CrossCheckFailed(str(e)) from e
        raws.append(raw)
        try:
            return parse(raw), raws
        except ParseError as e:
            if attempt == 1:
                # A model with a backup hands the question to it (the backup gets its own two tries).
                switch = getattr(llm, "use_backup", None)
                if switch and switch(f"{llm.name}: invalid output after retry ({e})"):
                    return await _call(llm, system, user, parse)
                raise CrossCheckFailed(f"{llm.name}: invalid output after retry ({e})") from e
            prompt = (
                f"{user}\n\nYour previous reply was rejected: {e}. "
                "Reply again with ONLY the JSON object described in the instructions."
            )
    raise AssertionError("unreachable")


async def _timed_answer(llm: LLM, system: str, user: str, alias_map: dict[str, UUID]):
    t0 = time.perf_counter()
    parsed, raws = await _call(llm, system, user, lambda t: parse_answer(t, alias_map))
    return parsed, raws, int((time.perf_counter() - t0) * 1000)


def _record(llm: LLM, parsed: ParsedAnswer, raws: list[str], ms: int, n_purged: int = 0) -> dict:
    return {
        "purged": n_purged,
        "model": llm.name, "status": parsed.status, "elapsed_ms": ms,
        "claims": [asdict(c) for c in parsed.claims],
        "notes": parsed.notes, "issues": parsed.issues, "raw": raws,
    }


# ---- building the Disagreement Summary ---------------------------------------

def _position(c: Claim | None) -> dict | None:
    if c is None:
        return None
    return {
        "text": c.text, "conditions": c.conditions, "chunk_ids": c.chunk_ids, "quote": c.quote,
        "verified": c.verified, "match_kind": c.match_kind, "seals": c.seals,
    }


def _conflict(topic, a: Claim | None, b: Claim | None, explanation, detected_by) -> dict:
    return {
        "topic": topic, "position_a": _position(a), "position_b": _position(b),
        "explanation": explanation, "detected_by": detected_by,
    }


def _summary(reason: str, conflicts: list[dict], a: ParsedAnswer, b: ParsedAnswer) -> dict:
    return {
        "reason": reason, "conflicts": conflicts,
        "model_a_claims": [asdict(c) for c in a.claims],
        "model_b_claims": [asdict(c) for c in b.claims],
    }


def _at(claims: list[Claim], one_based: int | None) -> Claim | None:
    if one_based is not None and 1 <= one_based <= len(claims):
        return claims[one_based - 1]
    return None


MIN_SHARED_QUOTE_TOKENS = 4      # a shorter shared span is too weak a sign that two claims state one finding
MIN_SHARED_QUOTE_SHARE = 0.4     # share of the shorter quote that must be one span of the other


def same_passage(a: Claim, b: Claim) -> bool:
    """Both claims quote the same part of the same passage: at least MIN_SHARED_QUOTE_SHARE of the shorter quote (and at
    least MIN_SHARED_QUOTE_TOKENS words) is one continuous span of the other. Both quotes already passed verification."""
    if not set(a.chunk_ids) & set(b.chunk_ids):
        return False
    qa, qb = (tokens(normalize(c.quote).lower()) for c in (a, b))
    m = SequenceMatcher(None, qa, qb, autojunk=False).find_longest_match(0, len(qa), 0, len(qb))
    return m.size >= max(MIN_SHARED_QUOTE_TOKENS, MIN_SHARED_QUOTE_SHARE * min(len(qa), len(qb)))


def decide_full(
    a: ParsedAnswer, b: ParsedAnswer, verdict: JudgeVerdict, numeric: list[NumericConflict],
    source_of: dict | None = None, lenient: bool = False,
) -> tuple[Kind, str, list[FinalClaim], dict | None, list[dict]]:
    """Pure decision logic for two answered analysts (unit-testable without models).
    Returns (kind, reason, claims, disagreement, differences). With `lenient`, differences that come from different
    papers (or from the same claim under different conditions) are reported as differences, not as a disagreement."""
    source_of = source_of or {}
    status = {v.id: v for v in verdict.a_claims}
    conflicts: list[dict] = []
    differences: list[dict] = []
    covered_a: set[int] = set()
    covered_b: set[int] = set()
    soft_a: set[int] = set()

    for jc in verdict.conflicts:
        ca, cb = _at(a.claims, jc.a_id), _at(b.claims, jc.b_id)
        if lenient and _soft(ca, cb, source_of):
            differences.append(_conflict(jc.topic or "Differing findings", ca, cb, jc.explanation, "judge"))
            soft_a.add(jc.a_id)
            continue
        conflicts.append(_conflict(jc.topic or "Conflicting findings", ca, cb, jc.explanation, "judge"))
        if ca: covered_a.add(jc.a_id)
        if cb: covered_b.add(jc.b_id)

    # A claim the judge marked contradicted but never listed as a conflict
    for i, claim in enumerate(a.claims, start=1):
        v = status.get(i)
        if v and v.status == "contradicted" and i not in covered_a and i not in soft_a:
            cb = _at(b.claims, v.b_ids[0] if v.b_ids else None)
            if lenient and _soft(claim, cb, source_of):
                differences.append(_conflict(
                    "Differing findings", claim, cb, "Judge marked this claim contradicted; the papers differ.", "judge"))
                soft_a.add(i)
                continue
            conflicts.append(_conflict("Conflicting findings", claim, cb, "Judge marked this claim contradicted.", "judge"))
            covered_a.add(i)

    # Numeric mismatches the judge missed (or called "agreed")
    for n in numeric:
        if (n.a_index + 1) in covered_a or (n.b_index + 1) in covered_b:
            continue
        fmt = lambda vals: ", ".join(f"{x:g}" for x in vals)
        conflicts.append(_conflict(
            f"Values in {n.unit} differ",
            a.claims[n.a_index], b.claims[n.b_index],
            f"Model A cites {fmt(n.a_values)} {n.unit}; Model B cites {fmt(n.b_values)} {n.unit} from the same source passage.",
            "numeric",
        ))
        covered_a.add(n.a_index + 1)

    # Papers that disagree with each other (even when both models report both findings)
    for sc in source_conflicts(a.claims + b.claims, source_of or {}):
        fmt = lambda vals: ", ".join(f"{x:g}" for x in vals)
        (differences if lenient else conflicts).append(_conflict(
            f"Sources report different values ({sc.unit})", sc.first, sc.second,
            f"One source reports {fmt(sc.first_values)} {sc.unit}; another reports {fmt(sc.second_values)} {sc.unit}.",
            "sources",
        ))

    if conflicts:
        return "disagreement", "conflicting_claims", [], _summary("conflicting_claims", conflicts, a, b), differences

    # Agreed: the judge matched the claims, or both models quote the same sentence of the same passage.
    pairs = {i: set(v.b_ids) for i, v in status.items() if v.status == "agreed"}
    for i, ca in enumerate(a.claims, start=1):
        for j, cb in enumerate(b.claims, start=1):
            if same_passage(ca, cb):
                pairs.setdefault(i, set()).add(j)
    agreed = set(pairs)
    matched_b = {bid for ids in pairs.values() for bid in ids}
    # Nothing contradicts: every claim shown passed citation verification. Claims both models made are
    # "confirmed"; claims only one model made are shown but flagged as single-model.
    final = [
        FinalClaim(c.text, c.chunk_ids, c.quote, c.conditions, confirmed=(i in agreed),
                   match_kind=c.match_kind, match_score=c.match_score, seals=c.seals)
        for i, c in enumerate(a.claims, start=1)
    ] + [
        FinalClaim(c.text, c.chunk_ids, c.quote, c.conditions, confirmed=False,
                   match_kind=c.match_kind, match_score=c.match_score, seals=c.seals)
        for i, c in enumerate(b.claims, start=1) if i not in matched_b
    ]
    return "consensus", "models_agree" if agreed else "no_overlap", final, None, differences


def decide(
    a: ParsedAnswer, b: ParsedAnswer, verdict: JudgeVerdict, numeric: list[NumericConflict],
    source_of: dict | None = None,
) -> tuple[Kind, str, list[FinalClaim], dict | None]:
    """Strict decision (the original contract): kind, reason, claims, disagreement."""
    kind, reason, claims, disagreement, _ = decide_full(a, b, verdict, numeric, source_of, lenient=False)
    return kind, reason, claims, disagreement


# ---- lenient cross-check and the judge statement ---------------------------------

NUMBER_RE = re.compile(r"\d+(?:[.,]\d+)?")
MAX_JUDGE_STATEMENT = 600


def _soft(ca: Claim | None, cb: Claim | None, source_of: dict) -> bool:
    """A difference, not a disagreement: both claims passed verification and either cite different papers, or state the
    same text under different conditions. Two claims from the same paper that conflict stay a disagreement."""
    if ca is None or cb is None:
        return False
    papers_a = {source_of.get(cid, str(cid)) for cid in ca.chunk_ids}
    papers_b = {source_of.get(cid, str(cid)) for cid in cb.chunk_ids}
    if not papers_a & papers_b:
        return True
    same_text = normalize(ca.text).lower() == normalize(cb.text).lower()
    return same_text and (ca.conditions or "").strip().lower() != (cb.conditions or "").strip().lower()


def _numbers(text: str) -> set[str]:
    return {m.replace(",", ".") for m in NUMBER_RE.findall(text)}


def build_statement(
    kind: Kind, claims: list[FinalClaim], differences: list[dict], disagreement: dict | None,
    judge_text: str = "", reason: str = "",
) -> str:
    """The closing statement. Built from counts and claims; the judge's own wording is used only when it is short and
    introduces no number that is absent from the claims, quotes and differences shown above."""
    if kind == "insufficient_evidence":
        return "The sources do not contain a verified answer to this question."
    if kind == "disagreement":
        topics = [c["topic"] for c in (disagreement or {}).get("conflicts", [])]
        text = "The models disagree, so no single answer is given."
        if topics:
            text += " Points of conflict: " + "; ".join(topics) + "."
    else:
        n = len(claims)
        confirmed = sum(c.confirmed for c in claims)
        text = (f"{n} finding{'s' if n != 1 else ''} verified against the source text; {confirmed} confirmed by both "
                f"models, {n - confirmed} from one model only. Every quote was checked against its source.")
        if reason.endswith("_insufficient"):
            who = "Model A" if reason.startswith("model_a") else "Model B"
            text += f" {who} found the sources insufficient, so these findings come from one model only."
        if differences:
            text += (" Points where the sources or conditions differ, each shown with its own citation: "
                     + "; ".join(d["topic"] for d in differences) + ".")
    judge_text = (judge_text or "").strip()
    if judge_text and len(judge_text) <= MAX_JUDGE_STATEMENT:
        allowed = _numbers(text) | _numbers(str(disagreement or {})) | _numbers(str(differences))
        for c in claims:
            allowed |= _numbers(f"{c.text} {c.quote} {c.conditions or ''}")
        if _numbers(judge_text) <= allowed:
            return judge_text
    return text


# ---- the public entry point -----------------------------------------------------

async def run_dual(
    question: str,
    chunks: list[ContextChunk],
    llm_a: LLM,
    llm_b: LLM,
    judge: LLM | None = None,
    verify: VerifyConfig | None = None,
    lenient: bool = False,
) -> DualResult:
    if not chunks:
        return DualResult("insufficient_evidence", "no_source_chunks")

    user, alias_map = build_user_prompt(question, chunks)
    cfg = verify or VerifyConfig()

    async def answer(llm: LLM, system: str, prompt: str):
        # Verify BEFORE the cross-check: a fabricated claim must never create a fake
        # consensus or a fake disagreement. Purged claims are removed here.
        parsed, raws, ms = await _timed_answer(llm, system, prompt, alias_map)
        parsed, checks, purged_all = verify_answer(parsed, chunks, cfg)
        return parsed, raws, ms, checks, purged_all

    # Independent and parallel: neither model sees the other's output.
    (pa, raws_a, ms_a, checks_a, purged_all_a), (pb, raws_b, ms_b, checks_b, purged_all_b) = await asyncio.gather(
        answer(llm_a, SYSTEM_A, user), answer(llm_b, SYSTEM_B, user))

    # One model found a verified answer in passages the other read as having none: the other gets one second look
    # at the same passages (never at the first model's answer). Only if it still finds nothing is it a disagreement.
    # If the second look itself fails (provider error, invalid output), the first reply stands.
    if (pa.status == ANSWERED) != (pb.status == ANSWERED):
        try:
            if pa.status == ANSWERED:
                pb, more, ms, checks_b, purged_all_b = await answer(llm_b, SYSTEM_B, user + SECOND_LOOK)
                raws_b, ms_b = raws_b + more, ms_b + ms
            else:
                pa, more, ms, checks_a, purged_all_a = await answer(llm_a, SYSTEM_A, user + SECOND_LOOK)
                raws_a, ms_a = raws_a + more, ms_a + ms
        except CrossCheckFailed:
            pass
    rec_a = _record(llm_a, pa, raws_a, ms_a, sum(not c.verified for c in checks_a))
    rec_b = _record(llm_b, pb, raws_b, ms_b, sum(not c.verified for c in checks_b))
    checks = {"model_a": checks_a, "model_b": checks_b}

    def result(kind: Kind, reason: str, claims=None, disagreement=None, judge_rec=None,
               differences=None, judge_text: str = "") -> DualResult:
        statement = build_statement(kind, claims or [], differences or [], disagreement, judge_text, reason)
        return DualResult(kind, reason, claims or [], disagreement, rec_a, rec_b, judge_rec or {}, checks,
                          statement=statement, differences=differences or [])

    a_ok, b_ok = pa.status == ANSWERED, pb.status == ANSWERED
    if not a_ok and not b_ok:
        return result(
            "insufficient_evidence",
            "no_verifiable_claims" if (purged_all_a or purged_all_b) else "both_models_insufficient",
        )
    if a_ok != b_ok:
        who = "model_b" if a_ok else "model_a"
        unverifiable = purged_all_b if a_ok else purged_all_a
        reason = f"{who}_unverifiable" if unverifiable else f"{who}_insufficient"
        answered = pa if a_ok else pb
        if lenient and not unverifiable and answered.claims:
            # One model has verified claims; the other found nothing even after the second look. The verified claims are
            # shown as single-model findings, not as a disagreement.
            single = [FinalClaim(c.text, c.chunk_ids, c.quote, c.conditions, confirmed=False,
                                 match_kind=c.match_kind, match_score=c.match_score, seals=c.seals)
                      for c in answered.claims]
            return result("consensus", reason, single)
        why = ("had no claim that survived citation verification" if unverifiable
               else "found insufficient evidence in the sources")
        conflict = _conflict(
            "Whether the sources support an answer",
            answered.claims[0] if a_ok else None, answered.claims[0] if b_ok else None,
            f"{who} {why}; the other model did not.", "status",
        )
        return result("disagreement", reason, disagreement=_summary(reason, [conflict], pa, pb))

    verdict, raws_j = await _call(
        judge or llm_b, SYSTEM_JUDGE, build_judge_prompt(question, pa.claims, pb.claims), parse_verdict
    )
    kind, reason, claims, disagreement, differences = decide_full(
        pa, pb, verdict, numeric_conflicts(pa.claims, pb.claims), {c.chunk_id: c.label for c in chunks}, lenient=lenient)
    return result(kind, reason, claims, disagreement, {"verdict": verdict.model_dump(), "raw": raws_j},
                  differences=differences, judge_text=verdict.statement)
