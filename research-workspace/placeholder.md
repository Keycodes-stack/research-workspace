# Placeholders in the new UI

The new UI (design: [artifexlabs-research](https://github.com/EngrRehman-debug/artifexlabs-research), live: https://artifexlabs-research.vercel.app) is being built at **`/v2`** in `apps/web`, next to the current Halden page.
**This file lists everything in the new UI that has no backend yet.** Each item is **kept exactly as in the design** and will be connected later. Update this file as each screen is built.

Legend:
- **"—"**: the design element stays, but the cell shows "—" because the backend has no such data.
- **Sample**: the design's own sample content is kept as it is.
- **Not wired**: the control is shown but does nothing yet.

---

## Shell (all screens)

| Element | Status | Needs |
|---|---|---|
| Top bar **search** ("Search workspace") | Not wired | A workspace search endpoint |
| Top bar **notifications** bell | Not wired | Connect to the existing notifications (the classic UI has them) |
| Sidebar **account** name and role ("Ibrahim Ghatila · Admin") and avatar | Sample | User profile (name, role, avatar). The backend only knows the user id |
| Sidebar links **Research, Findings, Signals & Monitoring, My Work, Knowledge Library, Notifications, Organization & Access, Settings** | Not wired (`#` in the design too) | Their screens (some have a backend: Signals, Knowledge Library, Organization & Access) |
| Sidebar **Home** | ✅ Built (`/v2/home`) | |
| Sidebar **Calendar** | ✅ Built (`/v2/calendar`), sample data | See Calendar below |

## Projects list (`/v2/projects`)

| Element | Status | Needs |
|---|---|---|
| Project **name**, **lead** (`meta.lead`) | ✅ Real data (`GET /projects`) | |
| **Work Package** | ✅ Real data: number of research tasks (`GET /projects/{id}/tasks`, one request per project) | Later: a count in `GET /projects` (one request) |
| **Code** (e.g. "P-PILOT") | "—" | A project code field |
| **Stage** (progress bar) | "—" | Project progress |
| **Status** (In Progress / Pending) | "—" | Project status |
| **Filter** button | Not wired | Filter options (the design has none) |
| **Add New Project** / **New Research Study** | ✅ Real: opens the project set-up assistant (`/v2/projects/new`) | |

## Project set-up (`/v2/projects/new`)

| Element | Status | Needs |
|---|---|---|
| Set-up assistant questions and suggested charter (`POST /projects/intake`) | ✅ Real. If the main model is slow, the backup model answers after 45 s | |
| AI assessment card (`POST /projects/insights`), saved with the project | ✅ Real | |
| Research mode (open discovery / closed repository) | ✅ Auto-detected from the brief; not asked, shown read-only | |
| Create project (`POST /projects/complete`), with work packages | ✅ Real | |
| Project code, stage, status | "—" | Project code, progress and status fields |

## Home (`/v2/home`)

| Element | Status | Needs |
|---|---|---|
| Ask box, **Evidence Sources** (My uploads / Online / Uploads + online) | ✅ Real: creates a chat in the project and opens it | |
| **Project** picker (not in the design) | ✅ Real: open-discovery projects only (closed-repository projects ask through approved research tasks) | |
| **+** in the ask box | ✅ Real: uploads PDFs to the chosen project | |
| **Sources** (Uploaded files / Search online toggles) | ✅ Real: sets the evidence scope of the question (uploads, online or both). The Knowledge Library list and repo count are sample | Repo sources in the backend |
| **Panel · 2 models** | Sample: shows the design's choices. Every question uses the two configured models (Model A, then Model B) | Choosing models per question |
| **Balanced** (reasoning level) | Sample, not wired | A reasoning-level setting on the backend |
| **Mic** (voice input) | ✅ Real in the browser: dictates with the browser's speech recognition (Chrome, Edge). No server. Other browsers: the button shows the error | |
| **New project** button (next to the project picker) | ✅ Real: opens the project set-up assistant (`/v2/projects/new`) | |
| **Priority Intelligence Briefing**, **Active Initiatives**, **Monitoring Coverage** lists | Sample | A briefing/initiatives/monitoring feed |
| **Analytics** charts, Add widget, Switch view, Last 4 Weeks | Sample, not wired | Activity and status statistics |

## Chat (`/v2/projects/{id}/ask/{chatId}`, no design screen: styled like Project Chats)

| Element | Status | Needs |
|---|---|---|
| Questions, answers, live steps, numbered sources with quoted passages | ✅ Real (`/threads/{id}/ask`, `/progress`, `/messages`) | |
| Follow-ups, Evidence Sources, PDF upload | ✅ Real | |
| "Find papers on X" paper **lists** (the current site lists every paper found) | Not built yet | The page: `/threads/{id}/papers` already exists |
| Model A / Model B panels, flag answer, add to research task, export | Not built yet | The endpoints exist (the current site uses them) |
| Breadcrumb project link and side-panel project links (`/v2/projects/{id}`) | Open the Project overview, a later step | |

## Calendar (`/v2/calendar`)

| Element | Status | Needs |
|---|---|---|
| Month and Kanban views, events, add/edit/delete event, drag between status columns | Sample: the design's events, saved in the browser only (`localStorage`) | A calendar/events backend |
| Guests, Meet link, location, agenda, reminder, repeat | Sample, not sent anywhere | Invitations and reminders |
| Event people (avatars, "+6") and progress | Sample | Real attendees and progress |
| Search and Filter | Work on the sample events only | |

## Screens with no backend yet (to build as in the design, with sample data)

| Screen | Design route |
|---|---|
| Departments & Workstreams | `/projects/[slug]/departments` |
| Baseline & Approvals | `/projects/[slug]/baseline` |
| Project Teams | `/projects/[slug]/teams` |
| Teams & Timeline | `/projects/[slug]/timeline` |
| Workspace (document editor, comments) | `/projects/[slug]/workspace` |
| Evidence Extraction Ledger (charts) | `/projects/[slug]/evidence` |
| Project Chats (team chat) | `/projects/[slug]/chats` |
| Login, Create account, Forgot password | `/login`, `/create-account`, `/forgot-password` |
