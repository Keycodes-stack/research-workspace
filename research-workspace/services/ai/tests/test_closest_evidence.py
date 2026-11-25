"""Closest evidence: when nothing could be verified, the closest stored passages are still shown, labelled unverified."""
from types import SimpleNamespace
from uuid import uuid4

from app.evidence import fallback_items
from app.routes_tasks import related_passages


def hit(source, similarity, text="passage text"):
    return SimpleNamespace(chunk_id=uuid4(), source_id=source, similarity=similarity, text=text)


def test_one_passage_per_source_closest_first():
    a, b = uuid4(), uuid4()
    hits = [hit(a, 0.5), hit(a, 0.9), hit(b, 0.7)]
    picked = related_passages(hits)
    assert len(picked) == 2                                    # one per source
    assert picked[0] == hits[1].chunk_id                       # source a's closest passage comes first
    assert picked[1] == hits[2].chunk_id


def test_related_is_capped():
    hits = [hit(uuid4(), 0.5) for _ in range(20)]
    assert len(related_passages(hits, limit=6)) == 6


def test_no_hits_gives_no_related_passages():
    assert related_passages([]) == []


def test_fallback_items_are_pending_never_verified():
    chunk = uuid4()
    rows = fallback_items([{"chunk_id": chunk, "text": "Storage at 4 C\n  for twelve weeks.",
                            "source_id": uuid4(), "source_title": "Salt study"}])
    item = rows[0]
    assert item["status"] == "pending" and item["confirmed"] is False and item["found_by"] == []
    assert item["claim_text"].startswith("Closest passage, not verified: Storage at 4 C for twelve weeks.")
    assert item["chunk_ids"] == [chunk] and item["source_title"] == "Salt study"
    assert item["accessed_on"] is not None


def test_fallback_items_are_capped():
    passages = [{"chunk_id": uuid4(), "text": "x"} for _ in range(10)]
    assert len(fallback_items(passages, limit=4)) == 4
