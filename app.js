// app.js — MOU 69 V1 render layer. Reads MOU_DATA (mou_data.js) through engine.js only —
// never re-derives scoring formulas here (V1 brief §8/§30).

const LV_COLORS = { 1: '#ea4024', 2: '#ffb3ac', 3: '#ffdb41', 4: '#86dbad', 5: '#41a570', null: '#d8d3c4' };
const QUARTERS = ['q1', 'q2', 'q3', 'q4'];
const Q_LABEL = { q1: 'Q1', q2: 'Q2', q3: 'Q3', q4: 'Q4', forecast: 'คาดการณ์' };

// ── Local overrides (Data Entry results for Q4 — starts empty, V1 rule) ──
function getOverrides() {
  try { return JSON.parse(localStorage.getItem('mou69_v1_overrides') || '{}'); } catch (e) { return {}; }
}
function saveOverrides(o) {
  try { localStorage.setItem('mou69_v1_overrides', JSON.stringify(o)); } catch (e) {}
}

// ── Merge seeded MOU_DATA.quarterly (Q1-Q3 real/baseline, via q3_baseline.js for Q3) with any
//    user-entered overrides (Q4) ──
function getQuarterInput(kpiId, q) {
  // Remote Read: MOU69_DB wins for any KPI it genuinely has a record for, while remote is live
  // this session — see remote_data_adapter.js. No record for this kpiId/quarter -> undefined ->
  // falls straight through to the local logic below (override, then Q3 baseline, then null).
  if (typeof remotePilotGetInput === 'function') {
    const remoteVal = remotePilotGetInput(kpiId, q);
    if (remoteVal !== undefined) return remoteVal;
  }
  const overrides = getOverrides();
  if (overrides[kpiId] && overrides[kpiId][q] !== undefined) return overrides[kpiId][q];
  const seeded = MOU_DATA.quarterly[kpiId] && MOU_DATA.quarterly[kpiId][q];
  if (!seeded) return null; // Q4 seed intentionally empty — V1 rule (Q3 is now baseline, see q3_baseline.js)
  const kpi = MOU_DATA.kpis[kpiId];
  const humanChosen = ['qualitative', 'evidence', 'milestone_manual'].includes(kpi.scoringMethod)
    || (kpi.scoringMethod === 'annual_only' && q !== 'q4');
  return humanChosen ? seeded.score : seeded.actual;
}

// ── Which quarter is "latest with data" per KPI (drives Home's active period) ──
function latestQuarterWithData(kpiId) {
  let latest = null;
  for (const q of QUARTERS) {
    if (getQuarterInput(kpiId, q) !== null) latest = q;
  }
  return latest;
}

// V1 initial state per brief §2: Active Quarter = Q2, Period = 6 Months
function systemActiveQuarter() {
  const overrides = getOverrides();
  const allLeaf = Object.values(MOU_DATA.kpis).filter(k => k.isLeaf);
  const anyQ3 = allLeaf.some(k => getQuarterInput(k.id, 'q3') !== null);
  const anyQ4 = allLeaf.some(k => getQuarterInput(k.id, 'q4') !== null);
  if (anyQ4) return 'q4';
  if (anyQ3) return 'q3';
  return 'q2';
}
const PERIOD_LABEL = { q1: '3 เดือน', q2: '6 เดือน', q3: '9 เดือน', q4: '12 เดือน' };

// Governance (Entry §12): a KPI's Level 1-5 thresholds can carry an admin-confirmed
// revision (board-approval gated, versioned in entry_store.js) — resolve through it here
// so Home/Overview/Detail/Entry all score against the same effective criteria.
function kpiForScoring(kpiId) {
  return typeof getEffectiveKpi === 'function' ? getEffectiveKpi(kpiId) : MOU_DATA.kpis[kpiId];
}

// ── Score a single leaf KPI at quarter q ──
function scoreAt(kpiId, q) {
  const kpi = kpiForScoring(kpiId);
  const input = getQuarterInput(kpiId, q);
  const result=scoreLeafKPI(kpi,input,q);
  if(typeof reportValue==='function') result.rawValue=reportValue(kpiId,q);
  return result;
}

// ── Score a parent KPI (rollup of its children) at quarter q ──
function scoreParentAt(kpiId, q) {
  const kpi = kpiForScoring(kpiId);
  const children = Object.values(MOU_DATA.kpis).filter(k => k.parent === kpiId);
  const childScores = children.map(c => c.isLeaf ? scoreAt(c.id, q) : scoreParentAt(c.id, q));
  return scoreParentKPI(kpi, childScores);
}

// ── Overall MOU score (60-weight budget, MOU KPIs only — Enablers combined score is separate) ──
function overallScoreAt(q) {
  const leaves = Object.values(MOU_DATA.kpis).filter(k => k.isLeaf);
  const leafScores = leaves.map(k => scoreAt(k.id, q));
  return computeOverallScore(leafScores, 60);
}
// DEPRECATED for executive/UI use (2026-09-13 reconciliation round) -- this KPI-by-KPI forecast
// dataset (MOU_DATA.forecast) was never synced with MOU69_Claude.xlsx / 1.Master Data, and its
// MOU-only total (4.4576) does not match Master's verified MOU forecast (4.186863). Kept ONLY as
// a diagnostic/technical value (e.g. to spot which KPI's local forecast entry disagrees with
// Master) -- see mouForecastScoreMaster() below for the number the UI must actually use.
function overallForecastScore() {
  const leaves = Object.values(MOU_DATA.kpis).filter(k => k.isLeaf);
  const scores = leaves.map(k => {
    const kpi = MOU_DATA.kpis[k.id];
    const fc = MOU_DATA.forecast[k.id];
    if (!fc) return { level: null, weightedValue: null };
    const humanChosen = ['qualitative', 'evidence', 'milestone_manual'].includes(kpi.scoringMethod);
    const input = humanChosen ? fc.score : fc.result;
    return scoreLeafKPI(kpi, input, 'forecast');
  });
  return computeOverallScore(scores, 60);
}
const TARGET_SCORE = 3.7500; // per V1 brief §21, matches live production MOU card

// ── Master Data reconciliation (2026-09-13) ──────────────────────────────────────────────
// Source: MOU69_Claude.xlsx, sheet "1.Master Data", columns D (ลำดับตัวชี้วัด หลัก), I (น้ำหนัก),
// AH ("ไตรมาส 3" -> "คาดการณ์") -- verified by direct cell inspection, not guessed. AH already
// holds each row's projected Level (1-5), pre-scored by Master, not a raw value to reinterpolate.
// Master's own MOU-total row (D=1, weight 60) equals the weighted sum of these 12 top-level rows
// exactly (cross-checked: reproduces 4.186863110008272 to the last digit) -- so unlike the
// current/actual chain (which correctly rolls up bottom-up from leaves, verified unchanged
// below), FORECAST for parents/top-level KPIs is taken from Master directly, per this round's
// explicit decision, rather than re-derived from each leaf's own (unsynced) local forecast entry.
// Single place to edit if Master Data / FY2569 forecast is revised.
const MASTER_DATA_TOP_LEVEL_FORECAST_FY2569 = {
  '1.1': { weight: 10, forecast: 5 },
  '1.2': { weight: 2, forecast: 4.211538461538461 },
  '1.3': { weight: 1, forecast: 5 },
  '1.4': { weight: 2, forecast: 5 },
  '2.1': { weight: 12, forecast: 2.6407258064516133 },
  '2.2': { weight: 3, forecast: 5 },
  '2.3': { weight: 4, forecast: 5 },
  '2.4': { weight: 4, forecast: 5 },
  '2.5': { weight: 5, forecast: 5 },
  '2.6': { weight: 4, forecast: 3 },
  '2.7': { weight: 8, forecast: 3.6375 },
  '2.8': { weight: 5, forecast: 5 },
};
// Forecast MOU Score -- reuses computeOverallScore() (engine.js) UNCHANGED, only the input data
// source differs from overallForecastScore() above (Master's top-level table vs local leaf data).
function mouForecastScoreMaster() {
  const rows = Object.entries(MASTER_DATA_TOP_LEVEL_FORECAST_FY2569)
    .map(([kpiId, r]) => ({ kpiId, level: r.forecast, weight: r.weight, weightedValue: r.forecast * r.weight }));
  return computeOverallScore(rows, 60);
}

// Enablers Score -- FY2569 business decision (2026-09-13), locked, NOT the Excel Master Data
// value (which shows 2.8856) and NOT connected to the separate Enablers project/backend this
// round (explicitly out of scope). Single constant; do not hardcode 2.7000 anywhere else.
const ENABLERS_SCORE_FY2569 = 2.7000;

// Overall Forecast Score = Forecast MOU Score x 0.60 + Enablers Score x 0.40. Computed, not
// hardcoded -- recalculates automatically if either input above ever changes.
function overallOrgForecastScore() {
  return mouForecastScoreMaster() * 0.60 + ENABLERS_SCORE_FY2569 * 0.40;
}
// Overall Current Score -- same 60/40 blend, for the live current-quarter MOU score. Not shown in
// UI this round (no verified current-quarter Enablers figure to reconcile against), but defined
// now so Q4 needs no new formula later -- overallScoreAt('q4') will just feed in real Q4 data.
function overallOrgScoreAt(q) {
  const mou = overallScoreAt(q);
  return mou === null ? null : mou * 0.60 + ENABLERS_SCORE_FY2569 * 0.40;
}

// Static presentation reference for the Home reference block -- values below are COMPUTED from
// the functions above (not re-hardcoded), except overallTarget which is itself a literal Master
// Data constant (sheet row "คะแนนภาพรวม", target column), not a formula result.
const MASTER_DATA_REFERENCE_FY2569 = {
  mouForecast: mouForecastScoreMaster(),
  enablersForecast: ENABLERS_SCORE_FY2569,
  overallForecast: overallOrgForecastScore(),
  overallTarget: 3.75002,
  source: 'MOU69_Claude.xlsx / 1.Master Data / FY2569',
};

function lvColor(level) {
  if (level === null || level === undefined) return LV_COLORS[null];
  const stops = [[1, LV_COLORS[1]], [2, LV_COLORS[2]], [3, LV_COLORS[3]], [4, LV_COLORS[4]], [5, LV_COLORS[5]]];
  const c = Math.max(1, Math.min(5, level));
  const lo = Math.floor(c), hi = Math.ceil(c);
  if (lo === hi) return stops[lo - 1][1];
  const hex = (h) => [1, 2, 3].map(i => parseInt(h.slice(i * 2 - 1, i * 2 + 1), 16));
  const [r1, g1, b1] = hex(stops[lo - 1][1]);
  const [r2, g2, b2] = hex(stops[hi - 1][1]);
  const t = c - lo;
  const r = Math.round(r1 + (r2 - r1) * t), g = Math.round(g1 + (g2 - g1) * t), b = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r},${g},${b})`;
}

// ═══════════════════════════════════════════════════════════
// CROSS-FILTER (per source sheet "9. การเชื่อมโยง" — real design intent)
// ═══════════════════════════════════════════════════════════
const filterState = { quarter: null, levelSet: new Set(), belowTarget: false };

function clearFilter() {
  filterState.quarter = null;
  filterState.levelSet.clear();
  filterState.belowTarget = false;
  renderHome();
}
function toggleQuarterFilter(q) {
  filterState.quarter = filterState.quarter === q ? null : q;
  bottomQ = filterState.quarter;
  renderHome();
}
function toggleLevelFilter(lv) {
  if (filterState.levelSet.has(lv)) filterState.levelSet.delete(lv); else filterState.levelSet.add(lv);
  renderHome();
}
function kpiMatchesFilter(kpiId) {
  if (filterState.levelSet.size === 0) return true;
  const q = filterState.quarter || systemActiveQuarter();
  const s = scoreAt(kpiId, q);
  const lv = s.level === null ? null : Math.round(s.level);
  return filterState.levelSet.has(lv);
}
function toggleLevelGroupFilter(levels) {
  const allOn = levels.every(lv => filterState.levelSet.has(lv));
  levels.forEach(lv => { if (allOn) filterState.levelSet.delete(lv); else filterState.levelSet.add(lv); });
  renderHome();
}
// Forecast score for one leaf KPI — same humanChosen rule already used by the
// heat map's "forecast" row and quick-detail; centralized here for reuse.
function forecastLeafScore(kpiId) {
  const kpi = MOU_DATA.kpis[kpiId];
  const fc = MOU_DATA.forecast[kpiId];
  if (!fc) return { level: null, rawValue: null };
  const humanChosen = ['qualitative', 'evidence', 'milestone_manual'].includes(kpi.scoringMethod);
  return scoreLeafKPI(kpi, humanChosen ? fc.score : fc.result, 'forecast');
}

// ═══════════════════════════════════════════════════════════
// HOME  (visual layer only — every number below still comes from
// scoreAt/scoreParentAt/overallScoreAt/overallForecastScore/MOU_DATA,
// same as before. Nothing here computes a score.)
// ═══════════════════════════════════════════════════════════
// Mascot: PAT-PHET pixel-chili brand asset (supplied artwork, not generated here).
// Used in exactly 2 places on Home per design brief: hero summary + quarterly progress.
const MASCOT_HERO_IMG = 'assets/mascot/chili-hero.png';
const MASCOT_RUN_IMG = 'assets/mascot/chili-run.png';

function heroNarrative(current, target) {
  if (current === null) return 'ยังไม่มีข้อมูลผลการดำเนินงาน';
  const pct = current / target * 100;
  if (pct >= 100) return 'ผลการดำเนินงานถึงเป้าหมายแล้ว รักษาระดับต่อเนื่องในไตรมาสถัดไป';
  if (pct >= 70) return 'ผลการดำเนินงานใกล้เคียงเป้าหมาย เดินหน้าต่อเนื่อง';
  return 'อยู่ช่วงต้นปีบัญชี ผลสะสมยังห่างจากเป้าหมาย มุ่งสู่เป้าหมายอย่างมั่นคงเพื่อ Impact ประเทศ';
}

function levelDistribution(q) {
  const leaves = Object.values(MOU_DATA.kpis).filter(k => k.isLeaf);
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, none: 0 };
  leaves.forEach(k => {
    const s = scoreAt(k.id, q);
    if (s.level === null) dist.none++; else dist[Math.round(s.level)]++;
  });
  return dist;
}

function priorityKpis(q, limit = 5) {
  const leaves = Object.values(MOU_DATA.kpis).filter(k => k.isLeaf);
  return leaves.map(k => ({ kpi: k, s: scoreAt(k.id, q) }))
    .filter(x => x.s.level !== null && x.s.level < 2)
    .sort((a, b) => b.kpi.weight - a.kpi.weight)
    .slice(0, limit);
}

function topWeightKpis(n) {
  return Object.values(MOU_DATA.kpis).filter(k => k.isLeaf).sort((a, b) => b.weight - a.weight).slice(0, n);
}

function goToActionPlan() {
  document.getElementById('tabBtnAlerts').click();
}
function goToOverview() {
  const btn = document.getElementById('tabBtnOverview');
  if (btn) switchTab('overview', btn);
}

// Bottom row (สรุปผลการดำเนินงาน / ประเด็นที่ควรเร่งรัด) can be inspected for any
// quarter via the quarter tabs — null means "follow the system's active quarter".
let bottomQ = null;
function setBottomQuarter(q) {
  bottomQ = q;
  const aq = bottomQ || systemActiveQuarter();
  renderSummaryBox(aq, overallScoreAt(aq));
  renderPriorityBox(aq);
  document.querySelectorAll('.bottom-qtabs button').forEach(b => b.classList.toggle('active', b.dataset.q === aq));
}

// Home uses discrete score bands, matching levelDistribution's existing rounding.
function homeScoreColor(level) { return level == null ? '#e5e7eb' : LV_COLORS[Math.max(1, Math.min(5, Math.round(level)))]; }
function forecastHomeScore(id) {
  const kpi = MOU_DATA.kpis[id];
  if (kpi.isLeaf) return forecastLeafScore(id);
  return scoreParentKPI(kpi, Object.values(MOU_DATA.kpis).filter(k => k.parent === id).map(k => forecastHomeScore(k.id)));
}
const HOME_HIGHLIGHT_LABELS = {'1.1.2':'ร้อยละความสามารถในการเบิกจ่ายตามแผน','2.1.1':'กำไรสุทธิ กทท.','2.4':'ปริมาณตู้สินค้าผ่าน ทลฉ.','2.8':'ระดับความสำเร็จของการบริหารสัญญาผู้ประกอบการท่าเรือ ระยะที่ 1 ของ ทลฉ.'};
function renderHome() {
  const root = document.getElementById('page-home');
  if (!root) return;
  const activeQ = filterState.quarter || systemActiveQuarter();
  const current = overallScoreAt(activeQ);
  const forecast = overallOrgForecastScore(); // Overall Forecast Score (MOU 60% + Enablers 40%) -- the executive headline number, see reconciliation block above
  const highlightKpis = ['1.1.2','2.1.1','2.4','2.8'].map(id => MOU_DATA.kpis[id]);

  root.innerHTML = `
    <div class="home-grid">
      <aside class="ledger-col">
        <div class="home-panel">
          <div class="mini-title">ระดับคะแนน</div>
          ${[5, 4, 3, 2, 1].map(lv => `<div class="legend-row"><i style="background:${LV_COLORS[lv]}"></i>Level ${lv}</div>`).join('')}
          <div class="legend-row"><i style="background:${homeScoreColor(null)}"></i>ยังไม่มีข้อมูล</div>
        </div>
        <div class="home-panel">
          <div class="mini-title">ผลตัวชี้วัดที่สำคัญ</div>
          ${highlightKpis.map(kpi => {
            const s = kpi.isLeaf ? scoreAt(kpi.id, activeQ) : scoreParentAt(kpi.id, activeQ);
            const fc = forecastHomeScore(kpi.id);
            const hasResult = kpi.isLeaf && s.rawValue != null;
            const resultText = hasResult ? `${ovpFmt(s.rawValue)} ${kpi.unit || ''}` : '—';
            const resultPct = hasResult && kpi.target ? Math.max(0, Math.min(100, s.rawValue / kpi.target * 100)) : (s.level !== null ? s.level / 5 * 100 : 0);
            return `
            <div class="hl-kpi" onclick="openQuickDetail('${kpi.id}','${activeQ}')" style="cursor:pointer">
              <div class="hl-kpi-name">${kpi.id} ${HOME_HIGHLIGHT_LABELS[kpi.id]} <span class="hl-kpi-sub">(น้ำหนัก ${kpi.weight})</span></div>
              <div class="hl-kpi-result-row"><span>ผลการดำเนินงาน</span><b>${resultText}</b></div>
              <div class="hl-kpi-bar"><div class="hl-kpi-bar-fill" style="width:${resultPct}%;background:${homeScoreColor(s.level)}"></div></div>
              <div class="hl-kpi-scorebox">
                <div class="hl-kpi-scorerow"><span>คะแนนไตรมาสปัจจุบัน</span><b style="color:${homeScoreColor(s.level)}">${s.level !== null ? s.level.toFixed(4) : '—'}</b></div>
                <div class="hl-kpi-scorerow"><span>คาดการณ์สิ้นปี</span><b style="color:${homeScoreColor(fc.level)}">${fc.level !== null ? fc.level.toFixed(4) : '—'}</b></div>
              </div>
            </div>`;
          }).join('')}
          <button class="hl-kpi-more" onclick="goToOverview()">ดูตัวชี้วัดทั้งหมด →</button>
        </div>
      </aside>

      <div class="home-center">
        <div>
          <div class="hero-masthead">
            <div class="hero-mascot"><img src="${MASCOT_HERO_IMG}" alt="PAT-PHET mascot"></div>
            <div class="hero-text">
              <h1>ผลการดำเนินงาน ${PERIOD_LABEL[activeQ]}</h1>
              <p>${heroNarrative(current, TARGET_SCORE)}</p>
            </div>
          </div>
          <div class="instrument-strip">
            <div class="score-card">
              <div class="score-card-label">คะแนนรอบ ${PERIOD_LABEL[activeQ]}</div>
              <div class="score-card-val" style="color:${lvColor(current)}">${current !== null ? current.toFixed(4) : '—'}<span class="score-of">/5</span></div>
              <div class="score-bar"><div class="score-bar-fill" style="width:${current ? current / 5 * 100 : 0}%;background:${lvColor(current)}"></div></div>
              <div class="score-card-sub">${quarterCoverageText(activeQ)}</div>
            </div>
            <div class="score-card">
              <div class="score-card-label">คะแนนคาดการณ์ภาพรวม</div>
              <div class="score-card-val" style="color:${lvColor(forecast)}">${forecast !== null ? forecast.toFixed(4) : '—'}<span class="score-of">/5</span></div>
              <div class="score-bar"><div class="score-bar-fill" style="width:${forecast ? forecast / 5 * 100 : 0}%;background:${lvColor(forecast)}"></div></div>
              <div class="score-card-sub">${forecast !== null ? (forecast / MASTER_DATA_REFERENCE_FY2569.overallTarget * 100).toFixed(2) + '% เทียบกับเป้าหมายภาพรวม' : ''}</div>
              <div class="score-card-orgref">
                <div class="score-card-orgref-row"><span>MOU (60%)</span><b>${MASTER_DATA_REFERENCE_FY2569.mouForecast.toFixed(4)}</b></div>
                <div class="score-card-orgref-row"><span>Enablers (40%)</span><b>${MASTER_DATA_REFERENCE_FY2569.enablersForecast.toFixed(4)}</b></div>
                <div class="score-card-orgref-row"><span>เป้าหมายภาพรวม</span><b>${MASTER_DATA_REFERENCE_FY2569.overallTarget.toFixed(4)}</b></div>
                <div class="score-card-orgref-source">อ้างอิง: ${MASTER_DATA_REFERENCE_FY2569.source}</div>
              </div>
            </div>
            <div class="score-card">
              <div class="score-card-label">คะแนนเป้าหมาย</div>
              <div class="score-card-val" style="color:var(--home-level-5)">${TARGET_SCORE.toFixed(4)}<span class="score-of">/5</span></div>
              <div class="score-bar"><div class="score-bar-fill" style="width:100%;background:var(--home-green)"></div></div>
            </div>
          </div>
        </div>

        <div class="home-panel">
          <div class="card-title">ความก้าวหน้า</div>
          <div class="trail-chart" id="trail"></div>
        </div>

        <div class="home-panel heatmap-panel grow">
          <div class="home-heat-head"><div class="card-title">Heat Map</div><div id="filterbar" class="home-filter-status" aria-live="polite"><span>${filterState.quarter ? Q_LABEL[filterState.quarter] : ''} ${[...filterState.levelSet].map(lv => 'ระดับ '+lv).join(', ')}</span><button class="clear-btn" onclick="clearFilter()" ${!filterState.levelSet.size && !filterState.quarter ? 'disabled' : ''}>ล้างตัวกรอง</button></div></div>
          <div id="heatmap"></div>
          <div class="hm-legend">
            ${[1, 2, 3, 4, 5].map(lv => `<span class="hm-legend-item" onclick="toggleLevelFilter(${lv})" style="cursor:pointer;${filterState.levelSet.has(lv) ? 'font-weight:700' : ''}"><i style="background:${LV_COLORS[lv]}"></i>Level ${lv}</span>`).join('')}
            <span class="hm-legend-item"><i style="background:${homeScoreColor(null)}"></i>ยังไม่มีข้อมูล</span>
          </div>
        </div>

        <div class="bottom-row">
          <div class="home-panel">
            <div class="bottom-head">
              <div class="mini-title" style="margin-bottom:0">สรุปผลการดำเนินงาน</div>
              <div class="bottom-qtabs">${QUARTERS.map(q => `<button data-q="${q}" class="${q === activeQ ? 'active' : ''}" onclick="setBottomQuarter('${q}')">${Q_LABEL[q]}</button>`).join('')}</div>
            </div>
            <div id="summaryBox"></div>
          </div>
          <div class="home-panel">
            <div class="bottom-head">
              <div class="mini-title" style="margin-bottom:0">ประเด็นที่ควรเร่งรัดเพื่อยกระดับคะแนน</div>
            </div>
            <div id="priorityBox"></div>
            <button class="cta-btn" onclick="goToActionPlan()">ดูแผนการดำเนินการ →</button>
          </div>
        </div>
      </div>

      <aside class="ledger-col">
        <div class="home-panel">
          <div class="mini-title">ประเด็นที่ควรติดตาม</div>
          <div id="issues"></div>
        </div>
      </aside>
    </div>
  `;
  renderTrail(activeQ);
  renderHeatmap();
  renderIssues();
  renderSummaryBox(bottomQ || activeQ, overallScoreAt(bottomQ || activeQ));
  renderPriorityBox(bottomQ || activeQ);
}

function renderSummaryBox(activeQ, current) {
  const el = document.getElementById('summaryBox');
  const qs = ['q1','q2','q3','q4'];
  const prevQ = qs[qs.indexOf(activeQ)-1];
  const prev = prevQ ? overallScoreAt(prevQ) : null;
  const complete = !quarterCoverageText(activeQ).includes('ยังไม่ครบ') && (!prevQ || !quarterCoverageText(prevQ).includes('ยังไม่ครบ'));
  const delta = complete && current !== null && prev !== null ? current-prev : null;
  const dist = levelDistribution(activeQ);
  const keys = [1,2,3,4,5,'none'];
  const total = keys.reduce((n,k)=>n+dist[k],0);
  const dominant = [1,2,3,4,5].reduce((a,b)=>dist[b]>dist[a]?b:a,1);
  const insight = dist.none === total ? 'ยังไม่มีข้อมูลผลการประเมินในไตรมาสนี้' : `ตัวชี้วัดกระจุกตัวมากที่สุดที่ Level ${dominant} (${dist[dominant]} ตัว) · Level 1 มี ${dist[1]} ตัวที่ควรติดตาม`;
  const label = k => k === 'none' ? 'ไม่มีข้อมูล' : 'Level '+k;
  const color = k => homeScoreColor(k === 'none' ? null : k);
  el.innerHTML = `<div class="executive-movement" style="color:${delta === null || delta === 0 ? 'var(--home-text-2)' : delta>0 ? LV_COLORS[5] : LV_COLORS[1]}">${delta === null ? (!complete ? 'ข้อมูลยังไม่ครบสำหรับเปรียบเทียบคะแนนระหว่างไตรมาส' : current === null ? 'ยังไม่มีคะแนนสำหรับเปรียบเทียบ' : 'ไตรมาสแรกของปี · ยังไม่มีไตรมาสก่อนหน้าให้เปรียบเทียบ') : `${delta>0?'▲':delta<0?'▼':'—'} ${Math.abs(delta).toFixed(4)} เทียบ ${Q_LABEL[prevQ]}`}</div>
    <div class="executive-insight">${insight}</div>
    <div class="executive-bar" role="img" aria-label="${keys.map(k=>dist[k]+' '+label(k)).join(', ')}">${keys.filter(k=>dist[k]>0).map(k=>`<span style="width:${total?dist[k]/total*100:0}%;background:${color(k)}" title="${dist[k]} ${label(k)}"></span>`).join('')}</div>
    <div class="executive-counts">${keys.map(k=>`<span><i style="background:${color(k)}"></i><b>${dist[k]}</b> ${label(k)}</span>`).join('')}</div>`;
}

function renderPriorityBox(activeQ) {
  const el = document.getElementById('priorityBox');
  const items = priorityKpis(activeQ);
  el.innerHTML = items.length
    ? items.map(({ kpi, s }) => `
        <div class="priority-item" onclick="openQuickDetail('${kpi.id}','${activeQ}')">
          <span class="priority-lv" style="background:${lvColor(s.level)}22;color:${lvColor(s.level)}">${s.level.toFixed(1)}</span>
          <span class="priority-label"><b>${kpi.id}</b> ${kpi.label}</span>
        </div>`).join('')
    : '<div class="empty-note">ไม่มี KPI ที่ต้องเร่งรัดในไตรมาสนี้</div>';
}

// 6 equal tick columns: Q1, Q2, Q3, Q4, เป้าหมาย, คาดการณ์ — matches RDE_MOU69
// "Page 1_Home" mockup, where Target sits on the trajectory and Forecast is its
// open, real (overallForecastScore) end-of-year endpoint.
const TRAIL_QX = [8.333, 25, 41.667, 58.333, 75, 91.667];
function renderTrail(activeQ) {
 const qs=['q1','q2','q3','q4'];
 document.getElementById('trail').innerHTML=`<div class="quarter-scores">${qs.map(q=>{
 const v=overallScoreAt(q);
 return `<button class="quarter-score ${v===null?'empty':''} ${q===activeQ?'current':''}" onclick="toggleQuarterFilter('${q}')"><span>${Q_LABEL[q]}</span><strong>${v===null?'—':v.toFixed(4)}</strong><small>${v===null?'ยังไม่มีข้อมูล':quarterCoverageText(q).includes('ยังไม่ครบ')?'คะแนนจากข้อมูลที่มี':'คะแนนผลจริง'}</small>${q===activeQ?`<img src="${MASCOT_RUN_IMG}" alt="ไตรมาสปัจจุบัน">`:''}</button>`;
 }).join('')}</div><div class="quarter-reference">ค่าอ้างอิงสิ้นปี · เป้าหมายภาพรวม <b>${MASTER_DATA_REFERENCE_FY2569.overallTarget.toFixed(4)}</b> · คาดการณ์ภาพรวม <b>${overallOrgForecastScore()===null?'ยังไม่มีข้อมูล':overallOrgForecastScore().toFixed(4)}</b></div>`;
}

const HM_GROUPS = [
  { id: '1.1', label: '1.1', children: ['1.1.1', '1.1.2'] },
  { id: '1.2', label: '1.2', children: ['1.2'] },
  { id: '1.34', label: '1.3/1.4', children: ['1.3', '1.4'] },
  { id: '2.1', label: '2.1', children: ['2.1.1', '2.1.2', '2.1.3'] },
  { id: '2.2', label: '2.2', children: ['2.2'] },
  { id: '2.34', label: '2.3/2.4', children: ['2.3', '2.4'] },
  { id: '2.5', label: '2.5', children: ['2.5.1', '2.5.2'] },
  { id: '2.6', label: '2.6', children: ['2.6'] },
  { id: '2.7', label: '2.7', children: ['2.7.1', '2.7.2', '2.7.3.1', '2.7.3.2', '2.7.4'] },
  { id: '2.8', label: '2.8', children: ['2.8.1', '2.8.2', '2.8.3'] },
];
const HM_ROWS = ['forecast', 'q4', 'q3', 'q2', 'q1'];

// Column-group bands (ยุทธศาสตร์/การเงิน/... per RDE_MOU69 mockup), derived from each
// group's own real kpi.groupLabel — never hardcoded, so it always matches MOU_DATA.
function hmCategoryBands() {
  const bands = [];
  for (const g of HM_GROUPS) {
    const label = MOU_DATA.kpis[g.children[0]].groupLabel || '';
    const span = g.children.length;
    if (bands.length && bands[bands.length - 1].label === label) bands[bands.length - 1].span += span;
    else bands.push({ label, span });
  }
  return bands;
}

// Four filter pills = the same Level 1-5 legend, grouped into the mockup's
// "เสี่ยง / ต่ำกว่าเป้าหมาย / เป็นไปตามเป้าหมาย / สูงกว่าเป้าหมาย" bands.
const HM_PILL_GROUPS = [
  { levels: [1], label: 'เสี่ยง', color: 'var(--home-brand-red)' },
  { levels: [2, 3], label: 'ต่ำกว่าเป้าหมาย', color: 'var(--home-coral)' },
  { levels: [4], label: 'เป็นไปตามเป้าหมาย', color: 'var(--home-green)' },
  { levels: [5], label: 'สูงกว่าเป้าหมาย', color: 'var(--home-level-5)' },
];

function renderHeatmap() {
  const el = document.getElementById('heatmap');
  const activeQ = systemActiveQuarter();
  const dist = levelDistribution(activeQ);

  let html = '<div class="hm-pills">';
  for (const g of HM_PILL_GROUPS) {
    const count = g.levels.reduce((s, lv) => s + dist[lv], 0);
    const on = g.levels.every(lv => filterState.levelSet.has(lv));
    html += `<button class="hm-pill ${on ? 'on' : ''}" style="background:${g.color}" onclick="toggleLevelGroupFilter([${g.levels}])">${g.label} <b>${count}</b></button>`;
  }
  html += '</div>';

  html += '<div class="hm-grid">';
  html += '<div class="hm-corner"></div>';
  for (const b of hmCategoryBands()) {
    html += `<div class="hm-cathead" style="grid-column:span ${b.span}">${b.label}</div>`;
  }
  html += '<div class="hm-corner"></div>';
  for (const g of HM_GROUPS) {
    html += `<div class="hm-colhead" style="grid-column:span ${g.children.length}">${g.label}</div>`;
  }
  for (const row of HM_ROWS) {
    html += `<div class="hm-rowhead ${filterState.quarter === row ? 'active' : ''}" onclick="toggleQuarterFilter('${row}')">${Q_LABEL[row]}</div>`;
    for (const g of HM_GROUPS) {
      for (const kpiId of g.children) {
        const kpi = MOU_DATA.kpis[kpiId];
        let s;
        if (row === 'forecast') {
          const fc = MOU_DATA.forecast[kpiId];
          const humanChosen = ['qualitative', 'evidence', 'milestone_manual'].includes(kpi.scoringMethod);
          s = fc ? scoreLeafKPI(kpi, humanChosen ? fc.score : fc.result, 'forecast') : { level: null };
        } else {
          s = scoreAt(kpiId, row);
        }
        const match = kpiMatchesFilter(kpiId);
        const dim = filterState.levelSet.size > 0 && !match;
        html += `<div class="hm-cell ${s.level === null ? 'no-data' : ''} ${dim ? 'dim' : ''}" style="background:${s.level !== null ? homeScoreColor(s.level) : homeScoreColor(null)}" title="${kpiId} ${Q_LABEL[row]}: ${s.level !== null ? s.level.toFixed(2) : 'ยังไม่มีข้อมูล'}" onclick="openQuickDetail('${kpiId}','${row}')"></div>`;
      }
    }
  }
  html += '</div>';
  const cols = HM_GROUPS.reduce((s, g) => s + g.children.length, 0);
  el.innerHTML = html;
  el.querySelector('.hm-grid').style.gridTemplateColumns = `56px repeat(${cols}, minmax(18px, 1fr))`;
}

function openQuickDetail(kpiId, q) {
  const kpi = MOU_DATA.kpis[kpiId];
  const s = q === 'forecast' ? forecastHomeScore(kpiId) : (kpi.isLeaf ? scoreAt(kpiId,q) : scoreParentAt(kpiId,q));
  const ded = MOU_DATA.deductions.find(d => d.kpi === kpiId || kpiId.startsWith(d.kpi));
  const owner = kpi.ownerMain[0] || kpi.ownerWatch[0] || '—';
  const overlay = document.getElementById('quickDetailOverlay');
  overlay.innerHTML = `
    <div class="qd-modal">
      <div class="qd-head">
        <div><b>${kpiId}</b> — ${kpi.label}</div>
        <button class="qd-close" onclick="closeQuickDetail()">&times;</button>
      </div>
      <div class="qd-body">
        <div class="qd-row"><span>ไตรมาส</span><b>${Q_LABEL[q]}</b></div>
        <div class="qd-row"><span>ผลจริง</span><b>${q !== 'forecast' && kpi.isLeaf ? reportValueText(kpiId,q) : entryEsc(String(s.rawValue ?? 'ยังไม่มีข้อมูล'))}</b></div>
        <div class="qd-row"><span>คะแนน</span><b style="color:${lvColor(s.level)}">${s.level !== null ? s.level.toFixed(4) : '—'}</b></div>
        <div class="qd-row"><span>น้ำหนัก</span><b>${kpi.weight}</b></div>
        <div class="qd-row"><span>คะแนนถ่วงน้ำหนัก</span><b>${s.weightedValue !== null ? s.weightedValue.toFixed(4) : '—'}</b></div>
        <div class="qd-row"><span>ผู้รับผิดชอบ</span><b>${owner}</b></div>
        ${reportSummaryHtml(kpiId,q)}
        <button class="cta-btn" onclick="openDetailAt('${kpiId}','${q}')">ดูรายละเอียดไตรมาสนี้ →</button>
        ${ded ? `<div class="qd-warn">⚠ เงื่อนไขหักคะแนน: ${ded.reason}<br>สถานะ: ${ded.status}</div>` : ''}
        ${kpi.needsConfirmation ? `<div class="qd-warn">🔺 ${kpi.confirmationNote}</div>` : ''}
        ${(() => {
          if (typeof computeManagementStatus !== 'function') return '';
          const mgmt = computeManagementStatus(kpiId, q);
          if (!mgmt) return '';
          return `<div class="entry-mgmt-badge tone-${mgmt.tone}" style="margin-top:10px">สถานะเชิงบริหาร: ${mgmt.label} — คะแนนตาม MOU และสถานะเชิงบริหารเป็นคนละมิติกัน (ดู §13)</div>`;
        })()}
      </div>
    </div>
  `;
  overlay.classList.add('open');
}
function closeQuickDetail() {
  const overlay = document.getElementById('quickDetailOverlay');
  overlay.classList.remove('open');
  overlay.innerHTML = ''; // drop stale content/handlers (e.g. entry.js's confirm-modal reuse)
}

function renderIssues() {
  const el = document.getElementById('issues');
  const activeQ = filterState.quarter || systemActiveQuarter();
  const urgent = priorityKpis(activeQ, 99); // same "ต้องเร่ง" definition as the bottom priority box
  const MAX_SHOWN = 5;

  // always-visible colored watch-cards, per RDE_MOU69 mockup's "ประเด็นที่ควรติดตาม"
  function card(color, title, count, items, emptyText) {
    const shown = items.slice(0, 1).join('');
    const more = '';
    return `
      <div class="watch-card">
        <div class="watch-card-head" style="background:${color}">
          <span>${title}</span><b>${count}</b>
        </div>
        <div class="watch-card-body">${items.length ? shown + more : `<div class="empty-note">${emptyText}</div>`}<button class="issue-all" onclick="openHomeIssueList(this)">ดูทั้งหมด (${count})</button><template class="issue-full">${items.join('') || emptyText}</template></div>
      </div>`;
  }

  const html =
    card('var(--home-brand-red)', 'KPI ที่ต้องเร่งผล', urgent.length,
      urgent.map(({ kpi, s }) => `<div class="issue-item" onclick="openQuickDetail('${kpi.id}','${activeQ}')"><b>${kpi.id}</b> — <b>${kpi.label}</b><div class="issue-status">คะแนน ${s.level.toFixed(2)}</div></div>`),
      'ไม่มี KPI ที่ต้องเร่งรัดในไตรมาสนี้') +
    card('var(--home-coral)', 'เงื่อนไขหักคะแนน', MOU_DATA.deductions.length,
      MOU_DATA.deductions.map(d => `<div class="issue-item"><b>${d.kpi}</b> — ${d.reason}<div class="issue-status">${d.status}</div></div>`),
      'ไม่มีรายการ') +
    card('var(--home-amber)', 'ประเด็นมอบหมายจากที่ประชุม', MOU_DATA.assignments.length,
      MOU_DATA.assignments.map(a => `<div class="issue-item"><b>${a.kpi}</b> — ${a.note}</div>`),
      'ไม่มีรายการ');

  el.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// OVERVIEW — "ภาพรวมตัวชี้วัดทั้งหมด" (12 main KPIs 1.1-1.4 / 2.1-2.8, per RDE Mockup)
// Every number still comes from scoreAt/scoreParentAt/MOU_DATA — this file only
// lays the data out; it never re-derives a score.
// ═══════════════════════════════════════════════════════════
const OVP_MAIN_IDS = ['1.1', '1.2', '1.3', '1.4', '2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7', '2.8'];

const ovpState = { quarter: null, quick: 'all', group: '', ownerWatch: '', ownerSupport: '', search: '', expanded: new Set() };

// ═══════════════════════════════════════════════════════════
// DETAIL — shared confirmed records for all KPI types; preserve the approved 2.4 layout.
// ═══════════════════════════════════════════════════════════
let detailRouteKpiId = '2.4';
let dtlQuarter = 'q3'; // Source-backed detail pilot; other pages retain their current dataset.

const DETAIL_SECTIONS = [
  { key: 'strategy', title: 'ตัวชี้วัดตามยุทธศาสตร์', ids: ['1.1', '1.2', '1.3', '1.4'] },
  { key: 'soe', title: 'ผลการดำเนินงานของรัฐวิสาหกิจ', children: [
      { key: 'fin', title: 'ด้านการเงิน', ids: ['2.1', '2.2'] },
      { key: 'nonfin', title: 'ด้านที่ไม่ใช่การเงิน', ids: ['2.3', '2.4', '2.5', '2.6', '2.7', '2.8'] },
  ] },
];
const dtlSectionCollapsed = new Set();
const dtlNodeExpanded = new Set();

const NOT_RECORDED = 'ยังไม่ได้บันทึกข้อมูลนี้';
const NOT_ATTACHED = 'ยังไม่มีเอกสารแนบ';
const DTL_MONTH_LABEL = { m1: 'ต.ค.', m2: 'พ.ย.', m3: 'ธ.ค.', m4: 'ม.ค.', m5: 'ก.พ.', m6: 'มี.ค.', m7: 'เม.ย.', m8: 'พ.ค.', m9: 'มิ.ย.', m10: 'ก.ค.', m11: 'ส.ค.', m12: 'ก.ย.' };
const DTL_MONTH_KEYS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12'];

function dtlGoTo(id) { detailRouteKpiId = id; dtlQuarter = dtlQuarter || systemActiveQuarter(); renderDetail(); }
function dtlSetQuarter(q) { dtlQuarter = q; renderDetail(); }
function dtlToggleSection(key) { if (dtlSectionCollapsed.has(key)) dtlSectionCollapsed.delete(key); else dtlSectionCollapsed.add(key); renderDetail(); }
function dtlToggleNode(id) { if (dtlNodeExpanded.has(id)) dtlNodeExpanded.delete(id); else dtlNodeExpanded.add(id); renderDetail(); }

function dtlAncestorChain(id) {
  const chain = [];
  let cur = MOU_DATA.kpis[id];
  while (cur && cur.parent) { chain.push(cur.parent); cur = MOU_DATA.kpis[cur.parent]; }
  return chain;
}
function dtlIsNodeExpanded(id) {
  return dtlNodeExpanded.has(id) || dtlAncestorChain(detailRouteKpiId || '').includes(id);
}

function dtlNodeHtml(kpiId, activeId, depth) {
  const kpi = MOU_DATA.kpis[kpiId];
  if (!kpi) return '';
  const kids = ovpChildren(kpiId);
  const hasKids = kids.length > 0;
  const expanded = hasKids && dtlIsNodeExpanded(kpiId);
  const isActive = kpiId === activeId;
  const q = dtlQuarter;
  const s = kpiId === '2.4' ? dtl24Score(q) : kpi.isLeaf ? scoreAt(kpiId, q) : scoreParentAt(kpiId, q);
  const chip = s.level !== null ? `<span class="dtl-score-chip" style="background:${lvColor(s.level)}">${s.level.toFixed(2)}</span>` : '';
  const caret = hasKids
    ? `<span class="dtl-caret" onclick="event.stopPropagation();dtlToggleNode('${kpiId}')">${expanded ? '▾' : '▸'}</span>`
    : `<span class="dtl-caret"></span>`;
  let html = `<div class="dtl-node ${depth > 0 ? 'dtl-node-child' : ''} ${isActive ? 'active' : ''}" style="padding-left:${6 + depth * 12}px" onclick="dtlGoTo('${kpiId}')">
    ${caret}<span class="dtl-node-id">${kpiId}</span><span class="dtl-node-label">${kpi.label}</span>${chip}
  </div>`;
  if (hasKids && expanded) kids.forEach(c => { html += dtlNodeHtml(c.id, activeId, depth + 1); });
  return html;
}

function dtlSectionHtml(section, activeId) {
  const collapsed = dtlSectionCollapsed.has(section.key);
  let body = '';
  if (!collapsed) {
    body = section.ids
      ? section.ids.map(id => dtlNodeHtml(id, activeId, 0)).join('')
      : section.children.map(sub => dtlSectionHtml(sub, activeId)).join('');
  }
  return `<div class="dtl-section">
    <div class="dtl-sec-title" onclick="dtlToggleSection('${section.key}')">${collapsed ? '▸' : '▾'} ${section.title}</div>
    <div class="dtl-sec-body">${body}</div>
  </div>`;
}
function dtlSidebarHtml(activeId) { return DETAIL_SECTIONS.map(s => dtlSectionHtml(s, activeId)).join(''); }

// Friendly illustrated-avatar palette; colors cycle by a stable hash of the
// person's name so the same person always gets the same color across renders.
const DTL_AVATAR_COLORS = ['#4f7cab', '#3fa66d', '#e0982c', '#d9678c', '#8a6fc9', '#3f9fa6'];
const DTL_AVATAR_ICON = '<svg class="dtl-avatar-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="#fff"/><path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7v1H4v-1z" fill="#fff"/></svg>';
function dtlAvatarColor(name) {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return DTL_AVATAR_COLORS[h % DTL_AVATAR_COLORS.length];
}
function dtlPersonHtml(name) {
  return `<div class="dtl-person">
    <div class="dtl-avatar" style="background:${dtlAvatarColor(name)}">${DTL_AVATAR_ICON}</div>
    <div class="dtl-owner-name">${name}</div>
  </div>`;
}
function dtlOwnersHtml(kpi) {
  // Presentation hierarchy per confirmed spec: กำกับดูแล = most prominent,
  // หลัก = secondary, สนับสนุน = compact list. Names are real Master Data owners only.
  const block = (role, list, variant) => `<div class="dtl-owner-card ${variant}">
    <div class="dtl-owner-role">${role}</div>
    <div class="dtl-owner-people">${(list && list.length) ? list.map(p => dtlPersonHtml(p)).join('') : '<div class="dtl-owner-name" style="color:var(--text3);font-style:italic">—</div>'}</div>
  </div>`;
  return block('ผู้บริหารกำกับดูแล', kpi.ownerWatch, 'primary')
    + block('ผู้รับผิดชอบหลัก', kpi.ownerMain, 'secondary')
    + block('ผู้รับผิดชอบสนับสนุน', kpi.ownerSupport, 'compact');
}

function dtlPlaceholderMain(id) {
  const kpi = MOU_DATA.kpis[id];
  if (!kpi) return `<div class="stub-note">เลือกตัวชี้วัดจากเมนูด้านซ้ายเพื่อดูรายละเอียด</div>`;
  return `<div class="stub-note">ตัวชี้วัด ${kpi.id} — ${kpi.label}<br>ไม่พบข้อมูลตัวชี้วัดนี้</div>`;
}

// All views consume the same confirmed input. Q3/Q4 have no Excel fallback.
function dtl24Input(q) { return getQuarterInput('2.4', q); }
function dtl24Score(q) { return scoreAt('2.4', q); }
function publishedQuarterReport(kpiId, q) {
  // Remote Read: MOU69_DB wins for any KPI it genuinely has a report for, while remote is live
  // this session. No record -> null -> falls through to local entry / Q3 baseline below.
  if (typeof remotePilotGetReport === 'function') {
    const remoteReport = remotePilotGetReport(kpiId, q);
    if (remoteReport) return remoteReport;
  }
  if(q==='q3' && kpiId.startsWith('1.1') && getQuarterInput('1.1.1',q)!==null) {
    // '1.1' itself can also have a remote record (the shared narrative, same as local) -- keep
    // the same remote > local-entry > baseline order as the generic check above.
    const remoteShared = typeof remotePilotGetReport === 'function' ? remotePilotGetReport('1.1', q) : null;
    return remoteShared || getEntry('1.1').publishedReport || (MOU_DATA.quarterlyReports && MOU_DATA.quarterlyReports['1.1']) || null;
  }
  if(q==='q3' && !MOU_DATA.kpis[kpiId]?.isLeaf) { const records=ovpChildren(kpiId).map(k=>[k,publishedQuarterReport(k.id,q)]).filter(x=>x[1]); return records.length?{summary_text:records.map(([k,r])=>k.id+' '+k.label+' · '+(r.summary_text||'')).join('\n'),issue:{obstacle_text:records.map(([k,r])=>r.issue?.obstacle_text?k.id+' '+r.issue.obstacle_text:'').filter(Boolean).join('\n'),solution_text:records.map(([k,r])=>r.issue?.solution_text?k.id+' '+r.issue.solution_text:'').filter(Boolean).join('\n')}}:null; }
  if (q !== 'q3' || typeof getEntry !== 'function' || getQuarterInput(kpiId,q) === null) return null;
  const entry = getEntry(kpiId);
  if (entry.publishedReport) return entry.publishedReport;
  // Existing confirmed sessions keep their values; no draft is promoted.
  if (entry.type === 'numeric' && entry.status === 'confirmed') return {
    monthly:entry.monthly, summary_text:entry.summary_text || '', issue:getIssue(kpiId,q)
  };
  // No local confirmation on this browser at all -- fall back to the frozen Q3 baseline
  // (q3_baseline.js) rather than showing an empty narrative for data that IS actually confirmed.
  if (MOU_DATA.quarterlyReports && MOU_DATA.quarterlyReports[kpiId]) return MOU_DATA.quarterlyReports[kpiId];
  return null;
}
function reportText(kpiId, q, field) {
  const report = publishedQuarterReport(kpiId,q);
  return report ? (field === 'summary_text' ? report.summary_text : report.issue?.[field]) || '' : '';
}
function reportSummaryHtml(kpiId,q) {
  const parts = [['summary_text','สรุปผล'],['obstacle_text','ปัญหา / อุปสรรค'],['solution_text','การดำเนินการต่อ']];
  return parts.map(([key,label])=>{const val=reportText(kpiId,q,key);return val ? `<div class="reported-text"><b>${label}:</b> ${entryEsc(val)}</div>` : '';}).join('');
}
function quarterCoverageText(q) {
  const leaves = Object.values(MOU_DATA.kpis).filter(k=>k.isLeaf);
  const n = leaves.filter(k=>getQuarterInput(k.id,q)!==null).length;
  return `มีผล ${n}/${leaves.length} ตัวชี้วัดย่อย` + (n<leaves.length ? ' · คะแนนสะสมจากข้อมูลที่มี ยังไม่ครบไตรมาส' : '');
}
function openDetailAt(kpiId,q) {
  detailRouteKpiId=kpiId; dtlQuarter=QUARTERS.includes(q)?q:systemActiveQuarter();
  closeQuickDetail(); switchTab('detail',document.getElementById('tabBtnDetail'));
}
function dtlMonthlySeries(kpiId) {
  const base = Object.assign({},MOU_DATA.monthly[kpiId]?.components[0]?.months || {});
  // The live report (local entry, or remote KPI_RESULT via remote_data_adapter.js) never carries
  // a monthly breakdown for 2.4 -- only the frozen Q3 baseline (q3_baseline.js quarterlyReports)
  // does. Merge that in first so real Apr-Jun figures show even while remote is authoritative for
  // the quarterly actual/score; a live report's own .monthly (if a future KPI/source ever has one)
  // still wins, same precedence order the rest of this dashboard already uses.
  const baseline = MOU_DATA.quarterlyReports && MOU_DATA.quarterlyReports[kpiId]?.monthly;
  if (baseline) Object.assign(base, baseline);
  const report = publishedQuarterReport(kpiId,'q3');
  if (report?.monthly) Object.assign(base, report.monthly);
  return base;
}
// Standalone Quarter Switcher, extracted above the KPI detail frame (Master Detail pattern).
// Generic on purpose -- `isEvaluatedFn(qq)` lets any future numeric KPI reuse this unchanged.
function dtlQuarterSwitcherHtml(activeQ, isEvaluatedFn) {
  return `<div class="dtl-qswitcher">${QUARTERS.map(qq => {
    const evaluated = isEvaluatedFn(qq);
    return `<button class="dtl-qswitch-btn ${activeQ === qq ? 'active' : ''} ${!evaluated ? 'empty' : ''}" onclick="dtlSetQuarter('${qq}')" aria-pressed="${activeQ === qq}" title="${evaluated ? '' : 'ยังไม่มีผลการประเมิน'}">${Q_LABEL[qq]}</button>`;
  }).join('')}</div>`;
}
function dtl24Main() {
  const NOT_RECORDED = '-', NOT_ATTACHED = '-';
  const kpi = kpiForScoring('2.4');
  const q = dtlQuarter;
  const isEvaluated = dtl24Input(q) !== null;
  const s = isEvaluated ? dtl24Score(q) : { level: null, rawValue: null };
  const fc = MOU_DATA.forecast['2.4'];
  const months = dtlMonthlySeries('2.4');
  const cumulative = isEvaluated ? s.rawValue : null;
  const target = kpi.target;
  const scoreColorNow = s.level !== null ? lvColor(s.level) : LV_COLORS[null];
  const fcScore = fc && fc.score !== null && fc.score !== undefined ? Number(fc.score) : null;
  const scoreColorFc = fcScore !== null ? lvColor(fcScore) : LV_COLORS[null];
  const qd = MOU_DATA.quarterly['2.4'];
  const noteForQuarter = q === 'q3' ? reportText('2.4',q,'summary_text') : (isEvaluated && qd && qd[q]) ? qd[q].note : null;
  const dedItem = MOU_DATA.deductions.find(d => d.kpi === '2.4');
  const assignItem = MOU_DATA.assignments.find(a => a.kpi === '2.4');

  // KPI 2.4's `target` field (10.46) turns out to equal MOU_DATA.forecast['2.4'].result (10.46)
  // exactly -- it is not a distinct annual-target figure, just the forecast under another name
  // (kpi.target is never read by engine.js/scoreLeafKPI either -- purely a display field). Per the
  // Round-4 brief §5, the "เป้าหมาย" shown up top uses the Level-5 MOU threshold instead, since
  // that IS the real highest scoring bar for this KPI. `target` itself is left as-is below (still
  // feeds the untouched Quarterly Comparison table's "% เทียบเป้าหมายสิ้นปี" column this round).
  const displayTarget = kpi.thresholds[4];
  // "ประเภทของตัวชี้วัด" must read exactly like Home's Heat Map, which bands KPIs by their own real
  // kpi.groupLabel (see hmCategoryBands() above -- "never hardcoded, so it always matches
  // MOU_DATA"). Reusing that same field here, not inventing a separate Detail-only category.
  const kpiTypeLabel = kpi.groupLabel || '-';
  const mainUnit = (kpi.ownerMain || []).join(', ') || '-';

  const monthCount = q === 'q1' ? 3 : q === 'q2' ? 6 : q === 'q3' ? 9 : 12;
  const monthEndLabel = { q1: 'ธ.ค.', q2: 'มี.ค.', q3: 'มิ.ย.', q4: 'ก.ย.' }[q] || 'มี.ค.';

  // Performance Bar: no markers at all this round (brief Round-7 §5) -- the track itself IS the
  // Target (0 -> displayTarget = 100%), fill = Actual on that same axis. Forecast/Target numbers
  // already live in the 3-column metrics above; the bar's only job is Actual-vs-Target at a glance.
  const actualBarPct = (isEvaluated && cumulative !== null) ? Math.min(100, (cumulative / displayTarget) * 100) : 0;

  // Monthly data: a plain 12-column row, always all 12 months so the layout never reflows between
  // quarters. A month only shows a real value when it both (a) falls within the SELECTED quarter's
  // reporting range and (b) actually has data in `months` -- never estimated/interpolated.
  const monthlyRow = DTL_MONTH_KEYS.map((mk, i) => {
    const v = (i < monthCount && months && months[mk] !== undefined && months[mk] !== null) ? months[mk] : null;
    return `<div class="dtl-monthly-cell"><span class="dtl-monthly-month">${DTL_MONTH_LABEL[mk]}</span><span class="dtl-monthly-val">${v !== null ? v.toLocaleString('en-US', { maximumFractionDigits: 3 }) : '-'}</span></div>`;
  }).join('');

  // Trend / Observation -- one short line built only from real figures already on this page:
  // direction vs the prior quarter, and where cumulative/forecast sit against the Level-1/Level-5
  // MOU thresholds. This is the "increasing, but still below Level 1" story the brief asks for.
  const priorQForTrend = { q1: null, q2: 'q1', q3: 'q2', q4: 'q3' }[q];
  const priorCum = priorQForTrend && dtl24Input(priorQForTrend) !== null ? dtl24Score(priorQForTrend).rawValue : null;
  const trendDir = (cumulative !== null && priorCum !== null) ? (cumulative > priorCum ? 'เพิ่มขึ้น' : cumulative < priorCum ? 'ลดลง' : 'ทรงตัว') : null;
  const lvl1 = kpi.thresholds[0], lvl5 = kpi.thresholds[4];
  let trendText = '-';
  if (isEvaluated) {
    let sentence = trendDir ? `ผลการดำเนินงาน${trendDir}ต่อเนื่อง` : '';
    if (cumulative !== null) {
      if (cumulative < lvl1) sentence += (sentence ? ' แต่' : '') + `ผลสะสมปัจจุบันยังไม่ถึงเกณฑ์ระดับ 1 (${ovpFmt(lvl1)} ${kpi.unit || ''})`;
      else if (cumulative >= lvl5) sentence += (sentence ? ' แต่' : '') + `ผลสะสมปัจจุบันถึงเกณฑ์ระดับ 5 แล้ว`;
    }
    if (fc && fc.result !== null && fc.result !== undefined) {
      if (fc.result > lvl5) sentence += (sentence ? ' ขณะที่' : '') + `คาดการณ์สิ้นปีสูงกว่าเกณฑ์ระดับ 5 (${ovpFmt(lvl5)} ${kpi.unit || ''})`;
      else if (fc.result < lvl1) sentence += (sentence ? ' ขณะที่' : '') + `คาดการณ์สิ้นปียังต่ำกว่าเกณฑ์ระดับ 1`;
    }
    trendText = sentence || '-';
  }

  const qRows = ['q1', 'q2', 'q3', 'q4'].map(qq => {
    const evaluated = dtl24Input(qq) !== null;
    const rs = evaluated ? dtl24Score(qq) : null;
    const cum = evaluated ? rs.rawValue : null;
    const priorQ = {q2:'q1',q3:'q2',q4:'q3'}[qq];
    const prior = priorQ ? dtl24Input(priorQ) : 0;
    const qResult = evaluated && prior !== null ? cum - prior : null;
    const pct = (cum !== null && target) ? (cum / target * 100) : null;
    const rowClass = qq === q ? 'current-q' : '';
    if (!evaluated) {
      return `<tr class="${rowClass}">
        <td>${Q_LABEL[qq]}</td>
        <td colspan="2"><span class="ovp-cell-missing" title="ยังไม่มีผลที่ยืนยันในไตรมาสนี้">—</span></td>
        <td>${ovpBadge(null)}</td>
        <td>${ovpBadge(kpi.targetScore)}</td>
      </tr>`;
    }
    return `<tr class="${rowClass}">
      <td>${Q_LABEL[qq]}</td>
      <td>${cum !== null ? cum.toLocaleString('en-US', { maximumFractionDigits: 3 }) : '-'} ${kpi.unit || ''}<div style="font-size:12px;color:var(--text3)">ผลเฉพาะไตรมาสนี้: ${qResult !== null ? qResult.toLocaleString('en-US', { maximumFractionDigits: 3 }) : '-'}</div></td>
      <td>${pct !== null ? pct.toFixed(2) + '%' : '-'}</td>
      <td>${ovpBadge(rs.level)}</td>
      <td>${ovpBadge(kpi.targetScore)}</td>
    </tr>`;
  }).join('');

  const fmt = v => v === null || v === undefined ? '-' : ovpFmt(v);
  // Approved analytical commentary for the nine-month reporting period only.
  // Calculate from current displayed values so confirmed updates do not leave stale numbers.
  const analysisReady = q === 'q3' && isEvaluated && Number.isFinite(cumulative);
  const remainingToFive = analysisReady ? Math.max(0, displayTarget - cumulative) : null;
  const monthlyNeeded = analysisReady ? remainingToFive / 3 : null;
  const averageMonthly = analysisReady ? cumulative / 9 : null;
  const annualized = analysisReady ? averageMonthly * 12 : null;
  const forecastAvailable = fc && fc.result !== null && fc.result !== undefined && Number.isFinite(Number(fc.result));
  const analysisNumber = v => Number(v).toLocaleString('en-US', {maximumFractionDigits:3});
  let approvedObservation = noteForQuarter || NOT_RECORDED;
  let approvedAction = reportText('2.4',q,'solution_text') || (assignItem && assignItem.note) || NOT_RECORDED;
  if (analysisReady) {
    approvedObservation = `ผลสะสม 9 เดือนอยู่ที่ ${analysisNumber(cumulative)} ล้าน TEU โดยคะแนนปัจจุบันเป็นการเทียบผลระหว่างปีกับเกณฑ์ทั้งปี จึงอยู่ที่ระดับ ${s.level !== null ? s.level.toFixed(4) : '-'} `;
    if (forecastAvailable) {
      const forecastMeetsFive = Number(fc.result) >= displayTarget;
      approvedObservation += `คาดการณ์สิ้นปีอยู่ที่ ${analysisNumber(fc.result)} ล้าน TEU ${forecastMeetsFive ? 'ถึงหรือสูงกว่า' : 'ยังต่ำกว่า'}เกณฑ์ระดับ 5 ที่ ${analysisNumber(displayTarget)} ล้าน TEU `;
      approvedObservation += forecastMeetsFive ? 'จึงคาดว่าจะบรรลุคะแนนระดับ 5 หากผลในช่วงที่เหลือเป็นไปตามประมาณการ' : 'จึงควรติดตามผลในช่วงที่เหลือและทบทวนแนวทางเพื่อบรรลุเกณฑ์ระดับ 5';
    }
    approvedObservation += ` ทั้งนี้ หากรักษาค่าเฉลี่ย ${analysisNumber(averageMonthly)} ล้าน TEU ต่อเดือนตลอดปี จะมีปริมาณประมาณ ${analysisNumber(annualized)} ล้าน TEU (ประมาณจากค่าเฉลี่ย ไม่ปรับฤดูกาล)`;
    approvedAction = remainingToFive > 0
      ? `ติดตามปริมาณตู้สินค้าในไตรมาส 4 ให้สะสมไม่น้อยกว่า ${analysisNumber(remainingToFive)} ล้าน TEU หรือเฉลี่ยประมาณ ${analysisNumber(monthlyNeeded)} ล้าน TEU ต่อเดือน เพื่อบรรลุเกณฑ์ระดับ 5 พร้อมทบทวนประมาณการสิ้นปีตามผลจริงรายเดือน และเตรียมรองรับข้อจำกัดด้านการให้บริการหากพบความเสี่ยง`
      : 'ผลสะสมถึงเกณฑ์ระดับ 5 แล้ว ควรรักษาความต่อเนื่องในการให้บริการ ติดตามผลจริงรายเดือน และตรวจสอบความครบถ้วนของข้อมูลก่อนสรุปผลสิ้นปี';
  }

  const pctActual = isEvaluated ? cumulative / displayTarget * 100 : null;
  const period = {q1:'ต.ค. – ธ.ค. 68',q2:'ม.ค. – มี.ค. 69',q3:'เม.ย. – มิ.ย. 69',q4:'ก.ค. – ก.ย. 69'};
  const points = DTL_MONTH_KEYS.slice(0,monthCount).map((mk,i)=>({i,v:months[mk] === null || months[mk] === undefined ? null : Number(months[mk])}));
  const maxY = Math.max(...points.map(p=>p.v || 0),0.01)*1.2;
  const px = i => 56+i*650/11, py = v => 170-v/maxY*140;
  let path = '', connected = false;
  points.forEach(p=>{if(p.v === null){connected=false;return;}path += `${connected?'L':'M'}${px(p.i)},${py(p.v)} `;connected=true;});
  const chart = `<svg viewBox="0 0 740 212" role="img" aria-label="ผลการดำเนินงานรายเดือน หน่วย ${entryEsc(kpi.unit)}">
    ${[0,1,2,3,4].map(i=>{const y=170-i*35;return `<line x1="56" x2="715" y1="${y}" y2="${y}" stroke="#e9edf0"/><text x="47" y="${y+4}" text-anchor="end">${(maxY*i/4).toFixed(2)}</text>`;}).join('')}
    <path d="${path}" fill="none" stroke="#41a570" stroke-width="3"/>
    ${points.filter(p=>p.v!==null).map(p=>`<circle cx="${px(p.i)}" cy="${py(p.v)}" r="4.5" fill="#41a570"><title>${DTL_MONTH_LABEL[DTL_MONTH_KEYS[p.i]]}: ${fmt(p.v)} ${entryEsc(kpi.unit)}</title></circle>`).join('')}
    ${DTL_MONTH_KEYS.map((mk,i)=>`<text x="${px(i)}" y="199" text-anchor="middle">${DTL_MONTH_LABEL[mk]}</text>`).join('')}
  </svg>`;
  return `
    <div class="fp24-heading"><div><span class="fp24-eyebrow">KPI DETAIL · 2.4</span><h1>รายละเอียดตัวชี้วัด</h1><p>แสดงผลการดำเนินงาน ค่าเป้าหมาย แนวโน้ม และข้อสังเกตในแต่ละไตรมาส</p></div><span class="fp24-year">ปีงบประมาณ 2569</span></div>
    <div class="fp24-grid">
      <section class="fp24-card fp24-info"><h2>ข้อมูลตัวชี้วัด</h2><dl>
        <div><dt>รหัสตัวชี้วัด</dt><dd>2.4</dd></div>
        <div><dt>ชื่อตัวชี้วัด</dt><dd>${entryEsc(kpi.label)}</dd></div>
        <div><dt>ประเภทของตัวชี้วัด :</dt><dd><span class="fp24-type">ประสิทธิภาพการดำเนินงาน</span></dd></div>
        <div><dt>น้ำหนัก / หน่วยวัด</dt><dd>${kpi.weight ?? '-'}% · ${entryEsc(kpi.unit || '-')}</dd></div>
        <div><dt>ผู้รับผิดชอบหลัก</dt><dd>${entryEsc(mainUnit)}</dd></div>
      </dl></section>
      <div class="fp24-top">
        <div class="fp24-quarters" aria-label="เลือกไตรมาส">${QUARTERS.map(qq=>`<button class="${q===qq?'selected':''} ${dtl24Input(qq)===null?'pending':''}" onclick="dtlSetQuarter('${qq}')" aria-pressed="${q===qq}"><b>${qq.toUpperCase()}</b><span>${period[qq]}</span>${dtl24Input(qq)===null?'<small>รอข้อมูล</small>':''}</button>`).join('')}</div>
        <section class="fp24-card fp24-metrics" style="--fp24-score-color:${scoreColorNow}">
          <div><h3>ผลการดำเนินงาน</h3><strong>${isEvaluated?fmt(cumulative):'-'}</strong> <small>${entryEsc(kpi.unit)}</small><p>ผลสะสม ณ ${monthEndLabel} ${q==='q1'?'2568':'2569'}</p></div>
          <div><h3>ค่าเป้าหมายสิ้นปี</h3><strong>${fmt(displayTarget)}</strong> <small>${entryEsc(kpi.unit)}</small><p>เกณฑ์คะแนนระดับ 5</p></div>
          <div><h3>คะแนนที่ได้</h3><strong style="color:${scoreColorNow}">${isEvaluated && s.level!==null?s.level.toFixed(4):'-'}</strong><small> / 5</small><p>${isEvaluated?'คะแนนจากผลสะสม':'รอข้อมูลที่ยืนยัน'}</p></div>
        </section>
      </div>
      <section class="fp24-card fp24-progress"><div class="fp24-card-heading"><h2>ความก้าวหน้าต่อเป้าหมายสิ้นปี (${q.toUpperCase()})</h2><b style="color:${scoreColorNow}">${pctActual===null?'-':pctActual.toFixed(1)+'%'}</b></div><div class="fp24-track"><div style="width:${Math.max(0,actualBarPct)}%;background:${scoreColorNow}"></div></div><div class="fp24-scale"><span>0</span><span>${fmt(displayTarget)} ${entryEsc(kpi.unit)} (เป้าหมาย)</span></div><div class="fp24-thresholds">${kpi.thresholds.map((t,i)=>`<span>ระดับ ${i+1}<b>${fmt(t)}</b></span>`).join('')}</div></section>
      <section class="fp24-card fp24-chart"><h2>แนวโน้มผลการดำเนินงานรายเดือน</h2>${numericMonthlyChart('2.4',q)}</section>
      <section class="fp24-card fp24-notes"><h2>ข้อสังเกตและข้อเสนอแนะ</h2>${analysisReady ? '<span class="fp24-analysis-label">บทวิเคราะห์จากข้อมูล · Q3 / 9 เดือน</span>' : ''}<p>${entryEsc(approvedObservation)}</p>${analysisReady ? `<div class="fp24-required"><span>เฉลี่ย Q4 ที่ต้องทำเพื่อได้ระดับ 5</span><strong>${analysisNumber(monthlyNeeded)} <small>ล้าน TEU/เดือน</small></strong><span>ปริมาณที่ต้องเพิ่มรวม ${analysisNumber(remainingToFive)} ล้าน TEU</span></div>` : ''}<div class="fp24-next"><h3>แนวทางการดำเนินงาน</h3><p>${entryEsc(approvedAction)}</p></div></section>
      <section class="fp24-card fp24-comparison"><h2>เปรียบเทียบรายไตรมาส</h2><div class="fp24-table-scroll"><table class="dtl-qtable"><thead><tr><th>ไตรมาส</th><th>ผลสะสมสิ้นไตรมาส</th><th>% เทียบคาดการณ์สิ้นปี*</th><th>คะแนน</th><th>คะแนนเป้าหมาย</th></tr></thead><tbody>${qRows}</tbody></table></div><p class="fp24-footnote">*ฐานเปรียบเทียบเดิม ${fmt(target)} ${entryEsc(kpi.unit)} · คะแนนใช้เกณฑ์ MOU 1–5</p><div class="dtl-forecast-row"><b>คาดการณ์สิ้นปี</b><span>${fc?fmt(fc.result):'-'} ${entryEsc(kpi.unit)}</span><span>คะแนน ${fcScore!==null?fcScore.toFixed(4):'-'}</span></div></section>
    </div>
    <div class="dtl-section-card">
      <div class="card-title">ข้อมูลสนับสนุน</div>
      <div class="dtl-support-grid">
        <div class="dtl-support-item"><div class="dtl-support-label">เอกสารแนบ</div><div class="dtl-support-val empty">${NOT_ATTACHED}</div></div>
        <div class="dtl-support-item"><div class="dtl-support-label">คำจำกัดความ</div><div class="dtl-support-val">ปริมาณตู้สินค้าที่ผ่าน ทลฉ. ในปีบัญชี 2569</div></div>
        <div class="dtl-support-item" style="grid-column:1/-1"><div class="dtl-support-label">วิธีการคำนวณ</div><div class="dtl-support-val">ปริมาณตู้สินค้า ได้แก่ ตู้มีสินค้าและตู้เปล่าจากการขนส่งตู้สินค้าระหว่างประเทศ การขนส่งตู้สินค้าในประเทศและการขนส่งตู้สินค้าชายฝั่งที่เข้าสู่ระบบ Shift Mode ของ ทลฉ. ในปีบัญชี 2569</div></div>
        <div class="dtl-support-item" style="grid-column:1/-1"><div class="dtl-support-label">วิธีคำนวณคะแนน</div><div class="dtl-support-val">คะแนนคำนวณเทียบเกณฑ์ 1–5 แบบเชิงเส้น โดยจำกัดช่วงคะแนน 1–5 · ผลเฉพาะไตรมาส = ผลสะสมไตรมาสนี้ − ผลสะสมไตรมาสก่อน</div></div>
        <div class="dtl-support-item" style="grid-column:1/-1"><div class="dtl-support-label">ประวัติการปรับปรุงเกณฑ์คะแนน 1–5</div><div class="dtl-support-val ${kpi.criteriaRevisionNote ? '' : 'empty'}">${kpi.criteriaRevisionNote ? `มีการปรับค่าเกณฑ์ตามมติคณะกรรมการ กทท. เมื่อวันที่ ${kpi.criteriaBoardApprovalDate || '-'} — ${kpi.criteriaRevisionNote}` : '-'}</div></div>
      </div>
    </div>

    <div class="dtl-section-card">
      <div class="card-title">ประเด็นที่ต้องปรับปรุง/เฝ้าระวัง</div>
      <div class="dtl-support-grid">
        <div class="dtl-support-item"><div class="dtl-support-label">ปัญหา / อุปสรรค</div><div class="dtl-support-val ${dedItem ? '' : 'empty'}">${q === 'q3' ? entryEsc(reportText('2.4',q,'obstacle_text')) || NOT_RECORDED : dedItem ? dedItem.reason : NOT_RECORDED}</div></div>
        <div class="dtl-support-item"><div class="dtl-support-label">แนวทางแก้ไข / การดำเนินการต่อ</div><div class="dtl-support-val ${assignItem ? '' : 'empty'}">${q === 'q3' ? entryEsc(reportText('2.4',q,'solution_text')) || NOT_RECORDED : assignItem ? assignItem.note : NOT_RECORDED}</div></div>
      </div>
    </div>

    <div class="dtl-section-card">
      <div class="card-title">หมายเหตุเพิ่มเติม</div>
      <div class="dtl-support-grid">
        <div class="dtl-support-item"><div class="dtl-support-label">หมายเหตุผลการดำเนินงาน (${Q_LABEL[q]})</div><div class="dtl-support-val ${noteForQuarter ? '' : 'empty'}">${entryEsc(noteForQuarter || '') || (isEvaluated ? NOT_RECORDED : '-')}</div></div>
        <div class="dtl-support-item"><div class="dtl-support-label">คำอธิบายการคาดการณ์</div><div class="dtl-support-val ${fc && fc.note ? '' : 'empty'}">${(fc && fc.note) || NOT_RECORDED}</div></div>
      </div>
    </div>
  `;
}

// KPI 2.4 only: keep the navigation preference across quarter changes.
let fp24SidebarHidden = false;
function fp24ToggleSidebar() {
  fp24SidebarHidden = !fp24SidebarHidden;
  const layout = document.getElementById('fp24-layout');
  const sidebar = document.getElementById('fp24-sidebar');
  const button = document.getElementById('fp24-sidebar-toggle');
  if (!layout || !sidebar || !button) return;
  layout.classList.toggle('sidebar-hidden', fp24SidebarHidden);
  sidebar.hidden = fp24SidebarHidden;
  button.setAttribute('aria-expanded', String(!fp24SidebarHidden));
  button.innerHTML = `<span aria-hidden="true">${fp24SidebarHidden ? '☷' : '‹'}</span> ${fp24SidebarHidden ? 'เปิดรายการตัวชี้วัด' : 'ซ่อนรายการตัวชี้วัด'}`;
}

function renderDetail() {
  const root = document.getElementById('page-detail');
  if (!root) return;
  const activeId = detailRouteKpiId;
  if (MOU_DATA.kpis[activeId]) {
    root.innerHTML = `<div class="fp24-page">
      <div class="fp24-toolbar"><button type="button" id="fp24-sidebar-toggle" aria-controls="fp24-sidebar" aria-expanded="${!fp24SidebarHidden}" onclick="fp24ToggleSidebar()"><span aria-hidden="true">${fp24SidebarHidden ? '☷' : '‹'}</span> ${fp24SidebarHidden ? 'เปิดรายการตัวชี้วัด' : 'ซ่อนรายการตัวชี้วัด'}</button><span>กำลังดู <b>${entryEsc(activeId)}</b> · ${entryEsc(MOU_DATA.kpis[activeId].label)}</span></div>
      <div id="fp24-layout" class="fp24-layout ${fp24SidebarHidden ? 'sidebar-hidden' : ''}">
        <aside id="fp24-sidebar" class="fp24-sidebar" aria-label="รายการตัวชี้วัด" ${fp24SidebarHidden ? 'hidden' : ''}>
          <div class="fp24-sidebar-heading"><b>เลือกตัวชี้วัด</b><span>กดชื่อเพื่อดูรายละเอียด</span></div>
          <nav class="dtl-sidebar" aria-label="ตัวชี้วัดหลักและข้อย่อย">${dtlSidebarHtml(activeId)}</nav>
        </aside>
        <div class="fp24-content">${activeId === '2.4' ? dtl24Main() : unifiedDetailHtml(activeId)}<details class="fp24-owner-details"><summary>ผู้รับผิดชอบตัวชี้วัด</summary>${dtlOwnersHtml(MOU_DATA.kpis[activeId])}</details></div>
      </div></div>`;
    return;
  }
  root.innerHTML = `<div class="dtl-shell">
    <aside class="dtl-sidebar">${dtlSidebarHtml(activeId)}</aside>
    <div class="dtl-main">${activeId === '2.4' ? dtl24Main() : MOU_DATA.kpis[activeId] ? reportDetailHtml(activeId) : dtlPlaceholderMain(activeId)}</div>
    <aside class="dtl-owners">${MOU_DATA.kpis[activeId] ? dtlOwnersHtml(MOU_DATA.kpis[activeId]) : ''}</aside>
  </div>`;
}

function ovpActiveQuarter() { return ovpState.quarter || systemActiveQuarter(); }

function ovpChildren(id) {
  return Object.values(MOU_DATA.kpis).filter(k => k.parent === id).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}

function ovpScoreOf(kpi, q) {
  return kpi.isLeaf ? scoreAt(kpi.id, q) : scoreParentAt(kpi.id, q);
}

function ovpForecastScore(kpiId) {
  const fc = MOU_DATA.forecast[kpiId];
  return fc && fc.score !== undefined ? fc.score : null;
}

// Composite/parent rows carry one boilerplate rollup-methodology note copied onto
// every parent ("นับคะแนนของตัวชี้วัดภายใต้มา weight น้ำหนักและคิดคะแนนเฉลี่ย") —
// that is not a real per-KPI status, so Status is leaf-only.
function ovpStatusOf(kpi, q) {
  if (!kpi.isLeaf) return null;
  if (q === 'q3' && typeof computeManagementStatus === 'function') {
    const mgmt = computeManagementStatus(kpi.id, 'q3');
    if (mgmt) return mgmt.label;
  }
  const qd = MOU_DATA.quarterly[kpi.id];
  return qd && qd[q] && qd[q].note ? qd[q].note : null;
}

function ovpHasAlert(kpiId) {
  return MOU_DATA.deductions.some(d => d.kpi === kpiId || kpiId.startsWith(d.kpi))
    || MOU_DATA.assignments.some(a => a.kpi === kpiId || kpiId.startsWith(a.kpi));
}

function ovpLevelBucket(level) {
  if (level === null || level === undefined) return null;
  const r = Math.round(level);
  if (r <= 1) return '1';
  if (r === 2) return '2';
  if (r === 3) return '3';
  return '45';
}

function ovpMatchesMainFilters(kpi, q) {
  if (ovpState.quick !== 'all') {
    const s = ovpScoreOf(kpi, q);
    if (ovpLevelBucket(s.level) !== ovpState.quick) return false;
  }
  if (ovpState.group && kpi.groupLabel !== ovpState.group) return false;
  if (ovpState.ownerWatch && !(kpi.ownerWatch || []).includes(ovpState.ownerWatch)) return false;
  if (ovpState.ownerSupport && !(kpi.ownerSupport || []).includes(ovpState.ownerSupport)) return false;
  return true;
}

function ovpMatchesSearch(kpi) {
  if (!ovpState.search) return true;
  const s = ovpState.search.trim().toLowerCase();
  if (!s) return true;
  return kpi.id.toLowerCase().includes(s) || (kpi.label || '').toLowerCase().includes(s);
}
function ovpSubtreeMatchesSearch(kpi) {
  if (ovpMatchesSearch(kpi)) return true;
  return ovpChildren(kpi.id).some(c => ovpSubtreeMatchesSearch(c));
}
function ovpEffectiveExpanded(kpi) {
  if (ovpState.expanded.has(kpi.id)) return true;
  if (ovpState.search && ovpChildren(kpi.id).some(c => ovpSubtreeMatchesSearch(c))) return true;
  return false;
}

function ovpFmt(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return v.toLocaleString('en-US', { maximumFractionDigits: 3 });
  return v;
}
// คะแนน (current/actual) -- primary indicator of the row, stays the boldest: solid semantic fill.
function ovpBadge(level) {
  if (level === null || level === undefined) return '<span class="ovp-badge empty">—</span>';
  return `<span class="ovp-badge" style="background:${lvColor(level)}">${Number(level).toFixed(4)}</span>`;
}
// คาดการณ์ (forecast) -- same semantic color, but a soft tinted/outlined pill so it visibly reads
// as a projection, not the current result. color-mix() (not string-slicing) so it degrades safely
// whether lvColor() returns a hex stop or an interpolated rgb(...) string.
function ovpForecastBadge(level) {
  if (level === null || level === undefined) return '<span class="ovp-badge-forecast empty">—</span>';
  const c = lvColor(level);
  return `<span class="ovp-badge-forecast" style="color:${c};border-color:${c};background:color-mix(in srgb, ${c} 16%, white)">${Number(level).toFixed(4)}</span>`;
}
// Target -- a reference value, never a result: neutral style, no semantic red/green/yellow at all.
function ovpTargetBadge(value) {
  if (value === null || value === undefined) return '<span class="ovp-badge-target empty">—</span>';
  return `<span class="ovp-badge-target">${Number(value).toFixed(4)}</span>`;
}

// Actual Result has two distinct "no value" states — do not collapse them into one dash:
//   not_applicable — composite/parent KPI, no single raw value by design (it's a weighted rollup)
//   missing        — leaf KPI, this quarter genuinely has no data yet (e.g. Q3/Q4 not_evaluated)
function ovpActualCell(kpi, s) {
  if (!kpi.isLeaf) {
    return '<span class="ovp-cell-na" title="not_applicable — เป็นค่ารวมถ่วงน้ำหนักจากตัวชี้วัดย่อย ไม่มีผลเดี่ยว">—</span>';
  }
  if (s.rawValue === null || s.rawValue === undefined) {
    return '<span class="ovp-cell-missing" title="missing — ยังไม่มีข้อมูลในไตรมาสนี้ (not_evaluated)">—</span>';
  }
  return ['milestone_pct','milestone_manual'].includes(kpi.scoringMethod) ? `${(Number(s.rawValue)*100).toFixed(2)}%` : entryEsc(String(ovpFmt(s.rawValue)));
}

// Executive Scan Table narrative columns: compact, clamped (1-2 lines) -- the full text still
// lives in Detail via reportSummaryHtml/reportText, unchanged. This only reads reportText, the
// same source the old under-name block already read, so content/precedence is identical.
const OVP_NARRATIVE_FIELDS = [['summary_text', 'สรุปผล'], ['obstacle_text', 'ปัญหา / อุปสรรค'], ['solution_text', 'การดำเนินการต่อ']];
// No title/tooltip here on purpose -- Overview must stay a quick scan; the full text lives on
// Detail only (reportSummaryHtml/reportText there, unchanged).
function ovpNarrativeCellHtml(kpiId, q, field) {
  const val = reportText(kpiId, q, field);
  if (!val) return `<td class="ovp-narrative-cell"><span class="ovp-empty-cell">—</span></td>`;
  return `<td class="ovp-narrative-cell"><span class="ovp-narrative-text">${entryEsc(val)}</span></td>`;
}

// Parent/composite rows must never concatenate their children's narrative text (that's what made
// rows huge and duplicated child content). Instead derive a short roll-up from the children's own
// already-computed scores -- counts and ids only, nothing invented, nothing textual re-authored.
function ovpParentRollupStats(kpi, q) {
  const kids = ovpChildren(kpi.id);
  const scored = kids.map(c => ({ id: c.id, level: ovpScoreOf(c, q).level }));
  const watch = scored.filter(k => k.level === null || ['1', '2'].includes(ovpLevelBucket(k.level)));
  return { total: scored.length, onTarget: scored.length - watch.length, watchIds: watch.map(k => k.id) };
}
function ovpParentRollupCellsHtml(kpi, q) {
  const cell = (text) => text
    ? `<td class="ovp-narrative-cell"><span class="ovp-narrative-text ovp-rollup-text">${entryEsc(text)}</span></td>`
    : `<td class="ovp-narrative-cell"><span class="ovp-empty-cell">—</span></td>`;
  const st = ovpParentRollupStats(kpi, q);
  if (!st.total) return cell('') + cell('') + cell('');
  const summary = `${st.total} ตัวชี้วัดย่อย · ${st.onTarget} ตามเป้า · ${st.watchIds.length} ต้องติดตาม`;
  const watchList = st.watchIds.length ? `ติดตาม ${st.watchIds.slice(0, 3).join(' และ ')}${st.watchIds.length > 3 ? ' และอื่นๆ' : ''}` : '';
  return cell(summary) + cell(watchList) + cell('');
}

function ovpRowHtml(kpi, depth, q) {
  const kids = ovpChildren(kpi.id);
  const hasKids = kids.length > 0;
  const expanded = ovpEffectiveExpanded(kpi);
  const s = ovpScoreOf(kpi, q);
  const status = ovpStatusOf(kpi, q);
  const alert = ovpHasAlert(kpi.id);
  const rowClass = depth === 0 ? 'ovp-row-main' : 'ovp-row-sub';
  const indent = depth > 0 ? `<span class="ovp-indent" style="width:${depth * 16}px"></span>` : '';
  const caret = hasKids
    ? `<button class="ovp-caret ${expanded ? 'open' : ''}" onclick="ovpToggle('${kpi.id}')" title="ขยาย/ย่อตัวชี้วัดย่อย">▶</button>`
    : `<span class="ovp-caret spacer">▶</span>`;
  return `<tr class="${rowClass}">
    <td><div class="ovp-id-cell">${indent}${caret}<b>${kpi.id}</b></div></td>
    <td class="ovp-name-cell">${kpi.label}</td>
    <td class="num">${kpi.weight ?? '—'}</td>
    <td>${kpi.unit || '—'}</td>
    <td class="num">${ovpActualCell(kpi, s)}</td>
    <td class="num">${ovpBadge(s.level)}</td>
    <td class="num">${ovpForecastBadge(ovpForecastScore(kpi.id))}</td>
    <td class="num">${ovpTargetBadge(kpi.targetScore)}</td>
    ${kpi.isLeaf ? OVP_NARRATIVE_FIELDS.map(([field]) => ovpNarrativeCellHtml(kpi.id, q, field)).join('') : ovpParentRollupCellsHtml(kpi, q)}
    <td class="ovp-status-cell"><div class="ovp-status-inner">${status ? `<span class="ovp-status-txt">${status}</span>` : '<span class="ovp-empty-cell">—</span>'}${alert ? `<span class="ovp-alert-flag" onclick="goToActionPlan()" title="มีประเด็นที่ต้องติดตาม">🔔</span>` : ''}</div></td>
    <td class="ovp-action-cell"><button class="ovp-detail-icon" onclick="ovpDetailClick('${kpi.id}')" title="ดูรายละเอียด" aria-label="ดูรายละเอียด ${kpi.id}">›</button></td>
  </tr>`;
}

function ovpBuildRows(kpi, depth, q, out) {
  out.push(ovpRowHtml(kpi, depth, q));
  const kids = ovpChildren(kpi.id);
  if (kids.length && ovpEffectiveExpanded(kpi)) {
    kids.forEach(c => {
      if (ovpState.search && !ovpSubtreeMatchesSearch(c)) return;
      ovpBuildRows(c, depth + 1, q, out);
    });
  }
}

function ovpToggle(id) {
  if (ovpState.expanded.has(id)) ovpState.expanded.delete(id); else ovpState.expanded.add(id);
  renderOverview();
}
function ovpSetQuick(v) { ovpState.quick = v; renderOverview(); }
function ovpSetFilter(key, v) { ovpState[key] = v; renderOverview(); }
function ovpSetSearch(v) {
  ovpState.search = v;
  renderOverview();
  const el = document.getElementById('ovpSearchInput');
  if (el) { el.focus(); const p = el.value.length; el.setSelectionRange(p, p); }
}
function ovpClear() {
  ovpState.quarter = null; ovpState.quick = 'all'; ovpState.group = '';
  ovpState.ownerWatch = ''; ovpState.ownerSupport = ''; ovpState.search = ''; ovpState.expanded.clear();
  renderOverview();
}
function ovpDetailClick(kpiId) {
  detailRouteKpiId = kpiId;
  dtlQuarter = ovpActiveQuarter();
  const btn = document.getElementById('tabBtnDetail');
  if (btn) btn.click();
}
function renderOverview() {
  const root = document.getElementById('page-overview');
  if (!root) return;
  const q = ovpActiveQuarter();
  const mains = OVP_MAIN_IDS.map(id => MOU_DATA.kpis[id]);

  const counts = { all: mains.length, '1': 0, '2': 0, '3': 0, '45': 0 };
  mains.forEach(k => {
    const b = ovpLevelBucket(ovpScoreOf(k, q).level);
    if (b) counts[b]++;
  });

  const groupOptions = [...new Set(Object.values(MOU_DATA.kpis).map(k => k.groupLabel).filter(Boolean))];
  const watchOptions = [...new Set(Object.values(MOU_DATA.kpis).flatMap(k => k.ownerWatch || []))];
  const supportOptions = [...new Set(Object.values(MOU_DATA.kpis).flatMap(k => k.ownerSupport || []))];

  const rows = [];
  mains.forEach(k => { if (ovpMatchesMainFilters(k, q) && (ovpSubtreeMatchesSearch(k) || !ovpState.search)) ovpBuildRows(k, 0, q, rows); });

  // Dot color = the exact LV_COLORS used everywhere else in the dashboard (badges, heat map,
  // Home legend) -- '45' (ระดับ 4-5) shows LV_COLORS[5], the "ดี" end of that combined bucket.
  const OVP_QUICK_DOT = { '1': LV_COLORS[1], '2': LV_COLORS[2], '3': LV_COLORS[3], '45': LV_COLORS[5] };
  const chip = (key, label) => {
    const dot = key !== 'all' ? `<i class="ovp-chip-dot" style="background:${OVP_QUICK_DOT[key]}"></i>` : '';
    return `<button class="ovp-chip ${key !== 'all' ? 'lv' + key : ''} ${ovpState.quick === key ? 'active' : ''}" onclick="ovpSetQuick('${key}')">${dot}${label} <b>${counts[key]}</b></button>`;
  };
  const opt = (list, cur) => list.map(v => `<option value="${v}" ${cur === v ? 'selected' : ''}>${v}</option>`).join('');

  root.innerHTML = `
    <div class="ovp-header">
      <div class="ovp-mascot"><img src="assets/mascot-point.png" alt=""></div>
      <div class="ovp-title-wrap">
        <div class="ovp-title">ภาพรวมตัวชี้วัดทั้งหมด</div>
        <div class="ovp-subtitle">แสดงรายละเอียดตัวชี้วัดประจำปีงบประมาณ 2569 · ${Q_LABEL[q]} (${PERIOD_LABEL[q]})<br>${quarterCoverageText(q)}</div>
      </div>
      <div class="ovp-search"><input id="ovpSearchInput" type="text" placeholder="ค้นหา KPI ID หรือชื่อตัวชี้วัด..." value="${ovpState.search}" oninput="ovpSetSearch(this.value)"></div>
    </div>

    <div class="ovp-quickchips">
      ${chip('all', 'ทั้งหมด')}
      ${chip('1', 'ระดับ 1 (วิกฤติ)')}
      ${chip('2', 'ระดับ 2 (เสี่ยง)')}
      ${chip('3', 'ระดับ 3 (ปานกลาง)')}
      ${chip('45', 'ระดับ 4-5 (ดี)')}
      <button class="ovp-clearbtn" onclick="ovpClear()">ล้างตัวกรอง</button>
    </div>

    <div class="ovp-filterbar">
      <label>ไตรมาส
        <select onchange="ovpSetFilter('quarter', this.value)">
          <option value="q1" ${q === 'q1' ? 'selected' : ''}>Q1 (3 เดือน)</option>
          <option value="q2" ${q === 'q2' ? 'selected' : ''}>Q2 (6 เดือน)</option>
          <option value="q3" ${q === 'q3' ? 'selected' : ''}>Q3 (9 เดือน)</option>
          <option value="q4" ${q === 'q4' ? 'selected' : ''}>Q4 (12 เดือน)</option>
        </select>
      </label>
      <label>กลุ่มตัวชี้วัด
        <select onchange="ovpSetFilter('group', this.value)">
          <option value="">ทั้งหมด</option>
          ${opt(groupOptions, ovpState.group)}
        </select>
      </label>
      <label>ผู้บริหารกำกับ
        <select onchange="ovpSetFilter('ownerWatch', this.value)">
          <option value="">ทั้งหมด</option>
          ${opt(watchOptions, ovpState.ownerWatch)}
        </select>
      </label>
      <label>ผู้บริหารสนับสนุน
        <select onchange="ovpSetFilter('ownerSupport', this.value)">
          <option value="">ทั้งหมด</option>
          ${opt(supportOptions, ovpState.ownerSupport)}
        </select>
      </label>
    </div>

    <div class="ovp-table-wrap"><table class="ovp-table">
      <colgroup>
        <col style="width:80px"><col style="width:190px"><col style="width:70px"><col style="width:90px">
        <col style="width:95px"><col style="width:90px"><col style="width:90px"><col style="width:80px">
        <col style="width:195px"><col style="width:195px"><col style="width:190px">
        <col style="width:105px"><col style="width:90px">
      </colgroup>
      <thead><tr>
        <th>KPI</th><th>ตัวชี้วัด</th><th class="num">น้ำหนัก</th><th>หน่วยวัด</th>
        <th class="num">ผล</th><th class="num">คะแนนปัจจุบัน</th><th class="num">คาดการณ์สิ้นปี</th><th class="num">เป้าหมาย</th>
        <th>สรุปผล</th><th>ปัญหา/อุปสรรค</th><th>การดำเนินการต่อ</th>
        <th>สถานะ</th><th>รายละเอียด</th>
      </tr></thead>
      <tbody>${rows.length ? rows.join('') : '<tr><td colspan="13" class="empty-note">ไม่พบตัวชี้วัดที่ตรงกับตัวกรอง</td></tr>'}</tbody>
    </table></div>
  `;
}

function switchTab(id, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  btn.classList.add('active');
  if (id === 'home') renderHome();
  if (id === 'overview') renderOverview();
  if (id === 'detail') renderDetail();
  if (id === 'entry' && typeof renderEntry === 'function') renderEntry();
  if (id === 'alerts' && typeof renderAlerts === 'function') renderAlerts();
}

window.addEventListener('DOMContentLoaded', () => {
  renderHome();
});

function openHomeIssueList(button) {
 const card=button.closest('.watch-card');
 const overlay=document.getElementById('quickDetailOverlay');
 overlay.innerHTML='<div class="qd-modal"><div class="qd-head"><b></b><button class="qd-close" onclick="closeQuickDetail()">×</button></div><div class="qd-body"></div></div>';
 overlay.querySelector('.qd-head b').textContent=card.querySelector('.watch-card-head span').textContent;
 overlay.querySelector('.qd-body').innerHTML=card.querySelector('template').innerHTML;
 overlay.classList.add('open');
}
