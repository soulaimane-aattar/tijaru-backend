"""API contract tests.

These need the heavy runtime deps (cv2, rapidocr). They are skipped on a bare
dev machine and run for real inside the container, where those deps exist:

    docker compose run --rm --entrypoint sh ocr -c \
      "pip install -q pytest httpx && python -m pytest tests -q"
"""

import io

import pytest

pytest.importorskip("cv2", reason="opencv not installed outside the container")
pytest.importorskip("rapidocr_onnxruntime", reason="rapidocr not installed outside the container")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)

# Smallest valid 1x1 PNG.
TINY_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def test_health_reports_ok():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_extract_rejects_a_non_image_payload():
    response = client.post(
        "/extract", files={"file": ("notes.txt", io.BytesIO(b"not an image"), "text/plain")}
    )
    assert response.status_code == 400


def test_extract_rejects_an_oversize_payload():
    response = client.post(
        "/extract", files={"file": ("big.png", io.BytesIO(b"\x00" * (9 * 1024 * 1024)), "image/png")}
    )
    assert response.status_code == 413


def test_extract_returns_blocks_and_suggestion(monkeypatch):
    """The engine is stubbed - this asserts the response contract, not OCR accuracy."""
    from app import main

    monkeypatch.setattr(
        main,
        "run_ocr",
        lambda _image: [
            {"text": "TOTAL", "box": [[20, 200], [100, 200], [100, 220], [20, 220]], "score": 0.9},
            {
                "text": "284,50",
                "box": [[300, 200], [380, 200], [380, 220], [300, 220]],
                "score": 0.9,
            },
        ],
    )
    response = client.post("/extract", files={"file": ("r.png", io.BytesIO(TINY_PNG), "image/png")})
    assert response.status_code == 200
    body = response.json()
    assert body["suggestion"]["amount"] == 284.50
    assert len(body["blocks"]) == 2


def test_extract_reports_500_when_the_engine_raises(monkeypatch):
    from app import main

    def boom(_image):
        raise RuntimeError("engine exploded")

    monkeypatch.setattr(main, "run_ocr", boom)
    response = client.post("/extract", files={"file": ("r.png", io.BytesIO(TINY_PNG), "image/png")})
    assert response.status_code == 500
