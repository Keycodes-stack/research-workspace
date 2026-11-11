"""Labelled claim cases for measuring the citation verifier.

Each case is a (claim, quote, cited chunks) triple plus the CORRECT decision: should a careful
scientist accept this claim as supported by its quote (valid=True) or must it be purged?
Categories separate what the verifier must catch from what is a known hard limit."""
from dataclasses import dataclass, field
from uuid import UUID

from app.ingest.chunking import sha256_hex
from app.orchestration.schema import ANSWERED, Claim, ContextChunk, ParsedAnswer
from app.verification.verifier import VerifyConfig, verify_answer

TEXTS = [
    "The liquid injection was stable at 4 °C for twelve weeks in amber vials. Storage above 8 °C led to a "
    "5% potency loss within two weeks. The formulation must not be frozen.",
    "With a citrate stabilizer (0.1 M), the injection tolerated 25 °C for 6 months. Degradation products stayed "
    "below 0.5% of total peak area.",
    "In a randomized trial of 240 patients, the treatment group showed a 12.5% reduction in systolic blood pressure "
    "compared with placebo (p < 0.05). Adverse events were mild and occurred in 8% of participants. Patients with "
    "renal impairment were excluded.",
    "Annealed 316L stainless steel specimens showed a fatigue strength of 450 MPa at 10^6 cycles at room "
    "temperature. Yield strength was 290 MPa. Testing was performed at a stress ratio R = 0.1.",
]
IDS = [UUID(int=i + 1) for i in range(len(TEXTS))]
LABELS = ["Smith 2024", "Lee 2023", "Chen 2022", "Okafor 2021"]


@dataclass
class Case:
    id: str
    category: str
    valid: bool
    text: str
    quote: str
    cites: tuple = (0,)
    conditions: str | None = None
    tamper: bool = False          # chunk text changed after sealing
    unsealed: bool = False
    note: str = ""


def V(i, cat, text, quote, cites=(0,), cond=None, note=""):
    return Case(f"V{i:02d}", cat, True, text, quote, cites, cond, note=note)


def X(i, cat, text, quote, cites=(0,), cond=None, **kw):
    return Case(f"X{i:02d}", cat, False, text, quote, cites, cond, **kw)


CASES: list[Case] = [
    # ---- supported claims that must be kept -------------------------------------------------------
    V(1, "exact", "The liquid injection was stable at 4 °C for twelve weeks", "stable at 4 °C for twelve weeks"),
    V(2, "digit_paraphrase", "The liquid injection remained stable for 12 weeks at 4 °C", "stable at 4 °C for twelve weeks"),
    V(3, "exact", "Storage above 8 °C caused a 5% potency loss within two weeks",
      "Storage above 8 °C led to a 5% potency loss within two weeks"),
    V(4, "exact", "The formulation must not be frozen", "must not be frozen"),
    V(5, "exact", "With a citrate stabilizer the injection tolerated 25 °C for 6 months",
      "tolerated 25 °C for 6 months", (1,), "0.1 M citrate"),
    V(6, "exact", "Degradation products stayed below 0.5% of total peak area",
      "Degradation products stayed below 0.5% of total peak area", (1,)),
    V(7, "exact", "A randomized trial of 240 patients found a 12.5% reduction in systolic blood pressure versus placebo",
      "a 12.5% reduction in systolic blood pressure compared with placebo", (2,)),
    V(8, "exact", "The blood pressure reduction compared with placebo had p < 0.05",
      "compared with placebo (p < 0.05)", (2,)),
    V(9, "exact", "Adverse events were mild and occurred in 8% of participants",
      "Adverse events were mild and occurred in 8% of participants", (2,)),
    V(10, "exact", "Patients with renal impairment were excluded from the trial",
      "Patients with renal impairment were excluded", (2,)),
    V(11, "exact", "Annealed 316L steel had a fatigue strength of 450 MPa at 10^6 cycles",
      "fatigue strength of 450 MPa at 10^6 cycles at room temperature", (3,)),
    V(12, "exact", "Yield strength was 290 MPa", "Yield strength was 290 MPa", (3,)),
    V(13, "exact", "Testing used a stress ratio of R = 0.1", "Testing was performed at a stress ratio R = 0.1", (3,)),
    V(14, "ellipsis", "The injection was stable for twelve weeks and must not be frozen",
      "stable at 4 °C for twelve weeks ... must not be frozen"),
    V(15, "formatting", "Liquid injection stable at 4 °C for twelve weeks", "STABLE AT 4 °C FOR TWELVE WEEKS"),
    V(16, "multi_chunk", "Stable 12 weeks at 4 °C; 25 °C tolerated with citrate",
      "tolerated 25 °C for 6 months", (0, 1), note="synthesis from one quote: lexical support is weak"),
    V(17, "heavy_paraphrase", "Potency dropped by five percent when kept above 8 °C for two weeks",
      "Storage above 8 °C led to a 5% potency loss within two weeks", note="few shared words"),
    V(18, "conditions", "Stable at 4 °C", "was stable at 4 °C for twelve weeks in amber vials", (0,),
      "liquid injection in amber vials"),
    V(19, "paraphrase", "The 316L steel fatigue strength reached 450 MPa at one million cycles... ",
      "fatigue strength of 450 MPa at 10^6 cycles", (3,), note="spelled-out magnitude"),
    V(20, "paraphrase", "No more than 0.5% degradation products were found with the stabilizer",
      "Degradation products stayed below 0.5% of total peak area", (1,)),
    # ---- claims that must be purged -----------------------------------------------------------------
    X(1, "fabricated_quote", "Stable at 4 °C for 52 weeks", "stable at 4 °C for 52 weeks"),
    X(2, "fabricated_quote", "The reagent shows excellent long-term shelf stability",
      "excellent long-term shelf stability in all conditions"),
    X(3, "number_swap", "Stable for 16 weeks at 4 °C", "stable at 4 °C for twelve weeks"),
    X(4, "number_swap", "Stable for 16 weeks at 4 °C", "stable at 4 °C for sixteen weeks"),
    X(5, "wrong_chunk", "Tolerated 25 °C for 6 months", "tolerated 25 °C for 6 months", (0,)),
    X(6, "wrong_chunk", "Fatigue strength of 450 MPa at 10^6 cycles", "fatigue strength of 450 MPa at 10^6 cycles", (2,)),
    X(7, "unrelated_claim", "Penguins migrate south in winter", "stable at 4 °C for twelve weeks"),
    X(8, "unrelated_claim", "The drug cures cancer completely", "reduction in systolic blood pressure compared with placebo", (2,)),
    X(9, "overread", "Stable at 4 °C for twelve weeks and safe for use in children", "stable at 4 °C for twelve weeks"),
    X(10, "negation_flip", "The formulation can be frozen", "must not be frozen"),
    X(11, "negation_flip", "No adverse events occurred in the trial",
      "Adverse events were mild and occurred in 8% of participants", (2,)),
    X(12, "direction_flip", "A 12.5% increase in systolic blood pressure compared with placebo",
      "a 12.5% reduction in systolic blood pressure compared with placebo", (2,)),
    X(13, "direction_flip", "Storage below 8 °C led to a 5% potency loss within two weeks",
      "Storage above 8 °C led to a 5% potency loss within two weeks"),
    X(14, "unit_swap", "Fatigue strength of 450 GPa at 10^6 cycles", "fatigue strength of 450 MPa at 10^6 cycles", (3,)),
    X(15, "unit_swap", "Degradation products stayed below 0.5 mg of total peak area",
      "Degradation products stayed below 0.5% of total peak area", (1,)),
    X(16, "unit_swap", "Stable at 4 °F for twelve weeks", "stable at 4 °C for twelve weeks"),
    X(17, "unit_swap", "Stable at 4 °C for twelve months", "stable at 4 °C for twelve weeks"),
    X(18, "population_swap", "A randomized trial of 240 children found a 12.5% reduction in systolic blood pressure",
      "randomized trial of 240 patients", (2,), note="HARD: needs semantic understanding"),
    X(19, "condition_number", "Stable at 4 °C for twelve weeks", "stable at 4 °C for twelve weeks", (0,), "at 40 °C"),
    X(20, "too_short", "Stable", "stable at"),
    X(21, "chunk_not_allowed", "Stable at 4 °C for twelve weeks", "stable at 4 °C for twelve weeks", (9,)),
    X(22, "tampered_chunk", "Stable at 4 °C for twelve weeks", "stable at 4 °C for twelve weeks", tamper=True),
    X(23, "unsealed_chunk", "Stable at 4 °C for twelve weeks", "stable at 4 °C for twelve weeks", unsealed=True),
    X(24, "ellipsis_order", "Frozen then stable", "must not be frozen ... stable at 4 °C for twelve weeks"),
    X(25, "splice", "Stable and tolerant", "stable at 4 °C for twelve weeks ... tolerated 25 °C for 6 months", (0, 1)),
    X(26, "derived_number", "About 13% reduction in systolic blood pressure",
      "a 12.5% reduction in systolic blood pressure", (2,), note="policy: derived numbers are purged"),
    X(27, "overgeneralization", "All patients showed a 12.5% reduction in systolic blood pressure",
      "a 12.5% reduction in systolic blood pressure compared with placebo", (2,)),
    X(28, "overgeneralization", "The injection is always stable at 4 °C", "stable at 4 °C for twelve weeks"),
    X(29, "fabricated_quote", "Steel fatigue strength was 600 MPa", "fatigue strength of 600 MPa at 10^6 cycles", (3,)),
    X(31, "inference", "The blood pressure reduction was statistically significant",
      "compared with placebo (p < 0.05)", (2,), note="policy: inference the source does not state"),
    X(30, "scope_swap", "Stable at room temperature for twelve weeks", "stable at 4 °C for twelve weeks",
      note="HARD: conditions replaced without numbers"),
]


def chunks_for(case: Case, texts=None, labels=None) -> list[ContextChunk]:
    texts, labels = texts or TEXTS, labels or LABELS
    out = []
    for i, (cid, text, label) in enumerate(zip(IDS, texts, labels)):
        sha = "" if (case.unsealed and i in case.cites) else sha256_hex(text)
        shown = text + " Edited." if (case.tamper and i in case.cites) else text
        out.append(ContextChunk(cid, shown, label, 1, 1, sha))
    return out


def decide(case: Case, cfg: VerifyConfig, texts=None, labels=None) -> tuple[bool, str]:
    """(kept?, reason) for one case under the given verifier configuration."""
    ids = [IDS[i] if i < len(IDS) else UUID(int=99) for i in case.cites]
    claim = Claim(case.text, ids, [f"C{i + 1}" for i in case.cites], case.quote, case.conditions)
    _, checks, _ = verify_answer(ParsedAnswer(ANSWERED, [claim]), chunks_for(case, texts, labels), cfg)
    return checks[0].verified, checks[0].reason


@dataclass
class Report:
    n: int = 0
    tp: int = 0          # invalid and purged (good)
    fn: int = 0          # invalid but kept  (hallucination leak)
    tn: int = 0          # valid and kept (good)
    fp: int = 0          # valid but purged  (lost answer)
    leaks: list = field(default_factory=list)
    lost: list = field(default_factory=list)
    by_category: dict = field(default_factory=dict)

    @property
    def purge_precision(self):      # of everything purged, how much deserved it
        return self.tp / (self.tp + self.fp) if (self.tp + self.fp) else 1.0

    @property
    def purge_recall(self):         # of all bad claims, how many were stopped
        return self.tp / (self.tp + self.fn) if (self.tp + self.fn) else 1.0

    @property
    def keep_recall(self):          # of all good claims, how many survived
        return self.tn / (self.tn + self.fp) if (self.tn + self.fp) else 1.0


def run_suite(cfg: VerifyConfig | None = None, cases=None, texts=None, labels=None) -> Report:
    cfg = cfg or VerifyConfig()
    r = Report()
    for c in cases or CASES:
        kept, reason = decide(c, cfg, texts, labels)
        r.n += 1
        cat = r.by_category.setdefault(c.category, {"ok": 0, "bad": 0})
        if c.valid and kept:
            r.tn += 1; cat["ok"] += 1
        elif c.valid and not kept:
            r.fp += 1; cat["bad"] += 1; r.lost.append((c.id, c.category, reason, c.note))
        elif not c.valid and not kept:
            r.tp += 1; cat["ok"] += 1
        else:
            r.fn += 1; cat["bad"] += 1; r.leaks.append((c.id, c.category, c.text, c.note))
    return r


if __name__ == "__main__":
    rep = run_suite()
    print(f"cases {rep.n}: bad claims stopped {rep.tp}/{rep.tp + rep.fn} (recall {rep.purge_recall:.0%}), "
          f"good claims kept {rep.tn}/{rep.tn + rep.fp} ({rep.keep_recall:.0%})")
    for x in rep.leaks:
        print("  LEAK", x)
    for x in rep.lost:
        print("  LOST", x)
