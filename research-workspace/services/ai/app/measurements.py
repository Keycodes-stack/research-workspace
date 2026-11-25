"""Measurements with units found in the evidence text: "480 °C", "32.4 cP", "$142k". Pure functions, no database.

A measurement is only as good as the text it came from, so every one keeps the evidence item it was found in."""
import re
from typing import Any

# Longer units first, so "mm" is not read as "m" and "mPa·s" is not read as "Pa".
_UNITS = ("mPa·s", "kJ/kg", "W/m·K", "kWh", "MWh", "kPa", "MPa", "cP", "°C", "°F", "MW", "kW", "J/g", "mm", "cm", "μm",
          "nm", "kg", "min", "bar", "%", "K", "m", "h")
_QUANTITY = re.compile(
    r"(?<![\w.])(?P<value>[-+]?\d+(?:[.,]\d+)?)\s?(?P<unit>" + "|".join(re.escape(u) for u in _UNITS) + r")(?!\w)")
_MONEY = re.compile(r"(?<!\w)(?P<unit>[$€£])\s?(?P<value>\d+(?:[.,]\d+)?)(?P<scale>k|M|bn)?(?!\w)")
_CURRENCY_SCALE = {"k": 1e3, "M": 1e6, "bn": 1e9}


def _number(text: str) -> float:
    return float(text.replace(",", "."))


def extract_measurements(text: str) -> list[dict[str, Any]]:
    """Every quantity with a unit in the text, in reading order. Each item: the text as written, the value, the unit."""
    found: list[tuple[int, dict[str, Any]]] = []
    for m in _QUANTITY.finditer(text or ""):
        found.append((m.start(), {"text": m.group(0), "value": _number(m.group("value")), "unit": m.group("unit")}))
    for m in _MONEY.finditer(text or ""):
        value = _number(m.group("value")) * _CURRENCY_SCALE.get(m.group("scale") or "", 1)
        found.append((m.start(), {"text": m.group(0), "value": value, "unit": m.group("unit")}))
    found.sort(key=lambda pair: pair[0])
    seen: set[str] = set()
    out = []
    for _, row in found:
        if row["text"] not in seen:          # the same figure twice in one item is listed once
            seen.add(row["text"])
            out.append(row)
    return out


def measurements_for(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Measurements for a list of evidence items (rows or dicts), each linked back to its evidence record."""
    out = []
    for item in items:
        source_text = " ".join(str(item.get(k) or "") for k in ("claim_text", "quote"))
        for row in extract_measurements(source_text):
            evidence_id = item.get("evidence_id") or (f"Evidence {int(item['seq']):03d}" if item.get("seq") else None)
            out.append({**row, "evidence_id": evidence_id,
                        "work_package_code": item.get("work_package_code"), "source_title": item.get("source_title")})
    return out
