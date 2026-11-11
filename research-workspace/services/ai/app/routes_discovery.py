from dataclasses import asdict

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .auth import require_user
from .config import get_settings
from .retrieval.models import DiscoveryQuery
from .retrieval.pipeline import discover

router = APIRouter(prefix="/discover", tags=["discovery"], dependencies=[Depends(require_user)])


class DiscoverRequest(BaseModel):
    question: str = Field(min_length=3)
    required_terms: list[str] = []
    exclude_terms: list[str] = []
    from_year: int | None = None
    top_n: int = Field(default=8, ge=1, le=25)


@router.post("")
async def discover_papers(req: DiscoverRequest):
    result = await discover(
        DiscoveryQuery(
            question=req.question,
            required_terms=req.required_terms,
            exclude_terms=req.exclude_terms,
            from_year=req.from_year,
        ),
        contact_email=get_settings().contact_email,
        top_n=req.top_n,
    )
    return {
        "papers": [asdict(p) for p in result.papers],
        "dropped": [{"title": p.title, "doi": p.doi, "reason": r} for p, r in result.dropped],
        "stats": result.stats,
        "errors": result.errors,
    }
