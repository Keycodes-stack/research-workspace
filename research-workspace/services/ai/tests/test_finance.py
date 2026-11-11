from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.export.finance import FinancialInputs, project, q2


def test_simple_projection_is_exact():
    p = project(FinancialInputs(horizon_years=3, upfront_cost=1000, annual_benefit=600, annual_running_cost=100))
    assert [q2(r.cumulative) for r in p.rows] == [Decimal("-1000.00"), Decimal("-500.00"), Decimal("0.00"), Decimal("500.00")]
    assert q2(p.total_benefit) == Decimal("1800.00") and q2(p.total_cost) == Decimal("1300.00")
    assert q2(p.net_total) == Decimal("500.00") and q2(p.roi_pct) == Decimal("50.00")
    assert p.payback_years == Decimal(2)                       # cumulative reaches exactly 0 at the end of year 2
    assert q2(p.npv) == Decimal("500.00")                       # 0% discount


def test_discounting_growth_and_fractional_payback():
    p = project(FinancialInputs(horizon_years=2, upfront_cost=100, annual_benefit=100, benefit_growth_pct=10, discount_rate_pct=10))
    assert [q2(r.benefit) for r in p.rows] == [Decimal("0.00"), Decimal("100.00"), Decimal("110.00")]
    assert q2(p.npv) == q2(Decimal(-100) + Decimal(100) / Decimal("1.1") + Decimal(110) / Decimal("1.21"))
    assert q2(p.payback_years) == Decimal("1.00")


def test_payback_within_horizon_interpolates_and_none_when_never():
    p = project(FinancialInputs(horizon_years=5, upfront_cost=1000, annual_benefit=400))
    assert q2(p.payback_years) == Decimal("2.50")
    never = project(FinancialInputs(horizon_years=3, upfront_cost=1000, annual_benefit=100))
    assert never.payback_years is None and q2(never.roi_pct) == Decimal("-70.00")


def test_zero_upfront_has_no_roi_and_floats_do_not_drift():
    p = project(FinancialInputs(horizon_years=1, upfront_cost=0, annual_benefit=0.1 + 0.2))
    assert p.roi_pct is None and q2(p.total_benefit) == Decimal("0.30") and p.payback_years == Decimal(0)


@pytest.mark.parametrize("bad", [{"horizon_years": 0}, {"horizon_years": 21}, {"upfront_cost": -1},
                                 {"discount_rate_pct": 101}, {"currency": ""}, {"benefit_growth_pct": -60}])
def test_invalid_inputs_rejected(bad):
    with pytest.raises(ValidationError):
        FinancialInputs(**bad)
