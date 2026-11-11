"""Synthetic ground-truth corpus. Every fact here is invented for testing; documents are plain text chunks
(the PDF path is covered by tests/test_ingest_*). Each question in questions.py points at these facts."""
DOCS = {
    "liquid": ("Okafor 2023", [
        "Formulation L-7 as a liquid injection was stable for 12 weeks at 4 °C in amber vials. "
        "Storage at 25 °C caused degradation within 3 weeks.",
        "Frozen storage at -20 °C extended the shelf life of the liquid injection to 9 months. "
        "Repeated freeze-thaw cycles reduced potency.",
    ]),
    "powder": ("Lindqvist 2022", [
        "The lyophilized powder form of L-7 remained stable for 24 months at 25 °C when stored in sealed glass vials. "
        "Moisture above 5% shortened shelf life.",
    ]),
    "citrate": ("Haddad 2024", [
        "Adding 10 mM sodium citrate as a stabilizer allowed the liquid formulation to remain stable for 6 weeks at 25 °C. "
        "Citrate had no effect at 4 °C.",
    ]),
    "trial": ("Brandt 2025", [
        "In a randomized trial of 240 patients, compound X reduced systolic blood pressure by 12.5% compared with placebo. "
        "The effect was observed after 8 weeks of daily dosing.",
        "Dizziness was reported by 9% of patients receiving compound X and by 3% of the placebo group. "
        "No serious adverse events were attributed to the treatment.",
    ]),
    "steel": ("Moreau 2021", [
        "The fatigue limit of 316L stainless steel was 450 MPa at 10 million cycles. "
        "Surface polishing raised the fatigue limit by 8%.",
    ]),
    "hvac": ("Tanaka 2020", [
        "The ventilation system delivered 1200 cubic metres of air per hour. "
        "Filter replacement was scheduled every 6 months.",
    ]),
    "conflict_a": ("Silva 2023", [
        "Compound Y degraded by 15% after 4 weeks at 40 °C in the lab study.",
    ]),
    "conflict_b": ("Weber 2024", [
        "Compound Y degraded by 40% after 4 weeks at 40 °C in the field study.",
    ]),
}
