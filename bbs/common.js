/* =========================
   Common utilities shared between BBS and CFS pages
   ========================= */
const $ = sel => document.querySelector(sel);

const fmt3 = n => (Math.round(n * 1000) / 1000).toFixed(3);
const fmt0 = n => Math.round(n).toString();

function escapeHTML(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function closeOptionsMenus() {
  document.querySelectorAll('.options-menu.open').forEach(m => m.classList.remove('open'));
}

/* Close the toolbar Export/Import dropdowns (optionally keep one open). */
function closeToolbarMenus(except) {
  document.querySelectorAll('.toolbar-menu.open').forEach(m => {
    if (m === except) return;
    m.classList.remove('open');
    m.style.left = m.style.right = '';
    const trigger = document.querySelector(`.menu-trigger[aria-controls="${m.id}"]`);
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  });
}

/* Keep an open dropdown inside the viewport. The menu is absolutely positioned
   within its .menu-wrap; on mobile the toolbar wraps and a default right:0 menu
   can spill past a screen edge, so we measure and clamp its horizontal offset. */
function positionToolbarMenu(trigger, menu) {
  menu.style.left = menu.style.right = '';
  const pad = 8;
  const vw = document.documentElement.clientWidth;
  const wrap = trigger.parentElement.getBoundingClientRect();
  const mw = menu.offsetWidth;
  let leftVp = wrap.right - mw;                       // default: right-aligned to the trigger
  if (leftVp + mw > vw - pad) leftVp = vw - pad - mw; // don't run off the right
  if (leftVp < pad) leftVp = pad;                     // …nor off the left
  menu.style.right = 'auto';
  menu.style.left = (leftVp - wrap.left) + 'px';      // offset is relative to the wrap
}

/* Wire the shared Export / Import dropdown menus. The action items keep the
   original ids (#exportCSV, #saveJSON, #printBBS, #importCSV, #loadJSON) so each
   page's existing click handlers stay attached — we only add open/close. */
function initToolbarMenus() {
  const triggers = document.querySelectorAll('.menu-trigger');
  if (!triggers.length) return;
  triggers.forEach(trigger => {
    const menu = document.getElementById(trigger.getAttribute('aria-controls'));
    if (!menu) return;
    trigger.addEventListener('click', e => {
      e.stopPropagation();
      const willOpen = !menu.classList.contains('open');
      closeToolbarMenus();
      closeOptionsMenus();
      if (willOpen) {
        menu.classList.add('open');
        positionToolbarMenu(trigger, menu);
      }
      trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
    // Close after picking an action, but keep open when toggling the PDF switch.
    menu.addEventListener('click', e => {
      if (e.target.closest('.toggle-item') || e.target.closest('.keep-open')) return;
      if (e.target.closest('.options-item')) closeToolbarMenus();
    });
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.toolbar-menu') && !e.target.closest('.menu-trigger')) closeToolbarMenus();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeToolbarMenus(); });
  window.addEventListener('resize', () => {
    document.querySelectorAll('.toolbar-menu.open').forEach(m => {
      const trigger = document.querySelector(`.menu-trigger[aria-controls="${m.id}"]`);
      if (trigger) positionToolbarMenu(trigger, m);
    });
  });
}

function buildExportJSON(data) {
  const indent = (s, pad) => s.replace(/\n/g, '\n' + pad);
  const parts = [];
  for (const [k, v] of Object.entries(data)) {
    if (k === 'rows' && Array.isArray(v)) {
      const items = v.map(r => {
        const { shapeVec, shapeHist, ...rest } = r;
        const extras = [];
        if (shapeVec  !== undefined) extras.push('"shapeVec": '  + JSON.stringify(shapeVec));
        if (shapeHist !== undefined) extras.push('"shapeHist": ' + JSON.stringify(shapeHist));
        if (!extras.length) return '    ' + JSON.stringify(rest);
        const base = JSON.stringify(rest);
        return '    ' + base.slice(0, -1) + (base.length > 2 ? ',' : '') +
               '\n      ' + extras.join(',\n      ') + '}';
      });
      const body = items.length ? '[\n' + items.join(',\n') + '\n  ]' : '[]';
      parts.push('  ' + JSON.stringify(k) + ': ' + body);
    } else {
      parts.push('  ' + JSON.stringify(k) + ': ' + indent(JSON.stringify(v, null, 2), '  '));
    }
  }
  return '{\n' + parts.join(',\n') + '\n}';
}

function getPageCount() {
  if (!pageSize || pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(rows.length / pageSize));
}
function getPageRows() {
  if (!pageSize || pageSize <= 0) return rows;
  const start = (currentPage - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}
function clampPage() {
  if (!pageSize || pageSize <= 0) { currentPage = 1; return; }
  const max = getPageCount();
  if (currentPage > max) currentPage = max;
  if (currentPage < 1) currentPage = 1;
}

/* =========================================================================
   Shared chrome for the BBS and CFS pages. Each page supplies its own
   `rows`, `render`, `persist`, `navRecord`, `resetSettings`, `searchTerm`,
   `currentPage`, `pageSize` globals; the helpers below reference them by
   name at event time, so they resolve against whichever page is loaded.
   ========================================================================= */

/* ---- Project info (shared IDB key 'bbs_info') ---- */
const INFO_DEFAULTS = { header: '', project: '', agency: '', ref: '' };
let projectInfo = Object.assign({}, INFO_DEFAULTS);  // populated in each page's initPage()
async function loadInfo() {
  return Object.assign({}, INFO_DEFAULTS, (await AppDB.get('bbs_info')) ?? {});
}
function saveInfoToStorage() { AppDB.set('bbs_info', projectInfo); }
function applyInfoToForm() {
  $('#infoHeader').value  = projectInfo.header  || '';
  $('#infoProject').value = projectInfo.project || '';
  $('#infoAgency').value  = projectInfo.agency  || '';
  $('#infoRef').value     = projectInfo.ref     || '';
}
function readInfoFromForm() {
  projectInfo.header  = $('#infoHeader').value.trim();
  projectInfo.project = $('#infoProject').value.trim();
  projectInfo.agency  = $('#infoAgency').value.trim();
  projectInfo.ref     = $('#infoRef').value.trim();
}
function updatePrintMeta() {
  const r = txt => escapeHTML(txt || '—').replace(/\r?\n/g, '<br>');
  $('#pmProject').innerHTML = r(projectInfo.project);
  $('#pmAgency').innerHTML  = r(projectInfo.agency);
  $('#pmRef').innerHTML     = r(projectInfo.ref);
  const titleEl = $('#pmHeaderTitle');
  if (projectInfo.header) { titleEl.innerHTML = escapeHTML(projectInfo.header).replace(/\r?\n/g, '<br>'); titleEl.style.display = 'block'; }
  else { titleEl.textContent = ''; titleEl.style.display = 'none'; }
}

/* ---- Shared persistence factories ---- */
function makePersist(key) {
  return function persist() { AppDB.set(key, rows); };
}
function makeSettings(key, defaults) {
  return {
    load: async () => Object.assign(structuredClone(defaults), (await AppDB.get(key)) ?? {}),
    save: () => AppDB.set(key, settings),
  };
}

/* ---- Sort rows by member group then mark (shared between BBS and CFS) ---- */
function sortRowsByMemberGroup() {
  const groups = [], memberOrder = [];
  for (const r of rows) {
    const key = r.member;
    if (!memberOrder.includes(key)) { memberOrder.push(key); groups.push({ member: key, items: [] }); }
    groups[memberOrder.indexOf(key)].items.push(r);
  }
  for (const g of groups)
    g.items.sort((a, b) => (a.mark || '').localeCompare(b.mark || '', undefined, { numeric: true }));
  rows = groups.flatMap(g => g.items);
}

/* ---- Form feedback toast (BBS used window._showFeedback; keep that alias) ---- */
function feedback(msg, type, ms = 2800) {
  const fb = $('#formFeedback');
  if (!fb) return;
  fb.textContent = msg;
  fb.className = 'form-feedback ' + (type || '');
  clearTimeout(fb._t);
  fb._t = setTimeout(() => { fb.textContent = ''; fb.className = 'form-feedback'; }, ms);
}
window._showFeedback = feedback;

/* ---- Search-aware pagination (render() builds the visible set) ---- */
function renderPagination(visibleCount) {
  const el = $('#paginationControls');
  if (!el) return;
  const count = visibleCount != null ? visibleCount : rows.length;
  if (!pageSize || pageSize <= 0 || count <= pageSize) { el.style.display = 'none'; return; }
  el.style.display = 'inline-flex'; el.style.alignItems = 'center'; el.style.gap = '4px';
  const maxPage = Math.max(1, Math.ceil(count / pageSize));
  $('#pageInfo').textContent = `Page ${currentPage} of ${maxPage}`;
  $('#prevPage').disabled = currentPage <= 1;
  $('#nextPage').disabled = currentPage >= maxPage;
}
function initPagination(sizes) {
  if ($('#paginationControls')) return;
  const opts = (sizes || [10, 25, 50, 0])
    .map(n => `<option value="${n}"${n === 25 ? ' selected' : ''}>${n === 0 ? 'All' : n}</option>`).join('');
  const el = document.createElement('span');
  el.id = 'paginationControls'; el.style.display = 'none';
  el.innerHTML = `
    <button class="btn small ghost" id="prevPage" title="Previous page">◀</button>
    <span id="pageInfo" style="font-size:11px;color:var(--muted);white-space:nowrap;padding:0 4px">Page 1 of 1</span>
    <button class="btn small ghost" id="nextPage" title="Next page">▶</button>
    <select id="pageSizeSelect" style="width:auto;padding:3px 5px;font-size:11px;margin-left:2px">${opts}</select>`;
  const badge = $('#countBadge');
  if (badge && badge.parentNode) badge.after(el);
  $('#prevPage').addEventListener('click', () => { if (currentPage > 1) { currentPage--; render(); } });
  $('#nextPage').addEventListener('click', () => { if (currentPage < getPageCount()) { currentPage++; render(); } });
  $('#pageSizeSelect').addEventListener('change', e => { pageSize = Number(e.target.value); currentPage = 1; render(); });
  const search = $('#searchInput');
  if (search) search.addEventListener('input', e => { searchTerm = e.target.value.trim(); currentPage = 1; render(); });
}

/* ---- Record navigation strip (each page defines navRecord/loadRow) ---- */
function updateRecordNav() {
  const btns = document.querySelector('.nav-record-btns');
  if (!btns) return;
  if (editIndex < 0 && !navPersistTimer) { btns.style.display = 'none'; return; }
  btns.style.display = 'inline-flex'; btns.style.alignItems = 'center'; btns.style.gap = '2px';
  const idx = editIndex >= 0 ? editIndex : lastEditedIndex;
  $('#prevRecord').disabled = idx <= 0;
  $('#nextRecord').disabled = idx >= rows.length - 1;
  $('#recordNavInfo').textContent = `${idx + 1} / ${rows.length}`;
}

/* ---- Theme toggle (shared key 'bbs_theme') ---- */
function initTheme(cfg) {
  const root = document.documentElement;
  const icon = document.getElementById('themeIcon');
  const lbl  = document.getElementById('themeLabel');
  const apply = t => {
    root.dataset.theme = t;
    const c = (t === 'light' ? cfg.light : cfg.dark);
    if (icon) icon.textContent = c.icon;
    if (lbl)  lbl.textContent  = c.label;
  };
  apply(localStorage.getItem('bbs_theme') || 'light');
  const btn = document.getElementById('themeToggle');
  if (btn) btn.addEventListener('click', () => {
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';
    apply(next); localStorage.setItem('bbs_theme', next);
  });
}

/* ---- Drag-and-drop row reorder (tr.dataset.index = original rows[] index) ---- */
function initDragReorder() {
  const tbody = $('#tbody');
  if (!tbody) return;
  let dragged = null;
  tbody.addEventListener('dragstart', e => { dragged = e.target.closest('tr'); if (dragged) { e.dataTransfer.effectAllowed = 'move'; dragged.classList.add('dragging'); } });
  tbody.addEventListener('dragenter', e => { e.preventDefault(); const t = e.target.closest('tr'); if (t && t !== dragged) t.classList.add('drag-over'); });
  tbody.addEventListener('dragleave', e => { const t = e.target.closest('tr'); if (t) t.classList.remove('drag-over'); });
  tbody.addEventListener('dragover',  e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
  tbody.addEventListener('drop', e => {
    e.preventDefault();
    const drop = e.target.closest('tr');
    if (dragged && drop && dragged !== drop) {
      const oi = parseInt(dragged.dataset.index), di = parseInt(drop.dataset.index);
      let ni = oi < di ? di + 1 : di;
      const [rm] = rows.splice(oi, 1);
      if (oi < ni) ni--;
      rows.splice(ni, 0, rm);
      persist(); render();
    }
  });
  tbody.addEventListener('dragend', () => {
    if (dragged) dragged.classList.remove('dragging');
    document.querySelectorAll('#tbody .drag-over').forEach(el => el.classList.remove('drag-over'));
    dragged = null;
  });
}

/* ---- Keyboard shortcuts (Alt+I/S/H, Esc reset, Enter submit) ---- */
function initShortcuts(formSel) {
  document.addEventListener('keydown', e => {
    if (e.altKey && e.key === 'i') { e.preventDefault(); document.getElementById('btnInfo').click(); }
    if (e.altKey && e.key === 's') { e.preventDefault(); document.getElementById('btnSettings').click(); }
    if (e.altKey && e.key === 'h') { e.preventDefault(); document.getElementById('btnHelp').click(); }
    const form = document.querySelector(formSel);
    if (e.key === 'Escape' && form && form.contains(document.activeElement)) document.getElementById('reset').click();
  });
  const form = document.querySelector(formSel);
  if (form) form.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'submit') { e.preventDefault(); form.requestSubmit(); }
  });
}

/* ---- Wire all shared chrome. Call once from each page's init, after that
       page has defined render/persist/rows/navRecord/resetSettings. ---- */
function initCommonChrome(opts) {
  opts = opts || {};
  const on = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); };
  // Info panel
  on('#btnInfo', () => { $('#infoPanel').classList.toggle('collapsed'); $('#settingsPanel').classList.add('collapsed'); });
  on('#saveInfo', () => { readInfoFromForm(); saveInfoToStorage(); updatePrintMeta(); alert('Project info saved.'); });
  on('#clearInfo', () => { projectInfo = Object.assign({}, INFO_DEFAULTS); applyInfoToForm(); saveInfoToStorage(); updatePrintMeta(); });
  // Settings panel toggle + help + reset + clear storage
  on('#btnSettings', () => { const open = !$('#settingsPanel').classList.contains('collapsed'); $('#infoPanel').classList.add('collapsed'); $('#settingsPanel').classList.toggle('collapsed', open); });
  on('#btnHelp', () => document.getElementById('helpDlg').showModal());
  on('#resetSettings', () => { resetSettings(); alert('Settings reset to defaults.'); });
  on('#clearStorage', async () => {
    if (!confirm('Erase ALL saved data — schedule, project info, settings and theme — and reset everything to defaults?\n\nThis cannot be undone.')) return;
    await AppDB.clear();
    localStorage.removeItem('bbs_theme');
    location.reload();
  });
  on('#regenSketches', () => {
    let n = 0;
    for (const r of rows) {
      if (r.shapeHist && window.ShapeDrawer && ShapeDrawer.buildVectorModelFrom) {
        // shapeHist is the source of truth — always rederive shapeVec from it.
        // Edit shapeHist entries (size, label, etc.) in the JSON to change output.
        const fresh = ShapeDrawer.buildVectorModelFrom(r.shapeHist);
        if (fresh) { r.shapeVec = fresh; n++; }
      } else if (r.shapeVec && window.ShapeVector && ShapeVector.tightenViewBox) {
        // No history available — at least fix an oversized viewBox in place.
        r.shapeVec = ShapeVector.tightenViewBox(r.shapeVec); n++;
      }
    }
    persist(); render();
    if (n === 0) alert('No sketches found to regenerate.');
    else alert(`Regenerated ${n} sketch${n !== 1 ? 'es' : ''}.`);
  });
  // Close any open options menu on outside click
  document.addEventListener('click', e => { if (!e.target.closest('.options-menu') && !e.target.closest('.options-btn')) closeOptionsMenus(); });
  // Record navigation buttons
  on('#prevRecord', () => navRecord(-1));
  on('#nextRecord', () => navRecord(+1));
  // Theme, shortcuts, drag-reorder, pagination
  initTheme(opts.theme || { light: { icon: '🔩', label: 'Rust' }, dark: { icon: '⚙️', label: 'Steel' } });
  initShortcuts(opts.formSelector || '#barForm');
  initDragReorder();
  initPagination(opts.pageSizes);
  initToolbarMenus();
}
