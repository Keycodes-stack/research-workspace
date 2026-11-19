# Ask and research source behavior

Status: **work in progress; not committed, pushed, or deployed.**

## Source modes

| Sources selection | Behavior |
|---|---|
| **My uploads** (`uploads`) | Search uploaded documents only. If they do not support an answer, return insufficient evidence. There is no Search online button and no online request. |
| **Online** (`api`) | Run a fresh OpenAlex + Europe PMC search for each question, take the APIs' top 10 relevant papers, store/reuse their project records, and answer only from those papers. Uploaded documents are excluded. |
| **Uploads + online** (`both`) | Search saved project sources while the fresh online search runs. Store the online papers and combine passages from saved sources and the new papers into one cited answer. |

## Shared behavior

- Keep papers permanently in the project database and list them in the Knowledge Library.
- Store open-access full text when available, otherwise the abstract, with embeddings.
- Select papers in API relevance order, without re-ranking by citation count or year.
- The waiting answer polls `GET /threads/{id}/progress` every second. Upload search completion and online search/storage steps are shown as they arrive; one final answer is generated from the combined evidence.
- Source records and answer history come from the database. Progress is temporary status only.

## Implementation notes

- `services/ai/app/routes_tasks.py`: the `both` mode runs saved-source retrieval and `search_and_store()` concurrently, then retrieves passages from the newly available online papers and combines them for the answer. `api` mode performs a fresh online search and excludes uploads. `uploads` mode does not search online.
- `services/ai/app/ingest/service.py`: online papers are ingested into the project library.
- `services/ai/app/routes_sources.py`: removed the 14-day purge of uncited online papers.
- `services/ai/app/retrieval/pipeline.py`: removed the in-memory paper search cache.
- `services/ai/app/online_evidence.py`: removed the former abstract-only/vector-cache path.
- `services/ai/tests/test_tasks_api.py`: database integration coverage for project-level persistence, fresh Online searches, uploads exclusion, and concurrent Uploads + online work.
- `apps/web/public/halden-bridge.js` and `halden.html`: submit the selected source scope and display live progress. The background new-papers request is limited to Uploads + online mode. Cache query version is `scope50`.
- The web app is hosted separately. VPS deployment should rebuild the AI and gateway services only.

## Verification and rollout

- Last local AI run: 140 passed, 73 skipped. Database-backed tests skip without `TEST_DATABASE_URL`.
- Last web run: 56 passed; TypeScript typecheck passed.
- No GitHub Actions workflow is checked into this repository. The local Docker daemon was unavailable, so the database tests and remote CI were not run here.
- The live site still needs verification with a safe test project. Do not send test questions to real project data.
- Commit/push and deployment are pending. The repo's VPS compose file documents `docker compose -f docker-compose.vps.yml up -d --build`; deploy only `ai` and `gateway` for backend-only changes.

## Known trade-off

The final answer waits for both saved-source retrieval and online ingestion. The UI streams progress and paper-storage updates, not a provisional uploads-only answer.
