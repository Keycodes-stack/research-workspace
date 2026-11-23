"""Images attached to a project. The file goes to object storage; the database keeps its metadata."""
import asyncio
import logging
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile

from .access import check_role, project_for_user, project_with
from .auth import require_user
from .clients import get_pool, get_s3
from .config import get_settings
from .governance import audit

log = logging.getLogger(__name__)
router = APIRouter(tags=["attachments"])

MAX_IMAGE_BYTES = 10 * 1024 * 1024
# content type -> the first bytes every file of that type starts with (checked, not trusted from the name)
IMAGE_SIGNATURES = {
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/gif": (b"GIF87a", b"GIF89a"),
}


def image_type(data: bytes) -> str | None:
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    for content_type, signatures in IMAGE_SIGNATURES.items():
        if any(data.startswith(sig) for sig in signatures):
            return content_type
    return None


@router.post("/projects/{project_id}/attachments", status_code=201)
async def upload_attachment(project_id: str, file: UploadFile = File(...), project=Depends(project_with("researcher")),
                            user: UUID = Depends(require_user), pool=Depends(get_pool), s3=Depends(get_s3)):
    data = await file.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "The image is larger than 10 MB.")
    content_type = image_type(data)
    if content_type is None:
        raise HTTPException(415, "Only PNG, JPEG, GIF and WebP images can be attached.")
    filename = (file.filename or "image").replace("/", "_").replace("\\", "_")[:255] or "image"
    attachment_id = uuid4()
    key = f"projects/{project['id']}/attachments/{attachment_id}"
    s = get_settings()
    await asyncio.to_thread(s3.put_object, Bucket=s.s3_bucket, Key=key, Body=data)
    try:
        await pool.execute(
            """INSERT INTO project_attachments (id, project_id, uploaded_by, filename, content_type, size_bytes, storage_key)
               VALUES ($1, $2, $3, $4, $5, $6, $7)""",
            attachment_id, project["id"], user, filename, content_type, len(data), key)
    except Exception:
        # no row points at the file, so remove it rather than leave it behind
        await asyncio.to_thread(s3.delete_object, Bucket=s.s3_bucket, Key=key)
        raise
    await audit(pool, project["id"], user, "project.attachment.add", "attachment", attachment_id, filename=filename)
    return {"id": attachment_id, "filename": filename, "content_type": content_type, "size_bytes": len(data)}


@router.get("/projects/{project_id}/attachments")
async def list_attachments(project=Depends(project_for_user), pool=Depends(get_pool)):
    rows = await pool.fetch(
        """SELECT id, filename, content_type, size_bytes, created_at FROM project_attachments
           WHERE project_id=$1 ORDER BY created_at""", project["id"])
    return {"attachments": [dict(r) for r in rows]}


@router.get("/attachments/{attachment_id}/file")
async def attachment_file(attachment_id: UUID, user: UUID = Depends(require_user), pool=Depends(get_pool), s3=Depends(get_s3)):
    row = await pool.fetchrow(
        """SELECT a.storage_key, a.content_type, a.filename, m.role::text AS role
           FROM project_attachments a JOIN project_members m ON m.project_id = a.project_id AND m.user_id = $2
           WHERE a.id = $1""", attachment_id, user)
    if row is None:
        raise HTTPException(404, "attachment not found")
    check_role(row["role"], "viewer", "attachment")
    s = get_settings()
    obj = await asyncio.to_thread(s3.get_object, Bucket=s.s3_bucket, Key=row["storage_key"])
    data = obj["Body"].read() if hasattr(obj["Body"], "read") else obj["Body"]
    return Response(content=data, media_type=row["content_type"],
                    headers={"Content-Disposition": f'inline; filename="{row["filename"]}"', "X-Content-Type-Options": "nosniff"})


@router.delete("/attachments/{attachment_id}", status_code=204)
async def delete_attachment(attachment_id: UUID, user: UUID = Depends(require_user), pool=Depends(get_pool), s3=Depends(get_s3)):
    """Removes the image and its stored file."""
    row = await pool.fetchrow(
        """SELECT a.project_id, a.storage_key, m.role::text AS role FROM project_attachments a
           JOIN project_members m ON m.project_id = a.project_id AND m.user_id = $2 WHERE a.id = $1""", attachment_id, user)
    if row is None:
        raise HTTPException(404, "attachment not found")
    check_role(row["role"], "researcher", "attachment")
    await pool.execute("DELETE FROM project_attachments WHERE id = $1", attachment_id)
    s = get_settings()
    try:
        await asyncio.to_thread(s3.delete_object, Bucket=s.s3_bucket, Key=row["storage_key"])
    except Exception:
        log.exception("attachment %s removed from the project, but its stored file could not be deleted", attachment_id)
    await audit(pool, row["project_id"], user, "project.attachment.delete", "attachment", attachment_id)
    return Response(status_code=204)
