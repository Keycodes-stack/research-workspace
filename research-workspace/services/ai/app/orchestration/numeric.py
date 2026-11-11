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


def numeric_conflicts(a: list[Claim], b: list[Claim]) -> list[NumericConflict]:
    """Per shared chunk and unit: if A's and B's values are completely disjoint,
    they disagree. Overlap (one answer being more detailed) is not a conflict."""
    found: list[NumericConflict] = []
    chunks = {cid for c in a for cid in c.chunk_ids} & {cid for c in b for cid in c.chunk_ids}
    for cid in sorted(chunks, key=str):
        side: dict[str, dict[str, set[float]]] = {"a": defaultdict(set), "b": defaultdict(set)}
        first: dict[str, dict[str, int]] = {"a": {}, "b": {}}
        for tag, claims in (("a", a), ("b", b)):
            for i, c in enumerate(claims):
                if cid not in c.chunk_ids:
                    continue
                for unit, vals in extract_quantities(_claim_text(c)).items():
                    side[tag][unit] |= vals
                    first[tag].setdefault(unit, i)
        for unit in side["a"].keys() & side["b"].keys():
            va, vb = side["a"][unit], side["b"][unit]
            if va.isdisjoint(vb):
                found.append(NumericConflict(
                    a_index=first["a"][unit], b_index=first["b"][unit], unit=unit,
                    a_values=sorted(va), b_values=sorted(vb), chunk_id=cid,
                ))
    return found
