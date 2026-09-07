// Shared Q3 reporting for the remaining KPI types. Historical seeds stay read-only.
const REPORT_FIELDS = {
  '1.2': {fields:[['amount','ค่าใช้จ่ายฝึกอบรมสะสมถึงสิ้น Q3 (ล้านบาท)'],['budget','กรอบค่าใช้จ่ายทั้งปี (ล้านบาท)']],defaults:{budget:26},method:'ค่าใช้จ่ายสะสม ÷ กรอบทั้งปี × 100', calc:v=>v.amount/v.budget*100},
  '1.3': {fields:[['factor','ค่า Factor ที่ดำเนินการได้','text']],human:true,method:'ผู้รับผิดชอบยืนยันคะแนนตามเกณฑ์ Eco-Efficiency และหลักฐาน'},
  '1.4': {fields:[['actual','ปริมาณการปล่อยสะสมถึงสิ้น Q3 (Ton CO2eq.)']],human:true,method:'รายงานปริมาณจริง และยืนยันคะแนนระหว่างปีตามวิธีประเมินเดิม; เกณฑ์ปริมาณใช้ประเมินสิ้นปี',calc:v=>v.actual},
  '2.2': {fields:[['m7','รายได้เดือนเมษายน (ล้านบาท)'],['m8','รายได้เดือนพฤษภาคม (ล้านบาท)'],['m9','รายได้เดือนมิถุนายน (ล้านบาท)']],method:'รายได้สะสม Q2 + รายได้ เม.ย.–มิ.ย.',calc:v=>priorCumulative('2.2')+v.m7+v.m8+v.m9},
  '2.3': {fields:[['icd','ปริมาณ ICD + ทกท. เฉพาะ Q3 (ที.อี.ยู.)'],['yard','ปริมาณลาน C เฉพาะ Q3 (ที.อี.ยู.)']],method:'ปริมาณสะสม Q2 + ICD/ทกท. และลาน C เฉพาะ Q3',calc:v=>priorCumulative('2.3')+v.icd+v.yard},
  '2.6': {fields:[['hq','รายได้สินทรัพย์สำนักงานใหญ่สะสม (ล้านบาท)'],['bkk','รายได้สินทรัพย์ ทกท. สะสม (ล้านบาท)'],['lcb','รายได้สินทรัพย์ ทลฉ. สะสม (ล้านบาท)'],['ranong','รายได้สินทรัพย์ ทรน. สะสม (ล้านบาท)'],['sattahip','รายได้สินทรัพย์ ทชส. สะสม (ล้านบาท)']],method:'รวมรายได้จากสินทรัพย์ทุกส่วนสะสมถึงสิ้น Q3',calc:v=>v.hq+v.bkk+v.lcb+v.ranong+v.sattahip},
};
for(const id of ['2.1.1','2.1.2','2.1.3']) REPORT_FIELDS[id]={fields:[['revenue','รายได้สะสมถึงสิ้น Q3 (ล้านบาท)'],['expense','ค่าใช้จ่ายสะสมถึงสิ้น Q3 (ล้านบาท)'],['addback','ค่าภาษีที่ดินและสิ่งปลูกสร้างบวกกลับสะสม (ล้านบาท; ไม่มีกรอก 0)']],method:'รายได้ − ค่าใช้จ่าย + ค่าภาษีที่ดินและสิ่งปลูกสร้างบวกกลับ',calc:v=>v.revenue-v.expense+v.addback};
for(const id of ['2.5.1','2.5.2']) REPORT_FIELDS[id]={fields:[['crane','Crane Productivity ตามรายงาน Q3'],['truck','ระยะเวลารับ–ส่งตู้สินค้า ตามรายงาน Q3'],['hinterland','ปริมาณตู้สินค้าหลังท่าสะสม Q3 (ที.อี.ยู.)']],human:true,method:'เก็บผลทั้ง 3 ด้าน และยืนยันคะแนนตามเกณฑ์; ไม่เฉลี่ยค่าประสิทธิภาพหรือให้คะแนนแทนผู้ประเมิน'};
for(const id of ['2.8.1','2.8.2','2.8.3']) REPORT_FIELDS[id]={fields:[],human:true,method:'ยืนยันคะแนนตามขั้นตอนที่ดำเนินการได้ พร้อมข้อความและเอกสารประกอบ'};

function reportDraft(id) { return Object.assign({values:{},summary_text:'',evidence:'',level:null},getEntry(id).draftReport || {}); }
function reportDraftSet(id,key,value) {
  const d=reportDraft(id); if(key.startsWith('v:'))d.values=Object.assign({},d.values,{[key.slice(2)]:value});else d[key]=value;
  setEntry(id,{draftReport:d,status:'draft'}); entryRefreshPreview();
}
function reportCalculate(id) {
  const config=REPORT_FIELDS[id],d=reportDraft(id),v={},issues=[];
  for(const [key,label,type] of config.fields){const raw=d.values[key]??config.defaults?.[key]??null;
    if(type==='text'){v[key]=raw==null?'':String(raw);continue;}
    if(raw===null||raw===''||!Number.isFinite(Number(raw))||Number(raw)<0){issues.push(`กรอก ${label} ให้ถูกต้อง`);v[key]=null;}else v[key]=Number(raw);
  }
  if(id==='1.2' && !(v.budget>0))issues.push('กรอบทั้งปีต้องมากกว่า 0');
  if(config.human && (d.level===null||d.level===''||!Number.isFinite(Number(d.level))||Number(d.level)<1||Number(d.level)>5))issues.push('ยืนยันคะแนนระหว่าง 1 ถึง 5');
  if(config.human && !d.summary_text.trim())issues.push('กรอกสรุปผลและเหตุผลประกอบคะแนน');
  if(d.evidence && !/^https?:\/\//i.test(d.evidence.trim()))issues.push('ลิงก์หลักฐานต้องขึ้นต้นด้วย https:// หรือ http://');
  const actual=issues.length?null:config.calc?config.calc(v):id==='1.3'?(v.factor||d.summary_text):d.summary_text;
  if(typeof actual==='number'&&!Number.isFinite(actual))issues.push('ไม่สามารถคำนวณผลจากข้อมูลนี้ได้');
  const input=issues.length?null:config.human?Number(d.level):actual;
  return {ok:!issues.length,issues,actual:issues.length?null:actual,input,values:v,score:scoreLeafKPI(getEffectiveKpi(id),input,'q3')};
}
function reportConfirm(id) {
  const result=reportCalculate(id); if(!result.ok)return result;
  const d=reportDraft(id),record={actual:result.actual,quarterlyResult:result.input,values:result.values,summary_text:d.summary_text,issue:Object.assign({},getIssue(id,'q3')),evidence:d.evidence.trim(),confirmedAt:new Date().toISOString()};
  if(id==='2.2')record.monthly=Object.assign({},result.values);
  setEntry(id,{status:'confirmed',confirmedAt:record.confirmedAt,publishedReport:record});ovrSet(id,'q3',result.input);return result;
}
function reportConfirmUi(id){const r=reportConfirm(id);if(!r.ok){document.getElementById('reportValidation').innerHTML=r.issues.map(entryEsc).join('<br>');return;}renderEntry();renderDetail();renderOverview();renderHome();entryToast('ยืนยันแล้ว — ผล คะแนน และข้อความเชื่อมทุกหน้า');}
function reportValidateUi(id){const r=reportCalculate(id);document.getElementById('reportValidation').innerHTML=r.ok?'ข้อมูลครบ พร้อมยืนยันบันทึก':r.issues.map(entryEsc).join('<br>');}
function reportChildPicker(main) {
  const leaves=reportLeaves(main);if(leaves.length<=1)return '';
  return `<div class="entry-project-pills">${leaves.map(k=>`<button class="entry-project-pill ${entryState.activeChild===k.id?'active':''}" onclick="entrySelectChild('${k.id}')">${k.id} ${entryEsc(k.label)}</button>`).join('')}</div>`;
}
function reportLeaves(id){const k=MOU_DATA.kpis[id];return !k?[]:k.isLeaf?[k]:ovpChildren(id).flatMap(c=>reportLeaves(c.id));}
function reportActiveId(){return entryState.activeChild||reportLeaves(entryState.activeKpi)[0]?.id||entryState.activeKpi;}
function reportFormHtml(id){
  const k=MOU_DATA.kpis[id],config=REPORT_FIELDS[id],d=reportDraft(id);
  return `${reportChildPicker(entryState.activeKpi)}<div class="dtl-section-card"><div class="card-title">${id} · ${entryEsc(k.label)}</div>
  <div class="entry-meta-line">ผล Q3 · ${entryEsc(config.method)}</div>
  ${config.fields.map(([key,label,type])=>`<div class="entry-field-row col"><label>${label}</label><input class="entry-input" type="${type==='text'?'text':'number'}" ${type==='text'?'':'step="any" min="0"'} value="${entryEsc(String(d.values[key]??config.defaults?.[key]??''))}" oninput="reportDraftSet('${id}','v:${key}',this.value)" placeholder="ยังไม่ได้กรอก"></div>`).join('')}
  <div class="entry-field-row col"><label>สรุปผลการดำเนินงาน / เหตุผลประกอบคะแนน</label><textarea class="entry-input" rows="4" oninput="reportDraftSet('${id}','summary_text',this.value)">${entryEsc(d.summary_text)}</textarea></div>
  ${entryIssueBlockHtml(id,'q3','report_'+id)}
  <div class="entry-field-row col"><label>ลิงก์เอกสารประกอบ (ถ้ามี)</label><input class="entry-input" type="url" value="${entryEsc(d.evidence)}" oninput="reportDraftSet('${id}','evidence',this.value)" placeholder="https://"></div>
  ${config.human?`<div class="entry-field-row col"><label>คะแนนที่ยืนยันตามเกณฑ์ (1–5; รองรับทศนิยม)</label><input class="entry-input" type="number" min="1" max="5" step="0.0001" value="${d.level??''}" oninput="reportDraftSet('${id}','level',this.value)"></div>`:''}
  <div class="entry-note-small">ยืนยันบันทึกเพื่อส่งข้อมูลไปยังรายละเอียด ภาพรวม และ Home · ค่าร่างไม่แทนผลยืนยันเดิม</div>
  <div class="entry-btn-row"><button class="entry-btn ghost" onclick="entrySaveDraft()">บันทึกร่าง</button><button class="entry-btn secondary" onclick="reportValidateUi('${id}')">ตรวจสอบข้อมูล</button><button class="entry-btn primary" onclick="reportConfirmUi('${id}')">ยืนยันบันทึก</button></div><div id="reportValidation" class="entry-validate-box"></div></div>`;
}
function reportPreviewHtml(id){const r=reportCalculate(id),k=getEffectiveKpi(id);return `<div class="mini-card"><div class="mini-title">ผลจากข้อมูลที่กำลังกรอก</div><div class="entry-preview-row"><span>ผลการดำเนินงาน</span><b>${entryEsc(String(r.actual??'—'))}</b></div><div class="entry-preview-row"><span>คะแนน</span><b>${r.score.level===null?'—':r.score.level.toFixed(4)}</b></div><div class="entry-note-small">${r.ok?'พร้อมยืนยันบันทึก':r.issues.map(entryEsc).join('<br>')}</div></div><div class="mini-card">${reportCriteriaHtml(k)}</div>`;}
function reportCriteriaHtml(k){if(k.thresholds.every(x=>x===null))return '<div class="dtl-source-note">ต้นทางไม่ได้ระบุเกณฑ์ตัวเลข 1–5; ใช้แผนงานและคะแนนที่ยืนยัน</div>';return `<div class="mini-title">เกณฑ์คะแนนตาม Excel</div><div class="report-criteria-list">${k.thresholds.map((t,i)=>`<div><span class="ovp-badge" style="background:${LV_COLORS[i+1]};color:#293750">${i+1}</span><span>${entryEsc(String(t??'ยังไม่ระบุ'))}${k.scoringMethod==='milestone_pct'?' ('+Number(t)*100+'%)':''}</span></div>`).join('')}</div>`;}
function reportValue(id,q){const k=MOU_DATA.kpis[id];if(!k?.isLeaf)return null;const report=publishedQuarterReport(id,q);if(report?.actual!==undefined)return report.actual;if(q==='q1'||q==='q2')return MOU_DATA.quarterly[id]?.[q]?.actual??null;return getQuarterInput(id,q);}
function reportValueText(id,q){const val=reportValue(id,q),k=MOU_DATA.kpis[id];if(val===null||val===undefined)return '—';if(['milestone_pct','milestone_manual'].includes(k.scoringMethod))return `${(Number(val)*100).toFixed(2)}%`;return entryEsc(String(typeof val==='number'?ovpFmt(val):val));}
function reportEvidenceHtml(report){if(!report)return 'ยังไม่มีเอกสารแนบ';const links=report.evidence_links|| (report.evidence?[{url:report.evidence,label:'เอกสารประกอบ'}]:[]);const safe=links.filter(x=>/^https?:\/\//i.test(x.url||''));return safe.length?safe.map(x=>`<a href="${entryEsc(x.url)}" target="_blank" rel="noopener">${entryEsc(x.label||x.title||x.name||'เอกสารประกอบ')}</a>`).join('<br>'):'ยังไม่มีเอกสารแนบ';}
function reportToEntry(id){const route=id.startsWith('1.1')?'1.1':id.startsWith('2.7')?'2.7':MOU_DATA.kpis[id]?.parent||id;entrySelectKpi(route);if(route!==id && route!=='1.1')entrySelectChild(reportLeaves(id)[0]?.id||id);switchTab('entry',document.getElementById('tabBtnEntry'));}
function reportDetailHtml(id){const k=getEffectiveKpi(id),q=dtlQuarter,leaf=k.isLeaf,s=leaf?scoreAt(id,q):scoreParentAt(id,q),fc=forecastHomeScore(id),report=publishedQuarterReport(id,q),children=ovpChildren(id),leaves=reportLeaves(id),filled=leaves.filter(c=>getQuarterInput(c.id,q)!==null).length;
 const activities=MOU_DATA.activities[id]?.steps||[];
 const rows=QUARTERS.map(qq=>{const rs=leaf?scoreAt(id,qq):scoreParentAt(id,qq);return `<tr><td>${Q_LABEL[qq]}</td><td>${leaf?reportValueText(id,qq):'รวมคะแนนจากตัวชี้วัดย่อย'}</td><td>${ovpBadge(rs.level)}</td><td>${ovpBadge(k.targetScore)}</td></tr>`}).join('');
 const breakdown=report?.values&&REPORT_FIELDS[id]?REPORT_FIELDS[id].fields.map(([key,label])=>`<div class="dtl-meta-item">${label}<b>${entryEsc(String(report.values[key]??'—'))}</b></div>`).join(''):'';
 return `<div class="dtl-header-card"><div class="dtl-page-title">รายละเอียดตัวชี้วัด</div><div class="dtl-breadcrumb">${entryEsc(k.groupLabel||'')} · ตัวชี้วัด ${id}</div><div class="dtl-h1"><span class="dtl-id-badge">${id}</span>${entryEsc(k.label)}</div><div class="dtl-meta-grid"><div class="dtl-meta-item">น้ำหนัก<b>${k.weight}%</b></div><div class="dtl-meta-item">หน่วย<b>${entryEsc(k.unit||'—')}</b></div><div class="dtl-meta-item">เป้าหมายตาม Excel<b>${entryEsc(String(k.target??'—'))}</b></div></div><div class="dtl-quarter-tabs">${QUARTERS.map(qq=>`<button class="dtl-qbtn ${q===qq?'active':''}" onclick="dtlSetQuarter('${qq}')">${Q_LABEL[qq]} (${PERIOD_LABEL[qq]})</button>`).join('')}</div><div class="dtl-source-note">${q==='q1'||q==='q2'?'ผลตั้งต้นจาก Excel':'ผลจากหน้ากรอกข้อมูลที่ยืนยันแล้ว'} · มีผล ${filled}/${leaves.length} ตัวชี้วัดย่อย</div><button class="cta-btn" onclick="reportToEntry('${id}')">ไปกรอกผล Q3 →</button></div>
 <div class="dtl-cards"><div class="dtl-card c-actual"><div class="dtl-card-label">${leaf?'ผลการดำเนินงาน':'คะแนนรวมตัวชี้วัดย่อย'} ${Q_LABEL[q]}</div><div class="${leaf&&typeof reportValue(id,q)==='string'?'dtl-support-val':'dtl-card-val'}">${leaf?reportValueText(id,q):s.level===null?'—':s.level.toFixed(4)}</div><div class="dtl-card-sub">${filled<leaves.length?'ข้อมูลยังไม่ครบ':''}</div></div><div class="dtl-card c-score"><div class="dtl-card-label">คะแนน ${Q_LABEL[q]}</div><div class="dtl-card-val">${s.level===null?'—':s.level.toFixed(4)}</div></div><div class="dtl-card c-fcresult"><div class="dtl-card-label">คาดการณ์สิ้นปี</div><div class="dtl-support-val">${leaf?entryEsc(String(MOU_DATA.forecast[id]?.result??'—')):'รวมคะแนนจากตัวชี้วัดย่อย'}</div></div><div class="dtl-card c-fcscore"><div class="dtl-card-label">คะแนนคาดการณ์</div><div class="dtl-card-val">${fc.level===null?'—':fc.level.toFixed(4)}</div></div></div>
 ${children.length?`<div class="dtl-section-card"><div class="card-title">ตัวชี้วัดย่อย</div><table class="dtl-qtable"><thead><tr><th>ตัวชี้วัด</th><th>ผล</th><th>คะแนน</th></tr></thead><tbody>${children.map(c=>{const cs=c.isLeaf?scoreAt(c.id,q):scoreParentAt(c.id,q);return `<tr><td><button class="ovp-detail-btn" onclick="detailRouteKpiId='${c.id}';renderDetail()">${c.id} ${entryEsc(c.label)}</button>${reportSummaryHtml(c.id,q)}</td><td>${c.isLeaf?reportValueText(c.id,q):'—'}</td><td>${ovpBadge(cs.level)}</td></tr>`}).join('')}</tbody></table></div>`:''}
 <div class="dtl-section-card"><div class="card-title">ผลและคะแนนรายไตรมาส</div><table class="dtl-qtable"><thead><tr><th>ไตรมาส</th><th>ผลการดำเนินงาน</th><th>คะแนน</th><th>คะแนนเป้าหมาย</th></tr></thead><tbody>${rows}</tbody></table></div>
 <div class="dtl-section-card"><div class="card-title">สรุปผลและประเด็นติดตาม</div>${reportSummaryHtml(id,q)||`<div class="dtl-support-val empty">${entryEsc(MOU_DATA.quarterly[id]?.[q]?.note||'ยังไม่มีข้อความที่ยืนยันในไตรมาสนี้')}</div>`}${breakdown?`<div class="dtl-meta-grid">${breakdown}</div>`:''}<div class="dtl-source-note">${entryEsc(REPORT_FIELDS[id]?.method|| (id.startsWith('1.1')?'ใช้ข้อมูลเบิกจ่ายร่วมกัน คำนวณตามสูตรของแต่ละตัวชี้วัด':id.startsWith('2.7')?'ผลความก้าวหน้าล่าสุดที่ผู้ดูแลระบบยืนยัน ไม่บวกเปอร์เซ็นต์รายเดือนเข้าด้วยกัน':leaf?'':'คะแนนเฉลี่ยถ่วงน้ำหนักของตัวชี้วัดย่อย'))}</div></div>
 <div class="dtl-section-card">${reportCriteriaHtml(k)}${k.needsConfirmation?`<div class="dtl-source-note">${entryEsc(k.confirmationNote||'วิธีประเมินนี้มีเงื่อนไขที่ต้องตรวจสอบตามต้นทาง')}</div>`:''}</div>
 ${activities.length?`<div class="dtl-section-card"><div class="card-title">แผนงาน / ขั้นตอนตามข้อมูลต้นทาง</div><ol>${activities.map(t=>`<li>${entryEsc(t)}</li>`).join('')}</ol></div>`:''}
 <div class="dtl-section-card"><div class="card-title">เอกสารและข้อมูลสนับสนุน</div><div class="dtl-support-val">${reportEvidenceHtml(report)}</div>${(MOU_DATA.deductions||[]).filter(d=>d.kpi===id).map(d=>`<div class="reported-text">เงื่อนไขหักคะแนน: ${entryEsc(d.reason)}</div>`).join('')}${(MOU_DATA.assignments||[]).filter(d=>d.kpi===id).map(d=>`<div class="reported-text">มติ / ข้อสั่งการ: ${entryEsc(d.note)}</div>`).join('')}</div>`;
}
