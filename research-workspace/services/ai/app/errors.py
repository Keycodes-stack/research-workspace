"""One error format for every endpoint, so the UI and the logs can say exactly what broke.

Every failure response body is {"detail": ..., "error": {code, message, where, request_id}}. `detail` keeps the
shape FastAPI clients already read; `error` adds the stable code, the route that failed and an id to grep the logs.
"""
import logging
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

log = logging.getLogger("app.errors")

CODES = {400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not_found", 409: "conflict",
         413: "too_large", 415: "unsupported_media", 422: "invalid_input", 429: "rate_limited",
         502: "upstream_failed", 503: "unavailable", 504: "upstream_timeout"}


def _body(request: Request, status: int, detail, code: str, message: str) -> JSONResponse:
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    if isinstance(detail, dict) and isinstance(detail.get("error"), str):
        code = detail["error"]                      # e.g. cross_check_unavailable
        message = detail.get("note") or message
    err = {"code": code, "message": message, "where": f"{request.method} {request.url.path}", "request_id": rid}
    return JSONResponse({"detail": detail, "error": err}, status_code=status, headers={"x-request-id": rid})


def install(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        message = exc.detail if isinstance(exc.detail, str) else CODES.get(exc.status_code, "error").replace("_", " ")
        resp = _body(request, exc.status_code, exc.detail, CODES.get(exc.status_code, "error"), message)
        if exc.status_code >= 500:
            log.warning("%s %s -> %s %s", request.method, request.url.path, exc.status_code, exc.detail)
        if exc.headers:
            resp.headers.update(exc.headers)
        return resp

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        errors = exc.errors()
        first = errors[0] if errors else {}
        message = f"{'.'.join(str(p) for p in first.get('loc', []))}: {first.get('msg', 'invalid input')}"
        return _body(request, 422, errors, "invalid_input", message)

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        resp = _body(request, 500, "internal error", "internal_error", f"{exc.__class__.__name__}: {exc}"[:300])
        log.exception("unhandled error in %s %s [request_id=%s]",
                      request.method, request.url.path, resp.headers["x-request-id"])
        return resp
