// entry_store.js — Q3 UAT data layer (MODIFICATION BRIEF v1.2 §H: localStorage now, swappable
// for a backend later without rewriting the UI). Reuses engine.js (interpolateLevel) and
// app.js (getOverrides/saveOverrides) — never re-derives MOU scoring here.
//
// Storage keys:
//   mou69_uat_q3_v1        — this file's own namespace (drafts, submissions, action plans,
//                            annual frameworks, criteria, issues)
//   mou69_v1_overrides     — app.js's existing store; this file only WRITES the final,
//                            confirmed value here once a human has confirmed it (brief §I).

const UAT_KEY = 'mou69_uat_q3_v1';

function uatDefaultStore() {
  return { entries: {}, actionPlans: {}, criteriaHistory: {}, annualFrameworks: {}, investmentRaw: {}, issues: {} };
}
function loadUatStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(UAT_KEY) || 'null');
    if (!raw) return uatDefaultStore();
    return Object.assign(uatDefaultStore(), raw);
  } catch (e) { return uatDefaultStore(); }
}
function saveUatStore(store) {
  try { localStorage.setItem(UAT_KEY, JSON.stringify(store)); } catch (e) {}
}

// ── Overrides bridge (defensive: falls back to a local implementation of the same
//    contract app.js already defines, in case script order ever changes) ──
function ovrGet() {
  if (typeof getOverrides === 'function') return getOverrides();
  try { return JSON.parse(localStorage.getItem('mou69_v1_overrides') || '{}'); } catch (e) { return {}; }
}
function ovrSave(o) {
  if (typeof saveOverrides === 'function') return saveOverrides(o);
  try { localStorage.setItem('mou69_v1_overrides', JSON.stringify(o)); } catch (e) {}
}
function ovrSet(kpiId, q, value) {
  const o = ovrGet();
  if (!o[kpiId]) o[kpiId] = {};
  o[kpiId][q] = value;
  ovrSave(o);
}
function ovrClearQuarter(kpiId, q) {
  const o = ovrGet();
  if (o[kpiId]) { delete o[kpiId][q]; if (Object.keys(o[kpiId]).length === 0) delete o[kpiId]; }
  ovrSave(o);
}

// ═══════════════════════════════════════════════════════════
// ISSUES — ปัญหา/อุปสรรค + แนวทางแก้ไข (brief v1.2 §F), optional, on every monthly entry type.
// Stored separately so it never needs to reshape 2.4's/plan's existing working monthly value —
// keyed by kpi_id → month → {obstacle_text, solution_text}. Never drives an alert (§G).
// ═══════════════════════════════════════════════════════════
function getIssue(kpiId, monthKey) {
  const store = loadUatStore();
  const forKpi = store.issues[kpiId] || {};
  return forKpi[monthKey] || { obstacle_text: '', solution_text: '' };
}
function setIssue(kpiId, monthKey, patch) {
  const store = loadUatStore();
  const forKpi = Object.assign({}, store.issues[kpiId]);
  forKpi[monthKey] = Object.assign({ obstacle_text: '', solution_text: '' }, forKpi[monthKey], patch);
  store.issues[kpiId] = forKpi;
  saveUatStore(store);
  return forKpi[monthKey];
}

// ═══════════════════════════════════════════════════════════
// ENTRY STATE (per-KPI leaf, Q3 only) — status/confirm bookkeeping
// ═══════════════════════════════════════════════════════════
function entryDefaultFor(kpiId) {
  const type = ENTRY_KPI_TYPE[kpiId];
  if (type === 'report') return {type,status:'not_started',draftReport:{values:{},summary_text:'',evidence:'',level:null}};
  if (type === 'numeric') {
    return { type, status: 'not_started', unit: (ENTRY_UNIT_OPTIONS[kpiId] || [{ key: 'default' }])[0].key, monthly: { m7: null, m8: null, m9: null }, confirmedAt: null, confirmedBy: null };
  }
  if (type === 'investment') {
    return { type, status: 'not_started', confirmedAt: null, confirmedBy: null };
  }
  return {
    type: 'plan', status: 'not_started',
    monthly: {
      m7: { progress_text: '', reported_percent: null, obstacle_text: '', solution_text: '', evidence_links: [], submitted_at: null, submission_status: 'draft' },
      m8: { progress_text: '', reported_percent: null, obstacle_text: '', solution_text: '', evidence_links: [], submitted_at: null, submission_status: 'draft' },
      m9: { progress_text: '', reported_percent: null, obstacle_text: '', solution_text: '', evidence_links: [], submitted_at: null, submission_status: 'draft' },
    },
    adminConfirmation: null,
  };
}
function getEntry(kpiId) {
  const store = loadUatStore();
  return store.entries[kpiId] ? Object.assign(entryDefaultFor(kpiId), store.entries[kpiId]) : entryDefaultFor(kpiId);
}
function setEntry(kpiId, patch) {
  const store = loadUatStore();
  store.entries[kpiId] = Object.assign(getEntry(kpiId), patch);
  saveUatStore(store);
  return store.entries[kpiId];
}

// ── Numeric: monthly input, quarter/cumulative aggregation (brief §3/§4/§5 — KPI 2.4 only) ──
function priorCumulative(kpiId) {
  const q2 = MOU_DATA.quarterly[kpiId] && MOU_DATA.quarterly[kpiId].q2;
  if (q2 && q2.actual !== null && q2.actual !== undefined) return q2.actual;
  const q1 = MOU_DATA.quarterly[kpiId] && MOU_DATA.quarterly[kpiId].q1;
  return (q1 && q1.actual !== null && q1.actual !== undefined) ? q1.actual : 0;
}
function setNumericMonth(kpiId, monthKey, rawValue, unitKey) {
  const entry = getEntry(kpiId);
  const units = ENTRY_UNIT_OPTIONS[kpiId];
  const factor = units ? (units.find(u => u.key === unitKey) || units[0]).factor : 1;
  const normalized = (rawValue === null || rawValue === '' || rawValue === undefined) ? null : Number(rawValue) * factor;
  entry.monthly = Object.assign({}, entry.monthly, { [monthKey]: normalized });
  entry.unit = unitKey;
  entry.status = 'draft';
  setEntry(kpiId, entry);
  return entry;
}
function numericFilledMonths(entry) {
  return ENTRY_Q3_MONTHS.map(m => m.key).filter(k => entry.monthly[k] !== null && entry.monthly[k] !== undefined);
}
function computeNumericResult(kpiId) {
  const entry = getEntry(kpiId);
  const filled = numericFilledMonths(entry);
  const allFilled = filled.length === 3;
  const prior = priorCumulative(kpiId);
  let quarterResult = null, cumulative = null;
  if (filled.length > 0) quarterResult = filled.reduce((s, k) => s + entry.monthly[k], 0);
  if (allFilled) cumulative = prior + quarterResult;
  return { method: 'SUM_CUMULATIVE', prior, quarterResult, cumulative: allFilled ? cumulative : null, previewCumulative: cumulative, allFilled, filledCount: filled.length };
}
function validateNumeric(kpiId) {
  const entry = getEntry(kpiId);
  const issues = [];
  const result = computeNumericResult(kpiId);
  ENTRY_Q3_MONTHS.forEach(m => {
    const v = entry.monthly[m.key];
    if (v === null || v === undefined) issues.push(`ยังไม่ได้กรอกผลเดือน ${m.label}`);
    else if (!Number.isFinite(v) || v < 0) issues.push(`ผลเดือน ${m.label} ต้องเป็นตัวเลขที่ไม่ติดลบ`);
  });
  return { ok: issues.length === 0, issues, result };
}
function confirmNumeric(kpiId, confirmedBy) {
  const v = validateNumeric(kpiId);
  if (!v.ok) return { ok: false, issues: v.issues };
  const overrideValue = v.result.cumulative; // linear scoringMethod: raw cumulative value, engine interpolates it
  ovrSet(kpiId, 'q3', overrideValue);
  const entry = getEntry(kpiId);
  const publishedReport = {
    quarterlyResult: overrideValue,
    monthly: Object.assign({}, entry.monthly),
    summary_text: entry.summary_text || '',
    issue: Object.assign({}, getIssue(kpiId, 'q3')),
    confirmedAt: new Date().toISOString(),
  };
  setEntry(kpiId, { status: 'confirmed', confirmedAt: publishedReport.confirmedAt, confirmedBy: confirmedBy || 'ผู้รับผิดชอบ KPI', publishedReport });
  return { ok: true, value: overrideValue };
}

// ═══════════════════════════════════════════════════════════
// KPI 1.1 — INVESTMENT DISBURSEMENT (brief v1.2 §B). Shared raw dataset feeds BOTH 1.1.1 and
// 1.1.2 (verified from Master formulas — see entry_config.js ENTRY_CALC_METHOD comment).
// Chain: RAW (แผน/จริง รายเดือน) → ไตรมาส (SUM) → สะสม → ร้อยละ → เกณฑ์ MOU → คะแนน. Never
// monthly-score-then-sum (brief §B6/§G).
// ═══════════════════════════════════════════════════════════

// ── Annual Framework (brief §B1/§B3) — versioned, board/admin-gated revision ──
function getAnnualFrameworkHistory(kpiId) {
  const store = loadUatStore();
  if (store.annualFrameworks[kpiId] && store.annualFrameworks[kpiId].length) return store.annualFrameworks[kpiId];
  return [{
    version: 1, fiscalYear: ENTRY_ANNUAL_FRAMEWORK_SEED.fiscalYear, amount: ENTRY_ANNUAL_FRAMEWORK_SEED.amount,
    effectiveDate: ENTRY_ANNUAL_FRAMEWORK_SEED.effectiveDate, sourceNote: ENTRY_ANNUAL_FRAMEWORK_SEED.sourceNote,
    status: 'active', createdBy: 'ระบบ (นำเข้าจาก Master Data สำหรับ UAT นี้)', createdAt: null,
    reason: null, referenceDoc: null, evidenceUrl: null,
  }];
}
function getActiveAnnualFramework(kpiId) {
  const hist = getAnnualFrameworkHistory(kpiId);
  return hist.find(v => v.status === 'active') || hist[hist.length - 1];
}
function getPendingAnnualFrameworkRevision(kpiId) {
  const hist = getAnnualFrameworkHistory(kpiId);
  return hist.find(v => v.status === 'pending_admin_confirmation') || null;
}
function requestAnnualFrameworkRevision(kpiId, { newAmount, effectiveDate, reason, referenceDoc, evidenceUrl, createdBy }) {
  const issues = [];
  if (newAmount === null || newAmount === undefined || newAmount === '' || isNaN(Number(newAmount)) || Number(newAmount) <= 0) issues.push('กรุณากรอกกรอบเบิกจ่ายใหม่ (ล้านบาท) ให้ถูกต้อง');
  if (!effectiveDate) issues.push('บังคับกรอกวันที่มีผล');
  if (!reason || !reason.trim()) issues.push('บังคับกรอกเหตุผลในการปรับ');
  if (!evidenceUrl || !evidenceUrl.trim()) issues.push('บังคับแนบเอกสารประกอบ (Google Drive URL)');
  if (getPendingAnnualFrameworkRevision(kpiId)) issues.push('มีคำขอปรับกรอบที่รอยืนยันอยู่แล้ว กรุณารอผู้ดูแลระบบยืนยันก่อน');
  if (issues.length) return { ok: false, issues };
  const store = loadUatStore();
  const hist = store.annualFrameworks[kpiId] || getAnnualFrameworkHistory(kpiId).map(v => Object.assign({}, v));
  hist.push({
    version: hist.length + 1, fiscalYear: hist[hist.length - 1].fiscalYear, amount: Number(newAmount),
    effectiveDate, sourceNote: null, status: 'pending_admin_confirmation',
    createdBy: createdBy || 'ผู้รับผิดชอบ KPI (UAT)', createdAt: new Date().toISOString(),
    reason: reason.trim(), referenceDoc: (referenceDoc || '').trim(), evidenceUrl: evidenceUrl.trim(),
  });
  store.annualFrameworks[kpiId] = hist;
  saveUatStore(store);
  return { ok: true };
}
function confirmAnnualFrameworkRevision(kpiId, version, { confirmedBy }) {
  const store = loadUatStore();
  const hist = store.annualFrameworks[kpiId] || getAnnualFrameworkHistory(kpiId).map(v => Object.assign({}, v));
  const rev = hist.find(v => v.version === version);
  if (!rev || rev.status !== 'pending_admin_confirmation') return { ok: false, issues: ['ไม่พบคำขอปรับกรอบที่รอยืนยัน'] };
  hist.forEach(v => { if (v.status === 'active') v.status = 'superseded'; });
  rev.status = 'active';
  rev.confirmedBy = confirmedBy || 'ผู้ดูแลระบบ (UAT)';
  rev.confirmedAt = new Date().toISOString();
  store.annualFrameworks[kpiId] = hist;
  saveUatStore(store);
  return { ok: true };
}
function rejectAnnualFrameworkRevision(kpiId, version, { note, confirmedBy }) {
  const store = loadUatStore();
  const hist = store.annualFrameworks[kpiId] || getAnnualFrameworkHistory(kpiId).map(v => Object.assign({}, v));
  const rev = hist.find(v => v.version === version);
  if (!rev || rev.status !== 'pending_admin_confirmation') return { ok: false, issues: ['ไม่พบคำขอปรับกรอบที่รอยืนยัน'] };
  rev.status = 'rejected';
  rev.rejectionNote = note || '';
  rev.confirmedBy = confirmedBy || 'ผู้ดูแลระบบ (UAT)';
  rev.confirmedAt = new Date().toISOString();
  store.annualFrameworks[kpiId] = hist;
  saveUatStore(store);
  return { ok: true };
}

// ── Raw monthly disbursement (shared by 1.1.1/1.1.2, brief §B5) ──
function investmentRawDefault() { return { m7: { plan: null, actual: null }, m8: { plan: null, actual: null }, m9: { plan: null, actual: null } }; }
function getInvestmentRaw() {
  const store = loadUatStore();
  return store.investmentRaw[ENTRY_INVESTMENT_KPI] || investmentRawDefault();
}
function setInvestmentMonth(monthKey, field, value) {
  const store = loadUatStore();
  const raw = store.investmentRaw[ENTRY_INVESTMENT_KPI] || investmentRawDefault();
  const normalized = (value === '' || value === null || value === undefined) ? null : Number(value);
  raw[monthKey] = Object.assign({}, raw[monthKey], { [field]: normalized });
  store.investmentRaw[ENTRY_INVESTMENT_KPI] = raw;
  saveUatStore(store);
  setEntry(ENTRY_INVESTMENT_KPI, { status: 'draft' });
  return raw;
}
function investmentFilledMonths(raw) {
  return ENTRY_Q3_MONTHS.map(m => m.key).filter(k => raw[k].plan !== null && raw[k].actual !== null);
}

// Chain: RAW → ไตรมาส (SUM) → สะสม → ร้อยละ (เทียบเกณฑ์ MOU ภายหลังผ่าน engine.js) — verified formula.
function computeInvestmentResult() {
  const raw = getInvestmentRaw();
  const filled = investmentFilledMonths(raw);
  const allFilled = filled.length === 3;
  const q3PlanTotal = filled.length ? filled.reduce((s, k) => s + raw[k].plan, 0) : null;
  const q3ActualTotal = filled.length ? filled.reduce((s, k) => s + raw[k].actual, 0) : null;
  const framework = getActiveAnnualFramework(ENTRY_INVESTMENT_KPI);
  const q1 = ENTRY_INVESTMENT_PRIOR_RAW.q1, q2 = ENTRY_INVESTMENT_PRIOR_RAW.q2;
  const ratioQ1 = q1.actual / q1.plan, ratioQ2 = q2.actual / q2.plan;
  const ratioQ3 = (allFilled && q3PlanTotal) ? q3ActualTotal / q3PlanTotal : null;

  const cumActual = allFilled ? (q1.actual + q2.actual + q3ActualTotal) : null;
  const cumPlan = allFilled ? (q1.plan + q2.plan + q3PlanTotal) : null;
  const pct111 = (cumActual !== null && framework.amount) ? (cumActual / framework.amount * 100) : null;
  const pct112 = (ratioQ3 !== null) ? ((ratioQ1 + ratioQ2 + ratioQ3) / 4 * 100) : null;

  return {
    allFilled, filledCount: filled.length, q3PlanTotal, q3ActualTotal, framework,
    cumActual, cumPlan, q1, q2, ratioQ1, ratioQ2, ratioQ3, pct111, pct112,
  };
}
function validateInvestment() {
  const raw = getInvestmentRaw();
  const issues = [];
  ENTRY_Q3_MONTHS.forEach(m => {
    const row = raw[m.key];
    if (row.plan === null || row.plan === undefined) issues.push(`ยังไม่ได้กรอกแผนเบิกจ่ายเดือน ${m.label}`);
    else if (!Number.isFinite(row.plan) || row.plan < 0) issues.push(`แผนเบิกจ่ายเดือน ${m.label} ต้องไม่ติดลบ`);
    if (row.actual === null || row.actual === undefined) issues.push(`ยังไม่ได้กรอกเบิกจ่ายจริงเดือน ${m.label}`);
    else if (!Number.isFinite(row.actual) || row.actual < 0) issues.push(`เบิกจ่ายจริงเดือน ${m.label} ต้องไม่ติดลบ`);
  });
  const result = computeInvestmentResult();
  if (result.allFilled && result.q3PlanTotal === 0) issues.push('แผนเบิกจ่ายรวม Q3 เป็น 0 — ไม่สามารถคำนวณ 1.1.2 ได้ กรุณาตรวจสอบ');
  return { ok: issues.length === 0, issues, result };
}
function confirmInvestment(confirmedBy) {
  const v = validateInvestment();
  if (!v.ok) return { ok: false, issues: v.issues };
  ovrSet('1.1.1', 'q3', v.result.pct111);
  ovrSet('1.1.2', 'q3', v.result.pct112);
  const issue=Object.assign({},getIssue('1.1','q3'));
  const publishedReport={summary_text:`เบิกจ่ายจริงสะสม ${v.result.cumActual.toFixed(3)} ล้านบาท`,issue,values:JSON.parse(JSON.stringify(getInvestmentRaw())),confirmedAt:new Date().toISOString()};
  setEntry(ENTRY_INVESTMENT_KPI, { status: 'confirmed', confirmedAt: publishedReport.confirmedAt, confirmedBy: confirmedBy || 'ผู้รับผิดชอบ KPI',publishedReport });
  return { ok: true, pct111: v.result.pct111, pct112: v.result.pct112 };
}

// ═══════════════════════════════════════════════════════════
// PLAN: monthly progress + obstacle/solution + evidence + submission (brief §C5/§C6)
// ═══════════════════════════════════════════════════════════
function setPlanMonthDraft(kpiId, monthKey, patch) {
  const entry = getEntry(kpiId);
  entry.monthly[monthKey] = Object.assign({}, entry.monthly[monthKey], patch);
  entry.status = 'draft';
  setEntry(kpiId, entry);
  return entry;
}
function addEvidenceLink(kpiId, monthKey, { title, url, documentType }) {
  const entry = getEntry(kpiId);
  const links = entry.monthly[monthKey].evidence_links.slice();
  links.push({
    id: 'ev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), title, url, document_type: documentType,
    document_date: null, description: '', linked_kpi: kpiId, linked_quarter: 'q3', linked_month: monthKey, uploaded_by: 'ผู้รับผิดชอบ KPI (UAT)',
  });
  entry.monthly[monthKey] = Object.assign({}, entry.monthly[monthKey], { evidence_links: links });
  setEntry(kpiId, entry);
  return entry;
}
function removeEvidenceLink(kpiId, monthKey, evId) {
  const entry = getEntry(kpiId);
  entry.monthly[monthKey] = Object.assign({}, entry.monthly[monthKey], { evidence_links: entry.monthly[monthKey].evidence_links.filter(e => e.id !== evId) });
  setEntry(kpiId, entry);
  return entry;
}
function validatePlanMonth(kpiId, monthKey) {
  const m = getEntry(kpiId).monthly[monthKey];
  const issues = [];
  if (!m.progress_text || !m.progress_text.trim()) issues.push('กรุณากรอกความคืบหน้ารายเดือน (Narrative)');
  if (m.reported_percent === null || m.reported_percent === undefined || m.reported_percent === '') issues.push('กรุณากรอกผลการดำเนินงานที่หน่วยงานรายงาน (%)');
  else if (m.reported_percent < 0 || m.reported_percent > 100) issues.push('ผลการดำเนินงาน (%) ต้องอยู่ระหว่าง 0-100');
  return { ok: issues.length === 0, issues };
}
function submitPlanMonth(kpiId, monthKey) {
  const v = validatePlanMonth(kpiId, monthKey);
  if (!v.ok) return { ok: false, issues: v.issues };
  const entry = getEntry(kpiId);
  entry.monthly[monthKey] = Object.assign({}, entry.monthly[monthKey], { submitted_at: new Date().toISOString(), submission_status: 'pending_confirmation' });
  entry.status = 'submitted';
  setEntry(kpiId, entry);
  return { ok: true };
}
function sendBackPlanMonth(kpiId, monthKey, note) {
  const entry = getEntry(kpiId);
  const m = entry.monthly[monthKey];
  if (!m || m.submission_status !== 'pending_confirmation') return { ok: false, issues: ['รายการนี้ไม่ได้อยู่ในสถานะรอยืนยัน'] };
  entry.monthly[monthKey] = Object.assign({}, m, { submission_status: 'draft', sendBackNote: note || '' });
  entry.status = 'draft';
  setEntry(kpiId, entry);
  return { ok: true };
}

// ── System Assist — deterministic phrase matching against the PROJECT'S OWN baseline Action
// Plan steps (brief §C7: "milestone/activity detected from text... suggested matching Action
// Plan step"), never a generic keyword list. Priority: rejected > not_started > preparing >
// in_progress > completed (brief §7: "ห้ามพบคำว่า 'คณะกรรมการ' แล้วถือว่า Milestone Complete ทันที").
function entryCleanActivityText(text) {
  return text.replace(/\(?ร้อยละ\s*\d+(\.\d+)?\)?/g, '').replace(/\d+(\.\d+)?\s*%/g, '').trim();
}
function entryActivityAnchors(cleanText) {
  const anchors = [cleanText];
  const latin = cleanText.match(/[A-Za-z]{2,}/g);
  if (latin) anchors.push(...latin);
  cleanText.split(/\s+/).filter(w => w.length >= 4).forEach(w => anchors.push(w));
  return [...new Set(anchors.filter(Boolean))].sort((a, b) => b.length - a.length);
}
function suggestFromNarrativeForProject(kpiId, text) {
  if (!text || !text.trim()) return [];
  const plan = getActionPlan(kpiId);
  const activities = plan.revised || plan.baseline || [];
  const hits = [];
  activities.forEach(act => {
    const clean = entryCleanActivityText(act.activity_name);
    if (!clean) return;
    const anchors = entryActivityAnchors(clean);
    for (const anchor of anchors) {
      const idx = text.indexOf(anchor);
      if (idx === -1) continue;
      const windowText = text.slice(Math.max(0, idx - 20), idx + anchor.length + 20);
      for (const rule of ENTRY_PHRASE_RULES) {
        if (rule.re.test(windowText)) {
          hits.push({
            activityId: act.activity_id, activityLabel: act.activity_name, expectedPercent: act.expected_progress_percent,
            keyword: anchor, status: rule.status, statusLabel: rule.label, snippet: windowText.trim(),
            suggestedPercent: ENTRY_STATUS_SUGGEST_PCT[rule.status] !== undefined && ENTRY_STATUS_SUGGEST_PCT[rule.status] !== null ? ENTRY_STATUS_SUGGEST_PCT[rule.status] : null,
          });
          break;
        }
      }
      break; // one hit per activity — first (most specific) matching anchor wins
    }
  });
  return hits;
}
// Which baseline step SHOULD apply given the reported %, per the project's own ladder (brief §C5
// "Current expected activity/milestone"). Independent signal from text matching — always available
// once reported_percent is entered, even for near-identical-text ladders like 2.7.1/2.7.2/2.7.4.
function currentStepFromPercent(kpiId, percent) {
  const plan = getActionPlan(kpiId);
  const activities = plan.revised || plan.baseline || [];
  if (!activities.length || percent === null || percent === undefined) return null;
  const sorted = [...activities].sort((a, b) => (a.expected_progress_percent || 0) - (b.expected_progress_percent || 0));
  let current = null;
  for (const act of sorted) {
    if (act.expected_progress_percent !== null && act.expected_progress_percent <= percent) current = act;
  }
  return current || sorted[0];
}
function suggestForPlanKpi(kpiId, text, reportedPercent) {
  const hits = suggestFromNarrativeForProject(kpiId, text);
  const withPct = hits.filter(h => h.suggestedPercent !== null);
  const suggestedPercent = withPct.length ? Math.round(withPct.reduce((s, h) => s + h.suggestedPercent, 0) / withPct.length) : null;
  const kpi = MOU_DATA.kpis[kpiId];
  let suggestedLevel = null;
  if (kpi.scoringMethod === 'milestone_pct' && suggestedPercent !== null && typeof interpolateLevel === 'function') {
    suggestedLevel = interpolateLevel(suggestedPercent / 100, kpi.thresholds, kpi.higherIsBetter);
  }
  const expectedStep = (reportedPercent !== null && reportedPercent !== undefined && reportedPercent !== '') ? currentStepFromPercent(kpiId, Number(reportedPercent)) : null;
  return { hits, suggestedPercent, suggestedLevel, manualLevelRequired: kpi.scoringMethod === 'milestone_manual', expectedStep };
}

// ═══════════════════════════════════════════════════════════
// ADMIN CONFIRMATION (brief §C7) — plan type only, human-in-the-loop always
// ═══════════════════════════════════════════════════════════
function listPendingConfirmations() {
  const store = loadUatStore();
  const out = [];
  Object.keys(store.entries).forEach(kpiId => {
    if (ENTRY_KPI_TYPE[kpiId] !== 'plan') return;
    const entry = store.entries[kpiId];
    ENTRY_Q3_MONTHS.forEach(m => {
      const mm = entry.monthly && entry.monthly[m.key];
      if (mm && mm.submission_status === 'pending_confirmation') out.push({ kpiId, monthKey: m.key, monthLabel: m.label, month: mm });
    });
  });
  return out;
}
function listPendingFrameworkRevisions() {
  const store = loadUatStore();
  const out = [];
  Object.keys(store.annualFrameworks).forEach(kpiId => {
    (store.annualFrameworks[kpiId] || []).forEach(v => { if (v.status === 'pending_admin_confirmation') out.push(Object.assign({ kpiId }, v)); });
  });
  return out;
}
function confirmPlanMonth(kpiId, monthKey, { confirmedPercent, confirmationNote, confirmedLevel, confirmedBy }) {
  const kpi = MOU_DATA.kpis[kpiId];
  const entry = getEntry(kpiId);
  const m = entry.monthly[monthKey];
  if (!m || m.submission_status !== 'pending_confirmation') return { ok: false, issues: ['รายการนี้ไม่ได้อยู่ในสถานะรอยืนยัน'] };
  if (confirmedPercent === null || confirmedPercent === undefined || confirmedPercent === '') return { ok: false, issues: ['กรุณายืนยันค่า % (confirmed_percent)'] };
  if (!Number.isFinite(Number(confirmedPercent)) || Number(confirmedPercent)<0 || Number(confirmedPercent)>100) return {ok:false,issues:['เปอร์เซ็นต์ต้องอยู่ระหว่าง 0–100']};
  const needsLevel = kpi.scoringMethod === 'milestone_manual';
  if (needsLevel && confirmedLevel!==null && confirmedLevel!=='' && (!Number.isFinite(Number(confirmedLevel)) || Number(confirmedLevel)<1 || Number(confirmedLevel)>5)) return {ok:false,issues:['คะแนนต้องอยู่ระหว่าง 1–5']};
  if (needsLevel && (confirmedLevel === null || confirmedLevel === undefined || confirmedLevel === '')) {
    return { ok: false, issues: ['ตัวชี้วัดนี้ใช้มาตราวัดพิเศษ (ไม่ใช่เกณฑ์ 5 ระดับปกติ) — ผู้ดูแลระบบต้องเลือกระดับ (Level) เอง'] };
  }
  m.submission_status = 'confirmed';
  entry.monthly[monthKey] = m;
  entry.adminConfirmation = Object.assign({}, entry.adminConfirmation, {
    [monthKey]: {
      reported_percent: m.reported_percent,
      confirmed_percent: Number(confirmedPercent),
      confirmation_note: confirmationNote || '',
      confirmed_level: needsLevel ? Number(confirmedLevel) : null,
      confirmed_by: confirmedBy || 'ผู้ดูแลระบบ',
      confirmed_at: new Date().toISOString(),
    },
  });
  const allConfirmed = ENTRY_Q3_MONTHS.every(mm => entry.monthly[mm.key].submission_status === 'confirmed');
  entry.status = allConfirmed ? 'confirmed' : 'submitted';
  setEntry(kpiId, entry);

  // Only NOW does Q3 Actual reach the score engine (brief §C6/§I).
  // Select latest reporting month, not the order in which approvals are clicked.
  const previousMonths=entry.confirmedMonths || Object.fromEntries(ENTRY_Q3_MONTHS.filter(mm=>entry.monthly[mm.key]?.submission_status==='confirmed' && entry.adminConfirmation?.[mm.key]).map(mm=>[mm.key,JSON.parse(JSON.stringify({report:entry.monthly[mm.key],confirmation:entry.adminConfirmation[mm.key]}))]));
  entry.confirmedMonths=Object.assign({},previousMonths,{[monthKey]:JSON.parse(JSON.stringify({report:m,confirmation:entry.adminConfirmation[monthKey]}))});
  const keys=ENTRY_Q3_MONTHS.map(x=>x.key).filter(key=>entry.confirmedMonths[key]);
  const latest=entry.confirmedMonths[keys[keys.length-1]];
  const overrideValue=needsLevel?latest.confirmation.confirmed_level:latest.confirmation.confirmed_percent/100;
  entry.publishedReport={quarterlyResult:overrideValue,actual:latest.confirmation.confirmed_percent/100,
    summary_text:keys.map(key=>ENTRY_Q3_MONTHS.find(x=>x.key===key).label+' · '+entry.confirmedMonths[key].report.progress_text).join('\n'),
    issue:{obstacle_text:keys.map(key=>entry.confirmedMonths[key].report.obstacle_text).filter(Boolean).join('\n'),solution_text:keys.map(key=>entry.confirmedMonths[key].report.solution_text).filter(Boolean).join('\n')},
    evidence_links:keys.flatMap(key=>entry.confirmedMonths[key].report.evidence_links||[]),latestMonth:keys[keys.length-1],confirmedAt:new Date().toISOString()};
  setEntry(kpiId,entry);
  ovrSet(kpiId, 'q3', overrideValue);
  return { ok: true, value: overrideValue };
}

// ═══════════════════════════════════════════════════════════
// ACTION PLAN — annual, established before monthly reporting (brief §C1/§C2/§C3). Baseline
// auto-seeded from the REAL Master Action Plan (entry_config.js ENTRY_ACTION_PLAN_MASTER) —
// never invented. Baseline is immutable once created; revisions layered on top (§C4).
// ═══════════════════════════════════════════════════════════
function actionPlanDefault(kpiId) {
  const masterActivities = ENTRY_ACTION_PLAN_MASTER[kpiId];
  if (masterActivities && masterActivities.length) {
    return {
      baseline: masterActivities.map((text, i) => ({
        activity_id: kpiId + '_a' + (i + 1), activity_name: text, description: '',
        start_month: null, end_month: null, expected_progress_percent: entryParseActivityPercent(text),
        sequence: i + 1, note: null,
      })),
      baselineSource: 'master', baselineCreatedAt: null,
      revised: null, revisionReason: null, revisedAt: null, revisedBy: null, revisionEvidenceUrl: null, revisionHistory: [],
    };
  }
  return { baseline: null, baselineSource: null, baselineCreatedAt: null, revised: null, revisionReason: null, revisedAt: null, revisedBy: null, revisionEvidenceUrl: null, revisionHistory: [] };
}
function getActionPlan(kpiId) {
  const store = loadUatStore();
  return store.actionPlans[kpiId] || actionPlanDefault(kpiId);
}
// First-time creation only (no baseline yet) — e.g. a project not in Master, or a manual add.
function createBaselineActionPlan(kpiId, activities) {
  const store = loadUatStore();
  const existing = store.actionPlans[kpiId] || actionPlanDefault(kpiId);
  if (existing.baseline) return { ok: false, issues: ['มี Baseline Plan อยู่แล้ว ห้ามเขียนทับ — ใช้ขอปรับแผนแทน'] };
  existing.baseline = activities;
  existing.baselineSource = 'manual';
  existing.baselineCreatedAt = new Date().toISOString();
  store.actionPlans[kpiId] = existing;
  saveUatStore(store);
  return { ok: true };
}
// Revision — baseline never overwritten (brief §C4). Requires a reason; evidence optional but recommended.
function requestActionPlanRevision(kpiId, activities, { reason, evidenceUrl, revisedBy }) {
  const issues = [];
  if (!reason || !reason.trim()) issues.push('บังคับกรอกเหตุผลในการปรับแผน');
  if (!Array.isArray(activities) || !activities.length) issues.push('กรุณากรอกกิจกรรมอย่างน้อย 1 รายการ');
  if (issues.length) return { ok: false, issues };
  const store = loadUatStore();
  const existing = store.actionPlans[kpiId] || actionPlanDefault(kpiId);
  if (!existing.baseline) return { ok: false, issues: ['ยังไม่มี Baseline Plan สำหรับตัวชี้วัดนี้'] };
  if (existing.revised) {
    existing.revisionHistory = existing.revisionHistory || [];
    existing.revisionHistory.push({ plan: existing.revised, reason: existing.revisionReason, revisedAt: existing.revisedAt, revisedBy: existing.revisedBy, evidenceUrl: existing.revisionEvidenceUrl });
  }
  existing.revised = activities;
  existing.revisionReason = reason.trim();
  existing.revisedAt = new Date().toISOString();
  existing.revisedBy = revisedBy || 'ผู้รับผิดชอบ KPI (UAT)';
  existing.revisionEvidenceUrl = (evidenceUrl || '').trim();
  store.actionPlans[kpiId] = existing;
  saveUatStore(store);
  return { ok: true };
}

// ── Monthly Action Plan view (brief "ACTION PLAN MONTHLY VIEW") ──
// Master's Action_Plan sheet gives an ORDERED % ladder per project with no month assignment
// (confirmed absent — see entryActionPlanBlockHtml's "ไม่ระบุช่วงเวลาในข้อมูลต้นทาง" note).
// Q1/Q2/Q4 therefore carry no plan data here (never invented). For Q3 — the only quarter this
// UAT actually reports against — the ladder's first 3 steps (baseline, or revised if present)
// are sequenced onto เม.ย./พ.ค./มิ.ย. in order, exactly as this modification's own brief examples
// (60%→70%→80%) do. That sequencing is a display decision for the live reporting quarter, not a
// Master-sourced fact — the "จัดเรียงจากลำดับกิจกรรม" note on each month card says so.
function buildActionPlanMonthly(activities, tag) {
  const q3Keys = ENTRY_Q3_MONTHS.map(m => m.key); // ['m7','m8','m9']
  const monthly = {};
  ENTRY_FISCAL_MONTHS.forEach(m => {
    monthly[m.key] = {
      month: m.key, label: m.label, quarter: m.quarter,
      planned_activity: null, planned_percent: null, planned_milestone: null,
      baseline_or_revised: null, note: null,
    };
  });
  (activities || []).slice(0, 3).forEach((act, i) => {
    const mk = q3Keys[i];
    if (!mk) return;
    monthly[mk] = Object.assign(monthly[mk], {
      planned_activity: act.activity_name,
      planned_percent: act.expected_progress_percent,
      planned_milestone: act.activity_name,
      baseline_or_revised: tag,
      note: (i === 2 && activities.length > 3) ? `มีอีก ${activities.length - 3} กิจกรรมถัดไปในแผน (ดูแผนเต็มด้านล่าง)` : 'จัดเรียงจากลำดับกิจกรรมในแผน — ไม่ใช่วันที่จาก Master Data',
    });
  });
  return monthly;
}
// Effective view: revised plan if one exists, else baseline (used by the Entry form/Timeline).
function getActionPlanMonthly(kpiId) {
  const plan = getActionPlan(kpiId);
  const usingRevised = !!plan.revised;
  return buildActionPlanMonthly(plan.revised || plan.baseline || [], usingRevised ? 'revised' : 'baseline');
}
// Baseline-only view, even when a revised plan exists — used by the Alert Engine (brief §10:
// a revised plan must never silently erase a baseline delay from the analysis).
function getActionPlanMonthlyBaseline(kpiId) {
  const plan = getActionPlan(kpiId);
  return plan.baseline ? buildActionPlanMonthly(plan.baseline, 'baseline') : null;
}

// ═══════════════════════════════════════════════════════════
// CRITERIA GOVERNANCE (brief §D/§E) — sourced PER KPI ID from the approved MOU Master
// (MOU_DATA.kpis[kpiId].thresholds), never a shared/generic array. Versioned, board-approval
// gated, never overwritten.
// ═══════════════════════════════════════════════════════════
function getCriteriaHistory(kpiId) {
  const store = loadUatStore();
  if (store.criteriaHistory[kpiId] && store.criteriaHistory[kpiId].length) return store.criteriaHistory[kpiId];
  const kpi = MOU_DATA.kpis[kpiId];
  return [{ version: 1, thresholds: kpi.thresholds, boardApprovalDate: null, note: 'เกณฑ์ตั้งต้นจาก Master Data (MOU69_Claude.xlsx) — เฉพาะตัวชี้วัดนี้ ไม่ใช่ค่ากลาง', evidenceUrl: null, isActive: true, createdAt: null }];
}
// §D: flag — never silently pick — if a KPI's own thresholds look internally inconsistent
// (not monotonic in the KPI's own higherIsBetter direction, or contain nulls on a KPI that
// should be numeric-scored). This never blocks scoring (engine.js is unaffected); it only
// surfaces a review note in the Entry/Detail UI.
function criteriaConflictNote(kpiId) {
  const kpi = MOU_DATA.kpis[kpiId];
  if (!kpi || !Array.isArray(kpi.thresholds)) return null;
  const t = kpi.thresholds;
  if (t.some(v => v === null || v === undefined)) return null; // composite/qualitative KPI — expected, not a conflict
  if (t.some(v => typeof v !== 'number')) return null; // qualitative text ladder — not a numeric conflict
  const dir = kpi.higherIsBetter !== false ? 1 : -1;
  for (let i = 0; i < t.length - 1; i++) {
    if ((t[i + 1] - t[i]) * dir < 0) return 'พบข้อมูลค่าเกณฑ์ไม่สอดคล้อง — กรุณาตรวจสอบ (เกณฑ์ไม่เรียงลำดับตาม higherIsBetter ของตัวชี้วัดนี้)';
  }
  return null;
}
function getActiveCriteria(kpiId) {
  const hist = getCriteriaHistory(kpiId);
  return hist.find(v => v.isActive) || hist[hist.length - 1];
}
function getEffectiveKpi(kpiId) {
  const kpi = MOU_DATA.kpis[kpiId];
  if (!kpi) return kpi;
  const active = getActiveCriteria(kpiId);
  if (!active || active.version === 1) return kpi;
  return Object.assign({}, kpi, { thresholds: active.thresholds, criteriaRevisionNote: active.note, criteriaBoardApprovalDate: active.boardApprovalDate });
}
function addCriteriaRevision(kpiId, { newThresholds, boardApprovalDate, note, evidenceUrl }) {
  const issues = [];
  if (!Array.isArray(newThresholds) || newThresholds.length !== 5 || newThresholds.some(v => v === null || v === '' || isNaN(Number(v)))) issues.push('กรุณากรอกเกณฑ์ Level 1-5 ให้ครบและเป็นตัวเลข');
  if (!boardApprovalDate) issues.push('บังคับกรอกวันที่คณะกรรมการ กทท. เห็นชอบ');
  if (!note || !note.trim()) issues.push('บังคับกรอกหมายเหตุ');
  if (!evidenceUrl || !evidenceUrl.trim()) issues.push('บังคับกรอกเอกสารอ้างอิง (Google Drive URL)');
  if (issues.length) return { ok: false, issues };
  const store = loadUatStore();
  const hist = store.criteriaHistory[kpiId] || getCriteriaHistory(kpiId).map(v => Object.assign({}, v));
  hist.forEach(v => v.isActive = false);
  hist.push({
    version: hist.length + 1, thresholds: newThresholds.map(Number), boardApprovalDate, note: note.trim(),
    evidenceUrl: evidenceUrl.trim(), isActive: true, createdAt: new Date().toISOString(), previousThresholds: getActiveCriteria(kpiId).thresholds,
  });
  store.criteriaHistory[kpiId] = hist;
  saveUatStore(store);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════
// MANAGEMENT STATUS — separate from Score (brief §G). Deterministic pace triggers only.
// ═══════════════════════════════════════════════════════════
function computeManagementStatus(kpiId, q) {
  if (q !== 'q3') return null;
  const type = ENTRY_KPI_TYPE[kpiId];
  if (!type || type === 'report') return null;
  if (type === 'plan') {
    const entry = getEntry(kpiId);
    if (entry.status === 'not_started') return null;
    const months = ENTRY_Q3_MONTHS.map(m => entry.monthly[m.key]);
    const anyPending = months.some(m => m.submission_status === 'pending_confirmation');
    const anyMissingEvidence = months.some(m => m.submission_status !== 'draft' && (!m.evidence_links || m.evidence_links.length === 0));
    if (anyPending) return anyMissingEvidence ? ENTRY_MGMT_STATUS.pending_evidence : ENTRY_MGMT_STATUS.pending_confirmation;
    if (entry.status === 'confirmed') return ENTRY_MGMT_STATUS.on_track;
    return null;
  }
  if (type === 'investment') {
    const entry = getEntry(kpiId);
    if (entry.status !== 'confirmed') return null;
    const result = computeInvestmentResult();
    if (result.pct111 === null) return null;
    const framework = result.framework.amount;
    const expectedPace = framework * (9 / 12);
    const ratio = expectedPace > 0 ? result.cumActual / expectedPace : 1;
    if (ratio >= 0.9) return ENTRY_MGMT_STATUS.on_track;
    if (ratio >= 0.6) return ENTRY_MGMT_STATUS.watch;
    return ENTRY_MGMT_STATUS.risk;
  }
  // numeric (2.4) — pace check against a straight-line 9/12-of-year expectation (brief §13/§G triggers)
  const entry = getEntry(kpiId);
  if (entry.status !== 'confirmed') return null;
  const kpi = MOU_DATA.kpis[kpiId];
  if (!kpi.target || typeof kpi.target !== 'number') return null;
  const result = computeNumericResult(kpiId);
  if (result.cumulative === null) return null;
  const expectedPace = kpi.target * (9 / 12);
  const ratio = expectedPace > 0 ? result.cumulative / expectedPace : 1;
  if (ratio >= 0.9) return ENTRY_MGMT_STATUS.on_track;
  if (ratio >= 0.6) return ENTRY_MGMT_STATUS.watch;
  return ENTRY_MGMT_STATUS.risk;
}

// ═══════════════════════════════════════════════════════════
// PILOT-LEVEL AGGREGATE STATUS (left rail ○/◐/✓/! and the 0/3..3/3 counter)
// ═══════════════════════════════════════════════════════════
function pilotChildIds(kpiId) {
  if (kpiId === '1.1') return ['1.1']; // shared raw dataset — one entry, not per-child
  if (kpiId === '2.7') return ['2.7.1', '2.7.2', '2.7.3.1', '2.7.3.2', '2.7.4'];
  if (!MOU_DATA.kpis[kpiId]?.isLeaf) return reportLeaves(kpiId).map(k=>k.id);
  return [kpiId];
}
function leafStatusIcon(kpiId) {
  if (kpiId === '1.1') {
    const entry = getEntry('1.1');
    if (entry.status === 'confirmed') return 'confirmed';
    const raw = getInvestmentRaw();
    const anyFilled = ENTRY_Q3_MONTHS.some(m => raw[m.key].plan !== null || raw[m.key].actual !== null);
    if (!anyFilled) return 'not_started';
    const v = validateInvestment();
    return v.ok ? 'pending' : 'needs_review';
  }
  const type = ENTRY_KPI_TYPE[kpiId];
  const entry = getEntry(kpiId);
  if(type==='report') return entry.status==='confirmed'?'confirmed':entry.status==='not_started'?'not_started':reportCalculate(kpiId).ok?'pending':'needs_review';
  if (type === 'numeric') {
    if (entry.status === 'confirmed') return 'confirmed';
    const v = validateNumeric(kpiId);
    if (numericFilledMonths(entry).length === 0) return 'not_started';
    return v.ok ? 'pending' : 'needs_review';
  }
  const months = ENTRY_Q3_MONTHS.map(m => entry.monthly[m.key]);
  if (months.every(m => m.submission_status === 'confirmed')) return 'confirmed';
  if (months.some(m => m.submission_status === 'pending_confirmation' || m.submission_status === 'confirmed')) return 'pending';
  if (months.some(m => m.progress_text || m.reported_percent !== null)) return 'pending';
  return 'not_started';
}
function pilotStatusIcon(kpiId) {
  const kids = pilotChildIds(kpiId);
  const statuses = kids.map(leafStatusIcon);
  if (statuses.every(s => s === 'confirmed')) return 'confirmed';
  if (statuses.some(s => s === 'needs_review')) return 'needs_review';
  if (statuses.every(s => s === 'not_started')) return 'not_started';
  return 'pending';
}
function pilotProgressCount() {
  return ENTRY_PILOT_IDS.filter(id => pilotStatusIcon(id) === 'confirmed').length;
}

// ═══════════════════════════════════════════════════════════
// RESET UAT Q3 DATA (brief §I/§J) — never touches q1/q2, never touches Criteria History
// (governance decisions are not "test data") or confirmed Annual Framework revisions'
// audit trail beyond the versions created during this UAT session.
// ═══════════════════════════════════════════════════════════
function resetQ3UatData() {
  const store = loadUatStore();
  store.entries = {};
  store.investmentRaw = {};
  store.issues = {};
  Object.keys(store.actionPlans).forEach(k => {
    const ap = store.actionPlans[k];
    ap.revised = null; ap.revisionReason = null; ap.revisedAt = null; ap.revisedBy = null; ap.revisionEvidenceUrl = null; ap.revisionHistory = [];
  });
  Object.keys(store.annualFrameworks).forEach(k => {
    store.annualFrameworks[k] = (store.annualFrameworks[k] || []).filter(v => v.version === 1);
    if (store.annualFrameworks[k].length) store.annualFrameworks[k][0].status = 'active';
  });
  saveUatStore(store);
  Object.keys(MOU_DATA.kpis).forEach(id => ovrClearQuarter(id, 'q3'));
}
