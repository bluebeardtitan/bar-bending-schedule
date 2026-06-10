/* =========================
   Project Info
   ========================= */
const INFO_DEFAULTS = { header:'', project:'', agency:'', ref:'' };
let projectInfo = loadInfo();

function loadInfo(){
  const s = localStorage.getItem('bbs_info');
  // Merge over defaults so older saves (missing header / stale fields) still work
  return Object.assign({}, INFO_DEFAULTS, s ? JSON.parse(s) : {});
}
function saveInfoToStorage(){
  localStorage.setItem('bbs_info', JSON.stringify(projectInfo));
}
function applyInfoToForm(){
  $('#infoHeader').value  = projectInfo.header  || '';
  $('#infoProject').value = projectInfo.project || '';
  $('#infoAgency').value  = projectInfo.agency  || '';
  $('#infoRef').value     = projectInfo.ref     || '';
}
function readInfoFromForm(){
  projectInfo.header  = $('#infoHeader').value.trim();
  projectInfo.project = $('#infoProject').value.trim();
  projectInfo.agency  = $('#infoAgency').value.trim();
  projectInfo.ref     = $('#infoRef').value.trim();
}
/* Fill the print-header meta cells */
function updatePrintMeta(){
  // convert newline characters to <br> and escape HTML
  const render = txt => {
    const v = txt || '—';
    return escapeHTML(v).replace(/\r?\n/g,'<br>');
  };
  $('#pmProject').innerHTML    = render(projectInfo.project);
  $('#pmAgency').innerHTML      = render(projectInfo.agency);
  $('#pmRef').innerHTML         = render(projectInfo.ref);
  // Optional header title — only shown when filled
  const titleEl = $('#pmHeaderTitle');
  if (projectInfo.header) {
    titleEl.innerHTML  = escapeHTML(projectInfo.header).replace(/\r?\n/g,'<br>');
    titleEl.style.display = 'block';
  } else {
    titleEl.textContent = '';
    titleEl.style.display = 'none';
  }
}

$('#btnInfo').addEventListener('click', () => {
  $('#infoPanel').classList.toggle('collapsed');
  // close settings if open
  $('#settingsPanel').classList.add('collapsed');
});
$('#saveInfo').addEventListener('click', () => {
  readInfoFromForm();
  saveInfoToStorage();
  updatePrintMeta();
  alert('Project info saved.');
});
$('#clearInfo').addEventListener('click', () => {
  projectInfo = Object.assign({}, INFO_DEFAULTS);
  applyInfoToForm();
  saveInfoToStorage();
  updatePrintMeta();
});

/* =========================
   Settings
   ========================= */
const DEFAULTS = {
  unitMethod: 'd2over162',
  density: 7850,
  hooks: { '90': 10, '135': 12, '180': 14 },
  ded:   { '45': 1, '90': 2,  '135': 3  }
};
let settings = loadSettings();
function loadSettings(){
  const s = localStorage.getItem('bbs_settings');
  return s ? JSON.parse(s) : structuredClone(DEFAULTS);
}
function saveSettings(){
  localStorage.setItem('bbs_settings', JSON.stringify(settings));
  $('#unitMethod').value = settings.unitMethod;
  $('#density').value    = settings.density;
  $('#hook90').value     = settings.hooks['90'];
  $('#hook135').value    = settings.hooks['135'];
  $('#hook180').value    = settings.hooks['180'];
  $('#ded45').value      = settings.ded['45'];
  $('#ded90').value      = settings.ded['90'];
  $('#ded135').value     = settings.ded['135'];
  updatePreviews();
}
function resetSettings(){
  settings = structuredClone(DEFAULTS);
  saveSettings();
}
function updatePreviews(){
  $('#unitWtPreview').textContent   = settings.unitMethod==='d2over162' ? 'd²/162' : 'π/4·(d/1000)²·ρ';
  $('#bendRulePreview').textContent = 'IS-style';
}

/* Unit weight per metre (kg/m) */
function unitWeightKgPerM(dia){
  if(settings.unitMethod === 'd2over162') return (dia*dia)/162.0;
  const d_m = dia/1000;
  return Math.PI/4 * d_m * d_m * settings.density;
}

/* =========================
   Shape Calculations
   ========================= */
function bendDeduction(angle, dia){
  const a = parseInt(angle,10);
  if(a===45)  return settings.ded['45']*dia;
  if(a===90)  return settings.ded['90']*dia;
  if(a===135) return settings.ded['135']*dia;
  if(a===180) return settings.ded['90']*dia*2;
  if(a<45)  return settings.ded['45']*dia*(a/45);
  if(a<90)  return settings.ded['45']*dia + (settings.ded['90']-settings.ded['45'])*dia*((a-45)/45);
  if(a<135) return settings.ded['90']*dia + (settings.ded['135']-settings.ded['90'])*dia*((a-90)/45);
  return settings.ded['135']*dia + settings.ded['135']*dia*((a-135)/45);
}
function hookLength(angle, dia){
  return (settings.hooks[String(parseInt(angle,10))] ?? 0) * dia;
}

const CL = {
  straight: ({len}) => len,
  L: ({A,B,angle,dia}) => A + B - bendDeduction(angle,dia),
  U: ({A,B,C,dia}) => A + B + C - 2*bendDeduction(90,dia),
  stirrup: ({A,B,cover,angle,dia,type,diaCirc}) => {
    const hook = (settings.hooks[angle]||0) * dia;
    const a = A - 2*cover - dia;
    const b = B - 2*cover - dia;
    if(type==='2') return 2*(a+b) + 2*hook;
    if(type==='4') return 2*(a+b) + 2*b + 2*a/3 + 4*hook;
    if(type==='4-master') return 4*(a+b) + 2*b + 2*a/3 + 6*hook;
    if(type==='circle'){ const d=diaCirc-2*cover-dia; return Math.PI*d + 2*hook; }
    if(type==='diamond') return 4*(0.5*Math.sqrt(a*a+b*b)) + 2*hook;
    if(type==='2-diamond') return 2*(a+b) + 4*(0.5*Math.sqrt(a*a+b*b)) + 4*hook;
    return 0;
  },
  circle:  ({dia,diaBar}) => Math.PI*(dia+diaBar) + 24*diaBar,
  spiral:  ({dia,pitch,turns,diaBar}) => {
    const D = dia+diaBar;
    return Math.sqrt((Math.PI*D)**2 + pitch**2) * turns + 8*diaBar;
  },
  crank:   ({span,depth,angle,dia}) => {
    const rad = angle*Math.PI/180;
    const extra = depth * (1/Math.sin(rad) - 1/Math.tan(rad));
    return span + 2*extra - 2*bendDeduction(angle,dia);
  },
  chair:   ({height,top,base}) => 2*height + top + base,
  'hook-semi': ({len, ends, dia}) => len + (ends==='both'?2:1) * hookLength(180, dia),
  'hook-L':    ({len, ends, dia}) => len + (ends==='both'?2:1) * hookLength(90,  dia),
  custom:  ({items,dia}) => {
    let t=0;
    for(const it of items){
      if(it.type==='leg')  t += Number(it.len||0);
      if(it.type==='bend'){ t -= bendDeduction(it.angle,dia); if(it.hook) t += hookLength(it.angle,dia); }
      if(it.type==='hook') t += hookLength(it.angle,dia);
    }
    return t;
  }
};

/* Worked cutting-length formula (real values substituted) for the schedule's
   "CL Calculation" column. Each function mirrors the matching CL.* math exactly
   so the trailing "= …" always equals the rounded CL/Bar value. Uses Unicode
   math glyphs on screen/CSV; the PDF exporter sanitises π/√/− to ASCII. */
const MINUS = '−', TIMES = '×';
const fmtN = n => { const r = Math.round(n*10)/10; return String(r); };
const CLcalc = {
  straight: ({len}) => `${fmtN(len)}`,
  L: ({A,B,angle,dia}) => { const d=bendDeduction(angle,dia);
    return `${fmtN(A)} + ${fmtN(B)} ${MINUS} ${fmtN(d)} = ${fmt0(A+B-d)}`; },
  U: ({A,B,C,dia}) => { const d=bendDeduction(90,dia);
    return `${fmtN(A)} + ${fmtN(B)} + ${fmtN(C)} ${MINUS} 2${TIMES}${fmtN(d)} = ${fmt0(A+B+C-2*d)}`; },
  stirrup: ({A,B,cover,angle,dia,type,diaCirc}) => {
    const hook = (settings.hooks[angle]||0) * dia;
    const a = A - 2*cover - dia;
    const b = B - 2*cover - dia;
    if(type==='2')
      return `2(${fmtN(a)} + ${fmtN(b)}) + 2${TIMES}${fmtN(hook)} = ${fmt0(2*(a+b)+2*hook)}`;
    if(type==='4')
      return `2(${fmtN(a)}+${fmtN(b)}) + 2${TIMES}${fmtN(b)} + 2${TIMES}${fmtN(a)}/3 + 4${TIMES}${fmtN(hook)} = ${fmt0(2*(a+b)+2*b+2*a/3+4*hook)}`;
    if(type==='4-master')
      return `4(${fmtN(a)}+${fmtN(b)}) + 2${TIMES}${fmtN(b)} + 2${TIMES}${fmtN(a)}/3 + 6${TIMES}${fmtN(hook)} = ${fmt0(4*(a+b)+2*b+2*a/3+6*hook)}`;
    if(type==='circle'){ const d=diaCirc-2*cover-dia;
      return `π${TIMES}${fmtN(d)} + 2${TIMES}${fmtN(hook)} = ${fmt0(Math.PI*d+2*hook)}`; }
    if(type==='diamond')
      return `4${TIMES}0.5${TIMES}√(${fmtN(a)}²+${fmtN(b)}²) + 2${TIMES}${fmtN(hook)} = ${fmt0(4*0.5*Math.sqrt(a*a+b*b)+2*hook)}`;
    if(type==='2-diamond')
      return `2(${fmtN(a)}+${fmtN(b)}) + 4${TIMES}0.5${TIMES}√(${fmtN(a)}²+${fmtN(b)}²) + 4${TIMES}${fmtN(hook)} = ${fmt0(2*(a+b)+4*0.5*Math.sqrt(a*a+b*b)+4*hook)}`;
    return '';
  },
  circle:  ({dia,diaBar}) => { const d=dia+diaBar;
    return `π(${fmtN(dia)} + ${fmtN(diaBar)}) + 24${TIMES}${fmtN(diaBar)} = ${fmt0(Math.PI*d+24*diaBar)}`; },
  spiral:  ({dia,pitch,turns,diaBar}) => { const D=dia+diaBar;
    return `√((π${TIMES}${fmtN(D)})² + ${fmtN(pitch)}²) ${TIMES} ${fmtN(turns)} + 8${TIMES}${fmtN(diaBar)} = ${fmt0(Math.sqrt((Math.PI*D)**2+pitch**2)*turns+8*diaBar)}`; },
  crank:   ({span,depth,angle,dia}) => {
    const rad=angle*Math.PI/180, extra=depth*(1/Math.sin(rad)-1/Math.tan(rad)), d=bendDeduction(angle,dia);
    return `${fmtN(span)} + 2${TIMES}${fmtN(extra)} ${MINUS} 2${TIMES}${fmtN(d)} = ${fmt0(span+extra*2-2*d)}`; },
  chair:   ({height,top,base}) =>
    `2${TIMES}${fmtN(height)} + ${fmtN(top)} + ${fmtN(base)} = ${fmt0(2*height+top+base)}`,
  'hook-semi': ({len,ends,dia}) => { const n=ends==='both'?2:1, h=hookLength(180,dia);
    return `${fmtN(len)} + ${n}${TIMES}${fmtN(h)} = ${fmt0(len+n*h)}`; },
  'hook-L':    ({len,ends,dia}) => { const n=ends==='both'?2:1, h=hookLength(90,dia);
    return `${fmtN(len)} + ${n}${TIMES}${fmtN(h)} = ${fmt0(len+n*h)}`; },
  custom:  ({items,dia}) => {
    let s='', v=0, first=true;
    for(const it of items){
      if(it.type==='leg'){ const L=Number(it.len||0); v+=L; s+=(first?'':' + ')+fmtN(L); first=false; }
      if(it.type==='bend'){ const d=bendDeduction(it.angle,dia); v-=d; s+=` ${MINUS} ${fmtN(d)}`;
        if(it.hook){ const h=hookLength(it.angle,dia); v+=h; s+=` + ${fmtN(h)}`; } }
      if(it.type==='hook'){ const h=hookLength(it.angle,dia); v+=h; s+=(first?'':' + ')+fmtN(h)+'(hook)'; first=false; }
    }
    return `${s.trim()} = ${fmt0(v)}`;
  }
};

/* =========================
   State & Table
   ========================= */
let rows = JSON.parse(localStorage.getItem('bbs_rows')||'[]');
let editIndex = -1;
let currentPage = (parseInt(localStorage.getItem('bbs_page')) || 1)
let navPersistTimer = null
let lastEditedIndex = -1
const DEFAULT_PAGE_SIZE = 25
let pageSize = DEFAULT_PAGE_SIZE

function persist(){ localStorage.setItem('bbs_rows', JSON.stringify(rows)); }
function recalcSums(){
  let sumLen=0, sumWt=0;
  rows.forEach(r=>{ sumLen+=r.totalLenM; sumWt+=r.totalWtKg; });
  $('#sumLen').textContent = fmt3(sumLen);
  $('#sumWt').textContent  = fmt3(sumWt);
  $('#countBadge').textContent = `${rows.length} item${rows.length!==1?'s':''}`;
}
function renderPagination() {
  const el = $('#paginationControls')
  if (!el) return
  if (!pageSize || pageSize <= 0 || rows.length <= pageSize) {
    el.style.display = 'none'
    return
  }
  el.style.display = 'inline-flex'
  el.style.alignItems = 'center'
  el.style.gap = '4px'
  $('#pageInfo').textContent = `Page ${currentPage} of ${getPageCount()}`
  $('#prevPage').disabled = currentPage <= 1
  $('#nextPage').disabled = currentPage >= getPageCount()
}
/* Thumbnail/preview source for a row's shape — vector (SVG) preferred, raster fallback. */
function shapeSrc(r){
  if(r && r.shapeVec && window.ShapeVector) return ShapeVector.toDataURL(r.shapeVec);
  return (r && r.shapeImg) || '';
}

function render(){
  const tbody = $('#tbody'); tbody.innerHTML='';
  clampPage()
  const pageRows = getPageRows()
  const offset = pageSize > 0 ? (currentPage - 1) * pageSize : 0
  pageRows.forEach((r,i)=>{
    const idx = offset + i
    const src = shapeSrc(r);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${idx+1}</td>
      <td>${r.member}</td>
      <td class="mono">${r.mark||''}</td>
      <td class="mono right">${r.dia}</td>
      <td>${r.shapeLabel}</td>
      <td style="text-align:center;padding:4px 6px">${src
        ? `<img src="${src}" alt="shape" class="sketch-thumb" data-enlarge="${idx}" title="Click to enlarge" style="max-width:120px;max-height:78px;width:100%;height:auto;object-fit:contain;display:block;margin:0 auto;border-radius:4px;background:var(--input-bg);padding:2px;cursor:zoom-in">`
        : '<span class="subtle">—</span>'}</td>
      <td class="mono" style="font-size:11px;line-height:1.4;min-width:140px">${r.clCalc||'<span class="subtle">—</span>'}</td>
      <td class="mono right">${fmt0(r.clPerBarMm)}</td>
      <td class="mono right">${r.qty}</td>
      <td class="mono right">${fmt0(r.extraLen||0)}</td>
      <td class="mono right">${fmt3(r.totalLenM)}</td>
      <td class="mono right">${fmt3(r.unitWtKgPerM)}</td>
      <td class="mono right">${fmt3(r.totalWtKg)}</td>
      <td>${r.remarks||''}</td>
      <td class="right" style="position:relative">
        <button class="btn small ghost options-btn" data-idx="${idx}" title="Options">⋮</button>
        <div class="options-menu" data-idx="${idx}">
          <button class="options-item" data-edit="${idx}">✏️ Edit</button>
          <button class="options-item" data-dup="${idx}">📋 Duplicate</button>
          <button class="options-item" data-dup-range="${idx}">🔢 Dup M–N Serial</button>
          <button class="options-item" data-move-below="${idx}">📥 Move Below Serial</button>
          <button class="options-item danger" data-del="${idx}">🗑️ Delete</button>
        </div>
      </td>`;
    tr.dataset.index = idx;
    tr.setAttribute('draggable','true');
    tbody.appendChild(tr);
  });
  recalcSums();
  renderPagination()
  updateRecordNav()
  localStorage.setItem('bbs_page', String(currentPage))
}

/* =========================
   Sketch enlarge lightbox
   ========================= */
function openSketchLightbox(r){
  const dlg = $('#sketchDlg');
  $('#sketchDlgImg').src = shapeSrc(r);
  const label = [r.member, r.mark, r.shapeLabel].filter(Boolean).join(' · ');
  $('#sketchDlgTitle').textContent = label || 'Shape Sketch';
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open','');
}
$('#sketchDlgClose').addEventListener('click', ()=> $('#sketchDlg').close());
// Click on the backdrop (outside the content) closes the lightbox
$('#sketchDlg').addEventListener('click', e=>{ if(e.target.id==='sketchDlg') $('#sketchDlg').close(); });

function computeQty(mode,{qty,spacing,span,offsetStart,offsetEnd}){
  if(mode==='manual') return qty>0?qty:0;
  const eff = Math.max(0,(span||0)-(offsetStart||0)-(offsetEnd||0));
  if(eff<=0||!spacing||spacing<=0) return 0;
  return Math.floor(eff/spacing)+1;
}

/* =========================
   Form handlers
   ========================= */
function showShape(name){
  $$('.shape').forEach(el=>el.classList.add('hidden'));
  $(`.shape-${name}`).classList.remove('hidden');
}
function showQty(mode){
  $$('.qty-manual').forEach(el=>el.classList.toggle('hidden',mode!=='manual'));
  $$('.qty-spacing').forEach(el=>el.classList.toggle('hidden',mode!=='spacing'));
}
$('#shape').addEventListener('change', e=>showShape(e.target.value));
$('#qtyMode').addEventListener('change', e=>showQty(e.target.value));
$('#S_type').addEventListener('change', () => {
  const isCirc = $('#S_type').value === 'circle';
  document.querySelectorAll('.fg-stirrup-rect').forEach(el => el.classList.toggle('hidden', isCirc));
  document.querySelector('.fg-stirrup-circ').classList.toggle('hidden', !isCirc);
});

/* Custom builder */
let customItems = [];
function resetCustom(){ customItems=[]; $('#customList').innerHTML=''; }
function addLeg(len=''){
  const idx = customItems.push({type:'leg',len})-1;
  const row = document.createElement('div');
  row.className='custom-item';
  row.innerHTML = `
    <span class="pill">Leg ${customItems.filter(x=>x.type==='leg').length}</span>
    <input type="number" min="1" step="1" value="${len}" placeholder="Length" data-kind="leg" data-idx="${idx}" />
    <span class="ci-unit">mm</span>
    <button type="button" class="btn small ghost" data-remove="${idx}">✕</button>
  `;
  $('#customList').appendChild(row);
}
function addBend(angle=90, hook=false){
  const idx = customItems.push({type:'bend',angle,hook})-1;
  const row = document.createElement('div');
  row.className='custom-item';
  row.innerHTML = `
    <span class="pill">Bend</span>
    <span class="ci-unit">Angle</span>
    <select data-kind="bend-angle" data-idx="${idx}">
      <option value="45" ${angle==45?'selected':''}>45°</option>
      <option value="90" ${angle==90?'selected':''}>90°</option>
      <option value="135" ${angle==135?'selected':''}>135°</option>
      <option value="180" ${angle==180?'selected':''}>180°</option>
    </select>
    <label class="ci-chk">
      <input type="checkbox" data-kind="hook" data-idx="${idx}" ${hook?'checked':''}> Hook
    </label>
    <button type="button" class="btn small ghost" data-remove="${idx}">✕</button>
  `;
  $('#customList').appendChild(row);
}
function addHook(angle=180){
  const idx = customItems.push({type:'hook',angle})-1;
  const row = document.createElement('div');
  row.className='custom-item';
  row.innerHTML = `
    <span class="pill">Hook</span>
    <span class="ci-unit">Angle</span>
    <select data-kind="hook-angle" data-idx="${idx}">
      <option value="90" ${angle==90?'selected':''}>90°</option>
      <option value="135" ${angle==135?'selected':''}>135°</option>
      <option value="180" ${angle==180?'selected':''}>180°</option>
    </select>
    <button type="button" class="btn small ghost" data-remove="${idx}">✕</button>
  `;
  $('#customList').appendChild(row);
}
$('#addLeg').addEventListener('click',()=>{ addLeg(); updateCustomPreview(); });
$('#addBend').addEventListener('click',()=>{ addBend(); updateCustomPreview(); });
$('#addHook').addEventListener('click',()=>{ addHook(); updateCustomPreview(); });
$('#customList').addEventListener('change', e=>{
  const el = e.target, idx = Number(el.dataset.idx);
  if(el.dataset.kind==='leg')        customItems[idx].len   = el.value;
  if(el.dataset.kind==='bend-angle') customItems[idx].angle = Number(el.value);
  if(el.dataset.kind==='hook-angle') customItems[idx].angle = Number(el.value);
  if(el.dataset.kind==='hook')       customItems[idx].hook  = el.checked;
  updateCustomPreview();
});
$('#customList').addEventListener('click', e=>{
  if(e.target.dataset.remove!==undefined){
    customItems[Number(e.target.dataset.remove)].type='deleted';
    e.target.closest('.custom-item').remove();
    updateCustomPreview();
  }
});
function updateCustomPreview(){
  const dia = Number($('#dia').value||0);
  const items = customItems.filter(x=>x.type!=='deleted');
  const cl = CL.custom({items,dia});
  $('#customPreview').textContent = isFinite(cl) ? fmt0(cl) : '0';
}

/* Reset button */
$('#reset').setAttribute('type','button');
$('#reset').addEventListener('click', ()=>location.reload());

/* =========================
   Form Submit
   ========================= */
$('#barForm').addEventListener('submit', e=>{
  e.preventDefault();
  const member  = $('#member').value.trim();
  const mark    = $('#mark').value.trim();
  const shape   = $('#shape').value;
  const dia     = Number($('#dia').value);
  const remarks = $('#remarks').value.trim();
  const grade   = $('#grade').value;
  const qtyMode = $('#qtyMode').value;

  let cl=0, clCalc='', shapeLabel='';
  if(shape==='straight'){
    const a={len:Number($('#straightLen').value)};
    cl=CL.straight(a); clCalc=CLcalc.straight(a); shapeLabel='Straight';
  }else if(shape==='L'){
    const a={A:Number($('#L_A').value),B:Number($('#L_B').value),angle:Number($('#L_angle').value),dia};
    cl=CL.L(a); clCalc=CLcalc.L(a); shapeLabel=`L (${a.angle}°)`;
  }else if(shape==='U'){
    const a={A:Number($('#U_A').value),B:Number($('#U_B').value),C:Number($('#U_C').value),dia};
    cl=CL.U(a); clCalc=CLcalc.U(a); shapeLabel='U';
  }else if(shape==='stirrup'){
    const type=$('#S_type').value, cover=Number($('#S_cover').value), angle=Number($('#S_angle').value);
    let a;
    if(type==='circle'){ a={A:0,B:0,diaCirc:Number($('#S_diaCirc').value),cover,angle,dia,type}; }
    else{ a={A:Number($('#S_A').value),B:Number($('#S_B').value),cover,angle,dia,type}; }
    const labels={2:'2-Legged',4:'4-Legged','4-master':'4-Legged Master Ring',circle:'Circular',diamond:'Diamond','2-diamond':'2-Legged Rect + Diamond'};
    cl=CL.stirrup(a); clCalc=CLcalc.stirrup(a); shapeLabel=`Stirrup ${labels[type]||type}`;
  }else if(shape==='circle'){
    const diaVal=Number($('#C_dia').value), a={dia:diaVal,diaBar:dia};
    cl=CL.circle(a); clCalc=CLcalc.circle(a); shapeLabel=`Circle ⌀${diaVal}`;
  }else if(shape==='spiral'){
    const diaVal=Number($('#SP_dia').value),turns=Number($('#SP_turns').value);
    const a={dia:diaVal,pitch:Number($('#SP_pitch').value),turns,diaBar:dia};
    cl=CL.spiral(a); clCalc=CLcalc.spiral(a); shapeLabel=`Spiral ⌀${diaVal} (${turns} turns)`;
  }else if(shape==='crank'){
    const a={span:Number($('#CR_span').value),depth:Number($('#CR_depth').value),angle:Number($('#CR_angle').value),dia};
    cl=CL.crank(a); clCalc=CLcalc.crank(a); shapeLabel=`Crank ${a.angle}°`;
  }else if(shape==='chair'){
    const a={height:Number($('#CH_height').value),top:Number($('#CH_top').value),base:Number($('#CH_base').value),dia};
    cl=CL.chair(a); clCalc=CLcalc.chair(a); shapeLabel=`Chair ${a.height}h`;
  }else if(shape==='hook-semi'){
    const a={len:Number($('#HS_len').value),ends:$('#HS_ends').value,dia};
    cl=CL['hook-semi'](a); clCalc=CLcalc['hook-semi'](a);
    shapeLabel=`Straight 180° hook (${a.ends==='both'?'both ends':a.ends+' end'})`;
  }else if(shape==='hook-L'){
    const a={len:Number($('#HL_len').value),ends:$('#HL_ends').value,dia};
    cl=CL['hook-L'](a); clCalc=CLcalc['hook-L'](a);
    shapeLabel=`Straight 90° hook (${a.ends==='both'?'both ends':a.ends+' end'})`;
  }else if(shape==='custom'){
    const a={items:customItems.filter(x=>x.type!=='deleted'),dia};
    cl=CL.custom(a); clCalc=CLcalc.custom(a); shapeLabel=$('#customName').value.trim()||'Other shape';
  }

  if(!isFinite(cl)||cl<=0){ if(window._showFeedback) window._showFeedback('⚠ Check dimensions — CL must be > 0','err'); else alert('Please provide valid dimensions. Cutting length must be > 0.'); return; }

  // Extra / lap length is reported in its own column and added once per row to the
  // total — it is NOT folded into the per-bar cutting length (CL/Bar stays pure).
  const extraLen=Number($('#extraLen').value)||0;

  const qty=computeQty(qtyMode,{qty:Number($('#qty').value),spacing:Number($('#spacing').value),span:Number($('#span').value),offsetStart:Number($('#offsetStart').value),offsetEnd:Number($('#offsetEnd').value)});
  if(qty<=0){ if(window._showFeedback) window._showFeedback('⚠ Quantity is zero — check spacing/span','err'); else alert('Quantity is zero. Check inputs or spacing.'); return; }

  const wtPerM=unitWeightKgPerM(dia), totalLenM=(cl*qty+extraLen)/1000, totalWtKg=wtPerM*totalLenM;

  const row = {
    member,mark,shape,shapeLabel,dia,
    clPerBarMm:cl,clCalc,qty,unitWtKgPerM:wtPerM,totalLenM,totalWtKg,
    remarks,grade,createdAt:Date.now(),
    shapeVec: currentShapeVec||null,
    shapeHist: currentShapeHist||null,
    shapeImg: currentShapeImg||null,
    inputs:{}
  };

  // Save raw inputs for edit
  row.extraLen=extraLen;
  if(shape==='straight'){ row.inputs={len:Number($('#straightLen').value)}; }
  else if(shape==='L'){ row.inputs={A:Number($('#L_A').value),B:Number($('#L_B').value),angle:Number($('#L_angle').value)}; }
  else if(shape==='U'){ row.inputs={A:Number($('#U_A').value),B:Number($('#U_B').value),C:Number($('#U_C').value)}; }
  else if(shape==='stirrup'){
    const type=$('#S_type').value, cover=Number($('#S_cover').value), angle=Number($('#S_angle').value);
    row.inputs={type,cover,angle};
    if(type==='circle'){ row.inputs.diaCirc=Number($('#S_diaCirc').value); }
    else{ row.inputs.A=Number($('#S_A').value); row.inputs.B=Number($('#S_B').value); }
  }
  else if(shape==='circle'){ row.inputs={diaVal:Number($('#C_dia').value)}; }
  else if(shape==='spiral'){ row.inputs={diaVal:Number($('#SP_dia').value),pitch:Number($('#SP_pitch').value),turns:Number($('#SP_turns').value)}; }
  else if(shape==='crank'){  row.inputs={span:Number($('#CR_span').value),depth:Number($('#CR_depth').value),angle:Number($('#CR_angle').value)}; }
  else if(shape==='chair'){     row.inputs={height:Number($('#CH_height').value),top:Number($('#CH_top').value),base:Number($('#CH_base').value)}; }
  else if(shape==='hook-semi'){ row.inputs={len:Number($('#HS_len').value),ends:$('#HS_ends').value}; }
  else if(shape==='hook-L'){    row.inputs={len:Number($('#HL_len').value),ends:$('#HL_ends').value}; }
  else if(shape==='custom'){    row.inputs={items:customItems.filter(x=>x.type!=='deleted'),name:$('#customName').value.trim()}; }

  let verb='Added';
  if(editIndex>=0 && editIndex<rows.length){ lastEditedIndex=editIndex; rows[editIndex]=row; verb='Updated'; editIndex=-1; }
  else { rows.push(row); }
  sortRowsByMemberGroup()
  if (verb === 'Updated') {
    if (navPersistTimer) { clearTimeout(navPersistTimer); navPersistTimer = null }
    navPersistTimer = setTimeout(() => {
      navPersistTimer = null
      lastEditedIndex = -1
      updateRecordNav()
    }, 5000)
  }
  const submitBtn=document.querySelector('.submit-btn');
  if (submitBtn) {
    submitBtn.textContent = verb === 'Added' ? '✅ Added!' : '✅ Updated!';
    submitBtn.classList.add('active');
    submitBtn.disabled = true;
    setTimeout(() => {
      submitBtn.textContent = '➕ Add to Schedule';
      submitBtn.classList.remove('active');
      submitBtn.disabled = false;
    }, 5000);
  }
  persist(); render();
  if(window._showFeedback) window._showFeedback(`✔ ${verb} ${shapeLabel} · ${fmt0(cl)} mm · ${fmt3(totalWtKg)} kg`,'ok');
  $('#barForm').reset();
  clearShapeUpload();
  showShape('straight'); showQty('manual'); resetCustom(); updateCustomPreview();
});

/* =========================
   Group members & sort inside groups
   ========================= */
function sortRowsByMemberGroup() {
  const groups = [], memberOrder = []
  for (const r of rows) {
    const key = r.member
    if (!memberOrder.includes(key)) {
      memberOrder.push(key)
      groups.push({ member: key, items: [] })
    }
    groups[memberOrder.indexOf(key)].items.push(r)
  }
  for (const g of groups) {
    g.items.sort((a, b) => (a.mark || '').localeCompare(b.mark || '', undefined, { numeric: true }))
  }
  rows = groups.flatMap(g => g.items)
}

/* =========================
   Edit & Delete
   ========================= */
$('#bbsTable').addEventListener('click', e=>{
  const optsBtn = e.target.closest('.options-btn')
  if (optsBtn) {
    const idx = optsBtn.dataset.idx
    const menu = document.querySelector(`.options-menu[data-idx="${idx}"]`)
    if (menu) {
      document.querySelectorAll('.options-menu.open').forEach(m => { if (m !== menu) m.classList.remove('open') })
      menu.classList.toggle('open')
    }
    return
  }
  const del=e.target.dataset.del, edit=e.target.dataset.edit, enlarge=e.target.dataset.enlarge,
        dup=e.target.dataset.dup, dupRange=e.target.dataset.dupRange, moveBelow=e.target.dataset.moveBelow;
  if(enlarge!==undefined){ const r=rows[Number(enlarge)]; if(r&&(r.shapeVec||r.shapeImg)) openSketchLightbox(r); return; }
  if(dup!==undefined){
    closeOptionsMenus()
    const di=Number(dup)
    const copy=structuredClone(rows[di])
    copy.createdAt=Date.now()
    rows.splice(di+1,0,copy)
    persist(); render()
  }else if(dupRange!==undefined){
    closeOptionsMenus()
    const di=Number(dupRange)
    const r=rows[di]
    const label=r?`${r.member||'item'} ${r.mark||''}`:'this row'
    const m=prompt(`From serial #? (${label})`,'1'); if(m===null) return
    const n=prompt('To serial #?','5'); if(n===null) return
    const start=parseInt(m,10), end=parseInt(n,10)
    if(isNaN(start)||isNaN(end)||start<1||end<start){ alert('Invalid range'); return }
    const inserts=[]
    for(let s=start;s<=end;s++){
      const copy=structuredClone(r)
      copy.createdAt=Date.now()+s
      copy.mark=(copy.mark||'')+'-'+String(s).padStart(2,'0')
      inserts.push(copy)
    }
    rows.splice(di+1,0,...inserts)
    persist(); render()
  }else if(moveBelow!==undefined){
    closeOptionsMenus()
    const mi=Number(moveBelow)
    const r=rows[mi]
    const label=r?`${r.member||'item'} ${r.mark||''}`:'this row'
    const target=prompt(`Enter row serial to move "${label}" below (0 = top of schedule, 1-${rows.length} = row position):`,`${mi+1}`)
    if(target===null) return
    const ts=Number(target)
    if(isNaN(ts)||ts<0||ts>rows.length||!Number.isInteger(ts)){
      alert(`Invalid. Enter a number between 0 and ${rows.length}.`)
      return
    }
    if(ts===0){
      const [rm]=rows.splice(mi,1)
      rows.unshift(rm)
      clampPage()
      persist(); render()
      return
    }
    const ti=ts-1
    if(ti===mi){alert('Row is already at that position'); return}
    const [rm]=rows.splice(mi,1)
    const insertAt=mi<ti?ti:ti+1
    rows.splice(insertAt,0,rm)
    clampPage()
    persist(); render()
  }else if(del!==undefined){
    const r=rows[Number(del)];
    const label=r?`${r.member||'item'}${r.mark?' ('+r.mark+')':''}`:'this row';
    if(!confirm(`Delete ${label} from the schedule?`)) return;
    const di=Number(del);
    rows.splice(di,1);
    clampPage()
    if(editIndex===di) editIndex=-1;
    else if(editIndex>di) editIndex--;
    persist(); render();
  }
  else if(edit!==undefined){
    closeOptionsMenus()
    loadRow(Number(edit))
  }
});

document.addEventListener('click', e => {
  if (!e.target.closest('.options-menu') && !e.target.closest('.options-btn')) {
    closeOptionsMenus()
  }
})

/* =========================
   Record navigation (prev/next in add bar)
   ========================= */
function loadRow(i) {
  const r = rows[i]
  if (!r) return
  editIndex = i
  if (pageSize > 0) currentPage = Math.floor(i / pageSize) + 1
  const submitBtn = document.querySelector('.submit-btn')
  if (submitBtn) submitBtn.textContent = '✏️ Update Schedule'
  const inp = r.inputs || {}
  $('#member').value = r.member
  $('#mark').value   = r.mark||''
  $('#shape').value  = r.shape
  showShape(r.shape)
  $('#dia').value    = r.dia
  $('#remarks').value= r.remarks||''
  $('#extraLen').value = r.extraLen||0
  $('#grade').value  = r.grade||'Fe 415'
  $('#qtyMode').value = 'manual'
  showQty('manual')
  $('#qty').value    = r.qty

  if (r.shapeVec || r.shapeImg) {
    currentShapeVec = r.shapeVec || null
    currentShapeImg = r.shapeImg || null
    currentShapeHist = r.shapeHist || null
    $('#shapePreview').src = shapeSrc(r)
    $('#shapePreview').style.display = 'block'
    $('#shapeClearBtn').style.display = 'inline-flex'
  } else {
    clearShapeUpload()
  }

  if (r.shape === 'straight') { $('#straightLen').value = inp.len||'' }
  if (r.shape === 'L') { $('#L_A').value = inp.A||''; $('#L_B').value = inp.B||''; $('#L_angle').value = inp.angle||90 }
  if (r.shape === 'U') { $('#U_A').value = inp.A||''; $('#U_B').value = inp.B||''; $('#U_C').value = inp.C||'' }
  if (r.shape === 'stirrup') {
    $('#S_type').value = inp.type||'2'; $('#S_cover').value = inp.cover||25; $('#S_angle').value = inp.angle||135
    $('#S_type').dispatchEvent(new Event('change'))
    if (inp.type === 'circle') { $('#S_diaCirc').value = inp.diaCirc||'' }
    else { $('#S_A').value = inp.A||''; $('#S_B').value = inp.B||'' }
  }
  if (r.shape === 'circle')  { $('#C_dia').value = inp.diaVal||'' }
  if (r.shape === 'spiral')  { $('#SP_dia').value = inp.diaVal||''; $('#SP_pitch').value = inp.pitch||''; $('#SP_turns').value = inp.turns||'' }
  if (r.shape === 'crank')   { $('#CR_span').value = inp.span||''; $('#CR_depth').value = inp.depth||''; $('#CR_angle').value = inp.angle||45 }
  if (r.shape === 'chair')   { $('#CH_height').value = inp.height||''; $('#CH_top').value = inp.top||''; $('#CH_base').value = inp.base||'' }
  if (r.shape === 'hook-semi') { $('#HS_len').value = inp.len||''; $('#HS_ends').value = inp.ends||'both' }
  if (r.shape === 'hook-L')  { $('#HL_len').value = inp.len||''; $('#HL_ends').value = inp.ends||'both' }
  if (r.shape === 'custom') {
    resetCustom()
    $('#customName').value = inp.name||''
    for (const it of (inp.items||[])) {
      if (it.type === 'leg') addLeg(it.len);
      else if (it.type === 'bend') addBend(it.angle, it.hook);
      else if (it.type === 'hook') addHook(it.angle);
    }
    updateCustomPreview()
  }
  updateRecordNav()
  $('#member').focus()
  $('#member').scrollIntoView({behavior:'smooth',block:'center'})
}

function navRecord(dir) {
  if (!rows.length) return
  if (navPersistTimer) { clearTimeout(navPersistTimer); navPersistTimer = null }
  lastEditedIndex = -1
  const submitBtn = document.querySelector('.submit-btn')
  if (submitBtn) {
    submitBtn.textContent = '➕ Add to Schedule'
    submitBtn.classList.remove('active')
    submitBtn.disabled = false
  }
  let base = editIndex >= 0 ? editIndex : rows.length - 1
  let target = base + dir
  if (target < 0) target = 0
  if (target >= rows.length) target = rows.length - 1
  loadRow(target)
}

function updateRecordNav() {
  const btns = document.querySelector('.nav-record-btns')
  if (!btns) return
  if (editIndex < 0 && !navPersistTimer) { btns.style.display = 'none'; return }
  btns.style.display = 'inline-flex'
  btns.style.alignItems = 'center'
  btns.style.gap = '2px'
  const idx = editIndex >= 0 ? editIndex : lastEditedIndex
  $('#prevRecord').disabled = idx <= 0
  $('#nextRecord').disabled = idx >= rows.length - 1
  $('#recordNavInfo').textContent = `${idx + 1} / ${rows.length}`
}

$('#prevRecord').addEventListener('click', () => navRecord(-1))
$('#nextRecord').addEventListener('click', () => navRecord(+1))

/* =========================
   Settings controls
   ========================= */
$('#saveSettings').addEventListener('click',()=>{
  settings.unitMethod=   $('#unitMethod').value;
  settings.density=      Number($('#density').value);
  settings.hooks['90']=  Number($('#hook90').value);
  settings.hooks['135']= Number($('#hook135').value);
  settings.hooks['180']= Number($('#hook180').value);
  settings.ded['45']=    Number($('#ded45').value);
  settings.ded['90']=    Number($('#ded90').value);
  settings.ded['135']=   Number($('#ded135').value);
  saveSettings(); alert('Settings saved.');
});
$('#resetSettings').addEventListener('click',()=>{ resetSettings(); alert('Settings reset to defaults.'); });
$('#btnSettings').addEventListener('click',()=>{
  const isOpen = !$('#settingsPanel').classList.contains('collapsed');
  // Close both first, then toggle settings
  $('#infoPanel').classList.add('collapsed');
  $('#settingsPanel').classList.toggle('collapsed', isOpen);
});
$('#btnHelp').addEventListener('click',()=>document.getElementById('helpDlg').showModal());

/* =========================
   CSV Export  (includes project info header) — uses Papa Parse
   ========================= */
function toCSV(){
  const lines = [];
  // Project info block (free text)
  if (projectInfo.header) lines.push(projectInfo.header);
  lines.push('BAR BENDING SCHEDULE (BBS)');
  lines.push(`Name of Work,${projectInfo.project || '-'}`);
  lines.push(`Name of Agency,${projectInfo.agency || '-'}`);
  lines.push(`Reference,${projectInfo.ref || '-'}`);
  lines.push('');

  // Build tabular data as array of objects for Papa.unparse
  const totalLen = rows.reduce((a,b)=>a+b.totalLenM,0);
  const totalWt  = rows.reduce((a,b)=>a+b.totalWtKg,0);
  const data = rows.map((r,i) => ({
    '#': i + 1,
    Member: r.member,
    Mark: r.mark || '',
    Ø: r.dia,
    Shape: r.shapeLabel,
    'CL Calculation': r.clCalc || '',
    'CL / Bar (mm)': fmt0(r.clPerBarMm),
    Qty: r.qty,
    'Extra/Lap (mm)': fmt0(r.extraLen || 0),
    'Total L (m)': fmt3(r.totalLenM),
    'Wt / m (kg)': fmt3(r.unitWtKgPerM),
    'Total Wt (kg)': fmt3(r.totalWtKg),
    Remarks: r.remarks || ''
  }));
  // Append totals row
  data.push({
    '#': 'Totals', Member: '', Mark: '', Ø: '',
    Shape: '', 'CL Calculation': '', 'CL / Bar (mm)': '',
    Qty: '', 'Extra/Lap (mm)': '',
    'Total L (m)': fmt3(totalLen),
    'Wt / m (kg)': '',
    'Total Wt (kg)': fmt3(totalWt),
    Remarks: ''
  });

  lines.push(Papa.unparse(data, { newline: '\r\n' }));
  return lines.join('\r\n');
}
$('#exportCSV').addEventListener('click',()=>{
  // BOM helps Excel recognise UTF-8
  const bom = '\uFEFF';
  const blob = new Blob([bom + toCSV()],{type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bbs_${(projectInfo.project||'schedule').replace(/[^a-z0-9]/gi,'_').toLowerCase()}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
});

/* =========================
   CSV Import  (using Papa Parse)
   ========================= */
$('#importCSV').addEventListener('click', () => {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv,text/csv';
  inp.onchange = () => {
    const file = inp.files[0]; if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const result = Papa.parse(fr.result, { header: true, skipEmptyLines: true, dynamicTyping: true });
        if (result.errors.length) console.warn('CSV parse warnings:', result.errors);
        if (!result.data || !result.data.length) { alert('No data found in CSV.'); return; }

        const cols = result.meta.fields || [];
        const colIdx = {};
        cols.forEach((c, i) => colIdx[c.trim().toLowerCase()] = i);

        // Map CSV column headers (from export format) to row properties
        const mapKey = {
          'member': 'member', 'mark': 'mark', 'ø': 'dia', 'φ': 'dia',
          'shape': 'shapeLabel', 'cl / bar (mm)': 'clPerBarMm',
          'cl calculation': 'clCalc', 'qty': 'qty',
          'extra/lap (mm)': 'extraLen', 'total l (m)': 'totalLenM',
          'wt / m (kg)': 'unitWtKgPerM', 'total wt (kg)': 'totalWtKg',
          'remarks': 'remarks', 'cl/bar (mm)': 'clPerBarMm',
          'extra (mm)': 'extraLen', 'wt/m (kg)': 'unitWtKgPerM'
        };
        const csvCols = cols.map(c => c.trim().toLowerCase().replace(/[−–—]/g, '-'));
        // Infer project info from text lines before the table header

        for (const rawLine of fr.result.split('\n')) {
          const line = rawLine.trim();
          if (!line) continue;
          if (/^name of work/i.test(line)) {
            const val = line.split(',').slice(1).join(',').replace(/^"|"$/g, '').trim();
            if (val && val !== '-') projectInfo.project = val;
          } else if (/^name of agency/i.test(line)) {
            const val = line.split(',').slice(1).join(',').replace(/^"|"$/g, '').trim();
            if (val && val !== '-') projectInfo.agency = val;
          } else if (/^reference/i.test(line)) {
            const val = line.split(',').slice(1).join(',').replace(/^"|"$/g, '').trim();
            if (val && val !== '-') projectInfo.ref = val;
          }
        }
        applyInfoToForm();
        saveInfoToStorage();
        updatePrintMeta();

        const imported = [];
        for (const row of result.data) {
          // Skip totals row
          const first = Object.values(row)[0];
          if (first != null && String(first).trim().toLowerCase() === 'totals') continue;

          const r = {
            member: '',
            mark: '',
            dia: 8,
            shape: 'straight',
            shapeLabel: 'Straight',
            clPerBarMm: 0,
            clCalc: '',
            qty: 1,
            extraLen: 0,
            totalLenM: 0,
            unitWtKgPerM: 0,
            totalWtKg: 0,
            remarks: '',
            grade: 'Fe 500',
            createdAt: Date.now() + imported.length,
            shapeVec: null,
            shapeHist: null,
            shapeImg: null,
            inputs: {}
          };

          for (const [k, v] of Object.entries(row)) {
            const key = k.trim().toLowerCase().replace(/[−–—]/g, '-');
            const target = mapKey[key];
            if (!target) continue;
            if (target === 'dia') {
              r.dia = Number(v) || 8;
              r.shape = 'straight';
              r.inputs = { len: r.clPerBarMm || 0 };
            } else if (target === 'member') {
              r.member = String(v || '');
            } else if (target === 'mark') {
              r.mark = String(v || '');
            } else if (target === 'shapeLabel' && v) {
              r.shapeLabel = String(v);
              // Try to guess the shape key from the label
              const sl = String(v).toLowerCase();
              if (sl.includes('stirrup') || sl.includes('link')) r.shape = 'stirrup';
              else if (sl.includes('l (')) r.shape = 'L';
              else if (sl === 'u') r.shape = 'U';
              else if (sl.includes('circle')) r.shape = 'circle';
              else if (sl.includes('spiral')) r.shape = 'spiral';
              else if (sl.includes('crank')) r.shape = 'crank';
              else if (sl.includes('chair')) r.shape = 'chair';
              else if (sl.includes('180')) r.shape = 'hook-semi';
              else if (sl.includes('90')) r.shape = 'hook-L';
              else if (sl.includes('other') || sl.includes('custom')) r.shape = 'custom';
              else r.shape = 'straight';
            } else if (target === 'clPerBarMm') {
              r.clPerBarMm = Number(v) || 0;
            } else if (target === 'clCalc') {
              r.clCalc = String(v || '');
            } else if (target === 'qty') {
              r.qty = Number(v) || 0;
            } else if (target === 'extraLen') {
              r.extraLen = Number(v) || 0;
            } else if (target === 'totalLenM') {
              r.totalLenM = Number(v) || 0;
            } else if (target === 'unitWtKgPerM') {
              r.unitWtKgPerM = Number(v) || 0;
            } else if (target === 'totalWtKg') {
              r.totalWtKg = Number(v) || 0;
            } else if (target === 'remarks') {
              r.remarks = String(v || '');
            }
          }

          // If totalLenM was not parsed but we have clPerBarMm and qty, compute it
          if (!r.totalLenM && r.clPerBarMm && r.qty) {
            r.totalLenM = (r.clPerBarMm * r.qty + (r.extraLen || 0)) / 1000;
          }
          // If totalWtKg was not parsed but we have totalLenM and unitWtKgPerM, compute it
          if (!r.totalWtKg && r.totalLenM && r.unitWtKgPerM) {
            r.totalWtKg = r.totalLenM * r.unitWtKgPerM;
          }

          if (r.member || r.clPerBarMm > 0) {
            imported.push(r);
          }
        }

        if (!imported.length) { alert('No valid bar rows found in CSV.'); return; }
        rows.push(...imported);
        sortRowsByMemberGroup();
        persist();
        render();
        alert(`✅ Imported ${imported.length} bar${imported.length > 1 ? 's' : ''} from CSV.`);
      } catch (err) {
        alert('Failed to parse CSV. See console for details.');
        console.error('CSV import failed:', err);
      }
    };
    fr.readAsText(file);
  };
  inp.click();
});

/* =========================
   Save / Load JSON  (includes project info)
   ========================= */
$('#saveJSON').addEventListener('click',()=>{
  const now = new Date();
  const ts  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}`;
  const blob = new Blob([buildExportJSON({rows,settings,projectInfo})],{type:'application/json'});
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `bbs_${ts}.json`;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(a.href); },0);
});
$('#loadJSON').addEventListener('click',()=>{
  const inp = document.createElement('input'); inp.type='file'; inp.accept='.json,application/json';
  inp.onchange=()=>{
    const file=inp.files[0]; if(!file) return;
    const fr = new FileReader();
    fr.onload=()=>{
      try{
        const data=JSON.parse(fr.result);
        if(Array.isArray(data.rows))   { rows = data.rows; editIndex=-1; }
        if(data.settings)              { settings=data.settings; saveSettings(); }
        if(data.projectInfo)           { projectInfo=Object.assign({},INFO_DEFAULTS,data.projectInfo); applyInfoToForm(); saveInfoToStorage(); updatePrintMeta(); }
        persist(); render();
      }catch(err){ alert('Invalid JSON file.'); }
    };
    fr.readAsText(file);
  };
  inp.click();
});

/* =========================
   Print  (fills meta + date)
   ========================= */
$('#printBBS').addEventListener('click', async () => {
  updatePrintMeta();

  // Opt-in: draw the ribbed/3D rebar texture as vectors (larger PDF) instead
  // of the clean centreline. Off → clean vector (smallest files).
  const pdfTextured = !!($('#pdfTextured') && $('#pdfTextured').checked);

  const btn = $('#printBBS');
  btn.disabled = true;
  btn.textContent = '⏳ Generating…';

  try {
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF not loaded');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const pageW   = pdf.internal.pageSize.getWidth();
    const pageH   = pdf.internal.pageSize.getHeight();
    const margin  = 10;
    const usableW = pageW - margin * 2;

    // Standard PDF fonts use WinAnsi encoding — swap glyphs they can't encode
    // (e.g. ⌀ U+2300) for a supported equivalent so they don't drop out.
    const sani = s => String(s == null ? '' : s)
      .replace(/⌀/g, 'Ø').replace(/π/g, 'pi').replace(/√/g, 'sqrt').replace(/−/g, '-');

    const pad   = 1.6;     // cell padding (mm)
    const lineH = 3.6;     // text line height (mm)
    const fontSize     = 8;
    const sketchMaxH   = 35;   // max sketch height per row (mm)

    // ── Column layout — widths fit to actual content, then normalised to fill usableW ──
    // Add `pct:` (percent of the usable page width) to lock a column to a fixed
    // width; columns without `pct` keep auto-sizing and share whatever's left.
    // The pct values you set don't have to add up to 100 — leave headroom for
    // the auto-sized columns. e.g. { key:'rem', title:'Remarks', align:'left', pct:18 }
    const cols = [
      { key:'idx',    title:'#',             align:'right' },
      { key:'member', title:'Member',        align:'left' },
      { key:'mark',   title:'Mark',          align:'left' },
      { key:'dia',    title:'Ø',      		align:'center', pct:3 },
      { key:'sketch', title:'Sketch',        align:'center' },
      { key:'calc',   title:'CL Calculation',align:'left',  pct:16 },
      { key:'cl',     title:'CL/Bar (mm)',   align:'right', pct:12  },
      { key:'qty',    title:'Qty',           align:'right', pct:9  },
      { key:'extra',  title:'Extra/Lap (mm)',align:'right', pct:11 },
      { key:'totL',   title:'Total L (m)',   align:'right', pct:12 },
      { key:'wtm',    title:'Wt/m (kg)',     align:'right', pct:12 },
      { key:'totW',   title:'Total Wt (kg)', align:'right', pct:12 },
      { key:'rem',    title:'Remarks',       align:'left', pct:13   },
    ];

    // Every string a column must hold (header + all cells + totals), per key
    const cellStrings = key => {
      if (key === 'sketch') return [];
      const out = [];
      rows.forEach((r,i) => {
        switch (key) {
          case 'idx':    out.push(String(i+1)); break;
          case 'member': out.push(sani(r.member||'')); break;
          case 'mark':   out.push(sani(r.mark||'')); break;
          case 'dia':    out.push(String(r.dia)); break;
          case 'shape':  out.push(sani(r.shapeLabel||'')); break;
          case 'calc':   out.push(sani(r.clCalc||'')); break;
          case 'cl':     out.push(fmt0(r.clPerBarMm)); break;
          case 'qty':    out.push(String(r.qty)); break;
          case 'extra':  out.push(fmt0(r.extraLen||0)); break;
          case 'totL':   out.push(fmt3(r.totalLenM)); break;
          case 'wtm':    out.push(fmt3(r.unitWtKgPerM)); break;
          case 'totW':   out.push(fmt3(r.totalWtKg)); break;
          case 'rem':    out.push(sani(r.remarks||'')); break;
        }
      });
      return out;
    };
    const SKETCH_W  = 60;   // images: fixed natural width (mm)
    const MIN_W     = 7;    // floor so headers/numbers never collapse (mm)
    const FLEX_MIN  = 20;   // smallest a free-text column may shrink to (mm)
    // Free-text columns share leftover/overflow width proportionally to their
    // content, so Remarks no longer swallows all the slack and balloon. Numeric
    // and fixed-size columns stay pinned to their content.
    const FLEX = new Set(['member','mark','rem']);

    pdf.setFontSize(fontSize);
    // Header measured by its longest word so multi-word titles can wrap across
    // the 2-line header row instead of forcing a wide column.
    const longestWord = t => t.split(/\s+/).reduce((m,w)=>Math.max(m, pdf.getTextWidth(w)), 0);
    cols.forEach(c => {
      if (c.key === 'sketch') { c.nat = SKETCH_W; return; }
      pdf.setFont('helvetica','bold');
      let natural = longestWord(c.title);
      pdf.setFont('helvetica','normal');
      for (const s of cellStrings(c.key)) {
        const w = pdf.getTextWidth(s);
        if (w > natural) natural = w;
      }
      c.nat = Math.max(MIN_W, natural + 2*pad);
    });

    // Columns with an explicit `pct` lock to that share of usableW. The rest:
    // pin fixed columns to content, then share the remaining width among the
    // auto-sized flex columns proportionally to their content.
    cols.forEach(c => { if (c.pct != null) c.w = usableW * c.pct / 100; });
    const pinned     = cols.filter(c => c.pct == null && !FLEX.has(c.key));
    const flexCols   = cols.filter(c => c.pct == null &&  FLEX.has(c.key));
    const lockedSum  = cols.filter(c => c.pct != null).reduce((a,c)=>a+c.w,0);
    const fixedSum   = pinned.reduce((a,c)=>a+c.nat,0);
    const flexNatSum = flexCols.reduce((a,c)=>a+c.nat,0) || 1;
    const avail      = usableW - lockedSum - fixedSum;
    pinned.forEach(c => { c.w = c.nat; });
    flexCols.forEach(c => { c.w = Math.max(FLEX_MIN, avail * (c.nat/flexNatSum)); });

    // Normalise to fill usableW exactly (corrects FLEX_MIN clamping / rounding).
    const wsum = cols.reduce((a,c)=>a+c.w,0);
    let xacc = margin;
    cols.forEach(c => { c.w = c.w * usableW / wsum; c.x = xacc; xacc += c.w; });
    const col = k => cols.find(c => c.key === k);

    pdf.setLineWidth(0.2);
    pdf.setDrawColor(0);

    // Place (possibly multi-line) text honouring a column's alignment
    const putText = (c, val, yTop) => {
      const arr = Array.isArray(val) ? val : [val];
      const tx = c.align === 'right'  ? c.x + c.w - pad
               : c.align === 'center' ? c.x + c.w / 2
               :                         c.x + pad;
      arr.forEach((ln, k) =>
        pdf.text(ln, tx, yTop + pad + k * lineH, { align: c.align, baseline: 'top' }));
    };

    let y = margin;

    // ── Project info header (first page only) ──
    function drawProjectHeader() {
      if (projectInfo.header) {
        pdf.setFont('helvetica','bold'); pdf.setFontSize(11);
        pdf.splitTextToSize(sani(projectInfo.header), usableW).forEach(ln => {
          pdf.text(ln, pageW/2, y+4, { align:'center' }); y += 5.5;
        });
        y += 1;
      }
      pdf.setFont('helvetica','bold'); pdf.setFontSize(13);
      pdf.text('BAR BENDING SCHEDULE (BBS)', pageW/2, y+5, { align:'center' });
      y += 9;

      const meta = [
        ['Name of Work',   projectInfo.project || '-'],
        ['Name of Agency', projectInfo.agency  || '-'],
        ['Reference',      projectInfo.ref     || '-'],
      ];
      pdf.setFontSize(9);
      const labelW = 40;
      meta.forEach(([k,v]) => {
        const vLines = pdf.splitTextToSize(sani(v), usableW - labelW - 2*pad);
        const rh = Math.max(lineH, vLines.length * lineH) + 2*pad;
        pdf.rect(margin, y, labelW, rh);
        pdf.rect(margin + labelW, y, usableW - labelW, rh);
        pdf.setFont('helvetica','bold');
        pdf.text(sani(k), margin + pad, y + pad, { baseline:'top' });
        pdf.setFont('helvetica','normal');
        vLines.forEach((ln,i) =>
          pdf.text(ln, margin + labelW + pad, y + pad + i*lineH, { baseline:'top' }));
        y += rh;
      });
      y += 3;
    }

    // ── Black table-header row (repeats on every page) ──
    function drawTableHead() {
      const hh = lineH * 2 + 2 * pad;
      pdf.setFont('helvetica','bold'); pdf.setFontSize(fontSize);
      cols.forEach(c => {
        // Re-assert colours per cell: jsPDF's text() leaves the active fill
        // colour set to the text colour, so a single setFillColor up front
        // would only apply to the first rect drawn before any text.
        pdf.setFillColor(0,0,0);
        pdf.rect(c.x, y, c.w, hh, 'F');
        pdf.setTextColor(255,255,255);
        const tl = pdf.splitTextToSize(c.title, c.w - 2*pad);
        const tx = c.align === 'right'  ? c.x + c.w - pad
                 : c.align === 'center' ? c.x + c.w / 2
                 :                         c.x + pad;
        const n = tl.length;
        const _ptMM = 0.352777778;
        if (n === 1) {
          pdf.text(tl[0], tx, y + hh/2 - fontSize*_ptMM*0.35, { align:c.align, baseline:'top' });
        } else {
          tl.forEach((ln,i) =>
            pdf.text(ln, tx, y + (hh - n*lineH)/2 + i*lineH, { align:c.align, baseline:'top' }));
        }
      });
      pdf.setTextColor(0,0,0);
      y += hh;
    }

    drawProjectHeader();
    drawTableHead();
    pdf.setFont('helvetica','normal'); pdf.setFontSize(fontSize);

    // ── Data rows ──
    let sumLen = 0, sumWt = 0;
    rows.forEach((r,i) => {
      sumLen += r.totalLenM; sumWt += r.totalWtKg;

      const t = {
        idx:    String(i+1),
        member: pdf.splitTextToSize(sani(r.member||''),     col('member').w - 2*pad),
        mark:   pdf.splitTextToSize(sani(r.mark||''),       col('mark').w   - 2*pad),
        dia:    String(r.dia),
        calc:   pdf.splitTextToSize(sani(r.clCalc||''),      col('calc').w   - 2*pad),
        cl:     fmt0(r.clPerBarMm),
        qty:    String(r.qty),
        extra:  fmt0(r.extraLen||0),
        totL:   fmt3(r.totalLenM),
        wtm:    fmt3(r.unitWtKgPerM),
        totW:   fmt3(r.totalWtKg),
        rem:    pdf.splitTextToSize(sani(r.remarks||''),    col('rem').w    - 2*pad),
      };

      // Sketch: fit inside the cell preserving aspect ratio.
      // Pick the vector model to draw — textured (opt-in, rebuilt from the
      // drawn geometry) or the stored clean vector. Both draw as native PDF
      // vectors (tiny + crisp); uploaded rasters fall back to an image.
      let model = null;
      if (pdfTextured && r.shapeHist && window.ShapeDrawer && ShapeDrawer.buildTexturedModel) {
        try { model = ShapeDrawer.buildTexturedModel(r.shapeHist); } catch {}
      }
      if (!model && r.shapeVec && r.shapeVec.vb) model = r.shapeVec;

      let sk = null;
      const fitBox = ar => {
        const boxW = col('sketch').w - 2*pad;
        let dw = boxW, dh = boxW / ar;
        if (dh > sketchMaxH) { dh = sketchMaxH; dw = sketchMaxH * ar; }
        return { w:dw, h:dh };
      };
      if (model && model.vb && model.vb[3] > 0) {
        sk = fitBox(model.vb[2] / model.vb[3]);
      } else if (r.shapeImg) {
        try {
          const p = pdf.getImageProperties(r.shapeImg);
          sk = fitBox(p.width / p.height);
        } catch { /* unreadable image → fall through to dash */ }
      }

      const maxLines = Math.max(t.member.length, t.calc.length, t.rem.length, 1);
      const rowH = Math.max(maxLines * lineH, sk ? sk.h : 0) + 2 * pad;

      if (y + rowH > pageH - margin) {
        pdf.addPage(); y = margin;
        drawTableHead();
        pdf.setFont('helvetica','normal'); pdf.setFontSize(fontSize);
      }

      cols.forEach(c => pdf.rect(c.x, y, c.w, rowH));

      putText(col('idx'),    t.idx,    y);
      putText(col('member'), t.member, y);
      putText(col('mark'),   t.mark,   y);
      putText(col('dia'),    t.dia,    y);
      if (sk) {
        const sx = col('sketch').x + (col('sketch').w - sk.w) / 2;
        const sy = y + (rowH - sk.h) / 2;
        if (model && window.ShapeVector) {
          try { ShapeVector.toPdf(pdf, model, sx, sy, sk.w, sk.h); } catch {}
          // restore table stroke + text state the vector draw clobbered
          pdf.setLineWidth(0.2); pdf.setDrawColor(0); pdf.setTextColor(0,0,0);
          if (pdf.setLineCap) pdf.setLineCap('butt');
          pdf.setFont('helvetica','normal'); pdf.setFontSize(fontSize);
        } else {
          try { pdf.addImage(r.shapeImg, 'PNG', sx, sy, sk.w, sk.h); } catch {}
        }
      } else {
        putText(col('sketch'), '—', y);
      }
      putText(col('calc'), t.calc, y);
      putText(col('cl'),    t.cl,    y);
      putText(col('qty'),   t.qty,   y);
      putText(col('extra'), t.extra, y);
      putText(col('totL'),  t.totL,  y);
      putText(col('wtm'),  t.wtm,  y);
      putText(col('totW'), t.totW, y);
      putText(col('rem'),  t.rem,  y);

      y += rowH;
    });

    // ── Totals row ──
    const totH = lineH + 2 * pad;
    if (y + totH > pageH - margin) { pdf.addPage(); y = margin; drawTableHead(); }
    pdf.setFont('helvetica','bold'); pdf.setFontSize(fontSize);
    pdf.setTextColor(0,0,0);
    const labelW = cols.slice(0,10).reduce((a,c)=>a+c.w,0);
    // Re-assert the white fill before every cell: text() in between resets the
    // active fill colour to the text colour (black), which would otherwise
    // paint the following cells solid black.
    const totCell = (x, w) => { pdf.setFillColor(255,255,255); pdf.rect(x, y, w, totH, 'FD'); };
    totCell(margin, labelW);
    pdf.text('Totals:', margin + labelW - pad, y + pad, { align:'right', baseline:'top' });
    totCell(col('totL').x, col('totL').w);
    pdf.text(fmt3(sumLen), col('totL').x + col('totL').w - pad, y + pad, { align:'right', baseline:'top' });
    totCell(col('wtm').x,  col('wtm').w);
    totCell(col('totW').x, col('totW').w);
    pdf.text(fmt3(sumWt), col('totW').x + col('totW').w - pad, y + pad, { align:'right', baseline:'top' });
    totCell(col('rem').x, col('rem').w);

    // ── Page-number footers ──
    const pageCount = pdf.internal.getNumberOfPages();
    pdf.setFont('helvetica','normal'); pdf.setFontSize(8); pdf.setTextColor(0,0,0);
    for (let p = 1; p <= pageCount; p++) {
      pdf.setPage(p);
      pdf.text(`Page ${p} of ${pageCount}`, pageW - margin, pageH - 4, { align:'right' });
    }

    const proj = (projectInfo.project || 'BBS').replace(/[^a-zA-Z0-9_-]/g,'_');
    // Cap the export name at 50 chars while preserving the .pdf extension
    let fileName = `${proj}_BBS.pdf`;
    if (fileName.length > 50) fileName = fileName.slice(0, 46) + '.pdf';
    pdf.save(fileName);
  } catch (err) {
    console.error('PDF export failed:', err);
    alert('PDF export failed. See console for details.');
  } finally {
    btn.disabled = false;
    btn.textContent = '📄 Export PDF';
  }
});

/* =========================
   Clear all
   ========================= */
$('#clearAll').addEventListener('click',()=>{
  if(confirm('Clear the entire schedule?')){ rows=[]; editIndex=-1; persist(); render(); }
});

/* =========================
   Drag & Drop reorder
   ========================= */
let draggedItem=null;
$('#tbody').addEventListener('dragstart',e=>{
  draggedItem=e.target.closest('tr');
  if(draggedItem){ e.dataTransfer.effectAllowed='move'; draggedItem.classList.add('dragging'); }
});
$('#tbody').addEventListener('dragenter',e=>{ e.preventDefault(); const t=e.target.closest('tr'); if(t&&t!==draggedItem) t.classList.add('drag-over'); });
$('#tbody').addEventListener('dragleave',e=>{ const t=e.target.closest('tr'); if(t) t.classList.remove('drag-over'); });
$('#tbody').addEventListener('dragover',e=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; });
$('#tbody').addEventListener('drop',e=>{
  e.preventDefault();
  const drop=e.target.closest('tr');
  if(draggedItem&&drop&&draggedItem!==drop){
    const oi=parseInt(draggedItem.dataset.index), di=parseInt(drop.dataset.index);
    let ni = oi<di ? di+1 : di;
    const [rm]=rows.splice(oi,1);
    if(oi<ni) ni--;
    rows.splice(ni,0,rm);
    persist(); render();
  }
});
$('#tbody').addEventListener('dragend',()=>{
  if(draggedItem) draggedItem.classList.remove('dragging');
  document.querySelectorAll('#tbody .drag-over').forEach(el=>el.classList.remove('drag-over'));
  draggedItem=null;
});

/* =========================
   Shape Image Upload
   ========================= */
let currentShapeImg=null;   // raster (uploaded, downscaled)
let currentShapeVec=null;   // vector model (drawn shapes) — preferred
let currentShapeHist=null;  // raw drawer geometry — for textured-vector export
function clearShapeUpload(){
  currentShapeImg=null;
  currentShapeVec=null;
  currentShapeHist=null;
  $('#shapeFile').value='';
  $('#shapePreview').style.display='none';
  $('#shapePreview').src='';
  $('#shapeClearBtn').style.display='none';
}
$('#shapeUploadBtn').addEventListener('click',()=>$('#shapeFile').click());
$('#shapeFile').addEventListener('change',()=>{
  const file=$('#shapeFile').files[0]; if(!file) return;
  if(!['image/jpeg','image/png','image/svg+xml'].includes(file.type)){
    alert('Only JPG, PNG, and SVG files are supported.');
    $('#shapeFile').value=''; return;
  }
  const reader=new FileReader();
  reader.onload=async ev=>{
    // Uploads can't be vectorized — downscale/compress raster to keep files small.
    const raw = ev.target.result;
    currentShapeImg = window.ShapeVector ? await ShapeVector.downscale(raw) : raw;
    currentShapeVec = null;
    $('#shapePreview').src=currentShapeImg;
    $('#shapePreview').style.display='block';
    $('#shapeClearBtn').style.display='inline-flex';
  };
  reader.readAsDataURL(file);
});
$('#shapeClearBtn').addEventListener('click',clearShapeUpload);

/* =========================
   Init
   ========================= */
saveSettings();
applyInfoToForm();
updatePrintMeta();
showShape($('#shape').value);
showQty($('#qtyMode').value);
resetCustom();
updateCustomPreview();
initPagination();
render();

/* =========================
   Light / Dark Theme Toggle
   ========================= */
(function(){
  const root = document.documentElement;
  const btn  = document.getElementById('themeToggle');
  const icon = document.getElementById('themeIcon');
  const lbl  = document.getElementById('themeLabel');

  // Restore saved preference — default is 'light' (Rust)
  const saved = localStorage.getItem('bbs_theme') || 'light';
  applyTheme(saved);

  btn.addEventListener('click', () => {
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    localStorage.setItem('bbs_theme', next);
  });

  function applyTheme(t) {
    root.dataset.theme = t;
    if (t === 'light') {
      icon.textContent = '🔩';
      lbl.textContent  = 'Rust';
    } else {
      icon.textContent = '⚙️';
      lbl.textContent  = 'Steel';
    }
  }
})();

/* =========================
   Pagination controls
   ========================= */
function initPagination() {
  if ($('#paginationControls')) return
  const el = document.createElement('span')
  el.id = 'paginationControls'
  el.style.display = 'none'
  el.innerHTML = `
    <button class="btn small ghost" id="prevPage" title="Previous page">◀</button>
    <span id="pageInfo" style="font-size:11px;color:var(--muted);white-space:nowrap;padding:0 4px">Page 1 of 1</span>
    <button class="btn small ghost" id="nextPage" title="Next page">▶</button>
    <select id="pageSizeSelect" style="width:auto;padding:3px 5px;font-size:11px;margin-left:2px">
      <option value="10">10</option>
      <option value="25" selected>25</option>
      <option value="50">50</option>
      <option value="0">All</option>
    </select>
  `
  const badge = $('#countBadge')
  if (badge && badge.parentNode) {
    badge.after(el)
  }
  $('#prevPage').addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; render() }
  })
  $('#nextPage').addEventListener('click', () => {
    if (currentPage < getPageCount()) { currentPage++; render() }
  })
  $('#pageSizeSelect').addEventListener('change', e => {
    pageSize = Number(e.target.value)
    currentPage = 1
    render()
  })
}

/* =========================
   Shape Drawer Integration
   ========================= */
document.getElementById('shapeDrawBtn').addEventListener('click', () => {
  window.ShapeDrawer.open(result => {
    if (!result) return;
    // Vector model preferred; baked diagrams fall back to a raster image.
    currentShapeVec = result.vec || null;
    currentShapeImg = result.img || null;
    currentShapeHist = result.hist || null;   // enables textured-vector export
    const src = currentShapeVec ? ShapeVector.toDataURL(currentShapeVec) : currentShapeImg;
    if (!src) return;
    const preview = document.getElementById('shapePreview');
    preview.src = src;
    preview.style.display = 'block';
    document.getElementById('shapeClearBtn').style.display = 'inline-flex';
  }, { history: currentShapeHist });   // reload the saved drawing for editing
});

/* =========================
   Keyboard shortcuts
   ========================= */
(function() {
  // Alt+I = Info, Alt+S = Settings, Alt+H = Help
  document.addEventListener('keydown', e => {
    if (e.altKey && e.key === 'i') { e.preventDefault(); document.getElementById('btnInfo').click(); }
    if (e.altKey && e.key === 's') { e.preventDefault(); document.getElementById('btnSettings').click(); }
    if (e.altKey && e.key === 'h') { e.preventDefault(); document.getElementById('btnHelp').click(); }
    // Esc = reset form (when focus inside form)
    if (e.key === 'Escape' && document.getElementById('barForm').contains(document.activeElement)) {
      document.getElementById('reset').click();
    }
  });

  // Enter on any text/number input inside the form → submit
  document.getElementById('barForm').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.target.tagName === 'INPUT') && e.target.type !== 'submit') {
      e.preventDefault();
      document.getElementById('barForm').requestSubmit();
    }
  });

  // Form feedback helper
  const fb = document.getElementById('formFeedback');
  function showFeedback(msg, type, ms=2800) {
    fb.textContent = msg;
    fb.className = 'form-feedback ' + type;
    clearTimeout(fb._t);
    fb._t = setTimeout(() => { fb.textContent = ''; fb.className = 'form-feedback'; }, ms);
  }
  window._showFeedback = showFeedback;
})();
