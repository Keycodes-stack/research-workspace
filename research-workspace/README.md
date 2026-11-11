# Keycodes AI Research Workspace

Zero-hallucination, citation-verified research assistant for Pharma and Engineering R&D teams (client: Bill Belias).

Two open-weight models (Mistral Small 24B and Llama 3.1 8B) answer in parallel. Every claim is verified against stored source chunks (exact match + SHA-256) before the user sees it.

## Layout

```
apps/web/            Next.js frontend (Phase 6)
services/gateway/    Go API gateway: auth and routing (Phase 4)
services/ai/         FastAPI AI/RAG layer: retrieval, ingestion, orchestration, verification
db/migrations/       PostgreSQL + pgvector schema
infra/               Local infrastructure helpers
docker-compose.yml   Postgres (pgvector), Redis, MinIO (S3-compatible)
```

## Quick start

```bash
cp .env.example .env
docker compose up -d          # applies db/migrations on first start
cd services/ai
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-ml.txt   # local embedding model (PyTorch, large)
uvicorn app.main:app --reload --port 8000
curl localhost:8000/health
```

## Build phases

1. Foundation and database (done)
2. Scholarly retrieval pipeline: OpenAlex, Unpaywall, Europe PMC (done)
3. PDF ingestion and RAG engine: extraction, chunking, embeddings, cosine search (done)
4. Dual-model orchestration API + Go gateway (done)
5. Citation verification engine (done)
6. Next.js frontend (done)
7. Business case PDF export (done)
8. Testing and hardening

## Key invariants

- Models never answer from training memory; they only see retrieved chunks.
- Every chunk stores `sha256(text)`; citations are verified against it.
- Unverified claims are purged before display.
- Answers are refused if best cosine similarity is below 0.76.

## Running the tests

```bash
cd services/ai
pip install -r requirements-dev.txt
pytest                                   # unit tests; DB tests are skipped
TEST_DATABASE_URL=postgresql://rw:rw_dev_password@localhost:5432/rwtest pytest   # all tests
```

The integration tests DROP and recreate the `public` schema of the database they
are pointed at. Use a scratch database (pgvector 0.8+ required), never real data.

## Phase 6: web frontend (`apps/web`)

Next.js 15 (App Router, TypeScript, no UI framework). The browser talks only to the Go gateway.

```bash
cd apps/web && cp .env.example .env.local     # NEXT_PUBLIC_API_URL=http://localhost:8080
npm install && npm run dev                      # :3000   (npm run build && npm start for production)
npm test && npm run typecheck
```

- Sign in by pasting a JWT (dev: `go run ./cmd/mint-token`); a 401 signs the user out.
- Flow: projects -> sources (PDF upload, or discovery for open projects) -> task (choose sources, approve and lock)
  -> research session. The answer view shows: verified / disagreement / insufficient state, how many model
  claims were verified and removed, best source match vs the 0.76 gate, per-claim "confirmed by both" vs
  "single model", and per-citation source, page, match level and SHA-256, with the source passage and the
  quote highlighted. Disagreements show both positions side by side with their conditions.
- Backend additions: `GET /projects/{id}`, `GET /projects/{id}/tasks`, `GET /tasks/{id}`; `/ask` and message
  history return the final claims plus chunk metadata (`chunks`), so history renders identically.
- Full-stack check with no network or cloud keys (real Postgres + Go gateway + FastAPI with scripted models
  and the hashing embedder + production Next build + Playwright): see `infra/e2e/`.
  Start `fake_ai_app.py`, the gateway and `next start`, then run `browser_e2e.py TOKEN_FILE PDF OUT_DIR`.
  The harness is for development only; it replaces the real models and embedder.

## Phase 7: Business Case PDF export

`POST /threads/{id}/export/business-case` (through the gateway; button on the research-session page) returns an
A4 PDF. Body (all optional): `title`, `prepared_by`, `organization`, `message_ids` (default: every answer in the
session), `financial` (see below). **No model is called**: the report is assembled from stored, verified answers.

Sections: executive summary, key metrics, findings by question, unresolved disagreements and open questions,
financial projection, citations table (DOI and source-URL links for public papers; document name, page and line
range for uploaded documents; verbatim quote; SHA-256 of the checked passage), source register (file checksums),
approval chain (who approved the source lock and when, lock re-verified at export, blank lead-scientist and
reviewer signature lines), and a method and limitations statement. Footer carries a content fingerprint
(SHA-256 over findings and citations) and "Page x of y"; closed-repository reports are marked CONFIDENTIAL.

- **Re-verification at export:** every citation is re-checked against the live database (hash still matches its
  seal, quote still found). Failing findings are withheld and counted in the report, never shown.
- **Financial projection:** only if the author supplies assumptions (upfront cost, annual benefit and running cost,
  growth, discount rate, horizon). Results are Decimal arithmetic on those inputs, labelled "user-supplied
  assumptions, not derived from the sources". Without inputs the section says so; nothing is estimated.
- **Not included:** section headings (location is page and line range), signatures (blank lines to sign by hand),
  and any model-written narrative beyond the verified finding statements.
- The PDF uses the bundled DejaVu fonts in `app/export/fonts` (free licence) so Greek letters and symbols such as
  alpha, beta, micro and degree render correctly.
- The gateway exposes `Content-Disposition` and `X-Report-Fingerprint` to the browser (CORS).

## Phase 4: gateway and dual-model API

```
browser --JWT--> gateway (Go, :8080) --X-User-Id + X-Internal-Token--> AI service (FastAPI, :8000)
```

- The gateway verifies the JWT (HS256, `exp` required), rate-limits per user, caps request size,
  applies CORS, and forwards only `/projects`, `/tasks`, `/threads`, `/discover`. It never forwards
  the JWT. The AI service trusts identity headers only when `X-Internal-Token` matches, and checks
  that the caller owns every project, task and thread it touches (404 otherwise).
- Run locally (needs `INTERNAL_TOKEN`, `JWT_SECRET`, model keys or Ollama):

```bash
cd services/gateway
go run ./cmd/gateway                              # :8080
JWT_SECRET=... go run ./cmd/mint-token -sub 11111111-1111-4111-8111-111111111111   # dev token
go test -race ./...
```

- Flow: `POST /projects` -> upload PDFs (`/projects/{id}/sources/upload`) -> `POST /projects/{id}/tasks`
  -> `PUT /tasks/{id}/sources` -> `POST /tasks/{id}/approve` (seals the source set with a SHA-256 lock)
  -> `POST /tasks/{id}/threads` -> `POST /threads/{id}/ask`.
  Closed-repository tasks can only be asked after approval, and a changed source set is refused.
- `/ask` runs Model A and Model B in parallel, then Model B cross-checks, and a deterministic
  numeric check backs the judge up. Result is `consensus`, `disagreement` (both positions with their
  conditions) or `insufficient_evidence`. If the cross-check cannot complete, no answer is returned.

## Phase 5: citation verification

Every claim a model makes is checked by deterministic code (no model involved) against the stored
chunk text **before** the cross-check, so a fabricated claim can never create a fake consensus or a
fake disagreement. First failure purges the claim:

| Reason | Meaning |
|---|---|
| `quote_too_short` | fewer than 3 quote words, or an ellipsis segment under 2 words |
| `chunk_not_allowed` | cites a chunk that was not in the models' context |
| `unsealed` / `hash_mismatch` | chunk has no SHA-256 seal, or its text no longer matches it |
| `quote_not_found` | quote not in a cited chunk: exact, then normalised (case, quotes, dashes, line-break hyphens, whitespace), then fuzzy (token similarity >= 0.9) |
| `ungrounded_number:<n>` | a number (digits or spelled out) in the claim or its conditions is not in the cited chunks or their citation label |
| `weak_support` | the claim shares under half of its content-word stems with its own quote |

Fuzzy matching never tolerates a changed number or a dropped/added negation (not, no, never, without...).
Quotes may use `...` for ordered gaps. Verified claims record the match level and the SHA-256 they were
checked against; purged claims are recorded too (`citations` table, migration 003).

`/ask` also enforces:
- **Integrity filter:** retrieved chunks whose text no longer matches their hash are dropped before any model sees them.
- **0.76 similarity gate:** if the best remaining chunk is below `SIMILARITY_THRESHOLD`, the answer is
  `insufficient_evidence` / `below_similarity_threshold` and **no model is called**.
- Outcomes: `no_verifiable_claims` (every claim from the model(s) purged), `model_a_unverifiable` /
  `model_b_unverifiable` (one model had nothing left; shown as a disagreement), `integrity_failure`.
- Response carries `"verification": {"status": "complete", "verified": n, "purged": m}` and a `gate` object.

Known limits (to be measured in Phase 8): the support check is a lexical heuristic, not entailment, so a
real quote can still be paired with a claim that over-reads it; derived numbers (e.g. "3-fold") are
purged by design; the 0.76 threshold was set for bge-base and must be calibrated on real documents;
the Llama 8B judge remains the weakest link for subtle contradictions (the numeric check backs it up).

**Privacy:** with `mistral`/`groq` providers, retrieved chunk text is sent to those APIs. For
proprietary Mode B documents use `ollama` for both models.

## Phase 8 — Testing & hardening

**What changed in the verifier.** Phase 5 matched quotes and numbers only. Measured on a labelled suite it leaked 11 of 31 bad claims and wrongly purged 5 good ones. It now also:
- judges a claim against the *sentence* that holds the quote (not just the fragment), with `MIN_SUPPORT` raised 0.5 → 0.7;
- runs deterministic semantic guards: negation added/dropped, antonym direction (increase/decrease, above/below…), every `number + unit` the claim states must appear with that unit in the cited chunk, and absolute words (all, every, always, only…) the source does not use.

**Measured (run `python -m eval.verifier_suite` and `python -m eval.holdout_suite`):**

| Suite | Bad claims stopped | Good claims kept |
|---|---|---|
| Tuning (51 cases) | 31/31 | 17/20 |
| Held-out (29 cases, written after tuning) | 13/18 (72%) | 9/11 |
| Held-out, old verifier | 6/18 | 11/11 |

The tuning number is optimistic by construction. **The held-out number is the honest one: roughly a quarter of subtle bad claims can still leak.** Known leaks: swapped group associations (treated vs placebo percentages), a real number reattached to a different condition, "caused" vs "improved", "lost activity" vs "retained activity". These need semantic understanding, not string checks; the Model B cross-check and human sign-off are the defence there. Known wrongly-purged: heavy paraphrase, "one million" vs 10^6.

**End-to-end eval** (`python -m eval.run [--live] [--embedder bge] [--gate 0.76]`): 27 ground-truth questions over a synthetic corpus (answerable, conditional, unanswerable, conflict, injection, numeric traps) → retrieval recall/MRR, answer accuracy, refusal accuracy, adversarial injection (fabricated quote, number swap, negation, wrong chunk), and a gate sweep. Writes `eval/report.json` and `eval/report.md`.
- Offline mode uses scripted models and the hash embedder, so it tests the **pipeline only**. It is *not* evidence for the 0.76 gate and says nothing about Mistral/Llama quality.
- To calibrate 0.76 for real you need bge embeddings, real PDFs, and live Mistral/Groq keys, then `--live --embedder bge`.
- Observed offline: the verifier cannot catch an off-topic answer that quotes a real sentence faithfully (relevance to the question is the gate's and models' job).

**Stress tests** (`tests/test_stress.py`): blank/garbage/60-page PDFs, 12k-sentence chunk, fuzzy matching on huge text, degenerate quotes, homoglyph and zero-width tricks, prompt-delimiter breakout, 300 chunks/claims, 40 concurrent asks, garbage model output (fails closed), unknown chunk ids.

## Phase 9 — Signal Board

Mines **trends, opportunities and risks** from a project's sources. `POST /projects/{id}/signals/scan` runs one scan per category: retrieve → both models answer independently → every claim goes through the same deterministic verifier as `/ask` → only verified claims become signals. A claim found by both models is merged into one signal.

- **Confidence is computed, never model-stated:** high = both models and ≥2 distinct sources; medium = both models or ≥2 sources; low = one model, one source. Re-scans add evidence and recompute.
- **Evidence is re-checked on every read:** each signal's evidence shows the quote, page, source, and `intact` (sealed SHA-256 still equals the chunk's text and the quote is still in it).
- **Workflow:** dismiss / promote need a written reason; restore; merge duplicates (same project and category; evidence moves to the target). Invalid transitions return 409.
- The similarity gate applies to scans; below it, no model is called.
- Migration `004_signals.sql`; shared helper `app/synth.py` is reused by Concepts and department lenses.
- Limits: signals are only as good as the models' reading of retrieved chunks (top-k per scan, default 6 per query, so a large corpus is sampled not exhausted); duplicates phrased differently by the two models may stay separate until merged by hand; in closed-repository projects a scan covers all uploaded sources, not one task's approved set.

## Phase 10 — Concept Builder, rubric and department lenses

- **Concept** = a title + one or more *active* signals (dismissed/merged are refused with 409). Their verified evidence is copied in with the sealed hash.
- **Brief sections** (problem, hypothesis, approach, risks, next steps) are **written by people**. Models never write them. They are versioned: `PUT` with `base_version`; a stale version gets 409 with the current text so the UI can show the conflict. Activating a concept needs problem + hypothesis filled.
- **Rubric:** four human criteria (novelty, feasibility, impact, evidence strength, 1–5, one score per person per criterion, averaged across raters) and a separate **deterministic evidence score** (0–100: 50 for up to 5 distinct verified statements, 30 for up to 3 distinct sources, 20 for the share found by both models). They are never blended into one number. Evidence whose source changed is excluded and counted.
- **Department lenses** (R&D, Finance, Marketing, Legal): each runs both models over the concept's evidence plus retrieved passages, with a department-specific task, through the same verifier. Only quoted, verified statements remain. Finance is told never to calculate or estimate, and the verifier's number-grounding purges any figure not in the cited source. Regenerating a department replaces its previous items; an empty result is shown honestly ("no verifiable statements"), never padded.
- Evidence and lens items are re-hashed and re-quote-checked on every read; a changed source shows "SOURCE CHANGED".
- Migration `005_concepts.sql`.
- Limits: lenses surface what sources say, they do not analyse it (no cost model, no legal opinion). The finance lens will usually be empty unless sources state figures. Rubric scores are opinions of whoever scored.

## Phase 11 — Innovation Pipeline and decision log

Stages: Ideation → Evaluation → Validation → Pilot → Launched, plus Parked and Rejected. A concept moves one stage at a time via `POST /concepts/{id}/decisions` (`advance | park | reject | reopen`).

- **Gates are computed, not typed.** `GET /concepts/{id}/gates` shows each check for the next stage: active concept (problem + hypothesis); evidence score ≥ 40 for Validation and ≥ 60 for Pilot/Launch; at least one person scoring all four criteria; two scorers, all four department lenses generated, then feasibility and impact averages ≥ 3 and a written risks section for Launch. Thresholds are visible policy at the top of `routes_pipeline.py`.
- **Source integrity is a hard gate** (any evidence whose source text changed blocks advancing) and cannot be overridden. Other failed gates can be overridden with `override: true` and a reason of 30+ characters; the override is recorded.
- **Every decision needs a reason (10+ chars)** and stores the gate results at that moment. The log is append-only at the database level (update/delete triggers); it only disappears if its concept is deleted.
- Reopen returns a parked/rejected concept to the stage it left. The board is `GET /projects/{id}/pipeline`; UI at `/projects/{id}/pipeline` and a decision panel on each concept.
- Migration `006_pipeline.sql`.
- Limits: until Phase 12 any project owner can override a gate and there is a single owner per project, so "two scorers" can't yet be met by two real accounts. Thresholds are starting values, not calibrated to Bill's process.

## Phase 12 — Admin & Governance

**Roles per project** (`project_members`): viewer < researcher < lead_scientist < admin < owner. The project creator is the owner (database trigger; existing projects are backfilled). A non-member gets **404** (the API never confirms a project exists); a member with too low a role gets **403** naming the required role.

| Role | Can do |
|---|---|
| viewer | read everything in the project |
| researcher | upload/discover sources, create tasks and threads, ask, scan signals, build/score concepts, generate lenses |
| lead_scientist | approve tasks (lock sources), move concepts through the pipeline, export the Business Case PDF |
| admin | manage members up to lead scientist, set budget, read audit log and usage, **override failed pipeline gates** |
| owner | manage everyone; the last owner can't be removed or demoted |

- **Audit log:** project/task/source/ask/approve/export/member/budget/signal/concept/pipeline actions with actor, target and detail. Append-only in the database (update/delete triggers). Admin-only read, filter by action, paginate with `before`. A refused action (e.g. a researcher trying to approve) is not logged as done.
- **Usage and budget:** every model call is counted (retries included) with characters in/out, by activity and user. `PUT /projects/{id}/budget` sets a monthly model-call cap; once reached, asks, scans and lens generation return **429 before any model is called**. A gate refusal costs nothing.
- **UI:** `/projects/{id}/admin` (members and roles, usage and budget, audit log); the project page shows your role and hides Admin from non-admins; the API client turns 403/429 into plain messages.
- Migration `007_governance.sql`.
- Limits: members are added by **user ID**; there is no SSO/identity provider or user directory, so IDs come from whoever issues your JWTs (an admin pastes the UUID). The budget counts calls and characters, not tokens or money. One operation that starts under the cap may finish over it. A DOCX export of the Business Case was not built (PDF only). Roles are per project; there is no organisation-wide admin. Audit writes are best-effort: a failed audit insert is logged but does not undo the action.

## Phase 13 — Real-time collaboration

What it does on a concept page, for several people at once:
- **Live updates** over server-sent events (`GET /concepts/{id}/events`), fed by Postgres `LISTEN/NOTIFY`. Events carry **ids only, never text**; the browser refetches through the normal, permission-checked endpoints, so a stream can't leak content. Membership is checked (404) before a stream opens. Slow clients get a `resync` instead of unbounded memory; the browser reconnects with backoff and resyncs. The Go gateway never buffers streams (`FlushInterval -1`) and lifts the write deadline for `/events`.
- **Presence:** who is on the page and which section they are in (45 s heartbeat window; a closed tab is removed immediately).
- **Section editing:** every save carries the version it was based on. If someone else saved first you get **409 and their text**, and choose "use theirs" or "overwrite with mine". While you are typing, a remote save **never overwrites your draft**: you see a notice instead.
- **Advisory locks** (60 s, auto-expire, released on save/blur): other people see "being edited by …". They are hints; the version check is the real protection, so a lock can never trap a section.
- **Threaded discussion** with stances (support / challenge / question / note), replies, resolve/reopen (author or lead scientist), and an "open threads" summary per section. Comments are people's words, labelled not source-verified; they are not scores or votes.
- Migration `008_collaboration.sql`. Tests: 10 backend (stream delivery, no cross-concept leakage, heartbeat, overflow resync, cancellation cleanup), frontend parser and editor tests, a Go streaming test, and `infra/e2e/collab_browser.py`, which passed 7/7 with two real browsers on the real stack.

Found while testing live (and fixed): a browser closing the tab cancelled the stream task and its cleanup was cancelled too, so presence lingered and a database connection could leak (cleanup is now shielded, with a regression test); the gateway's 5 req/s limit rejected a busy collaboration session (default raised to 10 req/s, burst 60, and the page now coalesces event-driven refetches).

**Not built, on purpose:** this is not Google-Docs-style character-level co-editing (no CRDT/OT, no live cursors, no merged typing). Two people typing into the same section concurrently resolve through versions and the conflict panel. Live notifications work across several API processes (Postgres fans them out); presence and locks are stored in Postgres, not in memory. Redis is still unused.
