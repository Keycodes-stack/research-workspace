# Ask: which sources answer a question

Status: **local changes on top of `473bf09`; not committed, pushed or deployed.**
Local tests: AI service 142 passed (77 database tests need CI), verifier suites 42 passed, web 56 passed, typecheck clean.

## Rules (decided in `plan_evidence()`, `services/ai/app/routes_tasks.py`)

| Sources | First question in a chat | Follow-up questions |
|---|---|---|
| **My uploads** | Every upload in the project, from any chat (attached files are uploads, chunked and embedded when added). Never online. | Same |
| **Online** | Fresh OpenAlex + Europe PMC search. The APIs' top 10 papers are stored in the project and the answer uses only them. Uploads are never used. | The project's stored papers (from any chat) first. If they don't answer: tell the user, then search online. |
| **Uploads + online** | Uploads are searched **while** the fresh online search runs, giving **one combined answer**. | Uploads + the project's stored papers first. If they don't answer: tell the user, then search online again, combined with the uploads. |

"Don't answer" means the best match is below the similarity threshold (0.65). If nothing is stored yet, the online search runs straight away.

## Shared behaviour
- **Top 10 papers:** online searches take the top 10 papers in the APIs' own relevance order, with no re-ranking by citations or year. Papers the project already has are reused, not stored twice.
- **Stored with full text:** each paper is stored with its full text (the open-access PDF, otherwise the abstract) and embeddings.
- **Kept per project:** papers belong to the project, are kept permanently (the 14-day cleanup was removed), and are listed in the Knowledge Library.
- **No in-memory caches:** everything is served from the database.
- **Live progress:** the page polls `GET /threads/{id}/progress` every second and shows each step, e.g. "Stored 3 of 10: <title> (full text, 42 passages)".
- **"Not in saved sources" two-step:**
  1. The server replies `kind: "not_in_saved_sources"` and stores nothing.
  2. The page shows the note, then asks again with `evidence: "online"`.
  3. The question is stored only once.

## Edge cases covered
- **My uploads, no uploads in the project:** a clear message suggesting an upload or another Sources setting (`no_uploads`).
- **APIs return nothing** (down, rate-limited, or no results): "the online search returned no papers, try again" (`online_search_failed`).
- **Saving online papers fails:**
  - It's logged and reported in the progress steps and `gate.online.errors`.
  - Uploads + online still answers from the uploads instead of failing.
- **PDF fails to download or parse:** the paper falls back to its abstract. Papers with no PDF and no abstract are skipped.
- **Closed-repository projects:** never search online; they use the task's locked sources.
- **Uploads + online with no uploads:** goes straight to the online search.

## Removed
- `POST /threads/{id}/new-papers` and the "new papers saved" list under answers (unused under these rules).
- The second-answer idea for Uploads + online (replaced by one combined answer).

## Files
- **Backend:**
  - `services/ai/app/routes_tasks.py`
  - `app/ingest/service.py`
  - `app/routes_sources.py`
  - `app/retrieval/pipeline.py`
- **Tests:**
  - `tests/test_online_evidence.py`: `plan_evidence` for every scope and turn, refusal texts.
  - `tests/test_tasks_api.py`: database tests for each mode, concurrency and the edge cases.
- **Web:**
  - `apps/web/public/halden-bridge.js`
  - `apps/web/public/halden.html` (cache version `scope51`).

## Rollout
1. Run the database tests in CI (push a branch and open a pull request; that doesn't deploy).
2. Merge to `main`. Render redeploys the web app.
3. Run `deploy-vps.ps1` to update the AI service on the VPS.
