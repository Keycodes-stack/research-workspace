from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app import errors


def make_app():
    app = FastAPI()
    errors.install(app)

    @app.get("/boom")
    async def boom():
        raise RuntimeError("database exploded")

    @app.get("/busy")
    async def busy():
        raise HTTPException(503, {"error": "cross_check_unavailable", "note": "Models are busy."})

    @app.get("/n/{x}")
    async def n(x: int):
        return x

    return TestClient(app, raise_server_exceptions=False)


def test_unhandled_exception_returns_structured_500():
    r = make_app().get("/boom")
    e = r.json()["error"]
    assert r.status_code == 500 and e["code"] == "internal_error"
    assert e["message"] == "RuntimeError: database exploded" and e["where"] == "GET /boom"
    assert e["request_id"] == r.headers["x-request-id"]


def test_http_error_keeps_detail_and_adds_code():
    r = make_app().get("/busy")
    assert r.json()["detail"]["error"] == "cross_check_unavailable"
    assert r.json()["error"]["code"] == "cross_check_unavailable" and r.json()["error"]["message"] == "Models are busy."


def test_validation_error_names_the_field():
    r = make_app().get("/n/abc")
    assert r.status_code == 422 and r.json()["error"]["message"].startswith("path.x:")
