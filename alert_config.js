// alert_config.js — Alerts Prototype V1 configuration (MODIFICATION BRIEF "ALERTS PROTOTYPE V1").
// Thresholds live here, never inline in alert_engine.js or alerts.js (brief §25).

// ── 3 management levels (brief §5) — never derived from Score alone ──
const ALERT_LEVEL_META = {
  red: { label: 'ต้องเร่งรัด', color: '#c0392b', bg: '#fdecec', border: '#f0b3b3' },
  orange: { label: 'มีแนวโน้มไม่ถึงเป้าหมาย', color: '#b5651d', bg: '#fdf1e6', border: '#eec9a0' },
  yellow: { label: 'ควรติดตาม', color: '#8a6d1a', bg: '#fff8e1', border: '#e8d488' },
};
const ALERT_LEVEL_ORDER = ['red', 'orange', 'yellow'];

// ── KPI behavior metadata (brief §4) — derived deterministically from each KPI's own
// scoringMethod already in MOU_DATA (never invented, never hardcoded per-KPI-ID here).
// Internal only — UI never shows these technical names.
const ALERT_KPI_BEHAVIOR = {
  linear: 'CUMULATIVE_NUMERIC',       // cumulative-to-date value compared to an annual target (2.4, 1.1.1, 1.1.2, ...)
  annual_only: 'YEAR_END',            // real score only exists at Q4 / forecast; Q1-Q3 carry a placeholder Level (1.4)
  milestone_pct: 'MILESTONE_PLAN',    // % ladder against an Action Plan (2.7.1/2.7.2/2.7.4)
  milestone_manual: 'MILESTONE_PLAN', // same, but admin picks Level manually (2.7.3.1/2.7.3.2 — special step scale)
  qualitative: 'PERIOD_SPECIFIC',     // admin-judged level each period, no numeric ladder (1.3, 2.5.x)
  evidence: 'PERIOD_SPECIFIC',        // admin-judged from evidence each period (2.8.x)
};
function alertKpiBehavior(kpi) {
  return ALERT_KPI_BEHAVIOR[kpi.scoringMethod] || 'PERIOD_SPECIFIC';
}

// ── Thresholds (brief §7/§10) — all configurable, revise after UAT ──
const ALERT_CONFIG = {
  numeric: {
    // forecastGap = (target - forecast) / |target|, higherIsBetter-normalized
    forecastGapRatioRed: 0.10,     // forecast misses target by >=10% of target -> red
    forecastGapRatioOrange: 0.03,  // >=3% -> orange
    // supplementary, LOW-confidence-only signal — inferred pace vs a straight-line 9/12 expectation.
    // Never escalates past 'yellow' on its own (brief §8: weak evidence -> softer wording only).
    paceRatioYellow: 0.95,
  },
  plan: {
    // confirmed% - planned% (percentage points). Negative = behind plan.
    gapPointsRed: 20,
    gapPointsOrange: 10,
    gapPointsYellow: 3,
    // Same thresholds reused when comparing confirmed% against the ORIGINAL baseline plan
    // even while nominally "on" a revised plan (brief §10 — baseline delay must stay visible).
    baselineGapPointsYellow: 3,
  },
};

// ── Structured reason codes (brief §16) — label always shown; detail filled per-KPI at analysis time ──
const ALERT_REASON_LABELS = {
  FORECAST_MATERIALLY_BELOW_TARGET: 'คาดการณ์สิ้นปีต่ำกว่าเป้าหมายอย่างมีนัยสำคัญ',
  FORECAST_BELOW_TARGET: 'คาดการณ์สิ้นปีต่ำกว่าเป้าหมาย',
  FORECAST_SLIGHTLY_BELOW: 'คาดการณ์ต่ำกว่าเป้าหมายเล็กน้อย',
  BEHIND_EXPECTED_PACE: 'ผลสะสม Q3 ต่ำกว่าจังหวะที่คาดหวังตามสัดส่วนเวลา',
  Q3_BELOW_PLAN: 'ผลการดำเนินงาน Q3 ต่ำกว่าแผนอย่างมีนัยสำคัญ',
  Q3_BELOW_PLAN_MODERATE: 'ผลการดำเนินงาน Q3 ต่ำกว่าแผน',
  Q3_SLIGHTLY_BELOW_PLAN: 'ผลการดำเนินงาน Q3 ต่ำกว่าแผนเล็กน้อย',
  ON_REVISED_BUT_BEHIND_BASELINE: 'ดำเนินการตามแผนปรับ แต่ล่าช้าจากแผนเดิม',
  Q4_CONCENTRATION: 'ภารกิจสำคัญกระจุกตัวใน Q4',
  DEDUCTION_CONDITION: 'มีเงื่อนไขหักคะแนนที่ต้องติดตามแยกจากแนวโน้มผลงาน',
};

// ── Evidence document types reused for the notification-preview "save" record ──
const ALERT_ACTION_TYPE = 'prepare_notify'; // V1 only ever creates this one type (brief §17/§18)

// ── Supporting-owner contact lookup (brief §13) — keyed by the exact role-code strings already
// used in MOU_DATA.kpis[id].ownerSupport (e.g. "อกผง."). Checked MOU69_Claude.xlsx end to end
// (every sheet, incl. "7. Executive_Owner") for a phone/email column: none exists — only role
// codes. So this table starts EMPTY. Never invent a phone/email; alerts.js shows "ไม่พบข้อมูลติดต่อ"
// for any role not present here. Fill this in once a real Contact Master is provided.
const ALERT_CONTACT_MASTER = {};

// ═══════════════════════════════════════════════════════════
// FUTURE ARCHITECTURE ONLY (brief §22/§23) — data-model shape reference, never wired to any
// UI, auth, or permission check in this phase. No login, no OAuth, no RBAC. Kept here only so
// a later phase has a documented shape to implement against.
//
// IMPORTANT: MOU69_Claude.xlsx was checked for executive email/phone columns across every sheet
// (7. Executive_Owner included) and none exist — only role/position codes (e.g. "รอง อทร.(กง)").
// So `users` below is intentionally seeded EMPTY rather than inventing addresses; brief §22's
// "organization already has executive email addresses in the Excel database" was not found in
// the workbook actually available to this prototype. Report this gap to the user; don't paper
// over it with fabricated emails.
// ═══════════════════════════════════════════════════════════
const FUTURE_USERS_SCHEMA_EXAMPLE = {
  user_id: null, email: null, name: null, position: null,
  organization_unit: null, role: null, executive_level: null, active: null,
};
const FUTURE_PERMISSIONS_SCHEMA_EXAMPLE = {
  home: false, overview: false, detail: false, entry: false, alerts: false, admin_review: false, criteria_admin: false,
};
const FUTURE_EXECUTIVE_ROLE_CODES = [
  // Roles named in the brief, kept as role-code labels ONLY (no email/phone — none in Master).
  'รอง ผช. อทร.', 'ผช.อทร.', 'อทกท.', 'อทลฉ.', 'รอง อ.ทกท.', 'รอง อ.ทลฉ.',
  'อฝก.', 'อฝพต.', 'อ.สทภ.', 'อฝง.',
];
const users = []; // FUTURE ONLY — intentionally empty, no real accounts modeled in V1.
const permissions = []; // FUTURE ONLY — intentionally empty.
