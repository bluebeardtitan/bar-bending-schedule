/* =====================================================================
   Concrete Casting & Formwork Schedule (CFS)
   Mirrors the BBS tool's structure & reporting format, with concrete-
   volume / shuttering-area maths. Shares the project-info and theme
   with the BBS page; keeps its own rows & settings in localStorage.
   ===================================================================== */
const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

/* =========================
   Formatting
   ========================= */
const fmt3 = n => (Math.round(n*1000)/1000).toFixed(3);
const fmt4 = n => (Math.round(n*10000)/10000).toFixed(4);
const fmt0 = n => Math.round(n).toString();
const fmtL = n => String(+(+n).toFixed(3));            // trim trailing zeros for lengths
const fmtDim = n => String(Math.round(Number(n)||0)); // whole mm
const TIMES = '×';
const money = n => Number(n).toLocaleString(undefined,{maximumFractionDigits:2});

/* =========================
   Project Info  (shared with BBS via the same storage key)
   ========================= */
const INFO_DEFAULTS = { header:'', project:'', agency:'', ref:'' };
let projectInfo = loadInfo();
function loadInfo(){
  const s = localStorage.getItem('bbs_info');
  return Object.assign({}, INFO_DEFAULTS, s ? JSON.parse(s) : {});
}
function saveInfoToStorage(){ localStorage.setItem('bbs_info', JSON.stringify(projectInfo)); }
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
function escapeHTML(str){ return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function updatePrintMeta(){
  const render = txt => escapeHTML(txt || '—').replace(/\r?\n/g,'<br>');
  $('#pmProject').innerHTML = render(projectInfo.project);
  $('#pmAgency').innerHTML  = render(projectInfo.agency);
  $('#pmRef').innerHTML     = render(projectInfo.ref);
  const titleEl = $('#pmHeaderTitle');
  if (projectInfo.header) {
    titleEl.innerHTML = escapeHTML(projectInfo.header).replace(/\r?\n/g,'<br>');
    titleEl.style.display = 'block';
  } else { titleEl.textContent = ''; titleEl.style.display = 'none'; }
}
$('#btnInfo').addEventListener('click', () => {
  $('#infoPanel').classList.toggle('collapsed');
  $('#settingsPanel').classList.add('collapsed');
});
$('#saveInfo').addEventListener('click', () => {
  readInfoFromForm(); saveInfoToStorage(); updatePrintMeta(); alert('Project info saved (shared with BBS).');
});
$('#clearInfo').addEventListener('click', () => {
  projectInfo = Object.assign({}, INFO_DEFAULTS);
  applyInfoToForm(); saveInfoToStorage(); updatePrintMeta();
});

/* =========================
   Settings
   ========================= */
const DEFAULTS = { defaultGrade:'M25', concWastage:3, fwWastage:5, concRate:0, fwRate:0 };
let settings = loadSettings();
function loadSettings(){
  const s = localStorage.getItem('cfs_settings');
  return Object.assign({}, DEFAULTS, s ? JSON.parse(s) : {});
}
function applySettingsToForm(){
  $('#defaultGrade').value = settings.defaultGrade;
  $('#concWastage').value  = settings.concWastage;
  $('#fwWastage').value    = settings.fwWastage;
  $('#concRate').value     = settings.concRate;
  $('#fwRate').value       = settings.fwRate;
}
function saveSettings(){
  localStorage.setItem('cfs_settings', JSON.stringify(settings));
  applySettingsToForm();
}
function resetSettings(){ settings = Object.assign({}, DEFAULTS); saveSettings(); renderSummary(); }
$('#saveSettings').addEventListener('click', () => {
  settings.defaultGrade = $('#defaultGrade').value;
  settings.concWastage  = Number($('#concWastage').value)||0;
  settings.fwWastage    = Number($('#fwWastage').value)||0;
  settings.concRate     = Number($('#concRate').value)||0;
  settings.fwRate       = Number($('#fwRate').value)||0;
  saveSettings(); renderSummary(); alert('Settings saved.');
});
$('#resetSettings').addEventListener('click', () => { resetSettings(); alert('Settings reset to defaults.'); });
$('#btnSettings').addEventListener('click', () => {
  const isOpen = !$('#settingsPanel').classList.contains('collapsed');
  $('#infoPanel').classList.add('collapsed');
  $('#settingsPanel').classList.toggle('collapsed', isOpen);
});
$('#btnHelp').addEventListener('click', () => document.getElementById('helpDlg').showModal());

/* =========================
   Section geometry engine
   Returns { areaMm2, dimsLabel, sectionLabel, fwModes:[{id,label,Ps}] }
   Ps = shutter perimeter per metre run, in mm.
   ========================= */
function sectionGeom(section, d){
  const m = v => Number(v)||0;
  if (section === 'rect') {
    const B = m(d.B), D = m(d.D);
    return {
      areaMm2: B*D,
      dimsLabel: `${fmtDim(B)} ${TIMES} ${fmtDim(D)} mm`,
      sectionLabel: 'Rectangular',
      fwModes: [
        { id:'col',   label:'Column · all 4 faces',    Ps: 2*(B+D) },
        { id:'beam',  label:'Beam · 2 sides + soffit', Ps: 2*D + B },
        { id:'sides', label:'2 sides only',            Ps: 2*D },
        { id:'one',   label:'Single face / soffit (B)',Ps: B },
        { id:'none',  label:'No formwork',             Ps: 0 },
      ],
    };
  }
  if (section === 'circle') {
    const dia = m(d.dia);
    return {
      areaMm2: Math.PI/4 * dia*dia,
      dimsLabel: `⌀ ${fmtDim(dia)} mm`,
      sectionLabel: `Circular ⌀${fmtDim(dia)}`,
      fwModes: [
        { id:'full', label:'Full perimeter (π⌀)', Ps: Math.PI*dia },
        { id:'none', label:'No formwork',         Ps: 0 },
      ],
    };
  }
  if (section === 'tbeam') {
    const bf = m(d.bf), hf = m(d.hf), bw = m(d.bw), D = m(d.D);
    const web = Math.max(0, D - hf);
    return {
      areaMm2: bf*hf + bw*web,
      dimsLabel: `bf${fmtDim(bf)} · hf${fmtDim(hf)} · bw${fmtDim(bw)} · D${fmtDim(D)}`,
      sectionLabel: 'T-Beam',
      fwModes: [
        { id:'beam', label:'Beam · 2 web sides + soffit', Ps: 2*web + bw },
        { id:'full', label:'Full outer perimeter',        Ps: 2*(bf + D) },
        { id:'none', label:'No formwork',                 Ps: 0 },
      ],
    };
  }
  if (section === 'trapezoid') {
    const a = m(d.a), b = m(d.b), h = m(d.h);
    const slant = Math.hypot((a-b)/2, h);
    return {
      areaMm2: (a+b)/2 * h,
      dimsLabel: `a${fmtDim(a)} · b${fmtDim(b)} · h${fmtDim(h)}`,
      sectionLabel: 'Trapezoidal',
      fwModes: [
        { id:'sides', label:'2 slopes + bottom', Ps: 2*slant + b },
        { id:'full',  label:'Full perimeter',    Ps: a + b + 2*slant },
        { id:'none',  label:'No formwork',       Ps: 0 },
      ],
    };
  }
  // custom: area in m², perimeter in m
  const area = m(d.area), perim = m(d.perim);
  const areaPart = d.areaCalc ? `(${d.areaCalc})` : fmtL(area)
  const perimPart = d.perimCalc ? `(${d.perimCalc})` : fmtL(perim)
  return {
    areaMm2: area * 1e6,
    dimsLabel: `A ${areaPart} m² · P ${perimPart} m`,
    sectionLabel: (d.name || 'Custom'),
    fwModes: [
      { id:'full', label:'Entered perimeter', Ps: perim * 1000 },
      { id:'none', label:'No formwork',       Ps: 0 },
    ],
  };
}

/* Default section + formwork mode per element type */
const ELEMENT_DEFAULTS = {
  'Column':      { section:'rect', fw:'col'  },
  'Beam':        { section:'rect', fw:'beam' },
  'Plinth Beam': { section:'rect', fw:'beam' },
  'Lintel':      { section:'rect', fw:'beam' },
  'Footing':     { section:'rect', fw:'col'  },
  'Pedestal':    { section:'rect', fw:'col'  },
  'Slab':        { section:'rect', fw:'one'  },
  'Raft':        { section:'rect', fw:'one'  },
  'Wall':        { section:'rect', fw:'sides'},
};

/* =========================
   Form: section switching + formwork mode list
   ========================= */
function showShape(name){
  $$('.shape').forEach(el => el.classList.add('hidden'));
  $(`.shape-${name}`).classList.remove('hidden');
}
function readDims(){
  const section = $('#section').value;
  if (section === 'rect')      return { B:$('#R_B').value, D:$('#R_D').value };
  if (section === 'circle')    return { dia:$('#C_dia').value };
  if (section === 'tbeam')     return { bf:$('#T_bf').value, hf:$('#T_hf').value, bw:$('#T_bw').value, D:$('#T_D').value };
  if (section === 'trapezoid') return { a:$('#Z_a').value, b:$('#Z_b').value, h:$('#Z_h').value };
  return { area:$('#X_area').value, perim:$('#X_perim').value, name:$('#X_name').value.trim(), areaCalc:$('#X_areaCalc').value.trim(), perimCalc:$('#X_perimCalc').value.trim() };
}
function updateFwModes(preferId){
  const geom = sectionGeom($('#section').value, readDims());
  const sel  = $('#fwMode');
  const keep = preferId || sel.value;
  sel.innerHTML = geom.fwModes
    .map(o => `<option value="${o.id}">${o.label}</option>`).join('');
  if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
}
$('#section').addEventListener('change', e => { showShape(e.target.value); updateFwModes(); updatePreview(); });
$('#element').addEventListener('change', e => {
  const def = ELEMENT_DEFAULTS[e.target.value];
  if (def) {
    $('#section').value = def.section;
    showShape(def.section);
    updateFwModes(def.fw);
  }
  updatePreview();
});

/* =========================
   Compute one entry from the live form (used by preview + submit)
   ========================= */
function computeEntry(){
  const section = $('#section').value;
  const dims    = readDims();
  const geom    = sectionGeom(section, dims);
  const areaM2  = geom.areaMm2 / 1e6;
  const L       = Number($('#length').value) || 0;
  const nos     = Math.max(0, Math.floor(Number($('#nos').value) || 0));
  const modeId  = $('#fwMode').value;
  const mode    = geom.fwModes.find(o => o.id === modeId) || geom.fwModes[0];
  const psM     = (mode ? mode.Ps : 0) / 1000;
  const ends    = $('#fwEnds').checked;
  const endArea = ends ? 2 * areaM2 : 0;

  const volM3 = areaM2 * L * nos;
  const fwM2  = (psM * L + endArea) * nos;

  const volCalc = dims.areaCalc
    ? `(${dims.areaCalc}) ${TIMES} ${fmtL(L)} ${TIMES} ${nos} = ${fmt3(volM3)}`
    : `${fmt4(areaM2)} ${TIMES} ${fmtL(L)} ${TIMES} ${nos} = ${fmt3(volM3)}`
  const fwCalc  = dims.perimCalc
    ? `(${dims.perimCalc}) ${TIMES} ${fmtL(L)}${endArea ? ` + ${fmt3(endArea)}` : ''} ${TIMES} ${nos} = ${fmt3(fwM2)}`
    : `${fmt3(psM)} ${TIMES} ${fmtL(L)}${endArea ? ` + ${fmt3(endArea)}` : ''} ${TIMES} ${nos} = ${fmt3(fwM2)}`

  return {
    section, dims, geom, areaM2, lengthM:L, nos,
    fwModeId: mode ? mode.id : 'none', fwModeLabel: mode ? mode.label : '—',
    psM, ends, volM3, fwM2, volCalc, fwCalc,
    dimsLabel: geom.dimsLabel, sectionLabel: geom.sectionLabel,
  };
}
function updatePreview(){
  const e = computeEntry();
  $('#areaPreview').textContent = fmt4(e.areaM2);
  $('#volPreview').textContent  = fmt3(e.volM3);
  $('#fwPreview').textContent   = fmt3(e.fwM2);
}
['#R_B','#R_D','#C_dia','#T_bf','#T_hf','#T_bw','#T_D','#Z_a','#Z_b','#Z_h','#X_area','#X_perim','#X_areaCalc','#X_perimCalc']
  .forEach(id => $(id).addEventListener('input', () => { updateFwModes(); updatePreview(); }));
['#length','#nos','#fwMode','#fwEnds'].forEach(id => $(id).addEventListener('input', updatePreview));

/* =========================
   State & Table
   ========================= */
let rows = JSON.parse(localStorage.getItem('cfs_rows') || '[]');
let editIndex = -1;
let currentPage = (parseInt(localStorage.getItem('cfs_page')) || 1)
let navPersistTimer = null
let lastEditedIndex = -1
const DEFAULT_PAGE_SIZE = 25
let pageSize = DEFAULT_PAGE_SIZE
function persist(){ localStorage.setItem('cfs_rows', JSON.stringify(rows)); }

function shapeSrc(r){
  if (r && r.shapeVec && window.ShapeVector) return ShapeVector.toDataURL(r.shapeVec);
  return (r && r.shapeImg) || '';
}
function recalcSums(){
  const totVol = rows.reduce((a,r)=>a+r.volM3,0);
  const totFw  = rows.reduce((a,r)=>a+r.fwM2,0);
  $('#sumVol').textContent = fmt3(totVol);
  $('#sumFw').textContent  = fmt3(totFw);
  $('#countBadge').textContent = `${rows.length} item${rows.length!==1?'s':''}`;
}
function getPageCount() {
  if (!pageSize || pageSize <= 0) return 1
  return Math.max(1, Math.ceil(rows.length / pageSize))
}
function getPageRows() {
  if (!pageSize || pageSize <= 0) return rows
  const start = (currentPage - 1) * pageSize
  return rows.slice(start, start + pageSize)
}
function clampPage() {
  if (!pageSize || pageSize <= 0) { currentPage = 1; return }
  const max = getPageCount()
  if (currentPage > max) currentPage = max
  if (currentPage < 1) currentPage = 1
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
function gradeSummary(){
  const map = {};
  rows.forEach(r => { map[r.grade] = (map[r.grade]||0) + r.volM3; });
  return map;
}
function renderSummary(){
  const bar = $('#summaryBar');
  if (!rows.length) { bar.innerHTML = ''; return; }
  const totVol = rows.reduce((a,r)=>a+r.volM3,0);
  const totFw  = rows.reduce((a,r)=>a+r.fwM2,0);
  const gVol = totVol * (1 + settings.concWastage/100);
  const gFw  = totFw  * (1 + settings.fwWastage/100);
  const grades = gradeSummary();
  const chip = (label, val) => `<span class="sum-chip">${label} <b>${val}</b></span>`;
  let html = '';
  html += chip('Net concrete', `${fmt3(totVol)} m³`);
  html += chip('Net formwork', `${fmt3(totFw)} m²`);
  Object.keys(grades).sort().forEach(g => {
    html += `<span class="sum-chip grade"><span class="g-tag">${escapeHTML(g)}</span> <b>${fmt3(grades[g])}</b> m³</span>`;
  });
  html += '<span class="sum-sep"></span>';
  html += `<span class="sum-chip gross">Concrete +${settings.concWastage}% <b>${fmt3(gVol)}</b> m³</span>`;
  html += `<span class="sum-chip gross">Formwork +${settings.fwWastage}% <b>${fmt3(gFw)}</b> m²</span>`;
  if (settings.concRate > 0) html += chip('Concrete cost', money(gVol*settings.concRate));
  if (settings.fwRate  > 0)  html += chip('Formwork cost', money(gFw*settings.fwRate));
  bar.innerHTML = html;
}
function render(){
  const tbody = $('#tbody'); tbody.innerHTML = '';
  clampPage()
  const pageRows = getPageRows()
  const offset = pageSize > 0 ? (currentPage - 1) * pageSize : 0
  pageRows.forEach((r,i) => {
    const idx = offset + i
    const src = shapeSrc(r);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${idx+1}</td>
      <td>${escapeHTML(r.member)}</td>
      <td>${escapeHTML(r.element||'')}</td>
      <td>${escapeHTML(r.sectionLabel)}</td>
      <td style="text-align:center;padding:4px 6px">${src
        ? `<img src="${src}" alt="section" class="sketch-thumb" data-enlarge="${idx}" title="Click to enlarge" style="max-width:120px;max-height:78px;width:100%;height:auto;object-fit:contain;display:block;margin:0 auto;border-radius:4px;background:var(--input-bg);padding:2px;cursor:zoom-in">`
        : '<span class="subtle">—</span>'}</td>
      <td class="mono" style="font-size:11px">${escapeHTML(r.dimsLabel)}</td>
      <td class="mono right">${fmtL(r.lengthM)}</td>
      <td class="mono right">${r.nos}</td>
      <td class="mono">${escapeHTML(r.grade)}</td>
      <td class="mono" style="font-size:11px;line-height:1.4;min-width:130px">${escapeHTML(r.volCalc)}</td>
      <td class="mono right">${fmt3(r.volM3)}</td>
      <td class="mono" style="font-size:11px;line-height:1.4;min-width:130px">${escapeHTML(r.fwCalc)}</td>
      <td class="mono right">${fmt3(r.fwM2)}</td>
      <td>${escapeHTML(r.remarks||'')}</td>
      <td class="right" style="position:relative">
        <button class="btn small ghost options-btn" data-idx="${idx}" title="Options">⋮</button>
        <div class="options-menu" data-idx="${idx}">
          <button class="options-item" data-edit="${idx}">✏️ Edit</button>
          <button class="options-item danger" data-del="${idx}">🗑️ Delete</button>
        </div>
      </td>`;
    tr.dataset.index = idx;
    tr.setAttribute('draggable','true');
    tbody.appendChild(tr);
  });
  recalcSums();
  renderSummary();
  renderPagination()
  updateRecordNav()
  localStorage.setItem('cfs_page', String(currentPage))
}

/* =========================
   Sketch lightbox
   ========================= */
function openSketchLightbox(r){
  $('#sketchDlgImg').src = shapeSrc(r);
  const label = [r.member, r.mark, r.sectionLabel].filter(Boolean).join(' · ');
  $('#sketchDlgTitle').textContent = label || 'Section Sketch';
  const dlg = $('#sketchDlg');
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open','');
}
$('#sketchDlgClose').addEventListener('click', () => $('#sketchDlg').close());
$('#sketchDlg').addEventListener('click', e => { if (e.target.id === 'sketchDlg') $('#sketchDlg').close(); });

/* =========================
   Form Submit
   ========================= */
$('#memberForm').addEventListener('submit', e => {
  e.preventDefault();
  const member = $('#member').value.trim();
  if (!member) { feedback('⚠ Enter a member name', 'err'); $('#member').focus(); return; }

  const ent = computeEntry();
  if (!(ent.areaM2 > 0)) { feedback('⚠ Check section dimensions — area must be > 0', 'err'); return; }
  if (!(ent.lengthM > 0)) { feedback('⚠ Length must be > 0', 'err'); return; }
  if (!(ent.nos > 0)) { feedback('⚠ Nos must be ≥ 1', 'err'); return; }

  const row = {
    member,
    mark:    $('#mark').value.trim(),
    element: $('#element').value,
    grade:   $('#grade').value,
    section: ent.section,
    sectionLabel: ent.sectionLabel,
    dimsLabel: ent.dimsLabel,
    areaM2:  ent.areaM2,
    lengthM: ent.lengthM,
    nos:     ent.nos,
    fwModeId: ent.fwModeId,
    fwModeLabel: ent.fwModeLabel,
    psM:     ent.psM,
    ends:    ent.ends,
    volM3:   ent.volM3,
    volCalc: ent.volCalc,
    fwM2:    ent.fwM2,
    fwCalc:  ent.fwCalc,
    remarks: $('#remarks').value.trim(),
    createdAt: Date.now(),
    shapeVec:  currentShapeVec  || null,
    shapeHist: currentShapeHist || null,
    shapeImg:  currentShapeImg  || null,
    inputs: { dims: ent.dims },
  };

  let verb = 'Added';
  if (editIndex >= 0 && editIndex < rows.length) { lastEditedIndex = editIndex; rows[editIndex] = row; verb = 'Updated'; editIndex = -1; }
  else rows.push(row);
  const submitBtn = document.querySelector('.submit-btn'); if (submitBtn) submitBtn.textContent = '➕ Add to Schedule';
  if (verb === 'Updated') {
    if (navPersistTimer) clearTimeout(navPersistTimer)
    navPersistTimer = setTimeout(() => {
      navPersistTimer = null; lastEditedIndex = -1
      updateRecordNav()
    }, 5000)
  }
  persist(); render();
  feedback(`✔ ${verb} ${row.member} · ${fmt3(row.volM3)} m³ · ${fmt3(row.fwM2)} m² formwork`, 'ok');

  $('#memberForm').reset();
  clearShapeUpload();
  $('#grade').value = settings.defaultGrade;
  showShape('rect'); updateFwModes(); updatePreview();
});

/* Reset button reloads to a clean form */
$('#reset').addEventListener('click', () => location.reload());

/* =========================
   Edit & Delete
   ========================= */
function closeOptionsMenus() {
  document.querySelectorAll('.options-menu.open').forEach(m => m.classList.remove('open'))
}

$('#bbsTable').addEventListener('click', e => {
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
  const del = e.target.dataset.del, edit = e.target.dataset.edit, enlarge = e.target.dataset.enlarge;
  if (enlarge !== undefined) { const r = rows[Number(enlarge)]; if (r && (r.shapeVec||r.shapeImg)) openSketchLightbox(r); return; }
  if (del !== undefined) {
    const r = rows[Number(del)];
    const label = r ? `${r.member||'item'}${r.mark?' ('+r.mark+')':''}` : 'this row';
    if (!confirm(`Delete ${label} from the schedule?`)) return;
    const di = Number(del);
    rows.splice(di,1);
    clampPage()
    if (editIndex === di) editIndex = -1;
    else if (editIndex > di) editIndex--;
    persist(); render();
  } else if (edit !== undefined) {
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
  $('#member').value  = r.member
  $('#mark').value    = r.mark || ''
  $('#element').value = r.element || 'Column'
  $('#grade').value   = r.grade || settings.defaultGrade
  $('#section').value = r.section
  showShape(r.section)
  const d = (r.inputs && r.inputs.dims) || {}
  if (r.section === 'rect')      { $('#R_B').value = d.B||''; $('#R_D').value = d.D||'' }
  if (r.section === 'circle')    { $('#C_dia').value = d.dia||'' }
  if (r.section === 'tbeam')     { $('#T_bf').value = d.bf||''; $('#T_hf').value = d.hf||''; $('#T_bw').value = d.bw||''; $('#T_D').value = d.D||'' }
  if (r.section === 'trapezoid') { $('#Z_a').value = d.a||''; $('#Z_b').value = d.b||''; $('#Z_h').value = d.h||'' }
  if (r.section === 'custom')    { $('#X_area').value = d.area||''; $('#X_perim').value = d.perim||''; $('#X_name').value = d.name||''; $('#X_areaCalc').value = d.areaCalc||''; $('#X_perimCalc').value = d.perimCalc||'' }
  updateFwModes(r.fwModeId)
  $('#length').value = r.lengthM
  $('#nos').value    = r.nos
  $('#fwEnds').checked = !!r.ends
  $('#remarks').value = r.remarks || ''

  if (r.shapeVec || r.shapeImg) {
    currentShapeVec  = r.shapeVec  || null
    currentShapeImg  = r.shapeImg  || null
    currentShapeHist = r.shapeHist || null
    $('#shapePreview').src = shapeSrc(r)
    $('#shapePreview').style.display = 'block'
    $('#shapeClearBtn').style.display = 'inline-flex'
  } else clearShapeUpload()

  updatePreview()
  updateRecordNav()
  $('#member').focus()
  $('#member').scrollIntoView({ behavior:'smooth', block:'center' })
}

function navRecord(dir) {
  if (!rows.length) return
  if (navPersistTimer) { clearTimeout(navPersistTimer); navPersistTimer = null }
  let base = editIndex >= 0 ? editIndex : lastEditedIndex
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
   CSV Export
   ========================= */
function csvEscape(val){
  let s = String(val);
  if (s.indexOf('"') !== -1) s = s.replace(/"/g,'""');
  if (/[,\n"]/.test(s)) return `"${s}"`;
  return s;
}
function infoLine(label, value){ return `${csvEscape(label)},${csvEscape(value?String(value):'-')}`; }
function toCSV(){
  const lines = [];
  if (projectInfo.header) lines.push(csvEscape(projectInfo.header));
  lines.push('CONCRETE CASTING & FORMWORK SCHEDULE');
  lines.push(infoLine('Name of Work',   projectInfo.project));
  lines.push(infoLine('Name of Agency', projectInfo.agency));
  lines.push(infoLine('Reference',      projectInfo.ref));
  lines.push('');
  lines.push(['#','Member','Mark','Element','Section','Dimensions','Length (m)','Nos','Grade',
    'Volume Calc','Volume (m3)','Formwork Faces','Formwork Calc','Formwork (m2)','Remarks'].join(','));
  rows.forEach((r,i) => {
    lines.push([
      i+1, csvEscape(r.member), csvEscape(r.mark||''), csvEscape(r.element||''),
      csvEscape(r.sectionLabel), csvEscape(r.dimsLabel), fmtL(r.lengthM), r.nos, csvEscape(r.grade),
      csvEscape(r.volCalc), fmt3(r.volM3), csvEscape(r.fwModeLabel),
      csvEscape(r.fwCalc), fmt3(r.fwM2), csvEscape(r.remarks||'')
    ].join(','));
  });
  lines.push(['Totals','','','','','','','','','',
    fmt3(rows.reduce((a,b)=>a+b.volM3,0)),'','',
    fmt3(rows.reduce((a,b)=>a+b.fwM2,0)),''].join(','));
  lines.push('');
  // Grade summary
  const grades = gradeSummary();
  Object.keys(grades).sort().forEach(g => lines.push(infoLine(`Concrete ${g} (m3)`, fmt3(grades[g]))));
  lines.push(infoLine(`Concrete +${settings.concWastage}% wastage (m3)`, fmt3(rows.reduce((a,b)=>a+b.volM3,0)*(1+settings.concWastage/100))));
  lines.push(infoLine(`Formwork +${settings.fwWastage}% wastage (m2)`,  fmt3(rows.reduce((a,b)=>a+b.fwM2,0)*(1+settings.fwWastage/100))));
  return lines.join('\n');
}
$('#exportCSV').addEventListener('click', () => {
  const blob = new Blob([toCSV()], { type:'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cfs_${(projectInfo.project||'schedule').replace(/[^a-z0-9]/gi,'_').toLowerCase()}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
});

/* =========================
   Save / Load JSON
   ========================= */
/* Pretty-print export but keep each row on a single line */
function buildExportJSON(data){
  const indent = (s,pad)=>s.replace(/\n/g,'\n'+pad);
  const parts = [];
  for(const [k,v] of Object.entries(data)){
    if(k==='rows' && Array.isArray(v)){
      const items = v.map(r=>'    '+JSON.stringify(r));
      const body = items.length ? '[\n'+items.join(',\n')+'\n  ]' : '[]';
      parts.push('  '+JSON.stringify(k)+': '+body);
    } else {
      parts.push('  '+JSON.stringify(k)+': '+indent(JSON.stringify(v,null,2),'  '));
    }
  }
  return '{\n'+parts.join(',\n')+'\n}';
}
$('#saveJSON').addEventListener('click', () => {
  const now = new Date();
  const ts  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}`;
  const blob = new Blob([buildExportJSON({ type:'cfs', rows, settings, projectInfo })], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cfs_${ts}.json`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(a.href); }, 0);
});
$('#loadJSON').addEventListener('click', () => {
  const inp = document.createElement('input'); inp.type='file'; inp.accept='.json,application/json';
  inp.onchange = () => {
    const file = inp.files[0]; if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const data = JSON.parse(fr.result);
        if (Array.isArray(data.rows))  { rows = data.rows; editIndex = -1; }
        if (data.settings)             { settings = Object.assign({}, DEFAULTS, data.settings); saveSettings(); }
        if (data.projectInfo)          { projectInfo = Object.assign({}, INFO_DEFAULTS, data.projectInfo); applyInfoToForm(); saveInfoToStorage(); updatePrintMeta(); }
        persist(); render();
      } catch (err) { alert('Invalid JSON file.'); }
    };
    fr.readAsText(file);
  };
  inp.click();
});

/* =========================
   Clear all
   ========================= */
$('#clearAll').addEventListener('click', () => {
  if (confirm('Clear the entire schedule?')) { rows = []; editIndex = -1; persist(); render(); }
});

/* =========================
   Drag & Drop reorder
   ========================= */
let draggedItem = null;
$('#tbody').addEventListener('dragstart', e => {
  draggedItem = e.target.closest('tr');
  if (draggedItem) { e.dataTransfer.effectAllowed='move'; draggedItem.classList.add('dragging'); }
});
$('#tbody').addEventListener('dragenter', e => { e.preventDefault(); const t=e.target.closest('tr'); if (t&&t!==draggedItem) t.classList.add('drag-over'); });
$('#tbody').addEventListener('dragleave', e => { const t=e.target.closest('tr'); if (t) t.classList.remove('drag-over'); });
$('#tbody').addEventListener('dragover',  e => { e.preventDefault(); e.dataTransfer.dropEffect='move'; });
$('#tbody').addEventListener('drop', e => {
  e.preventDefault();
  const drop = e.target.closest('tr');
  if (draggedItem && drop && draggedItem !== drop) {
    const oi = parseInt(draggedItem.dataset.index), di = parseInt(drop.dataset.index);
    let ni = oi < di ? di+1 : di;
    const [rm] = rows.splice(oi,1);
    if (oi < ni) ni--;
    rows.splice(ni,0,rm);
    persist(); render();
  }
});
$('#tbody').addEventListener('dragend', () => {
  if (draggedItem) draggedItem.classList.remove('dragging');
  document.querySelectorAll('#tbody .drag-over').forEach(el => el.classList.remove('drag-over'));
  draggedItem = null;
});

/* =========================
   Section Sketch — upload + drawer
   ========================= */
let currentShapeImg = null, currentShapeVec = null, currentShapeHist = null;
function clearShapeUpload(){
  currentShapeImg = null; currentShapeVec = null; currentShapeHist = null;
  $('#shapeFile').value = '';
  $('#shapePreview').style.display = 'none';
  $('#shapePreview').src = '';
  $('#shapeClearBtn').style.display = 'none';
}
$('#shapeUploadBtn').addEventListener('click', () => $('#shapeFile').click());
$('#shapeFile').addEventListener('change', () => {
  const file = $('#shapeFile').files[0]; if (!file) return;
  if (!['image/jpeg','image/png','image/svg+xml'].includes(file.type)) {
    alert('Only JPG, PNG, and SVG files are supported.'); $('#shapeFile').value=''; return;
  }
  const reader = new FileReader();
  reader.onload = async ev => {
    const raw = ev.target.result;
    currentShapeImg = window.ShapeVector ? await ShapeVector.downscale(raw) : raw;
    currentShapeVec = null; currentShapeHist = null;
    $('#shapePreview').src = currentShapeImg;
    $('#shapePreview').style.display = 'block';
    $('#shapeClearBtn').style.display = 'inline-flex';
  };
  reader.readAsDataURL(file);
});
$('#shapeClearBtn').addEventListener('click', clearShapeUpload);
$('#shapeDrawBtn').addEventListener('click', () => {
  // Cross-section sketches default to the flat "no texture" line style.
  window.ShapeDrawer.open(result => {
    if (!result) return;
    currentShapeVec  = result.vec  || null;
    currentShapeImg  = result.img  || null;
    currentShapeHist = result.hist || null;
    const src = currentShapeVec ? ShapeVector.toDataURL(currentShapeVec) : currentShapeImg;
    if (!src) return;
    const preview = $('#shapePreview');
    preview.src = src;
    preview.style.display = 'block';
    $('#shapeClearBtn').style.display = 'inline-flex';
  }, { style:'none', history: currentShapeHist });   // reload the saved drawing for editing
});

/* =========================
   PDF Export  (landscape A4, mirrors the BBS report layout)
   ========================= */
$('#printBBS').addEventListener('click', async () => {
  updatePrintMeta();
  const pdfTextured = !!($('#pdfTextured') && $('#pdfTextured').checked);
  const btn = $('#printBBS');
  btn.disabled = true; btn.textContent = '⏳ Generating…';

  try {
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF not loaded');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation:'landscape', unit:'mm', format:'a4' });

    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const usableW = pageW - margin*2;

    const sani = s => String(s == null ? '' : s)
      .replace(/⌀/g,'Ø').replace(/π/g,'pi').replace(/√/g,'sqrt').replace(/−/g,'-').replace(/×/g,'x').replace(/²/g,'2').replace(/³/g,'3');

    const pad = 1.6, lineH = 3.6, fontSize = 8, sketchMaxH = 35;

    const cols = [
      { key:'idx',    title:'#',              align:'right' },
      { key:'member', title:'Member',         align:'left'  },
      { key:'element',title:'Element',        align:'left'  },
      { key:'section',title:'Section',        align:'left'  },
      { key:'sketch', title:'Sketch',         align:'center'},
      { key:'dims',   title:'Dimensions',     align:'left'  },
      { key:'len',    title:'L (m)',          align:'right' },
      { key:'nos',    title:'Nos',            align:'right' },
      { key:'grade',  title:'Grade',          align:'right' },
      { key:'volc',   title:'Volume Calc',    align:'left',  pct:15 },
      { key:'vol',    title:'Volume (m3)',    align:'right', pct:10 },
      { key:'fwc',    title:'Formwork Calc',  align:'left',  pct:15 },
      { key:'fw',     title:'Formwork (m2)',  align:'right', pct:10 },
      { key:'rem',    title:'Remarks',        align:'left',  pct:9  },
    ];

    const saniM = sani;
    const cellStrings = key => {
      if (key === 'sketch') return [];
      const out = [];
      rows.forEach((r,i) => {
        switch (key) {
          case 'idx':     out.push(String(i+1)); break;
          case 'member':  out.push(saniM(r.member||'')); break;
          case 'element': out.push(saniM(r.element||'')); break;
          case 'section': out.push(saniM(r.sectionLabel||'')); break;
          case 'dims':    out.push(saniM(r.dimsLabel||'')); break;
          case 'len':     out.push(fmtL(r.lengthM)); break;
          case 'nos':     out.push(String(r.nos)); break;
          case 'grade':   out.push(saniM(r.grade||'')); break;
          case 'volc':    out.push(saniM(r.volCalc||'')); break;
          case 'vol':     out.push(fmt3(r.volM3)); break;
          case 'fwc':     out.push(saniM(r.fwCalc||'')); break;
          case 'fw':      out.push(fmt3(r.fwM2)); break;
          case 'rem':     out.push(saniM(r.remarks||'')); break;
        }
      });
      return out;
    };
    const SKETCH_W = 60, MIN_W = 7, FLEX_MIN = 18;
    const FLEX = new Set(['member','element','section','dims','rem']);

    pdf.setFontSize(fontSize);
    const longestWord = t => t.split(/\s+/).reduce((m,w)=>Math.max(m, pdf.getTextWidth(w)), 0);
    cols.forEach(c => {
      if (c.key === 'sketch') { c.nat = SKETCH_W; return; }
      pdf.setFont('helvetica','bold');
      let natural = longestWord(c.title);
      pdf.setFont('helvetica','normal');
      for (const s of cellStrings(c.key)) { const w = pdf.getTextWidth(s); if (w > natural) natural = w; }
      c.nat = Math.max(MIN_W, natural + 2*pad);
    });

    cols.forEach(c => { if (c.pct != null) c.w = usableW * c.pct / 100; });
    const pinned   = cols.filter(c => c.pct == null && !FLEX.has(c.key));
    const flexCols = cols.filter(c => c.pct == null &&  FLEX.has(c.key));
    const lockedSum  = cols.filter(c => c.pct != null).reduce((a,c)=>a+c.w,0);
    const fixedSum   = pinned.reduce((a,c)=>a+c.nat,0);
    const flexNatSum = flexCols.reduce((a,c)=>a+c.nat,0) || 1;
    const avail      = usableW - lockedSum - fixedSum;
    pinned.forEach(c => { c.w = c.nat; });
    flexCols.forEach(c => { c.w = Math.max(FLEX_MIN, avail * (c.nat/flexNatSum)); });

    const wsum = cols.reduce((a,c)=>a+c.w,0);
    let xacc = margin;
    cols.forEach(c => { c.w = c.w * usableW / wsum; c.x = xacc; xacc += c.w; });
    const col = k => cols.find(c => c.key === k);

    pdf.setLineWidth(0.2); pdf.setDrawColor(0);

    const putText = (c, val, yTop) => {
      const arr = Array.isArray(val) ? val : [val];
      const tx = c.align === 'right'  ? c.x + c.w - pad
               : c.align === 'center' ? c.x + c.w/2
               :                         c.x + pad;
      arr.forEach((ln,k) => pdf.text(ln, tx, yTop + pad + k*lineH, { align:c.align, baseline:'top' }));
    };

    let y = margin;

    function drawProjectHeader(){
      if (projectInfo.header) {
        pdf.setFont('helvetica','bold'); pdf.setFontSize(11);
        pdf.splitTextToSize(sani(projectInfo.header), usableW).forEach(ln => { pdf.text(ln, pageW/2, y+4, { align:'center' }); y += 5.5; });
        y += 1;
      }
      pdf.setFont('helvetica','bold'); pdf.setFontSize(13);
      pdf.text('CONCRETE CASTING & FORMWORK SCHEDULE', pageW/2, y+5, { align:'center' });
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
        const rh = Math.max(lineH, vLines.length*lineH) + 2*pad;
        pdf.rect(margin, y, labelW, rh);
        pdf.rect(margin + labelW, y, usableW - labelW, rh);
        pdf.setFont('helvetica','bold'); pdf.text(sani(k), margin + pad, y + pad, { baseline:'top' });
        pdf.setFont('helvetica','normal');
        vLines.forEach((ln,i) => pdf.text(ln, margin + labelW + pad, y + pad + i*lineH, { baseline:'top' }));
        y += rh;
      });
      y += 3;
    }

    function drawTableHead(){
      const hh = lineH*2 + 2*pad;
      pdf.setFont('helvetica','bold'); pdf.setFontSize(fontSize);
      cols.forEach(c => {
        pdf.setFillColor(0,0,0); pdf.rect(c.x, y, c.w, hh, 'F');
        pdf.setTextColor(255,255,255);
        const tl = pdf.splitTextToSize(c.title, c.w - 2*pad);
        const tx = c.align === 'right'  ? c.x + c.w - pad
                 : c.align === 'center' ? c.x + c.w/2
                 :                         c.x + pad;
        const n = tl.length;
        const _ptMM = 0.352777778;
        if (n === 1) {
          pdf.text(tl[0], tx, y + hh/2 - fontSize*_ptMM*0.35, { align:c.align, baseline:'top' });
        } else {
          tl.forEach((ln,i) => pdf.text(ln, tx, y + (hh - n*lineH)/2 + i*lineH, { align:c.align, baseline:'top' }));
        }
      });
      pdf.setTextColor(0,0,0);
      y += hh;
    }

    drawProjectHeader();
    drawTableHead();
    pdf.setFont('helvetica','normal'); pdf.setFontSize(fontSize);

    let sumVol = 0, sumFw = 0;
    rows.forEach((r,i) => {
      sumVol += r.volM3; sumFw += r.fwM2;
      const t = {
        idx:     String(i+1),
        member:  pdf.splitTextToSize(sani(r.member||''),      col('member').w  - 2*pad),
        element: pdf.splitTextToSize(sani(r.element||''),     col('element').w - 2*pad),
        section: pdf.splitTextToSize(sani(r.sectionLabel||''),col('section').w - 2*pad),
        dims:    pdf.splitTextToSize(sani(r.dimsLabel||''),   col('dims').w    - 2*pad),
        len:     fmtL(r.lengthM),
        nos:     String(r.nos),
        grade:   sani(r.grade||''),
        volc:    pdf.splitTextToSize(sani(r.volCalc||''),     col('volc').w    - 2*pad),
        vol:     fmt3(r.volM3),
        fwc:     pdf.splitTextToSize(sani(r.fwCalc||''),      col('fwc').w     - 2*pad),
        fw:      fmt3(r.fwM2),
        rem:     pdf.splitTextToSize(sani(r.remarks||''),     col('rem').w     - 2*pad),
      };

      let model = null;
      if (pdfTextured && r.shapeHist && window.ShapeDrawer && ShapeDrawer.buildTexturedModel) {
        try { model = ShapeDrawer.buildTexturedModel(r.shapeHist); } catch {}
      }
      if (!model && r.shapeVec && r.shapeVec.vb) model = r.shapeVec;

      let sk = null;
      const fitBox = ar => {
        const boxW = col('sketch').w - 2*pad;
        let dw = boxW, dh = boxW/ar;
        if (dh > sketchMaxH) { dh = sketchMaxH; dw = sketchMaxH*ar; }
        return { w:dw, h:dh };
      };
      if (model && model.vb && model.vb[3] > 0) sk = fitBox(model.vb[2]/model.vb[3]);
      else if (r.shapeImg) { try { const p = pdf.getImageProperties(r.shapeImg); sk = fitBox(p.width/p.height); } catch {} }

      const maxLines = Math.max(t.member.length, t.element.length, t.section.length, t.dims.length, t.volc.length, t.fwc.length, t.rem.length, 1);
      const rowH = Math.max(maxLines*lineH, sk ? sk.h : 0) + 2*pad;

      if (y + rowH > pageH - margin) { pdf.addPage(); y = margin; drawTableHead(); pdf.setFont('helvetica','normal'); pdf.setFontSize(fontSize); }

      cols.forEach(c => pdf.rect(c.x, y, c.w, rowH));
      putText(col('idx'),     t.idx,     y);
      putText(col('member'),  t.member,  y);
      putText(col('element'), t.element, y);
      putText(col('section'), t.section, y);
      if (sk) {
        const sx = col('sketch').x + (col('sketch').w - sk.w)/2;
        const sy = y + (rowH - sk.h)/2;
        if (model && window.ShapeVector) {
          try { ShapeVector.toPdf(pdf, model, sx, sy, sk.w, sk.h); } catch {}
          pdf.setLineWidth(0.2); pdf.setDrawColor(0); pdf.setTextColor(0,0,0);
          if (pdf.setLineCap) pdf.setLineCap('butt');
          pdf.setFont('helvetica','normal'); pdf.setFontSize(fontSize);
        } else { try { pdf.addImage(r.shapeImg, 'PNG', sx, sy, sk.w, sk.h); } catch {} }
      } else putText(col('sketch'), '-', y);
      putText(col('dims'),  t.dims,  y);
      putText(col('len'),   t.len,   y);
      putText(col('nos'),   t.nos,   y);
      putText(col('grade'), t.grade, y);
      putText(col('volc'),  t.volc,  y);
      putText(col('vol'),   t.vol,   y);
      putText(col('fwc'),   t.fwc,   y);
      putText(col('fw'),    t.fw,    y);
      putText(col('rem'),   t.rem,   y);
      y += rowH;
    });

    // Totals row
    const totH = lineH + 2*pad;
    if (y + totH > pageH - margin) { pdf.addPage(); y = margin; drawTableHead(); }
    pdf.setFont('helvetica','bold'); pdf.setFontSize(fontSize); pdf.setTextColor(0,0,0);
    const labelW = cols.slice(0,10).reduce((a,c)=>a+c.w,0);
    const totCell = (x,w) => { pdf.setFillColor(255,255,255); pdf.rect(x, y, w, totH, 'FD'); };
    totCell(margin, labelW);
    pdf.text('Totals:', margin + labelW - pad, y + pad, { align:'right', baseline:'top' });
    totCell(col('vol').x, col('vol').w);
    pdf.text(fmt3(sumVol), col('vol').x + col('vol').w - pad, y + pad, { align:'right', baseline:'top' });
    totCell(col('fwc').x, col('fwc').w);
    totCell(col('fw').x,  col('fw').w);
    pdf.text(fmt3(sumFw), col('fw').x + col('fw').w - pad, y + pad, { align:'right', baseline:'top' });
    totCell(col('rem').x, col('rem').w);
    y += totH;

    // Summary block (grade breakdown + wastage + cost)
    y += 4;
    if (y + 30 > pageH - margin) { pdf.addPage(); y = margin; }
    pdf.setFont('helvetica','bold'); pdf.setFontSize(10);
    pdf.text('Summary', margin, y); y += 5;
    pdf.setFont('helvetica','normal'); pdf.setFontSize(9);
    const grades = gradeSummary();
    const line = txt => { if (y + 5 > pageH - margin) { pdf.addPage(); y = margin; } pdf.text(sani(txt), margin, y); y += 5; };
    Object.keys(grades).sort().forEach(g => line(`Concrete ${g}: ${fmt3(grades[g])} m3`));
    line(`Net concrete: ${fmt3(sumVol)} m3   |   +${settings.concWastage}% wastage: ${fmt3(sumVol*(1+settings.concWastage/100))} m3`);
    line(`Net formwork: ${fmt3(sumFw)} m2   |   +${settings.fwWastage}% wastage: ${fmt3(sumFw*(1+settings.fwWastage/100))} m2`);
    if (settings.concRate > 0) line(`Concrete cost (gross): ${money(sumVol*(1+settings.concWastage/100)*settings.concRate)}`);
    if (settings.fwRate  > 0)  line(`Formwork cost (gross): ${money(sumFw*(1+settings.fwWastage/100)*settings.fwRate)}`);

    // Page footers
    const pageCount = pdf.internal.getNumberOfPages();
    pdf.setFont('helvetica','normal'); pdf.setFontSize(8); pdf.setTextColor(0,0,0);
    for (let p = 1; p <= pageCount; p++) {
      pdf.setPage(p);
      pdf.text(`Page ${p} of ${pageCount}`, pageW - margin, pageH - 4, { align:'right' });
    }

    const proj = (projectInfo.project || 'CFS').replace(/[^a-zA-Z0-9_-]/g,'_');
    let fileName = `${proj}_CFS.pdf`;
    if (fileName.length > 50) fileName = fileName.slice(0,46) + '.pdf';
    pdf.save(fileName);
  } catch (err) {
    console.error('PDF export failed:', err);
    alert('PDF export failed. See console for details.');
  } finally {
    btn.disabled = false; btn.textContent = '📄 Export PDF';
  }
});

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
      <option value="25" selected>25</option>
      <option value="50">50</option>
      <option value="100">100</option>
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
   Light / Dark Theme Toggle  (shared key with BBS)
   ========================= */
(function(){
  const root = document.documentElement;
  const btn  = document.getElementById('themeToggle');
  const icon = document.getElementById('themeIcon');
  const lbl  = document.getElementById('themeLabel');
  const saved = localStorage.getItem('bbs_theme') || 'light';
  applyTheme(saved);
  btn.addEventListener('click', () => {
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next); localStorage.setItem('bbs_theme', next);
  });
  function applyTheme(t){
    root.dataset.theme = t;
    if (t === 'light') { icon.textContent = '🧱'; lbl.textContent = 'Rust'; }
    else               { icon.textContent = '🏗️'; lbl.textContent = 'Steel'; }
  }
})();

/* =========================
   Keyboard shortcuts + feedback
   ========================= */
function feedback(msg, type, ms=2800){
  const fb = $('#formFeedback');
  fb.textContent = msg;
  fb.className = 'form-feedback ' + type;
  clearTimeout(fb._t);
  fb._t = setTimeout(() => { fb.textContent=''; fb.className='form-feedback'; }, ms);
}
document.addEventListener('keydown', e => {
  if (e.altKey && e.key === 'i') { e.preventDefault(); document.getElementById('btnInfo').click(); }
  if (e.altKey && e.key === 's') { e.preventDefault(); document.getElementById('btnSettings').click(); }
  if (e.altKey && e.key === 'h') { e.preventDefault(); document.getElementById('btnHelp').click(); }
  if (e.key === 'Escape' && document.getElementById('memberForm').contains(document.activeElement)) {
    document.getElementById('reset').click();
  }
});
$('#memberForm').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'submit') {
    e.preventDefault(); $('#memberForm').requestSubmit();
  }
});

/* =========================
   Init
   ========================= */
applySettingsToForm();
applyInfoToForm();
updatePrintMeta();
$('#grade').value = settings.defaultGrade;
showShape($('#section').value);
updateFwModes();
updatePreview();
initPagination();
render();
