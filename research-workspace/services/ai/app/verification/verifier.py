"""Deterministic citation verification. No model is involved: every claim a model
makes is checked against the stored chunk text, and anything that fails is purged.

Order of checks per claim (first failure purges the claim):
  quote_too_short -> chunk_not_allowed -> unsealed / hash_mismatch (SHA-256 of the
  chunk text vs the sealed hash) -> quote_not_found (exact -> normalised -> fuzzy)
  -> ungrounded_number:<n> -> weak_support
"""
import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from uuid import UUID

from ..ingest.chunking import sha256_hex
from ..orchestration.schema import ANSWERED, INSUFFICIENT, Claim, ContextChunk, ParsedAnswer
from .text import content_stems, context_of, normalize, numbers_in, semantic_problem, support, tokens

_ELLIPSIS = re.compile(r"\[\s*(?:\.\.\.|…)\s*\]|\.\.\.|…")
# Dropping any of these from a fuzzy match would flip a claim's meaning.
_NEGATORS = frozenset({"not", "no", "never", "without", "neither", "nor", "cannot", "none", "t"})


@dataclass
class VerifyConfig:
    fuzzy_threshold: float = 0.9
    min_quote_tokens: int = 3
    min_support: float = 0.7
    strict_numbers: bool = True
    guards: bool = True            # negation / direction / unit / quantifier checks


@dataclass
class ClaimCheck:
    index: int                      # 1-based position in the model's original answer
    verified: bool
    reason: str                     # "ok" or the purge reason
    match_kind: str | None          # exact | normalized | fuzzy
    match_score: float
    claim_text: str
    quote: str
    chunk_ids: list[UUID] = field(default_factory=list)


def _segments(quote: str) -> list[str]:
    return [s.strip() for s in _ELLIPSIS.split(quote) if s.strip()]


def _find_in_order(segs: list[str], hay: str) -> bool:
    pos = 0
    for s in segs:
        i = hay.find(s, pos)
        if i < 0:
            return False
        pos = i + len(s)
    return True


def _neg_count(toks: list[str]) -> int:
    return sum(1 for t in toks if t in _NEGATORS)


def _fuzzy_segment(seg_toks: list[str], hay: list[str], start: int, thr: float):
    """Best token window at/after `start` for one segment; numbers and negations
    must match exactly. Returns (score, end_index) or None."""
    n = len(seg_toks)
    seg_nums = numbers_in(" ".join(seg_toks))
    seg_neg = _neg_count(seg_toks)
    best = None
    for size in {max(1, n - 1), n, n + 1}:
        for i in range(start, len(hay) - size + 1):
            win = hay[i:i + size]
            if _neg_count(win) != seg_neg:
                continue
            ratio = SequenceMatcher(None, seg_toks, win, autojunk=False).ratio()
            if ratio < thr or (best and ratio <= best[0]):
                continue
            if numbers_in(" ".join(win)) != seg_nums:
                continue
            best = (ratio, i + size)
    return best


def match_quote(quote: str, text: str, cfg: VerifyConfig) -> tuple[str, float] | None:
    """Find `quote` (ellipsis-separated, ordered segments) inside one chunk's text.
    Returns (kind, score) or None."""
    segs = _segments(quote)
    if not segs:
        return None
    if _find_in_order(segs, text):
        return "exact", 1.0
    ntext = normalize(text).lower()
    nsegs = [normalize(s).lower() for s in segs]
    if _find_in_order(nsegs, ntext):
        return "normalized", 1.0
    hay = tokens(normalize(text))
    hay = [t.lower() for t in hay]
    pos, scores = 0, []
    for s in nsegs:
        st = tokens(s)
        if not st:
            return None
        m = _fuzzy_segment(st, hay, pos, cfg.fuzzy_threshold)
        if not m:
            return None
        scores.append(m[0])
        pos = m[1]
    return "fuzzy", round(min(scores), 4)


def _check(claim: Claim, index: int, chunks: dict[UUID, ContextChunk], cfg: VerifyConfig) -> ClaimCheck:
    def out(ok: bool, reason: str, kind=None, score=0.0) -> ClaimCheck:
        return ClaimCheck(index, ok, reason, kind, score, claim.text, claim.quote, list(claim.chunk_ids))

    segs = _segments(claim.quote)
    qtoks = [t for s in segs for t in tokens(s)]
    if len(qtoks) < cfg.min_quote_tokens or any(len(tokens(s)) < 2 for s in segs):
        return out(False, "quote_too_short")

    cited = []
    for cid in claim.chunk_ids:
        ch = chunks.get(cid)
        if ch is None:
            return out(False, "chunk_not_allowed")
        cited.append(ch)

    for ch in cited:
        if not ch.sha256:
            return out(False, "unsealed")
        if sha256_hex(ch.text) != ch.sha256:
            return out(False, "hash_mismatch")

    best = None
    for ch in cited:
        m = match_quote(claim.quote, ch.text, cfg)
        if m and (best is None or m[1] > best[1]):
            best = m
    if best is None:
        return out(False, "quote_not_found")

    if cfg.strict_numbers:
        evidence = " ".join([c.text for c in cited] + [c.label for c in cited])
        missing = sorted(numbers_in(f"{claim.text} {claim.conditions or ''}", skip_one=True)
                         - numbers_in(evidence), key=lambda x: (len(x), x))
        if missing:
            return out(False, f"ungrounded_number:{missing[0]}", *best)

    context = context_of(segs, [c.text for c in cited])
    cs = content_stems(claim.text)
    ev = content_stems(f"{claim.quote} {context}")
    if cs and len(cs & ev) / len(cs) < cfg.min_support:
        return out(False, "weak_support", *best)

    if cfg.guards:
        problem = semantic_problem(claim.text, claim.quote, context, " ".join(c.text for c in cited))
        if problem:
            return out(False, problem, *best)

    return out(True, "ok", *best)


def verify_answer(
    parsed: ParsedAnswer, chunks: list[ContextChunk], cfg: VerifyConfig | None = None
) -> tuple[ParsedAnswer, list[ClaimCheck], bool]:
    """Verify every claim of an answered ParsedAnswer. Returns the answer with
    purged claims removed, all checks, and whether every claim was purged."""
    cfg = cfg or VerifyConfig()
    if parsed.status != ANSWERED:
        return parsed, [], False
    by_id = {c.chunk_id: c for c in chunks}
    checks = [_check(c, i, by_id, cfg) for i, c in enumerate(parsed.claims, start=1)]

    kept: list[Claim] = []
    issues = list(parsed.issues)
    for claim, chk in zip(parsed.claims, checks):
        if chk.verified:
            claim.verified, claim.match_kind, claim.match_score = True, chk.match_kind, chk.match_score
            claim.seals = {cid: by_id[cid].sha256 for cid in claim.chunk_ids}
            kept.append(claim)
        else:
            issues.append(f"claim {chk.index} purged: {chk.reason}")

    if not kept:
        issues.append("all claims failed verification")
        return ParsedAnswer(INSUFFICIENT, [], parsed.notes, issues), checks, True
    return ParsedAnswer(ANSWERED, kept, parsed.notes, issues), checks, False
