# Engineering notes: state, data freshness and the Halden screen

## 1. Running locally

| Piece | Port | How it starts | Notes |
|---|---|---|---|
| AI backend | 8001 | `services\ai\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8001` (run from `services\ai`) | Uses the Neon database from `.env` |
| Gateway | 8080 | `services\ai\.venv\Scripts\python.exe gateway.py` (run from `services\gateway`) | `AI_URL=http://localhost:8001` in `.env` |
| Web app | 3000 | `npm run dev -- -p 3000` (run from `apps\web`) | Reads `NEXT_PUBLIC_API_URL` from `apps\web\.env.local` (`http://localhost:8080`) |

- `NEXT_PUBLIC_API_URL` is read at build time. Locally it comes from `apps\web\.env.local`. On Render it comes from the service's environment variables, and a change there needs a new build (Manual Deploy).
- Sign in locally with a token from `python services\gateway\mint_token.py --raw`, passed in the URL fragment: `http://localhost:3000/#kc_token=<token>`. Tokens expire.
- `start_project.bat` is the one-click launcher. Its window-based start did not launch the services on the test PC, so the services were started by hand.

## 2. How state is kept

| Layer | What holds the state | Lifetime |
|---|---|---|
| Database (Neon Postgres) | All real data: projects, sources, concepts, approvals, audit log | Permanent. The source of truth. |
| AI service | No state of its own; each request reads and writes the database | Per request |
| Gateway | Stateless. Checks the token and forwards. Rate limits are kept in memory per user | Per process |
| Browser: sign-in token | `localStorage` key `kc_token` | Until sign-out or expiry |
| Browser: active project | `localStorage` key `keycodes_project_id` | Until changed |
| Browser: current screen | `sessionStorage` and the URL hash | Browser tab |
| Browser: Halden screen data | Global variables in `halden.html` (`window.__D`, `window.__V`), filled by `halden-bridge.js` | Page load |
| Browser: Next.js pages | React state via `useLoad` | Page mount |
| Concurrency | Section `base_version` (rejects saves made against an old version), section locks, approval rounds | Database |

## 3. Data freshness and caching

Options, from simplest to most complete:

| Approach | What it does | Freshness |
|---|---|---|
| Stale-while-revalidate | Show cached data at once, refetch in the background, replace when fresh | Fresh within one request; shows old data briefly |
| HTTP validators (ETag / `If-None-Match`) | Server replies `304 Not Modified` when nothing changed | Always current; saves bandwidth, not round trips |
| Invalidate on write | After a create, edit or approve, refetch or drop the affected data | Current for your own changes |
| Push updates (SSE) | Server says what changed; the client refetches only that | Near-instant for other people's changes |

Current state:
- The Halden bridge has no cache. Each screen fetches its data when it opens, and the Sync button refetches. Duplicate requests that are still in flight are shared.
- The Next.js concept page already uses server-sent events (`services/ai/app/realtime.py`, `apps/web/lib/useEvents.ts`). The events carry only ids; the client refetches through the permission-checked endpoints.

Recommended if caching is added later: stale-while-revalidate in memory, keyed by user and project, cleared on sign-out, invalidated after the user's own writes, and refreshed by the existing SSE events. Avoid persisting research data in `localStorage` unless the client accepts a copy on the device.

## 4. What `halden.html` is

- A standalone prototype: a single ~495 KB file with its own renderer, navigation, styles and hard-coded demo data (named people, fixed signals and tasks).
- `halden-bridge.js` attaches the live backend by overwriting its arrays. It depends on the internal names `window.__D` and `window.__V`.
- The Ask/chat flow and several screens run through it, so it can't be deleted yet.

Why it should be replaced over time:
- Two UIs exist for the same features; the Next.js app already has projects, concepts, signals and approvals with typed API calls.
- Demo data and live data are mixed.
- No types, no component tests, and each change needs a manual cache-busting version bump (`?v=scopeNN`).
- It cannot use the Next.js data layer or the SSE events.

Recommended path: rebuild screens in Next.js one at a time (Radar and Home first), with a data-fetching library, then delete each replaced part of `halden.html`.

## 5. Methodologies

- One list (`METHODS` in `halden.html`) holds the eight organisation-defined methods, with a description and a stage count. The wizard options, the Methodologies page and the Library tab all read from it.
- The Methodologies page lets you select a method to see its description and stage count, and set it as the default for new research. The default is stored in `localStorage` (`halden_default_method`) as a viewer preference, not research data.
- The New Research modal starts from the default method.
- Stage names are not in the list: only the number of stages is known. Adding the stage names needs the organisation's content.
- The backend does not use the method to change how answers are produced. It is recorded in the research brief text.

## 6. Practices to apply

Data and state
- One source of truth: the server. The browser holds copies only.
- Use a data-fetching library (TanStack Query or SWR) rather than hand-written caches. It handles de-duplication, background refresh, retries and invalidation.
- Scope cache keys by user and project; clear everything on sign-out.
- Optimistic updates for quick actions, with rollback on error.
- Keep mock data out of any path that talks to the real backend.

Concurrency and correctness
- Optimistic concurrency on edits (`base_version`), which is already in place.
- Locks or live events where two people can change the same item.
- Permission checks on the server for every request; the browser only hides controls.

Performance
- One request per screen where possible, instead of several.
- Keep the database close to the API; use connection pooling. The Neon round trip is currently the largest cost.
- Paginate long lists. Run independent requests in parallel.

Security
- Keep the sign-in token out of JavaScript. An `httpOnly`, `Secure`, `SameSite` cookie is the standard. A token in `localStorage` can be read by any script on the page.
- Never ship secrets to the browser.
- Short-lived tokens and a clear sign-out.

Operations
- Separate local, staging and production environments with separate databases.
- Configuration through environment variables, never in code.
- Health checks, logs and error tracking.
- Run the database tests in CI (`.github/workflows/ci.yml` exists and has not run yet).
- A rollback plan for each deploy.
