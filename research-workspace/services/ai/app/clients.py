import io
from pathlib import Path
from typing import Any
import asyncpg
import boto3
import redis.asyncio as aioredis
from pgvector.asyncpg import register_vector

from .config import get_settings

_pool: asyncpg.Pool | None = None
_redis: aioredis.Redis | None = None
_s3 = None


class LocalStorageClient:
    """Local file-system storage fallback when MinIO/S3 is not running."""

    def __init__(self, root: Path | str | None = None):
        if root is None:
            self.root = Path(__file__).resolve().parents[3] / "storage"
        else:
            self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def head_bucket(self, Bucket: str):
        (self.root / Bucket).mkdir(parents=True, exist_ok=True)
        return {"ResponseMetadata": {"HTTPStatusCode": 200}}

    def put_object(self, Bucket: str, Key: str, Body: Any):
        dest = self.root / Bucket / Key
        dest.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(Body, bytes):
            dest.write_bytes(Body)
        elif hasattr(Body, "read"):
            dest.write_bytes(Body.read())
        else:
            dest.write_bytes(bytes(Body))
        return {"ResponseMetadata": {"HTTPStatusCode": 200}}

    def get_object(self, Bucket: str, Key: str):
        target = self.root / Bucket / Key
        if not target.exists():
            raise FileNotFoundError(f"Key not found: {Key}")
        return {"Body": io.BytesIO(target.read_bytes())}


async def _init_conn(conn: asyncpg.Connection) -> None:
    await register_vector(conn)


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            get_settings().database_url, min_size=1, max_size=10, init=_init_conn
        )
    return _pool


def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(get_settings().redis_url, decode_responses=True)
    return _redis


def get_s3():
    global _s3
    if _s3 is None:
        s = get_settings()
        if s.s3_endpoint_url in ("local", "", None):
            _s3 = LocalStorageClient()
        else:
            try:
                client = boto3.client(
                    "s3",
                    endpoint_url=s.s3_endpoint_url,
                    aws_access_key_id=s.s3_access_key,
                    aws_secret_access_key=s.s3_secret_key,
                    region_name=s.s3_region,
                )
                client.head_bucket(Bucket=s.s3_bucket)
                _s3 = client
            except Exception:
                _s3 = LocalStorageClient()
    return _s3


async def close_all() -> None:
    global _pool, _redis
    if _pool is not None:
        await _pool.close()
        _pool = None
    if _redis is not None:
        await _redis.aclose()
        _redis = None
