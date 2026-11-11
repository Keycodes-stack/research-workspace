"""HELD-OUT verifier cases: different documents and traps that were written AFTER the guards were tuned
on verifier_suite.py. Run once per change as an honest estimate; do not tune against it.
Cases marked HARD need real semantic understanding and are expected to leak."""
from .verifier_suite import Case, Report, run_suite
from app.verification.verifier import VerifyConfig

TEXTS = [
    "Participants receiving 20 mg of compound X daily showed a mean HbA1c decrease of 0.9 percentage points after 24 "
    "weeks. Nausea occurred in 14% of the treated group and in 6% of the placebo group. The study enrolled adults aged "
    "18 to 65 with type 2 diabetes.",
    "Aluminum alloy 6061-T6 exhibited a tensile strength of 310 MPa and an elongation at break of 12%. Specimens were "
    "tested at 20 °C. Corrosion rate in 3.5% NaCl solution was 0.05 mm per year.",
    "The enzyme retained 80% of its activity after 30 minutes at 60 °C but lost all activity at 80 °C. Activity was "
    "highest at pH 7.5. Addition of 5 mM calcium chloride improved thermal stability.",
]
LABELS = ["Park 2025", "Ivanov 2020", "Mbeki 2023"]


def V(i, cat, text, quote, cites=(0,), cond=None, note=""):
    return Case(f"HV{i:02d}", cat, True, text, quote, cites, cond, note=note)


def X(i, cat, text, quote, cites=(0,), cond=None, note=""):
    return Case(f"HX{i:02d}", cat, False, text, quote, cites, cond, note=note)


CASES = [
    V(1, "paraphrase", "Compound X 20 mg daily lowered mean HbA1c by 0.9 percentage points after 24 weeks",
      "mean HbA1c decrease of 0.9 percentage points after 24 weeks"),
    V(2, "exact", "Nausea occurred in 14% of treated participants versus 6% on placebo",
      "Nausea occurred in 14% of the treated group and in 6% of the placebo group"),
    V(3, "exact", "The study enrolled adults aged 18 to 65 with type 2 diabetes",
      "The study enrolled adults aged 18 to 65 with type 2 diabetes"),
    V(4, "exact", "6061-T6 aluminum had a tensile strength of 310 MPa", "tensile strength of 310 MPa", (1,)),
    V(5, "exact", "Elongation at break was 12%", "elongation at break of 12%", (1,)),
    V(6, "exact", "Corrosion in 3.5% NaCl was 0.05 mm per year",
      "Corrosion rate in 3.5% NaCl solution was 0.05 mm per year", (1,)),
    V(7, "paraphrase", "The enzyme kept 80% of its activity after 30 minutes at 60 °C",
      "retained 80% of its activity after 30 minutes at 60 °C", (2,)),
    V(8, "paraphrase", "Activity peaked at pH 7.5", "Activity was highest at pH 7.5", (2,)),
    V(9, "exact", "Calcium chloride at 5 mM improved thermal stability",
      "Addition of 5 mM calcium chloride improved thermal stability", (2,)),
    V(10, "exact", "All activity was lost at 80 °C", "lost all activity at 80 °C", (2,)),
    V(11, "ellipsis", "Specimens with 310 MPa tensile strength were tested at 20 °C",
      "tensile strength of 310 MPa ... tested at 20 °C", (1,)),
    X(1, "number_swap", "Nausea occurred in 41% of the treated group", "Nausea occurred in 41% of the treated group"),
    X(2, "group_swap", "Nausea occurred in 6% of the treated group and 14% of the placebo group",
      "Nausea occurred in 14% of the treated group and in 6% of the placebo group", note="HARD: association swap"),
    X(3, "group_swap", "Nausea occurred in 14% of the placebo group", "Nausea occurred in 14% of the treated group",
      note="HARD: association swap"),
    X(4, "condition_swap", "The enzyme retained 80% of its activity after 30 minutes at 80 °C",
      "retained 80% of its activity after 30 minutes at 60 °C", (2,), note="HARD: number exists elsewhere"),
    X(5, "direction_flip", "Compound X increased HbA1c by 0.9 percentage points",
      "mean HbA1c decrease of 0.9 percentage points after 24 weeks"),
    X(6, "negation_flip", "The enzyme did not lose activity at 80 °C", "lost all activity at 80 °C", (2,)),
    X(7, "fabricated_quote", "Tensile strength was 410 MPa", "tensile strength of 410 MPa", (1,)),
    X(8, "unit_swap", "Tensile strength of 310 GPa", "tensile strength of 310 MPa", (1,)),
    X(9, "unit_swap", "Activity was retained for 30 hours at 60 °C", "retained 80% of its activity after 30 minutes at 60 °C", (2,)),
    X(10, "unit_swap", "Compound X lowered HbA1c by 0.9 percentage points after 24 months",
      "mean HbA1c decrease of 0.9 percentage points after 24 weeks"),
    X(11, "overread", "Compound X cures type 2 diabetes", "adults aged 18 to 65 with type 2 diabetes"),
    X(12, "overgeneralization", "Enzyme activity is highest at every pH", "Activity was highest at pH 7.5", (2,)),
    X(13, "wrong_chunk", "Aluminum tensile strength is 310 MPa", "tensile strength of 310 MPa", (2,)),
    X(14, "certainty", "Compound X definitely lowers HbA1c", "mean HbA1c decrease of 0.9 percentage points after 24 weeks",
      note="HARD: certainty inflation"),
    X(15, "causal_upgrade", "Calcium chloride caused thermal stability", "improved thermal stability", (2,),
      note="HARD: causal wording"),
    X(16, "condition_number", "Activity was highest at pH 7.5", "Activity was highest at pH 7.5", (2,), "at 37 °C"),
    X(17, "extra_clause", "The enzyme retained 80% of its activity after 30 minutes at 60 °C and 100% at 40 °C",
      "retained 80% of its activity after 30 minutes at 60 °C", (2,)),
    X(18, "semantic_flip", "The enzyme retained activity at 80 °C", "lost all activity at 80 °C", (2,),
      note="HARD: lost vs retained"),
]


def run(cfg: VerifyConfig | None = None) -> Report:
    return run_suite(cfg, CASES, TEXTS, LABELS)


if __name__ == "__main__":
    rep = run()
    print(f"HELD-OUT {rep.n} cases: bad claims stopped {rep.tp}/{rep.tp + rep.fn} ({rep.purge_recall:.0%}), "
          f"good claims kept {rep.tn}/{rep.tn + rep.fp} ({rep.keep_recall:.0%})")
    for x in rep.leaks:
        print("  LEAK", x)
    for x in rep.lost:
        print("  LOST", x)
