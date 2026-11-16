"""Per-model breakdown the UI shows when a user expands Model A / Model B (pure logic, no database)."""
from uuid import uuid4

from app.orchestration.engine import DualResult
from app.routes_tasks import _chunk_ids, _model_breakdown
from app.verification.verifier import ClaimCheck


def check(i, ok, text, cid, reason="ok", kind="exact", score=1.0, quote="q"):
    return ClaimCheck(index=i, verified=ok, reason=reason, match_kind=kind if ok else None,
                      match_score=score if ok else 0.0, claim_text=text, quote=quote, chunk_ids=[cid])


def test_breakdown_counts_and_lists_each_models_own_claims():
    c1, c2, c3 = uuid4(), uuid4(), uuid4()
    r = DualResult("consensus", "models_agree", checks={
        "model_a": [check(1, True, "A says x", c1), check(2, False, "A says y", c2, reason="quote_not_found")],
        "model_b": [check(1, True, "B says x", c3)],
    })
    m = _model_breakdown(r)
    assert (m["model_a"]["verified"], m["model_a"]["purged"]) == (1, 1)
    assert (m["model_b"]["verified"], m["model_b"]["purged"]) == (1, 0)
    assert [c["text"] for c in m["model_a"]["claims"]] == ["A says x", "A says y"]
    purged = m["model_a"]["claims"][1]
    assert purged["verified"] is False and purged["reason"] == "quote_not_found"
    assert m["model_b"]["claims"][0]["chunk_ids"] == [c3]


def test_breakdown_is_empty_when_no_model_ran():
    assert _model_breakdown(DualResult("insufficient_evidence", "below_similarity_threshold")) == {}


def test_chunks_cited_only_by_a_purged_or_unconfirmed_claim_are_still_shipped_to_the_ui():
    only_b = uuid4()
    r = DualResult("consensus", "models_agree", checks={"model_a": [], "model_b": [check(1, False, "B", only_b)]})
    assert only_b in _chunk_ids(r)
