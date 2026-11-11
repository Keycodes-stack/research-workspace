"""Phase 10 - Concept Builder, scoring rubric and department lenses.
Rules: brief sections are written by people; models only contribute verified, quoted statements (evidence and lenses).
The evidence score is deterministic; the four rubric criteria are human judgements. They are never blended."""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field

from .access import check_role, project_for_user, project_with
from .auth import require_user
from .clients import get_pool
from .config import get_settings
from .governance import Meter, audit, check_budget
from .realtime import notify
from .deps import get_embedder, get_llms
from .orchestration.engine import CrossCheckFailed
from .synth import chunks_by_ids, evidence_intact, project_chunks, verified_items

router = APIRouter(tags=["concepts"])

SECTIONS = ("problem", "hypothesis", "approach", "risks", "next_steps")
CRITERIA = ("novelty", "feasibility", "impact", "evidence_strength")
DEPARTMENTS = {
    "rnd": ("technical feasibility experimental method materials conditions limitations",
            "From the chunks, list up to 5 statements relevant to R&D: technical feasibility, methods, materials, "
            "operating conditions, limitations or required experiments for this concept."),
    "finance": ("cost price savings revenue market size investment budget",
                "From the chunks, list up to 5 statements about COSTS, PRICES, SAVINGS, MARKET SIZE or INVESTMENT that the "
                "chunks state explicitly. Never calculate, estimate or infer a figure. If no figure is stated, return insufficient_source_evidence."),
    "marketing": ("customer need market segment positioning competitors demand adoption",
                  "From the chunks, list up to 5 statements about customer needs, segments, competitors, demand or adoption that the chunks state."),
    "legal": ("regulatory approval compliance safety patent liability standard guideline",
              "From the chunks, list up to 5 statements about regulation, approval, safety, standards, patents or liability that the chunks state."),
}


async def concept_for_user(pool, concept_id: UUID, user: UUID, minimum: str = "viewer"):
    row = await pool.fetchrow(
        """SELECT c.id, c.project_id, c.title, c.status::text AS status, c.created_by, c.created_at, m.role::text AS role
           FROM concepts c JOIN project_members m ON m.project_id = c.project_id AND m.user_id=$2 WHERE c.id=$1""",
        concept_id, user)
    check_role(row["role"] if row else None, minimum, "concept")
    return row


class ConceptIn(BaseModel):
    title: str = Field(min_length=3, max_length=300)
    signal_ids: list[UUID] = Field(min_length=1, max_length=20)


@router.post("/projects/{project_id}/concepts", status_code=201)
async def create_concept(body: ConceptIn, project=Depends(project_with("researcher")), user: UUID = Depends(require_user),
                         pool=Depends(get_pool)):
    ids = list(dict.fromkeys(body.signal_ids))
    sigs = await pool.fetch(
        "SELECT id, text, status::text AS status FROM signals WHERE id = ANY($1::uuid[]) AND project_id=$2", ids, project["id"])
    if len(sigs) != len(ids):
        raise HTTPException(400, "unknown signal")
    bad = [str(s["id"]) for s in sigs if s["status"] in ("dismissed", "merged")]
    if bad:
        raise HTTPException(409, {"error": "inactive_signals", "signal_ids": bad})
    async with pool.acquire() as conn, conn.transaction():
        cid = await conn.fetchval(
            "INSERT INTO concepts (project_id, title, created_by) VALUES ($1,$2,$3) RETURNING id",
            project["id"], body.title.strip(), user)
        for key in SECTIONS:
            await conn.execute("INSERT INTO concept_sections (concept_id, key) VALUES ($1,$2)", cid, key)
        for s in sigs:
            await conn.execute("INSERT INTO concept_signals VALUES ($1,$2)", cid, s["id"])
            await conn.execute(
                """INSERT INTO concept_evidence (concept_id, signal_id, claim_text, chunk_id, quote, sha256, model)
                   SELECT $1, $2, $3, chunk_id, quote, sha256, model FROM signal_evidence WHERE signal_id=$2
                   ON CONFLICT DO NOTHING""", cid, s["id"], s["text"])
    await audit(pool, project["id"], user, "concept.create", "concept", cid, title=body.title.strip(), signals=len(ids))
    return {"id": cid, "title": body.title.strip()}


@router.get("/projects/{project_id}/concepts")
async def list_concepts(project=Depends(project_for_user), pool=Depends(get_pool)):
    rows = await pool.fetch(
        """SELECT id, title, status::text AS status, created_at,
                  (SELECT count(*) FROM concept_evidence e WHERE e.concept_id = c.id) AS evidence
           FROM concepts c WHERE project_id=$1 ORDER BY created_at DESC""", project["id"])
    return jsonable_encoder({"concepts": [dict(r) for r in rows]})


def evidence_score(items: list[dict]) -> dict:
    """Deterministic 0-100 from the evidence itself. 50 pts: distinct verified statements (cap 5);
    30 pts: distinct sources (cap 3); 20 pts: share of statements both models found. Intact evidence only."""
    ok = [i for i in items if i["intact"]]
    stmts = {i["claim_text"] for i in ok}
    sources = {i["source_id"] for i in ok}
    both = sum(1 for t in stmts if {i["model"] for i in ok if i["claim_text"] == t} >= {"model_a", "model_b"})
    score = round(50 * min(len(stmts), 5) / 5 + 30 * min(len(sources), 3) / 3 + (20 * both / len(stmts) if stmts else 0))
    return {"score": score, "statements": len(stmts), "sources": len(sources), "both_models": both,
            "excluded_changed_sources": len(items) - len(ok)}


async def load_evidence(pool, concept_id: UUID) -> list[dict]:
    ev = await pool.fetch(
        """SELECT e.id, e.signal_id, e.claim_text, e.chunk_id, e.quote, e.sha256 AS sealed, e.model,
                  ch.text AS chunk_text, ch.sha256 AS current, ch.page_start, ch.source_id,
                  COALESCE(s.title, s.filename, 'untitled') AS label
           FROM concept_evidence e JOIN chunks ch ON ch.id = e.chunk_id JOIN sources s ON s.id = ch.source_id
           WHERE e.concept_id=$1 ORDER BY e.claim_text""", concept_id)
    out = []
    for r in ev:
        d = dict(r)
        d["intact"] = evidence_intact(d["chunk_text"], d["quote"], d.pop("sealed"), d.pop("current"))
        out.append(d)
    return out


@router.get("/concepts/{concept_id}")
async def get_concept(concept_id: UUID, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    c = await concept_for_user(pool, concept_id, user)
    secs = await pool.fetch("SELECT key, body, version, updated_at FROM concept_sections WHERE concept_id=$1", concept_id)
    evidence = await load_evidence(pool, concept_id)
    scores = await pool.fetch(
        "SELECT criterion, scorer, score, note FROM concept_scores WHERE concept_id=$1", concept_id)
    human = {}
    for k in CRITERIA:
        vals = [s["score"] for s in scores if s["criterion"] == k]
        human[k] = {"average": round(sum(vals) / len(vals), 2) if vals else None, "raters": len(vals),
                    "mine": next((s["score"] for s in scores if s["criterion"] == k and s["scorer"] == user), None)}
    sig_ids = await pool.fetch("SELECT signal_id FROM concept_signals WHERE concept_id=$1", concept_id)
    return jsonable_encoder({
        **dict(c), "sections": {s["key"]: dict(s) for s in secs}, "signal_ids": [r["signal_id"] for r in sig_ids],
        "evidence": [{k: v for k, v in e.items() if k != "chunk_text"} | {"chunk_text": e["chunk_text"]} for e in evidence],
        "rubric": {"human": human, "evidence": evidence_score(evidence),
                   "note": "Human scores and the evidence score are reported separately and never averaged together."},
    })


class SectionIn(BaseModel):
    body: str = Field(max_length=20000)
    base_version: int = Field(ge=0)


@router.put("/concepts/{concept_id}/sections/{key}")
async def put_section(concept_id: UUID, key: Literal["problem", "hypothesis", "approach", "risks", "next_steps"],
                      body: SectionIn, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    await concept_for_user(pool, concept_id, user, "researcher")
    row = await pool.fetchrow(
        """UPDATE concept_sections SET body=$3, version=version+1, updated_by=$4, updated_at=now()
           WHERE concept_id=$1 AND key=$2 AND version=$5 RETURNING version, body""",
        concept_id, key, body.body, user, body.base_version)
    if not row:
        cur = await pool.fetchrow("SELECT body, version FROM concept_sections WHERE concept_id=$1 AND key=$2", concept_id, key)
        raise HTTPException(409, {"error": "version_conflict", "current": dict(cur)})
    await pool.execute("UPDATE concepts SET updated_at=now() WHERE id=$1", concept_id)
    await pool.execute("DELETE FROM section_locks WHERE concept_id=$1 AND section_key=$2 AND user_id=$3", concept_id, key, user)
    await notify(pool, concept_id, "section", key=key, version=row["version"], user=user)
    return {"key": key, "version": row["version"]}


class ScoreIn(BaseModel):
    criterion: Literal["novelty", "feasibility", "impact", "evidence_strength"]
    score: int = Field(ge=1, le=5)
    note: str | None = Field(None, max_length=1000)


@router.put("/concepts/{concept_id}/scores")
async def put_score(concept_id: UUID, body: ScoreIn, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    await concept_for_user(pool, concept_id, user, "researcher")
    await pool.execute(
        """INSERT INTO concept_scores (concept_id, criterion, scorer, score, note) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (concept_id, criterion, scorer) DO UPDATE SET score=$4, note=$5, updated_at=now()""",
        concept_id, body.criterion, user, body.score, body.note)
    return {"criterion": body.criterion, "score": body.score}


class StatusIn(BaseModel):
    status: Literal["draft", "active", "archived"]


@router.put("/concepts/{concept_id}/status")
async def put_status(concept_id: UUID, body: StatusIn, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    c = await concept_for_user(pool, concept_id, user, "researcher")
    if body.status == "active":
        filled = await pool.fetchval(
            "SELECT count(*) FROM concept_sections WHERE concept_id=$1 AND key IN ('problem','hypothesis') AND length(trim(body))>0", concept_id)
        if filled < 2:
            raise HTTPException(409, "write the problem and hypothesis sections before activating a concept")
    await pool.execute("UPDATE concepts SET status=$2::concept_status, updated_at=now() WHERE id=$1", c["id"], body.status)
    await audit(pool, c["project_id"], user, "concept.status", "concept", concept_id, status=body.status)
    return {"status": body.status}


# ---- department lenses -----------------------------------------------------------------------------

class LensIn(BaseModel):
    departments: list[Literal["rnd", "finance", "marketing", "legal"]] = list(DEPARTMENTS)


@router.post("/concepts/{concept_id}/lenses/generate")
async def generate_lenses(concept_id: UUID, body: LensIn, user: UUID = Depends(require_user), pool=Depends(get_pool),
                          embedder=Depends(get_embedder), llms=Depends(get_llms)):
    c = await concept_for_user(pool, concept_id, user, "researcher")
    cfg = get_settings()
    meter = Meter(llms)
    ev_ids = [r["chunk_id"] for r in await pool.fetch("SELECT DISTINCT chunk_id FROM concept_evidence WHERE concept_id=$1", concept_id)]
    base, base_src = await chunks_by_ids(pool, ev_ids)
    results = {}
    for dep in dict.fromkeys(body.departments):
        query, task = DEPARTMENTS[dep]
        found, fsrc, top = await project_chunks(pool, embedder, c["project_id"], [f"{c['title']} {query}"], 5)
        seen = {x.chunk_id for x in base}
        chunks = base + [x for x in found if x.chunk_id not in seen]
        src = {**fsrc, **base_src}
        if not chunks:
            status, items = "no_evidence", []
        elif top is not None and top < cfg.similarity_threshold and not base:
            status, items = "below_similarity_threshold", []
        else:
            await check_budget(pool, c["project_id"])
            try:
                items = await verified_items(f"Concept: {c['title']}. Department lens: {dep}.", task, chunks, src, meter.llms)
            except CrossCheckFailed as e:
                await meter.record(pool, c["project_id"], user, "lens")
                raise HTTPException(503, {"error": "models_unavailable", "detail": str(e)})
            status = "ok" if items else "no_evidence"
        async with pool.acquire() as conn, conn.transaction():
            await conn.execute("DELETE FROM lens_items WHERE concept_id=$1 AND department=$2", concept_id, dep)
            for it in items:
                for e in it.evidence:
                    await conn.execute(
                        """INSERT INTO lens_items (concept_id, department, text, chunk_id, quote, sha256, model, match_kind)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)""",
                        concept_id, dep, it.text, e["chunk_id"], e["quote"], e["sha256"], e["model"], e["match_kind"])
            await conn.execute(
                """INSERT INTO lens_runs (concept_id, department, status) VALUES ($1,$2,$3)
                   ON CONFLICT (concept_id, department) DO UPDATE SET status=$3, generated_at=now()""",
                concept_id, dep, status)
        results[dep] = {"status": status, "statements": len(items)}
    await meter.record(pool, c["project_id"], user, "lens")
    await audit(pool, c["project_id"], user, "concept.lenses", "concept", concept_id, departments=list(results))
    return results


@router.get("/concepts/{concept_id}/lenses")
async def get_lenses(concept_id: UUID, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    await concept_for_user(pool, concept_id, user)
    runs = {r["department"]: dict(r) for r in await pool.fetch(
        "SELECT department, status, generated_at FROM lens_runs WHERE concept_id=$1", concept_id)}
    rows = await pool.fetch(
        """SELECT l.id, l.department, l.text, l.quote, l.model, l.sha256 AS sealed, ch.sha256 AS current, ch.text AS chunk_text,
                  ch.page_start, COALESCE(s.title, s.filename, 'untitled') AS label
           FROM lens_items l JOIN chunks ch ON ch.id = l.chunk_id JOIN sources s ON s.id = ch.source_id
           WHERE l.concept_id=$1 ORDER BY l.department, l.text""", concept_id)
    out = {d: {"status": runs.get(d, {}).get("status", "not_generated"), "items": []} for d in DEPARTMENTS}
    grouped: dict = {}
    for r in rows:
        d = dict(r)
        d["intact"] = evidence_intact(d.pop("chunk_text"), d["quote"], d.pop("sealed"), d.pop("current"))
        g = grouped.setdefault((d["department"], d["text"]), {"text": d["text"], "evidence": [], "models": set()})
        g["evidence"].append({k: d[k] for k in ("quote", "label", "page_start", "model", "intact")})
        g["models"].add(d["model"])
    for (dep, _), g in grouped.items():
        g["models_agree"] = len(g.pop("models")) >= 2
        out[dep]["items"].append(g)
    return jsonable_encoder(out)
