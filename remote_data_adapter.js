// remote_data_adapter.js — Remote Read (READ-ONLY), expanded from the KPI 2.1.1 pilot to every
// KPI that has a real KPI_RESULT record in MOU69_DB. (Renamed from remote_pilot_adapter.js now
// that it covers all KPIs, not just the original pilot.)
//
// Hydrates MOU69_DB rows — already fetched read-only by api_client.js's remoteBootstrap() —
// into the two choke points app.js already reads everything through: getQuarterInput() and
// publishedQuarterReport(). Home/Overview/Detail need zero changes because they only ever call
// those two functions (via scoreAt/reportText/reportValue), never MOU_DATA/entry_store directly.
//
// Precedence per KPI+quarter: a remote record that genuinely exists > local override/entry (this
// browser's own UAT confirmation) > Q3 baseline (q3_baseline.js) > null. Remote wins ONLY while
// this session's own bootstrap fetch just succeeded (mode 'online'); not configured, network/HTTP
// failure, or falling back to the existing REMOTE_CACHE_KEY cache all leave every KPI exactly as
// before this file existed. A KPI absent from KPI_RESULT (e.g. the 2.7.x group) is never invented
// here — it just falls through to local/baseline, same as always.
//
// This file never writes localStorage, never calls fetch itself (reuses the single bootstrap
// call api_client.js already makes), never re-derives scoring/forecast (only ever hands
// getQuarterInput/publishedQuarterReport the same shape of input/report they already accept),
// and normalizes quarter strings (DB 'Q3' -> dashboard 'q3') ONLY in remoteNormalizeQuarter below.

// Single place to fix if MOU69_DB's real column headers ever change. Confirmed against a live
// bootstrap read on 2026-09-12 across all 18 KPI_RESULT rows (not just 2.1.1) -- KPI_VALUES is
// EAV (one row per field_key), unlike RESULT/ISSUES which are wide.
const REMOTE_FIELD_MAP = {
  result: { id: 'kpi_id', quarter: 'quarter', actual: 'actual', score: 'score_final', summary: 'summary_text', status: 'status', version: 'version', isLatest: 'is_latest' },
  values: { id: 'kpi_id', quarter: 'quarter', fieldKey: 'field_key', valueNumber: 'value_number', valueText: 'value_text' },
  issues: { id: 'kpi_id', quarter: 'quarter', obstacle: 'obstacle_text', solution: 'solution_text' },
};

const REMOTE_QUARTER_MAP = { q1: 'q1', q2: 'q2', q3: 'q3', q4: 'q4' };
function remoteNormalizeQuarter(raw) {
  return REMOTE_QUARTER_MAP[String(raw || '').trim().toLowerCase()] || null;
}

let remotePilotState = { mode: 'offline', records: {}, periodControl: null }; // records: { [kpiId]: { [q]: builtRecord } }

// Same rule getQuarterInput() itself uses to decide "score a person confirmed" vs "score computed
// from a real numeric result" -- duplicated here (not imported) because this file must be able to
// build records before deciding which remote field is the scoring input, per KPI.
function remoteIsHumanScored(kpiId) {
  const kpi = MOU_DATA.kpis[kpiId];
  return !!kpi && (['qualitative', 'evidence', 'milestone_manual'].includes(kpi.scoringMethod) || kpi.scoringMethod === 'annual_only');
}

// If KPI_RESULT ever carries more than one row for the same kpi_id+quarter, prefer is_latest,
// then a status === 'confirmed' row, then the highest 'version', then the last row seen.
function remotePickResultRow(rows) {
  const map = REMOTE_FIELD_MAP.result;
  const latest = rows.filter(r => r[map.isLatest] === true || String(r[map.isLatest]).toLowerCase() === 'true');
  const afterLatest = latest.length ? latest : rows;
  const confirmed = afterLatest.filter(r => String(r[map.status] || '').toLowerCase() === 'confirmed');
  const pool = confirmed.length ? confirmed : afterLatest;
  return pool.reduce((best, r) => {
    if (!best) return r;
    const vBest = Number(best[map.version]) || 0;
    const vNow = Number(r[map.version]) || 0;
    return vNow >= vBest ? r : best;
  }, null);
}

// KPI_VALUES is EAV (one row per field_key, e.g. 'revenue'/'expense'/'addback' for 2.1.x) --
// pivot into an object keyed by field_key, preferring value_number and falling back to
// value_text. Generic on purpose: whatever field_keys a given KPI actually has, or none.
function remotePivotValues(rows) {
  const map = REMOTE_FIELD_MAP.values;
  const out = {};
  rows.forEach(r => {
    const key = r[map.fieldKey];
    if (!key) return;
    const num = r[map.valueNumber];
    out[key] = (num !== undefined && num !== '') ? Number(num) : (r[map.valueText] || null);
  });
  return out;
}

function remoteBuildRecords(payload) {
  const map = REMOTE_FIELD_MAP;
  // Group every row (any kpi_id) by kpiId -> quarter -> {result[],values[],issues[]}.
  const byKpiQuarter = {};
  (payload.results || []).forEach(r => {
    const kpiId = r[map.result.id];
    const q = remoteNormalizeQuarter(r[map.result.quarter]);
    if (!kpiId || !q) return;
    const forKpi = byKpiQuarter[kpiId] || (byKpiQuarter[kpiId] = {});
    (forKpi[q] || (forKpi[q] = { result: [], values: [], issues: [] })).result.push(r);
  });
  // Only attach values/issues to a kpi/quarter KPI_RESULT actually reported for -- a KPI_VALUES
  // or KPI_ISSUES row with no matching KPI_RESULT row is not a published quarter yet.
  (payload.values || []).forEach(r => {
    const kpiId = r[map.values.id];
    const q = remoteNormalizeQuarter(r[map.values.quarter]);
    if (kpiId && q && byKpiQuarter[kpiId] && byKpiQuarter[kpiId][q]) byKpiQuarter[kpiId][q].values.push(r);
  });
  (payload.issues || []).forEach(r => {
    const kpiId = r[map.issues.id];
    const q = remoteNormalizeQuarter(r[map.issues.quarter]);
    if (kpiId && q && byKpiQuarter[kpiId] && byKpiQuarter[kpiId][q]) byKpiQuarter[kpiId][q].issues.push(r);
  });

  const records = {};
  Object.keys(byKpiQuarter).forEach(kpiId => {
    // Defensive only: ignore a stray/unknown id in the DB the dashboard doesn't model at all.
    // '1.1' itself IS in MOU_DATA.kpis (a composite grouping id) even though it isn't a leaf --
    // its remote row still carries the narrative 1.1.1/1.1.2 share locally, so it's kept.
    if (!MOU_DATA.kpis[kpiId]) return;
    const humanScored = remoteIsHumanScored(kpiId);
    Object.keys(byKpiQuarter[kpiId]).forEach(q => {
      const bucket = byKpiQuarter[kpiId][q];
      const resultRow = remotePickResultRow(bucket.result);
      if (!resultRow) return;

      const actualRaw = resultRow[map.result.actual];
      const hasActual = actualRaw !== '' && actualRaw !== null && actualRaw !== undefined;
      const scoreVal = Number(resultRow[map.result.score]);

      // quarterlyResult is the one value getQuarterInput() ever needs: a human-confirmed score
      // for human-scored KPIs (mirrors the local ovrSet(...,quarterlyResult) convention), or the
      // real numeric actual for everyone else. Left null (never fabricated) when neither is
      // usable -- e.g. '1.1' itself, whose actual is "" and which isn't human-scored either; it
      // still gets a record below for its shared summary_text, just with no scoring input.
      let quarterlyResult = null;
      if (humanScored) {
        if (Number.isFinite(scoreVal)) quarterlyResult = scoreVal;
      } else if (hasActual) {
        const n = Number(actualRaw);
        if (Number.isFinite(n)) quarterlyResult = n;
      }

      const pivotedValues = remotePivotValues(bucket.values);
      const issueRow = bucket.issues[bucket.issues.length - 1] || {};
      const summaryText = String(resultRow[map.result.summary] || '');
      const obstacleText = String(issueRow[map.issues.obstacle] || '');
      const solutionText = String(issueRow[map.issues.solution] || '');
      const hasReport = !!summaryText || !!obstacleText || !!solutionText || Object.keys(pivotedValues).length > 0;

      if (quarterlyResult === null && !hasReport) return; // nothing real to hydrate for this kpi/quarter

      (records[kpiId] || (records[kpiId] = {}))[q] = {
        // .actual mirrors the local publishedReport convention: the raw "result" for display,
        // which is a free-text description for human/evidence-type KPIs, a number otherwise.
        actual: hasActual ? actualRaw : null,
        quarterlyResult,
        values: pivotedValues,
        summary_text: summaryText,
        issue: { obstacle_text: obstacleText, solution_text: solutionText },
        status: resultRow[map.result.status] || null,
        version: resultRow[map.result.version] || null,
        confirmedAt: payload.fetchedAt || new Date().toISOString(),
        source: 'remote',
      };
    });
  });
  return records;
}

// Called by api_client.js's initRemoteBootstrap() right after ITS OWN successful fetch --
// reuses that single network call rather than fetching bootstrap a second time.
function remotePilotOnBootstrap(payload) {
  try {
    remotePilotState = { mode: 'online', records: remoteBuildRecords(payload), periodControl: payload.periodControl || null };
  } catch (e) {
    remotePilotState = { mode: 'offline', records: {}, periodControl: null }; // fail closed -> pure local/baseline fallback
  }
  // The first render already happened before this async fetch resolved -- refresh the three
  // views that read through getQuarterInput/publishedQuarterReport, same re-render pattern the
  // existing confirm flow already uses (see reportConfirmUi in all_kpis.js).
  if (typeof renderHome === 'function') renderHome();
  if (typeof renderOverview === 'function') renderOverview();
  if (typeof renderDetail === 'function') renderDetail();
}

// ── Hooks consumed by app.js's getQuarterInput()/publishedQuarterReport(), for ANY kpiId ──
function remotePilotGetInput(kpiId, q) {
  if (remotePilotState.mode !== 'online') return undefined;
  const r = remotePilotState.records[kpiId] && remotePilotState.records[kpiId][q];
  return (r && r.quarterlyResult !== null) ? r.quarterlyResult : undefined;
}
function remotePilotGetReport(kpiId, q) {
  if (remotePilotState.mode !== 'online') return null;
  return (remotePilotState.records[kpiId] && remotePilotState.records[kpiId][q]) || null;
}
// Step 5B §15 prepared hook — NOT called by any render/entry code yet (deliberately, to avoid
// regression risk this round). Returns the server's PERIOD_CONTROL map ({Q1:'historical',...})
// when the last successful bootstrap included one, else null (caller must keep using the local
// QUARTER_STATUS fallback, which is already safe — never 'open').
function remoteGetPeriodControl() {
  return remotePilotState.mode === 'online' ? (remotePilotState.periodControl || null) : null;
}
