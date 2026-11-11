"""Regression floors for the labelled suites. The tuning suite must keep stopping every bad claim; the
held-out suite is a floor, not a target (it contains HARD cases that are expected to leak)."""
from eval import holdout_suite, verifier_suite


def test_tuning_suite_never_leaks():
    r = verifier_suite.run_suite()
    assert r.fn == 0, r.leaks
    assert r.keep_recall >= 0.8


def test_holdout_floor():
    r = holdout_suite.run()
    assert r.purge_recall >= 0.7 and r.keep_recall >= 0.8


def test_old_verifier_is_worse_on_holdout():
    from app.verification.verifier import VerifyConfig
    old = holdout_suite.run(VerifyConfig(guards=False, min_support=0.5))
    assert holdout_suite.run().purge_recall > old.purge_recall


def test_offline_eval_shows_no_bad_claims(tmp_path):
    from eval import run
    rep = run.main(["--out", str(tmp_path)])
    assert all(v["bad_claims_shown"] == 0 for v in rep["adversarial"].values())
    assert rep["forbidden_strings_shown"] == 0 and rep["retrieval_recall_at_k"] == 1.0
