"""Hierarchy of Evidence: authority, recency, conditions match.

Deterministic and explainable. Every paper keeps a score_breakdown so the UI
can show why it ranked where it did.
"""
import math
from datetime import date

from .models import DiscoveryQuery, Paper

WEIGHTS = {"authority": 0.4, "recency": 0.3, "conditions": 0.3}
AUTHORITY_CAP = 500      # 500+ citations = full authority score
RECENCY_HORIZON = 20     # papers 20+ years old score 0 on recency


def authority_score(cited_by: int) -> float:
    return min(1.0, math.log10(1 + max(cited_by, 0)) / math.log10(1 + AUTHORITY_CAP))


def recency_score(year: int | None, now_year: int) -> float:
    if year is None:
        return 0.0
    return max(0.0, 1.0 - max(0, now_year - year) / RECENCY_HORIZON)


def _text(p: Paper) -> str:
    return f"{p.title} {p.abstract or ''}".lower()


def condition_score(p: Paper, required: list[str]) -> float:
    """Fraction of required condition terms mentioned. Neutral (1.0) if none given."""
    if not required:
        return 1.0
    text = _text(p)
    return sum(t.lower() in text for t in required) / len(required)


def rank(
    papers: list[Paper], q: DiscoveryQuery, now_year: int | None = None
) -> tuple[list[Paper], list[tuple[Paper, str]]]:
    """Score, filter and sort. Returns (ranked, dropped_with_reason)."""
    now_year = now_year or date.today().year
    ranked: list[Paper] = []
    dropped: list[tuple[Paper, str]] = []

    for p in papers:
        text = _text(p)
        hit = next((t for t in q.exclude_terms if t.lower() in text), None)
        if hit:
            dropped.append((p, f"excluded_condition:{hit}"))
            continue

        cond = condition_score(p, q.required_terms)
        if q.required_terms and cond == 0.0:
            dropped.append((p, "condition_mismatch"))
            continue

        parts = {
            "authority": authority_score(p.cited_by_count),
            "recency": recency_score(p.year, now_year),
            "conditions": cond,
        }
        p.score_breakdown = parts
        p.score = round(sum(WEIGHTS[k] * v for k, v in parts.items()), 4)
        ranked.append(p)

    ranked.sort(key=lambda p: (p.score, p.cited_by_count), reverse=True)
    return ranked, dropped
