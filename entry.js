// entry.js — "กรอกข้อมูล" tab UI (MODIFICATION BRIEF v1.2). Render layer only: every number
// here comes from entry_store.js / engine.js / MOU_DATA, same rule app.js already follows
// (never re-derive a formula in this file).

const entryState = {
  activeKpi: '2.4',
  activeChild: null,
  view: 'form', // 'form' | 'confirm' | 'criteria'
  role: (localStorage.getItem('mou69_entry_role') || 'owner'),
  criteriaKpi: '2.4',
  showFrameworkForm: false,
  showApRevisionFor: null,
  activePlanMonth: 'm7',
  planExpandQuarter: 'q3',
};

const ENTRY_STATUS_ICON = { not_started: '○', pending: '◐', confirmed: '✓', needs_review: '!' };
const ENTRY_STATUS_TITLE = { not_started: 'ยังไม่กรอก', pending: 'รอยืนยัน', confirmed: 'ยืนยันแล้ว', needs_review: 'ต้องตรวจสอบ' };
const ENTRY_KPI_TYPE_TH = { report:'ผลและข้อมูลประกอบ', numeric: 'ตัวเลข', investment: 'ตัวเลข', plan: 'แผนการดำเนินงาน' };

function entrySetRole(role) {
  entryState.role = role;
  localStorage.setItem('mou69_entry_role', role);
  if (role === 'owner') entryState.view = 'form';
  renderEntry();
}
function entrySelectKpi(id) {
  entryState.activeKpi = id;
  entryState.activeChild = ENTRY_KPI_TYPE[id] === 'report' ? reportLeaves(id)[0]?.id || null : null;
  entryState.view = 'form';
  renderEntry();
}
function entrySelectChild(id) {
  entryState.activeChild = id;
  renderEntry();
}
function entrySetView(v) { entryState.view = v; renderEntry(); }

function entryEsc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function entryThaiDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' }); } catch (e) { return iso; }
}
function entryToast(msg) {
  const el = document.getElementById('entryToast');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(window.__entryToastTimer);
  window.__entryToastTimer = setTimeout(() => { el.style.display = 'none'; }, 2600);
}

// ═══════════════════════════════════════════════════════════
// HEADER / LEFT RAIL
// ═══════════════════════════════════════════════════════════
function entryPendingTotal() { return listPendingConfirmations().length + listPendingFrameworkRevisions().length; }
function entryHeaderHtml() {
  const count = pilotProgressCount();
  return `
    <div class="entry-header-card">
      <div class="entry-header-row">
        <div>
          <div class="dtl-page-title">กรอกผลการดำเนินงาน Q3</div>
          <div class="entry-header-sub">เมษายน – มิถุนายน 2569 &nbsp;·&nbsp; สถานะ: <b>ทดสอบระบบ (UAT)</b></div>
        </div>
        <div class="entry-header-right">
          <div class="entry-progress-badge">${count} / ${ENTRY_PILOT_IDS.length} <span>ยืนยันแล้ว</span></div>
          <div class="entry-role-toggle">
            <button class="${entryState.role === 'owner' ? 'active' : ''}" onclick="entrySetRole('owner')">ผู้รับผิดชอบ KPI</button>
            <button class="${entryState.role === 'admin' ? 'active' : ''}" onclick="entrySetRole('admin')">ผู้ดูแลระบบ</button>
          </div>
        </div>
      </div>
      ${entryState.role === 'admin' ? `
      <div class="entry-subnav">
        <button class="${entryState.view === 'form' ? 'active' : ''}" onclick="entrySetView('form')">กรอกข้อมูล</button>
        <button class="${entryState.view === 'confirm' ? 'active' : ''}" onclick="entrySetView('confirm')">ยืนยันข้อมูล (รอยืนยัน: ${entryPendingTotal()})</button>
        <button class="${entryState.view === 'criteria' ? 'active' : ''}" onclick="entrySetView('criteria')">จัดการเกณฑ์ MOU</button>
        <button class="entry-reset-btn" onclick="entryDoReset()">🗑 รีเซ็ตข้อมูลทดสอบ Q3</button>
      </div>` : ''}
    </div>
  `;
}
function entryConfirmModal(message, onConfirm) {
  const overlay = document.getElementById('quickDetailOverlay');
  if (!overlay) { onConfirm(); return; }
  window.__entryConfirmAction = onConfirm;
  overlay.innerHTML = `
    <div class="qd-modal">
      <div class="qd-head"><div>ยืนยันการทำรายการ</div><button class="qd-close" onclick="closeQuickDetail()">&times;</button></div>
      <div class="qd-body">
        <div style="font-size:12.5px;line-height:1.7;white-space:pre-line">${entryEsc(message)}</div>
        <div class="entry-btn-row" style="margin-top:14px">
          <button class="entry-btn ghost" onclick="closeQuickDetail()">ยกเลิก</button>
          <button class="entry-btn primary" onclick="window.__entryConfirmAction();closeQuickDetail()">ยืนยัน</button>
        </div>
      </div>
    </div>`;
  overlay.classList.add('open');
}
function entryDoReset() {
  entryConfirmModal(
    'ยืนยันรีเซ็ตข้อมูลทดสอบ Q3 ทั้งหมด (การกรอก/สถานะรอยืนยัน/ผลยืนยันแล้ว/แผนที่ปรับ)?\nQ1/Q2, ประวัติการปรับเกณฑ์ MOU และกรอบเบิกจ่ายที่ยืนยันแล้วจะไม่ถูกกระทบ\n\nการกระทำนี้ย้อนกลับไม่ได้',
    () => {
      resetQ3UatData();
      entryState.activeChild = null;
      entryState.showFrameworkForm = false;
      entryState.showApRevisionFor = null;
      entryToast('รีเซ็ตข้อมูลทดสอบ Q3 เรียบร้อย');
      renderEntry();
      if (typeof renderHome === 'function') renderHome();
    }
  );
}

function entryLeftListHtml() {
  return `<div class="entry-kpilist">
    ${ENTRY_PILOT_IDS.map(id => {
      const kpi = MOU_DATA.kpis[id];
      const icon = pilotStatusIcon(id);
      const active = entryState.activeKpi === id && entryState.view === 'form';
      return `<div class="entry-kpi-item ${active ? 'active' : ''}" onclick="entrySelectKpi('${id}')">
        <span class="entry-status-icon st-${icon}" title="${ENTRY_STATUS_TITLE[icon]}">${ENTRY_STATUS_ICON[icon]}</span>
        <div class="entry-kpi-item-body">
          <div class="entry-kpi-item-id">${id} · ${ENTRY_KPI_TYPE_TH[ENTRY_KPI_TYPE[id]]}</div>
          <div class="entry-kpi-item-label">${kpi.label}</div>
        </div>
      </div>`;
    }).join('')}
  </div>
  <div class="entry-legend">
    <div><span class="entry-status-icon st-not_started">○</span> ยังไม่กรอก</div>
    <div><span class="entry-status-icon st-pending">◐</span> รอยืนยัน</div>
    <div><span class="entry-status-icon st-confirmed">✓</span> ยืนยันแล้ว</div>
    <div><span class="entry-status-icon st-needs_review">!</span> ต้องตรวจสอบ</div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════
// ISSUES (ปัญหา/อุปสรรค + แนวทางแก้ไข) — optional, brief §F. Quarter-level for numeric/investment
// (no per-KPI mockup asked for per-month capture on 1.1/2.4); per-month for plan (§C6 explicit).
// ═══════════════════════════════════════════════════════════
function entryIssueBlockHtml(kpiId, monthKey, idPrefix) {
  const issue = getIssue(kpiId, monthKey);
  return `<div class="entry-issue-block">
    <div class="entry-field-row col"><label>ปัญหา / อุปสรรค (ถ้ามี)</label>
      <textarea class="entry-input" rows="2" id="${idPrefix}_obstacle" oninput="entryOnIssueInput('${kpiId}','${monthKey}','obstacle_text',this.value)" placeholder="ไม่บังคับกรอก">${entryEsc(issue.obstacle_text)}</textarea>
    </div>
    <div class="entry-field-row col"><label>แนวทางแก้ไข / การดำเนินการต่อ (ถ้ามี)</label>
      <textarea class="entry-input" rows="2" id="${idPrefix}_solution" oninput="entryOnIssueInput('${kpiId}','${monthKey}','solution_text',this.value)" placeholder="ไม่บังคับกรอก">${entryEsc(issue.solution_text)}</textarea>
    </div>
  </div>`;
}
function entryOnIssueInput(kpiId, monthKey, field, val) { setIssue(kpiId, monthKey, { [field]: val }); setEntry(kpiId,{status:'draft'}); }

// ═══════════════════════════════════════════════════════════
// NUMERIC FORM — KPI 2.4 only (brief §3/§4/§5; unchanged by v1.2)
// ═══════════════════════════════════════════════════════════
function entryNumericFormHtml(kpiId) {
  const entry = getEntry(kpiId);
  const units = ENTRY_UNIT_OPTIONS[kpiId];
  const unitKey = entry.unit || (units ? units[0].key : 'default');
  const unitFactor = units ? (units.find(u => u.key === unitKey) || units[0]).factor : 1;

  const rows = ENTRY_Q3_MONTHS.map(m => {
    const norm = entry.monthly[m.key];
    const display = (norm === null || norm === undefined) ? '' : (norm / unitFactor);
    return `<div class="entry-field-row">
      <label>${m.label}</label>
      <input type="number" step="any" class="entry-input" value="${display}" placeholder="ยังไม่ได้กรอก"
        oninput="entryOnNumericInput('${kpiId}','${m.key}',this.value)">
    </div>`;
  }).join('');

  const unitSelector = units ? `<div class="entry-field-row">
      <label>หน่วยที่กรอก</label>
      <select class="entry-input" onchange="entryOnUnitChange('${kpiId}', this.value)">
        ${units.map(u => `<option value="${u.key}" ${u.key === unitKey ? 'selected' : ''}>${u.label}</option>`).join('')}
      </select>
    </div>` : '';

  return `
    <div class="dtl-section-card">
      <div class="card-title">${kpiId} — ${MOU_DATA.kpis[kpiId].label} <span class="entry-type-chip">ตัวเลข</span></div>
      <div class="entry-meta-line">หน่วยหลัก (Master): <b>${MOU_DATA.kpis[kpiId].unit || '—'}</b> &nbsp;·&nbsp; น้ำหนัก ${MOU_DATA.kpis[kpiId].weight}%</div>
      ${unitSelector}
      ${rows}
      <div class="entry-field-row col"><label>สรุปผลการดำเนินงาน Q3</label>
        <textarea class="entry-input" rows="3" oninput="setEntry('${kpiId}', {summary_text:this.value,status:'draft'})" placeholder="อธิบายผลการดำเนินงาน สาเหตุ หรือประเด็นสำคัญ">${entryEsc(entry.summary_text || '')}</textarea>
      </div>
      ${entryIssueBlockHtml(kpiId, 'q3', 'iss_' + kpiId)}
      <div class="entry-note-small">เมื่อยืนยันบันทึก ระบบจะส่งผลสะสม คะแนน และข้อความชุดเดียวกันไปยังหน้ารายละเอียด ภาพรวม และ Home · การแก้ไขร่างจะยังไม่แทนผลที่ยืนยันครั้งล่าสุด</div>
      <div class="entry-btn-row">
        <button class="entry-btn ghost" onclick="entrySaveDraft('${kpiId}')">บันทึกร่าง</button>
        <button class="entry-btn secondary" onclick="entryValidate('${kpiId}')">ตรวจสอบข้อมูล</button>
        <button class="entry-btn primary" onclick="entryConfirmNumeric('${kpiId}')">ยืนยันบันทึก</button>
      </div>
      <div id="entryValidationBox_${kpiId}"></div>
    </div>
  `;
}
function entryOnNumericInput(kpiId, monthKey, val) {
  const entry = getEntry(kpiId);
  setNumericMonth(kpiId, monthKey, val === '' ? null : val, entry.unit);
  entryRefreshPreview();
}
function entryOnUnitChange(kpiId, unitKey) {
  setEntry(kpiId, { unit: unitKey });
  renderEntry();
}
function entrySaveDraft() { entryToast('บันทึกร่างแล้ว'); renderEntry(); }
function entryValidate(kpiId) {
  const v = validateNumeric(kpiId);
  const box = document.getElementById('entryValidationBox_' + kpiId);
  if (box) {
    box.innerHTML = `<div class="entry-validate-box ${v.ok ? 'ok' : 'bad'}">
      ${v.ok ? '✓ ข้อมูลครบถ้วน พร้อมยืนยันบันทึก' : v.issues.map(i => `⚠ ${entryEsc(i)}`).join('<br>')}
    </div>`;
  }
}
function entryConfirmNumeric(kpiId) {
  const r = confirmNumeric(kpiId, 'ผู้รับผิดชอบ KPI (UAT)');
  if (!r.ok) { entryValidate(kpiId); entryToast('ยังยืนยันไม่ได้ — ตรวจสอบข้อมูลอีกครั้ง'); return; }
  entryToast('ยืนยันบันทึก Q3 แล้ว — ผล คะแนน และข้อความเชื่อมไปยังรายละเอียด ภาพรวม และ Home');
  if (typeof renderDetail === 'function') renderDetail();
  if (typeof renderOverview === 'function') renderOverview();
  renderEntry();
  if (typeof renderHome === 'function') renderHome();
}
function entryRefreshPreview() {
  const el = document.getElementById('entryPreviewPanel');
  if (el) el.innerHTML = entryPreviewHtml();
  const list = document.getElementById('entryLeftList');
  if (list) list.innerHTML = entryLeftListHtml();
}

// ═══════════════════════════════════════════════════════════
// KPI 1.1 — INVESTMENT (brief v1.2 §B). Annual Framework panel + ONE shared raw monthly
// table (plan/actual, ล้านบาท) feeding BOTH 1.1.1 and 1.1.2 — no per-child tabs, no manual
// percentage entry (brief §B: "Responsible users must NOT manually enter percentages or scores").
// ═══════════════════════════════════════════════════════════
function entryFrameworkStatusLabel(s) {
  return { active: 'ใช้งานอยู่', pending_admin_confirmation: 'รอผู้ดูแลระบบยืนยัน', superseded: 'ถูกแทนที่แล้ว', rejected: 'ส่งกลับแก้ไข' }[s] || s;
}
function entryToggleFrameworkForm() { entryState.showFrameworkForm = !entryState.showFrameworkForm; renderEntry(); }
function entryAnnualFrameworkPanel() {
  const kpiId = ENTRY_INVESTMENT_KPI;
  const active = getActiveAnnualFramework(kpiId);
  const pending = getPendingAnnualFrameworkRevision(kpiId);
  const hist = getAnnualFrameworkHistory(kpiId);
  return `
    <div class="dtl-section-card entry-framework-card">
      <div class="card-title">ข้อมูลตั้งต้นประจำปี — กรอบเบิกจ่ายทั้งปี ${active.fiscalYear}</div>
      <div class="entry-framework-amount">${active.amount.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} <span>ล้านบาท</span></div>
      <div class="entry-framework-meta">Version ${active.version} &nbsp;·&nbsp; มีผลตั้งแต่ ${entryThaiDate(active.effectiveDate)}</div>
      ${active.sourceNote ? `<div class="entry-framework-source">${entryEsc(active.sourceNote)}</div>` : ''}
      ${pending
        ? `<div class="entry-todo-note">⏳ มีคำขอปรับกรอบเป็น <b>${Number(pending.amount).toLocaleString('en-US', { maximumFractionDigits: 3 })} ล้านบาท</b> (มีผลตั้งแต่ ${entryThaiDate(pending.effectiveDate)}) — รอผู้ดูแลระบบยืนยัน</div>`
        : `<div class="entry-btn-row"><button class="entry-btn ghost small" onclick="entryToggleFrameworkForm()">${entryState.showFrameworkForm ? 'ยกเลิก' : 'แจ้งปรับกรอบเบิกจ่าย'}</button></div>`}
      <div id="entryFrameworkRevisionForm">${(entryState.showFrameworkForm && !pending) ? entryFrameworkRevisionFormHtml(active) : ''}</div>
      ${hist.length > 1 ? `<details class="entry-framework-history"><summary>ประวัติเวอร์ชัน (${hist.length})</summary>
        <table class="dtl-qtable"><thead><tr><th>เวอร์ชัน</th><th>จำนวน (ล้านบาท)</th><th>มีผลตั้งแต่</th><th>สถานะ</th><th>เหตุผล / หมายเหตุ</th><th>เอกสาร</th></tr></thead>
        <tbody>${hist.slice().reverse().map(v => `<tr>
          <td>v${v.version}</td><td>${v.amount.toLocaleString('en-US', { maximumFractionDigits: 3 })}</td><td>${entryThaiDate(v.effectiveDate)}</td>
          <td>${entryFrameworkStatusLabel(v.status)}</td><td>${entryEsc(v.reason || v.sourceNote || '')}</td>
          <td>${v.evidenceUrl ? `<a href="${entryEsc(v.evidenceUrl)}" target="_blank" rel="noopener">เปิดเอกสาร ↗</a>` : '—'}</td>
        </tr>`).join('')}</tbody></table>
      </details>` : ''}
    </div>
  `;
}
function entryFrameworkRevisionFormHtml(active) {
  return `<div class="entry-revision-form">
    <div class="entry-field-row"><label>กรอบเดิม</label><input class="entry-input" value="${active.amount.toLocaleString('en-US', { maximumFractionDigits: 3 })} ล้านบาท" disabled></div>
    <div class="entry-field-row"><label>กรอบใหม่ (ล้านบาท)</label><input type="number" step="any" class="entry-input" id="fwNewAmount"></div>
    <div class="entry-field-row"><label>มีผลตั้งแต่</label><input type="date" class="entry-input" style="max-width:200px" id="fwEffectiveDate"></div>
    <div class="entry-field-row col"><label>เหตุผลในการปรับ</label><textarea class="entry-input" rows="2" id="fwReason" placeholder="เช่น ปรับตามหนังสือกระทรวง..."></textarea></div>
    <div class="entry-field-row"><label>หน่วยงาน / หนังสืออ้างอิง</label><input class="entry-input" id="fwReferenceDoc"></div>
    <div class="entry-field-row"><label>เอกสารประกอบ (Google Drive URL)</label><input class="entry-input" id="fwEvidenceUrl" placeholder="https://drive.google.com/..."></div>
    <div class="entry-btn-row">
      <button class="entry-btn ghost" onclick="entryToggleFrameworkForm()">ยกเลิก</button>
      <button class="entry-btn primary" onclick="entrySubmitFrameworkRevision()">ส่งคำขอปรับกรอบ</button>
    </div>
    <div id="entryFwMsg"></div>
  </div>`;
}
function entrySubmitFrameworkRevision() {
  const r = requestAnnualFrameworkRevision(ENTRY_INVESTMENT_KPI, {
    newAmount: document.getElementById('fwNewAmount').value,
    effectiveDate: document.getElementById('fwEffectiveDate').value,
    reason: document.getElementById('fwReason').value,
    referenceDoc: document.getElementById('fwReferenceDoc').value,
    evidenceUrl: document.getElementById('fwEvidenceUrl').value,
    createdBy: 'ผู้รับผิดชอบ KPI (UAT)',
  });
  const msg = document.getElementById('entryFwMsg');
  if (!r.ok) { msg.innerHTML = `<div class="entry-validate-box bad">${r.issues.map(i => `⚠ ${entryEsc(i)}`).join('<br>')}</div>`; return; }
  entryState.showFrameworkForm = false;
  entryToast('ส่งคำขอปรับกรอบแล้ว — สถานะ "รอผู้ดูแลระบบยืนยัน"');
  renderEntry();
}

function entryInvestmentFormHtml() {
  const kpiId = ENTRY_INVESTMENT_KPI;
  const raw = getInvestmentRaw();
  const result = computeInvestmentResult();

  const rows = ENTRY_Q3_MONTHS.map(m => `
    <tr>
      <td>${m.label}</td>
      <td><input type="number" step="any" class="entry-input" value="${raw[m.key].plan ?? ''}" placeholder="ล้านบาท" oninput="entryOnInvestmentInput('${m.key}','plan',this.value)"></td>
      <td><input type="number" step="any" class="entry-input" value="${raw[m.key].actual ?? ''}" placeholder="ล้านบาท" oninput="entryOnInvestmentInput('${m.key}','actual',this.value)"></td>
    </tr>`).join('');

  return `
    ${entryAnnualFrameworkPanel()}
    <div class="dtl-section-card">
      <div class="card-title">1.1 ความสามารถในการบริหารแผนลงทุน <span class="entry-type-chip">ตัวเลข — ข้อมูลต้นทางร่วม 1.1.1/1.1.2</span></div>
      <div class="entry-meta-line">กรอกยอดเบิกจ่ายรายเดือน (ล้านบาท) ระบบจะคำนวณ 1.1.1 และ 1.1.2 ให้อัตโนมัติ — ห้ามกรอกร้อยละหรือคะแนนเอง</div>
      <table class="entry-raw-table">
        <thead><tr><th>เดือน</th><th>แผนเบิกจ่ายเดือนนี้ (ล้านบาท)</th><th>เบิกจ่ายจริงเดือนนี้ (ล้านบาท)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${entryIssueBlockHtml(kpiId, 'q3', 'iss_' + kpiId)}
      <div class="entry-btn-row">
        <button class="entry-btn ghost" onclick="entrySaveDraft()">บันทึกร่าง</button>
        <button class="entry-btn secondary" onclick="entryValidateInvestment()">ตรวจสอบข้อมูล</button>
        <button class="entry-btn primary" onclick="entryConfirmInvestment()">ยืนยันบันทึก</button>
      </div>
      <div id="entryValidationBox_1.1"></div>
    </div>
  `;
}
function entryOnInvestmentInput(monthKey, field, val) {
  setInvestmentMonth(monthKey, field, val);
  entryRefreshPreview();
}
function entryValidateInvestment() {
  const v = validateInvestment();
  const box = document.getElementById('entryValidationBox_1.1');
  if (box) box.innerHTML = `<div class="entry-validate-box ${v.ok ? 'ok' : 'bad'}">${v.ok ? '✓ ข้อมูลครบถ้วน พร้อมยืนยันบันทึก' : v.issues.map(i => `⚠ ${entryEsc(i)}`).join('<br>')}</div>`;
}
function entryConfirmInvestment() {
  const r = confirmInvestment('ผู้รับผิดชอบ KPI (UAT)');
  if (!r.ok) { entryValidateInvestment(); entryToast('ยังยืนยันไม่ได้ — ตรวจสอบข้อมูลอีกครั้ง'); return; }
  entryToast('ยืนยันบันทึก Q3 เรียบร้อย — คำนวณ 1.1.1/1.1.2 และ Parent 1.1 แล้ว');
  renderEntry();
  if (typeof renderHome === 'function') renderHome();
}

// ═══════════════════════════════════════════════════════════
// KPI 2.7 — ANNUAL ACTION PLAN + MONTHLY REPORT (brief v1.2 §C)
// ═══════════════════════════════════════════════════════════
function entryProjectLeaves() {
  return ['2.7.1', '2.7.2', '2.7.3.1', '2.7.3.2', '2.7.4'].map(id => MOU_DATA.kpis[id]);
}
function entryToggleApRevisionForm(kpiId) {
  entryState.showApRevisionFor = entryState.showApRevisionFor === kpiId ? null : kpiId;
  renderEntry();
}
// ── Annual compact strip (12 months, grouped by quarter) — replaces the old always-open
// full-ladder list to cut vertical space. Click a quarter to expand only that quarter's months.
function entryPlanMonthCardHtml(mm) {
  if (mm.planned_percent === null) {
    return `<div class="entry-plan-monthcard empty">
      <div class="entry-plan-monthname">${mm.label}</div>
      <div class="entry-empty-note">ไม่มีข้อมูลแผนสำหรับเดือนนี้ในข้อมูลต้นทาง</div>
    </div>`;
  }
  return `<div class="entry-plan-monthcard ${mm.baseline_or_revised === 'revised' ? 'revised' : ''}">
    <div class="entry-plan-monthname">${mm.label}${mm.baseline_or_revised === 'revised' ? ' <span class="entry-type-chip">แผนปรับ</span>' : ''}</div>
    <div class="entry-plan-monthrow"><span>กิจกรรมตามแผน</span><b>${entryEsc(mm.planned_activity)}</b></div>
    <div class="entry-plan-monthrow"><span>เป้าหมายสะสม</span><b>${mm.planned_percent}%</b></div>
    ${mm.note ? `<div class="entry-plan-monthnote">${entryEsc(mm.note)}</div>` : ''}
  </div>`;
}
function entryTogglePlanQuarter(q) {
  entryState.planExpandQuarter = entryState.planExpandQuarter === q ? null : q;
  renderEntry();
}
function entryAnnualStripHtml(kpiId, monthly) {
  const quarters = ['q1', 'q2', 'q3', 'q4'];
  return `<div class="entry-plan-strip">
    ${quarters.map(q => {
      const months = ENTRY_FISCAL_MONTHS.filter(m => m.quarter === q);
      const open = entryState.planExpandQuarter === q;
      const hasData = months.some(m => monthly[m.key].planned_percent !== null);
      return `<div class="entry-plan-qgroup ${open ? 'open' : ''}">
        <button class="entry-plan-qhead" onclick="entryTogglePlanQuarter('${q}')">
          <span class="entry-plan-qlabel">${ENTRY_FISCAL_QUARTER_LABEL[q]}${q === 'q3' ? ' (ปัจจุบัน)' : ''}</span>
          <span class="entry-plan-qmonths">${months.map(m => {
            const mm = monthly[m.key];
            return `<span class="entry-plan-mchip ${mm.planned_percent !== null ? 'has-data' : ''} ${mm.baseline_or_revised === 'revised' ? 'revised' : ''}">${m.label}${mm.planned_percent !== null ? ` · ${mm.planned_percent}%` : ''}</span>`;
          }).join('')}</span>
          <span class="entry-plan-qcaret">${open ? '▾' : '▸'}</span>
        </button>
        ${open ? `<div class="entry-plan-qbody">${hasData ? months.map(m => entryPlanMonthCardHtml(monthly[m.key])).join('') : '<div class="entry-empty-note">ไม่มีข้อมูลแผนสำหรับไตรมาสนี้ในข้อมูลต้นทาง</div>'}</div>` : ''}
      </div>`;
    }).join('')}
  </div>`;
}
function entryActionPlanBlockHtml(kpiId) {
  const plan = getActionPlan(kpiId);
  if (!plan.baseline) {
    return `<div class="dtl-section-card"><div class="stub-note">ยังไม่มี Action Plan (Baseline) สำหรับโครงการนี้ใน Master Data</div></div>`;
  }
  const activities = plan.revised || plan.baseline;
  const monthly = getActionPlanMonthly(kpiId);
  if (entryState.planExpandQuarter === undefined) entryState.planExpandQuarter = 'q3';

  const fullLadderRows = activities.map(a => {
    const pct = a.expected_progress_percent;
    return `<div class="entry-timeline-row">
      <div class="entry-timeline-pct">${pct !== null ? pct + '%' : '—'}</div>
      <div class="entry-timeline-bar-wrap"><div class="entry-timeline-bar" style="width:${pct || 0}%"></div></div>
      <div class="entry-timeline-label">${entryEsc(a.activity_name)}${!a.start_month ? '<span class="entry-unspecified"> (ไม่ระบุช่วงเวลาในข้อมูลต้นทาง)</span>' : ''}</div>
    </div>`;
  }).join('');

  return `
    <div class="dtl-section-card entry-actionplan-card">
      <div class="card-title">แผนการดำเนินงานประจำปี 2569 ${plan.baselineSource === 'master' ? '<span class="entry-type-chip">Baseline จาก Master Data</span>' : ''}</div>
      ${entryAnnualStripHtml(kpiId, monthly)}
      ${plan.revised ? `<div class="entry-criteria-note">⚑ มีการปรับแผน เมื่อ ${entryThaiDate(plan.revisedAt ? plan.revisedAt.slice(0, 10) : null)} — เหตุผล: ${entryEsc(plan.revisionReason)}${plan.revisionEvidenceUrl ? ` · <a href="${entryEsc(plan.revisionEvidenceUrl)}" target="_blank" rel="noopener">เอกสาร ↗</a>` : ''}
        <br>Baseline เดิมยังคงอยู่ครบถ้วน (ดูแผนเต็มด้านล่าง)</div>` : ''}
      <details class="entry-framework-history"><summary>ดูแผนเต็มทั้งหมด (${activities.length} กิจกรรม)</summary>
        <div class="entry-timeline">${fullLadderRows}</div>
      </details>
      ${plan.revisionHistory && plan.revisionHistory.length ? `<details class="entry-framework-history"><summary>ประวัติการปรับแผนเพิ่มเติม (${plan.revisionHistory.length})</summary>
        <table class="dtl-qtable"><thead><tr><th>ปรับเมื่อ</th><th>เหตุผล</th></tr></thead>
        <tbody>${plan.revisionHistory.map(h => `<tr><td>${entryThaiDate(h.revisedAt ? h.revisedAt.slice(0, 10) : null)}</td><td>${entryEsc(h.reason || '')}</td></tr>`).join('')}</tbody></table>
      </details>` : ''}
      <div class="entry-btn-row"><button class="entry-btn ghost small" onclick="entryToggleApRevisionForm('${kpiId}')">${entryState.showApRevisionFor === kpiId ? 'ยกเลิก' : 'ขอปรับแผนการดำเนินงาน'}</button></div>
      <div id="entryApRevisionForm_${kpiId}">${entryState.showApRevisionFor === kpiId ? entryActionPlanRevisionFormHtml(kpiId, activities) : ''}</div>
    </div>
  `;
}
function entryActionPlanRevisionFormHtml(kpiId, activities) {
  return `<div class="entry-revision-form">
    ${activities.map((a, i) => `<div class="entry-field-row"><label>${entryEsc(a.activity_name)}</label><input type="number" step="any" class="entry-input" style="max-width:100px" id="apPct_${kpiId}_${i}" value="${a.expected_progress_percent ?? ''}"> %</div>`).join('')}
    <div class="entry-field-row col"><label>เหตุผลในการปรับแผน</label><textarea class="entry-input" rows="2" id="apReason_${kpiId}" placeholder="บังคับกรอก"></textarea></div>
    <div class="entry-field-row"><label>เอกสารประกอบ (Google Drive URL, ถ้ามี)</label><input class="entry-input" id="apEvidence_${kpiId}"></div>
    <div class="entry-btn-row">
      <button class="entry-btn ghost" onclick="entryToggleApRevisionForm('${kpiId}')">ยกเลิก</button>
      <button class="entry-btn primary" onclick="entrySubmitApRevision('${kpiId}')">บันทึกแผนที่ปรับ</button>
    </div>
    <div id="entryApMsg_${kpiId}"></div>
  </div>`;
}
function entrySubmitApRevision(kpiId) {
  const plan = getActionPlan(kpiId);
  const baseActivities = plan.revised || plan.baseline;
  const activities = baseActivities.map((a, i) => Object.assign({}, a, { expected_progress_percent: (() => { const v = document.getElementById(`apPct_${kpiId}_${i}`).value; return v === '' ? null : Number(v); })() }));
  const r = requestActionPlanRevision(kpiId, activities, {
    reason: document.getElementById(`apReason_${kpiId}`).value,
    evidenceUrl: document.getElementById(`apEvidence_${kpiId}`).value,
    revisedBy: 'ผู้รับผิดชอบ KPI (UAT)',
  });
  const msg = document.getElementById(`entryApMsg_${kpiId}`);
  if (!r.ok) { msg.innerHTML = `<div class="entry-validate-box bad">${r.issues.map(i => `⚠ ${entryEsc(i)}`).join('<br>')}</div>`; return; }
  entryState.showApRevisionFor = null;
  entryToast('บันทึกแผนที่ปรับแล้ว — Baseline เดิมยังคงอยู่');
  renderEntry();
}

function entryPlanFormHtml(kpiId) {
  const projects = entryProjectLeaves();
  const entry = getEntry(kpiId);
  const activeMonth = entryState.activePlanMonth || 'm7';

  const projectPills = projects.map(p => {
    const icon = leafStatusIcon(p.id);
    return `<button class="entry-project-pill ${kpiId === p.id ? 'active' : ''}" onclick="entrySelectChild('${p.id}')">
      <span class="entry-status-icon st-${icon}">${ENTRY_STATUS_ICON[icon]}</span> ${p.id}
    </button>`;
  }).join('');

  const monthTabs = ENTRY_Q3_MONTHS.map(m => `<button class="dtl-qbtn ${activeMonth === m.key ? 'active' : ''}" onclick="entrySetPlanMonth('${m.key}')">${m.label}</button>`).join('');
  const monthPlan = getActionPlanMonthly(kpiId)[activeMonth];

  const m = entry.monthly[activeMonth];
  const locked = m.submission_status !== 'draft';
  const suggestion = suggestForPlanKpi(kpiId, m.progress_text, m.reported_percent);

  const evidenceList = m.evidence_links.length
    ? m.evidence_links.map(ev => `<div class="entry-evidence-chip">
        <a href="${entryEsc(ev.url)}" target="_blank" rel="noopener">${entryEsc(ev.title)} ↗</a>
        <span class="entry-evidence-type">${entryEsc(ev.document_type)}</span>
        ${!locked ? `<button class="entry-evidence-del" onclick="entryRemoveEvidence('${kpiId}','${activeMonth}','${ev.id}')">×</button>` : ''}
      </div>`).join('')
    : `<div class="entry-empty-note">ยังไม่มีเอกสารประกอบ</div>`;

  return `
    <div class="entry-project-pills">${projectPills}</div>
    ${entryActionPlanBlockHtml(kpiId)}
    <div class="dtl-section-card">
      <div class="card-title">${kpiId} — ${MOU_DATA.kpis[kpiId].label} <span class="entry-type-chip plan">แผนการดำเนินงาน</span></div>
      <div class="dtl-quarter-tabs" style="margin-top:2px">${monthTabs}</div>

      <div class="entry-plan-thismonth ${monthPlan.planned_percent === null ? 'empty' : ''}">
        ${monthPlan.planned_percent !== null
          ? `<div><span>กิจกรรมตามแผนเดือนนี้</span><b>${entryEsc(monthPlan.planned_activity)}</b></div><div><span>เป้าหมายสะสมเดือนนี้</span><b>${monthPlan.planned_percent}%</b></div>`
          : `<div class="entry-empty-note">ไม่มีข้อมูลแผนสำหรับเดือนนี้ในข้อมูลต้นทาง</div>`}
      </div>

      <div class="entry-field-row col">
        <label>ความคืบหน้าเดือนนี้ (Narrative)</label>
        <textarea class="entry-input" rows="3" ${locked ? 'disabled' : ''}
          oninput="entryOnPlanNarrative('${kpiId}','${activeMonth}',this.value)"
          placeholder="เช่น จัดทำ TOR แล้วเสร็จ และเสนอฝ่ายบริหารพิจารณาแล้ว...">${entryEsc(m.progress_text)}</textarea>
      </div>

      <div id="entrySuggestBox_${kpiId}_${activeMonth}">${entrySuggestBoxInnerHtml(suggestion)}</div>

      <div class="entry-field-row">
        <label>ผลการดำเนินงานที่หน่วยงานรายงาน (%)</label>
        <input type="number" min="0" max="100" step="any" class="entry-input" style="max-width:140px" value="${m.reported_percent ?? ''}"
          ${locked ? 'disabled' : ''} oninput="entryOnPlanPercent('${kpiId}','${activeMonth}',this.value)">
      </div>

      <div class="entry-field-row col">
        <label>ปัญหา / อุปสรรค (ถ้ามี)</label>
        <textarea class="entry-input" rows="2" ${locked ? 'disabled' : ''} oninput="entryOnPlanObstacle('${kpiId}','${activeMonth}',this.value)" placeholder="ไม่บังคับกรอก">${entryEsc(m.obstacle_text)}</textarea>
      </div>
      <div class="entry-field-row col">
        <label>แนวทางแก้ไข / การดำเนินการต่อ (ถ้ามี)</label>
        <textarea class="entry-input" rows="2" ${locked ? 'disabled' : ''} oninput="entryOnPlanSolution('${kpiId}','${activeMonth}',this.value)" placeholder="ไม่บังคับกรอก">${entryEsc(m.solution_text)}</textarea>
      </div>

      <div class="entry-field-row col">
        <label>เอกสารประกอบ</label>
        ${evidenceList}
        ${!locked ? `<div class="entry-evidence-form">
          <input id="evTitle_${kpiId}_${activeMonth}" class="entry-input" placeholder="ชื่อเอกสาร">
          <input id="evUrl_${kpiId}_${activeMonth}" class="entry-input" placeholder="Google Drive URL">
          <select id="evType_${kpiId}_${activeMonth}" class="entry-input">${ENTRY_DOCUMENT_TYPES.map(t => `<option>${t}</option>`).join('')}</select>
          <button class="entry-btn ghost small" onclick="entryAddEvidence('${kpiId}','${activeMonth}')">+ เพิ่มเอกสารประกอบ</button>
        </div>` : ''}
      </div>

      <div class="entry-plan-status">สถานะ: <b>${entryPlanStatusLabel(m.submission_status)}</b>${m.submitted_at ? ` · ส่งเมื่อ ${new Date(m.submitted_at).toLocaleString('th-TH')}` : ''}</div>

      <div class="entry-btn-row">
        <button class="entry-btn ghost" ${locked ? 'disabled' : ''} onclick="entrySaveDraft()">บันทึกร่าง</button>
        <button class="entry-btn primary" ${locked ? 'disabled' : ''} onclick="entrySubmitPlan('${kpiId}','${activeMonth}')">ส่งข้อมูล (Submit)</button>
      </div>
      <div id="entryValidationBox_${kpiId}"></div>
    </div>
  `;
}
function entryPlanStatusLabel(s) {
  return { draft: 'ร่าง (ยังไม่ส่ง)', pending_confirmation: 'รอยืนยัน', confirmed: 'ยืนยันแล้ว' }[s] || s;
}
function entrySetPlanMonth(m) { entryState.activePlanMonth = m; renderEntry(); }
function entrySuggestBoxInnerHtml(suggestion) {
  if (!suggestion.hits.length && !suggestion.expectedStep) return '';
  return `<div class="entry-suggest-box">
    <div class="entry-suggest-title">🤖 ระบบแนะนำ (ต้องตรวจสอบโดยผู้ดูแลระบบ — ไม่ใช่ผลสุดท้าย)</div>
    ${suggestion.hits.map(h => `<div class="entry-suggest-row">กิจกรรม “<b>${entryEsc(h.activityLabel)}</b>” → ${h.statusLabel} <span class="entry-suggest-snip">“${entryEsc(h.snippet)}”</span></div>`).join('')}
    ${suggestion.expectedStep ? `<div class="entry-suggest-row">ตาม % ที่รายงาน ควรอยู่ที่ขั้นตอน: <b>${entryEsc(suggestion.expectedStep.activity_name)}</b></div>` : ''}
    <div class="entry-suggest-row">% แนะนำโดยระบบ (จาก Narrative): <b>${suggestion.suggestedPercent !== null ? suggestion.suggestedPercent + '%' : '—'}</b>
      ${suggestion.suggestedLevel !== null ? ` · ระดับเกณฑ์ MOU ที่อาจเกี่ยวข้อง: <b>${suggestion.suggestedLevel.toFixed(2)}</b>` : ''}
      ${suggestion.manualLevelRequired ? ' · มาตราวัดพิเศษ ต้องให้ผู้ดูแลระบบเลือกระดับเอง' : ''}
    </div>
  </div>`;
}
function entryOnPlanNarrative(kpiId, monthKey, val) {
  setPlanMonthDraft(kpiId, monthKey, { progress_text: val });
  entryRefreshPreview();
  const box = document.getElementById(`entrySuggestBox_${kpiId}_${monthKey}`);
  if (box) box.innerHTML = entrySuggestBoxInnerHtml(suggestForPlanKpi(kpiId, val, getEntry(kpiId).monthly[monthKey].reported_percent));
}
function entryOnPlanPercent(kpiId, monthKey, val) {
  setPlanMonthDraft(kpiId, monthKey, { reported_percent: val === '' ? null : Number(val) });
  entryRefreshPreview();
  const box = document.getElementById(`entrySuggestBox_${kpiId}_${monthKey}`);
  if (box) box.innerHTML = entrySuggestBoxInnerHtml(suggestForPlanKpi(kpiId, getEntry(kpiId).monthly[monthKey].progress_text, val === '' ? null : Number(val)));
}
function entryOnPlanObstacle(kpiId, monthKey, val) { setPlanMonthDraft(kpiId, monthKey, { obstacle_text: val }); }
function entryOnPlanSolution(kpiId, monthKey, val) { setPlanMonthDraft(kpiId, monthKey, { solution_text: val }); }
function entryAddEvidence(kpiId, monthKey) {
  const title = document.getElementById(`evTitle_${kpiId}_${monthKey}`).value.trim();
  const url = document.getElementById(`evUrl_${kpiId}_${monthKey}`).value.trim();
  const type = document.getElementById(`evType_${kpiId}_${monthKey}`).value;
  if (!title || !url) { entryToast('กรุณากรอกชื่อเอกสารและ URL'); return; }
  addEvidenceLink(kpiId, monthKey, { title, url, documentType: type });
  renderEntry();
}
function entryRemoveEvidence(kpiId, monthKey, evId) { removeEvidenceLink(kpiId, monthKey, evId); renderEntry(); }
function entrySubmitPlan(kpiId, monthKey) {
  const r = submitPlanMonth(kpiId, monthKey);
  const box = document.getElementById('entryValidationBox_' + kpiId);
  if (!r.ok) { if (box) box.innerHTML = `<div class="entry-validate-box bad">${r.issues.map(i => `⚠ ${entryEsc(i)}`).join('<br>')}</div>`; return; }
  entryToast('ส่งข้อมูลแล้ว — สถานะ "รอยืนยัน" (คะแนน Dashboard ยังไม่เปลี่ยนจนกว่าผู้ดูแลระบบจะยืนยัน)');
  renderEntry();
}

// ═══════════════════════════════════════════════════════════
// CENTER + RIGHT dispatch
// ═══════════════════════════════════════════════════════════
function entryCenterHtml() {
  if(ENTRY_KPI_TYPE[entryState.activeKpi]==='report') return reportFormHtml(reportActiveId());
  if (entryState.activeKpi === '1.1') return entryInvestmentFormHtml();
  if (entryState.activeKpi === '2.7') {
    if (!entryState.activeChild) entryState.activeChild = '2.7.1';
    return entryPlanFormHtml(entryState.activeChild);
  }
  return entryNumericFormHtml(entryState.activeKpi); // 2.4
}

function entryPreviewHtml() {
  if(ENTRY_KPI_TYPE[entryState.activeKpi]==='report') return reportPreviewHtml(reportActiveId());
  if (entryState.activeKpi === '1.1') return entryInvestmentPreviewHtml();
  const kpiId = entryState.activeKpi === '2.7' ? (entryState.activeChild || '2.7.1') : '2.4';
  const type = ENTRY_KPI_TYPE[kpiId];
  const kpi = getEffectiveKpi(kpiId);
  const fc = MOU_DATA.forecast[kpiId];

  if (type === 'numeric') {
    const r = computeNumericResult(kpiId);
    const preview = r.previewCumulative !== null ? scoreLeafKPI(kpi, r.previewCumulative, 'q3') : { level: null, weightedValue: null };
    const mgmt = computeManagementStatus(kpiId, 'q3');
    return `
      <div class="mini-card">
        <div class="mini-title">ผลการคำนวณ (Preview)</div>
        <div class="entry-preview-row"><span>ผลรวมเฉพาะ Q3</span><b>${r.quarterResult !== null ? ovpFmt(r.quarterResult) : '—'}</b></div>
        <div class="entry-preview-row"><span>สะสม Q1–Q3</span><b>${r.previewCumulative !== null ? ovpFmt(r.previewCumulative) : '—'}</b></div>
        <div class="entry-preview-row"><span>วิธีคำนวณ</span><b>SUM รายเดือน + สะสมเดิม</b></div>
      </div>
      <div class="mini-card">
        <div class="mini-title">เทียบเกณฑ์ MOU (Level 1-5)</div>
        <table class="dtl-criteria-table"><thead><tr>${[1,2,3,4,5].map(l => `<th>L${l}</th>`).join('')}</tr></thead>
        <tbody><tr>${kpi.thresholds.map(t => `<td>${t}</td>`).join('')}</tr></tbody></table>
        ${kpi.criteriaRevisionNote ? `<div class="entry-criteria-note">⚑ ${entryEsc(kpi.criteriaRevisionNote)}${kpi.criteriaBoardApprovalDate ? ` (มติ กทท. ${kpi.criteriaBoardApprovalDate})` : ''}</div>` : ''}
      </div>
      <div class="mini-card">
        <div class="mini-title">คะแนนที่คำนวณได้</div>
        <div class="highlight-score" style="color:${lvColor(preview.level)}">${preview.level !== null ? preview.level.toFixed(4) : '—'}<span class="score-of">/5</span></div>
        <div class="entry-preview-row"><span>Weighted Score</span><b>${preview.weightedValue !== null ? preview.weightedValue.toFixed(4) : '—'}</b></div>
        ${fc ? `<div class="entry-preview-row"><span>Forecast สิ้นปี</span><b>${ovpFmt(fc.result)} (คะแนน ${fc.score !== undefined ? Number(fc.score).toFixed(2) : '—'})</b></div>` : ''}
        ${mgmt ? `<div class="entry-mgmt-badge tone-${mgmt.tone}">${mgmt.label}</div>` : ''}
      </div>
    `;
  }

  // plan preview
  const activeMonth = entryState.activePlanMonth || 'm7';
  const entry = getEntry(kpiId);
  const m = entry.monthly[activeMonth];
  const suggestion = suggestForPlanKpi(kpiId, m.progress_text, m.reported_percent);
  const mgmt = computeManagementStatus(kpiId, 'q3');
  const conf = entry.adminConfirmation && entry.adminConfirmation[activeMonth];
  return `
    <div class="mini-card">
      <div class="mini-title">ผลการวิเคราะห์ (Preview)</div>
      <div class="entry-preview-row"><span>% ที่หน่วยงานรายงาน</span><b>${m.reported_percent ?? '—'}${m.reported_percent !== null ? '%' : ''}</b></div>
      <div class="entry-preview-row"><span>% ที่ระบบแนะนำ</span><b>${suggestion.suggestedPercent !== null ? suggestion.suggestedPercent + '%' : '—'}</b></div>
      <div class="entry-preview-row"><span>เอกสารประกอบ</span><b>${m.evidence_links.length} รายการ</b></div>
      <div class="entry-preview-row"><span>สถานะ</span><b>${entryPlanStatusLabel(m.submission_status)}</b></div>
    </div>
    <div class="mini-card">
      <div class="mini-title">การตรวจสอบก่อนบันทึก</div>
      <div class="entry-validate-box ${m.progress_text ? 'ok' : 'bad'}">${m.progress_text ? '✓ มี Narrative' : '⚠ ยังไม่มี Narrative'}</div>
      <div class="entry-validate-box ${m.reported_percent !== null ? 'ok' : 'bad'}">${m.reported_percent !== null ? '✓ มี % ที่รายงาน' : '⚠ ยังไม่มี %'}</div>
      <div class="entry-validate-box ${m.evidence_links.length ? 'ok' : 'warn'}">${m.evidence_links.length ? '✓ มีเอกสารประกอบ' : '△ ยังไม่มีเอกสารประกอบ (แนะนำให้แนบ)'}</div>
      <div class="entry-note-small">คะแนน Dashboard จะไม่เปลี่ยนจนกว่าผู้ดูแลระบบจะยืนยัน</div>
      ${conf ? `<div class="entry-preview-row" style="margin-top:8px"><span>ผู้ดูแลระบบยืนยันแล้ว</span><b>${conf.confirmed_percent}%${conf.confirmed_level !== null ? ' · Level ' + conf.confirmed_level : ''}</b></div>` : ''}
      ${mgmt ? `<div class="entry-mgmt-badge tone-${mgmt.tone}">${mgmt.label}</div>` : ''}
    </div>
  `;
}
function entryInvestmentPreviewHtml() {
  const result = computeInvestmentResult();
  const kpi111 = getEffectiveKpi('1.1.1'), kpi112 = getEffectiveKpi('1.1.2');
  const s111 = result.pct111 !== null ? scoreLeafKPI(kpi111, result.pct111, 'q3') : { level: null };
  const s112 = result.pct112 !== null ? scoreLeafKPI(kpi112, result.pct112, 'q3') : { level: null };
  const parentKpi = getEffectiveKpi('1.1');
  const parentPreview = (s111.level !== null && s112.level !== null) ? scoreParentKPI(parentKpi, [
    Object.assign({}, s111, { weight: kpi111.weight, weightedValue: s111.level * kpi111.weight }),
    Object.assign({}, s112, { weight: kpi112.weight, weightedValue: s112.level * kpi112.weight }),
  ]) : { level: null };
  const mgmt = computeManagementStatus('1.1', 'q3');
  return `
    <div class="mini-card">
      <div class="mini-title">ผลการคำนวณ (Preview)</div>
      <div class="entry-preview-row"><span>แผนเบิกจ่าย Q3</span><b>${result.q3PlanTotal !== null ? ovpFmt(result.q3PlanTotal) : '—'} ล้านบาท</b></div>
      <div class="entry-preview-row"><span>เบิกจ่ายจริง Q3</span><b>${result.q3ActualTotal !== null ? ovpFmt(result.q3ActualTotal) : '—'} ล้านบาท</b></div>
      <div class="entry-preview-row"><span>แผนสะสม Q1-Q3</span><b>${result.cumPlan !== null ? ovpFmt(result.cumPlan) : '—'} ล้านบาท</b></div>
      <div class="entry-preview-row"><span>เบิกจริงสะสม Q1-Q3</span><b>${result.cumActual !== null ? ovpFmt(result.cumActual) : '—'} ล้านบาท</b></div>
      <div class="entry-preview-row"><span>กรอบเบิกจ่ายทั้งปี</span><b>${result.framework.amount.toLocaleString('en-US', { maximumFractionDigits: 3 })} ล้านบาท</b></div>
    </div>
    <div class="mini-card">
      <div class="mini-title">1.1.1 ร้อยละภาพรวมเบิกจ่ายจริง</div>
      <div class="entry-preview-row"><span>= สะสมจริง ÷ กรอบทั้งปี</span><b>${result.pct111 !== null ? result.pct111.toFixed(2) + '%' : '—'}</b></div>
      <div class="entry-preview-row"><span>คะแนน</span><b style="color:${lvColor(s111.level)}">${s111.level !== null ? s111.level.toFixed(4) : '—'}</b></div>
    </div>
    <div class="mini-card">
      <div class="mini-title">1.1.2 ร้อยละความสามารถเบิกจ่ายตามแผน</div>
      <div class="entry-preview-row"><span>= เฉลี่ยอัตราส่วนจริง/แผนรายไตรมาส ÷ 4</span><b>${result.pct112 !== null ? result.pct112.toFixed(2) + '%' : '—'}</b></div>
      <div class="entry-preview-row"><span>คะแนน</span><b style="color:${lvColor(s112.level)}">${s112.level !== null ? s112.level.toFixed(4) : '—'}</b></div>
    </div>
    <div class="mini-card">
      <div class="mini-title">Parent 1.1 (คำนวณอัตโนมัติ)</div>
      <div class="highlight-score" style="color:${lvColor(parentPreview.level)}">${parentPreview.level !== null ? parentPreview.level.toFixed(4) : '—'}<span class="score-of">/5</span></div>
      ${mgmt ? `<div class="entry-mgmt-badge tone-${mgmt.tone}">${mgmt.label}</div>` : ''}
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════
// ADMIN — CONFIRM VIEW (§C7 plan + §B3 framework revisions)
// ═══════════════════════════════════════════════════════════
function entryFrameworkPendingCardHtml(rev) {
  return `<div class="dtl-section-card entry-pending-card">
    <div class="card-title">1.1 — คำขอปรับกรอบเบิกจ่ายทั้งปี <span class="entry-type-chip">v${rev.version}</span></div>
    <div class="entry-pending-grid">
      <div><div class="dtl-support-label">กรอบเดิม</div><div class="dtl-support-val">${getAnnualFrameworkHistory('1.1').find(v => v.version === rev.version - 1).amount.toLocaleString('en-US', { maximumFractionDigits: 3 })} ล้านบาท</div></div>
      <div><div class="dtl-support-label">กรอบใหม่ที่ขอปรับ</div><div class="dtl-support-val"><b>${rev.amount.toLocaleString('en-US', { maximumFractionDigits: 3 })} ล้านบาท</b></div></div>
      <div><div class="dtl-support-label">มีผลตั้งแต่</div><div class="dtl-support-val">${entryThaiDate(rev.effectiveDate)}</div></div>
      <div><div class="dtl-support-label">ผู้แจ้ง</div><div class="dtl-support-val">${entryEsc(rev.createdBy)}</div></div>
      <div style="grid-column:1/-1"><div class="dtl-support-label">เหตุผล</div><div class="dtl-support-val">${entryEsc(rev.reason)}</div></div>
      ${rev.referenceDoc ? `<div style="grid-column:1/-1"><div class="dtl-support-label">หน่วยงาน/หนังสืออ้างอิง</div><div class="dtl-support-val">${entryEsc(rev.referenceDoc)}</div></div>` : ''}
      <div style="grid-column:1/-1"><div class="dtl-support-label">เอกสารประกอบ</div><div class="dtl-support-val"><a href="${entryEsc(rev.evidenceUrl)}" target="_blank" rel="noopener">เปิดเอกสาร ↗</a></div></div>
    </div>
    <div class="entry-btn-row">
      <button class="entry-btn primary" onclick="entryDoConfirmFramework('${rev.kpiId}',${rev.version})">ยืนยันการปรับกรอบ</button>
      <button class="entry-btn ghost" onclick="entryDoRejectFramework('${rev.kpiId}',${rev.version})">ส่งกลับแก้ไข</button>
    </div>
    <div id="entryFwConfirmMsg_${rev.version}"></div>
  </div>`;
}
function entryDoConfirmFramework(kpiId, version) {
  const r = confirmAnnualFrameworkRevision(kpiId, version, { confirmedBy: 'ผู้ดูแลระบบ (UAT)' });
  if (!r.ok) { entryToast(r.issues[0]); return; }
  entryToast('ยืนยันการปรับกรอบเบิกจ่ายแล้ว — เวอร์ชันใหม่มีผลใช้งานทันที');
  renderEntry();
  if (typeof renderHome === 'function') renderHome();
}
function entryDoRejectFramework(kpiId, version) {
  const r = rejectAnnualFrameworkRevision(kpiId, version, { note: 'ส่งกลับให้แก้ไข', confirmedBy: 'ผู้ดูแลระบบ (UAT)' });
  if (!r.ok) { entryToast(r.issues[0]); return; }
  entryToast('ส่งกลับคำขอปรับกรอบแล้ว — กรอบเดิมยังใช้งานอยู่');
  renderEntry();
}
function entryConfirmViewHtml() {
  const pendingFw = listPendingFrameworkRevisions();
  const pending = listPendingConfirmations();
  if (!pendingFw.length && !pending.length) return `<div class="dtl-section-card"><div class="stub-note">ไม่มีรายการรอยืนยัน</div></div>`;
  const fwCards = pendingFw.map(entryFrameworkPendingCardHtml).join('');
  const planCards = pending.map(p => {
    const kpi = MOU_DATA.kpis[p.kpiId];
    const eff = getEffectiveKpi(p.kpiId);
    const suggestion = suggestForPlanKpi(p.kpiId, p.month.progress_text, p.month.reported_percent);
    const needsLevel = kpi.scoringMethod === 'milestone_manual';
    const plan = getActionPlan(p.kpiId);
    const monthPlan = getActionPlanMonthly(p.kpiId)[p.monthKey];
    return `<div class="dtl-section-card entry-pending-card">
      <div class="card-title">${p.kpiId} — ${kpi.label} <span class="entry-type-chip plan">${p.monthLabel}</span></div>
      <div class="entry-pending-grid">
        <div><div class="dtl-support-label">Monthly Plan — กิจกรรมตามแผนเดือนนี้</div><div class="dtl-support-val ${monthPlan.planned_activity ? '' : 'empty'}">${entryEsc(monthPlan.planned_activity) || 'ไม่มีข้อมูลแผนสำหรับเดือนนี้'}</div></div>
        <div><div class="dtl-support-label">Planned % — เป้าหมายสะสมตามแผน</div><div class="dtl-support-val"><b>${monthPlan.planned_percent !== null ? monthPlan.planned_percent + '%' : '—'}</b>${monthPlan.baseline_or_revised === 'revised' ? ' <span class="entry-type-chip">แผนปรับ</span>' : ''}</div></div>
        <div><div class="dtl-support-label">ข้อความที่หน่วยงานรายงาน (Narrative)</div><div class="dtl-support-val">${entryEsc(p.month.progress_text) || '—'}</div></div>
        <div><div class="dtl-support-label">Reported % — ที่หน่วยงานรายงาน</div><div class="dtl-support-val"><b>${p.month.reported_percent ?? '—'}%</b></div></div>
        <div><div class="dtl-support-label">ปัญหา/อุปสรรค (Obstacle)</div><div class="dtl-support-val ${p.month.obstacle_text ? '' : 'empty'}">${entryEsc(p.month.obstacle_text) || 'ไม่มี'}</div></div>
        <div><div class="dtl-support-label">แนวทางแก้ไข (Solution)</div><div class="dtl-support-val ${p.month.solution_text ? '' : 'empty'}">${entryEsc(p.month.solution_text) || 'ไม่มี'}</div></div>
        <div style="grid-column:1/-1"><div class="dtl-support-label">Milestone ที่ระบบจับได้ / % ที่ระบบแนะนำ</div><div class="dtl-support-val">${suggestion.hits.length ? suggestion.hits.map(h => `${entryEsc(h.activityLabel)}: ${h.statusLabel}`).join(', ') : 'ไม่พบคำสำคัญที่ตรงกัน'} ${suggestion.suggestedPercent !== null ? `(${suggestion.suggestedPercent}%)` : ''}${suggestion.expectedStep ? ` · ตาม % ควรอยู่ที่: ${entryEsc(suggestion.expectedStep.activity_name)}` : ''}</div></div>
        <div><div class="dtl-support-label">ค่าเกณฑ์ MOU (Level 1-5)</div><div class="dtl-support-val">${needsLevel ? 'มาตราวัดพิเศษ ไม่ใช่เกณฑ์ 5 ระดับปกติ — ' + (kpi.confirmationNote || '') : eff.thresholds.join(' / ')}</div></div>
        <div style="grid-column:1/-1"><div class="dtl-support-label">เอกสารประกอบ (Evidence)</div><div class="dtl-support-val">${p.month.evidence_links.length ? p.month.evidence_links.map(ev => `<a href="${entryEsc(ev.url)}" target="_blank" rel="noopener">${entryEsc(ev.title)} ↗</a>`).join(' · ') : NOT_ATTACHED}</div></div>
      </div>
      ${plan.baseline ? `<details class="entry-framework-history"><summary>ดูแผนเต็มทั้งหมด (${(plan.revised || plan.baseline).length} กิจกรรม)</summary>
        <div class="entry-timeline compact">${(plan.revised || plan.baseline).map(a => `<div class="entry-timeline-row"><div class="entry-timeline-pct">${a.expected_progress_percent ?? '—'}%</div><div class="entry-timeline-bar-wrap"><div class="entry-timeline-bar" style="width:${a.expected_progress_percent || 0}%"></div></div><div class="entry-timeline-label">${entryEsc(a.activity_name)}</div></div>`).join('')}</div>
      </details>` : ''}
      <div class="entry-field-row" style="margin-top:10px">
        <label>confirmed_percent (%)</label>
        <input type="number" min="0" max="100" step="any" class="entry-input" style="max-width:140px" id="cf_pct_${p.kpiId}_${p.monthKey}" value="${p.month.reported_percent ?? ''}">
      </div>
      ${needsLevel ? `<div class="entry-field-row">
        <label>Level (มาตราวัดพิเศษ — เลือกเอง 1-5)</label>
        <select class="entry-input" style="max-width:140px" id="cf_level_${p.kpiId}_${p.monthKey}">
          <option value="">— เลือก —</option>${[1,2,3,4,5].map(l => `<option value="${l}">${l}</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="entry-field-row col">
        <label>confirmation_note</label>
        <textarea class="entry-input" rows="2" id="cf_note_${p.kpiId}_${p.monthKey}" placeholder="เหตุผลการปรับ (ถ้ามี)"></textarea>
      </div>
      <div class="entry-btn-row">
        <button class="entry-btn primary" onclick="entryDoConfirmPlan('${p.kpiId}','${p.monthKey}')">ยืนยันผล</button>
        <button class="entry-btn ghost" onclick="entryDoSendBackPlan('${p.kpiId}','${p.monthKey}')">ส่งกลับแก้ไข</button>
      </div>
      <div id="entryConfirmMsg_${p.kpiId}_${p.monthKey}"></div>
    </div>`;
  }).join('');
  return fwCards + planCards;
}
function entryDoConfirmPlan(kpiId, monthKey) {
  const pct = document.getElementById(`cf_pct_${kpiId}_${monthKey}`).value;
  const noteEl = document.getElementById(`cf_note_${kpiId}_${monthKey}`);
  const levelEl = document.getElementById(`cf_level_${kpiId}_${monthKey}`);
  const r = confirmPlanMonth(kpiId, monthKey, {
    confirmedPercent: pct === '' ? null : pct,
    confirmationNote: noteEl ? noteEl.value : '',
    confirmedLevel: levelEl ? (levelEl.value === '' ? null : levelEl.value) : null,
    confirmedBy: 'ผู้ดูแลระบบ (UAT)',
  });
  const msg = document.getElementById(`entryConfirmMsg_${kpiId}_${monthKey}`);
  if (!r.ok) { if (msg) msg.innerHTML = `<div class="entry-validate-box bad">${r.issues.map(i => `⚠ ${entryEsc(i)}`).join('<br>')}</div>`; return; }
  entryToast('ยืนยันผลแล้ว — Q3 Actual ถูกส่งไป Detail / ภาพรวม / Home แล้ว');
  renderEntry();
  if (typeof renderHome === 'function') renderHome();
}
function entryDoSendBackPlan(kpiId, monthKey) {
  const r = sendBackPlanMonth(kpiId, monthKey, 'ส่งกลับให้แก้ไข');
  if (!r.ok) { entryToast(r.issues[0]); return; }
  entryToast('ส่งกลับให้ผู้รับผิดชอบ KPI แก้ไขแล้ว');
  renderEntry();
}

// ═══════════════════════════════════════════════════════════
// ADMIN — CRITERIA GOVERNANCE VIEW (brief §D/§E — per-KPI-ID source, never a shared array)
// ═══════════════════════════════════════════════════════════
function entryCriteriaEligibleIds() {
  return ['2.4', '1.1.1', '1.1.2', '2.7.1', '2.7.2', '2.7.4'];
}
function entrySetCriteriaKpi(id) { entryState.criteriaKpi = id; renderEntry(); }
function entryCriteriaViewHtml() {
  const id = entryState.criteriaKpi;
  const hist = getCriteriaHistory(id);
  const active = getActiveCriteria(id);
  const conflict = criteriaConflictNote(id);
  const opts = entryCriteriaEligibleIds().map(k => `<option value="${k}" ${k === id ? 'selected' : ''}>${k} — ${MOU_DATA.kpis[k].label}</option>`).join('');
  return `
    <div class="dtl-section-card">
      <div class="card-title">จัดการเกณฑ์ MOU (Level 1-5) — Locked, แก้ได้เฉพาะผู้ดูแลระบบผ่านมติ กทท.</div>
      <div class="entry-meta-line">แหล่งข้อมูล: MOU Master ต่อตัวชี้วัด (per KPI ID) — ไม่ใช้ค่าเกณฑ์ร่วม/ค่ากลาง</div>
      <div class="entry-field-row"><label>เลือกตัวชี้วัด</label><select class="entry-input" onchange="entrySetCriteriaKpi(this.value)">${opts}</select></div>
      ${conflict ? `<div class="entry-todo-note">⚠ ${entryEsc(conflict)}</div>` : ''}
      <div class="dtl-support-label" style="margin-top:8px">เกณฑ์ปัจจุบัน (v${active.version})</div>
      <table class="dtl-criteria-table"><thead><tr>${[1,2,3,4,5].map(l => `<th>Level ${l}</th>`).join('')}</tr></thead>
      <tbody><tr>${active.thresholds.map(t => `<td>${t}</td>`).join('')}</tr></tbody></table>
      ${active.version > 1 ? `<div class="entry-criteria-note">⚑ มีการปรับค่าเกณฑ์ตามมติคณะกรรมการ กทท. เมื่อวันที่ ${active.boardApprovalDate} — ${entryEsc(active.note)}</div>` : ''}

      <div class="dtl-support-label" style="margin-top:14px">ประวัติเวอร์ชัน (History)</div>
      <table class="dtl-qtable"><thead><tr><th>เวอร์ชัน</th><th>เกณฑ์ 1-5</th><th>วันที่มติ กทท.</th><th>หมายเหตุ</th><th>เอกสาร</th></tr></thead>
      <tbody>${hist.map(v => `<tr>
        <td>v${v.version}${v.isActive ? ' (ใช้งานอยู่)' : ''}</td>
        <td>${v.thresholds.join(' / ')}</td>
        <td>${v.boardApprovalDate || '—'}</td>
        <td>${entryEsc(v.note || '')}</td>
        <td>${v.evidenceUrl ? `<a href="${entryEsc(v.evidenceUrl)}" target="_blank" rel="noopener">เปิดเอกสาร ↗</a>` : '—'}</td>
      </tr>`).join('')}</tbody></table>

      <div class="dtl-support-label" style="margin-top:14px">สร้างเกณฑ์เวอร์ชันใหม่ (บังคับกรอกครบทุกช่อง)</div>
      <div class="entry-crit-grid">
        ${[0,1,2,3,4].map(i => `<div class="entry-field-row"><label>Level ${i + 1}</label><input type="number" step="any" class="entry-input" id="critNew_${i}" value="${active.thresholds[i]}"></div>`).join('')}
      </div>
      <div class="entry-field-row"><label>วันที่คณะกรรมการ กทท. เห็นชอบ</label><input type="date" class="entry-input" style="max-width:200px" id="critBoardDate"></div>
      <div class="entry-field-row col"><label>หมายเหตุ</label><textarea class="entry-input" rows="2" id="critNote" placeholder="เหตุผล/มติที่เกี่ยวข้อง"></textarea></div>
      <div class="entry-field-row"><label>เอกสารอ้างอิง (Google Drive URL)</label><input class="entry-input" id="critEvidence" placeholder="https://drive.google.com/..."></div>
      <div class="entry-btn-row"><button class="entry-btn primary" onclick="entrySaveCriteriaRevision('${id}')">บันทึกเกณฑ์เวอร์ชันใหม่</button></div>
      <div id="entryCritMsg"></div>
    </div>
  `;
}
function entrySaveCriteriaRevision(id) {
  const newThresholds = [0,1,2,3,4].map(i => document.getElementById('critNew_' + i).value);
  const boardApprovalDate = document.getElementById('critBoardDate').value;
  const note = document.getElementById('critNote').value;
  const evidenceUrl = document.getElementById('critEvidence').value;
  const r = addCriteriaRevision(id, { newThresholds, boardApprovalDate, note, evidenceUrl });
  const msg = document.getElementById('entryCritMsg');
  if (!r.ok) { msg.innerHTML = `<div class="entry-validate-box bad">${r.issues.map(i2 => `⚠ ${entryEsc(i2)}`).join('<br>')}</div>`; return; }
  entryToast('บันทึกเกณฑ์เวอร์ชันใหม่แล้ว');
  renderEntry();
}

// ═══════════════════════════════════════════════════════════
// ROOT RENDER
// ═══════════════════════════════════════════════════════════
function renderEntry() {
  const root = document.getElementById('page-entry');
  if (!root) return;
  let center;
  if (entryState.role === 'admin' && entryState.view === 'confirm') center = entryConfirmViewHtml();
  else if (entryState.role === 'admin' && entryState.view === 'criteria') center = entryCriteriaViewHtml();
  else center = entryCenterHtml();

  const showRightPanel = entryState.view === 'form';

  root.innerHTML = `
    ${entryHeaderHtml()}
    <div class="entry-shell">
      <aside id="entryLeftList">${entryLeftListHtml()}</aside>
      <div class="entry-center">${center}</div>
      <aside id="entryPreviewPanel">${showRightPanel ? entryPreviewHtml() : ''}</aside>
    </div>
    <div id="entryToast" class="entry-toast"></div>
  `;
}
