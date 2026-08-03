"""Bounding-box-aware field extraction from OCR blocks.

Plain-text regex over concatenated OCR output is unreliable: receipts are noisy
and a naive "first number after TOTAL" rule breaks whenever a decorative line or
a mis-read character lands between the label and the value. RapidOCR gives us a
box per text fragment, so we keep the geometry and match each amount to the
label sitting on the same printed line.

Every field is best-effort and independently optional. The caller treats the
result as a draft for the user to confirm, never as authoritative data.
"""

from __future__ import annotations

import re
from datetime import date as _date
from typing import Any

# Keywords marking the grand total, in French, English and Arabic. Ordered by
# specificity: "NET A PAYER" is a stronger signal than a bare "TOTAL", which can
# also appear in "TOTAL HT" or "SOUS-TOTAL".
TOTAL_KEYWORDS = (
    "NET A PAYER",
    "NET À PAYER",
    "TOTAL TTC",
    "MONTANT TTC",
    "TOTAL",
    "MONTANT",
    "A PAYER",
    "الإجمالي",
    "المجموع",
)

TAX_KEYWORDS = ("TVA", "T.V.A", "TAXE", "VAT", "الضريبة")

# 1 234,56 / 1.234,56 / 1234.56 / 284,50 DH - optional grouping, 2-decimal tail.
AMOUNT_RE = re.compile(r"(?<![\d])(\d{1,3}(?:[ . ]\d{3})*|\d+)[.,](\d{2})(?![\d])")
GROUPING_RE = re.compile(r"[ . ]")

DATE_RES = (
    re.compile(r"(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)"),            # 2026-08-01
    re.compile(r"(?<!\d)(\d{2})[/.\-](\d{2})[/.\-](\d{4})(?!\d)"),  # 01/08/2026
    re.compile(r"(?<!\d)(\d{2})[/.\-](\d{2})[/.\-](\d{2})(?!\d)"),  # 01/08/26
)

CONFIDENCE_FIELDS = ("amount", "taxAmount", "date", "merchantName")

# Below this, the UI marks the field as unreliable rather than merely scanned.
LOW_CONFIDENCE = 0.6


def _empty() -> dict[str, Any]:
    return {
        "amount": None,
        "taxAmount": None,
        "date": None,
        "merchantName": None,
        "confidence": {field: 0.0 for field in CONFIDENCE_FIELDS},
    }


def _y(block: dict) -> float:
    """Vertical centre of a block."""
    return sum(point[1] for point in block["box"]) / 4.0


def _x_left(block: dict) -> float:
    return min(point[0] for point in block["box"])


def _height(block: dict) -> float:
    ys = [point[1] for point in block["box"]]
    return max(ys) - min(ys)


def _width(block: dict) -> float:
    xs = [point[0] for point in block["box"]]
    return max(xs) - min(xs)


def _parse_amount(text: str) -> float | None:
    """Largest 2-decimal number in `text`, or None. Handles , and . separators."""
    best: float | None = None
    for whole, cents in AMOUNT_RE.findall(text):
        value = float(f"{GROUPING_RE.sub('', whole)}.{cents}")
        if best is None or value > best:
            best = value
    return best


def _parse_date(text: str) -> str | None:
    for pattern in DATE_RES:
        match = pattern.search(text)
        if not match:
            continue
        a, b, c = match.groups()
        if len(a) == 4:
            year, month, day = int(a), int(b), int(c)
        else:
            day, month, year = int(a), int(b), int(c)
            if year < 100:
                year += 2000
        try:
            return _date(year, month, day).isoformat()
        except ValueError:
            continue  # 99/99/9999 and friends
    return None


def _same_band(a: dict, b: dict) -> bool:
    """True when two blocks sit on the same printed line.

    Tolerance scales with text height so it holds for both a 12px receipt footer
    and a 40px header.
    """
    tolerance = max(_height(a), _height(b), 12.0) * 0.7
    return abs(_y(a) - _y(b)) <= tolerance


def _matches(text: str, keyword: str) -> bool:
    return keyword in text.upper() or keyword in text


def _find_labelled_amount(
    blocks: list[dict], keywords: tuple[str, ...]
) -> tuple[float | None, float]:
    """Amount on the same band as the best-matching keyword. Returns (value, confidence)."""
    for rank, keyword in enumerate(keywords):
        for label in blocks:
            if not _matches(label["text"], keyword):
                continue
            # Prefer a value printed to the right of the label - receipts are
            # laid out label-left, amount-right.
            candidates = [
                b
                for b in blocks
                if b is not label and _same_band(label, b) and _x_left(b) >= _x_left(label)
            ]
            candidates.sort(key=_x_left, reverse=True)
            for candidate in candidates:
                value = _parse_amount(candidate["text"])
                if value is not None:
                    # Earlier (more specific) keywords score higher.
                    penalty = min(rank, 4) * 0.03
                    return value, round(min(candidate["score"], 0.99) - penalty, 3)
            inline = _parse_amount(label["text"])
            if inline is not None:
                return inline, round(min(label["score"], 0.99) - 0.1, 3)
    return None, 0.0


def _fallback_amount(blocks: list[dict]) -> tuple[float | None, float]:
    """No usable keyword: take the largest amount in the bottom third of the receipt."""
    if not blocks:
        return None, 0.0
    ys = [_y(b) for b in blocks]
    threshold = min(ys) + (max(ys) - min(ys)) * (2 / 3)
    best: float | None = None
    for b in blocks:
        if _y(b) < threshold:
            continue
        value = _parse_amount(b["text"])
        if value is not None and (best is None or value > best):
            best = value
    if best is None:
        return None, 0.0
    # Deliberately below LOW_CONFIDENCE - the UI must flag this for review.
    return best, 0.4


def _find_merchant(blocks: list[dict]) -> tuple[str | None, float]:
    """Topmost wide, mostly-alphabetic block - receipts print the shop name first."""
    header = sorted(blocks, key=_y)[:6]
    best: dict | None = None
    for b in header:
        text = b["text"].strip()
        letters = sum(ch.isalpha() for ch in text)
        if len(text) < 3 or letters < len(text) * 0.5:
            continue  # phone numbers, ICE lines, separators
        if best is None or _width(b) > _width(best):
            best = b
    if best is None:
        return None, 0.0
    return best["text"].strip(), round(min(best["score"], 0.99) * 0.8, 3)


def _find_date(blocks: list[dict]) -> tuple[str | None, float]:
    for b in sorted(blocks, key=_y):
        parsed = _parse_date(b["text"])
        if parsed is not None:
            return parsed, round(min(b["score"], 0.99) * 0.9, 3)
    return None, 0.0


def extract(blocks: list[dict]) -> dict[str, Any]:
    """Turn OCR blocks into a best-effort expense suggestion."""
    if not blocks:
        return _empty()

    amount, amount_conf = _find_labelled_amount(blocks, TOTAL_KEYWORDS)
    if amount is None:
        amount, amount_conf = _fallback_amount(blocks)

    tax, tax_conf = _find_labelled_amount(blocks, TAX_KEYWORDS)
    # A bare "TVA" label can sit on the same band as the grand total, and a
    # "TVA 20%" line can yield the rate. Reject anything not plausibly a tax
    # component of the total.
    if tax is not None and amount is not None and tax >= amount:
        tax, tax_conf = None, 0.0

    parsed_date, date_conf = _find_date(blocks)
    merchant, merchant_conf = _find_merchant(blocks)

    return {
        "amount": amount,
        "taxAmount": tax,
        "date": parsed_date,
        "merchantName": merchant,
        "confidence": {
            "amount": amount_conf,
            "taxAmount": tax_conf,
            "date": date_conf,
            "merchantName": merchant_conf,
        },
    }
