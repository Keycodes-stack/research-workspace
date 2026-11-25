# How a question is answered

## Outage: nothing is stored
If the cross-check cannot run (a model is down, out of quota, or returns unusable output), the ask endpoint returns
HTTP 503 with `error: cross_check_unavailable` and a plain `note`. No assistant message is saved. The browser shows the
note with a **Try again** button, which asks the same question again. Unexpected errors go to the global handler
(`app/errors.py`) and return a typed 500 with a `request_id` for the logs.

## Passages that match only loosely: `SIMILARITY_GATE`
Passages below `SIMILARITY_THRESHOLD` (default 0.76) are handled by the setting `SIMILARITY_GATE`:

- `lenient` (default): the models still read the closest passages. Every quote is checked against the source text, and
  claims the sources do not support are removed. The answer records `gate.below_threshold = true`.
- `strict`: nothing is sent to a model. The answer is "not similar enough" (`reason: below_similarity_threshold`), and a
  follow-up asked of saved sources bounces to an online search, as before.

## Closest evidence instead of a bare "not enough evidence"
When no claim can be verified but passages were found, the answer carries `related`: the closest passages, one per
source. The card shows them under **Closest evidence found**, labelled *not a verified answer*, with openable sources.
The Evidence Library does the same for a work package: its closest passages are stored as *pending* items, and the run
statement says that nothing was verified.

## Tests that cover this
- Outage: `test_cross_check_failure_withholds_the_answer` (503, nothing stored).
- Lenient: `test_loose_matches_still_go_to_the_models`, `test_loose_match_answers_are_metered`.
- Strict: `test_strict_gate_refuses_without_calling_any_model`, `test_strict_gate_refusal_costs_nothing`, and the
  bounce tests in `test_tasks_api.py` (they use `_strict`).
- Closest evidence: `tests/test_closest_evidence.py`, `tests/v2-closest-evidence.test.tsx`.
- The database test reset refuses any non-local, non-test database (`tests/test_db_guard.py`).

## Running the checks before a push
1. `scripts\test-db.ps1 start` (Docker Desktop must be running).
2. `scripts\check.ps1` runs the same steps as CI and prints every failure. Push only when it is green.
