# Codex change log and VPS deployment

## Current ask and research behavior

- **My uploads** searches only uploaded documents. If those documents cannot support the answer, the app returns insufficient evidence. There is no “Search online” button and this mode never calls the online APIs.
- **Online** runs a fresh OpenAlex + Europe PMC search on each question, selects up to 10 papers in API relevance order, stores/reuses their project database records, and answers using online papers only. Uploaded documents are excluded.
- **Uploads + online** searches the project's saved sources while the OpenAlex + Europe PMC search and paper ingestion run concurrently. It retrieves passages from the newly available papers, combines both source groups, then produces one final cited answer.
- Live progress polling reports saved-source completion and online search/storage steps as they happen. The selected streaming behavior is progress and paper updates followed by one final combined answer; there is no provisional uploads-only answer.
- Papers and embeddings are stored permanently per project and appear in the Knowledge Library. Search results and answer history are read from the database. Progress is temporary status, not source data.

## Code changes in this working tree

- Backend Ask flow in `services/ai/app/routes_tasks.py` supports uploads-only, fresh Online search, and parallel Uploads + online search/ingestion.
- `services/ai/app/ingest/service.py` stores ingested papers in the project library.
- `services/ai/app/routes_sources.py` no longer purges uncited online papers after 14 days.
- `services/ai/app/retrieval/pipeline.py` no longer caches paper searches in memory; `services/ai/app/online_evidence.py` was removed with the older abstract-only/vector-cache path.
- `services/ai/tests/test_tasks_api.py` includes database integration coverage for online persistence/reuse, fresh Online searches that exclude uploads, and concurrent saved-source/online work.
- `apps/web/public/halden-bridge.js` submits the selected mode and polls live search progress. `apps/web/public/halden.html` launches the background new-paper request only in Uploads + online mode; its bridge cache key is now `scope50`.
- `docs/ASK_SOURCES_CHANGES.md` documents the updated behavior and current verification limits.

## Verification status

- Latest local AI run: 140 passed and 74 skipped; database tests were skipped because `TEST_DATABASE_URL` was not set.
- Latest web run: 56 passed; TypeScript typecheck passed.
- This repository has no checked-in GitHub Actions workflow. Docker is installed locally but its daemon was not running, so local database tests could not run.
- The user reports backend-only commit `d0028eb` (verifier file and its test) is pushed. The current local `services` tree also contains the later backend changes and is the code to transfer for this rollout.
- The web frontend is hosted separately (Render); the VPS compose file runs the backend services.

## VPS deployment commands

Transfer the current backend source tree from PowerShell, excluding local virtual environments, caches, and `.env`, then rebuild the AI service. The frontend is hosted separately and the gateway has no code changes.

```powershell
cd "C:\Users\dell\OneDrive\Desktop\keycodes\research-workspace\research-workspace"
cmd /c "tar -czf - --exclude=.venv --exclude=__pycache__ --exclude=.pytest_cache --exclude=.env services | ssh root@162.35.31.162 tar -xzf - -C /root/app"
ssh root@162.35.31.162 "cd /root/app; docker compose -f docker-compose.vps.yml up -d --build ai; sleep 80; docker compose -f docker-compose.vps.yml ps ai"
```

The transfer updates only `/root/app/services`; it does not transfer `.env` or rebuild the separately hosted frontend. Success is `app-ai-1` showing `healthy`. If it is not healthy, inspect `docker compose -f docker-compose.vps.yml logs --tail=100 ai` from `/root/app`. This agent session could not authenticate to the VPS (`Permission denied (publickey,password)`), so the transfer/rebuild must be run in the user's PowerShell session.
