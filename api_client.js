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

// ═══════════════════════════════════════════════════════════
// STEP 5B.1 — CORS-safe write transport: postMessage <-> hidden iframe <-> google.script.run,
// replacing the direct fetch() POST used through commit ab14576. That approach reached Apps
// Script fine (HTTP 200) but the browser silently discarded the response — Apps Script Web Apps
// don't send Access-Control-Allow-Origin on a POST response by default, so `mode:'cors'` fetch
// throws "Failed to fetch" even though the write itself would have gone through. This bridge
// avoids that failure mode entirely: google.script.run isn't subject to CORS at all.
//
// A single hidden iframe (id="mou69-write-bridge") is created once and reused for the whole page
// session — never recreated per write. It loads apps_script/Bridge.html via
// `${API_BASE_URL}?view=write_bridge`, which on load posts BRIDGE_READY back to this page.
// ═══════════════════════════════════════════════════════════
const BRIDGE_CHANNEL = 'MOU69_WRITE_BRIDGE';
const BRIDGE_READY_TIMEOUT_MS = 10000;
const BRIDGE_RPC_TIMEOUT_MS = 18000;

// A light sanity check only — Apps Script HTML output is served from a googleusercontent.com- or
// google.com-shaped HTTPS origin. This is NOT the security boundary (see _bridgeHandleMessage:
// every message, including this first one, is also required to have event.source === this exact
// iframe's contentWindow, which a page on another origin cannot spoof). If a future Apps Script
// change ever serves the bridge from something this pattern doesn't match, err on the side of
// refusing the handshake rather than loosening this to accept anything.
function isPlausibleBridgeOrigin_(origin) {
  return /^https:\/\/([a-z0-9-]+\.)*(googleusercontent\.com|google\.com)$/i.test(origin || '');
}

let _bridgeIframe = null;
let _bridgeOrigin = null; // pinned from the verified BRIDGE_READY handshake, for this page session
let _bridgeReadyPromise = null;
const _bridgePending = {}; // requestId -> { resolve, timeoutHandle }

function _bridgeHandleMessage(event) {
  // The un-spoofable check: only ever accept a message whose source is this exact iframe's own
  // window object. No other page, frame, or origin can forge that.
  if (!_bridgeIframe || event.source !== _bridgeIframe.contentWindow) return;
  const data = event.data;
  if (!data || data.channel !== BRIDGE_CHANNEL) return;

  if (data.type === 'BRIDGE_READY') {
    if (_bridgeOrigin) return; // already handshaken this session — ignore a stray repeat
    if (!isPlausibleBridgeOrigin_(event.origin)) return; // unexpected origin shape — refuse, don't loosen the check
    _bridgeOrigin = event.origin; // pinned for every subsequent message this session
    return;
  }

  if (data.type === 'BRIDGE_RESPONSE') {
    if (event.origin !== _bridgeOrigin) return; // must match the origin learned at handshake
    const pending = _bridgePending[data.id];
    if (!pending) return; // no longer waiting (already timed out, or unknown id) — drop it
    clearTimeout(pending.timeoutHandle);
    delete _bridgePending[data.id];
    if (data.ok) { pending.resolve(data.result); return; }
    const err = data.error || {};
    pending.resolve({ ok: false, code: err.code || 'BRIDGE_ERROR', message: err.message || 'Bridge request failed.' });
  }
}

// Creates the iframe on first use only; every later call reuses the same iframe/promise.
function ensureBridgeReady() {
  if (_bridgeReadyPromise) return _bridgeReadyPromise;
  _bridgeReadyPromise = new Promise(function (resolve, reject) {
    if (!API_BASE_URL) { reject(new Error('API_BASE_URL not configured')); return; }
    window.addEventListener('message', _bridgeHandleMessage, false);

    const iframe = document.createElement('iframe');
    iframe.id = 'mou69-write-bridge';
    iframe.style.display = 'none';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.src = API_BASE_URL + '?view=write_bridge';
    document.body.appendChild(iframe);
    _bridgeIframe = iframe;

    const timeoutHandle = setTimeout(function () {
      clearInterval(poll);
      reject(new Error('Write bridge did not become ready in time.'));
    }, BRIDGE_READY_TIMEOUT_MS);

    // _bridgeHandleMessage (event-driven) is what actually pins _bridgeOrigin; poll for that
    // having happened rather than adding a second, parallel message listener here.
    var poll = setInterval(function () {
      if (_bridgeOrigin) {
        clearInterval(poll);
        clearTimeout(timeoutHandle);
        resolve();
      }
    }, 100);
  });
  return _bridgeReadyPromise;
}

// If the iframe ever needs a hard reset (e.g. a caller detects it's wedged), this drops all
// bridge state so the next ensureBridgeReady() call performs a fresh handshake. Not called
// automatically anywhere in this phase — kept for completeness/future use.
function resetBridge() {
  if (_bridgeIframe && _bridgeIframe.parentNode) _bridgeIframe.parentNode.removeChild(_bridgeIframe);
  _bridgeIframe = null;
  _bridgeOrigin = null;
  _bridgeReadyPromise = null;
}

function bridgeCall_(type, body, id) {
  return ensureBridgeReady().then(function () {
    return new Promise(function (resolve) {
      const timeoutHandle = setTimeout(function () {
        delete _bridgePending[id];
        resolve({ ok: false, code: 'BRIDGE_TIMEOUT', message: 'No response from write bridge.' });
      }, BRIDGE_RPC_TIMEOUT_MS);
      _bridgePending[id] = { resolve: resolve, timeoutHandle: timeoutHandle };
      // Never '*' — targetOrigin is the exact origin learned at handshake, so a reply (or this
      // outgoing request, which may carry authToken in `body`) can only ever be delivered to the
      // genuine bridge window.
      _bridgeIframe.contentWindow.postMessage({ channel: BRIDGE_CHANNEL, type: type, id: id, body: body }, _bridgeOrigin);
    });
  }).catch(function (e) {
    return { ok: false, code: 'BRIDGE_ERROR', message: e.message || 'Bridge initialization failed.' };
  });
}

// Proves iframe -> google.script.run -> Apps Script -> iframe works, before a caller ever
// attempts a real write.
async function apiBridgeHealth() {
  if (!API_BASE_URL) return { ok: false, code: 'NOT_CONFIGURED' };
  return bridgeCall_('BRIDGE_HEALTH', {}, apiRequestId());
}

// `action` must be one of the server's own allowlisted actions — this function is not a generic
// write API, it just forwards to one, now over the postMessage bridge instead of fetch(). External
// contract is unchanged from Step 5B (still an async function resolving to {ok,...}) so Step 5C
// can call it without any rewrite.
async function apiWrite(action, fields) {
  if (!API_BASE_URL) return { ok: false, code: 'NOT_CONFIGURED' };
  const token = apiGetWriteToken();
  if (!token) return { ok: false, code: 'UNAUTHORIZED', message: 'No write token set for this session — call apiSetWriteToken(token) first.' };
  const requestId = apiRequestId();
  const body = Object.assign({ action: action, authToken: token, requestId: requestId }, fields);
  return bridgeCall_('BRIDGE_WRITE', body, requestId);
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
