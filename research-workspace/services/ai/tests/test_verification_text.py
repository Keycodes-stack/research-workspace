

def test_pdf_control_char_degree_sign_is_read_as_degree():
    from app.verification.text import normalize, number_units
    assert "190°C" in normalize("complete degradation occurs at above 190\x02C. In addition")
    assert ("190", "c") in number_units("degradation around 190\x02C. Quantification")
    assert normalize("a\x01b") == "ab"
