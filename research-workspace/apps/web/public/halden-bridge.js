// Halden R&D Intelligence <-> Keycodes Live Backend Bridge
(function () {
  'use strict';

  const DEFAULT_API_BASE = 'http://localhost:8080';
  const stored = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const remember = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };

  const state = {
    // ?api= is set by the Next.js host page from NEXT_PUBLIC_API_URL (lib/api.ts HALDEN_SRC).
    apiBase: new URLSearchParams(location.search).get('api') || stored('keycodes_api_base') || DEFAULT_API_BASE,
    // kc_token is the key the Next.js app (lib/api.ts) signs in with.
    token: stored('kc_token') || stored('keycodes_token') || '',
    // No hardcoded project: an explicit choice, else the user's open-discovery project.
    projectId: stored('keycodes_project_id') || '',
    projects: [],
    sources: [],
    signals: [],
    concepts: [],
    loading: false,
    connected: false
  };

  // Same error wording rules as lib/api.ts describe(): FastAPI wraps errors as {detail}.
  function errorText(body, status) {
    const d = body && typeof body === 'object' && 'detail' in body ? body.detail : body;
    if (typeof d === 'string' && d) return d;
    if (d && typeof d.note === 'string') return d.note;
    if (d && typeof d.error === 'string') return d.error.replace(/_/g, ' ');
    return `Request failed (${status})`;
  }

  // The token is missing, expired or revoked: ask the host page to show its sign-in form.
  function signedOut() {
    try { localStorage.removeItem('kc_token'); localStorage.removeItem('keycodes_token'); } catch { /* storage blocked */ }
    state.token = '';
    try { window.parent !== window ? window.parent.postMessage('kc:unauthorized', window.location.origin) : window.location.assign('/'); } catch { /* ignore */ }
    throw new Error('Signed out. Sign in again to continue.');
  }

  async function apiFetch(path, opts = {}) {
    // Always read the live token: the parent page owns sign-in and may change it.
    state.token = stored('kc_token') || state.token;
    if (!state.token) signedOut();
    const headers = { 'Authorization': `Bearer ${state.token}`, ...(opts.headers || {}) };
    if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(`${state.apiBase}${path}`, { ...opts, headers });
    } catch {
      throw new Error('Cannot reach the server. Check that the gateway is running.');
    }
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (res.status === 401) signedOut();
    if (!res.ok) {
      const err = new Error(errorText(body, res.status));
      err.status = res.status;
      throw err;
    }
    return body;
  }

  const post = (body) => ({ method: 'POST', body: JSON.stringify(body) });

  async function ensureProject() {
    // A project id remembered in this browser can outlive the project (database reset, other machine).
    // Check it once per page load; if it is gone, fall back to a project that exists.
    if (state.projectId && state.projectChecked) return state.projectId;
    const { projects = [] } = await apiFetch('/projects');
    state.projects = projects;
    state.projectChecked = true;
    if (state.projectId && projects.some((p) => p.id === state.projectId)) return state.projectId;
    if (state.projectId) {
      console.warn('Saved project no longer exists on the server; switching to an available project.');
    }
    // Open discovery: questions can be asked without an approval lock.
    const open = projects.find((p) => p.mode === 'open_discovery');
    state.projectId = open ? open.id
      : (await apiFetch('/projects', post({ name: 'Halden research', mode: 'open_discovery' }))).id;
    remember('keycodes_project_id', state.projectId);
    return state.projectId;
  }

  /** Closed-repository projects ask through approved tasks, so only open-discovery projects can chat. */
  const chatCapableProjects = () => state.projects.filter((p) => p.mode === 'open_discovery');

  function projectLabel() {
    const p = state.projects.find((x) => x.id === state.projectId);
    const esc = window.__D ? window.__D.esc : String;
    return p ? esc(p.name) : 'No project selected';
  }

  function mountStatusBar() {
    let bar = document.getElementById('keycodes-status-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'keycodes-status-bar';
      bar.style.cssText = `
        position: fixed;
        bottom: 12px;
        right: 16px;
        z-index: 9999;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 14px;
        border-radius: 999px;
        background: #14152B;
        color: #fff;
        font-family: var(--font, system-ui);
        font-size: 12px;
        box-shadow: 0 4px 18px rgba(0,0,0,0.25);
        border: 1px solid rgba(255,255,255,0.15);
      `;
      document.body.appendChild(bar);
    }

    const dotColor = state.connected ? '#10B981' : '#F59E0B';
    const statusText = state.connected ? 'Live · connected' : 'Connecting…';
    bar.innerHTML = `
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dotColor};box-shadow:0 0 8px ${dotColor};"></span>
      <strong>${statusText}</strong>
      <span style="color:#9CA3AF;border-left:1px solid rgba(255,255,255,0.2);padding-left:8px;">Project: ${projectLabel()}</span>
      <button id="kc-sync-btn" style="background:#2563EB;color:#fff;border:none;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;">↻ Sync</button>
    `;
    const syncBtn = document.getElementById('kc-sync-btn');
    if (syncBtn) {
      syncBtn.onclick = () => syncFromBackend();
    }
  }

  async function syncFromBackend() {
    if (!window.__D) return;
    try {
      state.loading = true;
      mountStatusBar();

      // 1. Project
      await ensureProject();

      // 2. Sources -> Knowledge Library
      try {
        const srcRes = await apiFetch(`/projects/${state.projectId}/sources`);
        const srcList = srcRes.sources || srcRes;
        state.sources = srcList;
        if (srcList && srcList.length > 0 && window.__D.LIB) {
          const newLib = srcList.map((s, idx) => ({
            id: 'l_kc_' + (idx + 1),
            n: s.title || s.filename || `Research Paper ${idx + 1}`,
            ty: `${s.fulltext === 'abstract_only' ? 'Abstract only (no full text found)' : 'Full text'} · ${s.chunks || s.chunk_count || 1} chunk${(s.chunks || 1) === 1 ? '' : 's'} · ${String(s.origin || 'indexed').replace('_', ' ')}`,
            st: s.fulltext === 'abstract_only' ? 'Abstract only' : s.fulltext === 'failed' ? 'No text' : 'Indexed',
            ad: s.year ? `${s.year}` : 'Indexed',
            src: (idx % 8) + 1,
            sha256: s.doi || s.id
          }));
          window.__D.LIB.splice(0, window.__D.LIB.length, ...newLib);
        }
      } catch (e) {
        console.warn('Sources fetch failed:', e);
      }

      // 3. Signals -> Radar
      try {
        const sigRes = await apiFetch(`/projects/${state.projectId}/signals`);
        const sigList = sigRes.signals || sigRes;
        state.signals = sigList;
        if (sigList && sigList.length > 0 && window.__D.RAD) {
          const ringMap = { 'high': 0, 'medium': 1, 'low': 2 };
          const newRad = sigList.map((sig, i) => ({
            id: 'r_kc_' + (i + 1),
            t: sig.text || sig.statement,
            s: sig.category === 'opportunity' ? 'Materials' : sig.category === 'risk' ? 'Compliance' : 'Thermal',
            ring: ringMap[sig.confidence] ?? (i % 3),
            pos: 0.2 + (i * 0.15) % 0.6,
            sd: 0.3 + (i * 0.1) % 0.5,
            cf: sig.confidence === 'high' ? 95 : sig.confidence === 'medium' ? 82 : 65,
            tr: sig.models_agree ? 'up' : 'flat',
            task: 't101',
            n: sig.source_count || 1,
            raw: sig
          }));
          window.__D.RAD.splice(0, window.__D.RAD.length, ...newRad);
        }
      } catch (e) {
        console.warn('Signals fetch failed:', e);
      }

      // 4. Concepts -> Kanban Tasks
      try {
        const cRes = await apiFetch(`/projects/${state.projectId}/concepts`);
        const cList = cRes.concepts || cRes;
        state.concepts = cList;
        if (cList && cList.length > 0 && window.__D.T) {
          const STAGE_MAP = {
            'ideation': 'Discovery',
            'evaluation': 'Validation',
            'business_case': 'Business case',
            'pilot': 'Business case',
            'decision': 'Decided',
            'decided': 'Decided'
          };
          const newTasks = cList.map((c, i) => ({
            id: c.id,
            kc: true,                      // backed by a real concept
            code: `C-${100 + i + 1}`,
            title: c.title,
            sector: 'Materials',
            stage: STAGE_MAP[c.stage] || (c.status === 'active' ? 'Validation' : 'Discovery'),
            owner: 'amina',
            prog: c.stage === 'decided' ? 100 : c.stage === 'business_case' ? 75 : c.stage === 'evaluation' ? 50 : 30,
            pri: 'High',
            due: c.status === 'active' ? 'Active' : 'Draft',
            acc: 94,
            rag: c.status === 'active' ? 'g' : 'a',
            status: c.status === 'active' ? 'running' : 'review',
            s: 0,
            e: 2.5,
            deps: [],
            src: [1, 2],
            ans: 'cooling'
          }));
          window.__D.T.splice(0, window.__D.T.length, ...newTasks);
        }
      } catch (e) {
        console.warn('Concepts fetch failed:', e);
      }

      // 5. Audit Log -> Updates and Feedback
      try {
        const auditRes = await apiFetch(`/projects/${state.projectId}/audit`);
        const entries = auditRes.entries || [];
        if (entries.length > 0 && window.__V && window.__V.S) {
          const actionLabels = {
            'pipeline.advance': e => `Advanced stage to ${e.detail?.to_stage || 'next stage'}: "${(e.detail?.reason || '').slice(0, 75)}"`,
            'concept.status': e => `Updated concept status to ${e.detail?.status || 'active'}`,
            'concept.create': e => `Created new research concept: "${e.detail?.title || 'Formulation study'}"`,
            'signal.promote': e => `Promoted verified signal: "${(e.detail?.reason || 'Critical insight').slice(0, 65)}"`,
            'signals.scan': e => `AI engine scanned & extracted ${e.detail?.created || 10} verified signals from literature`,
            'task.approve': e => `Approved and locked ${e.detail?.sources || 'the'} sources for a research task`,
            'source.discover': e => `Searched online and found ${e.detail?.found ?? 'some'} papers for a question (kept as links, not added to the library)`,
            'source.save': e => `Saved a paper to the Knowledge Library`,
            'answer.flag': e => `Flagged an answer for review`,
            'chat.delete': e => `Deleted a chat`,
            'project.create': e => `Initialized research programme: "${e.detail?.name || 'mRNA Stability'}"`,
            'ask': e => `Ran multi-model verification query on task evidence`
          };
          const realUpdates = entries.slice(0, 6).map(e => {
            const txt = actionLabels[e.action] ? actionLabels[e.action](e) : `Completed ${String(e.action).replace(/[._]/g, ' ')}`;
            const dateStr = e.created_at ? new Date(e.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Today';
            return {
              who: 'amina',
              txt: txt,
              w: dateStr,
              tk: (window.__D && window.__D.T && window.__D.T[0]) || { title: 'mRNA-LNP Instability' }
            };
          });
          window.__V.S.auditUpdates = realUpdates;
        }
      } catch (e) {
        console.warn('Audit fetch failed:', e);
      }

      state.connected = true;
      mountStatusBar();

      // Trigger UI re-render
      await refreshProjects().catch((e) => console.warn('Projects fetch failed:', e));
      if (!state.migrated) { state.migrated = true; await migrateLocalProjects().catch((e) => console.warn('Project migration failed:', e)); }
      if (window.__V && window.__V.S) window.__V.S.live = true;
      if (state.chatsFor !== state.projectId) {
        state.chatsFor = state.projectId;
        try { await loadChatList(); } catch (e) { console.warn('Chat list failed:', e); }
      }
      // The page exposes its renderer as __renderAll; calling a name it does not define left stale data on screen.
      const rerender = window.__renderAll || window.renderAll;
      if (typeof rerender === 'function') rerender();
    } catch (err) {
      console.error('Sync failed:', err);
      state.connected = false;
      mountStatusBar();
    } finally {
      state.loading = false;
    }
  }

  // ---- Chat: real RAG answers (halden.html sendQ and Attach call these) ----

  async function upload(file) {
    const pid = await ensureProject();
    const form = new FormData();
    form.append('file', file);
    return apiFetch(`/projects/${pid}/sources/upload`, { method: 'POST', body: form });
  }

  // ---- Chats are children of the active project and are stored on the server, so they appear in every
  // browser and session that opens the project. A chat is created on its first question. ----

  /** Make sure this chat exists on the server and return its id. `th` is the page's chat object. */
  async function ensureChat(th) {
    if (th.srv) return th.srv;
    const pid = await ensureProject();
    const r = await apiFetch(`/projects/${pid}/chats`, post({ title: th.title }));
    th.srv = r.id;
    return th.srv;
  }

  /** Ask the dual-model RAG engine inside chat `th`.
      scope: 'uploads' = only the user's uploaded PDFs (sourceIds narrows to attached ones),
             'api'     = only papers found via OpenAlex / Unpaywall / Europe PMC (kept in the research cache),
             'both'    = uploads plus discovered papers.
      For 'api' and 'both' the question is first used to look for papers online. */
  async function ask(question, sourceIds, scope = 'both', th = { title: question.slice(0, 80) }) {
    const pid = await ensureProject();
    if (scope !== 'uploads') {
      try {
        await apiFetch(`/projects/${pid}/discover-and-ingest`, post({ question }));
      } catch (e) {
        if (scope === 'api') throw e;          // nothing else to answer from
        console.warn('Paper discovery failed, answering from uploads:', e);
      }
    }
    const threadId = await ensureChat(th);
    const body = { question, scope };
    if (scope === 'uploads' && sourceIds && sourceIds.length) body.source_ids = sourceIds;
    const result = await apiFetch(`/threads/${threadId}/ask`, post(body));
    result.thread_id = threadId;
    return result;
  }

  /** A source title a person can read: strip the trailing DOI and the file extension, and never show an id or hash. */
  function readableTitle(label) {
    const t = String(label || '').replace(/,\s*doi:\S+\s*$/i, '').replace(/\.pdf$/i, '').trim();
    if (!t || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t) || /^[0-9a-f]{16,}$/i.test(t)) return 'Untitled document';
    return t;
  }

  /** Map the backend AskResult onto halden.html's answer shape, so its existing thread view,
      citation and claim panels render real, verified results unchanged. */
  function toAnswer(r, question) {
    const { SRC, esc } = window.__D;
    const clean = (t) => esc(String(t || '')).replace(/[|{}]/g, ' ');
    const summary = String(r.content || '').replace(/^INSUFFICIENT_SOURCE_EVIDENCE:\s*(.)/, (_, c) => c.toUpperCase());
    const nums = {};                            // chunk id -> SRC number

    const cite = (cid, quote) => {
      const m = r.chunks[cid];
      if (!m) return '';
      if (!nums[cid]) {
        const n = (nums[cid] = Math.max(0, ...Object.keys(SRC).map(Number)) + 1);
        const pages = m.page_start == null ? '' : (m.page_end && m.page_end !== m.page_start)
          ? `pp. ${m.page_start}-${m.page_end}` : `p. ${m.page_start}`;
        const kind = { user_upload: 'Uploaded PDF', openalex: 'Found via OpenAlex', europe_pmc: 'Found via Europe PMC',
          unpaywall: 'Found via Unpaywall' }[m.origin] || 'Source';
        SRC[n] = {
          t: readableTitle(m.label),                 // never show an id or hash as a title; the DOI is shown separately
          ty: kind, v: pages || 'Full text', ok: 1, p: m.text,
          y: esc(m.doi ? `doi:${m.doi}` : 'No DOI listed'),
          rel: Math.round((r.top_similarity || 0) * 100),
          doi: m.doi || '', url: m.url || '', sid: m.source_id || '', lib: m.in_library !== false,
          ord: Object.keys(nums).length,            // citation number shown to the reader: 1, 2, 3 ...
        };
      }
      const s = SRC[nums[cid]];
      if (quote && !s.p.includes('«') && s.p.includes(quote)) s.p = s.p.replace(quote, `«${quote}»`);
      return `[${nums[cid]}]`;
    };

    const cl = {};
    const mark = (g, text, ids, quote, note) => {
      const c = `c${Object.keys(cl).length + 1}`;
      const refs = (ids || []).map((id) => cite(id, quote)).filter(Boolean);
      cl[c] = { g, s: refs.map((x) => +x.slice(1, -1)), n: clean(note) };
      return `{${g}|${clean(text)}|${c}}${refs.join('')}`;
    };

    let html, dis;
    if (r.kind === 'consensus') {
      // Every claim shown here passed exact-quote verification against its source, so it is 'verified';
      // the note says whether the second model independently confirmed it.
      html = r.claims.map((c) => mark('v', c.text, c.chunk_ids, c.quote,
        [c.confirmed ? 'Confirmed by both models' : 'Stated by one model only',
         c.match_kind && `${c.match_kind} quote match`, c.conditions && `Conditions: ${c.conditions}`]
          .filter(Boolean).join(' · '))).join('<br>');
      const single = r.claims.filter((c) => !c.confirmed).length;
      dis = single ? `${single} finding${single === 1 ? ' was' : 's were'} stated by one model only. ${single === 1 ? 'It is' : 'They are'} verified against the source text but not independently confirmed by the second model.`
        : 'Both models independently support every finding shown.';
    } else if (r.kind === 'disagreement' && r.disagreement && r.disagreement.conflicts.length) {
      const conflicts = r.disagreement.conflicts;
      html = clean(summary.split('\n')[0]) + '<br><br>' + conflicts.map((cf) => `<b>${clean(cf.topic)}</b><br>` +
        [['A', cf.position_a], ['B', cf.position_b]].filter((p) => p[1])
          .map(([w, p]) => mark('d', `Model ${w}: ${p.text}`, p.chunk_ids, p.quote, cf.explanation)).join('<br>')
      ).join('<br><br>');
      dis = conflicts.map((cf) => clean(cf.explanation)).join(' ');
    } else {
      html = clean(summary) || 'Your sources do not contain an answer to this question.';
      dis = html;
    }

    const v = r.verification, total = v.verified + v.purged, g = r.gate || {};
    const acc = total ? Math.round((100 * v.verified) / total) : 0;
    const verdict = { consensus: ['Agrees', 'ok'], disagreement: ['Disagrees', 'warn'] }[r.kind] || ['No answer in sources', 'warn'];
    const pts = [
      `${v.verified} claim${v.verified === 1 ? '' : 's'} verified against the source text`,
      `${v.purged} unverifiable claim${v.purged === 1 ? '' : 's'} removed`,
      g.top_similarity == null ? 'No matching passages found'
        : `Best source match ${g.top_similarity.toFixed(2)} (needs ${g.threshold.toFixed(2)})`,
    ];
    const ci = [...new Set(Object.values(nums))].slice(0, 3);
    // Each model's own result (backend `models`). Older payloads without it fall back to the combined numbers.
    const card = (m, role, key) => {
      const d = (r.models || {})[key];
      if (!d) return { m, r: role, v: verdict[0], vc: verdict[1], cf: acc, pts, ci };
      const n = d.verified + d.purged;
      const mc = d.claims.map((c) => ({
        text: clean(c.text), ok: !!c.verified, reason: c.reason, kind: c.match_kind,
        ref: [...new Set((c.chunk_ids || []).map((id) => cite(id, c.verified ? c.quote : '')).filter(Boolean)
          .map((x) => +x.slice(1, -1)))],
      }));
      return {
        m, r: role, v: verdict[0], vc: verdict[1], cf: n ? Math.round((100 * d.verified) / n) : 0,
        pts: [
          `${d.verified} of ${n} claim${n === 1 ? '' : 's'} verified against the source text`,
          `${d.purged} unverifiable claim${d.purged === 1 ? '' : 's'} removed`,
          pts[2],
        ],
        ci: [...new Set(mc.flatMap((c) => c.ref))].slice(0, 3), mc,
      };
    };
    const panel = [card('Model A', 'Lead research scientist', 'model_a'), card('Model B', 'Speed auditor', 'model_b')];
    return {
      title: question, acc, html, cl, dis, fups: [], next: '', cm: [], panel, live: true,
      stats: { verified: v.verified, total }, mid: r.message_id, tid: r.thread_id,
      gate: { top: g.top_similarity, need: g.threshold },
    };
  }

  function currentSub() {
    try { return JSON.parse(atob(state.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub; } catch { return null; }
  }

  /** Ask every other lead scientist / admin / owner in the project to review a concept (the VP step of the chain). */
  async function requestApproval(conceptId) {
    const pid = await ensureProject();
    const { members = [] } = await apiFetch(`/projects/${pid}/members`);
    const me = currentSub();
    const vps = members.filter((m) => ['lead_scientist', 'admin', 'owner'].includes(m.role) && m.user_id !== me);
    if (!vps.length) throw new Error('No reviewer yet. Add a lead scientist or admin under Team & Access first.');
    await apiFetch(`/concepts/${conceptId}/approval/request`, post({ vp_ids: vps.map((m) => m.user_id) }));
    return { names: `${vps.length} reviewer${vps.length > 1 ? 's' : ''}` };
  }

  /** Search for more papers on this question even if the project already covers it, then refresh the library. */
  async function findMorePapers(question) {
    const pid = await ensureProject();
    const r = await apiFetch(`/projects/${pid}/discover-and-ingest`, post({ question, force: true }));
    syncFromBackend();
    return r;
  }

  /** Keep a paper that was found online (moves it from the research cache into the Knowledge Library). */
  async function saveToLibrary(sourceId) {
    const pid = await ensureProject();
    const r = await apiFetch(`/projects/${pid}/sources/${sourceId}/save-to-library`, post({}));
    syncFromBackend();
    return r;
  }

  /** Ask for a person to review an answer; recorded in the project's audit log. */
  async function flagAnswer(threadId, messageId) {
    return apiFetch(`/threads/${threadId}/messages/${messageId}/flag`, post({}));
  }

  /** Create the backend task behind a "New Research" wizard run (title + a brief built from the wizard answers). */
  async function createResearch(title, brief) {
    const pid = await ensureProject();
    return apiFetch(`/projects/${pid}/tasks`, post({ title: String(title).slice(0, 300), brief }));
  }

  /** A reviewer's decision on a concept: 'approved' or 'changes_requested' (remarks required for changes). */
  async function decideApproval(conceptId, decision, remarks) {
    return apiFetch(`/concepts/${conceptId}/approval/decide`, post({ decision, remarks: remarks || '' }));
  }

  // Auto initialize when window is ready
  window.addEventListener('DOMContentLoaded', () => {
    mountStatusBar();
    setTimeout(syncFromBackend, 400);
  });

  // ---- Chat list and projects (server is the source of truth) ----

  function relTime(iso) {
    const d = new Date(iso), diff = (Date.now() - d.getTime()) / 1000;
    if (!isFinite(diff)) return '';
    if (diff < 90) return 'Just now';
    if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
    if (diff < 86400) return 'Today';
    if (diff < 172800) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  async function refreshProjects() {
    const { projects = [] } = await apiFetch('/projects');
    state.projects = projects;
    return projects;
  }

  /** Projects made with the old "New Project" button lived only in this browser. Create them on the server once. */
  async function migrateLocalProjects() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem('halden_projects') || '[]'); } catch { return; }
    if (!Array.isArray(saved) || !saved.length) return;
    const left = [];
    for (const p of saved) {
      const name = String(p && p.title || '').trim();
      if (!name) continue;
      if (state.projects.some((x) => x.name === name)) continue;        // already on the server
      try {
        await apiFetch('/projects', post({ name, mode: 'open_discovery',
          meta: { sector: p.sector, lead: p.lead, question: p.q, method: p.method, output: p.out } }));
      } catch (e) { left.push(p); }                                       // keep it to try again next time
    }
    try { left.length ? localStorage.setItem('halden_projects', JSON.stringify(left)) : localStorage.removeItem('halden_projects'); } catch { /* storage blocked */ }
    await refreshProjects();
  }

  /** Load this project's chats into the sidebar. Messages are fetched when a chat is opened. */
  async function loadChatList() {
    const V = window.__V;
    if (!V || !V.S) return false;
    const S = V.S, pid = await ensureProject();
    const { chats = [] } = await apiFetch(`/projects/${pid}/chats`);
    const have = new Map(S.threads.filter((t) => t.srv).map((t) => [t.srv, t]));
    const inFlight = S.threads.filter((t) => t.live && !t.srv);
    const next = chats.map((c) => {
      const t = have.get(c.id) || { id: c.id, srv: c.id, key: null, q: '', fresh: false, pre: '', prev: [], needsLoad: true };
      t.title = c.title; t.t = relTime(c.updated_at);
      return t;
    });
    S.threads.splice(0, S.threads.length, ...inFlight, ...next);   // the built-in example chats are replaced by real ones
    let saved = '';
    try { saved = sessionStorage.getItem('keycodes_route') || ''; } catch { /* storage blocked */ }
    const wanted = location.hash.slice(1) || saved;
    if (wanted.startsWith('thread-') && S.threads.some((t) => 'thread-' + t.id === wanted)) S.route = wanted;
    else if (S.route.startsWith('thread-') && !S.threads.some((t) => 'thread-' + t.id === S.route)) S.route = 'home';
    return true;
  }

  /** Fetch a chat's messages and rebuild its turns (question + verified answer) for the thread view. */
  async function loadThread(th) {
    const V = window.__V, D = window.__D, S = V.S;
    const { messages = [] } = await apiFetch(`/threads/${th.srv}/messages`);
    const turns = [];
    let q = null;
    messages.forEach((m) => {
      if (m.role === 'user') { q = m.content; return; }
      if (q === null) return;
      const r = m.final || {
        kind: m.answer_kind || 'insufficient_evidence', content: m.content, claims: [], chunks: {},
        verification: { verified: 0, purged: 0 }, gate: {}, top_similarity: m.top_similarity,
        disagreement: m.disagreement,
      };
      r.thread_id = th.srv;
      r.message_id = r.message_id || m.id;
      const key = 'th' + (++S.thId);
      D.ANS[key] = toAnswer(r, q);
      turns.push({ q, key });
      q = null;
    });
    th.needsLoad = false;
    if (turns.length) {
      const last = turns[turns.length - 1];
      th.prev = turns.slice(0, -1).map((t) => ({ q: t.q, key: t.key, pre: '' }));
      th.q = last.q; th.key = last.key;
    }
    return th;
  }

  /** Make another project the active one: its library, signals and chats replace the current ones. */
  async function switchProject(id, route = 'home') {
    if (!id || id === state.projectId) return;
    state.projectId = id;
    remember('keycodes_project_id', id);
    state.projectChecked = true;
    state.chatsFor = '';
    try { sessionStorage.removeItem('keycodes_route'); } catch { /* storage blocked */ }
    const V = window.__V;
    if (V && V.S) { V.S.attachments.length = 0; V.S.route = route; V.S.threads.length = 0; }
    try { history.replaceState(null, '', '#' + route); } catch { /* ignore */ }
    await syncFromBackend();
  }

  /** Create a real project on the server (descriptive fields go in `meta`) and make it the active one. */
  async function createProject({ name, meta }) {
    const r = await apiFetch('/projects', post({ name, mode: 'open_discovery', meta: meta || {} }));
    await refreshProjects();
    await switchProject(r.id);
    return r;
  }

  window.__KC_BRIDGE = {
    state,
    syncFromBackend,
    apiFetch,
    upload,
    ask,
    toAnswer,
    requestApproval,
    decideApproval,
    createResearch,
    findMorePapers,
    loadChatList,
    loadThread,
    switchProject,
    createProject,
    refreshProjects,
    chatCapableProjects,
    saveToLibrary,
    flagAnswer,
  };
})();
