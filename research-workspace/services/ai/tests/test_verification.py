"""Citation verification: pure functions plus the engine's purge-before-judge behaviour."""
import asyncio
import json
from uuid import UUID

import pytest

from app.ingest.chunking import sha256_hex
from app.orchestration.engine import run_dual
from app.orchestration.schema import ANSWERED, Claim, ContextChunk, ParsedAnswer
from app.verification.text import normalize, numbers_in, support
from app.verification.verifier import VerifyConfig, match_quote, verify_answer

C1, C2 = UUID(int=1), UUID(int=2)
T1 = ("The reagent was stable for 12 weeks at 4 °C in amber vials. It must not be frozen. "
      "Storage beyond that period was not tested.")
T2 = "Samples tolerated 25 °C for\n7 days with a citrate stabi-\nlizer present."
CH = [ContextChunk(C1, T1, "Smith 2024, doi:10.1/x", 3, 3, sha256_hex(T1)),
      ContextChunk(C2, T2, "Lee 2023", 5, 5, sha256_hex(T2))]
CFG = VerifyConfig()


def claim(text, quote, cites=(C1,), cond=None):
    return Claim(text, list(cites), [f"C{c.int}" for c in cites], quote, cond)


def check(*claims, chunks=CH):
    ans = ParsedAnswer(ANSWERED, list(claims))
    out, checks, all_purged = verify_answer(ans, chunks, CFG)
    return out, checks, all_purged


def reasons(*claims, chunks=CH):
    return [c.reason for c in check(*claims, chunks=chunks)[1]]


# ---- text helpers -------------------------------------------------------------

def test_numbers_in_digits_words_and_ignored_codes():
    assert numbers_in("12 weeks") == numbers_in("twelve weeks") == {"12"}
    assert numbers_in("twenty-five mg, 1,000 units, 4.0 C") == {"25", "1000", "4"}
    assert numbers_in("CD4 and H1N1 and IL6") == set()
    assert numbers_in("one of the samples", skip_one=True) == set()


def test_normalize_dehyphenates_and_unifies_punctuation():
    assert normalize("citrate stabi-\nlizer — “ok”") == 'citrate stabilizer - "ok"'


def test_support_flags_unrelated_claims():
    assert support("reagent stable 12 weeks", "reagent was stable for 12 weeks") == 1.0
    assert support("reagent stable twelve weeks", "reagent was stable for 12 weeks") >= 0.5
    assert support("penguins migrate south", "reagent was stable for 12 weeks") == 0.0


# ---- match levels -----------------------------------------------------------------

def test_match_levels():
    assert match_quote("stable for 12 weeks at 4 °C", T1, CFG) == ("exact", 1.0)
    assert match_quote("Stable for 12 weeks at 4 °C", T1, CFG)[0] == "normalized"        # case
    assert match_quote("citrate stabilizer present", T2, CFG)[0] == "normalized"              # line-break hyphen
    kind, score = match_quote("reagent was stable for 12 weeks at 4 C in amber vials", T1, CFG)
    assert kind == "fuzzy" and score >= 0.9
    assert match_quote("The reagent ... must not be frozen", T1, CFG)[0] == "exact"            # ordered ellipsis
    assert match_quote("must not be frozen ... The reagent", T1, CFG) is None                  # wrong order


def test_fuzzy_never_changes_numbers_or_drops_negations():
    assert match_quote("reagent was stable for 14 weeks at 4 C in amber vials", T1, CFG) is None
    assert match_quote("It must be frozen in amber vials", T1, CFG) is None
    assert match_quote("Storage beyond that period was tested at all", T1, CFG) is None


# ---- per-claim verdicts --------------------------------------------------------------

def test_verified_claims_carry_match_info_and_seals():
    out, checks, all_purged = check(claim("The reagent is stable for 12 weeks at 4 °C",
                                         "stable for 12 weeks at 4 °C"))
    assert not all_purged and checks[0].verified
    c = out.claims[0]
    assert c.verified and c.match_kind == "exact" and c.seals == {C1: sha256_hex(T1)}


def test_every_purge_reason():
    good_q = "stable for 12 weeks at 4 °C"
    got = reasons(
        claim("stable", "stable for"),                                              # too short
        claim("stable", good_q, cites=(UUID(int=99),)),                             # not in allowed set
        claim("stable twelve weeks", "stable for 20 weeks at 4 °C"),            # fabricated quote
        claim("Reagent is stable for 13 weeks", good_q),                            # number not in source
        claim("Penguins migrate south", good_q),                                    # real quote, unrelated claim
        claim("Reagent stable for 12 weeks", good_q, cond="at 40 °C"),          # number only in condition
    )
    assert got == ["quote_too_short", "chunk_not_allowed", "quote_not_found",
                   "ungrounded_number:13", "weak_support", "ungrounded_number:40"]


def test_hash_checks():
    tampered = [ContextChunk(C1, T1 + " Extra.", "x", 1, 1, sha256_hex(T1))]
    unsealed = [ContextChunk(C1, T1, "x", 1, 1)]
    c = claim("stable 12 weeks", "stable for 12 weeks at 4 °C")
    assert reasons(c, chunks=tampered) == ["hash_mismatch"]
    assert reasons(c, chunks=unsealed) == ["unsealed"]


def test_all_purged_turns_answer_insufficient():
    out, _, all_purged = check(claim("stable", "stable for 20 weeks at 4 °C"))
    assert all_purged and out.status != ANSWERED and out.claims == []
    assert "all claims failed verification" in out.issues


def test_label_numbers_count_as_grounded():
    # the year in the citation label is real source metadata
    assert reasons(claim("Stable 12 weeks at 4 \u00b0C in amber vials (Smith 2024)", "stable for 12 weeks at 4 \u00b0C in amber vials")) == ["ok"]


# ---- engine: purge happens before the cross-check -------------------------------------

class Fake:
    def __init__(self, name, handler):
        self.name, self.handler, self.calls = name, handler, []

    async def complete(self, system, user):
        self.calls.append(system)
        return self.handler(system)


def ans(*claims):
    return json.dumps({"status": "answered", "claims": [
        {"text": t, "cites": ["C1"], "quote": q} for t, q in claims]})


VERDICT = json.dumps({"a_claims": [{"id": 1, "status": "agreed", "b_ids": [1]}], "conflicts": []})
GOOD = ("Stable 12 weeks at 4 °C", "stable for 12 weeks at 4 °C")
FAKE = ("Stable for 52 weeks at 4 °C", "stable for 52 weeks at 4 °C")


def run(a, b):
    return asyncio.run(run_dual("q", CH, a, b))


def test_fabricated_claim_is_purged_and_cannot_cause_disagreement():
    a = Fake("A", lambda s: ans(GOOD, FAKE))
    b = Fake("B", lambda s: VERDICT if "cross-checker" in s else ans(GOOD))
    r = run(a, b)
    assert r.kind == "consensus"
    assert [c.text for c in r.claims] == [GOOD[0]]
    assert r.claims[0].seals == {C1: sha256_hex(T1)} and r.claims[0].match_kind == "exact"
    assert r.model_a["purged"] == 1
    assert [c.reason for c in r.checks["model_a"]] == ["ok", "quote_not_found"]


def test_model_with_only_fabricated_claims_is_unverifiable():
    a = Fake("A", lambda s: ans(FAKE))
    b = Fake("B", lambda s: ans(GOOD))
    r = run(a, b)
    assert (r.kind, r.reason) == ("disagreement", "model_a_unverifiable")
    assert len(b.calls) == 1                                   # judge never consulted
    assert r.claims == []


def test_both_fabricating_gives_no_verifiable_claims():
    r = run(Fake("A", lambda s: ans(FAKE)), Fake("B", lambda s: ans(FAKE)))
    assert (r.kind, r.reason) == ("insufficient_evidence", "no_verifiable_claims")


def test_tampered_chunk_blocks_every_claim():
    bad = [ContextChunk(C1, T1 + " Edited.", "x", 1, 1, sha256_hex(T1))]
    r = asyncio.run(run_dual("q", bad, Fake("A", lambda s: ans(GOOD)), Fake("B", lambda s: ans(GOOD))))
    assert r.reason == "no_verifiable_claims"
    assert {c.reason for c in r.checks["model_a"]} == {"hash_mismatch"}
