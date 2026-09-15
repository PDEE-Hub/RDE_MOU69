// entry_config.js — Q3 UAT Data Entry configuration (MODIFICATION BRIEF §1-§12).
// Static config only — no scoring logic here (that stays in engine.js / entry_store.js).
// Everything below is read from MOU_DATA / engine.js at runtime; nothing is re-derived
// or invented beyond what §3/§5 explicitly authorize (SUM / LAST_VALUE — never assumed).

const ENTRY_PILOT_IDS = ['1.1','1.2','1.3','1.4','2.1','2.2','2.3','2.4','2.5','2.6','2.7','2.8'];

// Full fiscal year, m1-m12 — same numbering already used by DTL_MONTH_LABEL/monthly data (m1=ต.ค.).
// Used only by the Action Plan annual strip (brief "ACTION PLAN MONTHLY VIEW"). Only Q3 (m7-m9)
// is the live UAT reporting quarter; Q1/Q2/Q4 have no per-month Action Plan data in Master and are
// shown empty rather than invented.
const ENTRY_FISCAL_MONTHS = [
  { key: 'm1', label: 'ต.ค.', quarter: 'q1' }, { key: 'm2', label: 'พ.ย.', quarter: 'q1' }, { key: 'm3', label: 'ธ.ค.', quarter: 'q1' },
  { key: 'm4', label: 'ม.ค.', quarter: 'q2' }, { key: 'm5', label: 'ก.พ.', quarter: 'q2' }, { key: 'm6', label: 'มี.ค.', quarter: 'q2' },
  { key: 'm7', label: 'เม.ย.', quarter: 'q3' }, { key: 'm8', label: 'พ.ค.', quarter: 'q3' }, { key: 'm9', label: 'มิ.ย.', quarter: 'q3' },
  { key: 'm10', label: 'ก.ค.', quarter: 'q4' }, { key: 'm11', label: 'ส.ค.', quarter: 'q4' }, { key: 'm12', label: 'ก.ย.', quarter: 'q4' },
];
const ENTRY_FISCAL_QUARTER_LABEL = { q1: 'Q1', q2: 'Q2', q3: 'Q3', q4: 'Q4' };

// ═══════════════════════════════════════════════════════════
// QUARTER CONFIG (Step 5A: quarter-driven Entry architecture) — single source of truth for both
// (a) which fiscal months belong to which quarter/label, and (b) read/write status per quarter.
// Q3's months/labels here are IDENTICAL to the old ENTRY_Q3_MONTHS (see getQuarterMonths('q3')
// below, which derives it) — the Q3 → m7/m8/m9 mapping is NOT changed by this refactor.
//
// QUARTER_STATUS values: 'historical' (Q1/Q2, read-only — never routed through this entry system
// at all), 'locked' (Q3 — Final Snapshot confirmed in MOU69_DB, no further edits), 'not_open'
// (Q4 — Step 5A prepares the architecture only; Step 5B opens it for real via a central write
// API), 'open' (none yet — this is what Step 5B flips for Q4).
// ═══════════════════════════════════════════════════════════
const QUARTER_STATUS = { q1: 'historical', q2: 'historical', q3: 'locked', q4: 'not_open' };
const QUARTER_CONFIG = {
  q1: { label: 'Q1', months: ['m1', 'm2', 'm3'], monthLabels: ['ตุลาคม 2568', 'พฤศจิกายน 2568', 'ธันวาคม 2568'] },
  q2: { label: 'Q2', months: ['m4', 'm5', 'm6'], monthLabels: ['มกราคม 2569', 'กุมภาพันธ์ 2569', 'มีนาคม 2569'] },
  q3: { label: 'Q3', months: ['m7', 'm8', 'm9'], monthLabels: ['เมษายน 2569', 'พฤษภาคม 2569', 'มิถุนายน 2569'] },
  q4: { label: 'Q4', months: ['m10', 'm11', 'm12'], monthLabels: ['กรกฎาคม 2569', 'สิงหาคม 2569', 'กันยายน 2569'] },
};
function getQuarterConfig(quarter) { return QUARTER_CONFIG[String(quarter || '').toLowerCase()] || null; }
// Same {key,label} shape the old ENTRY_Q3_MONTHS used, for any quarter — the render loops in
// entry.js call this instead of hardcoding ENTRY_Q3_MONTHS, so one component renders every quarter.
function getQuarterMonths(quarter) {
  const c = getQuarterConfig(quarter);
  if (!c) return [];
  return c.months.map((key, i) => ({ key, label: c.monthLabels[i] }));
}
function getQuarterStatus(quarter) { return QUARTER_STATUS[String(quarter || '').toLowerCase()] || null; }
function isQuarterLocked(quarter) { return getQuarterStatus(quarter) === 'locked'; }
function isQuarterOpenForEntry(quarter) { return getQuarterStatus(quarter) === 'open'; }
// Every quarter in QUARTER_STATUS can be selected/viewed in the switcher — none are hidden.
function isQuarterReadable(quarter) { return !!getQuarterStatus(quarter); }

// Write-block code/message per quarter status (Section 12) — Q3 is blocked because it's locked,
// Q4 because it isn't open yet, Q1/Q2 because they're historical; each gets its own code so a
// caller (or a console bypass attempt) can tell WHY, not just that it failed.
const QUARTER_BLOCK_CODE = { locked: 'QUARTER_LOCKED', not_open: 'QUARTER_NOT_OPEN', historical: 'QUARTER_READ_ONLY' };
function quarterWriteBlockCode(quarter) { return QUARTER_BLOCK_CODE[getQuarterStatus(quarter)] || 'QUARTER_LOCKED'; }
const QUARTER_BLOCK_MESSAGE = {
  QUARTER_LOCKED: 'Q3 ปิดรับข้อมูลแล้ว · Final — ข้อมูลไตรมาส 3 ได้รับการยืนยันและล็อกแล้ว สามารถดูข้อมูลได้อย่างเดียว',
  QUARTER_NOT_OPEN: 'Q4 ยังไม่เปิดรับข้อมูล — ระบบอยู่ระหว่างเตรียมการเปิดรับผลการดำเนินงาน เดือนกรกฎาคม–กันยายน 2569',
  QUARTER_READ_ONLY: 'ไตรมาสนี้เป็นข้อมูลย้อนหลัง (Read-only) สามารถดูข้อมูลได้อย่างเดียว',
};
function quarterWriteBlockMessage(quarter) { return QUARTER_BLOCK_MESSAGE[quarterWriteBlockCode(quarter)]; }

// The only quarter with a real, confirmed data store today (mou69_uat_q3_v1) — every read/write
// function in entry_store.js still ultimately keys off this constant, not a hardcoded 'q3' string.
// entryState.selectedQuarter (entry.js) is the UI-level "which quarter am I viewing" and defaults
// to this; it must NOT be changed to 'q4' by this step (Section 3 — Q4 stays not_open).
const ENTRY_ACTIVE_QUARTER = 'q3';
const ENTRY_Q3_MONTHS = getQuarterMonths('q3'); // kept for entry_store.js's scoring/aggregation internals (Section 9 — must not change)
const ENTRY_LOCKED = isQuarterLocked(ENTRY_ACTIVE_QUARTER);
const ENTRY_LOCK_MESSAGE = QUARTER_BLOCK_MESSAGE.QUARTER_LOCKED;
const ENTRY_LOCK_TOOLTIP = 'Q3 ปิดรับข้อมูลแล้ว — ล็อกเป็น Final ไม่สามารถแก้ไขได้';

// kpiType per brief §1: only two Thai-facing types. Parent/Child is structure, not type.
// '1.1' is 'investment' — a distinct entry workflow (annual framework + shared raw plan/actual,
// brief v1.2 §B) though it still scores as an ordinary numeric/linear KPI in engine.js.
const ENTRY_KPI_TYPE = {
  '1.2':'report','1.3':'report','1.4':'report','2.1':'report','2.1.1':'report','2.1.2':'report','2.1.3':'report','2.2':'report','2.3':'report','2.5':'report','2.5.1':'report','2.5.2':'report','2.6':'report','2.8':'report','2.8.1':'report','2.8.2':'report','2.8.3':'report',
  '2.4': 'numeric',
  '1.1': 'investment', '1.1.1': 'numeric', '1.1.2': 'numeric',
  '2.7': 'plan', '2.7.1': 'plan', '2.7.2': 'plan', '2.7.3': 'plan',
  '2.7.3.1': 'plan', '2.7.3.2': 'plan', '2.7.4': 'plan',
};

// ── Calculation method per numeric leaf KPI (brief §3: "ห้าม assume ว่า KPI ทุกตัวใช้ SUM") ──
// SUM_CUMULATIVE   : monthly values are period-only (not running totals). Quarter result =
//                     sum of the 3 months. Cumulative = previous quarter's cumulative + quarter result.
//                     Confirmed against MOU_DATA.monthly['2.4'] (m1-m6 are per-month, not cumulative)
//                     and MOU_DATA.quarterly['2.4'] (q1=2.727, q2=5.44 ≈ q1 + Σm4-m6).
// INVESTMENT_RATIO : 1.1.1/1.1.2 (see ENTRY_INVESTMENT_CONFIG below) — computed together from ONE
//                     shared raw dataset (เบิกจ่ายจริง/เบิกจ่ายตามแผน per quarter + the annual framework),
//                     not entered as a percentage directly. Formula reverse-engineered and VERIFIED
//                     cell-by-cell against MOU69_Claude.xlsx, sheet "MOU69_Claude_Q1+Q2 และคาดการณ์":
//                       1.1.1 (Q_n) = Σ(actual disbursed, Q1..Qn) / annual_framework × 100
//                       1.1.2 (Q_n) = [ Σ(actual_Qi / planned_Qi, i=1..n) / 4 ] × 100   (always ÷4 = full-year quarters,
//                                     so a project exactly on-plan every quarter reaches 100% only at Q4)
//                     Verified: AM7=1157.501 (actual Q1), AN7=1157.501 (plan Q1), AO7=1770.055 (actual Q2),
//                     AP7=1770.06 (plan Q2), AU7=5880.79 (annual target). =AM7/AU7 = 19.68% (matches seeded
//                     1.1.1 Q1). =(AM7/AN7)/4 = 25% (matches seeded 1.1.2 Q1). =(AO7+AM7)/AU7 = 49.78%
//                     (matches seeded 1.1.1 Q2). =((AM7/AN7)+(AO7/AP7))/4 = 50.00% (matches seeded 1.1.2 Q2).
const ENTRY_CALC_METHOD = {
  '2.4': 'SUM_CUMULATIVE',
  '1.1.1': 'INVESTMENT_RATIO',
  '1.1.2': 'INVESTMENT_RATIO',
};

// ── KPI 1.1 shared raw investment data (brief v1.2 §B) ──
// Both 1.1.1 and 1.1.2 are derived from ONE shared dataset entered at the "1.1" parent level —
// confirmed from the Master workbook: row 8 (1.1.1) and row 9 (1.1.2)'s formulas both reference
// the SAME scratch cells anchored on row 7 (the "1.1" parent row), not two separate raw datasets.
const ENTRY_INVESTMENT_KPI = '1.1';

// Annual framework ("เป้าตามแผน") seed — brief §B2: initialize from verified Master data for this
// UAT only; the real workflow lets the responsible user create this at the start of each fiscal year.
const ENTRY_ANNUAL_FRAMEWORK_SEED = {
  fiscalYear: '2569',
  amount: 5880.79, // ล้านบาท — MOU69_Claude.xlsx, sheet "MOU69_Claude_Q1+Q2 และคาดการณ์", cell AU7 "เป้าตามแผน"
  effectiveDate: '2025-10-01', // Gregorian — displays as "1 ตุลาคม 2568" (Buddhist Era = +543) = start of FY2569
  sourceNote: 'นำเข้าจาก Master Data (MOU69_Claude.xlsx) สำหรับ UAT นี้ — กระบวนการจริงให้ผู้รับผิดชอบ KPI กรอกต้นปีบัญชี',
};

// Q1/Q2 raw quarter totals (read-only historical baseline, brief §B2) — ล้านบาท, per-quarter
// (not cumulative). Source: same sheet, cells AM7/AN7 (Q1 actual/plan), AO7/AP7 (Q2 actual/plan).
const ENTRY_INVESTMENT_PRIOR_RAW = {
  q1: { actual: 1157.501, plan: 1157.501 },
  q2: { actual: 1770.055, plan: 1770.060 },
};

// ── 2.4 unit options — user enters whatever is natural, engine normalizes to Master unit (ล้าน ที.อี.ยู.) ──
const ENTRY_UNIT_OPTIONS = {
  '2.4': [
    { key: 'million_teu', label: 'ล้าน ที.อี.ยู.', factor: 1 },
    { key: 'teu', label: 'ที.อี.ยู. (หน่วยนับจริง)', factor: 0.000001 },
  ],
};

// ── Evidence document types (brief §10) ──
const ENTRY_DOCUMENT_TYPES = ['รายงานความก้าวหน้า', 'มติที่ประชุม/บันทึกอนุมัติ', 'หนังสือ/หนังสือเวียน', 'ภาพถ่ายหลักฐานหน้างาน', 'อื่นๆ'];

// ── 2.7 REAL baseline Action Plan (brief v1.2 §C3: "use real Master data... do NOT create
// fake/mock activities"). Transcribed verbatim from MOU69_Claude.xlsx, sheet "4.Action_Plan"
// (KPI ID_main=2.7 block). Each activity's expected % is the number embedded in its own text
// by Master (either "N%" or "(ร้อยละ N)") — parsed, never invented. Master does NOT provide
// start_month/end_month for any activity — left null and shown as "ไม่ระบุในข้อมูลต้นทาง"
// per §C3 ("do not silently invent missing months").
const ENTRY_ACTION_PLAN_MASTER = {
  '2.7.1': [
    'ผู้รับจ้างดำเนินการก่อสร้าง 60%',
    'ผู้รับจ้างดำเนินการก่อสร้าง 70%',
    'ผู้รับจ้างดำเนินการก่อสร้าง 80%',
    'ผู้รับจ้างดำเนินการก่อสร้าง 90%',
    'ผู้รับจ้างดำเนินการก่อสร้าง 100% ภายในเดือนกันยายน 69',
  ],
  '2.7.2': [
    'ดำเนินการตามแผนได้ร้อยละ 60',
    'ดำเนินการตามแผนได้ร้อยละ 70',
    'ดำเนินการตามแผนได้ร้อยละ 80',
    'ดำเนินการตามแผนได้ร้อยละ 90',
    'ดำเนินการตามแผนได้ร้อยละ 100',
  ],
  '2.7.3.1': [
    'ขอจัดสรรงบประมาณเพิ่มเติม (ร้อยละ 15)',
    'ประกาศแผนจัดซื้อจัดจ้าง (ร้อยละ 20)',
    'ร่าง TOR (ร้อยละ 45)',
    'รายงานขอซื้อขอจ้าง (ร้อยละ 50)',
    'เปิดซองพิจารณาการประกวดราคา (ร้อยละ 55)',
    'รายงานผลการพิจารณาอนุมัติ (ร้อยละ 60)',
    'ทำสัญญาการจัดซื้อจัดจ้าง (ร้อยละ 70)',
    'ตรวจรับพัสดุ (ร้อยละ 100)',
  ],
  '2.7.3.2': [
    'ขอจัดสรรงบประมาณเพิ่มเติม (ร้อยละ 15)',
    'ประกาศแผนจัดซื้อจัดจ้าง (ร้อยละ 20)',
    'ร่าง TOR (ร้อยละ 45)',
    'รายงานขอซื้อขอจ้าง (ร้อยละ 50)',
    'เปิดซองพิจารณาการประกวดราคา (ร้อยละ 55)',
    'รายงานผลการพิจารณาอนุมัติ (ร้อยละ 60)',
    'ทำสัญญาการจัดซื้อจัดจ้าง (ร้อยละ 70)',
    'ตรวจรับพัสดุ (ร้อยละ 100)',
  ],
  '2.7.4': [
    'สามารถดำเนินโครงการและบรรลุเป้าหมาย คิดเป็นร้อยละ 60',
    'สามารถดำเนินโครงการและบรรลุเป้าหมาย คิดเป็นร้อยละ 70',
    'สามารถดำเนินโครงการและบรรลุเป้าหมาย คิดเป็นร้อยละ 80',
    'สามารถดำเนินโครงการและบรรลุเป้าหมาย คิดเป็นร้อยละ 90',
    'สามารถดำเนินโครงการและบรรลุเป้าหมาย คิดเป็นร้อยละ 100',
  ],
};
function entryParseActivityPercent(text) {
  const m = text.match(/(\d+(?:\.\d+)?)\s*%|ร้อยละ\s*(\d+(?:\.\d+)?)/);
  return m ? Number(m[1] || m[2]) : null;
}

// Priority order matters: rejected > not_started > preparing > in_progress > completed.
// Each rule is checked as "keyword present AND modal phrase present nearby" — deliberately
// NOT "keyword present" alone (brief §7: "ห้ามพบคำว่า 'คณะกรรมการ' แล้วถือว่า Milestone Complete ทันที").
const ENTRY_PHRASE_RULES = [
  { status: 'rejected', label: 'ไม่เห็นชอบ/ตีกลับ', re: /(ไม่เห็นชอบ|ไม่อนุมัติ|ตีกลับ|ปฏิเสธ)/ },
  { status: 'not_started', label: 'ยังไม่ดำเนินการ', re: /(ยังไม่ได้|ยังไม่เริ่ม|ยังไม่ดำเนินการ|ยังไม่มีการ)/ },
  { status: 'preparing', label: 'เตรียมดำเนินการ', re: /(เตรียม(?:การ|จัดทำ|นำเสนอ|เสนอ)?|จะเสนอ|วางแผนจะ|กำหนดจะ)/ },
  { status: 'in_progress', label: 'อยู่ระหว่างดำเนินการ', re: /(อยู่ระหว่าง|กำลังดำเนินการ|ระหว่างพิจารณา|ระหว่างการ)/ },
  { status: 'completed', label: 'ดำเนินการแล้วเสร็จ', re: /(แล้วเสร็จ|เสร็จสิ้น|ดำเนินการแล้ว|อนุมัติแล้ว|เห็นชอบแล้ว|ลงนามแล้ว|เสนอ.{0,6}แล้ว)/ },
];

// Suggested %-per-milestone-status — a display hint only, never written to Score.
const ENTRY_STATUS_SUGGEST_PCT = { not_started: 0, preparing: 20, in_progress: 50, completed: 100, rejected: null };
const ENTRY_STATUS_LABEL_TH = {
  not_started: 'ยังไม่ดำเนินการ', preparing: 'เตรียมดำเนินการ', in_progress: 'อยู่ระหว่างดำเนินการ',
  completed: 'ดำเนินการแล้วเสร็จ', rejected: 'ไม่เห็นชอบ/ตีกลับ',
};

// ── Management Status vocabulary (brief §13 — separate from MOU Score) ──
const ENTRY_MGMT_STATUS = {
  on_track: { label: 'เป็นไปตามรอบการดำเนินงาน', tone: 'ok' },
  watch: { label: 'ต้องติดตาม', tone: 'watch' },
  risk: { label: 'มีความเสี่ยง', tone: 'risk' },
  not_due: { label: 'ยังไม่ถึงรอบประเมิน', tone: 'muted' },
  pending_confirmation: { label: 'รอยืนยัน', tone: 'watch' },
  pending_evidence: { label: 'รอหลักฐาน', tone: 'watch' },
};
