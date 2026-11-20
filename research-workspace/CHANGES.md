# All changes, 19 Nov 2026

All changes from 19 Nov 2026, in one place. Every commit below is on `main`, and **CI passed on the latest commit (`ed81cf4`)**.
For diagrams of the current Ask flow, see [flow.md](flow.md).

## Deployment status

| Part | Where | State |
|---|---|---|
| Web app (`apps/web`) | Render | ⚠️ **Still on an old version** (`scope50`). Render didn't auto-deploy the last pushes: use **Manual Deploy → Deploy latest commit** |
| AI service (`services/ai`) | VPS `162.35.31.162` | ⚠️ **Needs the upload and rebuild** (commands at the end) |
| Gateway (`services/gateway`) | VPS | No changes |

---

## 1. How Ask chooses its sources (current behaviour)

Decided in `plan_evidence()` in `services/ai/app/routes_tasks.py`. **The Sources setting is checked first.**

| Sources | First question in a chat | Follow-up questions |
|---|---|---|
| **My uploads** | Every upload in the project, from any chat. **Never searches online.** | Same, never online, even when nothing answers |
| **Online** | Fresh OpenAlex + Europe PMC search; stores the top 10 papers; answers only from them (uploads never used) | The project's stored papers first. If they don't answer: tell the user, then search online |
| **Uploads + online** | Uploads are searched **while** the online search runs, giving **one combined answer** | Uploads + stored papers first. If they don't answer: tell the user, then search uploads + online again |

**"Don't answer"** means either of these:
- the best match is below **0.65**, or
- the saved sources are on topic, but the models find **no verified answer** in them.

If nothing is stored yet, the online search runs straight away.

**How the user is told first:**
1. The server replies `not_in_saved_sources` and stores nothing.
2. The page shows *"No relevant information in this project's N saved sources. Searching OpenAlex and Europe PMC…"*.
3. The page asks again with `evidence: "online"`.
4. The question is stored only once.

### Online papers
- **Top 10, as ranked:** the search takes the APIs' top 10 in their **own relevance order**, with no re-ranking by citations or year.
- **Full text:** each paper is stored with its full text (open-access PDF, otherwise the abstract), plus chunks and embeddings.
- **Per project:** papers belong to the **project**, so every chat uses them. They're **kept permanently** (the 14-day cleanup was removed) and **listed in the Knowledge Library**.
- **No duplicates:** papers the project already has are reused, not stored twice.
- **No in-memory caches:** everything is served from the database.

### Live progress
The page polls `GET /threads/{id}/progress` every second and shows each step as it happens:
- *Searching this project's 3 uploaded documents…*
- *Found 50 papers. Downloading the top 10…*
- *Stored 3 of 10: [title] (full text, 42 passages)*
- *Models A and B are reading…*

### Edge cases handled
- **My uploads with no uploads:** *"this project has no uploaded documents yet…"* (`no_uploads`).
- **APIs return nothing** (down or rate-limited): *"the online search returned no papers, try again"* (`online_search_failed`).
- **Saving online papers fails:** it's reported in the status, and Uploads + online still answers from the uploads.
- **PDF fails to download or parse:** the abstract is used instead. Papers with nothing readable are skipped.
- **Closed-repository projects:** never search online.
- **Uploads + online with no uploads:** goes straight to the online search.

---

## 2. Answer quality and the citation checker

| Change | Commit |
|---|---|
| **Partial answers:** the models report what the papers *do* establish (e.g. gene-silencing research for "how to cure Down syndrome?") instead of refusing everything not answered in full. They still refuse personal and off-topic questions | `8b5ff72` |
| **Paper title counts as context:** a claim's subject may come from the cited paper's title (e.g. "Physical therapy in Down syndrome: …"). This stopped correct claims being removed, which had dropped accuracy to 29% | `8b5ff72` |
| **One continuous quote:** quotes must be one unbroken span, never joined with "…" | `8b5ff72` |
| **Units:** only real measurement units (mg, °C, years…) are treated as units. "2023 review", "1 daughter" and "2022 FIFA" no longer remove correct claims; swaps like "240 children" vs "240 adults" are still caught | `d0028eb` |
| **Strict thresholds restored:** the citation checker's thresholds were loosened in an earlier commit and are back to 0.9 / 0.7, so unsupported claims are rejected again | `b15a637` |
| **Refusals explain why:** a refusal shows the models' own reason and suggests rephrasing | `8b5ff72` |

## 3. Search

| Change | Commit |
|---|---|
| **Vague questions get the topic:** "how to cure **this** syndrome?" searches *"down syndrome cure"*. The topic comes from earlier questions in the chat, otherwise the project name | `af846ca`, `8b5ff72` |
| **Long or pasted questions:** if a long question or pasted paragraph finds too few papers, it's retried with its 6 most specific words | `8b5ff72` |
| **Non-English letters:** accented and non-Latin letters are kept in search words | `8b5ff72` |
| **Europe PMC:** asks for 25 results instead of 100, so it answers within the time limit | `9e49417` |

## 4. Reliability and fixes

| Change | Commit |
|---|---|
| **Error responses:** error bodies are JSON-encoded like FastAPI's default handler, so validation errors no longer crash | `5ef64ac` |
| **Sign-in without storage:** users stay signed in when the browser can't save (disk full, private mode) | `9b9e51f` |
| **Status line:** the misleading "0 fit the AI's token budget" line was fixed | `af846ca` |
| **Closed-repository crash:** every question in a closed-repository project crashed. CI caught it before deployment | `b9315d1` |
| **CI fixes:** a default API URL for frontend tests, and a committed `.pyc` file removed | `b15a637` |
| **Model providers:** Gemini can be chosen as a model provider (`MODEL_*_PROVIDER=gemini`, `GEMINI_API_KEY`) | `8b5ff72` |

## 5. Tools and docs

| File | What it is |
|---|---|
| `deploy-vps.ps1` | One-command backend deploy: uploads `services/`, rebuilds, waits until healthy, and prints logs if not |
| `flow.md` | Six Mermaid diagrams of the whole Ask flow |
| `docs/ASK_SOURCES_CHANGES.md` | Detail of the Sources rules |
| `CHANGES.md` | This file |

## 6. Tests

| Suite | Result |
|---|---|
| Backend, including the database tests | 221 tests in CI, all passing |
| Database tests added for these changes | Every Sources mode, first question vs follow-up, the "told first" flow, the no-answer fallback, concurrency, My uploads never searching, and the edge cases |
| Unit tests | `plan_evidence` for every scope, turn and online flag |
| Web | 56 tests passing; typecheck clean |

## 7. Commits

| Time | Commit | Summary |
|---|---|---|
| 16:07 | `b15a637` | Fix CI: strict verifier restored, API URL for tests, `.pyc` removed |
| 16:14 | `5ef64ac` | Error handler encodes error bodies as JSON |
| 16:29 | `9e49417` | Europe PMC asks for 25 results |
| 16:37 | `9b9e51f` | Stay signed in when the browser can't save |
| 16:45 | `af846ca` | Vague questions get the topic; status line fix |
| 18:30 | `8b5ff72` | Partial answers, title context, search edge cases, Gemini |
| 18:50 | `d0028eb` | Unit checks: real units only |
| 20:47 | `473bf09` | Codex: research flow (Online / Uploads + online), live progress |
| 21:46 | `69746ba` | Sources rules per scope, stored papers first, edge cases, unused code removed |
| 21:50 | `b9315d1` | Closed-repository crash fixed |
| 21:53 | `db9db44` | Test fix |
| 22:17 | `ed81cf4` | No answer in saved sources leads to an online search; My uploads never searches |

---

## Deploy

**Web app:** Render dashboard → frontend service → **Manual Deploy → Deploy latest commit**.

**Backend (PowerShell):**
```powershell
cd "C:\Users\dell\OneDrive\Desktop\keycodes\research-workspace\research-workspace"
```
```powershell
cmd /c "tar -czf - --exclude=.venv --exclude=__pycache__ --exclude=.pytest_cache --exclude=.env services | ssh root@162.35.31.162 tar -xzf - -C /root/app"
```
```powershell
ssh root@162.35.31.162 "cd /root/app; docker compose -f docker-compose.vps.yml up -d --build ai; sleep 80; docker compose -f docker-compose.vps.yml ps ai"
```
Done when `app-ai-1` shows **healthy**. Or run `powershell -ExecutionPolicy Bypass -File .\deploy-vps.ps1`, which does the same.

## The models read every paper found (uncommitted)

- **Before:** the search took the 10 closest passages overall, up to 2 per paper, so the models read about 6 of the 10 stored papers.
- **Now:** `store.search_per_source` takes the 2 best passages of *every* paper, and `reading_order` (was `diversify`) puts each paper's best passage first. The token budget (`LLM_CONTEXT_TOKEN_BUDGET`) cuts from the end, so second passages go before any paper is left unread.
- **Checked:** the DNA question from the live site now reads all 9 stored papers (was 6), nothing cut by the budget.
- **Removed:** the `top_k` field of `/ask` (no longer used; the page no longer sends it, cache `scope52`).
- **Limit:** with a 6,000-token budget, about 10 papers fit. In a project with more saved papers, follow-ups read the most relevant ones that fit.

## Answers every time both models can (uncommitted)

- **Partial answers (all question shapes):** rule 3 of the model instructions now says to answer with what the passages state even when they don't answer in the form asked (number, rating, ranking, yes/no, comparison, prediction, recommendation), and to say in `notes` what is missing. "Not enough evidence" only when no passage says anything about the question's subject.
- **Second look** (`engine.run_dual`): when one model answers and the other finds nothing, the one that found nothing re-reads the same passages once (`SECOND_LOOK`). It never sees the other model's answer. If it still finds nothing it stays a disagreement; if the second look fails (provider error), the first reply stands.
- **Looser judge:** "agreed" now means the same finding even in different words, or one claim broader/narrower than the other, with no conflicting figure, direction or condition.
- **Same sentence = agreed** (`engine.same_passage`): two claims that cite the same passage and quote the same sentence (≥ 60% of the shorter quote, ≥ 4 words, as one span) are confirmed by both, even if the judge missed it. Contradictions and figure mismatches still win.
- **Database connections** (`clients.get_pool`): idle connections are retired after 60 s, before Neon closes them. This fixes the 500 errors "connection was closed in the middle of operation".
- **Models (your `.env`, not code):** Model A = Gemini (`gemini-flash-latest`), Model B = Mistral (`mistral-small-latest`). Groq's `gpt-oss-120b` refused partial answers even on a second look.
- **Tests:** 149 AI tests pass (new: second look ×4, agreement ×4).

## Open items
- **My uploads and stored papers:** should My uploads also use papers stored by online searches? Currently it doesn't.
- **`codex.md` is outdated:** it describes the earlier design and says there's no CI workflow, which is wrong. This file replaces it.
- **Disk space:** C: is nearly full (Docker's disk file ≈ 26 GB, Downloads ≈ 26 GB).
