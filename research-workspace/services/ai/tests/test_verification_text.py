

def test_pdf_control_char_degree_sign_is_read_as_degree():
    from app.verification.text import normalize, number_units
    assert "190°C" in normalize("complete degradation occurs at above 190\x02C. In addition")
    assert ("190", "c") in number_units("degradation around 190\x02C. Quantification")
    assert normalize("a\x01b") == "ab"


def test_units_are_measurement_units_not_labels_or_counts():
    from app.verification.text import number_units, semantic_problem
    assert number_units("A 2023 review of 20 patients and 1 daughter at the 2022 FIFA World Cup") == set()
    assert number_units("a four-year field test") == {("4", "year")}
    assert number_units("10 mg/kg for a 12-week course at 85 °C") == {("10", "mg/kg"), ("12", "week"), ("85", "c")}
    src = "In a 2023 review, devices kept 80% efficiency during a four-year outdoor test."
    assert semantic_problem("A 2023 review found devices lasted 4 years outdoors.", src, src, src) is None
    # a real unit change is still caught
    assert semantic_problem("Devices lasted 4 months outdoors.", src, src, src) == "unit_mismatch:4 month"
