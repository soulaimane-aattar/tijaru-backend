"""Receipt OCR service.

Stateless: holds no database connection and stores nothing. The NestJS backend
owns the image file; this service only ever sees bytes in flight, and is
reachable only on the compose network.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, File, HTTPException, UploadFile

from app.extract import extract
from app.ocr import run_ocr
from app.preprocess import prepare

MAX_BYTES = 8 * 1024 * 1024

log = logging.getLogger("ocr")
app = FastAPI(title="Tijaru OCR", version="1.0.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/extract")
async def extract_receipt(file: UploadFile = File(...)) -> dict:
    payload = await file.read()
    if len(payload) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="image too large")

    try:
        image = prepare(payload)
    except ValueError:
        raise HTTPException(status_code=400, detail="unsupported or corrupt image") from None

    try:
        blocks = run_ocr(image)
    except Exception:
        log.exception("ocr engine failed")
        raise HTTPException(status_code=500, detail="ocr failed") from None

    return {"blocks": blocks, "suggestion": extract(blocks)}
