"""Deterministic numeric cross-check. In pharma/engineering a wrong figure is the
costly error, and a small judge model can miss it, so this runs independently."""
import re
from collections import defaultdict
from dataclasses import dataclass
from uuid import UUID

from .schema import Claim

# canonical unit -> spellings (matched case-sensitively, longest first)
_UNITS: dict[str, list[str]] = {
    # PDF extraction yields many degree-sign look-alikes (° º ˚ ◦). A bare "C"/"F"
    # after a number is treated as a temperature: in this domain that is almost
    # always right, and a false positive only surfaces a disagreement for review.
    "°C": [f"{d}{sp}C" for d in "°º˚◦" for sp in ("", " ")] + [
        "℃", "degrees Celsius", "degree Celsius", "degrees C", "deg C", "C"],
    "°F": [f"{d}{sp}F" for d in "°º˚◦" for sp in ("", " ")] + [
        "degrees Fahrenheit", "degrees F", "F"],
    "K": ["K"],
    "%": ["%", "percent"],
    "mg/mL": ["mg/mL", "mg/ml"],
    "µg/mL": ["µg/mL", "ug/mL", "μg/mL"],
    "ng/mL": ["ng/mL", "ng/ml"],
    "mg/kg": ["mg/kg"],
    "mg": ["mg"], "µg": ["µg", "ug", "μg"], "ng": ["ng"], "kg": ["kg"], "g": ["g"],
    "mL": ["mL", "ml"], "µL": ["µL", "uL", "μL"], "L": ["L"],
    "mM": ["mM"], "µM": ["µM", "uM", "μM"], "nM": ["nM"], "M": ["M"], "mol": ["mol"],
    "kDa": ["kDa"], "Da": ["Da"],
    "h": ["hours", "hour", "hrs", "hr", "h"],
    "min": ["minutes", "minute", "min"],
    "d": ["days", "day"], "wk": ["weeks", "week"],
    "mo": ["months", "month"], "yr": ["years", "year"],
    "bar": ["bar"], "psi": ["psi"], "kPa": ["kPa"], "MPa": ["MPa"], "Pa": ["Pa"],
    "rpm": ["rpm"], "Hz": ["Hz"],
    "mm": ["mm"], "cm": ["cm"], "nm": ["nm"], "µm": ["µm", "um", "μm"], "m": ["m"],
}
_CANON = {spell: canon for canon, spells in _UNITS.items() for spell in spells}
_UNIT_ALT = "|".join(re.escape(s) for s in sorted(_CANON, key=len, reverse=True))
_NUM = r"\d+(?:[.,]\d+)*"
_PAT = re.compile(
    rf"(?<![\w.])(?P<neg>[-−–]?)(?P<a>{_NUM})"
    rf"(?:\s*(?:[–—-]|to)\s*(?P<b>{_NUM}))?"
    rf"\s*(?P<unit>{_UNIT_ALT})(?![A-Za-z])"
)


def _num(s: str) -> float:
    if re.fullmatch(r"\d{1,3}(,\d{3})+", s):
        return float(s.replace(",", ""))
    return float(s.replace(",", "."))


def extract_quantities(text: str) -> dict[str, set[float]]:
    """{canonical unit: {values}}. Ranges contribute both endpoints."""
    out: dict[str, set[float]] = defaultdict(set)
    for m in _PAT.finditer(text):
        sign = -1.0 if m.group("neg") else 1.0
        unit = _CANON[m.group("unit")]
        out[unit].add(sign * _num(m.group("a")))
        if m.group("b"):
            out[unit].add(_num(m.group("b")))   # upper end of a range is positive
    return dict(out)


@dataclass
class NumericConflict:
    a_index: int            # 0-based index into A's claims
    b_index: int
    unit: str
    a_values: list[float]
    b_values: list[float]
    chunk_id: UUID


def _claim_text(c: Claim) -> str:
    # Claim text and its verbatim quote both carry figures.
    return f"{c.text} {c.quote}"


_WORD = re.compile(r"[^\W\d_]{4,}")


def _topic(c: Claim) -> set[str]:
    """Content words of a claim (4+ letters, numbers and units excluded): what the claim is about."""
    return {w.lower() for w in _WORD.findall(c.text)}


def _same_topic(x: Claim, y: Claim, min_overlap: float = 0.3) -> bool:
    tx, ty = _topic(x), _topic(y)
    return bool(tx and ty) and len(tx & ty) / len(tx | ty) >= min_overlap


def numeric_conflicts(a: list[Claim], b: list[Claim]) -> list[NumericConflict]:
    """For each pair of claims (one per model) that cite the same chunk AND are about the same thing:
    if their values in a unit are completely disjoint, they disagree. Overlap (one answer being more
    detailed) is not a conflict, and neither are numbers about different quantities
    ("above 90 C" vs "every 10 C rise")."""
    found: list[NumericConflict] = []
    for i, ca in enumerate(a):
        qa = extract_quantities(_claim_text(ca))
        for j, cb in enumerate(b):
            shared = sorted(set(ca.chunk_ids) & set(cb.chunk_ids), key=str)
            if not shared or not _same_topic(ca, cb):
                continue
            qb = extract_quantities(_claim_text(cb))
            for unit in qa.keys() & qb.keys():
                if qa[unit].isdisjoint(qb[unit]):
                    found.append(NumericConflict(
                        a_index=i, b_index=j, unit=unit,
                        a_values=sorted(qa[unit]), b_values=sorted(qb[unit]), chunk_id=shared[0],
                    ))
    return found


@dataclass
class SourceConflict:
    first: Claim            # two claims from DIFFERENT sources, about the same thing, with different values
    second: Claim
    unit: str
    first_values: list[float]
    second_values: list[float]


def source_conflicts(claims: list[Claim], source_of: dict[UUID, str]) -> list[SourceConflict]:
    """Papers that disagree with each other. Looks across every verified claim: if two claims cite
    different sources (by label), are about the same thing, and give completely different values in
    the same unit, report both so the user sees each finding with its source."""
    found: list[SourceConflict] = []
    seen: set[tuple[int, int]] = set()
    for i, x in enumerate(claims):
        qx = extract_quantities(_claim_text(x))
        sx = {source_of.get(c, str(c)) for c in x.chunk_ids}
        for j in range(i + 1, len(claims)):
            y = claims[j]
            sy = {source_of.get(c, str(c)) for c in y.chunk_ids}
            if sx & sy or not _same_topic(x, y):
                continue
            qy = extract_quantities(_claim_text(y))
            for unit in qx.keys() & qy.keys():
                if qx[unit].isdisjoint(qy[unit]) and (i, j) not in seen:
                    seen.add((i, j))
                    found.append(SourceConflict(x, y, unit, sorted(qx[unit]), sorted(qy[unit])))
    return found
