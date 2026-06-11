/* =====================================================================
   ShapeVector — render a compact vector model to SVG or into a jsPDF doc.

   The model is geometry-only (no raster), so it is tiny in localStorage and
   stays crisp at any zoom / print resolution. It is produced by the shape
   drawer (see ShapeDrawer.buildVectorModel) and consumed here.

   Model shape:
     { vb:[x,y,w,h],            // source-pixel bounding box (the viewBox)
       el:[ primitive, ... ] }  // painter-order list

   Primitives (coords are in the same source-pixel space as vb):
     { k:'path', d:[[x,y]...], cl, col, lw }          stroked polyline
     { k:'bez',  m:[x,y], s:[[c1x,c1y,c2x,c2y,ex,ey]...], cl, col, lw }
     { k:'rect', x,y,w,h, col, lw }
     { k:'ell',  cx,cy,rx,ry, col, lw }
     { k:'line', a:[x,y], b:[x,y], col, lw, dash }
     { k:'fill', d:[[x,y]...], col }                  filled polygon (arrows / label bg)
     { k:'text', x,y, t, sz, ang, col, anchor:'c'|'l' }
   ===================================================================== */
(function () {
  'use strict';

  const BAR_COL = '#1f1f1f';
  const DIM_COL = '#555';

  const num = (n) => (Math.round(n * 100) / 100);

  /* ── SVG ── */
  function toSVG(model) {
    if (!model || !model.vb || !model.el) return '';
    const [vx, vy, vw, vh] = model.vb;
    const parts = [];
    for (const e of model.el) {
      const col = e.col || (e.k === 'fill' ? DIM_COL : BAR_COL);
      const lw  = e.lw != null ? e.lw : 1.4;
      const cap = 'stroke-linecap="round" stroke-linejoin="round"';
      const dash = e.dash ? ' stroke-dasharray="4 3"' : '';
      switch (e.k) {
        case 'path': {
          if (!e.d || !e.d.length) break;
          const d = 'M' + e.d.map(p => `${num(p[0])},${num(p[1])}`).join(' L') + (e.cl ? ' Z' : '');
          parts.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width="${lw}" ${cap}/>`);
          break;
        }
        case 'bez': {
          let d = `M${num(e.m[0])},${num(e.m[1])}`;
          for (const s of e.s) d += ` C${num(s[0])},${num(s[1])} ${num(s[2])},${num(s[3])} ${num(s[4])},${num(s[5])}`;
          if (e.cl) d += ' Z';
          parts.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width="${lw}" ${cap}/>`);
          break;
        }
        case 'rect':
          parts.push(`<rect x="${num(e.x)}" y="${num(e.y)}" width="${num(e.w)}" height="${num(e.h)}" fill="none" stroke="${col}" stroke-width="${lw}" ${cap}/>`);
          break;
        case 'ell':
          parts.push(`<ellipse cx="${num(e.cx)}" cy="${num(e.cy)}" rx="${num(e.rx)}" ry="${num(e.ry)}" fill="none" stroke="${col}" stroke-width="${lw}"/>`);
          break;
        case 'line':
          parts.push(`<line x1="${num(e.a[0])}" y1="${num(e.a[1])}" x2="${num(e.b[0])}" y2="${num(e.b[1])}" stroke="${col}" stroke-width="${lw}"${dash} stroke-linecap="round"/>`);
          break;
        case 'fill': {
          if (!e.d || !e.d.length) break;
          const pts = e.d.map(p => `${num(p[0])},${num(p[1])}`).join(' ');
          parts.push(`<polygon points="${pts}" fill="${col}" stroke="none"/>`);
          break;
        }
        case 'text': {
          const anchor = e.anchor === 'l' ? 'start' : 'middle';
          const rot = e.ang ? ` transform="rotate(${num(e.ang * 180 / Math.PI)} ${num(e.x)} ${num(e.y)})"` : '';
          parts.push(`<text x="${num(e.x)}" y="${num(e.y)}" fill="${e.col || DIM_COL}" font-family='ui-monospace,Consolas,"Courier New",monospace' font-weight="700" font-size="${num(e.sz || 11)}" text-anchor="${anchor}" dominant-baseline="middle"${rot}>${escapeXML(e.t || '')}</text>`);
          break;
        }
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(vx)} ${num(vy)} ${num(vw)} ${num(vh)}" width="${num(vw)}" height="${num(vh)}" preserveAspectRatio="xMidYMid meet">${parts.join('')}</svg>`;
  }

  function escapeXML(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* Data-URL form for <img src> — keep it readable (no base64) so it compresses well. */
  function toDataURL(model) {
    const svg = toSVG(model);
    return svg ? 'data:image/svg+xml,' + encodeURIComponent(svg) : '';
  }

  /* ── jsPDF (vector) ──
     Draws the model into `pdf` fitted inside the box (X,Y,W,H) in mm,
     preserving aspect ratio and centring. */
  const MM_PER_PT = 0.352777778;

  function toPdf(pdf, model, X, Y, W, H) {
    if (!model || !model.vb || !model.el) return;
    const [vx, vy, vw, vh] = model.vb;
    if (vw <= 0 || vh <= 0) return;
    const scale = Math.min(W / vw, H / vh);
    const ox = X + (W - vw * scale) / 2 - vx * scale;
    const oy = Y + (H - vh * scale) / 2 - vy * scale;
    // Round caps/joins — bars (and ribs) are drawn round, like the on-screen look.
    if (pdf.setLineCap)  pdf.setLineCap('round');
    if (pdf.setLineJoin) pdf.setLineJoin('round');
    const mx = x => ox + x * scale;
    const my = y => oy + y * scale;
    const mlw = lw => Math.max(0.15, (lw != null ? lw : 1.4) * scale);

    const hex = c => {
      let s = (c || '').replace('#', '');
      if (s.length === 3) s = s[0]+s[0] + s[1]+s[1] + s[2]+s[2];   // expand #fff → #ffffff
      const m = /^([0-9a-f]{6})$/i.exec(s);
      if (!m) return [31, 31, 31];
      const n = parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };

    for (const e of model.el) {
      const col = e.col || (e.k === 'fill' ? DIM_COL : BAR_COL);
      const [r, g, b] = hex(col);
      pdf.setLineWidth(mlw(e.lw));
      pdf.setDrawColor(r, g, b);
      pdf.setFillColor(r, g, b);
      if (e.dash) pdf.setLineDashPattern([1.2, 0.9], 0); else pdf.setLineDashPattern([], 0);

      switch (e.k) {
        case 'path': {
          if (!e.d || e.d.length < 2) break;
          const deltas = [];
          for (let i = 1; i < e.d.length; i++)
            deltas.push([mx(e.d[i][0]) - mx(e.d[i - 1][0]), my(e.d[i][1]) - my(e.d[i - 1][1])]);
          pdf.lines(deltas, mx(e.d[0][0]), my(e.d[0][1]), [1, 1], 'S', !!e.cl);
          break;
        }
        case 'bez': {
          let px = e.m[0], py = e.m[1];
          const segs = [];
          for (const s of e.s) {
            segs.push([
              mx(s[0]) - mx(px), my(s[1]) - my(py),
              mx(s[2]) - mx(px), my(s[3]) - my(py),
              mx(s[4]) - mx(px), my(s[5]) - my(py),
            ]);
            px = s[4]; py = s[5];
          }
          pdf.lines(segs, mx(e.m[0]), my(e.m[1]), [1, 1], 'S', !!e.cl);
          break;
        }
        case 'rect':
          pdf.rect(mx(e.x), my(e.y), e.w * scale, e.h * scale, 'S');
          break;
        case 'ell':
          pdf.ellipse(mx(e.cx), my(e.cy), e.rx * scale, e.ry * scale, 'S');
          break;
        case 'line':
          pdf.line(mx(e.a[0]), my(e.a[1]), mx(e.b[0]), my(e.b[1]));
          break;
        case 'fill': {
          if (!e.d || e.d.length < 2) break;
          const deltas = [];
          for (let i = 1; i < e.d.length; i++)
            deltas.push([mx(e.d[i][0]) - mx(e.d[i - 1][0]), my(e.d[i][1]) - my(e.d[i - 1][1])]);
          pdf.lines(deltas, mx(e.d[0][0]), my(e.d[0][1]), [1, 1], 'F', true);
          break;
        }
        case 'text': {
          // Scale the font proportionally with the rest of the drawing so the
          // label stays matched to its (also-scaled) white knockout box, offset
          // and dim geometry. A hard minimum (e.g. 3pt) breaks that proportion
          // on heavily-fitted sketches — the clamped text overflows its box and
          // looks off-centre/"pushed around". Keep only a tiny floor so the size
          // never hits 0.
          const pt = Math.max(0.5, (e.sz || 11) * scale / MM_PER_PT);
          pdf.setFontSize(pt);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(r, g, b);
          const cx = mx(e.x), cy = my(e.y);            // intended label centre
          const rot = e.ang || 0;
          if (e.anchor === 'l') {
            // Leader text: left-aligned, never rotated.
            pdf.text(String(e.t || ''), cx, cy, { baseline: 'middle', align: 'left' });
          } else if (Math.abs(Math.sin(rot)) < 1e-6) {
            // Horizontal centred label — jsPDF handles this correctly.
            pdf.text(String(e.t || ''), cx, cy, { baseline: 'middle', align: 'center' });
          } else {
            // Rotated centred label. jsPDF applies `align` along page-X and
            // `baseline` along page-Y irrespective of `angle`, so rotated (worst
            // near-vertical) labels slide off-centre on BOTH axes. Place the
            // alphabetic-baseline origin ourselves so the glyph block's visual
            // centre lands on (cx,cy) at any angle, matching the on-canvas label.
            const w = pdf.getTextWidth(String(e.t || ''));        // advance width, mm
            const vMid = 0.35 * pt * MM_PER_PT;                    // baseline → visual middle
            const dx = Math.cos(rot), dy = Math.sin(rot);          // reading direction
            const ux = Math.sin(rot), uy = -Math.cos(rot);         // glyph-top (perp) direction
            const ox = cx - (w / 2) * dx - vMid * ux;
            const oy = cy - (w / 2) * dy - vMid * uy;
            pdf.text(String(e.t || ''), ox, oy, { align: 'left', angle: -rot * 180 / Math.PI });
          }
          break;
        }
      }
    }
    pdf.setLineDashPattern([], 0);
    pdf.setTextColor(0, 0, 0);
  }

  /* ── Raster downscale (for uploaded JPG/PNG that can't be vectorized) ──
     Caps the longest side and re-encodes to keep file size down.
     Returns a Promise<dataURL>. SVG uploads are returned unchanged. */
  function downscale(dataUrl, maxSide = 640, quality = 0.82) {
    return new Promise((resolve) => {
      if (!dataUrl || /^data:image\/svg\+xml/i.test(dataUrl)) { resolve(dataUrl); return; }
      const img = new Image();
      img.onload = () => {
        const longest = Math.max(img.width, img.height);
        const k = longest > maxSide ? maxSide / longest : 1;
        const w = Math.max(1, Math.round(img.width * k));
        const h = Math.max(1, Math.round(img.height * k));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        // PNGs may have transparency; flatten onto white so JPEG re-encode is clean.
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        try { resolve(cv.toDataURL('image/jpeg', quality)); }
        catch { resolve(dataUrl); }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  window.ShapeVector = { toSVG, toDataURL, toPdf, downscale };
})();
