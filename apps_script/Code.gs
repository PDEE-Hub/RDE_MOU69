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
