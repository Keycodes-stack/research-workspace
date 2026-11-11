"""Shared building block for every module that lets models write text from the project's sources
(signals, concept briefs, department lenses). Both models answer independently; every claim goes through
the same deterministic verifier as /ask; only verified claims are returned. Nothing here is ever shown unverified."""
import asyncio
import re
from dataclasses import dataclass, field
from uuid import UUID

from .config import get_settings
from .ingest import store
from .orchestration.engine import CrossCheckFailed, _call
from .orchestration.prompts import ROLE_A, ROLE_B, _COMMON, build_user_prompt
from .orchestration.schema import ContextChunk, ParsedAnswer, parse_answer, ANSWERED
from .verification.text import tokens
from .verification.verifier import VerifyConfig, verify_answer


@dataclass
class Item:
    text: str
    quote: str
    chunk_ids: list[UUID]
    models: set[str] = field(default_factory=set)
    evidence: list[dict] = field(default_factory=list)   # {chunk_id, quote, sha256, model, match_kind}
    source_ids: set[UUID] = field(default_factory=set)


def vconfig() -> VerifyConfig:
    c = get_settings()
    return VerifyConfig(c.fuzzy_threshold, c.min_quote_tokens, c.min_support, c.strict_numbers)


def _jaccard(a: str, b: str) -> float:
    x, y = set(tokens(a.lower())), set(tokens(b.lower()))
    return len(x & y) / len(x | y) if x | y else 0.0


async def project_chunks(pool, embedder, project_id: UUID, queries: list[str], top_k: int):
    """Union of the top-k chunks for several queries over ALL of the project's sources, integrity-checked.
    Returns (ContextChunks, {chunk_id: source_id}, best_similarity)."""
    rows = await pool.fetch("SELECT id FROM sources WHERE project_id=$1", project_id)
    sids = [r["id"] for r in rows]
    seen, hits, top = set(), [], None
    for q in queries:
        qv = await asyncio.to_thread(embedder.embed_query, q)
        for h in await store.search_chunks(pool, qv, sids, top_k):
            if h.intact():
                top = h.similarity if top is None else max(top, h.similarity)
                if h.chunk_id not in seen:
                    seen.add(h.chunk_id)
                    hits.append(h)
    meta = await store.fetch_chunks(pool, [h.chunk_id for h in hits])
    chunks, src = [], {}
    for h in hits:
        m = meta[h.chunk_id]
        label = m["title"] or m["filename"] or "untitled"
        if m["doi"]:
            label += f", doi:{m['doi']}"
        chunks.append(ContextChunk(h.chunk_id, h.text, label, h.page_start, h.page_end, h.sha256))
        src[h.chunk_id] = m["source_id"]
    return chunks, src, top


def system_for(role: str, task: str) -> str:
    return (ROLE_A if role == "a" else ROLE_B) + _COMMON + "\nTASK\n" + task + "\n"


async def verified_items(question, task, chunks, src, llms, cfg=None, max_items=8) -> list[Item]:
    """Ask both models; keep only verified claims; merge the same finding found by both models."""
    if not chunks:
        return []
    cfg = cfg or vconfig()
    user, alias_map = build_user_prompt(question, chunks)
    (pa, _), (pb, _) = await asyncio.gather(
        _call(llms[0], system_for("a", task), user, lambda t: parse_answer(t, alias_map)),
        _call(llms[1], system_for("b", task), user, lambda t: parse_answer(t, alias_map)),
    )
    by_id = {c.chunk_id: c for c in chunks}
    items: list[Item] = []
    for model, parsed in (("model_a", pa), ("model_b", pb)):
        parsed, checks, _ = verify_answer(parsed, chunks, cfg)
        if parsed.status != ANSWERED:
            continue
        for claim in parsed.claims:
            same = next((i for i in items if set(i.chunk_ids) & set(claim.chunk_ids)
                         and max(_jaccard(i.text, claim.text), _jaccard(i.quote, claim.quote)) >= 0.6), None)
            if same is None:
                same = Item(claim.text, claim.quote, list(claim.chunk_ids))
                items.append(same)
            same.models.add(model)
            for cid in claim.chunk_ids:
                same.source_ids.add(src[cid])
                same.evidence.append({"chunk_id": cid, "quote": claim.quote, "sha256": by_id[cid].sha256,
                                      "model": model, "match_kind": claim.match_kind})
    return items[:max_items]


async def chunks_by_ids(pool, chunk_ids: list[UUID]):
    """ContextChunks (integrity-checked) for specific chunk ids, plus {chunk_id: source_id}."""
    meta = await store.fetch_chunks(pool, list(chunk_ids))
    from .ingest.chunking import sha256_hex
    chunks, src = [], {}
    for cid, m in meta.items():
        if sha256_hex(m["text"]) != m["sha256"]:
            continue                                # a corrupted chunk is never shown to a model
        label = m["title"] or m["filename"] or "untitled"
        if m["doi"]:
            label += f", doi:{m['doi']}"
        chunks.append(ContextChunk(cid, m["text"], label, m["page_start"], m["page_end"], m["sha256"]))
        src[cid] = m["source_id"]
    return chunks, src


def evidence_intact(chunk_text: str, quote: str, sealed: str, current: str) -> bool:
    """Re-verification on read: stored text still hashes to the seal, and every quote segment is still in it."""
    from .ingest.chunking import sha256_hex
    from .verification.text import normalize
    if not (sha256_hex(chunk_text) == sealed == current):
        return False
    segs = [s.strip() for s in re.split(r"\[\s*(?:\.\.\.|…)\s*\]|\.\.\.|…", quote) if s.strip()]
    hay = normalize(chunk_text).lower()
    return bool(segs) and all(normalize(s).lower() in hay for s in segs)
