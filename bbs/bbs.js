/* =========================
   Utilities
   ========================= */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

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
function escapeHTML(str){
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
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
  hooks: { '90': 9, '135': 11, '180': 16 },
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

/* Formatting */
const fmt3 = n => (Math.round(n*1000)/1000).toFixed(3);
const fmt0 = n => Math.round(n).toString();

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
  stirrup: ({A,B,cover,angle,dia,type,diaCirc,side}) => {
    const ded  = settings.ded[angle]  || 0;
    const hook = settings.hooks[angle]|| 0;
    if(type==='2'){ const a=A-2*cover+dia, b=B-2*cover+dia; return 2*a+2*b-4*ded+2*hook; }
    if(type==='4'){ const a=A-2*cover+dia, b=B-2*cover+dia; return 2*a+4*b-6*ded+4*hook; }
    if(type==='6'){ const a=A-2*cover+dia, b=B-2*cover+dia; return 2*a+6*b-8*ded+6*hook; }
    if(type==='circle'){ const d=diaCirc-2*cover+dia; return Math.PI*d-ded+2*hook; }
    if(type==='diamond'){ const s=side-2*cover+dia; return 4*s-4*ded+2*hook; }
    return 0;
  },
  circle:  ({dia,cover,diaBar}) => Math.PI*(dia+2*cover-diaBar),
  spiral:  ({dia,cover,pitch,turns,diaBar}) => {
    const D = dia+2*cover-diaBar;
    return Math.sqrt((Math.PI*D)**2 + pitch**2) * turns;
  },
  crank:   ({span,depth,angle,dia}) => span + (depth/Math.sin(angle*Math.PI/180))*2 - 2*bendDeduction(angle,dia),
  chair:   ({height,top,base}) => 2*height + top + base,
  'hook-semi': ({len, ends, dia}) => len + (ends==='both'?2:1) * hookLength(180, dia),
  'hook-L':    ({len, ends, dia}) => len + (ends==='both'?2:1) * hookLength(90,  dia),
  custom:  ({items,dia}) => {
    let t=0;
    for(const it of items){
      if(it.type==='leg')  t += Number(it.len||0);
      if(it.type==='bend'){ t -= bendDeduction(it.angle,dia); if(it.hook) t += hookLength(it.angle,dia); }
    }
    return t;
  }
};

/* =========================
   State & Table
   ========================= */
let rows = JSON.parse(localStorage.getItem('bbs_rows')||'[]');
render();

function persist(){ localStorage.setItem('bbs_rows', JSON.stringify(rows)); }
function recalcSums(){
  let sumLen=0, sumWt=0;
  rows.forEach(r=>{ sumLen+=r.totalLenM; sumWt+=r.totalWtKg; });
  $('#sumLen').textContent = fmt3(sumLen);
  $('#sumWt').textContent  = fmt3(sumWt);
  $('#countBadge').textContent = `${rows.length} item${rows.length!==1?'s':''}`;
}
function render(){
  const tbody = $('#tbody'); tbody.innerHTML='';
  rows.forEach((r,i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${i+1}</td>
      <td>${r.member}</td>
      <td class="mono">${r.mark||''}</td>
      <td class="mono right">${r.dia}</td>
      <td>${r.shapeLabel}</td>
      <td style="text-align:center;padding:4px 6px">${r.shapeImg
        ? `<img src="${r.shapeImg}" alt="shape" style="max-width:120px;max-height:78px;width:100%;height:auto;object-fit:contain;display:block;margin:0 auto;border-radius:4px;background:var(--input-bg);padding:2px">`
        : '<span class="subtle">—</span>'}</td>
      <td class="mono right">${fmt0(r.clPerBarMm)}</td>
      <td class="mono right">${r.qty}</td>
      <td class="mono right">${fmt3(r.totalLenM)}</td>
      <td class="mono right">${fmt3(r.unitWtKgPerM)}</td>
      <td class="mono right">${fmt3(r.totalWtKg)}</td>
      <td>${r.remarks||''}</td>
      <td class="right">
        <button class="btn small ghost" data-edit="${i}" title="Edit">✏️</button>
        <button class="btn small ghost danger" data-del="${i}" title="Delete">🗑️</button>
      </td>`;
    tr.dataset.index = i;
    tr.setAttribute('draggable','true');
    tbody.appendChild(tr);
  });
  recalcSums();
}

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

/* Custom builder */
let customItems = [];
function resetCustom(){ customItems=[]; $('#customList').innerHTML=''; }
function addLeg(len=''){
  const idx = customItems.push({type:'leg',len})-1;
  const row = document.createElement('div');
  row.className='custom-item';
  row.innerHTML = `
    <span class="pill">Leg ${customItems.filter(x=>x.type==='leg').length}</span>
    <input type="number" min="1" step="1" value="${len}" placeholder="Length (mm)" data-kind="leg" data-idx="${idx}" style="flex:1;min-width:100px" />
    <button type="button" class="btn small ghost" data-remove="${idx}" style="width:auto">✕</button>
  `;
  $('#customList').appendChild(row);
}
function addBend(angle=90, hook=false){
  const idx = customItems.push({type:'bend',angle,hook})-1;
  const row = document.createElement('div');
  row.className='custom-item';
  row.innerHTML = `
    <span class="pill">Bend</span>
    <select data-kind="bend-angle" data-idx="${idx}" style="flex:1;min-width:80px">
      <option value="45" ${angle==45?'selected':''}>45°</option>
      <option value="90" ${angle==90?'selected':''}>90°</option>
      <option value="135" ${angle==135?'selected':''}>135°</option>
      <option value="180" ${angle==180?'selected':''}>180°</option>
    </select>
    <label style="display:flex;gap:4px;align-items:center;font-size:12px;white-space:nowrap">
      <input type="checkbox" data-kind="hook" data-idx="${idx}" ${hook?'checked':''} style="width:auto"> Hook
    </label>
    <button type="button" class="btn small ghost" data-remove="${idx}" style="width:auto">✕</button>
  `;
  $('#customList').appendChild(row);
}
$('#addLeg').addEventListener('click',()=>{ addLeg(); updateCustomPreview(); });
$('#addBend').addEventListener('click',()=>{ addBend(); updateCustomPreview(); });
$('#customList').addEventListener('change', e=>{
  const el = e.target, idx = Number(el.dataset.idx);
  if(el.dataset.kind==='leg')        customItems[idx].len   = el.value;
  if(el.dataset.kind==='bend-angle') customItems[idx].angle = Number(el.value);
  if(el.dataset.kind==='hook')       customItems[idx].hook  = el.checked;
  updateCustomPreview();
});
$('#customList').addEventListener('click', e=>{
  if(e.target.dataset.remove!==undefined){
    customItems[Number(e.target.dataset.remove)].type='deleted';
    e.target.closest('.field').remove();
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

  let cl=0, shapeLabel='';
  if(shape==='straight'){
    const len=Number($('#straightLen').value);
    cl=CL.straight({len}); shapeLabel='Straight';
  }else if(shape==='L'){
    const A=Number($('#L_A').value),B=Number($('#L_B').value),angle=Number($('#L_angle').value);
    cl=CL.L({A,B,angle,dia}); shapeLabel=`L (${angle}°)`;
  }else if(shape==='U'){
    const A=Number($('#U_A').value),B=Number($('#U_B').value),C=Number($('#U_C').value);
    cl=CL.U({A,B,C,dia}); shapeLabel='U';
  }else if(shape==='stirrup'){
    const type=$('#S_type').value, cover=Number($('#S_cover').value), angle=Number($('#S_angle').value);
    if(type==='2'||type==='4'||type==='6'){ cl=CL.stirrup({A:Number($('#S_A').value),B:Number($('#S_B').value),cover,angle,dia,type}); }
    else if(type==='circle'){ cl=CL.stirrup({diaCirc:Number($('#S_diaCirc').value),cover,angle,dia,type}); }
    else if(type==='diamond'){ cl=CL.stirrup({side:Number($('#S_side').value),cover,angle,dia,type}); }
    shapeLabel=`Stirrup ${type}-legged`;
  }else if(shape==='circle'){
    const diaVal=Number($('#C_dia').value), cover=Number($('#C_cover').value);
    cl=CL.circle({dia:diaVal,cover,diaBar:dia}); shapeLabel=`Circle ⌀${diaVal}`;
  }else if(shape==='spiral'){
    const diaVal=Number($('#SP_dia').value),pitch=Number($('#SP_pitch').value),turns=Number($('#SP_turns').value),cover=Number($('#SP_cover').value);
    cl=CL.spiral({dia:diaVal,pitch,turns,cover,diaBar:dia}); shapeLabel=`Spiral ⌀${diaVal} (${turns} turns)`;
  }else if(shape==='crank'){
    const span=Number($('#CR_span').value),depth=Number($('#CR_depth').value),angle=Number($('#CR_angle').value);
    cl=CL.crank({span,depth,angle,dia}); shapeLabel=`Crank ${angle}°`;
  }else if(shape==='chair'){
    const height=Number($('#CH_height').value),top=Number($('#CH_top').value),base=Number($('#CH_base').value);
    cl=CL.chair({height,top,base,dia}); shapeLabel=`Chair ${height}h`;
  }else if(shape==='hook-semi'){
    const len=Number($('#HS_len').value), ends=$('#HS_ends').value;
    cl=CL['hook-semi']({len,ends,dia});
    shapeLabel=`Straight 180° hook (${ends==='both'?'both ends':ends+' end'})`;
  }else if(shape==='hook-L'){
    const len=Number($('#HL_len').value), ends=$('#HL_ends').value;
    cl=CL['hook-L']({len,ends,dia});
    shapeLabel=`Straight 90° hook (${ends==='both'?'both ends':ends+' end'})`;
  }else if(shape==='custom'){
    const items=customItems.filter(x=>x.type!=='deleted');
    cl=CL.custom({items,dia}); shapeLabel='Custom';
  }

  if(!isFinite(cl)||cl<=0){ if(window._showFeedback) window._showFeedback('⚠ Check dimensions — CL must be > 0','err'); else alert('Please provide valid dimensions. Cutting length must be > 0.'); return; }

  const qty=computeQty(qtyMode,{qty:Number($('#qty').value),spacing:Number($('#spacing').value),span:Number($('#span').value),offsetStart:Number($('#offsetStart').value),offsetEnd:Number($('#offsetEnd').value)});
  if(qty<=0){ if(window._showFeedback) window._showFeedback('⚠ Quantity is zero — check spacing/span','err'); else alert('Quantity is zero. Check inputs or spacing.'); return; }

  const wtPerM=unitWeightKgPerM(dia), totalLenM=(cl/1000)*qty, totalWtKg=wtPerM*totalLenM;

  const row = {
    member,mark,shape,shapeLabel,dia,
    clPerBarMm:cl,qty,unitWtKgPerM:wtPerM,totalLenM,totalWtKg,
    remarks,grade,createdAt:Date.now(),
    shapeImg: currentShapeImg||null,
    inputs:{}
  };

  // Save raw inputs for edit
  if(shape==='straight'){ row.inputs={len:Number($('#straightLen').value)}; }
  else if(shape==='L'){ row.inputs={A:Number($('#L_A').value),B:Number($('#L_B').value),angle:Number($('#L_angle').value)}; }
  else if(shape==='U'){ row.inputs={A:Number($('#U_A').value),B:Number($('#U_B').value),C:Number($('#U_C').value)}; }
  else if(shape==='stirrup'){
    const type=$('#S_type').value, cover=Number($('#S_cover').value), angle=Number($('#S_angle').value);
    row.inputs={type,cover,angle};
    if(type==='2'||type==='4'||type==='6'){ row.inputs.A=Number($('#S_A').value); row.inputs.B=Number($('#S_B').value); }
    else if(type==='circle'){ row.inputs.diaCirc=Number($('#S_diaCirc').value); }
    else if(type==='diamond'){ row.inputs.side=Number($('#S_side').value); }
  }
  else if(shape==='circle'){ row.inputs={diaVal:Number($('#C_dia').value),cover:Number($('#C_cover').value)}; }
  else if(shape==='spiral'){ row.inputs={diaVal:Number($('#SP_dia').value),pitch:Number($('#SP_pitch').value),turns:Number($('#SP_turns').value),cover:Number($('#SP_cover').value)}; }
  else if(shape==='crank'){  row.inputs={span:Number($('#CR_span').value),depth:Number($('#CR_depth').value),angle:Number($('#CR_angle').value)}; }
  else if(shape==='chair'){     row.inputs={height:Number($('#CH_height').value),top:Number($('#CH_top').value),base:Number($('#CH_base').value)}; }
  else if(shape==='hook-semi'){ row.inputs={len:Number($('#HS_len').value),ends:$('#HS_ends').value}; }
  else if(shape==='hook-L'){    row.inputs={len:Number($('#HL_len').value),ends:$('#HL_ends').value}; }
  else if(shape==='custom'){    row.inputs={items:customItems.filter(x=>x.type!=='deleted')}; }

  rows.push(row); persist(); render();
  if(window._showFeedback) window._showFeedback(`✔ Added ${shapeLabel} · ${fmt0(cl)} mm · ${fmt3(totalWtKg)} kg`,'ok');
  $('#barForm').reset();
  clearShapeUpload();
  showShape('straight'); showQty('manual'); resetCustom(); updateCustomPreview();
});

/* =========================
   Edit & Delete
   ========================= */
$('#bbsTable').addEventListener('click', e=>{
  const del=e.target.dataset.del, edit=e.target.dataset.edit;
  if(del!==undefined){ rows.splice(Number(del),1); persist(); render(); }
  else if(edit!==undefined){
    const i=Number(edit), r=rows[i]; if(!r) return;
    const inp=r.inputs||{};
    $('#member').value = r.member;
    $('#mark').value   = r.mark||'';
    $('#shape').value  = r.shape;
    showShape(r.shape);
    $('#dia').value    = r.dia;
    $('#remarks').value= r.remarks||'';
    $('#grade').value  = r.grade||'Fe 415';
    $('#qtyMode').value= 'manual';
    showQty('manual');
    $('#qty').value    = r.qty;

    // Restore shape image
    if(r.shapeImg){ currentShapeImg=r.shapeImg; $('#shapePreview').src=r.shapeImg; $('#shapePreview').style.display='block'; $('#shapeClearBtn').style.display='inline-flex'; }
    else { clearShapeUpload(); }

    if(r.shape==='straight'){ $('#straightLen').value=inp.len||''; }
    if(r.shape==='L'){ $('#L_A').value=inp.A||''; $('#L_B').value=inp.B||''; $('#L_angle').value=inp.angle||90; }
    if(r.shape==='U'){ $('#U_A').value=inp.A||''; $('#U_B').value=inp.B||''; $('#U_C').value=inp.C||''; }
    if(r.shape==='stirrup'){
      $('#S_type').value=$('#S_type').value; $('#S_cover').value=inp.cover||25; $('#S_angle').value=inp.angle||135;
      $('#S_type').dispatchEvent(new Event('change'));
      if(inp.type==='2'||inp.type==='4'||inp.type==='6'){ $('#S_A').value=inp.A||''; $('#S_B').value=inp.B||''; }
      else if(inp.type==='circle'){ $('#S_diaCirc').value=inp.diaCirc||''; }
      else if(inp.type==='diamond'){ $('#S_side').value=inp.side||''; }
    }
    if(r.shape==='circle'){  $('#C_dia').value=inp.diaVal||''; $('#C_cover').value=inp.cover||25; }
    if(r.shape==='spiral'){  $('#SP_dia').value=inp.diaVal||''; $('#SP_pitch').value=inp.pitch||''; $('#SP_turns').value=inp.turns||''; $('#SP_cover').value=inp.cover||25; }
    if(r.shape==='crank'){   $('#CR_span').value=inp.span||''; $('#CR_depth').value=inp.depth||''; $('#CR_angle').value=inp.angle||45; }
    if(r.shape==='chair'){     $('#CH_height').value=inp.height||''; $('#CH_top').value=inp.top||''; $('#CH_base').value=inp.base||''; }
    if(r.shape==='hook-semi'){ $('#HS_len').value=inp.len||''; $('#HS_ends').value=inp.ends||'both'; }
    if(r.shape==='hook-L'){    $('#HL_len').value=inp.len||''; $('#HL_ends').value=inp.ends||'both'; }
    if(r.shape==='custom'){
      resetCustom();
      for(const it of (inp.items||[])){ if(it.type==='leg') addLeg(it.len); else if(it.type==='bend') addBend(it.angle,it.hook); }
      updateCustomPreview();
    }
    rows.splice(i,1); persist(); render();
  }
});

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
   CSV Export  (includes project info header)
   ========================= */
// helper to escape CSV values, quoting if necessary and preserving line breaks
function csvEscape(val){
  let s = String(val);
  // double any existing quotes
  if(s.indexOf('"') !== -1) s = s.replace(/"/g,'""');
  // if contains comma, quote, or newline, wrap in quotes
  if(/[,\n"]/.test(s)){
    return `"${s}"`;
  }
  return s;
}

function infoLine(label,value){
  // use plain hyphen when no value to avoid non-ASCII characters in CSV
  const v = value ? String(value) : '-';
  return `${csvEscape(label)},${csvEscape(v)}`;
}

function toCSV(){
  const lines = [];
  // Project info block
  if (projectInfo.header) lines.push(csvEscape(projectInfo.header));
  lines.push('BAR BENDING SCHEDULE (BBS)');
  lines.push(infoLine('Name of Work',   projectInfo.project));
  lines.push(infoLine('Name of Agency', projectInfo.agency));
  lines.push(infoLine('Reference',      projectInfo.ref));
  lines.push(''); // blank separator

  // Table headers
  lines.push(['#','Member','Mark','Dia (mm)','Shape','CL / Bar (mm)','Qty','Total L (m)','Wt / m (kg)','Total Wt (kg)','Remarks'].join(','));
  rows.forEach((r,i)=>{
    lines.push([
      i+1, `"${r.member}"`, r.mark||'', r.dia, r.shapeLabel, fmt0(r.clPerBarMm),
      r.qty, fmt3(r.totalLenM), fmt3(r.unitWtKgPerM), fmt3(r.totalWtKg), `"${(r.remarks||'').replace(/"/g,"'")}"`
    ].join(','));
  });
  lines.push(['Totals','','','','','','',
    fmt3(rows.reduce((a,b)=>a+b.totalLenM,0)),'',
    fmt3(rows.reduce((a,b)=>a+b.totalWtKg,0)),''
  ].join(','));
  return lines.join('\n');
}
$('#exportCSV').addEventListener('click',()=>{
  const blob = new Blob([toCSV()],{type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bbs_${(projectInfo.project||'schedule').replace(/[^a-z0-9]/gi,'_').toLowerCase()}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
});

/* =========================
   Save / Load JSON  (includes project info)
   ========================= */
$('#saveJSON').addEventListener('click',()=>{
  const now = new Date();
  const ts  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}`;
  const blob = new Blob([JSON.stringify({rows,settings,projectInfo},null,2)],{type:'application/json'});
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
        if(Array.isArray(data.rows))   rows = data.rows;
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
    const sani = s => String(s == null ? '' : s).replace(/⌀/g, 'Ø');

    const pad   = 1.6;     // cell padding (mm)
    const lineH = 3.6;     // text line height (mm)
    const fontSize     = 8;
    const sketchMaxH   = 16;   // max sketch height per row (mm)

    // ── Column layout — proportional weights, normalised to fill usableW ──
    const cols = [
      { key:'idx',    title:'#',             w:8,  align:'right'  },
      { key:'member', title:'Member',        w:33, align:'left'   },
      { key:'mark',   title:'Mark',          w:15, align:'left'   },
      { key:'dia',    title:'Dia',           w:11, align:'right'  },
      { key:'shape',  title:'Shape',         w:33, align:'left'   },
      { key:'sketch', title:'Sketch',        w:34, align:'center' },
      { key:'cl',     title:'CL/Bar (mm)',   w:21, align:'right'  },
      { key:'qty',    title:'Qty',           w:11, align:'right'  },
      { key:'totL',   title:'Total L (m)',   w:22, align:'right'  },
      { key:'wtm',    title:'Wt/m (kg)',     w:20, align:'right'  },
      { key:'totW',   title:'Total Wt (kg)', w:23, align:'right'  },
      { key:'rem',    title:'Remarks',       w:46, align:'left'   },
    ];
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
        ['Date',           new Date().toLocaleDateString()],
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
      pdf.setFillColor(0,0,0);
      pdf.setTextColor(255,255,255);
      pdf.setFont('helvetica','bold'); pdf.setFontSize(fontSize);
      cols.forEach(c => {
        pdf.rect(c.x, y, c.w, hh, 'F');
        const tl = pdf.splitTextToSize(c.title, c.w - 2*pad);
        const tx = c.align === 'right'  ? c.x + c.w - pad
                 : c.align === 'center' ? c.x + c.w / 2
                 :                         c.x + pad;
        tl.forEach((ln,i) =>
          pdf.text(ln, tx, y + pad + i*lineH, { align:c.align, baseline:'top' }));
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
        shape:  pdf.splitTextToSize(sani(r.shapeLabel||''), col('shape').w  - 2*pad),
        cl:     fmt0(r.clPerBarMm),
        qty:    String(r.qty),
        totL:   fmt3(r.totalLenM),
        wtm:    fmt3(r.unitWtKgPerM),
        totW:   fmt3(r.totalWtKg),
        rem:    pdf.splitTextToSize(sani(r.remarks||''),    col('rem').w    - 2*pad),
      };

      // Sketch: fit inside the cell preserving aspect ratio
      let sk = null;
      if (r.shapeImg) {
        try {
          const p  = pdf.getImageProperties(r.shapeImg);
          const ar = p.width / p.height;
          const boxW = col('sketch').w - 2*pad;
          let dw = boxW, dh = boxW / ar;
          if (dh > sketchMaxH) { dh = sketchMaxH; dw = sketchMaxH * ar; }
          sk = { w:dw, h:dh };
        } catch { /* unreadable image → fall through to dash */ }
      }

      const maxLines = Math.max(t.member.length, t.shape.length, t.rem.length, 1);
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
      putText(col('shape'),  t.shape,  y);
      if (sk) {
        const sx = col('sketch').x + (col('sketch').w - sk.w) / 2;
        const sy = y + (rowH - sk.h) / 2;
        try { pdf.addImage(r.shapeImg, 'PNG', sx, sy, sk.w, sk.h); } catch {}
      } else {
        putText(col('sketch'), '—', y);
      }
      putText(col('cl'),   t.cl,   y);
      putText(col('qty'),  t.qty,  y);
      putText(col('totL'), t.totL, y);
      putText(col('wtm'),  t.wtm,  y);
      putText(col('totW'), t.totW, y);
      putText(col('rem'),  t.rem,  y);

      y += rowH;
    });

    // ── Totals row ──
    const totH = lineH + 2 * pad;
    if (y + totH > pageH - margin) { pdf.addPage(); y = margin; drawTableHead(); }
    pdf.setFont('helvetica','bold'); pdf.setFontSize(fontSize);
    pdf.setFillColor(230,230,230);
    const labelW = cols.slice(0,8).reduce((a,c)=>a+c.w,0);
    pdf.rect(margin, y, labelW, totH, 'FD');
    pdf.text('Totals:', margin + labelW - pad, y + pad, { align:'right', baseline:'top' });
    pdf.rect(col('totL').x, y, col('totL').w, totH, 'FD');
    pdf.text(fmt3(sumLen), col('totL').x + col('totL').w - pad, y + pad, { align:'right', baseline:'top' });
    pdf.rect(col('wtm').x,  y, col('wtm').w,  totH, 'FD');
    pdf.rect(col('totW').x, y, col('totW').w, totH, 'FD');
    pdf.text(fmt3(sumWt), col('totW').x + col('totW').w - pad, y + pad, { align:'right', baseline:'top' });
    pdf.rect(col('rem').x, y, col('rem').w, totH, 'FD');

    // ── Page-number footers ──
    const pageCount = pdf.internal.getNumberOfPages();
    pdf.setFont('helvetica','normal'); pdf.setFontSize(8); pdf.setTextColor(90,90,90);
    for (let p = 1; p <= pageCount; p++) {
      pdf.setPage(p);
      pdf.text(`Page ${p} of ${pageCount}`, pageW - margin, pageH - 4, { align:'right' });
    }
    pdf.setTextColor(0,0,0);

    const proj = (projectInfo.project || 'BBS').replace(/[^a-zA-Z0-9_-]/g,'_');
    pdf.save(`${proj}_BBS.pdf`);
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
  if(confirm('Clear the entire schedule?')){ rows=[]; persist(); render(); }
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
let currentShapeImg=null;
function clearShapeUpload(){
  currentShapeImg=null;
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
  reader.onload=ev=>{
    currentShapeImg=ev.target.result;
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
   Shape Drawer Integration
   ========================= */
document.getElementById('shapeDrawBtn').addEventListener('click', () => {
  window.ShapeDrawer.open(dataUrl => {
    if (!dataUrl) return;
    currentShapeImg = dataUrl;
    const preview = document.getElementById('shapePreview');
    preview.src = dataUrl;
    preview.style.display = 'block';
    document.getElementById('shapeClearBtn').style.display = 'inline-flex';
  });
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
