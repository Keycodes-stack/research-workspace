"""Project setup: AI intake, AI assessment and the atomic create of a reviewed charter."""
import json

from app.orchestration.llm import LLMError
from app.routes_tasks import _clean_insights
from tests.fakes import ScriptedLLM, hdr


def pair(text=None, error=None):
    return ScriptedLLM("A", text or "", error=error), ScriptedLLM("B", text or "", error=error)


# ---- pure cleaning (no database needed) ------------------------------------

def test_insights_are_bounded_and_levels_are_normalised():
    raw = {
        "summary": "  Good plan  ", "recommendation": "Pilot first", "feasibility": 140,
        "stats": [{"label": "Feasibility", "value": "68%"}, {"label": "", "value": "x"}, "bad"],
        "risks": [
            {"risk": "Supplier delay", "likelihood": "very high", "impact": "HIGH", "mitigation": "dual source", "owner": "Ops"},
            {"risk": ""},
            "not a risk",
        ],
        "questions": ["Which sites?", "", 3],
        "nextSteps": ["Run the pilot"],
    }
    out = _clean_insights(raw, "model-x", "2026-11-22T00:00:00Z")
    assert out["summary"] == "Good plan"
    assert out["feasibility"] == 100
    assert out["stats"] == [{"label": "Feasibility", "value": "68%"}]
    assert [r["likelihood"] for r in out["risks"]] == ["Medium"]
    assert out["risks"][0]["impact"] == "High"
    assert len(out["risks"]) == 1
    assert out["questions"] == ["Which sites?", "3"]
    assert out["nextSteps"] == ["Run the pilot"]
    assert out["model"] == "model-x" and out["generatedAt"] == "2026-11-22T00:00:00Z"


def test_insights_from_garbage_still_have_the_full_shape():
    out = _clean_insights("not a dict", "m")
    assert out["feasibility"] == 50
    assert out["summary"] == "" and out["risks"] == [] and out["stats"] == []
    assert out["generatedAt"]  # filled in by the server


def test_non_finite_feasibility_falls_back_to_neutral():
    assert _clean_insights({"feasibility": float("nan")}, "m")["feasibility"] == 50
    assert _clean_insights({"feasibility": "high"}, "m")["feasibility"] == 50


# ---- routes (need the Postgres fixture; CI runs them) -----------------------

def test_intake_asks_first_then_finishes_without_more_questions(api):
    api.llms = pair(json.dumps({
        "patch": {"type": "Engineering & Validation", "objective": "Recover waste heat"},
        "reply": "Two quick questions.",
        "questions": [{"header": "Scope", "question": "Which sites?", "multi_select": False,
                       "options": [{"label": "Plant A"}, {"label": "Plant B"}]}],
        "done": False,
    }))
    first = api.post("/projects/intake", headers=hdr(), json={"mode": "start", "text": "Recover heat", "draft": {}})
    assert first.status_code == 200
    body = first.json()
    assert body["patch"]["objective"] == "Recover waste heat"
    # the assistant's own question is asked, along with the core questions (timeline, budget, outcome)
    questions = [q["question"] for q in body["questions"]]
    assert "Which sites?" in questions and body["done"] is False
    assert {q["header"] for q in body["questions"]} - {"Timeline", "Budget", "Expected outcome", "Scope"} == set()

    api.llms = pair(json.dumps({"patch": {"lead": "Sara"}, "reply": "Done.", "questions": [{"question": "more?"}], "done": False}))
    second = api.post("/projects/intake", headers=hdr(), json={
        "mode": "answer", "text": "Plant A", "draft": body["patch"], "asked": ["Which sites?"], "round": 1,
    })
    assert second.status_code == 200
    assert second.json()["questions"] == [] and second.json()["done"] is True


def test_insights_endpoint_returns_the_cleaned_assessment(api):
    api.llms = pair(json.dumps({"summary": "Viable", "feasibility": 72, "risks": [], "questions": ["Cost?"]}))
    r = api.post("/projects/insights", headers=hdr(), json={"draft": {"name": "Heat", "objective": "Recover heat"}})
    assert r.status_code == 200
    assert r.json()["feasibility"] == 72 and r.json()["questions"] == ["Cost?"]


def test_insights_failure_is_a_503_not_a_crash(api):
    api.llms = pair(error=LLMError("provider down"))
    r = api.post("/projects/insights", headers=hdr(), json={"draft": {"name": "Heat"}})
    assert r.status_code == 503


def test_complete_stores_charter_assessment_and_packages_together(api):
    api.llms = pair()
    body = {
        "name": "Heat recovery", "mode": "open_discovery",
        "meta": {"lead": "Sara", "priority": "High"},
        "charter": {"type": "Technical Feasibility", "objective": "Recover heat", "departments": ["Engineering"], "mode": "open_discovery"},
        "work_packages": [{"title": "Pilot study", "brief": "{}"}],
        "insights": {"summary": "Viable", "feasibility": 70, "stats": [], "risks": [], "questions": [],
                     "nextSteps": [], "model": "A", "generatedAt": "2026-11-22T00:00:00Z"},
    }
    r = api.post("/projects/complete", headers=hdr(), json=body)
    assert r.status_code == 201
    created = r.json()
    assert [w["title"] for w in created["work_packages"]] == ["Pilot study"]

    listed = api.get("/projects", headers=hdr()).json()["projects"]
    project = next(p for p in listed if p["id"] == created["id"])
    assert project["meta"]["charter"]["objective"] == "Recover heat"
    assert project["meta"]["insights"]["feasibility"] == 70
    assert project["meta"]["lead"] == "Sara"

    tasks = api.get(f"/projects/{created['id']}/tasks", headers=hdr()).json()["tasks"]
    assert [t["title"] for t in tasks] == ["Pilot study"]


def test_complete_without_insights_stores_no_assessment(api):
    api.llms = pair()
    r = api.post("/projects/complete", headers=hdr(), json={"name": "Plain", "mode": "closed_repository", "meta": {}, "charter": {"type": "Technical Feasibility", "objective": "Plain"}})
    assert r.status_code == 201
    listed = api.get("/projects", headers=hdr()).json()["projects"]
    project = next(p for p in listed if p["id"] == r.json()["id"])
    assert "insights" not in project["meta"]


# ---- research mode is detected, never asked -------------------------------

def test_research_mode_defaults_to_open_discovery():
    from app.routes_tasks import _detect_research_mode
    assert _detect_research_mode("Recover waste heat from plants", "", "{}") == "open_discovery"


def test_research_mode_is_closed_when_the_brief_says_approved_or_internal_only():
    from app.routes_tasks import _detect_research_mode
    assert _detect_research_mode("Use only approved sources for this study") == "closed_repository"
    assert _detect_research_mode("", "our confidential plant data") == "closed_repository"
    assert _detect_research_mode("Search the literature for hydrogen storage") == "open_discovery"


# ---- a slow main model hands over to the backup at once ----------------------

def test_project_setup_uses_backup_when_main_model_is_slow():
    import asyncio
    from app.routes_tasks import _complete_fast
    from app.orchestration.llm import FallbackLLM

    class Slow:
        name = "slow"
        async def complete(self, system, user):
            await asyncio.sleep(10)
            return "late"

    class Quick:
        name = "quick"
        async def complete(self, system, user):
            return '{"ok": true}'

    out = asyncio.run(_complete_fast(FallbackLLM(Slow(), Quick()), "sys", "user", seconds=0.05))
    assert out == '{"ok": true}'


def test_intake_uses_model_b_when_model_a_does_not_answer(api):
    from app.orchestration.llm import LLMError
    reply = json.dumps({"patch": {"objective": "Recover heat"}, "reply": "Drafted.", "questions": [], "done": True})
    api.llms = (ScriptedLLM("A", "", error=LLMError("A: no answer in 45s")), ScriptedLLM("B", reply))
    r = api.post("/projects/intake", headers=hdr(), json={"mode": "finish", "text": "Recover heat", "draft": {}})
    assert r.status_code == 200 and r.json()["patch"]["objective"] == "Recover heat"


def test_intake_says_what_happened_when_both_models_fail(api, monkeypatch):
    from app.config import get_settings
    from app.orchestration.llm import LLMError
    monkeypatch.setattr(get_settings(), "intake_rounds", 1)     # one round keeps the test quick
    api.llms = (ScriptedLLM("A", "", error=LLMError("A: no answer in 45s")),
                ScriptedLLM("B", "", error=LLMError("B: HTTP 429")))
    r = api.post("/projects/intake", headers=hdr(), json={"mode": "finish", "text": "Recover heat", "draft": {}})
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "setup_assistant_unavailable"
    assert "did not answer in time" in r.json()["error"]["message"]
