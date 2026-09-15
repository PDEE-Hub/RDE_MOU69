// Code.gs — MOU69_DB read-only bridge (Phase 1: health + bootstrap only).
//
// Scope: READ-ONLY. This script never writes a single cell. saveResult/saveValues/saveIssue/
// saveEvidence/saveFramework are NOT implemented here — that's a later phase, after this
// read-only path is verified end-to-end.
//
// Q3 FY2569 = FINAL / LOCKED. Current Apps Script is READ-ONLY. Any future Phase 2 write
// endpoint MUST enforce server-side quarter status before modifying Google Sheets.
//
// Deploy: Extensions > Apps Script from within MOU69_DB itself (or a standalone script bound to
// it), paste this file in as Code.gs, then Deploy > New deployment > Web app.
//   - Execute as: Me
//   - Who has access: Anyone
// See the chat message for the full step-by-step and how to test `health`/`bootstrap`.
//
// SPREADSHEET_ID below is not a secret — it only works because this script's own execution
// identity ("Execute as: Me") has access to the sheet. No API key/token/credential is embedded.
const SPREADSHEET_ID = '1bsk61h_9nSRhtORpdeAPhWAL0lkXinnDoTAvVu5QItA';

// bootstrap's output keys, mapped to MOU69_DB's real sheet/tab names (schema is the source of
// truth per the agreed contract — this script must never rename a column or create a sheet).
const READ_SHEETS = {
  results: 'KPI_RESULT',
  values: 'KPI_VALUES',
  issues: 'KPI_ISSUES',
  evidence: 'KPI_EVIDENCE',
  framework: 'KPI_FRAMEWORK',
};

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';
  const view = (e && e.parameter && e.parameter.view) || '';
  try {
    // Step 5B.1: the only new route. Existing action=health/action=bootstrap behavior below is
    // completely untouched — this is checked first only because `view` and `action` are
    // different query params entirely, never a behavior change to the JSON GET API.
    if (view === 'write_bridge') return renderWriteBridge_();
    if (action === 'health') return jsonOut(handleHealth());
    if (action === 'bootstrap') return jsonOut(handleBootstrap(e.parameter.fiscal_year));
    return jsonOut({ ok: false, error: 'unknown_action', action: action });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message || err) });
  }
}

// Serves apps_script/Bridge.html — a tiny, UI-less page whose only job is to receive a
// postMessage from the GitHub Pages parent, forward it to bridgeWrite/bridgeHealth via
// google.script.run, and postMessage the result back. ALLOWALL is required for Google to let
// this specific page be embedded in an iframe on another origin; it does NOT affect the JSON
// GET API's CORS behavior in any way (that's a separate, unrelated response path).
function renderWriteBridge_() {
  return HtmlService.createTemplateFromFile('Bridge')
    .evaluate()
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handleHealth() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return {
    ok: true,
    sheetId: SPREADSHEET_ID,
    sheetTitles: ss.getSheets().map(function (s) { return s.getName(); }),
    checkedAt: new Date().toISOString(),
  };
}

// Generic header-row → array-of-objects mapper. Deliberately does not hardcode a column list,
// so the script keeps working unchanged if a column is ever added to a sheet (schema stays the
// single source of truth in the sheet itself, per the agreed rule: never rename/reshape here).
function sheetToObjects(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1)
    .filter(function (row) { return row.some(function (cell) { return cell !== '' && cell !== null; }); })
    .map(function (row) {
      const obj = {};
      headers.forEach(function (h, i) { if (h) obj[h] = row[i]; });
      return obj;
    });
}

function handleBootstrap(fiscalYear) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const out = { ok: true, fiscal_year: fiscalYear || null, fetchedAt: new Date().toISOString() };
  Object.keys(READ_SHEETS).forEach(function (key) {
    const sheet = ss.getSheetByName(READ_SHEETS[key]);
    if (!sheet) { out[key] = []; return; }
    let rows = sheetToObjects(sheet);
    if (fiscalYear) rows = rows.filter(function (r) { return String(r.fiscal_year) === String(fiscalYear); });
    out[key] = rows;
  });
  // Step 5B §15 — backward-compatible addition: server-side period status, so a future client
  // can eventually trust this over its own static QUARTER_STATUS. Never removes/renames an
  // existing bootstrap key. Falls back to the safe (never-writable) defaults if PERIOD_CONTROL
  // hasn't been set up yet (setupPeriodControl_) or has no row for this fiscal year.
  out.periodControl = getPeriodControlMap_(fiscalYear);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 5B — SECURE CENTRAL WRITE API
//
// Adds a minimal, allowlisted doPost surface behind: (1) a shared-secret token compared against
// a Script Property (never a value in this file, never in the repo), (2) a server-side
// PERIOD_CONTROL sheet that is the ONLY source of truth for whether a quarter can be written
// (the client's QUARTER_STATUS is UX only — never trusted here), (3) LockService serialization,
// (4) requestId idempotency via AUDIT_LOG. See the chat message / repo for the full manual
// deploy checklist (Script Property + setupPeriodControl_() must be run by hand — this
// environment cannot do either).
//
// Every quarter's status today (Q1/Q2 historical, Q3 locked, Q4 not_open) is deliberately NEVER
// 'open', so saveDraft/submitEntry/confirmEntry are reachable but can never actually write a KPI
// row in this phase — only writeSmokeTest (which never touches KPI data) can succeed. That's the
// intended Step 5B behavior, not a bug: it proves the pipe works without opening Q4.
// ═══════════════════════════════════════════════════════════════════════════

const WRITE_ACTIONS = ['writeSmokeTest', 'saveDraft', 'submitEntry', 'confirmEntry'];
const PERIOD_BLOCK_CODE = { historical: 'QUARTER_READ_ONLY', locked: 'QUARTER_LOCKED', not_open: 'QUARTER_NOT_OPEN' };

// ── PERIOD_CONTROL — server-side quarter status (§2/§3) ──
const PERIOD_CONTROL_HEADERS = ['fiscal_year', 'quarter', 'status', 'opened_at', 'opened_by', 'locked_at', 'locked_by', 'updated_at', 'updated_by', 'version', 'notes'];

// Admin-only, run BY HAND from the Apps Script editor (Run > setupPeriodControl_). Never exposed
// through doGet/doPost — a public request can never trigger this. Idempotent: safe to run again
// (won't recreate the sheet, won't duplicate a fiscal_year+quarter row that already exists).
function setupPeriodControl_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName('PERIOD_CONTROL');
  if (!sheet) sheet = ss.insertSheet('PERIOD_CONTROL');
  if (sheet.getLastRow() === 0) sheet.appendRow(PERIOD_CONTROL_HEADERS);
  const existing = sheetToObjects(sheet);
  const seed = [
    { quarter: 'Q1', status: 'historical' },
    { quarter: 'Q2', status: 'historical' },
    { quarter: 'Q3', status: 'locked' },
    { quarter: 'Q4', status: 'not_open' },
  ];
  const now = new Date().toISOString();
  let added = 0;
  seed.forEach(function (s) {
    const already = existing.some(function (r) { return String(r.fiscal_year) === '2569' && String(r.quarter).toUpperCase() === s.quarter; });
    if (already) return;
    sheet.appendRow(['2569', s.quarter, s.status, '', '', '', '', now, 'setupPeriodControl_', 1, 'seed']);
    added++;
  });
  return { ok: true, message: 'PERIOD_CONTROL ready', rowsAdded: added };
}

function getPeriodStatus_(fiscalYear, quarter) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('PERIOD_CONTROL');
  if (!sheet) return null; // not set up yet — caller must fail closed, never treat as writable
  const rows = sheetToObjects(sheet);
  const row = rows.find(function (r) { return String(r.fiscal_year) === String(fiscalYear) && String(r.quarter).toUpperCase() === String(quarter).toUpperCase(); });
  return row ? String(row.status || '').toLowerCase() : null;
}
function getPeriodControlMap_(fiscalYear) {
  const fallback = { Q1: 'historical', Q2: 'historical', Q3: 'locked', Q4: 'not_open' }; // never 'open'
  const fy = fiscalYear || '2569';
  const out = {};
  ['Q1', 'Q2', 'Q3', 'Q4'].forEach(function (q) {
    const status = getPeriodStatus_(fy, q);
    out[q] = status || fallback[q];
  });
  return out;
}
// Server's own gate — never trusts a "locked"/"open" flag the client might send. status === null
// (PERIOD_CONTROL not set up yet) fails closed as QUARTER_NOT_OPEN, same as an actual not_open row.
function assertQuarterWritable_(fiscalYear, quarter) {
  const status = getPeriodStatus_(fiscalYear, quarter);
  if (status === 'open') return { ok: true };
  const code = status === null ? 'QUARTER_NOT_OPEN' : (PERIOD_BLOCK_CODE[status] || 'QUARTER_NOT_OPEN');
  return { ok: false, code: code };
}

// ── AUDIT_LOG — header-aware like sheetToObjects/bootstrap: reads whatever header row the sheet
// actually has (creating the canonical one below only if the sheet is empty), so this never
// assumes a fixed column position and never rewrites an existing header. ──
const AUDIT_LOG_HEADERS = ['timestamp', 'actor', 'authenticated', 'action', 'entity_type', 'entity_id', 'kpi_id', 'quarter', 'status_before', 'status_after', 'request_id', 'client_info', 'notes'];
function ensureAuditLogSheet_(ss) {
  let sheet = ss.getSheetByName('AUDIT_LOG');
  if (!sheet) sheet = ss.insertSheet('AUDIT_LOG');
  if (sheet.getLastRow() === 0) sheet.appendRow(AUDIT_LOG_HEADERS);
  return sheet;
}
// fields is a plain object keyed by column name — never authToken/secret. Unknown headers in the
// sheet just get '' (no crash); unknown keys in `fields` are silently dropped (never a stray column).
function writeAuditLog_(fields) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ensureAuditLogSheet_(ss);
  const headerRow = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  const headers = (headerRow.length && headerRow[0]) ? headerRow : AUDIT_LOG_HEADERS;
  sheet.appendRow(headers.map(function (h) { return fields[h] !== undefined ? fields[h] : ''; }));
}
// Idempotency (§8): a PRIOR SUCCESS with this requestId means "already done" — never re-run the
// write. A prior rejection (blocked/invalid) with the same requestId is not a success and must
// still be re-evaluated normally (so a legitimately-retried-after-fixing request can go through).
function findSuccessfulAuditByRequestId_(requestId) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('AUDIT_LOG');
  if (!sheet) return null;
  const rows = sheetToObjects(sheet);
  return rows.find(function (r) { return String(r.request_id) === String(requestId) && String(r.status_after) === 'success'; }) || null;
}
// §13: only log a period-blocked KPI write attempt (no payload, no token) — not every
// unauthenticated/malformed request, to avoid flooding AUDIT_LOG.
function logPeriodBlocked_(action, kpiId, quarter, code, requestId, actorName) {
  writeAuditLog_({
    timestamp: new Date().toISOString(), actor: String(actorName || ''), authenticated: true,
    action: action, entity_type: 'kpi_result', entity_id: kpiId, kpi_id: kpiId, quarter: quarter,
    status_before: '', status_after: code, request_id: requestId, client_info: '', notes: 'blocked by PERIOD_CONTROL',
  });
}

// ── Auth (§6) — never echoes the token back, never logs it (Logger.log or AUDIT_LOG), never
// hardcodes it. A missing Script Property or a missing/mismatched client token both just fail. ──
function checkAuth_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('MOU69_WRITE_TOKEN');
  if (!expected || !token) return false;
  return String(token) === String(expected);
}

function validRequestId_(id) { return typeof id === 'string' && id.length >= 4 && id.length <= 128; }
const KPI_ID_FORMAT = /^[0-9]+(\.[0-9]+){0,3}$/; // e.g. "1.1", "2.7.3.1" — a value, never a sheet/range name
const SUPPORTED_FISCAL_YEAR = '2569';

// ── KPI_RESULT writer (§11/§12) — shared by saveDraft/submitEntry/confirmEntry. UNREACHABLE in
// Step 5B (assertQuarterWritable_ above never returns ok:true for any quarter yet) but kept fully
// correct now so Step 5C only has to open a quarter, not write this logic under time pressure.
function currentLatestRow_(rows, fiscalYear, quarter, kpiId) {
  return rows.find(function (r) {
    return String(r.fiscal_year) === fiscalYear && String(r.quarter) === quarter && String(r.kpi_id) === kpiId &&
      (r.is_latest === true || String(r.is_latest).toLowerCase() === 'true');
  }) || null;
}
function writeKpiResult_(fiscalYear, quarter, kpiId, status, extraFields, actor) {
  // Defense-in-depth beyond the period gate already checked by the caller — Q3 rows must never
  // be touched by this function under any circumstance (§12).
  if (quarter === 'Q3') throw new Error('Q3 is immutable — refusing to write.');
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('KPI_RESULT');
  if (!sheet) throw new Error('KPI_RESULT sheet missing');
  const rows = sheetToObjects(sheet);
  const sameRecord = rows.filter(function (r) { return String(r.fiscal_year) === fiscalYear && String(r.quarter) === quarter && String(r.kpi_id) === kpiId; });
  const version = sameRecord.reduce(function (max, r) { const v = Number(r.version) || 0; return v > max ? v : max; }, 0) + 1;
  const prevLatest = currentLatestRow_(rows, fiscalYear, quarter, kpiId);
  const statusBefore = prevLatest ? String(prevLatest.status || '') : '';

  // Flip the previous is_latest TRUE row (if any) to FALSE before appending the new one.
  const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = function (name) { return headerRow.indexOf(name); };
  const latestCol = col('is_latest'), fyCol = col('fiscal_year'), qCol = col('quarter'), kCol = col('kpi_id');
  if (prevLatest && latestCol > -1 && fyCol > -1 && qCol > -1 && kCol > -1) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (String(row[fyCol]) === fiscalYear && String(row[qCol]) === quarter && String(row[kCol]) === kpiId &&
        (row[latestCol] === true || String(row[latestCol]).toLowerCase() === 'true')) {
        sheet.getRange(i + 1, latestCol + 1).setValue(false);
      }
    }
  }

  const now = new Date().toISOString();
  const recordId = 'MOU69-' + fiscalYear + '-' + quarter + '-' + kpiId + '-v' + version;
  const record = Object.assign({
    record_id: recordId, fiscal_year: fiscalYear, kpi_id: kpiId, quarter: quarter,
    status: status, version: version, is_latest: true, updated_by: actor, updated_at: now,
  }, extraFields);
  sheet.appendRow(headerRow.map(function (h) { return record[h] !== undefined ? record[h] : ''; }));
  return { record: record, statusBefore: statusBefore };
}

function handleWriteSmokeTest_(body, requestId) {
  writeAuditLog_({
    timestamp: new Date().toISOString(), actor: String(body.actorName || ''), authenticated: true,
    action: 'api_write_smoke_test', entity_type: 'system', entity_id: 'MOU69_WRITE_API',
    kpi_id: '', quarter: '', status_before: '', status_after: 'success',
    request_id: requestId, client_info: String(body.clientInfo || ''), notes: 'Secure Write API smoke test',
  });
  return { ok: true, action: 'writeSmokeTest', requestId: requestId };
}

function validateKpiWriteRequest_(body) {
  const fiscalYear = String(body.fiscalYear || '');
  const quarter = String(body.quarter || '').toUpperCase();
  const kpiId = String(body.kpiId || '');
  if (fiscalYear !== SUPPORTED_FISCAL_YEAR) return { ok: false, code: 'INVALID_REQUEST', message: 'Unsupported fiscal year.' };
  if (['Q1', 'Q2', 'Q3', 'Q4'].indexOf(quarter) === -1) return { ok: false, code: 'INVALID_REQUEST', message: 'Invalid quarter.' };
  if (!KPI_ID_FORMAT.test(kpiId)) return { ok: false, code: 'INVALID_REQUEST', message: 'Invalid kpiId format.' };
  return { ok: true, fiscalYear: fiscalYear, quarter: quarter, kpiId: kpiId };
}

function handleSaveDraft_(body, requestId, ctx) {
  const actor = String(body.actorName || 'unknown');
  const payload = body.payload || {};
  const r = writeKpiResult_(ctx.fiscalYear, ctx.quarter, ctx.kpiId, 'draft', {
    actual: payload.actual !== undefined ? payload.actual : '',
    summary_text: payload.summaryText || '',
    submitted_by: actor,
  }, actor);
  writeAuditLog_({ timestamp: new Date().toISOString(), actor: actor, authenticated: true, action: 'saveDraft', entity_type: 'kpi_result', entity_id: ctx.kpiId, kpi_id: ctx.kpiId, quarter: ctx.quarter, status_before: r.statusBefore, status_after: 'success', request_id: requestId, client_info: '', notes: 'draft v' + r.record.version });
  return { ok: true, action: 'saveDraft', requestId: requestId, recordId: r.record.record_id, version: r.record.version };
}
function handleSubmitEntry_(body, requestId, ctx) {
  const actor = String(body.actorName || 'unknown');
  const payload = body.payload || {};
  const r = writeKpiResult_(ctx.fiscalYear, ctx.quarter, ctx.kpiId, 'submitted', {
    actual: payload.actual !== undefined ? payload.actual : '',
    summary_text: payload.summaryText || '',
    submitted_by: actor, submitted_at: new Date().toISOString(),
  }, actor);
  writeAuditLog_({ timestamp: new Date().toISOString(), actor: actor, authenticated: true, action: 'submitEntry', entity_type: 'kpi_result', entity_id: ctx.kpiId, kpi_id: ctx.kpiId, quarter: ctx.quarter, status_before: r.statusBefore, status_after: 'success', request_id: requestId, client_info: '', notes: 'submitted v' + r.record.version });
  return { ok: true, action: 'submitEntry', requestId: requestId, recordId: r.record.record_id, version: r.record.version };
}
function handleConfirmEntry_(body, requestId, ctx) {
  const actor = String(body.actorName || 'unknown');
  const payload = body.payload || {};
  const r = writeKpiResult_(ctx.fiscalYear, ctx.quarter, ctx.kpiId, 'confirmed', {
    actual: payload.actual !== undefined ? payload.actual : '',
    score_final: payload.scoreFinal !== undefined ? payload.scoreFinal : '',
    summary_text: payload.summaryText || '',
    confirmed_by: actor, confirmed_at: new Date().toISOString(),
  }, actor);
  writeAuditLog_({ timestamp: new Date().toISOString(), actor: actor, authenticated: true, action: 'confirmEntry', entity_type: 'kpi_result', entity_id: ctx.kpiId, kpi_id: ctx.kpiId, quarter: ctx.quarter, status_before: r.statusBefore, status_after: 'success', request_id: requestId, client_info: '', notes: 'confirmed v' + r.record.version });
  return { ok: true, action: 'confirmEntry', requestId: requestId, recordId: r.record.record_id, version: r.record.version };
}

// ── processWriteRequest_ — the ONE write processor. Both doPost (fetch/curl transport) and
// bridgeWrite (google.script.run/postMessage transport, Step 5B.1) call this and nothing else —
// there is no duplicate copy of auth/lock/idempotency/period/write logic anywhere. Takes and
// returns a plain JS object; callers decide how to wrap/ship it (jsonOut for doPost, direct
// return for bridgeWrite since google.script.run serializes plain objects itself).
//
// Auth is checked TWICE, deliberately —
//   (1) BEFORE acquiring ScriptLock, so an unauthenticated/public request is rejected on a cheap
//       PropertiesService read and never gets to contend for the lock at all (a flood of bad
//       requests can't starve a legitimate writer waiting on the lock).
//   (2) AGAIN immediately after the lock is held, alongside idempotency and period status — the
//       only checks that are allowed to be trusted are the ones made while holding the lock,
//       since that's the only point nothing else can change out from under this request.
// Neither check replaces the other. ──
function processWriteRequest_(body) {
  let gotLock = false;
  let lock = null;
  try {
    if (!body || typeof body !== 'object') {
      return { ok: false, code: 'INVALID_REQUEST', message: 'Malformed request body.' };
    }

    const action = body.action;
    if (!action || WRITE_ACTIONS.indexOf(action) === -1) {
      return { ok: false, code: 'UNKNOWN_ACTION', message: 'Unknown or missing action.' };
    }

    // (1) Pre-lock auth gate — an unauthenticated caller is turned away before it can ever
    // contend for the ScriptLock.
    if (!checkAuth_(body.authToken)) {
      return { ok: false, code: 'UNAUTHORIZED', message: 'Invalid or missing auth token.' };
    }

    lock = LockService.getScriptLock();
    gotLock = lock.tryLock(10000);
    if (!gotLock) {
      return { ok: false, code: 'WRITE_LOCK_TIMEOUT', message: 'Server busy, try again.' };
    }

    // (2) Post-lock re-checks — nothing from before the lock is trusted here.
    if (!checkAuth_(body.authToken)) {
      return { ok: false, code: 'UNAUTHORIZED', message: 'Invalid or missing auth token.' };
    }
    const requestId = body.requestId;
    if (!validRequestId_(requestId)) {
      return { ok: false, code: 'INVALID_REQUEST', message: 'requestId is required.' };
    }
    const dup = findSuccessfulAuditByRequestId_(requestId);
    if (dup) {
      return { ok: true, code: 'DUPLICATE_REQUEST', action: action, requestId: requestId, duplicate: true };
    }

    if (action === 'writeSmokeTest') {
      return handleWriteSmokeTest_(body, requestId);
    }

    // saveDraft / submitEntry / confirmEntry — all KPI writes, all period-gated (re-checked here,
    // under the lock — current record/version is likewise read fresh inside writeKpiResult_).
    const v = validateKpiWriteRequest_(body);
    if (!v.ok) return v;
    const period = assertQuarterWritable_(v.fiscalYear, v.quarter);
    if (!period.ok) {
      logPeriodBlocked_(action, v.kpiId, v.quarter, period.code, requestId, body.actorName);
      return { ok: false, code: period.code, message: v.quarter + ' is not writable (' + period.code + ').' };
    }
    if (action === 'saveDraft') return handleSaveDraft_(body, requestId, v);
    if (action === 'submitEntry') return handleSubmitEntry_(body, requestId, v);
    if (action === 'confirmEntry') return handleConfirmEntry_(body, requestId, v);

    return { ok: false, code: 'UNKNOWN_ACTION', message: 'Action not implemented.' };
  } catch (err) {
    // §18/§19: never leak err.stack, secrets, or spreadsheet internals to the client.
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Unexpected server error.' };
  } finally {
    if (gotLock) lock.releaseLock();
  }
}

// doPost — kept as a direct write entry point alongside the bridge (Step 5B.1 §10, "Preferred"):
// useful for server-to-server/curl diagnostics without a browser, and costs nothing extra since
// it's a two-line wrapper around processWriteRequest_ — no logic is duplicated. The GitHub Pages
// FRONTEND no longer calls this at all (see api_client.js) because a browser silently drops the
// response of a cross-origin fetch() POST to this URL without an Access-Control-Allow-Origin
// header, which Apps Script Web Apps don't add by default.
function doPost(e) {
  let body;
  try {
    body = (e && e.postData && e.postData.contents) ? JSON.parse(e.postData.contents) : {};
  } catch (parseErr) {
    return jsonOut({ ok: false, code: 'INVALID_REQUEST', message: 'Malformed JSON body.' });
  }
  return jsonOut(processWriteRequest_(body));
}

// ── Bridge RPC surface (Step 5B.1) — PUBLIC functions (no trailing _) so google.script.run can
// call them from Bridge.html. Neither does anything processWriteRequest_/the sheets above don't
// already do; they're just the google.script.run-callable entry points. ──

// Called by Bridge.html for BRIDGE_WRITE. `body` arrives already as a plain JS object —
// google.script.run deserializes the argument for us; no JSON.parse needed here.
function bridgeWrite(body) {
  return processWriteRequest_(body || {});
}

// Called by Bridge.html for BRIDGE_HEALTH — proves iframe -> google.script.run -> Apps Script ->
// iframe works before a caller ever attempts a real write. Returns nothing sensitive: no secret,
// no token, no spreadsheet ID, no internal error detail.
function bridgeHealth() {
  return { ok: true, transport: 'google.script.run', service: 'MOU69', timestamp: new Date().toISOString() };
}
