"""Collects everything the Business Case report says, from STORED, VERIFIED data only.

No model is called. Before anything is printed, every cited passage is re-checked against the
live database: its SHA-256 must still match the seal it was verified under, and the quote must
still be found in it. Findings that fail are withheld and counted, never shown."""
import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from uuid import UUID

from pydantic import BaseModel, Field

from ..access import compute_lock_hash, task_sources
from ..ingest import store
from ..ingest.chunking import sha256_hex
from ..verification.verifier import VerifyConfig, match_quote
from .finance import FinancialInputs

WITHHELD = "withheld"


class ExportOptions(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    prepared_by: str | None = Field(default=None, max_length=200)
    organization: str | None = Field(default=None, max_length=200)
    message_ids: list[UUID] | None = None          # default: every answer in the session
    financial: FinancialInputs | None = None


@dataclass
class Cite:
    n: int
    chunk_id: str
    label: str
    title: str | None
    filename: str | None
    doi: str | None
    url: str | None
    page_start: int | None
    page_end: int | None
    line_start: int | None
    line_end: int | None
    quote: str
    sha256: str
    match_kind: str | None


@dataclass
class Finding:
    text: str
    conditions: str | None
    cite_ns: list[int]
    confirmed: bool = True


@dataclass
class Position:
    text: str
    conditions: str | None
    cite_ns: list[int]


@dataclass
class Conflict:
    topic: str
    explanation: str
    detected_by: str
    a: Position | None
    b: Position | None


@dataclass
class QA:
    question: str
    asked_at: datetime
    kind: str
    reason: str
    findings: list[Finding] = field(default_factory=list)
    conflicts: list[Conflict] = field(default_factory=list)
    single_a: list[Finding] = field(default_factory=list)
    single_b: list[Finding] = field(default_factory=list)
    verified: int = 0
    purged: int = 0
    top_similarity: float | None = None
    withheld: int = 0


@dataclass
class SourceRow:
    id: str
    title: str
    filename: str | None
    doi: str | None
    url: str | None
    year: int | None
    origin: str
    file_sha256: str | None
    cited: bool


@dataclass
class ReportData:
    title: str
    project_name: str
    mode: str
    task_title: str
    task_brief: str | None
    generated_at: datetime
    prepared_by: str | None
    organization: str | None
    qas: list[QA]
    cites: list[Cite]
    sources: list[SourceRow]
    metrics: dict
    approval: dict
    integrity: dict
    financial: FinancialInputs | None
    skipped_messages: int
    fingerprint: str
    thread_id: str


# ---------------------------------------------------------------------------------------------

def _chunk_ids(final: dict) -> set[str]:
    ids: set[str] = set()
    for c in final.get("claims", []):
        ids.update(c["chunk_ids"])
    d = final.get("disagreement") or {}
    for cl in (*d.get("model_a_claims", []), *d.get("model_b_claims", [])):
        ids.update(cl["chunk_ids"])
    for cf in d.get("conflicts", []):
        for pos in (cf.get("position_a"), cf.get("position_b")):
            if pos:
                ids.update(pos["chunk_ids"])
    return ids


class _Citer:
    """Numbers citations and re-verifies each (chunk, quote) pair once against live data."""

    def __init__(self, live: dict):
        self.live, self.cites, self._by_key, self._bad = live, [], {}, {}
        self.cfg = VerifyConfig()

    def check(self, chunk_id: str, quote: str, seal: str | None, match_kind: str | None) -> int | None:
        key = (chunk_id, quote)
        if key in self._by_key:
            return self._by_key[key]
        if key in self._bad:
            return None
        row = self.live.get(UUID(chunk_id))
        reason = None
        if row is None:
            reason = "passage no longer exists"
        elif sha256_hex(row["text"]) != row["sha256"]:
            reason = "passage text does not match its SHA-256"
        elif seal and seal != row["sha256"]:
            reason = "passage changed since it was verified"
        elif match_quote(quote, row["text"], self.cfg) is None:
            reason = "quote not found in passage"
        if reason:
            self._bad[key] = reason
            return None
        title = row["title"]
        label = title or row["filename"] or "untitled"
        n = len(self.cites) + 1
        self.cites.append(Cite(
            n, chunk_id, label, title, row["filename"], row["doi"], row["source_url"],
            row["page_start"], row["page_end"], row["line_start"], row["line_end"],
            quote, row["sha256"], match_kind))
        self._by_key[key] = n
        return n

    def many(self, ids: list[str], quote: str, seals: dict | None, match_kind: str | None) -> list[int] | None:
        out = []
        for cid in ids:
            n = self.check(cid, quote, (seals or {}).get(cid), match_kind)
            if n is None:
                return None
            out.append(n)
        return out

    @property
    def failures(self) -> list[str]:
        return list(self._bad.values())

    @property
    def checked(self) -> int:
        return len(self._by_key) + len(self._bad)


def _finding(c: dict, citer: _Citer, confirmed: bool | None = None) -> Finding | None:
    ns = citer.many(c["chunk_ids"], c["quote"], c.get("seals"), c.get("match_kind"))
    if ns is None:
        return None
    return Finding(c["text"], c.get("conditions"), ns, c.get("confirmed", True) if confirmed is None else confirmed)


def _position(p: dict | None, citer: _Citer) -> tuple[Position | None, bool]:
    """(position, withheld?)"""
    if not p:
        return None, False
    ns = citer.many(p["chunk_ids"], p["quote"], p.get("seals"), p.get("match_kind"))
    if ns is None:
        return None, True
    return Position(p["text"], p.get("conditions"), ns), False


def _build_qa(question: str, asked_at: datetime, msg, final: dict, citer: _Citer) -> QA:
    v = final.get("verification", {})
    qa = QA(question, asked_at, final["kind"], final["reason"], verified=v.get("verified", 0),
            purged=v.get("purged", 0), top_similarity=final.get("top_similarity"))
    for c in final.get("claims", []):
        f = _finding(c, citer)
        if f:
            qa.findings.append(f)
        else:
            qa.withheld += 1
    d = final.get("disagreement")
    if d:
        for cf in d.get("conflicts", []):
            a, wa = _position(cf.get("position_a"), citer)
            b, wb = _position(cf.get("position_b"), citer)
            qa.withheld += wa + wb
            if a or b:
                qa.conflicts.append(Conflict(cf.get("topic") or "Conflicting findings",
                                             cf.get("explanation", ""), cf.get("detected_by", ""), a, b))
        if not d.get("conflicts"):
            for key, dest in (("model_a_claims", qa.single_a), ("model_b_claims", qa.single_b)):
                for c in d.get(key, []):
                    f = _finding(c, citer, confirmed=False)
                    if f:
                        dest.append(f)
                    else:
                        qa.withheld += 1
    return qa


def _fingerprint(qas: list[QA], cites: list[Cite]) -> str:
    def default(o):
        return o.isoformat() if isinstance(o, datetime) else o.__dict__
    blob = json.dumps({"qas": qas, "cites": [(c.n, c.chunk_id, c.quote, c.sha256) for c in cites]},
                      default=default, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


async def collect_report(pool, thread_id: UUID, user: UUID, opts: ExportOptions, now: datetime | None = None) -> ReportData:
    from ..access import thread_for_user  # local import avoids a cycle at module load
    th = await thread_for_user(pool, thread_id, user, "lead_scientist")   # exports leave the system: lead scientist+
    task = await pool.fetchrow(
        """SELECT t.id, t.title, t.brief, t.status::text AS status, t.approved_by, t.approved_at,
                  t.created_at, t.source_lock_hash, p.name AS project_name, p.mode::text AS mode, p.owner_id
           FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id=$1""", th["task_id"])
    rows = await pool.fetch(
        """SELECT id, role::text AS role, content, created_at, model_b_raw -> 'final' AS final
           FROM messages WHERE thread_id=$1 ORDER BY created_at, id""", thread_id)

    # pair each stored answer with the question that preceded it
    pairs, skipped, last_q = [], 0, None
    for r in rows:
        if r["role"] == "user":
            last_q = r
        elif r["role"] == "assistant" and last_q is not None:
            if opts.message_ids and r["id"] not in opts.message_ids:
                continue
            final = r["final"]
            final = json.loads(final) if isinstance(final, str) else final
            if not final:
                skipped += 1
                continue
            pairs.append((last_q, r, final))

    ids: set[str] = set()
    for _, _, f in pairs:
        ids |= _chunk_ids(f)
    live = await store.fetch_chunks(pool, [UUID(i) for i in ids])
    citer = _Citer(live)
    qas = [_build_qa(q["content"], q["created_at"], m, f, citer) for q, m, f in pairs]

    # sources register: the approved set (or the whole project when none were selected)
    sel = await task_sources(pool, th["task_id"])
    ids_sel = [s["id"] for s in sel]
    if ids_sel:
        srows = await pool.fetch("SELECT * FROM sources WHERE id = ANY($1::uuid[]) ORDER BY created_at", ids_sel)
    else:
        srows = await pool.fetch("SELECT * FROM sources WHERE project_id=$1 ORDER BY created_at", th["project_id"])
    cited_src = {str(live[UUID(c.chunk_id)]["source_id"]) for c in citer.cites}
    sources = [SourceRow(str(s["id"]), s["title"], s["filename"], s["doi"], s["source_url"], s["year"],
                         s["origin"] if isinstance(s["origin"], str) else str(s["origin"]),
                         s["file_sha256"], str(s["id"]) in cited_src) for s in srows]

    lock_ok = None
    if task["source_lock_hash"]:
        lock_ok = compute_lock_hash(sel) == task["source_lock_hash"]
    approval = {
        "status": task["status"], "created_at": task["created_at"], "approved_by": task["approved_by"],
        "approved_at": task["approved_at"], "lock_hash": task["source_lock_hash"], "lock_ok": lock_ok,
        "n_sources": len(sources), "owner_id": task["owner_id"],
    }

    n_by_kind = {k: sum(1 for q in qas if q.kind == k) for k in ("consensus", "disagreement", "insufficient_evidence")}
    findings = [f for q in qas for f in q.findings]
    sims = [q.top_similarity for q in qas if q.top_similarity is not None]
    metrics = {
        "questions": len(qas), **n_by_kind,
        "findings": len(findings), "confirmed": sum(f.confirmed for f in findings),
        "model_claims_verified": sum(q.verified for q in qas), "model_claims_purged": sum(q.purged for q in qas),
        "citations": len(citer.cites), "sources_cited": len(cited_src), "sources_approved": len(sources),
        "avg_top_similarity": (sum(sims) / len(sims)) if sims else None,
        "withheld": sum(q.withheld for q in qas),
    }
    integrity = {"checked": citer.checked, "passed": len(citer.cites), "failed": citer.failures}

    return ReportData(
        title=opts.title or task["title"], project_name=task["project_name"], mode=task["mode"],
        task_title=task["title"], task_brief=task["brief"],
        generated_at=now or datetime.now(timezone.utc), prepared_by=opts.prepared_by,
        organization=opts.organization, qas=qas, cites=citer.cites, sources=sources, metrics=metrics,
        approval=approval, integrity=integrity, financial=opts.financial, skipped_messages=skipped,
        fingerprint=_fingerprint(qas, citer.cites), thread_id=str(thread_id))
