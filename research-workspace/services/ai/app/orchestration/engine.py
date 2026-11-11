"""Dual-model orchestration: A and B answer independently and in parallel; B then
cross-checks; a deterministic numeric check backs the judge up. Fails closed:
if the cross-check cannot be completed, nothing is presented as an answer."""
import asyncio
import time
from dataclasses import asdict, dataclass, field
from typing import Callable, Literal
from uuid import UUID

from .llm import LLM, LLMError
from .numeric import NumericConflict, numeric_conflicts
from .prompts import (
    SYSTEM_A, SYSTEM_B, SYSTEM_JUDGE, build_judge_prompt, build_user_prompt,
)
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


def decide(
    a: ParsedAnswer, b: ParsedAnswer, verdict: JudgeVerdict, numeric: list[NumericConflict]
) -> tuple[Kind, str, list[FinalClaim], dict | None]:
    """Pure decision logic for two answered analysts (unit-testable without models)."""
    status = {v.id: v for v in verdict.a_claims}
    conflicts: list[dict] = []
    covered_a: set[int] = set()
    covered_b: set[int] = set()

    for jc in verdict.conflicts:
        ca, cb = _at(a.claims, jc.a_id), _at(b.claims, jc.b_id)
        conflicts.append(_conflict(jc.topic or "Conflicting findings", ca, cb, jc.explanation, "judge"))
        if ca: covered_a.add(jc.a_id)
        if cb: covered_b.add(jc.b_id)

    # A claim the judge marked contradicted but never listed as a conflict
    for i, claim in enumerate(a.claims, start=1):
        v = status.get(i)
        if v and v.status == "contradicted" and i not in covered_a:
            cb = _at(b.claims, v.b_ids[0] if v.b_ids else None)
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

    if conflicts:
        return "disagreement", "conflicting_claims", [], _summary("conflicting_claims", conflicts, a, b)

    agreed = {i for i, v in status.items() if v.status == "agreed"}
    if not agreed:
        return "disagreement", "no_overlap", [], _summary("no_overlap", [], a, b)

    final = [
        FinalClaim(c.text, c.chunk_ids, c.quote, c.conditions, confirmed=(i in agreed),
                   match_kind=c.match_kind, match_score=c.match_score, seals=c.seals)
        for i, c in enumerate(a.claims, start=1)
    ]
    return "consensus", "models_agree", final, None


# ---- the public entry point -----------------------------------------------------

async def run_dual(
    question: str,
    chunks: list[ContextChunk],
    llm_a: LLM,
    llm_b: LLM,
    judge: LLM | None = None,
    verify: VerifyConfig | None = None,
) -> DualResult:
    if not chunks:
        return DualResult("insufficient_evidence", "no_source_chunks")

    user, alias_map = build_user_prompt(question, chunks)

    # Independent and parallel: neither model sees the other's output.
    (pa, raws_a, ms_a), (pb, raws_b, ms_b) = await asyncio.gather(
        _timed_answer(llm_a, SYSTEM_A, user, alias_map),
        _timed_answer(llm_b, SYSTEM_B, user, alias_map),
    )
    # Verify BEFORE the cross-check: a fabricated claim must never create a fake
    # consensus or a fake disagreement. Purged claims are removed here.
    cfg = verify or VerifyConfig()
    pa, checks_a, purged_all_a = verify_answer(pa, chunks, cfg)
    pb, checks_b, purged_all_b = verify_answer(pb, chunks, cfg)
    rec_a = _record(llm_a, pa, raws_a, ms_a, sum(not c.verified for c in checks_a))
    rec_b = _record(llm_b, pb, raws_b, ms_b, sum(not c.verified for c in checks_b))
    checks = {"model_a": checks_a, "model_b": checks_b}

    def result(kind: Kind, reason: str, claims=None, disagreement=None, judge_rec=None) -> DualResult:
        return DualResult(kind, reason, claims or [], disagreement, rec_a, rec_b, judge_rec or {}, checks)

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
    kind, reason, claims, disagreement = decide(pa, pb, verdict, numeric_conflicts(pa.claims, pb.claims))
    return result(kind, reason, claims, disagreement, {"verdict": verdict.model_dump(), "raw": raws_j})
