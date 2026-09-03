// app.js — MOU 69 V1 render layer. Reads MOU_DATA (mou_data.js) through engine.js only —
// never re-derives scoring formulas here (V1 brief §8/§30).

const LV_COLORS = { 1: '#e2554f', 2: '#ef9483', 3: '#e3a82e', 4: '#5bc69a', 5: '#1f9d6f', null: '#dcdad3' };
const QUARTERS = ['q1', 'q2', 'q3', 'q4'];
const Q_LABEL = { q1: 'Q1', q2: 'Q2', q3: 'Q3', q4: 'Q4', forecast: 'คาดการณ์' };

// ── Local overrides (Data Entry results for Q3/Q4 — starts empty, V1 rule) ──
function getOverrides() {
  try { return JSON.parse(localStorage.getItem('mou69_v1_overrides') || '{}'); } catch (e) { return {}; }
}
function saveOverrides(o) {
  try { localStorage.setItem('mou69_v1_overrides', JSON.stringify(o)); } catch (e) {}
}

// ── Merge seeded MOU_DATA.quarterly (Q1/Q2 real) with any user-entered overrides (Q3/Q4) ──
function getQuarterInput(kpiId, q) {
  const overrides = getOverrides();
  if (overrides[kpiId] && overrides[kpiId][q] !== undefined) return overrides[kpiId][q];
  const seeded = MOU_DATA.quarterly[kpiId] && MOU_DATA.quarterly[kpiId][q];
  if (!seeded) return null; // Q3/Q4 seed intentionally empty — V1 rule
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
  return scoreLeafKPI(kpi, input, q);
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

// ═══════════════════════════════════════════════════════════
// HOME  (visual layer only — every number below still comes from
// scoreAt/scoreParentAt/overallScoreAt/overallForecastScore/MOU_DATA,
// same as before. Nothing here computes a score.)
// ═══════════════════════════════════════════════════════════
const CHILI_SVG = `<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">
  <path d="M28 8 Q33 1 40 5" stroke="#3f7d4a" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M22 9 C10 18 8 34 15 46 C21 56 34 58 42 50 C52 40 50 22 38 10 C34 15 30 15 26 11 C25 10 23 9 22 9 Z" fill="#c0392b"/>
  <ellipse cx="24" cy="18" rx="4" ry="7" fill="#e2554f" opacity="0.55" transform="rotate(-25 24 18)"/>
</svg>`;

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

function topWeightKpi() {
  return Object.values(MOU_DATA.kpis).filter(k => k.isLeaf).sort((a, b) => b.weight - a.weight)[0];
}

const issueGroupOpen = { urgent: false, deduction: false, assignment: false };
function toggleIssueGroup(key) {
  issueGroupOpen[key] = !issueGroupOpen[key];
  renderIssues();
}

function goToActionPlan() {
  document.getElementById('tabBtnAlerts').click();
}

function renderHome() {
  const root = document.getElementById('page-home');
  if (!root) return;
  const activeQ = systemActiveQuarter();
  const current = overallScoreAt(activeQ);
  const forecast = overallForecastScore();
  const top = topWeightKpi();
  const topScore = scoreAt(top.id, activeQ);

  root.innerHTML = `
    <div class="hm-filterbar" id="filterbar" style="display:${filterState.levelSet.size || filterState.quarter ? 'flex' : 'none'}">
      <span>กำลังกรอง:</span>
      ${filterState.quarter ? `<span class="chip">${Q_LABEL[filterState.quarter]}</span>` : ''}
      ${[...filterState.levelSet].map(lv => `<span class="chip" style="background:${lvColor(lv)}22;border-color:${lvColor(lv)}">Level ${lv}</span>`).join('')}
      <button class="clear-btn" onclick="clearFilter()">ล้างตัวกรอง</button>
    </div>

    <div class="home-grid">
      <aside class="home-left">
        <div class="mini-card legend-card">
          <div class="mini-title">ระดับคะแนน</div>
          ${[5, 4, 3, 2, 1].map(lv => `<div class="legend-row"><i style="background:${LV_COLORS[lv]}"></i>Level ${lv}</div>`).join('')}
          <div class="legend-row"><i style="background:${LV_COLORS.null}"></i>ยังไม่มีข้อมูล</div>
        </div>
        <div class="mini-card highlight-card">
          <div class="mini-title">ผลตัวชี้วัดที่สำคัญ</div>
          <div class="highlight-id">${top.id} · น้ำหนัก ${top.weight}</div>
          <div class="highlight-label">${top.label}</div>
          <div class="highlight-score" style="color:${lvColor(topScore.level)}">${topScore.level !== null ? topScore.level.toFixed(4) : '—'}<span class="score-of">/5</span></div>
          <div class="highlight-target">Target: ${top.target ?? '—'}</div>
        </div>
        <div class="mascot-card">
          <div class="mascot-icon">${CHILI_SVG}</div>
          <div class="mascot-tag">PAT-PHET<br>มุ่งสู่เป้าหมาย</div>
        </div>
      </aside>

      <div class="home-center">
        <div class="hero-row">
          <div class="hero-mascot">${CHILI_SVG}</div>
          <div class="hero-text">
            <h1>ผลการดำเนินงาน ${PERIOD_LABEL[activeQ]}</h1>
            <p>${heroNarrative(current, TARGET_SCORE)}</p>
          </div>
          <div class="hero-scores">
            <div class="mini-score-card">
              <div class="mini-score-label">คะแนนรวม ${PERIOD_LABEL[activeQ]}</div>
              <div class="mini-score-val" style="color:${lvColor(current)}">${current !== null ? current.toFixed(4) : '—'}<span class="score-of">/5</span></div>
              <div class="score-bar"><div class="score-bar-fill" style="width:${current ? current / 5 * 100 : 0}%;background:${lvColor(current)}"></div></div>
            </div>
            <div class="mini-score-card">
              <div class="mini-score-label">คะแนนคาดการณ์สิ้นปี</div>
              <div class="mini-score-val" style="color:var(--gold)">${forecast !== null ? forecast.toFixed(4) : '—'}<span class="score-of">/5</span></div>
              <div class="mini-score-sub">${forecast !== null ? (forecast / TARGET_SCORE * 100).toFixed(2) + '% เทียบเป้าหมาย' : ''}</div>
            </div>
            <div class="mini-score-card">
              <div class="mini-score-label">คะแนนเป้าหมายปี 2569</div>
              <div class="mini-score-val" style="color:var(--brand)">${TARGET_SCORE.toFixed(4)}<span class="score-of">/5</span></div>
            </div>
          </div>
        </div>

        <div class="trail-card">
          <div class="card-title">ความก้าวหน้ารายไตรมาส</div>
          <div class="trail" id="trail"></div>
        </div>

        <div class="heatmap-card grow">
          <div class="card-title">Heat Map (ระดับคะแนน)</div>
          <div id="heatmap"></div>
          <div class="hm-legend">
            ${[1, 2, 3, 4, 5].map(lv => `<span class="hm-legend-item" onclick="toggleLevelFilter(${lv})" style="cursor:pointer;${filterState.levelSet.has(lv) ? 'font-weight:700' : ''}"><i style="background:${LV_COLORS[lv]}"></i>Level ${lv}</span>`).join('')}
            <span class="hm-legend-item"><i style="background:${LV_COLORS.null}"></i>ยังไม่มีข้อมูล</span>
          </div>
        </div>

        <div class="bottom-row">
          <div class="mini-card summary-card">
            <div class="mini-title">สรุปผลการดำเนินงาน</div>
            <div id="summaryBox"></div>
          </div>
          <div class="mini-card priority-card">
            <div class="mini-title">ประเด็นที่ควรเร่งรัดเพื่อยกระดับคะแนน</div>
            <div id="priorityBox"></div>
            <button class="cta-btn" onclick="goToActionPlan()">ดูแผนการดำเนินการ →</button>
          </div>
        </div>
      </div>

      <aside class="home-right">
        <div class="mini-card issues-card">
          <div class="mini-title">ประเด็นที่ควรติดตาม</div>
          <div id="issues"></div>
        </div>
      </aside>
    </div>
  `;
  renderTrail(activeQ);
  renderHeatmap();
  renderIssues();
  renderSummaryBox(activeQ, current);
  renderPriorityBox(activeQ);
}

function renderSummaryBox(activeQ, current) {
  const el = document.getElementById('summaryBox');
  const prevQ = activeQ === 'q2' ? 'q1' : null;
  const prevScore = prevQ ? overallScoreAt(prevQ) : null;
  const dist = levelDistribution(activeQ);
  const delta = current !== null && prevScore !== null ? current - prevScore : null;
  el.innerHTML = `
    ${delta !== null ? `<div class="summary-trend">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(4)} เทียบ ${Q_LABEL[prevQ]}</div>` : ''}
    <div class="summary-dist">
      ${[5, 4, 3, 2, 1].map(lv => `<div class="dist-chip" style="background:${LV_COLORS[lv]}22;color:${LV_COLORS[lv]}"><b>${dist[lv]}</b> Lv${lv}</div>`).join('')}
      <div class="dist-chip" style="background:${LV_COLORS.null}55;color:#6b615a"><b>${dist.none}</b> ไม่มีข้อมูล</div>
    </div>
  `;
}

function renderPriorityBox(activeQ) {
  const el = document.getElementById('priorityBox');
  const items = priorityKpis(activeQ);
  el.innerHTML = items.length
    ? items.map(({ kpi, s }) => `
        <div class="priority-item" onclick="openQuickDetail('${kpi.id}','${activeQ}')">
          <span class="priority-lv" style="background:${lvColor(s.level)}">${s.level.toFixed(1)}</span>
          <span class="priority-label"><b>${kpi.id}</b> ${kpi.label}</span>
        </div>`).join('')
    : '<div class="empty-note">ไม่มี KPI ที่ต้องเร่งรัดในไตรมาสนี้</div>';
}

function renderTrail(activeQ) {
  const el = document.getElementById('trail');
  const pts = ['q1', 'q2', 'q3', 'q4'].map(q => ({ q, score: overallScoreAt(q) }));
  const fc = overallForecastScore();
  el.innerHTML = pts.map(p => `
    <div class="trail-pt ${p.q === activeQ ? 'active' : ''} ${p.score === null ? 'empty' : ''}" onclick="toggleQuarterFilter('${p.q}')">
      <div class="trail-dot" style="background:${p.score !== null ? lvColor(p.score) : 'var(--border)'}"></div>
      <div class="trail-val">${p.score !== null ? p.score.toFixed(4) : 'ยังไม่มีข้อมูล'}</div>
      <div class="trail-label">${Q_LABEL[p.q]}</div>
    </div>
  `).join('') + `
    <div class="trail-pt target">
      <div class="trail-dot" style="background:var(--gold)"></div>
      <div class="trail-val">${TARGET_SCORE.toFixed(4)}</div>
      <div class="trail-label">เป้าหมาย</div>
    </div>
  `;
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

function renderHeatmap() {
  const el = document.getElementById('heatmap');
  let html = '<div class="hm-grid">';
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
        html += `<div class="hm-cell ${dim ? 'dim' : ''}" style="background:${s.level !== null ? lvColor(s.level) : LV_COLORS.null}" title="${kpiId} ${Q_LABEL[row]}: ${s.level !== null ? s.level.toFixed(2) : 'ยังไม่มีข้อมูล'}" onclick="openQuickDetail('${kpiId}','${row}')"></div>`;
      }
    }
  }
  html += '</div>';
  const cols = HM_GROUPS.reduce((s, g) => s + g.children.length, 0);
  el.innerHTML = html;
  el.querySelector('.hm-grid').style.gridTemplateColumns = `64px repeat(${cols}, minmax(28px, 1fr))`;
}

function openQuickDetail(kpiId, q) {
  const kpi = MOU_DATA.kpis[kpiId];
  const s = q === 'forecast'
    ? (() => { const fc = MOU_DATA.forecast[kpiId]; const hc = ['qualitative', 'evidence', 'milestone_manual'].includes(kpi.scoringMethod); return scoreLeafKPI(kpi, fc ? (hc ? fc.score : fc.result) : null, 'forecast'); })()
    : scoreAt(kpiId, q);
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
        <div class="qd-row"><span>ผลจริง</span><b>${s.rawValue ?? 'ยังไม่มีข้อมูล'}</b></div>
        <div class="qd-row"><span>คะแนน</span><b style="color:${lvColor(s.level)}">${s.level !== null ? s.level.toFixed(4) : '—'}</b></div>
        <div class="qd-row"><span>น้ำหนัก</span><b>${kpi.weight}</b></div>
        <div class="qd-row"><span>คะแนนถ่วงน้ำหนัก</span><b>${s.weightedValue !== null ? s.weightedValue.toFixed(4) : '—'}</b></div>
        <div class="qd-row"><span>ผู้รับผิดชอบ</span><b>${owner}</b></div>
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
  const activeQ = systemActiveQuarter();
  const urgent = priorityKpis(activeQ, 99); // same "ต้องเร่ง" definition as the bottom priority box

  function group(key, title, count, detailHtml) {
    const open = issueGroupOpen[key];
    return `
      <div class="issue-group">
        <div class="issue-group-head" onclick="toggleIssueGroup('${key}')">
          <span>${title}</span>
          <span class="issue-count">${count}</span>
        </div>
        ${open ? `<div class="issue-group-body">${detailHtml || '<div class="empty-note">ไม่มีรายการ</div>'}</div>` : ''}
      </div>`;
  }

  const html =
    group('urgent', 'KPI ต้องเร่ง', urgent.length,
      urgent.map(({ kpi, s }) => `<div class="issue-item" onclick="openQuickDetail('${kpi.id}','${activeQ}')"><b>${kpi.id}</b> — ${kpi.label}<div class="issue-status">คะแนน ${s.level.toFixed(2)}</div></div>`).join('')) +
    group('deduction', 'เงื่อนไขหักคะแนน', MOU_DATA.deductions.length,
      MOU_DATA.deductions.map(d => `<div class="issue-item"><b>${d.kpi}</b> — ${d.reason}<div class="issue-status">${d.status}</div></div>`).join('')) +
    group('assignment', 'ประเด็นมอบหมายจากที่ประชุม', MOU_DATA.assignments.length,
      MOU_DATA.assignments.map(a => `<div class="issue-item"><b>${a.kpi}</b> — ${a.note}</div>`).join(''));

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
// DETAIL — "รายละเอียดตัวชี้วัด" (this round: real UI for KPI 2.4 only, per RDE Master
// Mockup + confirmed audit. Every other KPI ID routes to the plain placeholder below —
// no Detail UI is built for them this round. Reuses ovpChildren/ovpFmt/ovpBadge/scoreAt/
// scoreParentAt/lvColor/Q_LABEL as-is; nothing here re-derives a score.)
// ═══════════════════════════════════════════════════════════
let detailRouteKpiId = null;
let dtlQuarter = 'q2'; // V1 default per brief — only q1/q2 are evaluated

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
const NOT_EVALUATED_TXT = 'ยังไม่มีข้อมูล (ยังไม่ถึงรอบประเมิน)';
const DTL_MONTH_LABEL = { m1: 'ต.ค.', m2: 'พ.ย.', m3: 'ธ.ค.', m4: 'ม.ค.', m5: 'ก.พ.', m6: 'มี.ค.', m7: 'เม.ย.', m8: 'พ.ค.', m9: 'มิ.ย.' };
const DTL_MONTH_KEYS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9'];

function dtlGoTo(id) { detailRouteKpiId = id; dtlQuarter = 'q2'; renderDetail(); }
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
  const q = systemActiveQuarter();
  const s = kpi.isLeaf ? scoreAt(kpiId, q) : scoreParentAt(kpiId, q);
  const chip = s.level !== null ? `<span class="dtl-score-chip" style="background:${lvColor(s.level)}">${s.level.toFixed(2)}</span>` : '';
  const caret = hasKids
    ? `<span class="dtl-caret" onclick="event.stopPropagation();dtlToggleNode('${kpiId}')">${expanded ? '▾' : '▸'}</span>`
    : `<span class="dtl-caret"></span>`;
  let html = `<div class="dtl-node ${isActive ? 'active' : ''}" style="padding-left:${6 + depth * 12}px" onclick="dtlGoTo('${kpiId}')">
    ${caret}<b>${kpiId}</b><span class="dtl-node-label">${kpi.label}</span>${chip}
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

function dtlInitial(name) { return (name || '?').trim().charAt(0); }
function dtlOwnersHtml(kpi) {
  // Presentation hierarchy per confirmed spec: กำกับดูแล = most prominent,
  // หลัก = secondary, สนับสนุน = compact list. Names are real Master Data owners only.
  const block = (role, list, variant) => `<div class="dtl-owner-card ${variant}">
    <div class="dtl-avatar">${(list && list.length) ? dtlInitial(list[0]) : '—'}</div>
    <div class="dtl-owner-body">
      <div class="dtl-owner-role">${role}</div>
      ${(list && list.length) ? list.map(p => `<div class="dtl-owner-name">${p}</div>`).join('') : '<div class="dtl-owner-name" style="color:var(--text3);font-style:italic">—</div>'}
    </div>
  </div>`;
  return block('ผู้บริหารกำกับดูแล', kpi.ownerWatch, 'primary')
    + block('ผู้รับผิดชอบหลัก', kpi.ownerMain, 'secondary')
    + block('ผู้รับผิดชอบสนับสนุน', kpi.ownerSupport, 'compact');
}

function dtlPlaceholderMain(id) {
  const kpi = MOU_DATA.kpis[id];
  if (!kpi) return `<div class="stub-note">เลือกตัวชี้วัดจากเมนูด้านซ้ายเพื่อดูรายละเอียด</div>`;
  return `<div class="stub-note">ตัวชี้วัด ${kpi.id} — ${kpi.label}<br>หน้ารายละเอียดตัวชี้วัดนี้อยู่ระหว่างพัฒนา</div>`;
}

// §5A source: MOU_DATA.monthly (sheet "9. ผลรายเดือน", ต.ค.-มี.ค. only — V1 rule).
// Quarter Result / Cumulative Result are computed here from the raw months, never
// pre-baked into the data file and never fed back into engine.js scoring.
// KPI 2.4's Q3 months live in entry_store.js (Entry tab UAT input, brief §4) — merged in
// here for display only; scoring itself always goes through getQuarterInput/scoreAt.
function dtlMonthlySeries(kpiId) {
  const m = MOU_DATA.monthly[kpiId];
  const base = (m && m.components.length) ? m.components[0].months : null;
  if (kpiId === '2.4' && typeof getEntry === 'function') {
    const q3 = getEntry('2.4').monthly; // {m7,m8,m9} normalized to Master unit, or null
    const hasAny = ['m7', 'm8', 'm9'].some(k => q3[k] !== null && q3[k] !== undefined);
    if (hasAny) return Object.assign({}, base || {}, q3);
  }
  return base;
}
function dtlQuarterSumFromMonthly(months, q) {
  if (!months) return null;
  const keys = q === 'q1' ? ['m1', 'm2', 'm3'] : q === 'q2' ? ['m4', 'm5', 'm6'] : q === 'q3' ? ['m7', 'm8', 'm9'] : null;
  if (!keys || keys.some(k => months[k] === undefined || months[k] === null)) return null;
  return keys.reduce((sum, k) => sum + months[k], 0);
}
function dtlCumulativeFromMonthly(months, q) {
  const q1 = dtlQuarterSumFromMonthly(months, 'q1');
  if (q === 'q1') return q1;
  const q2 = dtlQuarterSumFromMonthly(months, 'q2');
  if (q === 'q2') return (q1 === null || q2 === null) ? null : q1 + q2;
  const q3 = dtlQuarterSumFromMonthly(months, 'q3');
  return (q1 === null || q2 === null || q3 === null) ? null : q1 + q2 + q3;
}

function dtl24Main() {
  const kpi = kpiForScoring('2.4');
  const q = dtlQuarter;
  const isEvaluated = getQuarterInput('2.4', q) !== null;
  const s = isEvaluated ? scoreAt('2.4', q) : { level: null, rawValue: null };
  const fc = MOU_DATA.forecast['2.4'];
  const months = dtlMonthlySeries('2.4');
  // §3/§4 use the monthly-summed cumulative (per confirmed spec, e.g. Q2 = 5.445) —
  // a display-layer cross-check, distinct from the engine's own scoring input
  // (§2 cards use s.rawValue = 5.44, exactly as scoreAt/engine.js already computed it).
  const cumulative = isEvaluated ? dtlCumulativeFromMonthly(months, q) : null;
  const target = kpi.target;
  const progressPct = (cumulative !== null && target) ? (cumulative / target * 100) : null;
  const remainingGap = (cumulative !== null && target) ? (target - cumulative) : null;
  const qd = MOU_DATA.quarterly['2.4'];
  const noteForQuarter = (isEvaluated && qd && qd[q]) ? qd[q].note : null;
  const dedItem = MOU_DATA.deductions.find(d => d.kpi === '2.4');
  const assignItem = MOU_DATA.assignments.find(a => a.kpi === '2.4');

  const headerMeta = [
    ['กลุ่ม KPI', kpi.groupLabel || '—'],
    ['หน่วย', kpi.unit || '—'],
    ['น้ำหนัก', kpi.weight ?? '—'],
    ['ความถี่', '—'],
    ['ผู้บริหารกำกับ', (kpi.ownerWatch || []).join(', ') || '—'],
    ['ผู้รับผิดชอบหลัก', (kpi.ownerMain || []).join(', ') || '—'],
    ['ผู้รับผิดชอบสนับสนุน', (kpi.ownerSupport || []).join(', ') || '—'],
  ];

  const qBtn = (qq, label) => {
    const evaluated = getQuarterInput('2.4', qq) !== null;
    return `<button class="dtl-qbtn ${dtlQuarter === qq ? 'active' : ''} ${!evaluated ? 'disabled' : ''}" onclick="${evaluated ? `dtlSetQuarter('${qq}')` : ''}" title="${evaluated ? '' : 'not_evaluated'}">${label}</button>`;
  };

  const monthCount = q === 'q1' ? 3 : q === 'q2' ? 6 : 9;
  const monthEndLabel = { q1: 'ธ.ค.', q2: 'มี.ค.', q3: 'มิ.ย.' }[q] || 'มี.ค.';
  const monthlyMini = (months && isEvaluated)
    ? `<div class="dtl-monthly-mini">
        <div class="dtl-monthly-mini-title">ข้อมูลรายเดือน (raw, ต.ค.-${monthEndLabel} 69)</div>
        <div class="dtl-monthly-mini-row">${DTL_MONTH_KEYS.slice(0, monthCount).map(mk => `<span>${DTL_MONTH_LABEL[mk]} <b>${months[mk] !== undefined && months[mk] !== null ? months[mk].toLocaleString('en-US', { maximumFractionDigits: 3 }) : '—'}</b></span>`).join('')}</div>
      </div>`
    : `<div class="dtl-monthly-mini"><div class="dtl-support-val empty">${NOT_RECORDED}</div></div>`;

  const qRows = ['q1', 'q2', 'q3', 'q4'].map(qq => {
    const evaluated = getQuarterInput('2.4', qq) !== null;
    const rs = evaluated ? scoreAt('2.4', qq) : null;
    const cum = evaluated ? dtlCumulativeFromMonthly(months, qq) : null;
    const qResult = evaluated ? dtlQuarterSumFromMonthly(months, qq) : null;
    const pct = (cum !== null && target) ? (cum / target * 100) : null;
    if (!evaluated) {
      return `<tr>
        <td>${Q_LABEL[qq]}</td>
        <td colspan="2"><span class="ovp-cell-missing" title="not_evaluated">${NOT_EVALUATED_TXT}</span></td>
        <td>${ovpBadge(null)}</td>
        <td>${ovpBadge(kpi.targetScore)}</td>
      </tr>`;
    }
    return `<tr>
      <td>${Q_LABEL[qq]}</td>
      <td><b>${cum !== null ? cum.toLocaleString('en-US', { maximumFractionDigits: 3 }) : '—'}</b> ${kpi.unit || ''}<div style="font-size:10.5px;color:var(--text3)">ผลเฉพาะไตรมาสนี้: ${qResult !== null ? qResult.toLocaleString('en-US', { maximumFractionDigits: 3 }) : '—'}</div></td>
      <td>${pct !== null ? pct.toFixed(2) + '%' : '—'}</td>
      <td>${ovpBadge(rs.level)}</td>
      <td>${ovpBadge(kpi.targetScore)}</td>
    </tr>`;
  }).join('');

  return `
    <div class="dtl-header-card">
      <div class="dtl-page-title">รายละเอียดตัวชี้วัด</div>
      <div class="dtl-breadcrumb">รายละเอียดตัวชี้วัด &nbsp;›&nbsp; ตัวชี้วัดที่ ${kpi.id}</div>
      <div class="dtl-h1"><span class="dtl-id-badge">${kpi.id}</span>${kpi.label}</div>
      <div class="dtl-meta-grid">${headerMeta.map(([label, val]) => `<div class="dtl-meta-item">${label}<b>${val}</b></div>`).join('')}</div>
      <div class="dtl-quarter-tabs">
        ${qBtn('q1', 'Q1 (3 เดือน)')}
        ${qBtn('q2', 'Q2 (6 เดือน) — ปัจจุบัน')}
        ${qBtn('q3', 'Q3 (9 เดือน)')}
        ${qBtn('q4', 'Q4 (12 เดือน)')}
      </div>
    </div>

    <div class="dtl-cards">
      <div class="dtl-card c-actual">
        <div class="dtl-card-label">ผลสะสมปัจจุบัน (ถึงสิ้น ${Q_LABEL[q]})</div>
        <div class="dtl-card-val">${isEvaluated ? `${ovpFmt(s.rawValue)} / ${ovpFmt(target)}` : 'not_evaluated'}</div>
        <div class="dtl-card-sub">${kpi.unit || ''} — ผลสะสมตั้งแต่ต้นปีถึงสิ้นไตรมาสนี้ ไม่ใช่ผลเฉพาะไตรมาส</div>
      </div>
      <div class="dtl-card c-score">
        <div class="dtl-card-label">คะแนนปัจจุบัน (${Q_LABEL[q]})</div>
        <div class="dtl-card-val">${isEvaluated && s.level !== null ? s.level.toFixed(4) : '—'}</div>
        <div class="dtl-card-sub">${isEvaluated ? '' : 'not_evaluated'}</div>
      </div>
      <div class="dtl-card c-fcresult">
        <div class="dtl-card-label">คาดการณ์สิ้นปี</div>
        <div class="dtl-card-val">${fc ? ovpFmt(fc.result) : '—'}</div>
        <div class="dtl-card-sub">${kpi.unit || ''}</div>
      </div>
      <div class="dtl-card c-fcscore">
        <div class="dtl-card-label">คะแนนคาดการณ์สิ้นปี</div>
        <div class="dtl-card-val">${fc && fc.score !== null && fc.score !== undefined ? Number(fc.score).toFixed(4) : '—'}</div>
      </div>
    </div>

    <div class="dtl-section-card">
      <div class="card-title">ความก้าวหน้าเทียบเป้าหมายสิ้นปี</div>
      <div class="dtl-progress-labels"><span>Start · 0</span><span>Target · ${ovpFmt(target)} ${kpi.unit || ''}</span></div>
      <div class="dtl-progress-track"><div class="dtl-progress-fill" style="width:${progressPct !== null ? Math.min(progressPct, 100) : 0}%"></div></div>
      <div class="dtl-progress-stats">
        <div class="dtl-progress-stat">% Progress to Target<b>${progressPct !== null ? progressPct.toFixed(2) + '%' : '—'}</b></div>
        <div class="dtl-progress-stat">Remaining Gap<b>${remainingGap !== null ? remainingGap.toLocaleString('en-US', { maximumFractionDigits: 3 }) + ' ' + (kpi.unit || '') : '—'}</b></div>
        <div class="dtl-progress-stat">Cumulative Result<b>${cumulative !== null ? cumulative.toLocaleString('en-US', { maximumFractionDigits: 3 }) : '—'}</b></div>
      </div>
      ${monthlyMini}
    </div>

    <div class="dtl-section-card">
      <div class="card-title">เปรียบเทียบรายไตรมาส (ใช้ผลสะสมสิ้นไตรมาสเป็นค่าหลัก)</div>
      <table class="dtl-qtable">
        <thead><tr><th>ไตรมาส</th><th>ผลสะสมสิ้นไตรมาส</th><th>% เทียบเป้าหมายสิ้นปี</th><th>คะแนน (Score)</th><th>Target Score</th></tr></thead>
        <tbody>${qRows}</tbody>
      </table>
      <div class="dtl-forecast-row">
        <b>คาดการณ์สิ้นปี (Forecast) — ค่าเดียว ไม่แยกรายไตรมาส:</b>
        <span>ผล ${fc ? ovpFmt(fc.result) : '—'}</span>
        <span>คะแนน ${fc && fc.score !== undefined ? ovpBadge(fc.score) : ovpBadge(null)}</span>
      </div>
    </div>

    <div class="dtl-section-card">
      <div class="card-title">ข้อมูลสนับสนุน</div>
      <div class="dtl-support-grid">
        <div class="dtl-support-item"><div class="dtl-support-label">เอกสารแนบ</div><div class="dtl-support-val empty">${NOT_ATTACHED}</div></div>
        <div class="dtl-support-item"><div class="dtl-support-label">คำจำกัดความ / เงื่อนไข</div><div class="dtl-support-val empty">${NOT_RECORDED}</div></div>
        <div class="dtl-support-item"><div class="dtl-support-label">สูตรการคำนวณ</div><div class="dtl-support-val empty">${NOT_RECORDED}</div></div>
        <div class="dtl-support-item"><div class="dtl-support-label">ประวัติการปรับปรุงเกณฑ์</div><div class="dtl-support-val ${kpi.criteriaRevisionNote ? '' : 'empty'}">${kpi.criteriaRevisionNote ? `มีการปรับค่าเกณฑ์ตามมติคณะกรรมการ กทท. เมื่อวันที่ ${kpi.criteriaBoardApprovalDate || '—'} — ${kpi.criteriaRevisionNote}` : 'ยังไม่มีข้อมูลประวัติ'}</div></div>
        <div class="dtl-support-item" style="grid-column:1/-1">
          <div class="dtl-support-label">เกณฑ์ Level 1-5 (Threshold ${kpi.criteriaRevisionNote ? 'ปัจจุบัน — ปรับปรุงแล้ว' : 'จริงใน Master Data'})</div>
          <table class="dtl-criteria-table">
            <thead><tr><th>Level 1</th><th>Level 2</th><th>Level 3</th><th>Level 4</th><th>Level 5</th></tr></thead>
            <tbody><tr>${kpi.thresholds.map(t => `<td>${t}</td>`).join('')}</tr></tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="dtl-section-card">
      <div class="card-title">ประเด็นที่ต้องปรับปรุง/เฝ้าระวัง</div>
      <div class="dtl-support-grid">
        <div class="dtl-support-item"><div class="dtl-support-label">ปัญหา/อุปสรรค (จากเงื่อนไขหักคะแนน)</div><div class="dtl-support-val ${dedItem ? '' : 'empty'}">${dedItem ? dedItem.reason : NOT_RECORDED}</div></div>
        <div class="dtl-support-item"><div class="dtl-support-label">แนวทางแก้ไข/เร่งรัด (จากมติที่ประชุม)</div><div class="dtl-support-val ${assignItem ? '' : 'empty'}">${assignItem ? assignItem.note : NOT_RECORDED}</div></div>
      </div>
    </div>

    <div class="dtl-section-card">
      <div class="card-title">แนวโน้มและข้อสังเกต</div>
      <div class="dtl-support-grid">
        <div class="dtl-support-item"><div class="dtl-support-label">หมายเหตุผลการดำเนินงาน (${Q_LABEL[q]})</div><div class="dtl-support-val ${noteForQuarter ? '' : 'empty'}">${noteForQuarter || (isEvaluated ? NOT_RECORDED : NOT_EVALUATED_TXT)}</div></div>
        <div class="dtl-support-item"><div class="dtl-support-label">Forecast Commentary</div><div class="dtl-support-val ${fc && fc.note ? '' : 'empty'}">${(fc && fc.note) || NOT_RECORDED}</div></div>
      </div>
    </div>
  `;
}

function renderDetail() {
  const root = document.getElementById('page-detail');
  if (!root) return;
  const activeId = detailRouteKpiId;
  root.innerHTML = `<div class="dtl-shell">
    <aside class="dtl-sidebar">${dtlSidebarHtml(activeId)}</aside>
    <div class="dtl-main">${activeId === '2.4' ? dtl24Main() : dtlPlaceholderMain(activeId)}</div>
    <aside class="dtl-owners">${activeId === '2.4' ? dtlOwnersHtml(MOU_DATA.kpis['2.4']) : ''}</aside>
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
function ovpBadge(level) {
  if (level === null || level === undefined) return '<span class="ovp-badge empty">—</span>';
  return `<span class="ovp-badge" style="background:${lvColor(level)}">${Number(level).toFixed(4)}</span>`;
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
  return ovpFmt(s.rawValue);
}

function ovpRowHtml(kpi, depth, q) {
  const kids = ovpChildren(kpi.id);
  const hasKids = kids.length > 0;
  const expanded = ovpEffectiveExpanded(kpi);
  const s = ovpScoreOf(kpi, q);
  const owner = (kpi.ownerMain && kpi.ownerMain.length) ? kpi.ownerMain.join(', ') : '—';
  const status = ovpStatusOf(kpi, q);
  const alert = ovpHasAlert(kpi.id);
  const rowClass = depth === 0 ? 'ovp-row-main' : 'ovp-row-sub';
  const indent = depth > 0 ? `<span class="ovp-indent" style="width:${depth * 16}px"></span>` : '';
  const toggleCell = hasKids
    ? `<button class="ovp-caret ${expanded ? 'open' : ''}" onclick="ovpToggle('${kpi.id}')" title="ขยาย/ย่อตัวชี้วัดย่อย">▶</button>`
    : `<span class="ovp-caret spacer">▶</span>`;
  return `<tr class="${rowClass}">
    <td><div class="ovp-id-cell">${indent}<b>${kpi.id}</b></div></td>
    <td class="ovp-name-cell">${kpi.label}</td>
    <td>${kpi.groupLabel || '—'}</td>
    <td>${kpi.weight ?? '—'}</td>
    <td>${kpi.unit || '—'}</td>
    <td>${ovpActualCell(kpi, s)}</td>
    <td>${ovpBadge(s.level)}</td>
    <td>${ovpBadge(ovpForecastScore(kpi.id))}</td>
    <td>${ovpBadge(kpi.targetScore)}</td>
    <td class="ovp-owner-txt">${owner}</td>
    <td>${status ? `<span class="ovp-status-txt">${status}</span>` : '<span class="ovp-empty-cell">—</span>'}</td>
    <td><button class="ovp-detail-btn" onclick="ovpDetailClick('${kpi.id}')">ดูรายละเอียด</button></td>
    <td>${alert ? `<span class="ovp-alert-flag" onclick="goToActionPlan()" title="มีประเด็นที่ต้องติดตาม">🔔</span>` : '<span class="ovp-alert-none">—</span>'}</td>
    <td>${toggleCell}</td>
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
  dtlQuarter = 'q2';
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

  const chip = (key, label) => `<button class="ovp-chip ${key !== 'all' ? 'lv' + key : ''} ${ovpState.quick === key ? 'active' : ''}" onclick="ovpSetQuick('${key}')">${label} <b>${counts[key]}</b></button>`;
  const opt = (list, cur) => list.map(v => `<option value="${v}" ${cur === v ? 'selected' : ''}>${v}</option>`).join('');

  root.innerHTML = `
    <div class="ovp-header">
      <div class="ovp-mascot"><img src="assets/mascot-point.png" alt=""></div>
      <div class="ovp-title-wrap">
        <div class="ovp-title">ภาพรวมตัวชี้วัดทั้งหมด</div>
        <div class="ovp-subtitle">แสดงรายละเอียดตัวชี้วัดประจำปีงบประมาณ 2569 · ${Q_LABEL[q]} (${PERIOD_LABEL[q]})</div>
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
          <option value="q2" ${q === 'q2' ? 'selected' : ''}>Q2 (6 เดือน) — ปัจจุบัน</option>
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
      <thead><tr>
        <th>KPI ID</th><th>ชื่อตัวชี้วัด</th><th>กลุ่มตัวชี้วัด</th><th>น้ำหนัก</th><th>หน่วยวัด</th>
        <th>ผลการดำเนินงาน</th><th>คะแนน</th><th>คาดการณ์</th><th>Target</th>
        <th>ผู้บริหาร</th><th>สถานะ</th><th>ดูรายละเอียด</th><th>แจ้งเตือน</th><th>ดูตัวชี้วัดย่อย</th>
      </tr></thead>
      <tbody>${rows.length ? rows.join('') : '<tr><td colspan="14" class="empty-note">ไม่พบตัวชี้วัดที่ตรงกับตัวกรอง</td></tr>'}</tbody>
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
