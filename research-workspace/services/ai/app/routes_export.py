"""Business Case PDF export for a research session."""
import re
from uuid import UUID

from fastapi import APIRouter, Depends, Response

from .auth import require_user
from .clients import get_pool
from .export.data import ExportOptions, collect_report
from .export.pdf import render_pdf
from .governance import audit

router = APIRouter(tags=["export"])


@router.post("/threads/{thread_id}/export/business-case")
async def export_business_case(
    thread_id: UUID, opts: ExportOptions, user: UUID = Depends(require_user), pool=Depends(get_pool),
):
    """Build the report from stored, verified data only (no model calls) and return it as a PDF.
    Ownership is enforced inside collect_report (404 for other users' threads)."""
    data = await collect_report(pool, thread_id, user, opts)
    pdf = render_pdf(data)
    pid = await pool.fetchval("SELECT t.project_id FROM threads th JOIN tasks t ON t.id=th.task_id WHERE th.id=$1", thread_id)
    await audit(pool, pid, user, "export.business_case", "thread", thread_id, fingerprint=data.fingerprint)
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", data.title).strip("_")[:60] or "business-case"
    return Response(pdf, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="{name}_business_case.pdf"',
        "X-Report-Fingerprint": data.fingerprint,
        "Cache-Control": "no-store",
    })
