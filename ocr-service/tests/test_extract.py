from app.extract import extract


def block(text: str, x: float, y: float, w: float = 80, h: float = 20, score: float = 0.95):
    """Build a RapidOCR-shaped block from a top-left corner plus size."""
    return {
        "text": text,
        "box": [[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
        "score": score,
    }


def test_picks_amount_on_the_same_line_as_total():
    blocks = [
        block("MARJANE HOLDING", 20, 10, w=200),
        block("Article A", 20, 60),
        block("12,00", 300, 60),
        block("TOTAL TTC", 20, 200),
        block("284,50", 300, 200),
    ]
    assert extract(blocks)["amount"] == 284.50


def test_prefers_total_over_larger_unrelated_amount():
    """A deposit or item price may be numerically larger; the TOTAL keyword wins."""
    blocks = [
        block("ACOMPTE", 20, 60),
        block("999,99", 300, 60),
        block("NET A PAYER", 20, 200),
        block("284,50", 300, 200),
    ]
    assert extract(blocks)["amount"] == 284.50


def test_parses_dot_decimal_separator():
    blocks = [block("TOTAL", 20, 200), block("1284.50", 300, 200)]
    assert extract(blocks)["amount"] == 1284.50


def test_strips_currency_suffix_and_thousands_separator():
    blocks = [block("TOTAL", 20, 200), block("1 284,50 DH", 300, 200)]
    assert extract(blocks)["amount"] == 1284.50


def test_falls_back_to_largest_amount_in_bottom_third():
    """No TOTAL keyword survived OCR - take the biggest amount low on the receipt."""
    blocks = [
        block("Article A", 20, 20),
        block("12,00", 300, 20),
        block("284,50", 300, 500),
        block("30,00", 300, 520),
    ]
    result = extract(blocks)
    assert result["amount"] == 284.50
    assert result["confidence"]["amount"] < 0.6


def test_returns_none_when_no_amount_present():
    blocks = [block("MERCI DE VOTRE VISITE", 20, 20, w=300)]
    result = extract(blocks)
    assert result["amount"] is None
    assert result["confidence"]["amount"] == 0.0


def test_extracts_tva_separately_from_total():
    blocks = [
        block("TVA 20%", 20, 170),
        block("47,42", 300, 170),
        block("TOTAL TTC", 20, 200),
        block("284,50", 300, 200),
    ]
    result = extract(blocks)
    assert result["amount"] == 284.50
    assert result["taxAmount"] == 47.42


def test_parses_french_slash_date():
    blocks = [
        block("Le 01/08/2026 14:32", 20, 40, w=220),
        block("TOTAL", 20, 200),
        block("10,00", 300, 200),
    ]
    assert extract(blocks)["date"] == "2026-08-01"


def test_parses_iso_and_dashed_dates():
    assert extract([block("2026-08-01", 20, 40)])["date"] == "2026-08-01"
    assert extract([block("01-08-2026", 20, 40)])["date"] == "2026-08-01"


def test_ignores_impossible_dates():
    assert extract([block("99/99/9999", 20, 40)])["date"] is None


def test_merchant_name_is_the_topmost_wide_text_block():
    blocks = [
        block("MARJANE HOLDING", 20, 10, w=240),
        block("Casablanca", 20, 35, w=100),
        block("TOTAL", 20, 200),
        block("10,00", 300, 200),
    ]
    assert extract(blocks)["merchantName"] == "MARJANE HOLDING"


def test_merchant_name_skips_numeric_headers():
    blocks = [block("0522 33 44 55", 20, 10, w=240), block("CAFE ATLAS", 20, 40, w=200)]
    assert extract(blocks)["merchantName"] == "CAFE ATLAS"


def test_empty_input_is_safe():
    result = extract([])
    assert result == {
        "amount": None,
        "taxAmount": None,
        "date": None,
        "merchantName": None,
        "confidence": {
            "amount": 0.0,
            "taxAmount": 0.0,
            "date": 0.0,
            "merchantName": 0.0,
        },
    }


def test_arabic_total_keyword_is_recognised():
    blocks = [block("الإجمالي", 20, 200), block("284,50", 300, 200)]
    assert extract(blocks)["amount"] == 284.50


def test_rejects_tva_rate_masquerading_as_tax_amount():
    """'TVA 20%' with the total on the same band must not report 284.50 as tax."""
    blocks = [block("TVA", 20, 200), block("284,50", 300, 200)]
    result = extract(blocks)
    assert result["taxAmount"] is None
