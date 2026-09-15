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
// STEP 5B.1/5B.2/5B.3 — CORS-safe write transport: hidden iframe -> google.script.run, replacing
// the direct fetch() POST used through commit ab14576 (Apps Script Web Apps don't send
// Access-Control-Allow-Origin on a POST response by default, so a cors-mode fetch() throws
// "Failed to fetch" even on a successful write — google.script.run isn't subject to CORS at all).
//
// 5B.2 tried: Bridge.html creates a MessageChannel itself and sends READY (with the transferred
// port) via window.top.postMessage. That FAILED in production: Apps Script's HtmlService nests
// the served page inside a script.google.com wrapper iframe, which itself contains the
// *.googleusercontent.com sandbox iframe Bridge.html really executes in — and that sandbox's OWN
// window.top is itself (or the googleusercontent wrapper), never the GitHub page, so
// `window.top.postMessage(..., 'https://pdee-hub.github.io', ...)` threw a target-origin mismatch
// at the browser level before the message could even be sent.
//
// 5B.3 fix: flip who initiates. This page (the parent) reads the inner sandbox WindowProxy via
// `bridgeIframe.contentWindow.frames[0]` (only `.frames`/`.length`/`.postMessage` are ever
// touched on that cross-origin object — never `.document`), creates the MessageChannel itself,
// and sends BRIDGE_INIT with the transferred port DIRECTLY to that WindowProxy with
// targetOrigin '*'. '*' is acceptable here ONLY because this one bootstrap message carries
// nothing but a random per-session nonce and a MessagePort — no authToken, no KPI payload — and
// is addressed to a WindowProxy this page itself just selected (never attacker-influenced).
// Bridge.html then validates that INIT (exact GitHub origin + channel/type + matching nonce +
// exactly one port) before trusting it, and replies READY over the now-established port. Every
// message after that — including every later HEALTH/WRITE call carrying authToken — travels only
// over that dedicated MessagePort; there is no window-level postMessage anywhere in the RPC path,
// and Bridge.html's one remaining window-message listener only ever accepts BRIDGE_INIT.
//
// A single hidden iframe (id="mou69-write-bridge") is created once and reused for the whole page
// session — never recreated per write; only the INIT handshake step is retried (new
// MessageChannel each attempt) until the inner frame exists and answers, or BRIDGE_READY_TIMEOUT_MS.
// ═══════════════════════════════════════════════════════════
const BRIDGE_CHANNEL = 'MOU69_WRITE_BRIDGE';
const BRIDGE_READY_TIMEOUT_MS = 10000;
const BRIDGE_RPC_TIMEOUT_MS = 18000;
const BRIDGE_INIT_RETRY_MS = 150;

// Handshake nonce only — proves "this INIT/READY answers the iframe THIS page just created,"
// nothing more. NEVER the write auth token (that's MOU69_WRITE_TOKEN, checked server-side in
// checkAuth_ — completely separate). 128 bits, regenerated fresh per bridge session.
function generateBridgeSessionId_() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}

let _bridgeIframe = null;
let _bridgeSessionId = null; // this page's own random nonce for the current handshake
let _bridgePort = null;      // the MessagePort this page keeps once Bridge.html answers READY on it
let _bridgeReadyPromise = null;
let _bridgePollHandle = null;
let _bridgeTimeoutHandle = null;
const _bridgePending = {}; // messageId -> { resolve, timeoutHandle }

// Steady-state RPC handler — everything AFTER the handshake, over the dedicated port only. No
// window-level postMessage, no dependency on which nested frame Bridge.html happens to run in.
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

    const iframe = document.createElement('iframe');
    iframe.id = 'mou69-write-bridge';
    iframe.style.display = 'none';
    iframe.setAttribute('aria-hidden', 'true');
    // bridgeSession is a handshake nonce ONLY — never the write token, never anything sensitive —
    // so putting it in the iframe URL is fine (it protects nothing on its own; see the header note).
    iframe.src = API_BASE_URL + '?view=write_bridge&bridgeSession=' + encodeURIComponent(_bridgeSessionId);
    document.body.appendChild(iframe);
    _bridgeIframe = iframe;

    let settled = false;

    // §1/§7: the inner Apps Script sandbox frame (where Bridge.html actually runs) may not exist
    // in the DOM the instant the outer iframe's src is set, and even once it does, Bridge.html's
    // own script may not have attached its listener yet — so this retries the WHOLE
    // discover+send step (a fresh MessageChannel each time) until a READY comes back. Only
    // .frames/.length/.postMessage are ever touched on the cross-origin WindowProxy — never
    // .document — per the browser's own safe cross-origin Window allowlist.
    function trySendInit() {
      if (settled) return;
      let innerWindow = null;
      try {
        const cw = iframe.contentWindow;
        if (cw && cw.frames && cw.frames.length > 0) innerWindow = cw.frames[0];
      } catch (e) { innerWindow = null; }
      if (!innerWindow) return;

      const channel = new MessageChannel();
      const port1 = channel.port1;
      port1.onmessage = function (event) {
        if (settled) return;
        const data = event.data;
        if (!data || data.channel !== BRIDGE_CHANNEL || data.type !== 'BRIDGE_READY' || data.bridgeSession !== _bridgeSessionId) return;
        settled = true;
        if (_bridgePollHandle) { clearInterval(_bridgePollHandle); _bridgePollHandle = null; }
        if (_bridgeTimeoutHandle) { clearTimeout(_bridgeTimeoutHandle); _bridgeTimeoutHandle = null; }
        port1.onmessage = _bridgePortMessageHandler; // switch to steady-state RPC handling
        _bridgePort = port1;
        resolve();
      };
      port1.start();
      // §3: targetOrigin '*' — ONLY for this one bootstrap message, which carries nothing but a
      // random nonce and a MessagePort, sent to a WindowProxy THIS page itself just selected.
      // Never used again after this; no authToken/KPI payload ever travels this way.
      innerWindow.postMessage({ channel: BRIDGE_CHANNEL, type: 'BRIDGE_INIT', bridgeSession: _bridgeSessionId }, '*', [channel.port2]);
    }

    _bridgeTimeoutHandle = setTimeout(function () {
      if (settled) return;
      settled = true;
      if (_bridgePollHandle) { clearInterval(_bridgePollHandle); _bridgePollHandle = null; }
      reject(new Error('Write bridge did not become ready in time.'));
    }, BRIDGE_READY_TIMEOUT_MS);

    _bridgePollHandle = setInterval(trySendInit, BRIDGE_INIT_RETRY_MS);
    trySendInit(); // also try immediately, don't wait a full poll interval
  });
  return _bridgeReadyPromise;
}

// Full reset (§9): closes the port, drops the iframe, fails every still-pending call, clears any
// in-flight handshake timers, and resets all state so the next ensureBridgeReady() performs a
// completely fresh handshake with a new session nonce and a new (single) iframe. Not called
// automatically anywhere in this phase — kept for future use.
function resetBridge() {
  if (_bridgePollHandle) { clearInterval(_bridgePollHandle); _bridgePollHandle = null; }
  if (_bridgeTimeoutHandle) { clearTimeout(_bridgeTimeoutHandle); _bridgeTimeoutHandle = null; }
  if (_bridgePort) { try { _bridgePort.close(); } catch (e) {} }
  if (_bridgeIframe && _bridgeIframe.parentNode) _bridgeIframe.parentNode.removeChild(_bridgeIframe);
  Object.keys(_bridgePending).forEach(function (id) {
    clearTimeout(_bridgePending[id].timeoutHandle);
    _bridgePending[id].resolve({ ok: false, code: 'BRIDGE_ERROR', message: 'Bridge was reset.' });
    delete _bridgePending[id];
  });
  _bridgeIframe = null;
  _bridgePort = null;
  _bridgeSessionId = null;
  _bridgeReadyPromise = null;
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
