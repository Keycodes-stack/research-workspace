"""Chat work packages and the synced overview: pure functions, no database."""
import json
from types import SimpleNamespace
from uuid import uuid4

from app.chat_work_package import chat_items, chat_overview_doc
from app.evidence import REFERENCES_HEADING, FINDINGS_HEADING, findings_block, sync_sections
from app.word_export import validate_rich_document

SOURCE = str(uuid4())
CHUNK = str(uuid4())
CHUNKS = {CHUNK: {"label": "Smith 2024, doi:10.1/x", "source_id": SOURCE, "doi": "10.1/x",
                  "url": "https://doi.org/10.1/x", "origin": "openalex", "text": "Stable at 4 C for 12 weeks."}}


def answer(claims, related=(), models=None):
    return {"claims": claims, "chunks": CHUNKS, "related": list(related), "statement": "Stable for 12 weeks.",
            "models": models or {}}


def claim(text, confirmed, quote="stable at 4 C"):
    return {"text": text, "chunk_ids": [CHUNK], "quote": quote, "confirmed": confirmed}


def text_of(node):
    return "".join(c.get("text", "") for c in node.get("content") or [] if isinstance(c, dict))


def all_text(node) -> str:
    """Every piece of text under a node, including nested lists."""
    if node.get("type") == "text":
        return node.get("text", "")
    return " ".join(all_text(c) for c in node.get("content") or [] if isinstance(c, dict))


def test_confirmed_claims_are_verified_and_single_model_claims_pending():
    items = chat_items([answer([claim("Stable at 4 C", True), claim("Lasts 12 weeks", False)],
                               models={"model_a": {"claims": [{"text": "Stable at 4 C", "verified": True}]},
                                       "model_b": {"claims": [{"text": "Stable at 4 C", "verified": True}]}})])
    by_text = {i["claim_text"]: i for i in items}
    assert by_text["Stable at 4 C"]["status"] == "verified" and by_text["Stable at 4 C"]["confirmed"] is True
    assert by_text["Stable at 4 C"]["found_by"] == ["model_a", "model_b"]
    assert by_text["Lasts 12 weeks"]["status"] == "pending"


def test_the_same_claim_across_answers_is_listed_once():
    items = chat_items([answer([claim("Stable at 4 C", True)]), answer([claim("Stable at 4 C", True)])])
    assert len(items) == 1


def test_items_carry_their_source_and_link():
    item = chat_items([answer([claim("Stable at 4 C", True)])])[0]
    assert str(item["source_id"]) == SOURCE and item["source_title"] == "Smith 2024"
    assert item["doi"] == "10.1/x" and item["source_url"] == "https://doi.org/10.1/x"
    assert [str(c) for c in item["chunk_ids"]] == [CHUNK]


def test_with_no_claims_the_closest_passages_are_kept_as_pending():
    items = chat_items([answer([], related=[CHUNK])])
    assert len(items) == 1 and items[0]["status"] == "pending"
    assert "Closest passage, not verified" in items[0]["claim_text"]


def test_overview_is_valid_rich_text_with_findings_and_references():
    items = chat_items([answer([claim("Stable at 4 C", True)])])
    doc = json.loads(chat_overview_doc("Storage", ["Is it stable?", "How long?"], "Stable.", items))
    validate_rich_document(json.dumps(doc))
    texts = [text_of(n) for n in doc["content"]]
    assert "Research objective" in texts and "Follow-up questions" in texts
    assert "How long?" in all_text(doc)
    assert "Stable at 4 C [1]" in all_text(doc)
    assert REFERENCES_HEADING in texts


def test_sync_replaces_only_the_generated_sections_and_keeps_the_users_text():
    old = [
        {"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Storage"}]},
        {"type": "paragraph", "content": [{"type": "text", "text": "My own introduction."}]},
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Findings"}]},
        {"type": "paragraph", "content": [{"type": "text", "text": "stale finding"}]},
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Recommendations"}]},
        {"type": "paragraph", "content": [{"type": "text", "text": "My recommendation."}]},
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Evidence references"}]},
        {"type": "paragraph", "content": [{"type": "text", "text": "[1] old"}]},
    ]
    items = chat_items([answer([claim("Stable at 4 C", True)])])
    out = sync_sections(old, findings_block(items), [])
    texts = [text_of(n) for n in out]
    assert "My own introduction." in texts and "My recommendation." in texts       # the user's text stays
    assert "stale finding" not in texts and "[1] old" not in texts                  # generated text is replaced
    assert texts.index(FINDINGS_HEADING) < texts.index("Recommendations")           # findings stay in their place
    assert texts.count(FINDINGS_HEADING) == 1


def test_sync_adds_findings_when_the_document_has_none():
    base = [{"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Plain"}]}]
    out = sync_sections(base, findings_block([]), [])
    assert FINDINGS_HEADING in [text_of(n) for n in out]


def test_read_sources_are_listed_once_in_reading_order():
    from app.evidence import read_source_ids
    a, b = uuid4(), uuid4()
    hits = [SimpleNamespace(chunk_id=c) for c in ("c1", "c2", "c3")]
    meta = {"c1": {"source_id": a}, "c2": {"source_id": a}, "c3": {"source_id": b}}
    assert read_source_ids(hits, meta) == [a, b]
