// alerts.js — "แจ้งเตือน" tab UI (MODIFICATION BRIEF "ALERTS PROTOTYPE V1"). Render layer only —
// every number/severity here comes from alert_engine.js; this file never computes risk itself
// (same separation entry.js keeps from entry_store.js).

const alertState = { filterSeverity: 'all', filterType: 'all' };

function alertSetFilter(key, val) { alertState[key] = val; renderAlerts(); }

function alertEsc(s) { return (typeof entryEsc === 'function') ? entryEsc(s) : String(s || ''); }
function alertFmt(v) { return (typeof ovpFmt === 'function') ? ovpFmt(v) : (v === null || v === undefined ? '—' : v); }

// ═══════════════════════════════════════════════════════════
// HEADER + EMPTY STATE (brief §14 / §21)
// ═══════════════════════════════════════════════════════════
function alertEmptyStateHtml() {
  return `
    <div class="alert-header-card">
      <div class="dtl-page-title">แจ้งเตือนผลการดำเนินงาน • Q3</div>
      <div class="entry-header-sub">ประเด็นที่ควรติดตามและเร่งรัดจากผลการดำเนินงาน 9 เดือน</div>
    </div>
    <div class="alert-empty-card">
      <div class="alert-empty-title">ระบบยังไม่มีข้อมูล Q3 ที่ยืนยันแล้ว</div>
      <div class="alert-empty-body">เมื่อมีการกรอกและยืนยันผล Q3 ระบบจะวิเคราะห์ตัวชี้วัดที่ควรติดตามและเร่งรัดให้อัตโนมัติ</div>
      <button class="entry-btn primary" onclick="document.getElementById('tabBtnEntry').click()">ไปที่กรอกข้อมูล</button>
    </div>
  `;
}

function alertHeaderHtml(counts, confirmedCount, totalLeafCount) {
  const chip = (key) => `<button class="alert-summary-card tone-${key} ${alertState.filterSeverity === key ? 'active' : ''}" onclick="alertSetFilter('filterSeverity','${key}')">
    <div class="alert-summary-count">${counts[key]}</div><div class="alert-summary-label">${ALERT_LEVEL_META[key].label}</div>
  </button>`;
  return `
    <div class="alert-header-card">
      <div class="dtl-page-title">แจ้งเตือนผลการดำเนินงาน • Q3</div>
      <div class="entry-header-sub">ประเด็นที่ควรติดตามและเร่งรัดจากผลการดำเนินงาน 9 เดือน</div>
      <div class="alert-summary-row">${chip('red')}${chip('orange')}${chip('yellow')}</div>
      <div class="alert-subtle">ข้อมูล Q3 ที่ยืนยันแล้ว ${confirmedCount} / ${totalLeafCount} ตัวชี้วัด</div>
      <div class="alert-filterbar">
        <button class="entry-subnav-btn ${alertState.filterSeverity === 'all' ? 'active' : ''}" onclick="alertSetFilter('filterSeverity','all')">ทั้งหมด</button>
        <button class="entry-subnav-btn ${alertState.filterSeverity === 'red' ? 'active' : ''}" onclick="alertSetFilter('filterSeverity','red')">ต้องเร่งรัด</button>
        <button class="entry-subnav-btn ${alertState.filterSeverity === 'orange' ? 'active' : ''}" onclick="alertSetFilter('filterSeverity','orange')">แนวโน้มไม่ถึงเป้า</button>
        <button class="entry-subnav-btn ${alertState.filterSeverity === 'yellow' ? 'active' : ''}" onclick="alertSetFilter('filterSeverity','yellow')">ควรติดตาม</button>
        <span class="alert-filter-sep"></span>
        <button class="entry-subnav-btn ${alertState.filterType === 'all' ? 'active' : ''}" onclick="alertSetFilter('filterType','all')">ทุกประเภท</button>
        <button class="entry-subnav-btn ${alertState.filterType === 'numeric' ? 'active' : ''}" onclick="alertSetFilter('filterType','numeric')">ตัวเลข</button>
        <button class="entry-subnav-btn ${alertState.filterType === 'plan' ? 'active' : ''}" onclick="alertSetFilter('filterType','plan')">แผนการดำเนินงาน</button>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════
// ALERT CARD (brief §15/§16)
// ═══════════════════════════════════════════════════════════
function alertMetricBlockHtml(rec) {
  if (rec.kpi_type === 'numeric') {
    return `
      <div class="alert-metric-row"><span>ผล Q3</span><b>${rec.q3_actual !== null ? alertFmt(rec.q3_actual) : '—'}</b></div>
      <div class="alert-metric-row"><span>Target</span><b>${rec.target !== null ? alertFmt(rec.target) : 'ไม่มีข้อมูล'}</b></div>
      <div class="alert-metric-row"><span>Forecast</span><b>${rec.forecast !== null ? alertFmt(rec.forecast) : 'ไม่มีข้อมูล'}</b></div>
      <div class="alert-metric-row"><span>Gap</span><b>${rec.gap !== null ? alertFmt(rec.gap) : '—'}</b></div>
      <div class="alert-metric-row"><span>Q4 Required</span><b>${rec.q4_required !== null ? alertFmt(rec.q4_required) : '—'}</b></div>
    `;
  }
  const gapTxt = rec.gap !== null ? `${rec.gap >= 0 ? '+' : ''}${rec.gap.toFixed(2)} จุด` : '—';
  return `
    <div class="alert-metric-row"><span>ผล Q3</span><b>${rec.q3_actual !== null ? rec.q3_actual + '%' : '—'}</b></div>
    <div class="alert-metric-row"><span>แผน Q3</span><b>${rec.q3_plan !== null ? rec.q3_plan + '%' : 'ไม่มีข้อมูลแผน'}</b></div>
    <div class="alert-metric-row"><span>ต่ำกว่าแผน</span><b>${gapTxt}</b></div>
    ${rec.baseline_plan_status === 'behind_baseline' && rec.revised_plan_status === 'on_revised'
      ? `<div class="alert-plan-note">ดำเนินการตามแผนปรับ แต่ล่าช้าจากแผนเดิม</div>` : ''}
  `;
}
function alertContactsHtml(contacts) {
  if (!contacts.length) return `<div class="entry-empty-note">ไม่มีข้อมูลผู้รับผิดชอบสนับสนุนสำหรับตัวชี้วัดนี้</div>`;
  return contacts.map(c => `
    <div class="alert-contact-item">
      <div class="alert-contact-pos">${alertEsc(c.position)}</div>
      <div class="alert-contact-row">ชื่อ: ${c.name ? alertEsc(c.name) : '<span class="entry-unspecified">ไม่มีข้อมูล</span>'}</div>
      <div class="alert-contact-row">โทร: ${c.phone ? alertEsc(c.phone) : '<span class="entry-unspecified">ไม่พบข้อมูลติดต่อ</span>'}</div>
      <div class="alert-contact-row">Email: ${c.email ? alertEsc(c.email) : '<span class="entry-unspecified">ไม่พบข้อมูลติดต่อ</span>'}</div>
    </div>`).join('');
}
function alertCardHtml(rec) {
  const meta = ALERT_LEVEL_META[rec.severity];
  const kpi = MOU_DATA.kpis[rec.kpi_id];
  return `
    <div class="alert-card tone-${rec.severity}">
      <div class="alert-card-head">
        <span class="alert-level-badge tone-${rec.severity}">${meta.label}</span>
        <span class="alert-confidence">${rec.confidence === 'LOW' ? 'มีสัญญาณควรติดตาม' : ''}</span>
      </div>
      <div class="alert-card-title"><b>${rec.kpi_id}</b> ${alertEsc(rec.kpi_label)}</div>
      <div class="alert-metric-block">${alertMetricBlockHtml(rec)}</div>
      <div class="alert-reasons">
        <div class="alert-reasons-title">เหตุผลที่ระบบแจ้งเตือน</div>
        ${rec.reasons.map(r => `<div class="alert-reason-item">• ${alertEsc(r.label)}${r.detail ? ` — ${alertEsc(r.detail)}` : ''}</div>`).join('')}
      </div>
      ${rec.deduction_risk ? `<div class="alert-deduction-box">⚠ เงื่อนไขหักคะแนน: ${alertEsc(rec.deduction_risk.reason)}<div class="alert-deduction-status">สถานะ: ${alertEsc(rec.deduction_risk.status)}</div></div>` : ''}
      ${rec.obstacle ? `<div class="dtl-support-item"><div class="dtl-support-label">ปัญหา / อุปสรรค</div><div class="dtl-support-val">${alertEsc(rec.obstacle)}</div></div>` : ''}
      ${rec.solution ? `<div class="dtl-support-item"><div class="dtl-support-label">แนวทางแก้ไข</div><div class="dtl-support-val">${alertEsc(rec.solution)}</div></div>` : ''}
      <div class="alert-contacts">
        <div class="dtl-support-label">ผู้รับผิดชอบสนับสนุน</div>
        ${alertContactsHtml(rec.support_contacts)}
      </div>
      <div class="entry-btn-row">
        <button class="entry-btn ghost" onclick="alertGoToDetail('${rec.kpi_id}')">ดูรายละเอียด</button>
        <button class="entry-btn primary" onclick="alertOpenPreview('${rec.alert_id}')">เตรียมแจ้งผู้รับผิดชอบ</button>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════
// DRILLDOWN (brief §20) — reuses the existing Detail page/route, never a new page
// ═══════════════════════════════════════════════════════════
function alertGoToDetail(kpiId) {
  detailRouteKpiId = kpiId;
  dtlQuarter = 'q3';
  const btn = document.getElementById('tabBtnDetail');
  if (btn) btn.click();
}

// ═══════════════════════════════════════════════════════════
// NOTIFICATION PREVIEW (brief §17/§18) — preview + save-as-prepared only, never sends email
// ═══════════════════════════════════════════════════════════
function alertPreviewBodyText(rec) {
  const lines = [];
  lines.push('จากผลการดำเนินงาน ณ ไตรมาส 3');
  if (rec.kpi_type === 'numeric') {
    lines.push(`พบว่าผลการดำเนินงานอยู่ที่ ${rec.q3_actual !== null ? alertFmt(rec.q3_actual) : 'ไม่มีข้อมูล'} เทียบกับเป้าหมาย ${rec.target !== null ? alertFmt(rec.target) : 'ไม่มีข้อมูล'}${rec.forecast !== null ? ` (คาดการณ์สิ้นปี ${alertFmt(rec.forecast)})` : ''}`);
  } else {
    lines.push(`พบว่าผลการดำเนินงานอยู่ที่ ${rec.q3_actual !== null ? rec.q3_actual + '%' : 'ไม่มีข้อมูล'} เทียบกับแผน ${rec.q3_plan !== null ? rec.q3_plan + '%' : 'ไม่มีข้อมูลแผน'}`);
  }
  lines.push('');
  lines.push('ประเด็นที่ควรติดตาม:');
  rec.reasons.forEach(r => lines.push(`- ${r.label}${r.detail ? ` (${r.detail})` : ''}`));
  if (rec.deduction_risk) lines.push(`- เงื่อนไขหักคะแนน: ${rec.deduction_risk.reason}`);
  lines.push('');
  lines.push('จึงขอให้หน่วยงานพิจารณาเร่งรัด/ติดตามการดำเนินงานในช่วงไตรมาส 4');
  return lines.join('\n');
}
function alertOpenPreview(alertId) {
  const { records } = alertComputeAll();
  const rec = records.find(r => r.alert_id === alertId);
  if (!rec) return;
  const overlay = document.getElementById('quickDetailOverlay');
  if (!overlay) return;
  const toEmails = rec.support_contacts.map(c => c.email).filter(Boolean);
  overlay.innerHTML = `
    <div class="qd-modal alert-preview-modal">
      <div class="qd-head"><div>ตัวอย่างการแจ้งเตือน (ยังไม่ส่งจริง)</div><button class="qd-close" onclick="closeQuickDetail()">&times;</button></div>
      <div class="qd-body">
        <div class="alert-preview-field"><span>ถึง</span><b>${toEmails.length ? alertEsc(toEmails.join(', ')) : '<span class="entry-unspecified">ไม่พบข้อมูลติดต่อ — ต้องระบุผู้รับเอง</span>'}</b></div>
        <div class="alert-preview-field"><span>เรื่อง</span><b>ติดตามผลการดำเนินงานตัวชี้วัด ${rec.kpi_id} ปีบัญชี 2569</b></div>
        <div class="alert-preview-body">${alertEsc(alertPreviewBodyText(rec)).replace(/\n/g, '<br>')}</div>
        <div class="entry-field-row col"><label>หมายเหตุเพิ่มเติม (ถ้ามี)</label><textarea class="entry-input" rows="2" id="alertPrepNote"></textarea></div>
        <div class="entry-btn-row">
          <button class="entry-btn ghost" onclick="closeQuickDetail()">ปิด</button>
          <button class="entry-btn primary" onclick="alertSavePrepared('${rec.alert_id}')">บันทึกเป็นรายการเตรียมแจ้ง</button>
        </div>
        <div id="alertPrepMsg"></div>
      </div>
    </div>`;
  overlay.classList.add('open');
}
function alertSavePrepared(alertId) {
  const { records } = alertComputeAll();
  const rec = records.find(r => r.alert_id === alertId);
  if (!rec) return;
  const note = document.getElementById('alertPrepNote').value;
  const recipient = rec.support_contacts.map(c => c.email).filter(Boolean).join(', ') || null;
  alertSaveAction({ alertId, recipient, note, createdBy: 'ผู้ดูแลระบบ (UAT)' });
  const msg = document.getElementById('alertPrepMsg');
  if (msg) msg.innerHTML = '<div class="entry-validate-box ok">✓ บันทึกเป็นรายการเตรียมแจ้งแล้ว (ยังไม่ส่งอีเมลจริงใน V1 นี้)</div>';
  setTimeout(() => { if (typeof closeQuickDetail === 'function') closeQuickDetail(); }, 1100);
}

// ═══════════════════════════════════════════════════════════
// ROOT RENDER
// ═══════════════════════════════════════════════════════════
function renderAlerts() {
  const root = document.getElementById('page-alerts');
  if (!root) return;
  const { records, confirmedCount, totalLeafCount } = alertComputeAll();
  if (confirmedCount === 0) { root.innerHTML = alertEmptyStateHtml(); return; }

  const counts = { red: 0, orange: 0, yellow: 0 };
  records.forEach(r => counts[r.severity]++);
  const filtered = records.filter(r =>
    (alertState.filterSeverity === 'all' || r.severity === alertState.filterSeverity) &&
    (alertState.filterType === 'all' || r.kpi_type === alertState.filterType));

  root.innerHTML = `
    ${alertHeaderHtml(counts, confirmedCount, totalLeafCount)}
    <div class="alert-grid">${filtered.length ? filtered.map(alertCardHtml).join('') : '<div class="stub-note">ไม่พบรายการตามตัวกรองที่เลือก</div>'}</div>
  `;
}
