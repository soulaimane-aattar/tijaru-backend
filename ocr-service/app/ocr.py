"""RapidOCR engine wrapper.

RapidOCR runs PaddleOCR's trained models on ONNXRuntime. Same recognition
accuracy as PaddleOCR proper, ~80 MB of dependencies instead of ~500 MB, and
no long-running memory leak.

The engine is instantiated once at import time: model loading takes seconds and
must not happen per request.
"""

from __future__ import annotations

import os

import numpy as np
from rapidocr_onnxruntime import RapidOCR

_engine = RapidOCR()

# Arabic needs a second recognition pass, which roughly doubles latency. Off by
# default; enable with OCR_LANGS=fr,ar once Arabic receipts are a real workload.
ARABIC_ENABLED = "ar" in os.getenv("OCR_LANGS", "fr").split(",")


def run_ocr(image: np.ndarray) -> list[dict]:
    """Detect and recognise text. Returns blocks with native RapidOCR boxes."""
    result, _elapsed = _engine(image)
    if not result:
        return []
    return [
        {
            "text": text,
            "box": [[float(x), float(y)] for x, y in box],
            "score": float(score),
        }
        for box, text, score in result
    ]
