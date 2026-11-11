"""Deterministic financial projection from USER-SUPPLIED assumptions only.

Nothing here is derived from the sources or from a model: the report labels this section as
assumptions, and every figure is plain arithmetic on the inputs. Decimal is used so that
the numbers in the PDF are exact and reproducible."""
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

from pydantic import BaseModel, Field


class FinancialInputs(BaseModel):
    currency: str = Field(default="USD", min_length=1, max_length=8)
    horizon_years: int = Field(default=5, ge=1, le=20)
    upfront_cost: float = Field(default=0, ge=0, le=1e12)
    annual_benefit: float = Field(default=0, ge=0, le=1e12)
    annual_running_cost: float = Field(default=0, ge=0, le=1e12)
    benefit_growth_pct: float = Field(default=0, ge=-50, le=100)     # per year, from year 2
    discount_rate_pct: float = Field(default=0, ge=0, le=100)
    note: str | None = Field(default=None, max_length=1000)


@dataclass
class Row:
    year: int
    benefit: Decimal
    cost: Decimal
    net: Decimal
    cumulative: Decimal
    discounted: Decimal


@dataclass
class Projection:
    inputs: FinancialInputs
    rows: list[Row] = field(default_factory=list)      # row 0 is the upfront outlay
    total_benefit: Decimal = Decimal(0)
    total_cost: Decimal = Decimal(0)
    net_total: Decimal = Decimal(0)
    npv: Decimal = Decimal(0)
    roi_pct: Decimal | None = None
    payback_years: Decimal | None = None


def _d(x: float) -> Decimal:
    return Decimal(str(x))


def q2(x: Decimal) -> Decimal:
    return x.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def project(inp: FinancialInputs) -> Projection:
    up, ben, run = _d(inp.upfront_cost), _d(inp.annual_benefit), _d(inp.annual_running_cost)
    g, r = _d(inp.benefit_growth_pct) / 100, _d(inp.discount_rate_pct) / 100
    p = Projection(inp)

    cum = -up
    p.rows.append(Row(0, Decimal(0), up, -up, cum, -up))
    payback = None
    for t in range(1, inp.horizon_years + 1):
        b = ben * (1 + g) ** (t - 1)
        net = b - run
        prev = cum
        cum += net
        p.rows.append(Row(t, b, run, net, cum, net / (1 + r) ** t))
        if payback is None and prev < 0 <= cum:
            payback = Decimal(t - 1) + (-prev / net)        # linear within the year
    p.total_benefit = sum((x.benefit for x in p.rows), Decimal(0))
    p.total_cost = sum((x.cost for x in p.rows), Decimal(0))
    p.net_total = p.total_benefit - p.total_cost
    p.npv = sum((x.discounted for x in p.rows), Decimal(0))
    if up > 0:
        p.roi_pct = p.net_total / up * 100
    if payback is None and up == 0 and cum >= 0:
        payback = Decimal(0)
    p.payback_years = payback
    return p
