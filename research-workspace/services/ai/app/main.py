import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .clients import close_all, get_pool, get_redis, get_s3
from .config import get_settings
from . import errors
from .deps import get_embedder
from .routes_admin import router as admin_router
from .routes_approvals import router as approvals_router
from .routes_collab import router as collab_router
from .routes_chats import router as chats_router
from .routes_concepts import router as concepts_router
from .routes_discovery import router as discovery_router
from .routes_export import router as export_router
from .routes_pipeline import router as pipeline_router
from .routes_signals import router as signals_router
from .routes_sources import router as sources_router
from .routes_tasks import router as tasks_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load the embedding model now, not on the first upload/question (saves ~35 s for that user).
    try:
        await asyncio.to_thread(get_embedder)
    except Exception:  # the endpoints report a clear 503 if it is truly unavailable
        pass
    yield
    await close_all()


app = FastAPI(title="Keycodes Research Workspace - AI Layer", lifespan=lifespan)
errors.install(app)

# No CORS here: this service is private. The gateway is the only public entry and sets CORS itself
# (two Access-Control-Allow-Origin headers make browsers reject the response).
app.include_router(discovery_router)
app.include_router(sources_router)
app.include_router(tasks_router)
app.include_router(chats_router)
app.include_router(export_router)
app.include_router(signals_router)
app.include_router(concepts_router)
app.include_router(pipeline_router)
app.include_router(admin_router)
app.include_router(collab_router)
app.include_router(approvals_router)


@app.get("/health")
async def health():
    status = {}

    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
            ext = await conn.fetchval("SELECT extname FROM pg_extension WHERE extname='vector'")
        status["postgres"] = "ok"
        status["pgvector"] = "ok" if ext else "missing"
    except Exception as e:
        status["postgres"] = f"error: {e.__class__.__name__}"

    try:
        await get_redis().ping()
        status["redis"] = "ok"
    except Exception as e:
        status["redis"] = f"error: {e.__class__.__name__}"

    try:
        get_s3().head_bucket(Bucket=get_settings().s3_bucket)
        status["s3"] = "ok"
    except Exception as e:
        status["s3"] = f"error: {e.__class__.__name__}"

    return {"ok": all(v == "ok" for v in status.values()), **status, "embedder": get_settings().embedder}
