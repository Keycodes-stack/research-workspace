# Evidence Library: handoff (where we stopped)

Status as of 2026-11-24. Nothing is committed or pushed. Pick up from the **Next steps** list below.

## What the feature does

- Every research work package is researched by the AI engine:
  1. the top 10 papers by API relevance are stored (OpenAlex / Europe PMC, reusing the project's existing papers),
  2. the best passage from each paper goes to both models (A and B),
  3. model A also judges the two answers (as `/ask` does),
  4. the verified claims become **evidence items**, shown on the project's Evidence page.
- Runs start automatically when a project is created with work packages, and when a work package is added with the new button.
- Closed-repository projects use only their locked sources and never search online.
- Each run has a status: `queued`, `running`, `complete`, `failed`, `waiting` (closed repo with no sources yet).
- Startup sweep: runs still `queued` / `running` after 15 minutes are marked `failed`, so nothing stays stuck after a restart.

## What is built (uncommitted)

### Backend (`services/ai`)
- `db/migrations/021_evidence.sql`: tables `evidence_runs` (one per work package) and `evidence_items`. Additive only.
- `app/evidence.py` (new): question building, the run pipeline, evidence items, references block, and the endpoints:
  - `GET /projects/{id}/evidence` (totals, runs, items; filters `q`, `work_package`, `model`, `status`)
  - `GET /tasks/{id}/evidence`
  - `POST /tasks/{id}/evidence/run` (run again / retry; 409 if already running)
  - `GET /tasks/{id}/evidence/{item_id}` (passages with page and seal, judge statement)
- `app/routes_tasks.py`:
  - `create_project_complete` starts one run per work package (best effort).
  - New `POST /projects/{id}/work-packages` (the "+ New work package" button). Creates the code (WP-n), the research task, the starting Workspace document, and starts the run.
- `app/main.py`: router registered; startup sweep added.
- `app/config.py`: `evidence_context_token_budget = 5200`, `evidence_passages_per_source = 1` (separate from `/ask`).
- Earlier, uncommitted lenient-judge work (`judge_lenient`, `statement`, `differences`, model `status`/`notes`) is still in the tree and is reused.

### Frontend (`apps/web`)
- `components/v2/evidence/EvidenceLibrary.tsx` (new): replaces the design-only ledger on `/projects/[id]/evidence`. Totals, filters, work package run list with Run again / Retry, evidence records, details dialog, polls every 3 s while a run is active.
- `components/v2/projects/NewWorkPackage.tsx` (new): "+ New work package" button and form.
- `components/v2/projects/ProjectOverview.tsx`: button added to the Work Packages section.
- `lib/api.ts`: `projectEvidence`, `taskEvidence`, `runTaskEvidence`, `evidenceDetail`, `createWorkPackage`.
- `lib/types.ts`: evidence types.
- `app/(v2)/(app)/projects/[id]/evidence/page.tsx`: uses `EvidenceLibrary`, heading "Evidence Library".

### Tests
- `services/ai/tests/test_evidence.py` (new): 7 pure-logic tests. Pass.
- `apps/web/tests/v2-evidence-library.test.tsx` (new): 4 tests. Pass.
- `apps/web/tests/v2-new-work-package.test.tsx` (new): 2 tests. Pass.
- `apps/web/tests/v2-project-pages.test.tsx`: heading updated, mock extended. Pass.
- Last full runs: backend unit suite 212 passed, 85 skipped (DB tests). Web: `tsc --noEmit` clean; full vitest suite exited 0 (before the last component was added; the affected files pass).

## Known gaps (not done)

1. **References in the Workspace document.** Only written when the document is stored in the editor's rich-text format (`tiptap`). The Workspace editor saves in `sfdt`, so after a user's first manual save, references are not appended. The planned "Insert references" action in `DocEditor.tsx` is not built. `evidence_runs.references_added` is set to false in that case.
2. **Database-level tests are not written or run:** migration 021, the endpoints, the run lifecycle, the startup sweep. These need Postgres (CI or a scratch DB). There is no local Postgres and no Docker on this PC.
3. **Access date** is not stored. The record shows the publication year only.
4. **"Grok" tag** is not implemented. Tags show the configured models (Mistral, Groq). `ModelLogos.brandOf` has no Groq / Grok entry.
5. **Existing projects** do not auto-run (cost). They use the Run / Run again button.
6. **Leftover files** no longer used: `components/v2/evidence/EvidenceLedger.tsx`, `lib/v2/design/evidence.ts`. Delete when convenient.
7. **Cost:** each work package costs about three model calls per run, plus paper search and downloads.

## Incident to remember

While adding the endpoint, a bad string replacement pasted part of `routes_tasks.py` into the new code. It was repaired and verified (the file parses, imports, and the endpoint appears once). The diff looks right, but it is worth a glance during review.

## Next steps (in order)

1. Review the uncommitted changes (`git status`, `git diff`), especially `routes_tasks.py` after the repair.
2. Run the checks again:
   - `services/ai`: `./.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider`
   - `apps/web`: `npx tsc --noEmit -p .` and `npx vitest run`
3. Decide the references approach for editor-saved documents (gap 1). Options:
   - a client-side "Insert references" button in `DocEditor.tsx`, or
   - server-side handling of the `sfdt` format.
4. Write the DB tests (gap 2) for migration 021, the endpoints, the run lifecycle and the sweep, following the existing `TEST_DATABASE_URL` pattern. Run them in CI.
5. Commit and push only after the user confirms. Commit message and PR need the attribution lines from the system reminder. Ask before every push.
6. Deploy order when we ship: backend first (`docker compose -f docker-compose.vps.yml up -d --build` on the VPS, so migration 021 applies), then the Render frontend from the same commit. Upload a fresh `backend.tgz` first, since the server runs the copy uploaded on Nov 17.
7. Smoke test on the VPS: create a project with two work packages, check both runs reach `complete`, check the Evidence page totals, and check the Workspace references.

## Rollback

The evidence tables are additive and nothing existing depends on them. To disable the feature, remove the `schedule_project_runs` call in `create_project_complete` and the `schedule_runs` call in `create_work_package`. Or set the models to fail. Lenient judge can be turned off with `JUDGE_LENIENT=false`.
