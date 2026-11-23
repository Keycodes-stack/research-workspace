# Projects module: what is done, what is left

Source: *Artifex Labs: Projects Module & Creation Wizard Implementation Specification* (`/projects`, `/projects/new`, `/projects/[slug]`).

## Done

**Database (live Neon, applied)**
- Migration 013: spec section 5 (projects columns, `work_packages`, `work_package_dependencies`, `decision_gates`, `tasks.work_package_id`), with CHECK constraints for the spec's values.
- Migration 014: comments recording the schema decisions.
- Migration 015: project codes (P-001, P-002 …, assigned in creation order, with a sequence for new projects); structured document format on `work_package_documents`; `work_package_comments` table.
- Duplicates removed earlier: 10 empty copies. 19 projects remain (plus any created since).

**Backend (AI service)**
- `POST /projects/complete` writes the spec columns, work packages and decision gates in one transaction. It accepts `draft_id` to turn a draft into the project (same id and slug).
- `POST /projects/draft` saves the wizard as a Draft. `DELETE /projects/{id}` deletes drafts only (created projects return 409).
- Project routes accept the project id or the slug (`/projects/[slug]` in the API).
- `GET /projects` returns code, status, governance stage, lead, work-package count and progress (average of work-package progress; null when there are none).
- Work package documents: rich text (headings 1–3, bold, italic, underline, bullet and numbered lists). Unsupported elements are refused with HTTP 422. Stale saves return 409.
- Comments: list, add, resolve.
- Word export: whole project (charter, organization, delivery, work packages, gates, risks, controls) and each work package's document with its formatting kept.
- AI: "Suggest with AI" on wizard steps 1–4 and the refinement bar both propose values in a panel. Nothing is pasted until you choose Use, and every suggestion can be edited first.

**Wizard (frontend)**
- Five steps; Confirm & Continue; one question at a time; charter card with "AI Suggested" tags; limits on every text box.
- Option lists match the spec (type, governance, priority, delivery approach, reporting, classification, data region, retention, currency, five departments).
- Save Draft saves to the database; Delete draft removes it. The wizard resumes the same draft after a refresh.
- Attachments: "Attach image" and "Attach PDF". PDFs are added to the project's sources after creation. Images are listed in the brief only; they are not stored yet.
- Creation shows "Project successfully initialized!" and opens the project after about a second and a half.
- Sponsor, lead and core team are free text (decision c: no user directory).

**Directory (`/v2/projects`)**
- Columns: project and code, lead, work packages, stage, progress bar, status pill, and Delete for drafts.
- Search (title, code, lead) and a status filter.
- Links use the project slug.

**Workspace**
- Word-style editor (TipTap) with a formatting toolbar. Autosave with a version check.
- Comments panel beside the document: add, resolve, reopen.
- Download Word on every work package, and Download Word document on the project overview.

**Tests**
- Backend: 174 passed, 85 skipped (they need a test database). The live checks listed above passed.
- Web: 85 of 85 passed. Typecheck passes.

## Left (not done)

**Deployment**
- Nothing is pushed or deployed. Pushing redeploys the frontend (Render needs `NEXT_PUBLIC_API_URL`). The backend needs `deploy-vps.ps1`. Both need your approval.
- The npm install added TipTap packages. One of them asks for a newer Node version than the local one (22.20 vs 22.22). The build works here; upgrading Node is recommended.

**Route `/projects`**
- Not moved. The old app already has routes under `/projects/[id]`, so moving the new app there would replace them. Moving means retiring the old app's project pages first. Confirm that and I'll do the move.

**Editor**
- Comments are attached to the whole document, not to a selected passage.
- No real-time co-editing. Two people editing the same document get the version conflict message.

**Wizard**
- Images are not stored. The external-collaboration toggle is still the three-option select (not mapped to `external_partner_ingestion`).
- Save Draft does not save work packages or gates until the project is created. Those are kept in the draft's charter and added at creation.
- The step 5 "Access permissions preview" is not built.

**Not defined in the spec (need your decision)**
- Overall portfolio health: no formula.
- Allocated research budget on the directory: not shown yet (sum of indicative budgets, if you want it).
- Pending stage-gate reviews count: not shown yet.
- Decision gate statuses (Pending, Approved, Changes Requested), department list, currency list, data region and retention defaults: my choices.

## Update (latest round)

**Done**
- **Old app removed; new app at the root.** Pages are at `/`, `/home`, `/projects`, `/knowledge`, `/calendar`, `/organization`. The sign-in form is at `/`.
- **Image attachments:** stored in object storage, with type checking by file content (PNG, JPEG, GIF, WebP; 10 MB). Overview gallery with add and remove. Deleting an image deletes its stored file (verified with local storage).
- **Anchored comments:** comments attach to the selected text; replies (one level); resolve and reopen; deleting a thread removes its replies and highlight; thread stays with a note if its text is deleted (migration 017).
- **External partner evidence ingestion:** a toggle in step 4, saved to `external_partner_ingestion`.
- **Access permissions preview:** shown on step 5, generated from the charter's access fields.
- **People directory (migration 018):**
  - Sponsor and project lead are chosen from the directory, with "+ Add a person…" inline.
  - Core team is chosen by checkboxes.
  - The Organization & Access page lists people, adds them, and deactivates or reactivates them.
  - Saved projects keep the person's id and name.
  - The API refuses people who are inactive or not in the directory.

**Left**
- Deployment: the backend (`deploy-vps.ps1`) and the frontend (push, then Render `NEXT_PUBLIC_API_URL` and a manual deploy). Both need your approval.
- Browser testing of the editor, comments, directory, wizard, and Organization page (needs the deployed site).
- First image upload on the VPS (its storage is MinIO; tested locally only).
- Permissions for the directory: any signed-in user can add and deactivate people. A proper admin role is needed.
- Editing a person's name, department, or title after adding (only add and activate or deactivate exist).
- Linking a person to a sign-in account: no link yet, so access is not granted from the charter.
- Older projects have names only, without person ids.
