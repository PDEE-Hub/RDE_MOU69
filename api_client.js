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
// STEP 5B.1/5B.2 — CORS-safe write transport: hidden iframe -> google.script.run, replacing the
// direct fetch() POST used through commit ab14576 (Apps Script Web Apps don't send
// Access-Control-Allow-Origin on a POST response by default, so a cors-mode fetch() throws
// "Failed to fetch" even on a successful write — google.script.run isn't subject to CORS at all).
//
// 5B.2 fix: Apps Script's HtmlService actually nests the served page inside a Google
// script.google.com wrapper iframe, which itself contains a *.googleusercontent.com sandbox
// iframe that Bridge.html really runs in. That means the window that posts BRIDGE_READY is NOT
// this page's own `iframe.contentWindow` — checking `event.source === iframe.contentWindow`
// (5B.1's approach) rejects every legitimate READY. Fixed by switching the handshake to a
// MessageChannel: Bridge.html creates the channel itself and transfers port2 to window.top (this
// page) inside the READY message; every request/response after that travels over that dedicated
// MessagePort, never window-level postMessage again, so which nested frame Bridge.html actually
// runs in stops mattering. The READY message itself is still validated on three independent axes
// (channel+type, a random per-session nonce this page generated, and a strict Apps Script sandbox
// origin check) before its port is ever trusted — see _bridgeWindowMessageHandler below.
//
// A single hidden iframe (id="mou69-write-bridge") is created once and reused for the whole page
// session — never recreated per write.
// ═══════════════════════════════════════════════════════════
const BRIDGE_CHANNEL = 'MOU69_WRITE_BRIDGE';
const BRIDGE_READY_TIMEOUT_MS = 10000;
const BRIDGE_RPC_TIMEOUT_MS = 18000;

// Handshake nonce only — proves "this READY answers the iframe THIS page just created," nothing
// more. NEVER the write auth token (that's MOU69_WRITE_TOKEN, checked server-side in
// checkAuth_ — completely separate). 128 bits, regenerated fresh per bridge session.
function generateBridgeSessionId_() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}

// Strict allowlist, not a broad suffix match: Apps Script serves sandboxed HTML from
// script.googleusercontent.com itself or a "<prefix>-script.googleusercontent.com" subdomain —
// never accept googleusercontent.com generally (that's shared across many unrelated Google
// products/user content, far too broad for a security check).
function isStrictBridgeOrigin_(origin) {
  let u;
  try { u = new URL(origin); } catch (e) { return false; }
  if (u.protocol !== 'https:') return false;
  return u.hostname === 'script.googleusercontent.com' || u.hostname.endsWith('-script.googleusercontent.com');
}

let _bridgeIframe = null;
let _bridgeSessionId = null; // this page's own random nonce for the current handshake
let _bridgePort = null;      // the MessagePort transferred to us once READY is verified
let _bridgeReadyPromise = null;
let _bridgeReadyResolve = null;
const _bridgePending = {}; // messageId -> { resolve, timeoutHandle }

// Handles ONLY the initial BRIDGE_READY handshake (still a window-level postMessage, since that's
// the one message MessageChannel can't avoid — a port has to be delivered somehow). Every check
// below is independent and all must pass; none is skippable.
function _bridgeWindowMessageHandler(event) {
  if (_bridgePort) return; // already handshaken this session — a stray repeat is simply ignored
  const data = event.data;
  if (!data || data.channel !== BRIDGE_CHANNEL || data.type !== 'BRIDGE_READY') return; // (A)(B)
  if (!_bridgeSessionId || data.bridgeSession !== _bridgeSessionId) return; // (C) must match the nonce THIS page generated
  if (!isStrictBridgeOrigin_(event.origin)) return; // (D) strict Apps Script sandbox origin only
  if (!event.ports || event.ports.length !== 1) return; // (E) exactly one transferred MessagePort

  _bridgePort = event.ports[0];
  _bridgePort.onmessage = _bridgePortMessageHandler;
  _bridgePort.start();
  if (_bridgeReadyResolve) { _bridgeReadyResolve(); _bridgeReadyResolve = null; }
}

// All request/response traffic after the handshake — no window-level postMessage, no dependency
// on which nested frame Bridge.html happens to run in.
function _bridgePortMessageHandler(event) {
  const data = event.data;
  if (!data || data.channel !== BRIDGE_CHANNEL || data.bridgeSession !== _bridgeSessionId || data.type !== 'BRIDGE_RESPONSE') return;
  const pending = _bridgePending[data.messageId];
  if (!pending) return; // no longer waiting (already timed out, or unknown id) — drop it
  clearTimeout(pending.timeoutHandle);
  delete _bridgePending[data.messageId];
  if (data.ok) { pending.resolve(data.result); return; }
  const err = data.error || {};
  pending.resolve({ ok: false, code: err.code || 'BRIDGE_ERROR', message: err.message || 'Bridge request failed.' });
}

// Creates the iframe on first use only; every later call reuses the same iframe/promise/port.
function ensureBridgeReady() {
  if (_bridgeReadyPromise) return _bridgeReadyPromise;
  _bridgeReadyPromise = new Promise(function (resolve, reject) {
    if (!API_BASE_URL) { reject(new Error('API_BASE_URL not configured')); return; }
    _bridgeSessionId = generateBridgeSessionId_();
    _bridgeReadyResolve = resolve;
    window.addEventListener('message', _bridgeWindowMessageHandler, false);

    const iframe = document.createElement('iframe');
    iframe.id = 'mou69-write-bridge';
    iframe.style.display = 'none';
    iframe.setAttribute('aria-hidden', 'true');
    // bridgeSession is a handshake nonce ONLY — never the write token, never anything sensitive —
    // so putting it in the iframe URL is fine (it protects nothing on its own; see the header note).
    iframe.src = API_BASE_URL + '?view=write_bridge&bridgeSession=' + encodeURIComponent(_bridgeSessionId);
    document.body.appendChild(iframe);
    _bridgeIframe = iframe;

    setTimeout(function () {
      reject(new Error('Write bridge did not become ready in time.')); // no-op if already resolved
    }, BRIDGE_READY_TIMEOUT_MS);
  });
  return _bridgeReadyPromise;
}

// Full reset (§9): closes the port, drops the iframe, fails every still-pending call, and clears
// all handshake state so the next ensureBridgeReady() performs a completely fresh handshake with
// a new session nonce. Not called automatically anywhere in this phase — kept for future use.
function resetBridge() {
  if (_bridgePort) { try { _bridgePort.close(); } catch (e) {} }
  if (_bridgeIframe && _bridgeIframe.parentNode) _bridgeIframe.parentNode.removeChild(_bridgeIframe);
  window.removeEventListener('message', _bridgeWindowMessageHandler, false);
  Object.keys(_bridgePending).forEach(function (id) {
    clearTimeout(_bridgePending[id].timeoutHandle);
    _bridgePending[id].resolve({ ok: false, code: 'BRIDGE_ERROR', message: 'Bridge was reset.' });
    delete _bridgePending[id];
  });
  _bridgeIframe = null;
  _bridgePort = null;
  _bridgeSessionId = null;
  _bridgeReadyPromise = null;
  _bridgeReadyResolve = null;
}

function bridgeCall_(type, body, messageId) {
  return ensureBridgeReady().then(function () {
    return new Promise(function (resolve) {
      const timeoutHandle = setTimeout(function () {
        delete _bridgePending[messageId];
        resolve({ ok: false, code: 'BRIDGE_TIMEOUT', message: 'No response from write bridge.' });
      }, BRIDGE_RPC_TIMEOUT_MS);
      _bridgePending[messageId] = { resolve: resolve, timeoutHandle: timeoutHandle };
      // Dedicated MessagePort, not window.postMessage — no targetOrigin to get wrong, and no
      // nested-frame addressing problem, for this or any future call on this same port.
      _bridgePort.postMessage({ channel: BRIDGE_CHANNEL, type: type, bridgeSession: _bridgeSessionId, messageId: messageId, body: body });
    });
  }).catch(function (e) {
    return { ok: false, code: 'BRIDGE_ERROR', message: e.message || 'Bridge initialization failed.' };
  });
}

// Proves iframe -> google.script.run -> Apps Script -> iframe works, before a caller ever
// attempts a real write. Travels entirely over the MessagePort — no auth token involved.
async function apiBridgeHealth() {
  if (!API_BASE_URL) return { ok: false, code: 'NOT_CONFIGURED' };
  return bridgeCall_('BRIDGE_HEALTH', {}, apiRequestId());
}

// `action` must be one of the server's own allowlisted actions — this function is not a generic
// write API, it just forwards to one, over the MessagePort bridge. External contract is unchanged
// from Step 5B (still an async function resolving to {ok,...}) so Step 5C can call it without any
// rewrite. authToken travels inside `body` over the established MessagePort only — never the URL,
// never a window-level postMessage.
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
