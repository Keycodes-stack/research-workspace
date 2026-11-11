from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .clients import close_all, get_pool, get_redis, get_s3
from .config import get_settings
from .routes_admin import router as admin_router
from .routes_collab import router as collab_router
from .routes_concepts import router as concepts_router
from .routes_discovery import router as discovery_router
from .routes_export import router as export_router
from .routes_pipeline import router as pipeline_router
from .routes_signals import router as signals_router
from .routes_sources import router as sources_router
from .routes_tasks import router as tasks_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await close_all()


app = FastAPI(title="Keycodes Research Workspace - AI Layer", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(discovery_router)
app.include_router(sources_router)
app.include_router(tasks_router)
app.include_router(export_router)
app.include_router(signals_router)
app.include_router(concepts_router)
app.include_router(pipeline_router)
app.include_router(admin_router)
app.include_router(collab_router)


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

    return {"ok": all(v == "ok" for v in status.values()), **status}
