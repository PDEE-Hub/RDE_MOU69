// Code.gs — MOU69_DB read-only bridge (Phase 1: health + bootstrap only).
//
// Scope: READ-ONLY. This script never writes a single cell. saveResult/saveValues/saveIssue/
// saveEvidence/saveFramework are NOT implemented here — that's a later phase, after this
// read-only path is verified end-to-end.
//
// Step 4 addendum (see the block near the bottom of this file): a doPost handler is now PREPARED
// here that rejects any write for a locked quarter (Q3) before it could ever reach a save*
// handler — but it has NOT been deployed to the live Web App yet (see that block's own comment
// for why and what deploying it involves). Today's live script is still exactly Phase 1 above.
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
  try {
    if (action === 'health') return jsonOut(handleHealth());
    if (action === 'bootstrap') return jsonOut(handleBootstrap(e.parameter.fiscal_year));
    return jsonOut({ ok: false, error: 'unknown_action', action: action });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message || err) });
  }
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
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 4 — LOCK Q3 FINAL, prepared server-side patch. NOT YET DEPLOYED.
//
// This block is written and ready, but the live Web App still runs WITHOUT it until someone
// pastes this whole file into the Apps Script editor (Extensions > Apps Script on MOU69_DB) and
// creates a NEW deployment version (Deploy > Manage deployments > pick the existing deployment >
// Edit (pencil) > Version: New version > Deploy). That step needs interactive Google auth this
// environment does not have — it was not run as part of this change.
//
// Today, before this patch is deployed: doPost does not exist at all in the live script, so ANY
// POST to the Web App already fails (Apps Script's default "doPost is not defined" error) — no
// quarter, including Q3, can be written today, but only because nothing implements a write yet,
// not because of an explicit rule. This patch makes that rule explicit and quarter-aware, so it's
// already correct on the day a real save* handler gets added (Step 5+), instead of relying on
// omission.
//
// QUARTER_LOCK mirrors the frontend's QUARTER_STATUS (entry_config.js) — keep both in sync by
// hand until there's a shared config source. Server does NOT trust any "locked" flag the client
// sends; it decides locked/open from this map alone.
const QUARTER_LOCK = { q1: 'historical', q2: 'historical', q3: 'locked', q4: 'not_open' };
function isQuarterLockedServer(quarter) {
  return QUARTER_LOCK[String(quarter || '').toLowerCase()] === 'locked';
}

function doPost(e) {
  try {
    const body = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    const action = (e && e.parameter && e.parameter.action) || body.action || '';
    const fiscalYear = body.fiscal_year || (e && e.parameter && e.parameter.fiscal_year) || null;
    const quarter = String(body.quarter || (e && e.parameter && e.parameter.quarter) || '').toLowerCase();

    if (quarter && isQuarterLockedServer(quarter)) {
      return jsonOut({
        ok: false,
        code: 'QUARTER_LOCKED',
        quarter: quarter.toUpperCase(),
        message: quarter.toUpperCase() + ' is finalized and read-only.',
      });
    }

    // No write action is implemented yet (see the module comment at the top of this file) — this
    // never claims to have written anything for a quarter that IS open. Once a real save* handler
    // is added for Q4 (Step 5+), route it here, after the lock check above, not before it.
    return jsonOut({ ok: false, error: 'not_implemented', action: action, fiscal_year: fiscalYear, quarter: quarter || null });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message || err) });
  }
}
