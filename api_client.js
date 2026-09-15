// api_client.js — READ bridge to MOU69_DB via Apps Script (see api_config.js), plus (Step 5B)
// the client side of the secure central Write API. See apps_script/Code.gs's doPost for the
// server enforcement this all depends on.
//
// Scope discipline:
//   - Read (health/bootstrap): unchanged since Phase 1.
//   - Write (apiWrite* below): calls only the server's own allowlisted actions
//     (writeSmokeTest/saveDraft/submitEntry/confirmEntry) — this file never lets a caller name a
//     sheet/column/range. NOT wired into any Entry UI button yet (Step 5C's job) — every quarter's
//     server-side period status stays non-'open' this phase, so only writeSmokeTest can succeed.
//   - Never touches the existing localStorage keys (`mou69_uat_q3_v1`, `mou69_v1_overrides`) —
//     fetched data lands in its own new key (REMOTE_CACHE_KEY) only; the write auth token lives
//     in memory / sessionStorage only (see WRITE_TOKEN_SESSION_KEY below) — never localStorage.
//   - Never calls into scoring (engine.js), rendering (app.js), or entry/confirm flows —
//     wiring fetched data into scores/Home/Overview is a later phase.
//   - When API_BASE_URL is empty, this file is a no-op: no fetch, no localStorage write, no
//     DOM change. The dashboard behaves identically to before this file existed.

const REMOTE_CACHE_KEY = 'mou69_remote_cache_v1';

function remoteCacheRead() {
  try { return JSON.parse(localStorage.getItem(REMOTE_CACHE_KEY) || 'null'); } catch (e) { return null; }
}
function remoteCacheWrite(payload) {
  try {
    localStorage.setItem(REMOTE_CACHE_KEY, JSON.stringify({ fetchedAt: new Date().toISOString(), payload }));
  } catch (e) { /* quota or private-mode — cache is best-effort only */ }
}

async function remoteHealthCheck() {
  if (!API_BASE_URL) return { ok: false, reason: 'not_configured' };
  try {
    const res = await fetch(`${API_BASE_URL}?action=health`);
    if (!res.ok) return { ok: false, reason: 'http_' + res.status };
    return await res.json();
  } catch (e) {
    return { ok: false, reason: e.message || 'network_error' };
  }
}

async function remoteBootstrap(fiscalYear) {
  if (!API_BASE_URL) return { ok: false, reason: 'not_configured' };
  try {
    const url = `${API_BASE_URL}?action=bootstrap&fiscal_year=${encodeURIComponent(fiscalYear || API_FISCAL_YEAR)}`;
    const res = await fetch(url);
    if (!res.ok) return { ok: false, reason: 'http_' + res.status };
    const data = await res.json();
    if (data && data.ok) remoteCacheWrite(data);
    return data;
  } catch (e) {
    return { ok: false, reason: e.message || 'network_error' };
  }
}

// Small, additive status readout only — never rendered at all when API_BASE_URL is empty.
//
// Presentation-only (2026-09-12 polish): this is a fallback-safe indicator, not an error state —
// offline/cache just means "showing local data," so no red/alarm treatment for either. A single
// muted dot + short phrase, no background pill, so it stays quieter than the KPI content around
// it. Colors are pulled from the existing theme tokens in shared.css (--text3/--amber/--lv5) —
// no new palette. This changes wording/color only; fallback/cache/API logic above is untouched.
function renderDataSourceBadge(state) {
  const header = document.querySelector('header');
  if (!header) return;
  let el = document.getElementById('dataSourceBadge');
  if (!el) {
    el = document.createElement('span');
    el.id = 'dataSourceBadge';
    el.style.cssText = 'margin-left:10px;font-size:11px;font-family:inherit;white-space:nowrap;display:inline-flex;align-items:center;gap:5px;';
    const asof = header.querySelector('.asof');
    if (asof) asof.insertAdjacentElement('afterend', el); else header.appendChild(el);
  }
  const styles = {
    online: { dot: 'var(--lv5, #2f9163)', text: 'ข้อมูลกลางพร้อมใช้งาน' },
    cache: { dot: 'var(--amber, #e0982c)', text: `ใช้ข้อมูลสำรองล่าสุด${state.fetchedAt ? ' · ' + new Date(state.fetchedAt).toLocaleString('th-TH') : ''}` },
    offline: { dot: 'var(--text3, #a99e93)', text: 'ใช้ข้อมูลสำรองในเครื่อง' },
  };
  const s = styles[state.mode] || styles.offline;
  el.innerHTML = `<span style="color:${s.dot};font-size:9px;line-height:1;">●</span><span style="color:var(--text3);">${s.text}</span>`;
  el.title = API_BASE_URL;
}

async function initRemoteBootstrap() {
  if (!API_BASE_URL) return; // no-op: config untouched, dashboard unchanged
  const result = await remoteBootstrap(API_FISCAL_YEAR);
  if (result && result.ok) {
    renderDataSourceBadge({ mode: 'online', count: (result.results || []).length });
    if (typeof remotePilotOnBootstrap === 'function') remotePilotOnBootstrap(result);
    return;
  }
  const cached = remoteCacheRead();
  if (cached && cached.payload) renderDataSourceBadge({ mode: 'cache', fetchedAt: cached.fetchedAt });
  else renderDataSourceBadge({ mode: 'offline' });
}

window.addEventListener('DOMContentLoaded', initRemoteBootstrap);

// ═══════════════════════════════════════════════════════════
// STEP 5B — Secure Write API client. Console/manual-test surface only in this phase; no Entry
// button calls any of this yet. See apps_script/Code.gs for the server side.
//
// Auth token: a human types it in at runtime (apiSetWriteToken) — never hardcoded here, never
// committed. Kept in a page-memory variable first; sessionStorage is only a same-tab-session
// convenience so a reload mid-test doesn't force re-entry. Never localStorage (would outlive the
// tab/session), never included in entry_store.js's UAT export/import (different keys entirely —
// uatTransferExportPayload only ever reads UAT_TRANSFER_KEYS, which this key is not part of).
// ═══════════════════════════════════════════════════════════
const WRITE_TOKEN_SESSION_KEY = 'mou69_write_token_session';
let _writeTokenMemory = null;

function apiSetWriteToken(token) {
  _writeTokenMemory = token || null;
  try {
    if (token) sessionStorage.setItem(WRITE_TOKEN_SESSION_KEY, token);
    else sessionStorage.removeItem(WRITE_TOKEN_SESSION_KEY);
  } catch (e) { /* private mode / quota — the in-memory copy still works for this tab */ }
}
function apiGetWriteToken() {
  if (_writeTokenMemory) return _writeTokenMemory;
  try { return sessionStorage.getItem(WRITE_TOKEN_SESSION_KEY); } catch (e) { return null; }
}
function apiClearWriteToken() { apiSetWriteToken(null); }

function apiRequestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
}

// `action` must be one of the server's own allowlisted actions — this function is not a generic
// write API, it just forwards to one. Deliberately sends a plain string body with NO Content-Type
// header: that keeps the request a CORS "simple request" (no preflight), which Apps Script Web
// Apps don't handle by default — see Code.gs's doPost comment. e.postData.contents on the server
// still parses fine as JSON regardless of the (unset) content type.
async function apiWrite(action, fields) {
  if (!API_BASE_URL) return { ok: false, code: 'NOT_CONFIGURED' };
  const token = apiGetWriteToken();
  if (!token) return { ok: false, code: 'UNAUTHORIZED', message: 'No write token set for this session — call apiSetWriteToken(token) first.' };
  const body = Object.assign({ action: action, authToken: token, requestId: apiRequestId() }, fields);
  try {
    const res = await fetch(API_BASE_URL, { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) return { ok: false, code: 'HTTP_ERROR', message: 'http_' + res.status };
    return await res.json();
  } catch (e) {
    return { ok: false, code: 'NETWORK_ERROR', message: e.message || 'network_error' };
  }
}

// Writes only AUDIT_LOG (never KPI_RESULT/etc.) — the one action that doesn't depend on any
// quarter's period status, used to prove the write pipe works without touching KPI data.
function apiWriteSmokeTest(actorName) {
  return apiWrite('writeSmokeTest', { actorName: actorName || '', clientInfo: 'RDE_MOU69 dashboard' });
}
// These three always return QUARTER_LOCKED/QUARTER_NOT_OPEN/QUARTER_READ_ONLY in this phase —
// every quarter's server-side period status is non-'open' until a future phase changes that by
// hand in PERIOD_CONTROL. Kept ready (and correct) for Step 5C to wire into real UI buttons.
function apiSaveDraft(kpiId, quarter, payload, actorName) {
  return apiWrite('saveDraft', { fiscalYear: API_FISCAL_YEAR, quarter: quarter, kpiId: kpiId, payload: payload || {}, actorName: actorName || '' });
}
function apiSubmitEntry(kpiId, quarter, payload, actorName) {
  return apiWrite('submitEntry', { fiscalYear: API_FISCAL_YEAR, quarter: quarter, kpiId: kpiId, payload: payload || {}, actorName: actorName || '' });
}
function apiConfirmEntry(kpiId, quarter, payload, actorName) {
  return apiWrite('confirmEntry', { fiscalYear: API_FISCAL_YEAR, quarter: quarter, kpiId: kpiId, payload: payload || {}, actorName: actorName || '' });
}
