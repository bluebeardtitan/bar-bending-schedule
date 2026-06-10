/* =========================
   Common utilities shared between BBS and CFS pages
   ========================= */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const fmt3 = n => (Math.round(n * 1000) / 1000).toFixed(3);
const fmt0 = n => Math.round(n).toString();

function escapeHTML(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function closeOptionsMenus() {
  document.querySelectorAll('.options-menu.open').forEach(m => m.classList.remove('open'));
}

function buildExportJSON(data) {
  const indent = (s, pad) => s.replace(/\n/g, '\n' + pad);
  const parts = [];
  for (const [k, v] of Object.entries(data)) {
    if (k === 'rows' && Array.isArray(v)) {
      const items = v.map(r => '    ' + JSON.stringify(r));
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
