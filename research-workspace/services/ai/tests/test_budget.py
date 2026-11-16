from uuid import uuid4

from app.orchestration.prompts import fit_to_budget
from app.orchestration.schema import ContextChunk


def chunk(n_chars: int) -> ContextChunk:
    return ContextChunk(uuid4(), "x" * n_chars, "paper", 1, 1, "h")


def test_drops_least_relevant_first_and_never_cuts_a_chunk():
    chunks = [chunk(4000) for _ in range(5)]            # ~1000 tokens each
    kept, dropped = fit_to_budget(chunks, 2500)
    assert kept == chunks[:2] and dropped == 3
    assert all(len(c.text) == 4000 for c in kept)        # whole text, exact-match citations stay valid


def test_top_chunk_always_kept_even_over_budget():
    kept, dropped = fit_to_budget([chunk(40000), chunk(100)], 100)
    assert len(kept) == 1 and dropped == 1


def test_zero_budget_disables_trimming():
    chunks = [chunk(4000) for _ in range(5)]
    assert fit_to_budget(chunks, 0) == (chunks, 0)


def test_evidence_that_passed_fuzzy_verification_is_still_intact():
    """Regression: a quote the verifier accepted by fuzzy match is not a literal substring of the chunk, and
    the integrity re-check used to demand one, so good evidence was reported as a 'changed source'."""
    from app.ingest.chunking import sha256_hex
    from app.synth import evidence_intact, vconfig
    from app.verification.verifier import match_quote
    text = "The lyophilized formulation remained stable at 4 C for twelve weeks in all tested batches of the study."
    quote = "lyophilized formulation remained stable at 4 C for twelve weeks in all test batches of the study"
    assert match_quote(quote, text, vconfig())[0] == "fuzzy"          # the verifier accepts it ...
    seal = sha256_hex(text)
    assert evidence_intact(text, quote, seal, seal)                    # ... so the re-check must too
    assert not evidence_intact(text + " x", quote, seal, seal)        # text changed after sealing
    assert not evidence_intact(text, "a completely different statement about storage costs", seal, seal)
    assert not evidence_intact(text, quote.replace("12", "13").replace("twelve", "thirteen"), seal, seal)  # a changed number never matches
