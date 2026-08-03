"""Image conditioning before OCR.

Phone photos of thermal receipts are the worst case: low contrast, small text,
uneven lighting. Normalising here costs milliseconds and measurably improves
recognition on faded print.
"""

from __future__ import annotations

import cv2
import numpy as np

MIN_WIDTH = 1000
MAX_WIDTH = 2200


def prepare(image_bytes: bytes) -> np.ndarray:
    """Decode, rescale, normalise contrast.

    Raises ValueError when the payload is not a decodable image - the caller
    turns that into a 400 rather than letting it reach the OCR engine.
    """
    buffer = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("unsupported or corrupt image")

    height, width = image.shape[:2]
    if width < MIN_WIDTH:
        scale = MIN_WIDTH / width
        image = cv2.resize(image, (MIN_WIDTH, int(height * scale)), interpolation=cv2.INTER_CUBIC)
    elif width > MAX_WIDTH:
        scale = MAX_WIDTH / width
        image = cv2.resize(image, (MAX_WIDTH, int(height * scale)), interpolation=cv2.INTER_AREA)

    # CLAHE on the luminance channel: lifts faded thermal print without blowing
    # out already-dark ink the way global histogram equalisation does.
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    lightness, a, b = cv2.split(lab)
    lightness = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(lightness)
    return cv2.cvtColor(cv2.merge((lightness, a, b)), cv2.COLOR_LAB2BGR)
