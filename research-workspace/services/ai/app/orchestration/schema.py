"""Structured model output: robust JSON extraction, validation, and mapping the
short chunk aliases (C1, C2...) the models see back to real chunk UUIDs."""
import json
import re
from dataclasses import dataclass, field
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ValidationError, field_validator

ANSWERED = "answered"
INSUFFICIENT = "insufficient_source_evidence"
ALIAS_RE = re.compile(r"C\s*(\d+)", re.IGNORECASE)


class ParseError(Exception):
    """Model output was not valid JSON of the expected shape."""


@dataclass
class ContextChunk:
    chunk_id: UUID
    text: str
    label: str                     # e.g. "Smith 2024, doi:10.1/x" or the uploaded filename
    page_start: int | None = None
    page_end: int | None = None
    sha256: str = ""               # sealed hash of `text`; empty means unsealed (fails verification)


# ---- JSON extraction -------------------------------------------------------

def extract_json(text: str) -> dict:
    """Pull one JSON object out of a model reply (tolerates code fences and
    leading/trailing chatter)."""
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t, flags=re.IGNORECASE)
    try:
        obj = json.loads(t)
    except ValueError:
        start = t.find("{")
        if start < 0:
            raise ParseError("no JSON object found")
        try:
            obj, _ = json.JSONDecoder().raw_decode(t[start:])
        except ValueError as e:
            raise ParseError(f"invalid JSON: {e}") from e
    if not isinstance(obj, dict):
        raise ParseError("top-level JSON value must be an object")
    return obj


def _validation_message(e: ValidationError) -> str:
    err = e.errors()[0]
    loc = ".".join(str(p) for p in err["loc"])
    return f"{loc}: {err['msg']}"


# ---- answer schema ---------------------------------------------------------

class RawClaim(BaseModel):
    text: str = ""
    cites: list[str] = []
    quote: str = ""
    conditions: str | None = None

    @field_validator("cites", mode="before")
    @classmethod
    def _cites_list(cls, v):
        if v is None:
            return []
        return [v] if isinstance(v, str) else v


class RawAnswer(BaseModel):
    status: Literal["answered", "insufficient_source_evidence"]
    claims: list[RawClaim] = []
    notes: str | None = None


@dataclass
class Claim:
    text: str
    chunk_ids: list[UUID]
    aliases: list[str]
    quote: str
    conditions: str | None = None
    # Set by app.verification.verifier
    verified: bool = False
    match_kind: str | None = None
    match_score: float = 0.0
    seals: dict[UUID, str] = field(default_factory=dict)   # chunk_id -> sha256 at verification


@dataclass
class ParsedAnswer:
    status: str
    claims: list[Claim] = field(default_factory=list)
    notes: str | None = None
    issues: list[str] = field(default_factory=list)


def parse_answer(text: str, alias_map: dict[str, UUID]) -> ParsedAnswer:
    """Validate a model answer. Claims that cite nothing real, or give no quote,
    are dropped here (never shown); everything else is verified in Phase 5."""
    try:
        raw = RawAnswer.model_validate(extract_json(text))
    except ValidationError as e:
        raise ParseError(_validation_message(e)) from e

    if raw.status == INSUFFICIENT:
        return ParsedAnswer(status=INSUFFICIENT, notes=raw.notes)

    issues: list[str] = []
    claims: list[Claim] = []
    for i, c in enumerate(raw.claims, start=1):
        aliases: list[str] = []
        for ref in c.cites:
            m = ALIAS_RE.fullmatch(ref.strip().strip("[]()"))
            alias = f"C{int(m.group(1))}" if m else None
            if alias in alias_map:
                if alias not in aliases:
                    aliases.append(alias)
            else:
                issues.append(f"claim {i}: unknown citation {ref!r}")
        if not c.text.strip():
            issues.append(f"claim {i}: empty text")
        elif not aliases:
            issues.append(f"claim {i}: dropped, no valid citation")
        elif not c.quote.strip():
            issues.append(f"claim {i}: dropped, no supporting quote")
        else:
            claims.append(Claim(
                text=c.text.strip(), chunk_ids=[alias_map[a] for a in aliases],
                aliases=aliases, quote=c.quote.strip(), conditions=(c.conditions or None),
            ))

    if not claims:
        issues.append("no valid claims; treated as insufficient evidence")
        return ParsedAnswer(status=INSUFFICIENT, notes=raw.notes, issues=issues)
    return ParsedAnswer(status=ANSWERED, claims=claims, notes=raw.notes, issues=issues)


# ---- judge (cross-check) schema ---------------------------------------------

def _to_int(v):
    if isinstance(v, str):
        m = re.search(r"\d+", v)
        return int(m.group()) if m else v
    return v


class JudgeClaim(BaseModel):
    id: int
    status: Literal["agreed", "not_addressed", "contradicted"]
    b_ids: list[int] = []

    @field_validator("id", mode="before")
    @classmethod
    def _id(cls, v):
        return _to_int(v)

    @field_validator("b_ids", mode="before")
    @classmethod
    def _bids(cls, v):
        return [_to_int(x) for x in (v or [])]


class JudgeConflict(BaseModel):
    topic: str = ""
    a_id: int | None = None
    b_id: int | None = None
    explanation: str = ""

    @field_validator("a_id", "b_id", mode="before")
    @classmethod
    def _ids(cls, v):
        return None if v in (None, "") else _to_int(v)


class JudgeVerdict(BaseModel):
    a_claims: list[JudgeClaim] = []
    conflicts: list[JudgeConflict] = []


def parse_verdict(text: str) -> JudgeVerdict:
    try:
        return JudgeVerdict.model_validate(extract_json(text))
    except ValidationError as e:
        raise ParseError(_validation_message(e)) from e
