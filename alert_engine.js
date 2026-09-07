// alert_engine.js — Alerts Prototype V1 analysis (MODIFICATION BRIEF "ALERTS PROTOTYPE V1").
// Pure analysis functions only — alerts.js is render-only, same separation app.js/entry.js
// already keep from engine.js. Reads MOU_DATA / engine.js / entry_store.js / app.js's scoreAt.
// Never re-derives MOU Score here — Score stays engine.js's job; this file only classifies
// MANAGEMENT RISK, which is explicitly a separate concept (brief §G / this brief's whole point).

const ALERT_PLAN_METHODS = ['milestone_pct', 'milestone_manual'];

function alertIsPlanKpi(kpi) { return ALERT_PLAN_METHODS.includes(kpi.scoringMethod); }

// ── Supporting owner + contact (brief §13) — SUPPORTING only, never main/watch owners ──
function alertSupportContacts(kpi) {
  const roles = kpi.ownerSupport || [];
  return roles.map(role => {
    const c = ALERT_CONTACT_MASTER[role];
    return {
      role,
      name: (c && c.name) || null,
      position: (c && c.position) || role, // role code itself is the only "position" Master gives
      phone: (c && c.phone) || null,
      email: (c && c.email) || null,
    };
  });
}

// ── Deduction condition (brief §11) — surfaced separately, never blended into trend severity math ──
function alertDeductionFor(kpiId) {
  return MOU_DATA.deductions.find(d => d.kpi === kpiId || kpiId.startsWith(d.kpi)) || null;
}

// ── Obstacle / Solution (brief §12) — context only, never a severity trigger by itself ──
function alertObstacleSolution(kpiId, kpi) {
  const record=publishedQuarterReport(kpiId,'q3');
  return {obstacle:record?.issue?.obstacle_text||null,solution:record?.issue?.solution_text||null};
}

// ── NUMERIC analysis (brief §6/§7/§8) ──
function alertAnalyzeNumeric(kpiId, kpi) {
  const s = scoreAt(kpiId, 'q3');
  if (s.rawValue === null || s.rawValue === undefined) return null; // no confirmed Q3 — never fabricate
  const actual = s.rawValue;
  if (typeof actual !== 'number' || !Number.isFinite(actual)) return null;
  const target = typeof kpi.target === 'number' ? kpi.target : null;
  const fc = MOU_DATA.forecast[kpiId];
  const forecastResult = (fc && typeof fc.result === 'number') ? fc.result : null;
  const higherIsBetter = kpi.higherIsBetter !== false;
  const behavior = alertKpiBehavior(kpi);
  const cfg = ALERT_CONFIG.numeric;

  const reasons = [];
  let severity = null;
  let confidence = 'LOW';

  let gapToTarget = null, forecastGap = null, forecastGapRatio = null, q4Required = null;
  if (target !== null) {
    gapToTarget = higherIsBetter ? (target - actual) : (actual - target);
    // For YEAR_END/LUMP_SUM KPIs the Q4 figure IS the annual result, not an incremental add-on —
    // "Q4 required" as a delta doesn't mean the same thing, so leave it unset rather than mislead.
    q4Required = behavior === 'YEAR_END' ? null : gapToTarget;
  }
  if (target !== null && forecastResult !== null) {
    forecastGap = higherIsBetter ? (target - forecastResult) : (forecastResult - target);
    forecastGapRatio = target !== 0 ? forecastGap / Math.abs(target) : null;
    confidence = 'MEDIUM';
  }

  if (forecastGapRatio !== null && forecastGapRatio > 0) {
    if (forecastGapRatio >= cfg.forecastGapRatioRed) {
      severity = 'red';
      reasons.push({ code: 'FORECAST_MATERIALLY_BELOW_TARGET', label: ALERT_REASON_LABELS.FORECAST_MATERIALLY_BELOW_TARGET, detail: `คาดการณ์ ${ovpFmt(forecastResult)} เทียบเป้าหมาย ${ovpFmt(target)}` });
    } else if (forecastGapRatio >= cfg.forecastGapRatioOrange) {
      severity = 'orange';
      reasons.push({ code: 'FORECAST_BELOW_TARGET', label: ALERT_REASON_LABELS.FORECAST_BELOW_TARGET, detail: `คาดการณ์ ${ovpFmt(forecastResult)} เทียบเป้าหมาย ${ovpFmt(target)}` });
    } else {
      severity = 'yellow';
      reasons.push({ code: 'FORECAST_SLIGHTLY_BELOW', label: ALERT_REASON_LABELS.FORECAST_SLIGHTLY_BELOW, detail: `คาดการณ์ ${ovpFmt(forecastResult)} เทียบเป้าหมาย ${ovpFmt(target)}` });
    }
  }

  // Supplementary LOW-confidence pace signal — only fires when forecast evidence didn't already
  // decide it, and only ever as 'yellow' (brief §8: weak/inferred evidence -> softer wording, never a hard call).
  if (!severity && behavior === 'CUMULATIVE_NUMERIC' && target) {
    const expectedPace = target * 9 / 12;
    const paceRatio = expectedPace ? (higherIsBetter ? actual / expectedPace : expectedPace / actual) : null;
    if (paceRatio !== null && paceRatio < cfg.paceRatioYellow) {
      severity = 'yellow';
      reasons.push({
        code: 'BEHIND_EXPECTED_PACE', label: ALERT_REASON_LABELS.BEHIND_EXPECTED_PACE,
        detail: `สะสม Q3 ${ovpFmt(actual)} เทียบจังหวะที่คาดหวัง ${ovpFmt(expectedPace)} (อนุมานจากสัดส่วนเวลา 9/12 ปี — ไม่ใช่แผนที่อนุมัติ)`,
      });
    }
  }

  return { severity, confidence, reasons, q3_actual: actual, q3_plan: null, target, forecast: forecastResult, gap: gapToTarget, q4_required: q4Required, behavior };
}

// ── PLAN analysis (brief §9/§10) ──
function alertAnalyzePlan(kpiId, kpi) {
  const s = scoreAt(kpiId, 'q3');
  if (s.rawValue === null || s.rawValue === undefined) return null; // not confirmed — never fabricate

  const entry = getEntry(kpiId);
  let lastConfirmedMonth = null, lastConfirmedPct = null;
  ENTRY_Q3_MONTHS.forEach(m => {
    const mm = entry.monthly && entry.monthly[m.key];
    const conf = entry.adminConfirmation && entry.adminConfirmation[m.key];
    if (mm && mm.submission_status === 'confirmed' && conf) { lastConfirmedMonth = m.key; lastConfirmedPct = conf.confirmed_percent; }
  });

  const cfg = ALERT_CONFIG.plan;
  const reasons = [];
  let severity = null;
  let confidence = 'LOW';

  const effectiveMonthly = getActionPlanMonthly(kpiId);
  const effMonthPlan = lastConfirmedMonth ? effectiveMonthly[lastConfirmedMonth] : null;
  const planPercent = effMonthPlan ? effMonthPlan.planned_percent : null;
  const usedRevised = effMonthPlan ? effMonthPlan.baseline_or_revised === 'revised' : false;

  let gapPoints = null;
  if (planPercent !== null && lastConfirmedPct !== null) {
    confidence = 'HIGH';
    gapPoints = lastConfirmedPct - planPercent;
    if (gapPoints <= -cfg.gapPointsRed) {
      severity = 'red';
      reasons.push({ code: 'Q3_BELOW_PLAN', label: ALERT_REASON_LABELS.Q3_BELOW_PLAN, detail: `${lastConfirmedPct}% เทียบแผน ${planPercent}% (ต่ำกว่า ${Math.abs(gapPoints).toFixed(1)} จุด)` });
      reasons.push({ code: 'Q4_CONCENTRATION', label: ALERT_REASON_LABELS.Q4_CONCENTRATION, detail: null });
    } else if (gapPoints <= -cfg.gapPointsOrange) {
      severity = 'orange';
      reasons.push({ code: 'Q3_BELOW_PLAN_MODERATE', label: ALERT_REASON_LABELS.Q3_BELOW_PLAN_MODERATE, detail: `${lastConfirmedPct}% เทียบแผน ${planPercent}% (ต่ำกว่า ${Math.abs(gapPoints).toFixed(1)} จุด)` });
    } else if (gapPoints <= -cfg.gapPointsYellow) {
      severity = 'yellow';
      reasons.push({ code: 'Q3_SLIGHTLY_BELOW_PLAN', label: ALERT_REASON_LABELS.Q3_SLIGHTLY_BELOW_PLAN, detail: `${lastConfirmedPct}% เทียบแผน ${planPercent}% (ต่ำกว่า ${Math.abs(gapPoints).toFixed(1)} จุด)` });
    }
  }

  // Revised-plan awareness (brief §10): a revised plan must not erase a baseline delay. Compare
  // the SAME confirmed % against the ORIGINAL baseline ladder too, even if currently on-plan
  // against the revision.
  let baselineStatus = 'no_revision', revisedStatus = null;
  if (usedRevised) {
    const baselineMonthly = getActionPlanMonthlyBaseline(kpiId);
    const baselinePlanPct = (baselineMonthly && lastConfirmedMonth) ? baselineMonthly[lastConfirmedMonth].planned_percent : null;
    if (baselinePlanPct !== null && lastConfirmedPct !== null) {
      const baselineGap = lastConfirmedPct - baselinePlanPct;
      baselineStatus = baselineGap < -cfg.baselineGapPointsYellow ? 'behind_baseline' : 'meets_baseline';
      revisedStatus = gapPoints !== null && gapPoints >= -cfg.gapPointsYellow ? 'on_revised' : 'behind_revised';
      if (baselineStatus === 'behind_baseline') {
        if (!severity) severity = 'yellow';
        reasons.push({
          code: 'ON_REVISED_BUT_BEHIND_BASELINE', label: ALERT_REASON_LABELS.ON_REVISED_BUT_BEHIND_BASELINE,
          detail: `เทียบแผนเดิม ${baselinePlanPct}% (ล่าช้าจากแผนเดิม ${Math.abs(baselineGap).toFixed(1)} จุด)`,
        });
      }
    }
  } else if (planPercent !== null) {
    baselineStatus = gapPoints !== null && gapPoints >= -cfg.gapPointsYellow ? 'on_baseline' : 'behind_baseline';
  }

  return {
    severity, confidence, reasons,
    q3_actual: lastConfirmedPct, q3_plan: planPercent, target: null, forecast: null, gap: gapPoints, q4_required: null,
    baseline_plan_status: baselineStatus, revised_plan_status: revisedStatus,
    behavior: alertKpiBehavior(kpi),
  };
}

// ── Build one Alert record for a KPI (brief §24 shape). Returns null if Q3 isn't confirmed. ──
function alertBuildFor(kpiId) {
  const kpi = MOU_DATA.kpis[kpiId];
  if (!kpi || !kpi.isLeaf) return null;
  const isPlan = alertIsPlanKpi(kpi);
  const analysis = isPlan ? alertAnalyzePlan(kpiId, kpi) : alertAnalyzeNumeric(kpiId, kpi);
  if (!analysis) return null; // no confirmed Q3 for this KPI — never fabricate (brief §2)

  const deduction = alertDeductionFor(kpiId);
  if (deduction && !analysis.severity) {
    // Deduction risk is a SEPARATE signal that may still elevate attention even with no trend
    // issue (brief §11) — it never gets blended into the trend reasons above.
    analysis.severity = 'yellow';
  }
  const { obstacle, solution } = alertObstacleSolution(kpiId, kpi);

  return {
    alert_id: kpiId + '_q3', fiscal_year: '2569', quarter: 'q3', kpi_id: kpiId, kpi_label: kpi.label,
    kpi_type: isPlan ? 'plan' : 'numeric', weight: kpi.weight,
    severity: analysis.severity, confidence: analysis.confidence,
    q3_actual: analysis.q3_actual, q3_plan: analysis.q3_plan, target: analysis.target, forecast: analysis.forecast,
    gap: analysis.gap, q4_required: analysis.q4_required,
    baseline_plan_status: analysis.baseline_plan_status || null, revised_plan_status: analysis.revised_plan_status || null,
    reasons: analysis.reasons,
    obstacle, solution,
    support_contacts: alertSupportContacts(kpi),
    deduction_risk: deduction ? { reason: deduction.reason, status: deduction.status } : null,
    status: 'OPEN', generated_at: new Date().toISOString(),
  };
}

// ── Compute all alerts + whether ANY leaf KPI has a confirmed Q3 at all (brief §21 empty state) ──
function alertComputeAll() {
  const leaves = Object.values(MOU_DATA.kpis).filter(k => k.isLeaf);
  let confirmedCount = 0;
  const records = [];
  leaves.forEach(kpi => {
    const s = scoreAt(kpi.id, 'q3');
    if (s.rawValue !== null && s.rawValue !== undefined) confirmedCount++;
    const rec = alertBuildFor(kpi.id);
    if (rec && rec.severity) records.push(rec);
  });
  records.sort((a, b) => ALERT_LEVEL_ORDER.indexOf(a.severity) - ALERT_LEVEL_ORDER.indexOf(b.severity) || (b.weight || 0) - (a.weight || 0));
  return { records, confirmedCount, totalLeafCount: leaves.length };
}

// ═══════════════════════════════════════════════════════════
// FOLLOW-UP LOG (brief §17/§18) — V1 only ever writes status='prepared', never sends email.
// ═══════════════════════════════════════════════════════════
const ALERT_ACTIONS_KEY = 'mou69_alert_actions_v1';
function alertLoadActions() {
  try { return JSON.parse(localStorage.getItem(ALERT_ACTIONS_KEY) || '[]'); } catch (e) { return []; }
}
function alertSaveAction({ alertId, recipient, note, createdBy }) {
  const actions = alertLoadActions();
  actions.push({
    alert_id: alertId, action_type: ALERT_ACTION_TYPE, recipient: recipient || null,
    created_by: createdBy || 'ผู้ดูแลระบบ (UAT)', created_at: new Date().toISOString(),
    note: note || '', status: 'prepared',
  });
  try { localStorage.setItem(ALERT_ACTIONS_KEY, JSON.stringify(actions)); } catch (e) {}
  return actions[actions.length - 1];
}
function alertActionsFor(alertId) { return alertLoadActions().filter(a => a.alert_id === alertId); }
