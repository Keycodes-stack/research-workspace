# Summary of Changes (Pending Push)

> Last updated: 2026-11-19

This document contains all changes made today that are currently staged or uncommitted in the local repository.

---

## 1. Paper Discovery & Ingestion Resilience (Bug Fixes & Scaling)
- **Error Handling (`services/ai/app/ingest/service.py`)**:
  - Wrapped individual PDF downloads, extraction, and abstract ingestion inside `try...except` blocks.
  - A single unparseable or failed PDF will no longer crash the entire batch with an HTTP 500 error; it now logs a warning, falls back to the paper's abstract, or marks the individual source as failed.
- **Discovery Pool Scaling (`services/ai/app/retrieval/openalex.py`, `pipeline.py`, `routes_sources.py`)**:
  - `openalex.py`: Increased `per_page` from 25 to 80.
  - `pipeline.py`: Increased `candidate_pool` from 30 to 80 and `top_n` from 8 to 20.
  - `routes_sources.py`: Increased `top_n` to 20 (up to 50 allowed) and raised `MIN_SOURCES_TO_SKIP` from 3 to 10 so searches do not prematurely short-circuit to 0 or 1 paper.

---

## 2. Docker & Environment Configuration
- **Next.js Proxy Rewriting (`apps/web/next.config.mjs`, `docker-compose.yml`)**:
  - Added support for `INTERNAL_API_URL` (`http://gateway:8080`) so that server-side proxy rewrites inside the Docker network resolve to the gateway container instead of throwing `ECONNREFUSED` on `localhost:8080`.
- **Dockerfile Syntax Headers (`apps/web/Dockerfile`, `services/ai/Dockerfile`, `services/gateway/Dockerfile`)**:
  - Removed `# syntax=docker/dockerfile:1` which caused TLS handshake timeouts in restricted network environments.
- **Database Connection (`.env`, `docker-compose.yml`)**:
  - Connected the local stack to the **Neon PostgreSQL Cloud Database** so all real research projects appear locally without data divergence.
  - Applied missing database migrations (`008`–`011_project_chats.sql`) to enable `tasks.kind` and `projects.meta`.

---

## 3. UI & Performance Improvements
- **Chat Routes & Active Project Dropdown (`services/ai/app/routes_chats.py`, `apps/web/public/halden-bridge.js`)**:
  - Added `/projects/{project_id}/chats` endpoint and loaded chat history dynamically.
  - Halden bridge now manages project selection via Redux Toolkit Query, actively populating the project `<select id="projsel">` element.
- **Skeleton Shimmer Loading (`apps/web/components/Skeleton.tsx`, `ProjectNav.tsx`, `app/globals.css`)**:
  - Created reusable `Skeleton`, `SkeletonText`, and `SkeletonCard` components with CSS shimmer animations.
  - Added visual loading states so pages do not feel slow or blank while loading project data.
- **Progressive Answer Status (`apps/web/app/threads/[id]/page.tsx`, `app/globals.css`)**:
  - Added dynamic progress stages ("Retrieving relevant passages…", "Model A is analyzing…", "Model B is cross-checking…", "Verifying citations…") with a pulse animation during AI queries.
- **Non-blocking Paper Discovery (`apps/web/public/halden-bridge.js`)**:
  - In Halden chat, paper discovery runs asynchronously in the background so the user gets immediate answers from indexed sources rather than waiting minutes.

---

## 4. File-by-File Change Log

| File Path | Type | Description |
| :--- | :--- | :--- |
| `services/ai/app/ingest/service.py` | Modified | Per-paper error boundaries; prevents 500 error on discovery. |
| `services/ai/app/retrieval/openalex.py` | Modified | Raised `per_page` query size to 80. |
| `services/ai/app/retrieval/pipeline.py` | Modified | Scaled `candidate_pool` (80) and `top_n` (20). |
| `services/ai/app/routes_sources.py` | Modified | Scaled `top_n` limits and increased skip threshold to 10. |
| `apps/web/next.config.mjs` | Modified | Added `INTERNAL_API_URL` fallback for internal Docker network routing. |
| `apps/web/Dockerfile` | Modified | Removed dockerfile syntax header; added build args. |
| `services/ai/Dockerfile` | Modified | Removed dockerfile syntax header. |
| `services/gateway/Dockerfile` | Modified | Removed dockerfile syntax header. |
| `docker-compose.yml` | Modified | Injected `INTERNAL_API_URL` into web; aligned AI container `DATABASE_URL`. |
| `.env` | Modified | Pointed `DATABASE_URL` to Neon DB; added token context budget. |
| `apps/web/public/halden-bridge.js` | Modified | Redux Toolkit Query sync, project switcher, non-blocking paper discovery. |
| `apps/web/components/Skeleton.tsx` | New | Skeleton shimmer placeholder component. |
| `apps/web/components/ProjectNav.tsx` | Modified | Added loading skeleton support. |
| `apps/web/app/globals.css` | Modified | Added shimmer keyframe and thinking animation styles. |
| `apps/web/app/threads/[id]/page.tsx` | Modified | Multi-stage dynamic thinking indicator. |

---

## 5. Session Changes — 2026-11-19

### 5a. Console Logging for Online Paper Discovery (`apps/web/public/halden-bridge.js`)
- The `ask()` function now logs a full discovery report to the browser DevTools console every time a question is asked in Online mode.
- Output includes: candidates found, usable papers, full-text vs abstract-only count, new sources added, dropped papers with reasons, and any network errors.
- Passes `top_n: 40` and `candidate_pool: 120` to the backend (up from defaults of 20/80).

### 5b. Discovery Limits Unlocked (`services/ai/app/routes_sources.py`)
- `top_n` max raised from `le=50` → `le=100`.
- `candidate_pool` now a request field (default 120, max 300) instead of hardcoded 80 in the route handler.
- Backend now uses `req.candidate_pool` from the request rather than a fixed value.

### 5c. Claim Verification Thresholds Relaxed (`services/ai/app/verification/verifier.py`)
- **Root cause of "0 sources / all claims removed"**: The fuzzy quote-matching threshold was `0.9` — too strict for online-discovered papers whose abstracts contain OCR artefacts, Unicode dashes, and whitespace differences compared to what the model quotes.
- `fuzzy_threshold` lowered: `0.9` → `0.72`
- `min_support` lowered: `0.7` → `0.6`
- This allows the verifier to match model quotes against abstract-only chunks without purging valid claims.

---

## 6. File-by-File Change Log (Session 2026-11-19)

| File Path | Type | Description |
| :--- | :--- | :--- |
| `apps/web/public/halden-bridge.js` | Modified | Console discovery log: candidates, usable, full/abstract split, new sources table, dropped reasons. |
| `services/ai/app/routes_sources.py` | Modified | `top_n` cap → 100; `candidate_pool` now a request param (default 120, max 300). |
| `services/ai/app/verification/verifier.py` | Modified | Fuzzy threshold 0.9→0.72; min_support 0.7→0.6 to fix "all claims removed" on discovered papers. |
