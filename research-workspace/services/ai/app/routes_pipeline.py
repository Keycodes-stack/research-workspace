"""Phase 11 - Innovation Pipeline. Stage gates are computed from the evidence, scores and lenses, never typed in.
Moving a concept needs a written reason; every decision (with the gate results at that moment) is appended to a log
that the database refuses to edit or delete. Gates can be overridden with an explicit flag, EXCEPT source integrity."""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field

from .access import project_for_user
from .auth import require_user
from .clients import get_pool
from .governance import audit
from .access import rank
from .routes_concepts import CRITERIA, DEPARTMENTS, concept_for_user, evidence_score, load_evidence

router = APIRouter(tags=["pipeline"])

FLOW = ["ideation", "evaluation", "validation", "pilot", "launched"]
# Thresholds are deliberate, visible policy. Change them here, not in the UI.
MIN_EVIDENCE = {"evaluation": 0, "validation": 40, "pilot": 60, "launched": 60}


async def _facts(pool, concept) -> dict:
    cid = concept["id"]
    ev = await load_evidence(pool, cid)
    es = evidence_score(ev)
    secs = {r["key"]: r["body"] for r in await pool.fetch("SELECT key, body FROM concept_sections WHERE concept_id=$1", cid)}
    scores = await pool.fetch("SELECT criterion, scorer, score FROM concept_scores WHERE concept_id=$1", cid)
    by_rater: dict = {}
    for s in scores:
        by_rater.setdefault(s["scorer"], {})[s["criterion"]] = s["score"]
    full_raters = [r for r, d in by_rater.items() if set(d) >= set(CRITERIA)]
    avg = lambda k: (lambda v: sum(v) / len(v) if v else 0)([s["score"] for s in scores if s["criterion"] == k])
    lens = {r["department"]: r["status"] for r in await pool.fetch("SELECT department, status FROM lens_runs WHERE concept_id=$1", cid)}
    return {"evidence": ev, "es": es, "secs": secs, "full_raters": len(full_raters), "avg": avg, "lens": lens,
            "status": concept["status"]}


def gates_for(target: str, f: dict) -> list[dict]:
    g = lambda name, ok, detail, hard=False: {"name": name, "passed": bool(ok), "detail": detail, "overridable": not hard}
    out = [g("source integrity", all(e["intact"] for e in f["evidence"]) and bool(f["evidence"]),
             f"{sum(not e['intact'] for e in f['evidence'])} changed source(s); {len(f['evidence'])} evidence rows", hard=True)]
    if target == "evaluation":
        out.append(g("concept is active", f["status"] == "active", "problem and hypothesis written and concept activated"))
    if target in ("validation", "pilot", "launched"):
        need = MIN_EVIDENCE[target]
        out.append(g(f"evidence score >= {need}", f["es"]["score"] >= need, f"evidence score is {f['es']['score']}"))
        out.append(g("scored on all four criteria by at least one person", f["full_raters"] >= 1, f"{f['full_raters']} complete rater(s)"))
    if target in ("pilot", "launched"):
        out.append(g("scored by at least two people", f["full_raters"] >= 2, f"{f['full_raters']} complete rater(s)"))
        out.append(g("all four department lenses reviewed", set(f["lens"]) >= set(DEPARTMENTS),
                     "generated: " + (", ".join(sorted(f["lens"])) or "none")))
    if target == "launched":
        out.append(g("feasibility and impact average >= 3", f["avg"]("feasibility") >= 3 and f["avg"]("impact") >= 3,
                     f"feasibility {f['avg']('feasibility'):.1f}, impact {f['avg']('impact'):.1f}"))
        out.append(g("risks section written", bool(f["secs"].get("risks", "").strip()), "author-written risks"))
    return out


def next_stage(stage: str) -> str | None:
    return FLOW[FLOW.index(stage) + 1] if stage in FLOW and stage != FLOW[-1] else None


@router.get("/concepts/{concept_id}/gates")
async def gates(concept_id: UUID, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    c = await concept_for_user(pool, concept_id, user)
    stage = await pool.fetchval("SELECT stage::text FROM concepts WHERE id=$1", concept_id)
    nxt = next_stage(stage)
    if not nxt:
        return {"stage": stage, "next": None, "gates": [], "ready": False}
    gs = gates_for(nxt, await _facts(pool, c))
    return {"stage": stage, "next": nxt, "gates": gs, "ready": all(x["passed"] for x in gs)}


class DecisionIn(BaseModel):
    action: Literal["advance", "park", "reject", "reopen"]
    reason: str = Field(min_length=10, max_length=2000)
    override: bool = False


@router.post("/concepts/{concept_id}/decisions", status_code=201)
async def decide(concept_id: UUID, body: DecisionIn, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    c = await concept_for_user(pool, concept_id, user, "lead_scientist")
    if body.override and rank(c["role"]) < rank("admin"):
        raise HTTPException(403, {"error": "forbidden", "required_role": "admin", "your_role": c["role"],
                                  "note": "Only an admin or owner can override failed gates."})
    async with pool.acquire() as conn, conn.transaction():
        stage = await conn.fetchval("SELECT stage::text FROM concepts WHERE id=$1 FOR UPDATE", concept_id)
        gs, override_used = [], False
        if body.action == "advance":
            to = next_stage(stage)
            if not to:
                raise HTTPException(409, f"a concept in '{stage}' cannot advance")
            gs = gates_for(to, await _facts(pool, c))
            failed = [x for x in gs if not x["passed"]]
            hard = [x for x in failed if not x["overridable"]]
            if hard:
                raise HTTPException(409, {"error": "gate_failed", "gates": gs, "note": "Source integrity cannot be overridden."})
            if failed and not body.override:
                raise HTTPException(409, {"error": "gate_failed", "gates": gs})
            if failed and len(body.reason.strip()) < 30:
                raise HTTPException(422, "an override needs a reason of at least 30 characters")
            override_used = bool(failed)
        elif body.action in ("park", "reject"):
            if stage in ("launched", "parked", "rejected"):
                raise HTTPException(409, f"a concept in '{stage}' cannot be {body.action}ed")
            to = "parked" if body.action == "park" else "rejected"
        else:  # reopen
            if stage not in ("parked", "rejected"):
                raise HTTPException(409, "only parked or rejected concepts can be reopened")
            to = await conn.fetchval(
                """SELECT from_stage::text FROM pipeline_decisions WHERE concept_id=$1 AND to_stage=$2::pipeline_stage
                   ORDER BY created_at DESC, id LIMIT 1""", concept_id, stage) or "ideation"
        did = await conn.fetchval(
            """INSERT INTO pipeline_decisions (concept_id, action, from_stage, to_stage, reason, override, gates, decided_by)
               VALUES ($1,$2,$3::pipeline_stage,$4::pipeline_stage,$5,$6,$7::jsonb,$8) RETURNING id""",
            concept_id, body.action, stage, to, body.reason.strip(), override_used,
            __import__("json").dumps(gs), user)
        await conn.execute("UPDATE concepts SET stage=$2::pipeline_stage, updated_at=now() WHERE id=$1", concept_id, to)
    await audit(pool, c["project_id"], user, f"pipeline.{body.action}", "concept", concept_id,
                from_stage=stage, to_stage=to, override=override_used, reason=body.reason.strip())
    return {"id": did, "from": stage, "to": to, "override": override_used}


@router.get("/concepts/{concept_id}/decisions")
async def decisions(concept_id: UUID, user: UUID = Depends(require_user), pool=Depends(get_pool)):
    await concept_for_user(pool, concept_id, user)
    rows = await pool.fetch(
        """SELECT id, action, from_stage::text AS from_stage, to_stage::text AS to_stage, reason, override, gates,
                  decided_by, created_at FROM pipeline_decisions WHERE concept_id=$1 ORDER BY created_at, id""", concept_id)
    out = []
    for r in rows:
        d = dict(r)
        if isinstance(d["gates"], str):
            d["gates"] = __import__("json").loads(d["gates"])
        out.append(d)
    return jsonable_encoder({"decisions": out})


@router.get("/projects/{project_id}/pipeline")
async def board(project=Depends(project_for_user), pool=Depends(get_pool)):
    rows = await pool.fetch(
        """SELECT c.id, c.title, c.stage::text AS stage, c.status::text AS status,
                  (SELECT max(created_at) FROM pipeline_decisions d WHERE d.concept_id=c.id) AS last_decision
           FROM concepts c WHERE project_id=$1 ORDER BY c.updated_at DESC""", project["id"])
    stages = {s: [] for s in [*FLOW, "parked", "rejected"]}
    for r in rows:
        stages[r["stage"]].append(dict(r))
    return jsonable_encoder({"stages": stages, "order": [*FLOW, "parked", "rejected"]})
