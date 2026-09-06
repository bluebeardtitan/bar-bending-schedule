/* =========================================================
   Shape Drawer — Konva-powered rebar renderer
   ========================================================= */

const REBAR_STYLES = [
  { id:'tor',        label:'⟋ TOR / Diagonal Rib', ribAngle:-40, ribSpacing:22, ribWidth:0.35, alternate:false },
  { id:'horizontal', label:'⊟ Horizontal Rib',      ribAngle:90,  ribSpacing:18, ribWidth:0.25, alternate:false },
  { id:'cross',      label:'✕ Cross Rib',            ribAngle:-40, ribSpacing:20, ribWidth:0.30, alternate:true  },
  { id:'plain',      label:'▬ Plain / MS Bar',       ribAngle:0,   ribSpacing:0,  ribWidth:0,    alternate:false },
  /* No-texture: draw a flat single-weight centreline instead of the 3D ribbed
     rebar body — for member outlines, section profiles, leader lines etc. */
  { id:'none',       label:'╱ Line · No Texture',    ribAngle:0,   ribSpacing:0,  ribWidth:0,    alternate:false, line:true },
];

/* Stroke width used when drawing in the flat "no texture" line style. */
function plainLineWidth(diam) { return Math.max(1.5, (diam || 14) * 0.18); }

const GRAY = {
  body:  '#000000',
  hi:    '#ffffff',
  edge:  '#000000',
  rib:   '#000000',
  ribHi: '#ffffff',
  dim:   '#000000',
  bg:    '#ffffff',
};

/* =====================================================
   KONVA STAGE
   ===================================================== */
let _konvaStage = null;
let _konvaLayer = null;

function getKonvaLayer() { return _konvaLayer; }

function initKonvaStage(containerEl, width, height) {
  if (typeof Konva === 'undefined') throw new Error('Konva not loaded — check bbs/lib/konva.min.js script tag.');
  if (_konvaStage) { _konvaStage.destroy(); _konvaStage = null; _konvaLayer = null; _gridLayer = null; }
  _konvaStage = new Konva.Stage({ container: containerEl, width, height });
  _konvaLayer = new Konva.Layer();
  _konvaStage.add(_konvaLayer);
  return _konvaLayer;
}

/* =====================================================
   FILLET GEOMETRY — works for any segment angles.
   Straight segments joined by a precise circular arc
   fillet at every interior corner, using arcTo.
   Radius = FILLET_FACTOR × diameter, clamped to half
   of the shorter adjacent segment.
   Returns { path: Path2D, samples: [{x,y}] }
   ===================================================== */
const FILLET_FACTOR = 2.0;   // same for both rebar-path and ortho-bar

function buildFilletGeometry(points, diam, closed) {
  const STEP = 2;
  const n    = points.length;
  if (n < 2) return { path: new Path2D(), samples: [] };

  const R      = Math.max(4, (diam || 16) * FILLET_FACTOR);
  const path   = new Path2D();
  const samples = [];   // each element: { x, y, ux, uy }  — tangent baked in

  const pts    = closed ? [...points, points[0]] : points;
  const segLen = [];
  for (let i = 0; i < pts.length - 1; i++)
    segLen.push(Math.hypot(pts[i+1].x - pts[i].x, pts[i+1].y - pts[i].y));

  /* emit samples along a straight segment; tangent is constant = (ux,uy) */
  function sampleLine(x0, y0, x1, y1, ux, uy) {
    const d = Math.hypot(x1-x0, y1-y0);
    if (d < 0.001) return;
    const steps = Math.max(1, Math.ceil(d / STEP));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      samples.push({ x: x0+(x1-x0)*t, y: y0+(y1-y0)*t, ux, uy });
    }
  }

  /* emit samples along a circular arc; tangent = perp to radius at each point */
  function sampleArc(cx, cy, r, a0, a1, ccw) {
    let sweep = a1 - a0;
    while (sweep >  Math.PI) sweep -= 2*Math.PI;
    while (sweep < -Math.PI) sweep += 2*Math.PI;
    if (Math.abs(sweep) < 1e-4) return;
    const steps = Math.max(4, Math.ceil(r * Math.abs(sweep) / STEP));
    for (let s = 1; s <= steps; s++) {
      const a  = a0 + sweep * (s / steps);
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      /* tangent = radius rotated 90° in direction of travel */
      const sign = sweep > 0 ? 1 : -1;
      samples.push({ x: px, y: py, ux: -Math.sin(a)*sign, uy: Math.cos(a)*sign });
    }
  }

  path.moveTo(pts[0].x, pts[0].y);
  /* first sample tangent: direction of first segment */
  const d0 = segLen[0] || 1;
  samples.push({
    x: pts[0].x, y: pts[0].y,
    ux: (pts[1].x - pts[0].x) / d0,
    uy: (pts[1].y - pts[0].y) / d0,
  });
  let curX = pts[0].x, curY = pts[0].y;
  const total = pts.length - 1;

  for (let i = 0; i < total; i++) {
    const P1 = pts[i + 1];
    const d1 = segLen[i];
    const u1x = (P1.x - pts[i].x) / d1, u1y = (P1.y - pts[i].y) / d1;

    if (i === total - 1 && !closed) {
      path.lineTo(P1.x, P1.y);
      sampleLine(curX, curY, P1.x, P1.y, u1x, u1y);
      break;
    }

    const P2  = (closed && i === total - 1) ? pts[1] : pts[i + 2];
    /* When closing, the segment that follows P1 wraps back to pts[1], whose
       length is segLen[0] — segLen[i+1] would be out of bounds (undefined→NaN). */
    const d2  = (closed && i === total - 1) ? segLen[0] : segLen[i+1];
    const u2x = (P2.x - P1.x) / d2, u2y = (P2.y - P1.y) / d2;

    const dot   = u1x * u2x + u1y * u2y;
    const cross = u1x * u2y - u1y * u2x;

    /* deflection angle (how much direction turns), 0..π */
    const defl = Math.atan2(Math.abs(cross), dot);
    if (defl < 1e-3) {
      /* collinear — no fillet */
      path.lineTo(P1.x, P1.y);
      sampleLine(curX, curY, P1.x, P1.y, u1x, u1y);
      curX = P1.x; curY = P1.y;
      continue;
    }

    /* tangent distance from the corner = R·tan(defl/2).
       Exact for any angle (reduces to R for a 90° turn). */
    const halfTan = Math.tan(defl / 2);
    let R2    = R;
    let tDist = R2 * halfTan;
    const maxT = Math.min(segLen[i], (closed && i === total - 1) ? segLen[0] : segLen[i+1]) / 2;
    if (tDist > maxT) { tDist = maxT; R2 = tDist / halfTan; }

    const T1 = { x: P1.x - u1x * tDist, y: P1.y - u1y * tDist };
    const T2 = { x: P1.x + u2x * tDist, y: P1.y + u2y * tDist };

    /* arc centre: inward normal to incoming segment, distance R2 */
    const sign = cross > 0 ? 1 : -1;
    const acx  = T1.x + sign * (-u1y) * R2;
    const acy  = T1.y + sign * ( u1x) * R2;
    const a0   = Math.atan2(T1.y - acy, T1.x - acx);
    const a1   = Math.atan2(T2.y - acy, T2.x - acx);

    path.lineTo(T1.x, T1.y);
    sampleLine(curX, curY, T1.x, T1.y, u1x, u1y);

    path.arcTo(P1.x, P1.y, P2.x, P2.y, R2);
    sampleArc(acx, acy, R2, a0, a1);

    curX = T2.x; curY = T2.y;
  }

  if (closed) path.closePath();
  return { path, samples };
}

/* =====================================================
   SPLINE GEOMETRY — Catmull-Rom for free-form 'curve'
   style only. Returns { path: Path2D, samples }.
   ===================================================== */
function buildSplineGeometry(points, closed) {
  const STEP    = 2;
  const TENSION = 0.4;
  const T       = TENSION * 0.5; // Konva internal scaling
  const n       = points.length;
  if (n < 2) return { path: new Path2D(), samples: [] };

  const pts = closed
    ? [...points, points[0], points[1]]
    : [points[0], ...points, points[n-1]];
  const segCount = closed ? n : n - 1;

  const path    = new Path2D();
  const p0next = pts[1] || pts[0];
  const _stx = p0next.x - pts[0].x, _sty = p0next.y - pts[0].y;
  const _stl = Math.hypot(_stx, _sty) || 1;
  const samples = [{ x: points[0].x, y: points[0].y, ux: _stx/_stl, uy: _sty/_stl }];
  path.moveTo(points[0].x, points[0].y);

  for (let i = 0; i < segCount; i++) {
    const P0=pts[i], P1=pts[i+1], P2=pts[i+2], P3=pts[i+3]||pts[i+2];
    const cp1 = { x: P1.x + T*(P2.x-P0.x), y: P1.y + T*(P2.y-P0.y) };
    const cp2 = { x: P2.x - T*(P3.x-P1.x), y: P2.y - T*(P3.y-P1.y) };
    path.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, P2.x, P2.y);
    const steps = Math.max(12, Math.ceil(Math.hypot(P2.x-P1.x, P2.y-P1.y) / STEP));
    for (let s = 1; s <= steps; s++) {
      const t=s/steps, mt=1-t;
      const bx = mt*mt*mt*P1.x + 3*mt*mt*t*cp1.x + 3*mt*t*t*cp2.x + t*t*t*P2.x;
      const by = mt*mt*mt*P1.y + 3*mt*mt*t*cp1.y + 3*mt*t*t*cp2.y + t*t*t*P2.y;
      /* cubic Bézier tangent (derivative) */
      const dtx = 3*mt*mt*(cp1.x-P1.x) + 6*mt*t*(cp2.x-cp1.x) + 3*t*t*(P2.x-cp2.x);
      const dty = 3*mt*mt*(cp1.y-P1.y) + 6*mt*t*(cp2.y-cp1.y) + 3*t*t*(P2.y-cp2.y);
      const tlen = Math.hypot(dtx, dty);
      samples.push({
        x: bx, y: by,
        ux: tlen > 0.001 ? dtx/tlen : 1,
        uy: tlen > 0.001 ? dty/tlen : 0,
      });
    }
  }
  if (closed) path.closePath();
  return { path, samples };
}

/* =====================================================
   SHARED REBAR STROKE — layers body/highlight/ribs/outline
   onto any { path, samples } geometry, canvas2d context.
   ===================================================== */
function strokeRebarPath(ctx, path, samples, diam, cfg) {
  const d = diam;
  ctx.save();
  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';

  /* No-texture style: a single flat centreline stroke (no 3D body / ribs). */
  if (cfg && cfg.line) {
    ctx.strokeStyle = GRAY.body;
    ctx.lineWidth   = plainLineWidth(d);
    ctx.stroke(path);
    ctx.restore();
    return;
  }

  ctx.strokeStyle = GRAY.body; ctx.lineWidth = d; ctx.stroke(path);

  /* Highlight + shadow only for textured styles with visible ribs */
  if (cfg.ribSpacing > 0) {
    ctx.strokeStyle   = GRAY.hi; ctx.lineWidth = d * 0.28;
    ctx.shadowColor   = GRAY.hi; ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = -d * 0.32; ctx.shadowBlur = 0;
    ctx.stroke(path);
    ctx.shadowColor = 'transparent'; ctx.shadowOffsetY = 0;
  }

  if (cfg.ribSpacing > 0 && d >= 5) drawRibsAlongSamples(ctx, samples, d, cfg);

  ctx.strokeStyle = GRAY.edge; ctx.lineWidth = 0.8; ctx.stroke(path);
  ctx.restore();
}

/* =====================================================
   KONVA REBAR GROUP
   style: 'bend' | 'straight' → fillet geometry
          'curve'              → spline geometry
   ===================================================== */
function makeRebarGroup(points, diam, style, closed) {
  const d       = diam || 14;
  const styleId = window._drawerActiveStyle || 'tor';
  const cfg     = REBAR_STYLES.find(s => s.id === styleId) || REBAR_STYLES[0];

  const geom = (style === 'curve')
    ? buildSplineGeometry(points, closed)
    : buildFilletGeometry(points, d, closed);

  const group = new Konva.Group();
  group.add(new Konva.Shape({
    sceneFunc(ctx) { strokeRebarPath(ctx._context || ctx, geom.path, geom.samples, d, cfg); },
    listening: false,
  }));
  return group;
}

/* =====================================================
   ORTHO SNAP HELPER
   ===================================================== */
function orthoSnap(pt, anchor) {
  if (!anchor) return pt;
  const dx = Math.abs(pt.x - anchor.x);
  const dy = Math.abs(pt.y - anchor.y);
  if (dx >= dy) return { x: pt.x, y: anchor.y };
  return            { x: anchor.x, y: pt.y };
}

/* =====================================================
   ORTHO GEOMETRY — exact straight H/V segments joined
   by precise circular arc fillets at every interior corner.
   Fillet radius in px (0 = sharp corners), clamped so it
   never exceeds half of either adjacent segment length.
   Returns { path: Path2D, samples }.
   ===================================================== */
function buildOrthoGeometry(points, diam, filletR) {
  const STEP = 2;
  const n    = points.length;
  if (n < 2) return { path: new Path2D(), samples: [] };

  const R    = Math.max(0, filletR !== undefined ? filletR : _orthoFillet);
  const path = new Path2D();
  const samples = [];

  /* Detect closed path: first ≈ last point → compute fillet at junction */
  const _isClosed = n > 2 && Math.hypot(points[0].x - points[n-1].x, points[0].y - points[n-1].y) < 0.001;

  /* segment lengths for radius clamping */
  const segLen = [];
  for (let i = 0; i < n - 1; i++)
    segLen.push(Math.hypot(points[i+1].x - points[i].x, points[i+1].y - points[i].y));

  function sampleLineTo(x0, y0, x1, y1, ux, uy) {
    const d = Math.hypot(x1-x0, y1-y0);
    if (d < 0.001) return;
    const steps = Math.max(1, Math.ceil(d / STEP));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      samples.push({ x: x0 + (x1-x0)*t, y: y0 + (y1-y0)*t, ux, uy });
    }
  }

  function sampleArcTo(cx, cy, r, a0, a1) {
    let sweep = a1 - a0;
    while (sweep >  Math.PI) sweep -= Math.PI * 2;
    while (sweep < -Math.PI) sweep += Math.PI * 2;
    if (Math.abs(sweep) < 1e-4) return;
    const steps = Math.max(4, Math.ceil(r * Math.abs(sweep) / STEP));
    const sign  = sweep > 0 ? 1 : -1;
    for (let s = 1; s <= steps; s++) {
      const a = a0 + sweep * (s / steps);
      samples.push({
        x: cx + Math.cos(a)*r, y: cy + Math.sin(a)*r,
        ux: -Math.sin(a)*sign, uy:  Math.cos(a)*sign,
      });
    }
  }

  path.moveTo(points[0].x, points[0].y);
  const _sd0 = segLen[0] || 1;
  samples.push({
    x: points[0].x, y: points[0].y,
    ux: (points[1].x - points[0].x) / _sd0,
    uy: (points[1].y - points[0].y) / _sd0,
  });
  let curX = points[0].x, curY = points[0].y;

  for (let i = 0; i < n - 1; i++) {
    const P0  = points[i];
    const P1  = points[i + 1];
    const d1  = segLen[i];
    if (d1 < 0.001) continue;  // degenerate — skip zero-length segment
    const u1x = (P1.x - P0.x) / d1, u1y = (P1.y - P0.y) / d1;

    if (i === n - 2 && !_isClosed) {
      /* last segment straight to end, no arc after */
      path.lineTo(P1.x, P1.y);
      sampleLineTo(curX, curY, P1.x, P1.y, u1x, u1y);
      break;
    }

    const P2 = (_isClosed && i === n - 2) ? points[1] : points[i + 2];
    /* When closing, the segment that follows P1 wraps back to points[1], whose
       length is segLen[0] — segLen[i+1] would be out of bounds (undefined→NaN). */
    const r  = Math.min(R, segLen[i] / 2, ((_isClosed && i === n - 2) ? segLen[0] : segLen[i+1]) / 2);

    const d2  = (_isClosed && i === n - 2) ? segLen[0] : segLen[i+1];
    const u2x = (P2.x - P1.x) / d2, u2y = (P2.y - P1.y) / d2;
    const T1  = { x: P1.x - u1x * r, y: P1.y - u1y * r };
    const T2  = { x: P1.x + u2x * r, y: P1.y + u2y * r };

    /* arc centre exact for 90deg ortho turns */
    const acx = T1.x + (T2.x - P1.x);
    const acy = T1.y + (T2.y - P1.y);
    const a0  = Math.atan2(T1.y - acy, T1.x - acx);
    const a1  = Math.atan2(T2.y - acy, T2.x - acx);

    path.lineTo(T1.x, T1.y);
    sampleLineTo(curX, curY, T1.x, T1.y, u1x, u1y);

    path.arcTo(P1.x, P1.y, P2.x, P2.y, r);
    sampleArcTo(acx, acy, r, a0, a1);

    curX = T2.x; curY = T2.y;
  }

  return { path, samples };
}

/* =====================================================
   ORTHO REBAR GROUP — renders via Konva.Shape custom
   sceneFunc so the exact Path2D geometry is preserved.
   ===================================================== */
function makeOrthoRebarGroup(points, diam, closed) {
  const d   = diam || 14;
  const pts = closed ? [...points, points[0]] : points;
  const { path, samples } = buildOrthoGeometry(pts, d);

  const styleId = window._drawerActiveStyle || 'tor';
  const cfg     = REBAR_STYLES.find(s => s.id === styleId) || REBAR_STYLES[0];
  const group   = new Konva.Group();

  group.add(new Konva.Shape({
    sceneFunc(ctx) {
      const c = ctx._context || ctx;
      c.save();
      c.lineCap  = 'round';
      c.lineJoin = 'round';

      /* No-texture style: a single flat centreline stroke. */
      if (cfg && cfg.line) {
        c.strokeStyle = GRAY.body;
        c.lineWidth   = plainLineWidth(d);
        c.stroke(path);
        c.restore();
        return;
      }

      /* 1 body */
      c.strokeStyle = GRAY.body;
      c.lineWidth   = d;
      c.stroke(path);

      /* 2 highlight + shadow — only for textured styles with visible ribs */
      if (cfg.ribSpacing > 0) {
        c.strokeStyle   = GRAY.hi;
        c.lineWidth     = d * 0.28;
        c.shadowColor   = GRAY.hi;
        c.shadowOffsetX = 0;
        c.shadowOffsetY = -d * 0.32;
        c.shadowBlur    = 0;
        c.stroke(path);
        c.shadowColor   = 'transparent';
        c.shadowOffsetY = 0;
      }

      /* 3 ribs */
      if (cfg.ribSpacing > 0 && d >= 5) drawRibsAlongSamples(c, samples, d, cfg);

      /* 4 hairline outline */
      c.strokeStyle = GRAY.edge;
      c.lineWidth   = 0.8;
      c.stroke(path);

      c.restore();
    },
    listening: false,
  }));

  return group;
}

/* =====================================================
   RIB RENDERER  (canvas2d context, same as before)
   ===================================================== */
function drawRibsAlongSamples(ctx, samples, diam, cfg) {
  if (samples.length < 2) return;
  const r         = diam / 2;
  const sp        = cfg.ribSpacing * (diam / 16);
  const ribH      = diam * 0.22;
  const ribW      = diam * cfg.ribWidth;
  const ribAngRad = cfg.ribAngle * Math.PI / 180;

  /* tangents are now baked into each sample as {ux, uy} — no smoothing window
     needed, direction is exact at every point including arc/straight junctions */

  let dist = sp * 0.4, ribIndex = 0;
  ctx.save();
  ctx.lineCap = 'round';

  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i-1], curr = samples[i];
    const segLen = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    if (segLen < 0.001) continue;
    dist += segLen;

    while (dist >= sp) {
      dist -= sp;
      const t  = 1 - dist / segLen;
      const px = prev.x + (curr.x - prev.x) * t;
      const py = prev.y + (curr.y - prev.y) * t;

      /* interpolate tangent between the two samples */
      const lerpT = Math.max(0, Math.min(1, t));
      let ux = prev.ux + (curr.ux - prev.ux) * lerpT;
      let uy = prev.uy + (curr.uy - prev.uy) * lerpT;
      const tlen = Math.hypot(ux, uy);
      if (tlen > 0.001) { ux /= tlen; uy /= tlen; } else { ux = 1; uy = 0; }

      const flip    = (cfg.alternate && ribIndex % 2 === 0) ? 1 : -1;
      const rAngle  = Math.atan2(uy, ux) +
        (cfg.ribAngle === 90 ? Math.PI/2 : ribAngRad * flip);
      const rdx     = Math.cos(rAngle), rdy = Math.sin(rAngle);
      const halfLen = r + ribH * 0.6;

      ctx.beginPath();
      ctx.moveTo(px - rdx*halfLen, py - rdy*halfLen);
      ctx.lineTo(px + rdx*halfLen, py + rdy*halfLen);
      ctx.strokeStyle = GRAY.rib;
      ctx.lineWidth   = ribW;
      ctx.stroke();

      const hox = -rdy * ribW * 0.35, hoy = rdx * ribW * 0.35;
      ctx.beginPath();
      ctx.moveTo(px - rdx*halfLen + hox, py - rdy*halfLen + hoy);
      ctx.lineTo(px + rdx*halfLen + hox, py + rdy*halfLen + hoy);
      ctx.strokeStyle = GRAY.ribHi;
      ctx.lineWidth   = ribW * 0.4;
      ctx.stroke();

      ribIndex++;
    }
  }
  ctx.restore();
}

/* =====================================================
   CANVAS2D API  (used by drawShapeDiagram for thumbnails)
   All three share strokeRebarPath — geometry differs.
   ===================================================== */
function _ctx2dCfg() {
  const style = window._drawerActiveStyle || 'none';
  return REBAR_STYLES.find(s => s.id === style) || REBAR_STYLES[0];
}

/* free-form curve: Catmull-Rom spline */
function drawRebarPath(ctx, points, diam, closed) {
  if (!points || points.length < 2) return;
  const d = Math.max(diam || 14, 4);
  const { path, samples } = buildSplineGeometry(points, closed);
  strokeRebarPath(ctx, path, samples, d, _ctx2dCfg());
}

/* bend/ortho: fillet geometry (any angle) */
function drawRebarStraight(ctx, points, diam, closed) {
  if (!points || points.length < 2) return;
  const d   = Math.max(diam || 14, 4);
  const pts = closed ? [...points, points[0]] : points;
  const { path, samples } = buildFilletGeometry(pts, d, false);
  strokeRebarPath(ctx, path, samples, d, _ctx2dCfg());
}

/* plain polyline: no fillet, no spline */
function drawRebarStraightPolyline(ctx, points, diam, closed) {
  if (!points || points.length < 2) return;
  const d    = Math.max(diam || 14, 4);
  const path = new Path2D();
  const pts  = closed ? [...points, points[0]] : points;
  path.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
  /* samples: linear interpolation along segments */
  const STEP = 2;
  const samples = [{ x: pts[0].x, y: pts[0].y }];
  for (let i = 1; i < pts.length; i++) {
    const x0=pts[i-1].x, y0=pts[i-1].y, x1=pts[i].x, y1=pts[i].y;
    const steps = Math.max(1, Math.ceil(Math.hypot(x1-x0, y1-y0) / STEP));
    for (let s = 1; s <= steps; s++) {
      const t = s/steps;
      samples.push({ x: x0+(x1-x0)*t, y: y0+(y1-y0)*t });
    }
  }
  strokeRebarPath(ctx, path, samples, d, _ctx2dCfg());
}

/* =====================================================
   SHAPE DIAGRAM RENDERER  (renders to off-screen canvas
   → PNG thumbnail, same as before — no change needed)
   ===================================================== */
function _shapeRenderer(style) {
  if (style === 'curve')    return (c,p,dd)=>drawRebarPath(c,p,dd,false);
  if (style === 'straight') return (c,p,dd)=>drawRebarStraightPolyline(c,p,dd,false);
  return (c,p,dd)=>drawRebarStraight(c,p,dd,false);
}

function _makeIsoProjector(allWorldPts, cx, cy) {
  const ISO=Math.PI/6, cosI=Math.cos(ISO), sinI=Math.sin(ISO);
  const raw=(x,y,z)=>({ x:(x-z)*cosI, y:-y+(x+z)*sinI });
  const proj=allWorldPts.map(p=>raw(p[0],p[1],p[2]||0));
  const minX=Math.min(...proj.map(p=>p.x)), maxX=Math.max(...proj.map(p=>p.x));
  const minY=Math.min(...proj.map(p=>p.y)), maxY=Math.max(...proj.map(p=>p.y));
  const ox=cx-(minX+maxX)/2, oy=cy-(minY+maxY)/2;
  return (x,y,z)=>{ const p=raw(x,y,z); return { x:ox+p.x, y:oy+p.y }; };
}

function drawShapeDiagram(ctx, shapeName, diam, W, H) {
  const d=Math.max(diam||14,10);
  const cx=W/2, cy=H/2, pad=44;
  const sw=W-pad*2, sh=H-pad*2;

  ctx.clearRect(0,0,W,H);
  ctx.fillStyle=GRAY.bg; ctx.fillRect(0,0,W,H);
  window._drawerActiveStyle = window._drawerActiveStyle || 'none';

  const lib=window.SHAPE_LIB||{};
  const def=lib[shapeName];

  if (!def) {
    drawRebarStraightPolyline(ctx,[{x:pad,y:cy},{x:W-pad,y:cy}],d,false);
    drawDim(ctx,pad,cy-d-12,W-pad,cy-d-12,'A');
    return;
  }

  if (def.generator==='circle') {
    const rr=Math.min(sw,sh)/2-14, pts=[];
    /* ring with a small overlap so the two ends are visible (real tie bar) */
    const gap = 0.12;                       // radians of opening at the top
    const start = -Math.PI/2 + gap/2;
    const end   =  Math.PI*1.5 - gap/2;
    const steps = 84;
    for(let i=0;i<=steps;i++){
      const a = start + (end-start)*(i/steps);
      pts.push({x:cx+Math.cos(a)*rr, y:cy+Math.sin(a)*rr});
    }
    /* small straight hook tails at both ends, bent inward */
    const tail = d*2.2;
    const a0=start, a1=end;
    const h0={x:cx+Math.cos(a0)*rr, y:cy+Math.sin(a0)*rr};
    const h1={x:cx+Math.cos(a1)*rr, y:cy+Math.sin(a1)*rr};
    const ring = pts.slice();
    /* prepend/append inward tails (toward centre) */
    ring.unshift({x:h0.x+(cx-h0.x)/rr*tail, y:h0.y+(cy-h0.y)/rr*tail});
    ring.push({x:h1.x+(cx-h1.x)/rr*tail, y:h1.y+(cy-h1.y)/rr*tail});
    drawRebarPath(ctx, ring, d, false);
    (def.dims||[]).forEach(dm=>drawDim(ctx,cx,cy,cx+rr,cy,dm.label));
    return;
  }
  if (def.generator==='spiral') {
    /* 3D isometric helix — a coil viewed at an angle */
    const turns = def.turns||4;
    const coils = turns;
    const rx    = Math.min(sw,sh)*0.34;     // horizontal radius (ellipse for iso)
    const ry    = rx*0.42;                  // vertical squash (viewing angle)
    const pitch = (sh*0.78)/coils;          // vertical rise per turn
    const segs  = coils*64;
    const topY  = cy - (coils*pitch)/2;
    const pts=[];
    for(let i=0;i<=segs;i++){
      const t=i/segs, a=t*Math.PI*2*coils;
      pts.push({
        x: cx + Math.cos(a)*rx,
        y: topY + t*coils*pitch + Math.sin(a)*ry,
      });
    }
    /* draw with depth cue: back half slightly thinner is overkill; just stroke whole helix */
    ctx.save(); ctx.lineCap='round'; ctx.lineJoin='round';
    const stroke=(col,w,oy)=>{
      ctx.strokeStyle=col; ctx.lineWidth=w;
      if(oy){ctx.shadowOffsetY=oy;ctx.shadowColor=GRAY.hi;ctx.shadowBlur=0;}
      ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
      pts.slice(1).forEach(p=>ctx.lineTo(p.x,p.y)); ctx.stroke();
      ctx.shadowOffsetY=0; ctx.shadowColor='transparent';
    };
    stroke(GRAY.body,d,0); stroke(GRAY.hi,d*0.28,-d*0.3); stroke(GRAY.edge,0.8,0);
    /* top & bottom ellipse guides (dashed) to read it as 3D */
    ctx.setLineDash([4,4]); ctx.strokeStyle='#bbb'; ctx.lineWidth=1;
    [topY, topY+coils*pitch].forEach(yc=>{
      ctx.beginPath();
      for(let i=0;i<=48;i++){const a=i/48*Math.PI*2;
        const x=cx+Math.cos(a)*rx, y=yc+Math.sin(a)*ry;
        i?ctx.lineTo(x,y):ctx.moveTo(x,y);}
      ctx.stroke();
    });
    ctx.setLineDash([]); ctx.restore();
    /* diameter + pitch dims */
    drawDim(ctx, cx-rx, topY, cx+rx, topY, '⌀');
    drawDim(ctx, cx+rx+18, topY, cx+rx+18, topY+pitch, 'p');
    return;
  }

  let mapPt, mapDim;
  if (def.iso) {
    const all=[];
    (def.segments||[]).forEach(s=>s.pts.forEach(p=>all.push(p)));
    (def.dims||[]).forEach(dm=>{ if(dm.iso){all.push(dm.from);all.push(dm.to);} });
    const fit=def.fit||200;
    const scale=Math.min(sw,sh)/(fit*1.6);
    const sAll=all.map(p=>[p[0]*scale,(p[1]||0)*scale,(p[2]||0)*scale]);
    const project=_makeIsoProjector(sAll,cx,cy);
    mapPt =p=>project(p[0]*scale,(p[1]||0)*scale,(p[2]||0)*scale);
    mapDim=p=>project(p[0]*scale,(p[1]||0)*scale,(p[2]||0)*scale);
  } else {
    // Uniform scale + centre so the 0..1 box keeps its aspect ratio on any
    // canvas shape (independent x*sw / y*sh would stretch it to the canvas).
    const u=Math.min(sw,sh);
    mapPt =p=>({ x:cx+(p[0]-0.5)*u, y:cy+(p[1]-0.5)*u });
    mapDim=p=>({ x:cx+(p[0]-0.5)*u, y:cy+(p[1]-0.5)*u });
  }

  (def.segments||[]).forEach(seg=>{
    const pts=seg.pts.map(mapPt);
    if (pts.length<2) return;
    if (seg.closed) drawRebarStraight(ctx,pts,d,true);
    else            _shapeRenderer(seg.style)(ctx,pts,d);
  });

  const dimUnit=Math.min(sw,sh);   // re-expand fractional perp/size lengths
  (def.dims||[]).forEach(dm=>{
    const sizePx = dm.size!=null ? dm.size*dimUnit : undefined;
    if (dm.type==='angular') {
      drawDimAngular(ctx, mapDim(dm.vertex), mapDim(dm.a), mapDim(dm.b), dm.label||'', sizePx);
    } else if (dm.type==='leader') {
      drawDimLeader(ctx, mapDim(dm.origin), mapDim(dm.elbow), dm.text?mapDim(dm.text):null, dm.label||'', sizePx);
    } else if (dm.perp!=null) {
      const a=mapDim(dm.from), b=mapDim(dm.to);
      drawDimAligned(ctx, a, b, dm.perp*dimUnit, dm.label||'', sizePx, dm.pos);
    } else {
      // Legacy hand-authored aligned dim: fixed offset + [dx,dy] label nudge
      const a=mapDim(dm.from), b=mapDim(dm.to);
      const off=dm.off||[0,0];
      drawDim(ctx,a.x+off[0],a.y+off[1],b.x+off[0],b.y+off[1],dm.label);
    }
  });
}

/* =====================================================
   DIMENSION RENDERERS
   Three types: aligned, angular, leader.
   All work on raw canvas2d context (also used via
   Konva.Shape sceneFunc for Konva rendering).
   ===================================================== */

/* Base font size the original dim metrics were tuned at; size params scale from here. */
const DIM_BASE = 11;

/* ── shared helpers ── */
function _dimArrow(ctx, px, py, ax, ay, flip, size) {
  const s = (size || DIM_BASE) / DIM_BASE;
  const aw=9*s, ah=3.5*s;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px - ax*aw*flip + ay*ah*flip, py - ay*aw*flip - ax*ah*flip);
  ctx.lineTo(px - ax*aw*flip - ay*ah*flip, py - ay*aw*flip + ax*ah*flip);
  ctx.closePath(); ctx.fill();
}

function _dimLabel(ctx, mx, my, label, angle, size, pos) {
  const fs = size || DIM_BASE;
  ctx.save();
  ctx.font = `bold ${fs}px ui-monospace,Consolas,monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(label).width + fs*0.7;
  const bh = fs*0.82;   // half background-box height
  // Keep text readable — flip if angle would render upside-down
  const a = ((angle % (Math.PI*2)) + Math.PI*2) % (Math.PI*2);
  const rot = (a > Math.PI/2 && a < Math.PI*1.5) ? angle + Math.PI : angle;
  // Push the label clear of the dimension line along the text's own reading-up
  // direction (sin rot, -cos rot). This keeps a true perpendicular gap at EVERY
  // orientation: the old `my - ny*8` nudge only moved in screen-Y, so a
  // near-vertical line got ~zero offset and the label sat on the line/arrows —
  // which read as the label being knocked off-centre.
  const sgn = pos === 'below' ? -1 : pos === 'above' ? 1 : 0;   // 'on' / undefined → centred
  const gap = sgn * (bh + 2);
  ctx.translate(mx + Math.sin(rot)*gap, my - Math.cos(rot)*gap);
  ctx.rotate(rot);
  ctx.fillStyle = '#fff';
  ctx.fillRect(-tw/2, -bh, tw, bh*2);
  ctx.fillStyle = GRAY.dim;
  ctx.fillText(label, 0, 0);
  ctx.restore();
}

/* ── 1. ALIGNED dimension — true point-to-point distance ──
   Clicks: p1, p2, then offset (perpendicular side).
   Renders: two extension lines + one dimension line with arrows + label. */
function drawDimAligned(ctx, p1, p2, offset, label, size, pos) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 4) return;
  const ax = dx/len, ay = dy/len;   // along dimension line
  const nx = -ay,   ny =  ax;       // perpendicular (normal)

  // offset = signed perpendicular distance from p1–p2 line to dim line
  const off = offset != null ? offset : 30;

  const d1 = { x: p1.x + nx*off, y: p1.y + ny*off };
  const d2 = { x: p2.x + nx*off, y: p2.y + ny*off };

  ctx.save();
  ctx.strokeStyle = GRAY.dim; ctx.fillStyle = GRAY.dim; ctx.lineWidth = 1.2;

  // Extension lines (slightly past the dim line)
  const ext = 6;
  const baseOff = off > 1 ? 3 : 0;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(p1.x + nx*baseOff, p1.y + ny*baseOff);
  ctx.lineTo(d1.x + nx*ext, d1.y + ny*ext);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p2.x + nx*baseOff, p2.y + ny*baseOff);
  ctx.lineTo(d2.x + nx*ext, d2.y + ny*ext);
  ctx.stroke();

  // Dimension line
  ctx.beginPath(); ctx.moveTo(d1.x, d1.y); ctx.lineTo(d2.x, d2.y); ctx.stroke();

  // Arrows
  _dimArrow(ctx, d1.x, d1.y, ax, ay, -1, size);
  _dimArrow(ctx, d2.x, d2.y, ax, ay,  1, size);

  // Label at midpoint, offset above/on/below the dim line (default above)
  const mx = (d1.x+d2.x)/2, my = (d1.y+d2.y)/2;
  const ang = Math.atan2(dy, dx);
  _dimLabel(ctx, mx, my, label, ang, size, pos || 'above');

  ctx.restore();
}

/* ── 2. ANGULAR dimension — angle at a vertex between two arms ──
   Clicks: vertex, arm-A end, arm-B end.
   Renders: arc + two radial lines from vertex + angle label. */
function drawDimAngular(ctx, vertex, ptA, ptB, label, size, pos) {
  const rA = Math.hypot(ptA.x-vertex.x, ptA.y-vertex.y);
  const rB = Math.hypot(ptB.x-vertex.x, ptB.y-vertex.y);
  const r  = Math.min(rA, rB, 60) * 0.72 + 20;  // arc radius

  const aA = Math.atan2(ptA.y-vertex.y, ptA.x-vertex.x);
  const aB = Math.atan2(ptB.y-vertex.y, ptB.x-vertex.x);

  // Sweep the short way
  let sweep = aB - aA;
  while (sweep >  Math.PI) sweep -= Math.PI*2;
  while (sweep < -Math.PI) sweep += Math.PI*2;
  const aEnd = aA + sweep;

  // Angle value in degrees for label (if label is empty/auto)
  const angleDeg = Math.abs(sweep * 180 / Math.PI).toFixed(1) + '°';
  const lbl = label || angleDeg;

  ctx.save();
  ctx.strokeStyle = GRAY.dim; ctx.fillStyle = GRAY.dim; ctx.lineWidth = 1.2;

  // Radial tick lines from vertex to arc edge
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(vertex.x, vertex.y);
  ctx.lineTo(vertex.x + Math.cos(aA)*r*1.25, vertex.y + Math.sin(aA)*r*1.25);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(vertex.x, vertex.y);
  ctx.lineTo(vertex.x + Math.cos(aEnd)*r*1.25, vertex.y + Math.sin(aEnd)*r*1.25);
  ctx.stroke();
  ctx.setLineDash([]);

  // Arc
  ctx.beginPath();
  ctx.arc(vertex.x, vertex.y, r, aA, aEnd, sweep < 0);
  ctx.stroke();

  // Arrow at arc end
  const arrowAng = aEnd + (sweep > 0 ? Math.PI/2 : -Math.PI/2);
  const arrowPx = vertex.x + Math.cos(aEnd)*r;
  const arrowPy = vertex.y + Math.sin(aEnd)*r;
  _dimArrow(ctx, arrowPx, arrowPy, Math.cos(arrowAng), Math.sin(arrowAng), 1, size);

  // Label at arc midpoint
  const aMid = aA + sweep/2;
  _dimLabel(ctx, vertex.x + Math.cos(aMid)*r, vertex.y + Math.sin(aMid)*r, lbl, aMid + Math.PI/2, size, pos || 'on');

  // Vertex dot
  ctx.beginPath(); ctx.arc(vertex.x, vertex.y, 3, 0, Math.PI*2); ctx.fill();

  ctx.restore();
}

/* ── 3. LEADER dimension — annotated leader line ──
   Clicks: origin (arrowhead tip), elbow point, (optional) text anchor.
   Two-segment kinked line ending in a short horizontal text shelf. */
function drawDimLeader(ctx, origin, elbow, textPt, label, size, pos) {
  const lbl = label || 'Label';
  const fs  = size || DIM_BASE;

  ctx.save();
  ctx.strokeStyle = GRAY.dim; ctx.fillStyle = GRAY.dim; ctx.lineWidth = 1.2;
  ctx.setLineDash([]);

  // Shaft: origin → elbow
  ctx.beginPath();
  ctx.moveTo(origin.x, origin.y);
  ctx.lineTo(elbow.x, elbow.y);
  ctx.stroke();

  // Shelf: elbow → textPt (horizontal by convention, but use the actual point)
  if (textPt) {
    ctx.beginPath();
    ctx.moveTo(elbow.x, elbow.y);
    ctx.lineTo(textPt.x, textPt.y);
    ctx.stroke();
  }

  // Arrowhead at origin pointing toward elbow
  const dx = elbow.x - origin.x, dy = elbow.y - origin.y;
  const len = Math.hypot(dx, dy);
  if (len > 4) {
    const ax = dx/len, ay = dy/len;
    _dimArrow(ctx, origin.x, origin.y, ax, ay, -1, size);
  }

  // Label: placed at textPt (or above elbow if no textPt yet)
  const tx = textPt ? textPt.x : elbow.x + 20;
  const ty = textPt ? textPt.y : elbow.y;
  const bh = fs*0.82;   // half background-box height
  const sgn = pos === 'above' ? 1 : pos === 'below' ? -1 : 0;
  const ety = ty - sgn * (bh + 2);  // 'above' shifts up, 'below' shifts down
  ctx.font = `bold ${fs}px ui-monospace,Consolas,monospace`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(lbl).width + fs*0.7;
  ctx.fillStyle = '#fff'; ctx.fillRect(tx + 2, ety - bh, tw, bh*2);
  ctx.fillStyle = GRAY.dim; ctx.fillText(lbl, tx + 6, ety);

  // Shelf line: above=underline below label, on=none, below=aboveline above label
  if (pos === 'below') {
    ctx.beginPath();
    ctx.moveTo(tx + 2, ety - bh); ctx.lineTo(tx + 2 + tw, ety - bh);
    ctx.stroke();
  } else if (pos !== 'on') {
    ctx.beginPath();
    ctx.moveTo(tx + 2, ety + bh); ctx.lineTo(tx + 2 + tw, ety + bh);
    ctx.stroke();
  }

  ctx.restore();
}

/* Legacy wrapper — used by shape library diagram renders (shapes.json dims) */
function drawDim(ctx,x1,y1,x2,y2,label) {
  drawDimAligned(ctx, {x:x1,y:y1}, {x:x2,y:y2}, -28, label||'');
}

/* =====================================================
   MODAL HTML
   ===================================================== */
const drawerHTML = `
<dialog id="shapeDrawerDlg" style="
  background:var(--panel);border:1px solid var(--border);border-radius:18px;
  padding:0;max-width:960px;width:97vw;color:var(--text);
  box-shadow:0 32px 80px rgba(0,0,0,.55);overflow:hidden;
  max-height:96vh
">
<div style="display:flex;flex-direction:column;max-height:96vh">
  <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border);flex-shrink:0">
    <span style="font-weight:800;font-size:15px">🔩 Rebar Shape Drawer</span>
    <div class="space"></div>
    <button id="drawerDone"   class="btn small primary">✔ Use Shape</button>
    <button id="drawerCancel" class="btn small ghost">✕</button>
  </div>
  <div id="drawerRow" style="display:flex;overflow:hidden">

    <!-- ── LEFT SIDEBAR ── -->
    <div id="drawerSidebar" style="width:192px;flex-shrink:0;border-right:1px solid var(--border);padding:11px 10px;display:flex;flex-direction:column;gap:8px;overflow-y:auto;font-size:12px;max-height:calc(96vh - 56px)">

      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;font-weight:700">Tool</div>
      <div class="tool-bar-wrap">
        <div class="tool-action-bar" id="toolBtns" role="toolbar" aria-label="Drawing tools">

          <div class="tool-group" data-group="lib">
            <span class="tg-label">Lib</span>
            <div class="tool-group-rail">
              <button class="drawer-tool" data-tool="shapes" title="Quick Shapes"><span class="t-ico">❖</span><span class="t-lbl">Shapes</span></button>
            </div>
          </div>

          <div class="tool-group" data-group="draw">
            <span class="tg-label">Draw</span>
            <div class="tool-group-rail">
              <button class="drawer-tool" data-tool="rebar-path"  title="Rebar Path"><span class="t-ico">〽</span><span class="t-lbl">Path</span></button>
              <button class="drawer-tool" data-tool="ortho-bar"   title="Ortho Bar"><span class="t-ico">⊢</span><span class="t-lbl">Ortho</span></button>
              <button class="drawer-tool" data-tool="rect"        title="Rectangle"><span class="t-ico">▭</span><span class="t-lbl">Rect</span></button>
              <button class="drawer-tool" data-tool="circle"      title="Circle / Stirrup"><span class="t-ico">◯</span><span class="t-lbl">Circle</span></button>
            </div>
          </div>

          <div class="tool-group" data-group="view">
            <span class="tg-label">View</span>
            <div class="tool-group-rail">
              <button class="drawer-tool" data-tool="texture" title="Rebar Texture"><span class="t-ico">▨</span><span class="t-lbl">Texture</span></button>
              <button class="drawer-tool" data-tool="grid"    title="Snap Grid"><span class="t-ico">▦</span><span class="t-lbl">Grid</span></button>
            </div>
          </div>

          <div class="tool-group" data-group="note">
            <span class="tg-label">Note</span>
            <div class="tool-group-rail">
              <button class="drawer-tool" data-tool="text"        title="Annotation"><span class="t-ico">T</span><span class="t-lbl">Text</span></button>
              <button class="drawer-tool" data-tool="dim-aligned" title="Dimension (aligned)"><span class="t-ico">↔</span><span class="t-lbl">Dim</span></button>
              <button class="drawer-tool" data-tool="dim-angular" title="Angle dimension"><span class="t-ico">∠</span><span class="t-lbl">Angle</span></button>
              <button class="drawer-tool" data-tool="dim-leader"  title="Leader note"><span class="t-ico">↗</span><span class="t-lbl">Leader</span></button>
            </div>
          </div>

          <div class="tool-group" data-group="edit">
            <span class="tg-label">Edit</span>
            <div class="tool-group-rail">
              <button class="drawer-tool" data-tool="edit-points"    title="Edit points"><span class="t-ico">✦</span><span class="t-lbl">Edit</span></button>
              <button class="drawer-tool" data-tool="delete-element" title="Delete element"><span class="t-ico">⌫</span><span class="t-lbl">Delete</span></button>
            </div>
          </div>

        </div>
      </div>

      <!-- ── CONTEXTUAL PANEL · Bar tools (Path / Ortho / Rect / Circle) ──
           Shown by setTool() when a bar-drawing tool is active. -->
      <div class="drawer-panel" id="panel-bar" role="region" aria-label="Bar settings" style="display:none">
        <div class="drawer-panel-title">〽 Bar Settings</div>

        <div class="dp-sub">Bar Diameter</div>
        <div style="display:flex;align-items:center;gap:6px">
          <input type="range" id="drawerBarSize" min="6" max="38" value="16" style="flex:1">
          <span id="drawerBarVal" style="font-size:11px;min-width:22px;color:var(--brand);font-weight:700">16</span>
          <span style="font-size:10px;color:var(--muted)">px</span>
        </div>

        <div class="dp-divider" style="margin:6px 0"></div>
        <div class="dp-sub">Fillet Radius</div>
        <div style="display:flex;align-items:center;gap:6px">
          <input type="range" id="drawerFillet" min="0" max="40" value="6" style="flex:1">
          <span id="drawerFilletVal" style="font-size:11px;min-width:22px;color:var(--brand);font-weight:700">6</span>
          <span style="font-size:10px;color:var(--muted)">px</span>
        </div>
        <div style="font-size:9px;color:var(--muted);margin-top:2px">0 = sharp · <b>F</b> key toggles 0/saved</div>
      </div>

      <!-- ── CONTEXTUAL PANEL · Texture tool ── -->
      <div class="drawer-panel" id="panel-texture" role="region" aria-label="Rebar texture" style="display:none">
        <div class="drawer-panel-title">▨ Rebar Texture</div>
        <div class="rebar-style-grid">
          ${REBAR_STYLES.map(s=>{const [icon,...rest]=s.label.split(' ');return `<button class="rebar-style-btn" data-style="${s.id}" title="${rest.join(' ')}"><span class="rs-ico">${icon}</span><span class="rs-lbl">${rest.join(' ')}</span></button>`;}).join('')}
        </div>
      </div>

      <!-- ── CONTEXTUAL PANEL · Grid tool ── -->
      <div class="drawer-panel" id="panel-grid" role="region" aria-label="Grid settings" style="display:none">
        <div class="drawer-panel-title">▦ Snap Grid</div>
        <button id="drawerGridToggle" class="btn small ghost" style="font-size:12px;text-align:left;padding:8px 10px;width:100%">
          ▦ Show Grid
        </button>
        <div id="drawerGridSpacingRow" style="display:none;flex-direction:column;gap:4px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span class="dp-sub">Spacing</span>
            <span style="font-size:11px;color:var(--brand);font-weight:700"><span id="drawerGridSpacingVal">50</span> px</span>
          </div>
          <input type="range" id="drawerGridSpacing" min="10" max="100" step="5" value="50" style="width:100%;margin:0;display:block">
        </div>
      </div>

      <!-- ── CONTEXTUAL PANEL · Label tools (Text / Dim / Angle / Leader) ──
           Shown by setTool() when a text- or dimension tool is active. -->
      <div class="drawer-panel" id="panel-label" role="region" aria-label="Label settings" style="display:none">
        <div class="drawer-panel-title">T Label Settings</div>

        <div class="dp-sub">Annotation</div>
        <textarea id="drawerAnnotText" placeholder="Label text, then tap canvas…" rows="2"
          style="font-size:11px;resize:none;border-radius:8px;padding:6px"></textarea>
        <div style="display:flex;flex-wrap:wrap;gap:3px">
          ${['A','B','C','D','Ø','90°','135°','Hook','Cover'].map(t=>`<button class="btn small ghost annot-preset" data-text="${t}" style="font-size:10px;padding:2px 5px">${t}</button>`).join('')}
        </div>

        <div class="dp-divider"></div>
        <div class="dp-sub">Font Size</div>
        <div style="display:flex;align-items:center;gap:6px">
          <input type="range" id="drawerFontSize" min="8" max="28" value="13" style="flex:1">
          <span id="drawerFontVal" style="font-size:11px;min-width:18px;color:var(--brand);font-weight:700">13</span>
          <span style="font-size:10px;color:var(--muted)">pt</span>
        </div>

        <div id="drawerLabelPosWrap">
        <div class="dp-divider"></div>
        <div class="dp-sub">Label Position <span style="color:var(--muted);font-weight:400">· aligned dim</span></div>
        <div id="drawerLabelPos" style="display:flex;gap:4px" role="group" aria-label="Aligned dimension label position">
          <button type="button" class="btn small primary lblpos" data-pos="above" style="flex:1;font-size:10px;padding:4px 4px">↑ Above</button>
          <button type="button" class="btn small ghost lblpos"   data-pos="on"    style="flex:1;font-size:10px;padding:4px 4px">— On</button>
          <button type="button" class="btn small ghost lblpos"   data-pos="below" style="flex:1;font-size:10px;padding:4px 4px">↓ Below</button>
        </div>
        </div>
      </div>

      <!-- ── CONTEXTUAL PANEL · Shape library (Shapes tool) ──
           Shown by setTool() when the quick-shapes tool is active. -->
      <div class="drawer-panel" id="panel-quick" role="region" aria-label="Shape library" style="display:none">
        <div class="drawer-panel-title">❖ Shape Library</div>
        <div class="dp-sub" style="display:flex;align-items:center;gap:6px">
          <span style="flex:1">Quick Shapes</span>
          <button id="loadShapesBtn" class="btn small ghost" style="font-size:9px;padding:2px 6px" title="Manually load a shapes.json file">⤓ Load JSON</button>
        </div>
        <div id="quickShapeList" class="quick-shape-grid">
          <span style="font-size:10px;color:var(--muted)">Loading…</span>
        </div>
      </div>
    </div>

    <!-- ── CANVAS AREA ── -->
    <div id="drawerCanvasCol" style="flex:1;display:flex;flex-direction:column;min-width:0;min-height:0">
      <div id="svgCanvasWrap" style="position:relative;overflow:hidden;background:#fff;width:100%">
        <!-- Konva mounts here; id used by initKonvaStage -->
        <div id="konvaContainer" style="width:100%;height:100%"></div>
        <div id="nodeCounter" style="position:absolute;top:8px;left:50%;transform:translateX(-50%);
          background:rgba(34,197,94,.18);border:1px solid rgba(34,197,94,.4);border-radius:20px;
          padding:3px 12px;font-size:11px;color:#22c55e;font-weight:700;pointer-events:none;display:none">
        </div>
        <div style="position:absolute;bottom:7px;right:10px;font-size:10px;color:#bbb;pointer-events:none">
          <span id="canvasHint">Tap to add · double-tap to finish</span>
        </div>
      </div>
      <div id="drawerActions" style="display:flex;gap:6px;padding:8px 12px;border-top:1px solid var(--border);align-items:center;flex-shrink:0;background:var(--panel)">
        <button id="drawerUndo"  class="btn small ghost"        style="font-size:11px">↩ Undo</button>
        <button id="drawerClear" class="btn small ghost danger" style="font-size:11px">🗑 Clear</button>
        <span style="flex:1"></span>
        <button id="drawerExport" class="btn small ghost" style="font-size:11px" title="Export drawn geometry as a shapes.json entry">📐 Export to shapes.json</button>
      </div>
    </div>
  </div>
</div>
</dialog>
`;

/* =====================================================
   STATE & EVENT WIRING
   ===================================================== */
let activeTool  = 'rebar-path';
let activeStyle = 'tor';
let history     = [];
let drawerCallback = null;

let isDrawing      = false;
let livePts        = [];
let mousePos       = null;
let bezierMode     = false;   // current pen mode: true = upcoming segments curve
let segStyles      = [];      // style of each placed segment i (livePts[i]→livePts[i+1]): 'curve' | 'straight'

/* Group a point list + parallel per-segment style array into runs of consecutive
   same-style segments. pts.length === styles.length + 1. Adjacent runs share their
   boundary vertex so curves and straights join seamlessly. */
function splitStyleRuns(pts, styles) {
  const runs = [];
  if (pts.length < 2) return runs;
  let start = 0;
  for (let i = 1; i < styles.length; i++) {
    if (styles[i] !== styles[i-1]) {
      runs.push({ pts: pts.slice(start, i+1), style: styles[i-1] });
      start = i;
    }
  }
  runs.push({ pts: pts.slice(start), style: styles[styles.length-1] });
  return runs;
}

let dragStart   = null;

/* ── Delete-element tool state ── */
let _delHoverIdx = -1;    // history index currently under the cursor (for hover feedback)

/* ── Saved geometry to load on open (set by ShapeDrawer.open via opts.history) ── */
let _pendingHistory = null;

/* ── Dimension tool state (shared across all three dim types) ── */
let dimPhase    = 0;      // which click we're waiting for (0 = idle)
let dimPts      = [];     // accumulated clicks for current dim in progress
let dimOrtho    = false;  // aligned dim: snap 2nd point H/V to the 1st (toggle with O)

/* ── Edit-points mode state ── */
let editDragCmd   = null;   // reference to the history cmd being edited
let editDragIdx   = null;   // index into cmd.points[]
let editDragging  = false;  // mouse is held on a handle
let _stageResizeObserver = null;

/* ── Grid state ── */
let _gridVisible  = false;
let _gridSpacing  = 50;     // px between grid lines (matches the select options)

/* ── Ortho fillet radius ── */
let _orthoFillet       = 6;  // current fillet radius for ortho bars (px), 0 = sharp corners
let _orthoFilletSaved  = 6;  // saved slider value to toggle back to

/* double-click detection (timestamp-based, works for mouse + touch) */
let _lastDownTime = 0;
let _lastDownPt   = null;
const DBL_MS   = 350;   // max ms between clicks to count as double
const DBL_PX   = 12;    // max pixel drift between the two clicks

window._drawerActiveStyle = 'none';

/* ── Konva stage dimensions ── */
let _stageW = 700, _stageH = 460;

function getBarSize()  { return parseInt(document.getElementById('drawerBarSize').value, 10); }
/* Font slider is authored in POINTS (min 8pt). shapeHist stores size in POINTS
   so JSON editing is intuitive. Canvas/Konva renderers need pixels — multiply by
   PT_TO_PX at render call sites.
   CSS reference: 1pt = 1/72in, 1px = 1/96in ⇒ 1pt = 96/72 px. */
const PT_TO_PX = 96 / 72;
/* Default dim label size in pt (≈ DIM_BASE canvas-px / PT_TO_PX). */
const DIM_BASE_PT = 8;
function getFontSize() {
  return parseInt(document.getElementById('drawerFontSize').value, 10) || 8;
}
/* Which side of an aligned dimension line its label sits on: above | on | below. */
function getLabelPos() {
  const el = document.querySelector('#drawerLabelPos .lblpos.primary');
  return el ? el.dataset.pos : 'above';
}
function getAnnot()    { return document.getElementById('drawerAnnotText').value.trim() || 'Label'; }

function getXY(e) {
  const container = document.getElementById('konvaContainer');
  const rect = container.getBoundingClientRect();
  const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
  // Use actual rendered size for clamping so the full canvas area is reachable
  const w = rect.width  || _stageW;
  const h = rect.height || _stageH;
  return {
    x: Math.max(0, Math.min(w, cx)),
    y: Math.max(0, Math.min(h, cy)),
  };
}

/* =====================================================
   EXPORT — same logic, reads from history
   ===================================================== */
function buildShapeDefinition(meta) {
  const rawSegments = [], rawDims = [], rawTexts = [];
  for (const cmd of history) {
    if (cmd.type === 'text') {
      rawTexts.push({ x:cmd.x, y:cmd.y, text:cmd.text||'', size:cmd.size!=null?cmd.size*PT_TO_PX:undefined });
      continue;
    }
    if (cmd.type === 'rebar-path') {
      rawSegments.push({ pts: cmd.points.map(p=>({x:p.x,y:p.y})), style: cmd.bezier?'curve':'straight', closed:!!cmd.closed });
    } else if (cmd.type === 'ortho-bar') {
      rawSegments.push({ pts: cmd.points.map(p=>({x:p.x,y:p.y})), style:'bend', closed:!!cmd.closed });
    } else if (cmd.type === 'rect') {
      const lx=Math.min(cmd.x,cmd.x+cmd.w), rx=Math.max(cmd.x,cmd.x+cmd.w);
      const ty=Math.min(cmd.y,cmd.y+cmd.h), by=Math.max(cmd.y,cmd.y+cmd.h);
      rawSegments.push({ pts:[{x:lx,y:ty},{x:rx,y:ty},{x:rx,y:by},{x:lx,y:by}], style:'bend', closed:true });
    } else if (cmd.type === 'circle') {
      const steps=24, pts=[];
      for(let i=0;i<steps;i++){const a=i/steps*Math.PI*2; pts.push({x:cmd.cx+Math.cos(a)*cmd.rx,y:cmd.cy+Math.sin(a)*cmd.ry});}
      rawSegments.push({pts,style:'curve',closed:true});
    } else if (cmd.type === 'dim-aligned') {
      rawDims.push({ kind:'aligned', pts:[{x:cmd.p1.x,y:cmd.p1.y},{x:cmd.p2.x,y:cmd.p2.y}], offset:cmd.offset, label:cmd.label||'', size:cmd.size!=null?cmd.size*PT_TO_PX:undefined, pos:cmd.pos });
    } else if (cmd.type === 'dim-angular') {
      rawDims.push({ kind:'angular', pts:[{x:cmd.vertex.x,y:cmd.vertex.y},{x:cmd.ptA.x,y:cmd.ptA.y},{x:cmd.ptB.x,y:cmd.ptB.y}], label:cmd.label||'', size:cmd.size!=null?cmd.size*PT_TO_PX:undefined });
    } else if (cmd.type === 'dim-leader') {
      const lp=[{x:cmd.origin.x,y:cmd.origin.y},{x:cmd.elbow.x,y:cmd.elbow.y}];
      if(cmd.textPt) lp.push({x:cmd.textPt.x,y:cmd.textPt.y});
      rawDims.push({ kind:'leader', pts:lp, label:cmd.label||'', size:cmd.size!=null?cmd.size*PT_TO_PX:undefined });
    }
  }
  if (!rawSegments.length) return { error:'Nothing to export — draw at least one bar segment first.' };

  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  const consider=(x,y)=>{if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;};
  rawSegments.forEach(s=>s.pts.forEach(p=>consider(p.x,p.y)));
  rawDims.forEach(d=>d.pts.forEach(p=>consider(p.x,p.y)));
  rawTexts.forEach(t=>consider(t.x,t.y));
  const bw=maxX-minX||1, bh=maxY-minY||1;
  /* Uniform scale preserves the drawn aspect ratio; independent x/y scaling
     here is what distorts the shape into filling the whole canvas on reload.
     Fit the longer axis into (1 - 2*MARGIN) and centre the shape in the 0..1 box. */
  const MARGIN=0.08;
  const span=Math.max(bw,bh)||1;
  const scale=(1-2*MARGIN)/span;
  const offX=MARGIN+((1-2*MARGIN)-bw*scale)/2;
  const offY=MARGIN+((1-2*MARGIN)-bh*scale)/2;
  const nx=x=>+((offX+(x-minX)*scale)).toFixed(3);
  const ny=y=>+((offY+(y-minY)*scale)).toFixed(3);

  const segments=rawSegments.map(s=>{
    const seg={pts:s.pts.map(p=>[nx(p.x),ny(p.y)]),style:s.style};
    if(s.closed)seg.closed=true;
    return seg;
  });
  // Perp offset & font size are pixel lengths at draw time; store as fractions
  // of the bbox span (×scale) so they re-expand proportionally on reload.
  const frac=v=> v!=null ? +(v*scale).toFixed(4) : undefined;
  const np=p=>[nx(p.x),ny(p.y)];
  const dims=rawDims.map(d=>{
    if(d.kind==='angular')
      return {type:'angular', vertex:np(d.pts[0]), a:np(d.pts[1]), b:np(d.pts[2]), label:d.label||'A', size:frac(d.size)};
    if(d.kind==='leader'){
      const o={type:'leader', origin:np(d.pts[0]), elbow:np(d.pts[1]), label:d.label||'A', size:frac(d.size)};
      if(d.pts[2]) o.text=np(d.pts[2]);
      return o;
    }
    return {from:np(d.pts[0]), to:np(d.pts[1]), perp:frac(d.offset), label:d.label||'A', size:frac(d.size), pos:d.pos};
  });
  // Free-standing text annotations: normalise anchor + font size like dims.
  const texts=rawTexts.map(t=>{
    const o={x:nx(t.x), y:ny(t.y), label:t.text||''};
    if(t.size!=null) o.size=frac(t.size);
    return o;
  });
  const def={id:meta.id,label:meta.label||meta.id,group:'quick'};
  def.segments=segments;
  if(dims.length)def.dims=dims;
  if(texts.length)def.texts=texts;
  return {def};
}

function exportDrawnShape() {
  const id=(prompt('Shape ID (unique, no spaces):','')||'').trim();
  if(!id)return;
  const safeId=id.replace(/[^a-zA-Z0-9_-]/g,'-');
  const label=(prompt('Button label:',safeId)||safeId).trim();
  const result=buildShapeDefinition({id:safeId,label});
  if(result.error){alert(result.error);return;}
  showExportPanel(formatCompactShape(result.def),safeId);
}

function formatCompactShape(def) {
  const q=s=>JSON.stringify(s), ja=a=>JSON.stringify(a);
  const scalars=[];
  scalars.push(`"id": ${q(def.id)}, "label": ${q(def.label)}`);
  scalars.push(`"group": ${q(def.group||'quick')}`);
  const segObjs=(def.segments||[]).map(s=>{
    let o=`{ "pts": ${ja(s.pts)}, "style": ${q(s.style)}`;
    if(s.closed)o+=', "closed": true';
    return o+' }';
  });
  const segInline='[ '+segObjs.join(', ')+' ]';
  const segBlock=segObjs.length<=1||segInline.length<=120
    ?`"segments": ${segInline}`
    :`"segments": [\n      ${segObjs.join(',\n      ')}\n      ]`;
  let dimsBlock='';
  if(def.dims&&def.dims.length){
    const dimObjs=def.dims.map(d=>{
      const parts=[];
      if(d.type==='angular'){
        parts.push(`"type": "angular"`);
        parts.push(`"vertex": ${ja(d.vertex)}, "a": ${ja(d.a)}, "b": ${ja(d.b)}`);
      } else if(d.type==='leader'){
        parts.push(`"type": "leader"`);
        parts.push(`"origin": ${ja(d.origin)}, "elbow": ${ja(d.elbow)}`);
        if(d.text) parts.push(`"text": ${ja(d.text)}`);
      } else {
        parts.push(`"from": ${ja(d.from)}, "to": ${ja(d.to)}`);
        if(d.perp!=null) parts.push(`"perp": ${d.perp}`);
        if(d.pos && d.pos!=='above') parts.push(`"pos": ${q(d.pos)}`);
      }
      parts.push(`"label": ${q(d.label)}`);
      if(d.size!=null) parts.push(`"size": ${d.size}`);
      return `{ ${parts.join(', ')} }`;
    });
    dimsBlock=`,\n      "dims": [\n        ${dimObjs.join(',\n        ')}\n      ]`;
  }
  let textsBlock='';
  if(def.texts&&def.texts.length){
    const textObjs=def.texts.map(t=>{
      const parts=[`"x": ${t.x}, "y": ${t.y}`, `"label": ${q(t.label)}`];
      if(t.size!=null) parts.push(`"size": ${t.size}`);
      return `{ ${parts.join(', ')} }`;
    });
    textsBlock=`,\n      "texts": [\n        ${textObjs.join(',\n        ')}\n      ]`;
  }
  const indent='      ';
  const fields=scalars.map(s=>indent+s).join(',\n')+',\n'+indent+segBlock+dimsBlock+textsBlock;
  return `{\n${fields}\n    }`;
}

function showExportPanel(jsonText, id) {
  let panel=document.getElementById('shapeExportPanel');
  if(panel)panel.remove();
  panel=document.createElement('dialog');
  panel.id='shapeExportPanel';
  panel.style.cssText='background:var(--panel,#1e2535);color:var(--text,#dde3f0);border:1px solid var(--border,#2e3a52);border-radius:16px;max-width:560px;width:92vw;max-height:88vh;padding:0;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.5)';
  panel.innerHTML=`<div style="display:flex;flex-direction:column;max-height:88vh">
    <div style="padding:14px 18px;border-bottom:1px solid var(--border,#2e3a52);display:flex;align-items:center;gap:10px">
      <span style="font-weight:800;font-size:15px">📐 Shape exported</span><span style="flex:1"></span>
      <button id="expClose" class="btn small ghost" style="font-size:12px">✕</button>
    </div>
    <div style="padding:14px 18px;font-size:12px;line-height:1.6;color:var(--muted,#8a9ab8)">
      Copy into the <b>"shapes"</b> array in <code>bbs/shapes.json</code>, then reload the app.
    </div>
    <textarea id="expJson" readonly style="margin:0 18px;flex:1;min-height:200px;resize:vertical;
      font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:1.5;
      background:var(--input-bg,#141820);color:var(--text,#dde3f0);
      border:1px solid var(--border,#2e3a52);border-radius:8px;padding:10px;white-space:pre">${
        jsonText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      }</textarea>
    <div style="padding:14px 18px;display:flex;gap:8px;justify-content:flex-end">
      <button id="expCopy"     class="btn small primary" style="font-size:12px">📋 Copy</button>
      <button id="expDownload" class="btn small ghost"   style="font-size:12px">⬇ Download .json</button>
    </div></div>`;
  document.body.appendChild(panel); panel.showModal();
  const close=()=>{panel.close();panel.remove();};
  panel.querySelector('#expClose').onclick=close;
  panel.addEventListener('click',e=>{if(e.target===panel)close();});
  panel.querySelector('#expCopy').onclick=async()=>{
    try{await navigator.clipboard.writeText(jsonText);const b=panel.querySelector('#expCopy');b.textContent='✓ Copied';setTimeout(()=>(b.textContent='📋 Copy'),1500);}
    catch{const ta=panel.querySelector('#expJson');ta.removeAttribute('readonly');ta.focus();ta.select();document.execCommand('copy');ta.setAttribute('readonly','');}
  };
  panel.querySelector('#expDownload').onclick=()=>{
    const blob=new Blob([jsonText],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=`shape-${id}.json`;
    document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  };
}

/* =====================================================
   GRID RENDERER
   Draws a measurement grid behind the rebar drawing.
   Major lines every 5 cells, minor lines every cell.
   Grid is screen-only — it is excluded from the PNG
   export by rendering it on a separate Konva layer
   that is destroyed before toDataURL() is called.
   ===================================================== */
let _gridLayer = null;

function _ensureGridLayer() {
  if (!_konvaStage) return null;
  if (!_gridLayer || !_gridLayer.getStage()) {
    _gridLayer = new Konva.Layer({ listening: false });
    // Insert below the main drawing layer
    _konvaStage.add(_gridLayer);
    _gridLayer.moveToBottom();
  }
  return _gridLayer;
}

function drawGrid() {
  const gl = _ensureGridLayer();
  if (!gl) return;
  gl.destroyChildren();
  if (!_gridVisible) { gl.draw(); return; }

  const sp   = _gridSpacing;
  const W    = _stageW;
  const H    = _stageH;

  // Background (white, always — grid sits on top of it)
  gl.add(new Konva.Rect({ x:0, y:0, width:W, height:H, fill:'#fff' }));

  const majorEvery = 5;   // every 5th line is a major line

  // Vertical lines
  for (let xi = 0; xi * sp <= W; xi++) {
    const x = xi * sp;
    const isMajor = xi % majorEvery === 0;
    gl.add(new Konva.Line({
      points: [x, 0, x, H],
      stroke: isMajor ? '#b0bec5' : '#dde3ea',
      strokeWidth: isMajor ? 0.8 : 0.5,
      listening: false,
    }));
    // Label major lines
    if (isMajor && x > 0) {
      gl.add(new Konva.Text({
        x: x + 2, y: 2,
        text: `${x}`,
        fontSize: 8,
        fontFamily: 'ui-monospace,Consolas,monospace',
        fill: '#90a4ae',
        listening: false,
      }));
    }
  }

  // Horizontal lines
  for (let yi = 0; yi * sp <= H; yi++) {
    const y = yi * sp;
    const isMajor = yi % majorEvery === 0;
    gl.add(new Konva.Line({
      points: [0, y, W, y],
      stroke: isMajor ? '#b0bec5' : '#dde3ea',
      strokeWidth: isMajor ? 0.8 : 0.5,
      listening: false,
    }));
    // Label major lines
    if (isMajor && y > 0) {
      gl.add(new Konva.Text({
        x: 2, y: y + 2,
        text: `${y}`,
        fontSize: 8,
        fontFamily: 'ui-monospace,Consolas,monospace',
        fill: '#90a4ae',
        listening: false,
      }));
    }
  }

  // Origin dot
  gl.add(new Konva.Circle({ x:0, y:0, radius:3, fill:'#90a4ae', listening:false }));

  gl.draw();
}

/* =====================================================
   KONVA REDRAW — replaces canvas2d history redraw
   ===================================================== */
function redraw() {
  const layer = getKonvaLayer();
  if (!layer) return;
  layer.destroyChildren();

  // White background only when grid is off (grid layer paints its own bg)
  if (!_gridVisible) {
    layer.add(new Konva.Rect({ x:0, y:0, width:_stageW, height:_stageH, fill:'#fff' }));
  }

  drawGrid();   // always sync grid layer

  for (const cmd of history) renderCmd(cmd, layer);
  layer.draw();
}

function renderCmd(cmd, layer) {
  window._drawerActiveStyle = cmd.style || activeStyle;
  const d = cmd.diam || getBarSize();

  if (cmd.type === 'rebar-path') {
    layer.add(makeRebarGroup(cmd.points, d, cmd.bezier?'curve':'straight', cmd.closed||false));

  } else if (cmd.type === 'ortho-bar') {
    layer.add(makeOrthoRebarGroup(cmd.points, d, cmd.closed||false));

  } else if (cmd.type === 'rect') {
    const lx=Math.min(cmd.x,cmd.x+cmd.w), rx=Math.max(cmd.x,cmd.x+cmd.w);
    const ty=Math.min(cmd.y,cmd.y+cmd.h), by=Math.max(cmd.y,cmd.y+cmd.h);
    layer.add(makeOrthoRebarGroup([{x:lx,y:ty},{x:rx,y:ty},{x:rx,y:by},{x:lx,y:by}],d,true));

  } else if (cmd.type === 'circle') {
    const steps=Math.max(36,Math.round((cmd.rx+cmd.ry)*0.9)), pts=[];
    for(let i=0;i<steps;i++){const a=i/steps*Math.PI*2; pts.push({x:cmd.cx+Math.cos(a)*cmd.rx,y:cmd.cy+Math.sin(a)*cmd.ry});}
    layer.add(makeRebarGroup(pts, d, 'curve', true));

  } else if (cmd.type === 'text') {
    layer.add(new Konva.Text({
      x:cmd.x, y:cmd.y,
      text:cmd.text, fontSize:(cmd.size||13)*PT_TO_PX,
      fontFamily:'ui-monospace,Consolas,monospace', fontStyle:'bold',
      fill:GRAY.dim,
    }));

  } else if (cmd.type === 'dim-aligned') {
    layer.add(new Konva.Shape({
      sceneFunc(ctx) {
        const c = ctx._context||ctx;
        drawDimAligned(c, cmd.p1, cmd.p2, cmd.offset, cmd.label||getAnnot(), (cmd.size||DIM_BASE_PT)*PT_TO_PX, cmd.pos);
      }, listening: false,
    }));

  } else if (cmd.type === 'dim-angular') {
    layer.add(new Konva.Shape({
      sceneFunc(ctx) {
        const c = ctx._context||ctx;
        drawDimAngular(c, cmd.vertex, cmd.ptA, cmd.ptB, cmd.label||'', (cmd.size||DIM_BASE_PT)*PT_TO_PX, cmd.pos);
      }, listening: false,
    }));

  } else if (cmd.type === 'dim-leader') {
    layer.add(new Konva.Shape({
      sceneFunc(ctx) {
        const c = ctx._context||ctx;
        drawDimLeader(c, cmd.origin, cmd.elbow, cmd.textPt||null, cmd.label||getAnnot(), (cmd.size||DIM_BASE_PT)*PT_TO_PX, cmd.pos);
      }, listening: false,
    }));

  } else if (cmd.type === 'shape') {
    // Render to off-screen canvas, then blit as Konva.Image
    const oc=document.createElement('canvas'); oc.width=_stageW; oc.height=_stageH;
    window._drawerActiveStyle=cmd.style||activeStyle;
    drawShapeDiagram(oc.getContext('2d'), cmd.shape, d, _stageW, _stageH);
    Konva.Image.fromURL(oc.toDataURL(), img=>{
      img.setAttrs({x:0,y:0,width:_stageW,height:_stageH});
      layer.add(img); layer.draw();
    });
  }
}

/* ── Ghost overlay: in-progress drawing on top of committed history ── */
function renderGhostFrame(cursorPt) {
  redraw();
  const layer = getKonvaLayer();
  window._drawerActiveStyle = activeStyle;

  if (activeTool === 'rebar-path' && isDrawing && livePts.length >= 1) {
    const previewPts = cursorPt ? [...livePts, cursorPt] : livePts;
    const addGhost = (pts, style) => {
      if (pts.length < 2) return;
      const g = makeRebarGroup(pts, getBarSize(), style, false);
      g.opacity(0.6); layer.add(g);
    };
    // Mirror commitRebarPath's split so the preview is faithful: each segment keeps
    // the pen mode it was drawn with; the live segment to the cursor uses current mode.
    const previewStyles = [...segStyles];
    if (cursorPt) previewStyles.push(bezierMode ? 'curve' : 'straight');
    splitStyleRuns(previewPts, previewStyles).forEach(r => addGhost(r.pts, r.style));
    // Anchor dots — orange where the segment style changes (a mode transition)
    livePts.forEach((p,i) => {
      const isTransition = i>0 && i<segStyles.length && segStyles[i] !== segStyles[i-1];
      layer.add(new Konva.Circle({
        x:p.x, y:p.y, radius:5,
        fill: i===0?'#22c55e':isTransition?'#f97316':'#38bdf8',
        stroke:'#fff', strokeWidth:1.5,
      }));
    });
    if (cursorPt) layer.add(new Konva.Circle({x:cursorPt.x,y:cursorPt.y,radius:4,fill:'rgba(251,191,36,0.85)',stroke:'#fff',strokeWidth:1.5}));
    updateNodeCounter(livePts.length);

  } else if (activeTool === 'ortho-bar' && isDrawing && livePts.length >= 1) {
    const anchor = livePts[livePts.length-1];
    const snappedPt = cursorPt ? orthoSnap(cursorPt, anchor) : null;
    const previewPts = snappedPt ? [...livePts, snappedPt] : livePts;
    if (previewPts.length >= 2) {
      const g = makeOrthoRebarGroup(previewPts, getBarSize(), false);
      g.opacity(0.6); layer.add(g);
    }
    livePts.forEach((p,i) => layer.add(new Konva.Circle({x:p.x,y:p.y,radius:5,fill:i===0?'#22c55e':'#38bdf8',stroke:'#fff',strokeWidth:1.5})));
    if (snappedPt) {
      layer.add(new Konva.Line({points:[anchor.x,anchor.y,snappedPt.x,snappedPt.y],stroke:'rgba(251,191,36,0.5)',strokeWidth:1,dash:[4,4]}));
      layer.add(new Konva.Circle({x:snappedPt.x,y:snappedPt.y,radius:4,fill:'rgba(251,191,36,0.9)',stroke:'#fff',strokeWidth:1.5}));
    }
    updateNodeCounter(livePts.length);

  } else if (activeTool === 'rect' && dragStart && cursorPt) {
    const lx=Math.min(dragStart.x,cursorPt.x), rx=Math.max(dragStart.x,cursorPt.x);
    const ty=Math.min(dragStart.y,cursorPt.y), by=Math.max(dragStart.y,cursorPt.y);
    const g=makeOrthoRebarGroup([{x:lx,y:ty},{x:rx,y:ty},{x:rx,y:by},{x:lx,y:by}],getBarSize(),true);
    g.opacity(0.6); layer.add(g);

  } else if (activeTool === 'circle' && dragStart && cursorPt) {
    const rxv=Math.abs(cursorPt.x-dragStart.x), ryv=Math.abs(cursorPt.y-dragStart.y);
    if (rxv>4||ryv>4) {
      const steps=Math.max(36,Math.round((rxv+ryv)*0.9)), pts=[];
      for(let i=0;i<steps;i++){const a=i/steps*Math.PI*2; pts.push({x:dragStart.x+Math.cos(a)*rxv,y:dragStart.y+Math.sin(a)*ryv});}
      const g=makeRebarGroup(pts,getBarSize(),'curve',true); g.opacity(0.6); layer.add(g);
    }

  } else if (activeTool === 'dim-aligned' && dimPhase >= 1 && cursorPt) {
    // Phase 1: show ghost line from p1 to cursor; Phase 2: show full aligned dim
    const p1 = dimPts[0];
    const p2 = dimPhase === 1
      ? (dimOrtho ? orthoSnap(cursorPt, p1) : cursorPt)
      : dimPts[1];
    const offset = dimPhase === 2
      ? _alignedOffset(p1, p2, cursorPt)
      : -30;
    layer.add(new Konva.Shape({
      opacity: 0.6,
      sceneFunc(ctx) { drawDimAligned(ctx._context||ctx, p1, p2, offset, getAnnot(), getFontSize()*PT_TO_PX, getLabelPos()); },
      listening: false,
    }));
    // Anchor dots
    dimPts.forEach(p => layer.add(new Konva.Circle({x:p.x,y:p.y,radius:4,fill:'#38bdf8',stroke:'#fff',strokeWidth:1.5})));
    const dot = (dimPhase === 1 && dimOrtho) ? orthoSnap(cursorPt, p1) : cursorPt;
    layer.add(new Konva.Circle({x:dot.x,y:dot.y,radius:4,fill:'rgba(251,191,36,0.85)',stroke:'#fff',strokeWidth:1.5}));

  } else if (activeTool === 'dim-angular' && dimPhase >= 1 && cursorPt) {
    const vertex = dimPts[0];
    const ptA    = dimPhase >= 2 ? dimPts[1] : cursorPt;
    const ptB    = dimPhase === 2 ? cursorPt : null;
    if (ptB) {
      layer.add(new Konva.Shape({
        opacity: 0.6,
        sceneFunc(ctx) { drawDimAngular(ctx._context||ctx, vertex, ptA, ptB, getAnnot(), getFontSize()*PT_TO_PX, getLabelPos()); },
        listening: false,
      }));
    } else {
      // Phase 1 ghost: just a line from vertex to cursor
      layer.add(new Konva.Line({points:[vertex.x,vertex.y,ptA.x,ptA.y],stroke:'rgba(56,189,248,0.5)',strokeWidth:1.2,dash:[4,3]}));
    }
    dimPts.forEach(p => layer.add(new Konva.Circle({x:p.x,y:p.y,radius:4,fill:'#38bdf8',stroke:'#fff',strokeWidth:1.5})));
    layer.add(new Konva.Circle({x:cursorPt.x,y:cursorPt.y,radius:4,fill:'rgba(251,191,36,0.85)',stroke:'#fff',strokeWidth:1.5}));

  } else if (activeTool === 'dim-leader' && dimPhase >= 1 && cursorPt) {
    const origin = dimPts[0];
    const elbow  = dimPhase >= 2 ? dimPts[1] : cursorPt;
    const textPt = dimPhase === 2 ? cursorPt : null;
    layer.add(new Konva.Shape({
      opacity: 0.6,
      sceneFunc(ctx) { drawDimLeader(ctx._context||ctx, origin, elbow, textPt, getAnnot(), getFontSize()*PT_TO_PX, getLabelPos()); },
      listening: false,
    }));
    dimPts.forEach(p => layer.add(new Konva.Circle({x:p.x,y:p.y,radius:4,fill:'#38bdf8',stroke:'#fff',strokeWidth:1.5})));
    layer.add(new Konva.Circle({x:cursorPt.x,y:cursorPt.y,radius:4,fill:'rgba(251,191,36,0.85)',stroke:'#fff',strokeWidth:1.5}));
  }

  layer.draw();
}

function updateNodeCounter(n) {
  const el=document.getElementById('nodeCounter');
  if(!el)return;
  if(n>0){el.style.display='block';el.textContent=n===1?'1 point — keep tapping to build path':`${n} points — double-tap or Enter to finish`;}
  else el.style.display='none';
}

function showPathHint(on, isOrtho) {
  // path hint removed — canvasHint at canvas bottom provides tool guidance
}

function commitRebarPath() {
  if (livePts.length<2){cancelPath();return;}
  if (activeTool==='ortho-bar') {
    history.push({type:'ortho-bar',points:[...livePts],diam:getBarSize(),style:activeStyle,closed:false,fillet:_orthoFillet});
  } else {
    splitStyleRuns(livePts, segStyles).forEach(r => {
      if (r.pts.length>=2) history.push({type:'rebar-path',points:r.pts,diam:getBarSize(),style:activeStyle,closed:false,bezier:r.style==='curve'});
    });
  }
  cancelPath(); redraw();
}

function cancelPath() {
  isDrawing=false; livePts=[]; segStyles=[]; mousePos=null; bezierMode=false;
  _lastDownTime=0; _lastDownPt=null;
  updateNodeCounter(0); showPathHint(false); redraw();
}

/* ── Signed perpendicular offset from cursor to the p1-p2 line ── */
function _alignedOffset(p1, p2, cursor) {
  const dx = p2.x-p1.x, dy = p2.y-p1.y;
  const len = Math.hypot(dx,dy);
  if (len < 1) return 30;
  // Normal vector (pointing left of direction p1→p2)
  const nx = -dy/len, ny = dx/len;
  // Project cursor onto normal
  return (cursor.x-p1.x)*nx + (cursor.y-p1.y)*ny;
}

/* =====================================================
   EDIT-POINTS MODE — collect all draggable handles from
   history commands that carry a .points[] array.
   ===================================================== */
const EDIT_HANDLE_R = 7; // hit radius in px

function _editHandles() {
  const handles = [];
  for (let ci = 0; ci < history.length; ci++) {
    const cmd = history[ci];
    if (!cmd.points) continue;
    for (let pi = 0; pi < cmd.points.length; pi++) {
      handles.push({ ci, pi, x: cmd.points[pi].x, y: cmd.points[pi].y });
    }
  }
  return handles;
}

function _hitHandle(pt, handles) {
  let best = null, bestD = Infinity;
  for (const h of handles) {
    const d = Math.hypot(pt.x - h.x, pt.y - h.y);
    if (d < EDIT_HANDLE_R * 2 && d < bestD) { bestD = d; best = h; }
  }
  return best;
}

function renderEditHandles() {
  redraw();
  const layer = getKonvaLayer();
  const handles = _editHandles();
  for (const h of handles) {
    const isActive = editDragCmd !== null &&
                     history[h.ci] === editDragCmd &&
                     h.pi === editDragIdx;
    layer.add(new Konva.Circle({
      x: h.x, y: h.y,
      radius: EDIT_HANDLE_R,
      fill: isActive ? '#f97316' : 'rgba(56,189,248,0.85)',
      stroke: '#fff',
      strokeWidth: 2,
      shadowColor: 'rgba(0,0,0,0.35)',
      shadowBlur: 4,
      shadowOffsetY: 1,
    }));
  }
  layer.draw();
}

/* =====================================================
   DELETE-ELEMENT MODE — hit-test a whole history command
   under the cursor (reusing the renderer/exporter geometry)
   and remove just that one. Walks back-to-front so the
   topmost element wins.
   ===================================================== */
function _distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx-ax, dy = by-ay, l2 = dx*dx + dy*dy;
  let t = l2 ? ((px-ax)*dx + (py-ay)*dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax+dx*t), py - (ay+dy*t));
}
function _minDistToPolyline(pt, pts) {
  if (pts.length === 1) return Math.hypot(pt.x-pts[0].x, pt.y-pts[0].y);
  let m = Infinity;
  for (let i = 1; i < pts.length; i++)
    m = Math.min(m, _distToSeg(pt.x, pt.y, pts[i-1].x, pts[i-1].y, pts[i].x, pts[i].y));
  return m;
}
function _cmdHit(cmd, pt) {
  const near = (a, r) => a && Math.hypot(pt.x-a.x, pt.y-a.y) < r;
  if (cmd.type==='rebar-path' || cmd.type==='ortho-bar' || cmd.type==='rect' || cmd.type==='circle') {
    const d = cmd.diam || 16;
    const samples = _barSamples(cmd, d) || [];
    return samples.length ? _minDistToPolyline(pt, samples) < Math.max(10, d/2 + 8) : false;
  }
  if (cmd.type==='text') {
    const fsPx = (cmd.size || 13) * PT_TO_PX, w = (cmd.text||'').length * fsPx * 0.6 + 6;
    return pt.x >= cmd.x-4 && pt.x <= cmd.x + w && pt.y >= cmd.y-4 && pt.y <= cmd.y + fsPx*1.6 + 4;
  }
  if (cmd.type==='dim-aligned')
    return near(cmd.p1,14) || near(cmd.p2,14) || _distToSeg(pt.x,pt.y,cmd.p1.x,cmd.p1.y,cmd.p2.x,cmd.p2.y) < 10;
  if (cmd.type==='dim-angular')
    return near(cmd.vertex,18) || near(cmd.ptA,14) || near(cmd.ptB,14);
  if (cmd.type==='dim-leader')
    return near(cmd.origin,16) || near(cmd.elbow,16) || near(cmd.textPt,16);
  return false;
}
function _cmdHitIndex(pt) {
  for (let i = history.length - 1; i >= 0; i--) if (_cmdHit(history[i], pt)) return i;
  return -1;
}
function renderDeleteHover() {
  redraw();
  if (_delHoverIdx < 0 || _delHoverIdx >= history.length) return;
  const b = computeHistoryBounds([history[_delHoverIdx]]);
  if (!b) return;
  const layer = getKonvaLayer(), pad = 6;
  layer.add(new Konva.Rect({
    x: b.minX - pad, y: b.minY - pad,
    width: (b.maxX - b.minX) + pad*2, height: (b.maxY - b.minY) + pad*2,
    stroke: '#ef4444', strokeWidth: 1.5, dash: [6,4],
    fill: 'rgba(239,68,68,0.08)', listening: false,
  }));
  layer.draw();
}

/* ── Event handlers wired to Konva stage ── */
function onDown(e) {
  if (e.button!=null&&e.button===2) return;
  const pt  = getXY(e);
  const now = Date.now();

  /* ── Edit-points mode: start drag if near a handle ── */
  if (activeTool === 'edit-points') {
    const hit = _hitHandle(pt, _editHandles());
    if (hit) {
      editDragCmd  = history[hit.ci];
      editDragIdx  = hit.pi;
      editDragging = true;
      renderEditHandles();
    } else {
      editDragCmd = null; editDragIdx = null; editDragging = false;
      renderEditHandles();
    }
    return;
  }

  /* ── Delete-element mode: remove the element under the cursor ── */
  if (activeTool === 'delete-element') {
    const i = _cmdHitIndex(pt);
    if (i >= 0) history.splice(i, 1);
    _delHoverIdx = -1;
    redraw();
    return;
  }

  /* ── double-click detection ── */
  const isDbl = (now - _lastDownTime < DBL_MS) &&
                (_lastDownPt !== null) &&
                (Math.hypot(pt.x - _lastDownPt.x, pt.y - _lastDownPt.y) < DBL_PX);
  _lastDownTime = now;
  _lastDownPt   = pt;

  if (isDbl && (activeTool==='rebar-path'||activeTool==='ortho-bar') && isDrawing) {
    /* second click of dblclick: discard the point just added by the first
       mousedown of this pair (it was already pushed), then commit */
    if (livePts.length > 1) { livePts.pop(); segStyles.pop(); }
    commitRebarPath();
    return;
  }

  if (activeTool==='text') {
    history.push({type:'text',x:pt.x,y:pt.y,text:getAnnot(),size:getFontSize()});
    redraw(); return;
  }

  /* ── Aligned dimension: click 1=p1, click 2=p2, click 3=offset side ── */
  if (activeTool==='dim-aligned') {
    // 2nd click snaps H/V to the 1st point while ortho mode (O) is on
    dimPts.push(dimOrtho && dimPts.length===1 ? orthoSnap(pt, dimPts[0]) : pt);
    if (dimPts.length === 3) {
      const [p1,p2,offPt] = dimPts;
      history.push({type:'dim-aligned', p1, p2, offset: _alignedOffset(p1,p2,offPt), label:getAnnot(), size:getFontSize(), pos:getLabelPos()});
      dimPhase=0; dimPts=[]; dimOrtho=false; redraw();
    } else {
      dimPhase = dimPts.length;
    }
    return;
  }

  /* ── Angular dimension: click 1=vertex, click 2=arm-A, click 3=arm-B ── */
  if (activeTool==='dim-angular') {
    dimPts.push(pt);
    if (dimPts.length === 3) {
      const [vertex,ptA,ptB] = dimPts;
      history.push({type:'dim-angular', vertex, ptA, ptB, label:getAnnot(), size:getFontSize(), pos:getLabelPos()});
      dimPhase=0; dimPts=[]; redraw();
    } else {
      dimPhase = dimPts.length;
    }
    return;
  }

  /* ── Leader: click 1=origin (arrowhead), click 2=elbow, click 3=text anchor ── */
  if (activeTool==='dim-leader') {
    dimPts.push(pt);
    if (dimPts.length === 3) {
      const [origin,elbow,textPt] = dimPts;
      history.push({type:'dim-leader', origin, elbow, textPt, label:getAnnot(), size:getFontSize(), pos:getLabelPos()});
      dimPhase=0; dimPts=[]; redraw();
    } else {
      dimPhase = dimPts.length;
    }
    return;
  }
  if (activeTool==='rebar-path') {
    if(!isDrawing){isDrawing=true;livePts=[pt];segStyles=[];showPathHint(true);}
    else{
      const first=livePts[0],closeThresh=16;
      if(livePts.length>=3&&Math.hypot(pt.x-first.x,pt.y-first.y)<closeThresh){
        const closePts=[...livePts,livePts[0]];
        const closeStyles=[...segStyles,bezierMode?'curve':'straight'];
        const runs=splitStyleRuns(closePts,closeStyles);
        if(runs.length<=1){
          // uniform style — keep a true closed path so it smooths/fills correctly
          history.push({type:'rebar-path',points:[...livePts],diam:getBarSize(),style:activeStyle,closed:true,bezier:runs.length===1&&runs[0].style==='curve'});
        } else {
          runs.forEach(r=>{ if(r.pts.length>=2)history.push({type:'rebar-path',points:r.pts,diam:getBarSize(),style:activeStyle,closed:false,bezier:r.style==='curve'}); });
        }
        cancelPath(); return;
      }
      livePts.push(pt);
      segStyles.push(bezierMode?'curve':'straight');
    }
    renderGhostFrame(pt); return;
  }
  if (activeTool==='ortho-bar') {
    if(!isDrawing){isDrawing=true;livePts=[pt];showPathHint(true,true);}
    else{
      const snapped=orthoSnap(pt,livePts[livePts.length-1]);
      const first=livePts[0],closeThresh=16;
      if(livePts.length>=3&&Math.hypot(snapped.x-first.x,snapped.y-first.y)<closeThresh){
        history.push({type:'ortho-bar',points:[...livePts],diam:getBarSize(),style:activeStyle,closed:true,fillet:_orthoFillet});
        cancelPath(); return;
      }
      livePts.push(snapped);
    }
    renderGhostFrame(pt); return;
  }
  if (activeTool==='rect'||activeTool==='circle') { dragStart=pt; }
}

function onMove(e) {
  const pt=getXY(e); mousePos=pt;

  /* Edit-points drag */
  if (activeTool === 'edit-points' && editDragging && editDragCmd && editDragIdx !== null) {
    editDragCmd.points[editDragIdx] = { x: pt.x, y: pt.y };
    renderEditHandles();
    return;
  }

  /* Delete-element hover: highlight the element that would be removed */
  if (activeTool === 'delete-element') {
    const i = _cmdHitIndex(pt);
    if (i !== _delHoverIdx) { _delHoverIdx = i; renderDeleteHover(); }
    return;
  }

  if((activeTool==='rebar-path'||activeTool==='ortho-bar')&&isDrawing) renderGhostFrame(pt);
  else if((activeTool==='rect'||activeTool==='circle')&&dragStart) renderGhostFrame(pt);
  else if((activeTool==='dim-aligned'||activeTool==='dim-angular'||activeTool==='dim-leader')&&dimPhase>=1) renderGhostFrame(pt);
}

function onUp(e) {
  /* Finish edit-points drag */
  if (activeTool === 'edit-points' && editDragging) {
    editDragging = false;
    renderEditHandles();
    return;
  }

  if (activeTool==='rect'&&dragStart) {
    const pt=getXY(e);
    history.push({type:'rect',x:dragStart.x,y:dragStart.y,w:pt.x-dragStart.x,h:pt.y-dragStart.y,diam:getBarSize(),style:activeStyle});
    dragStart=null; redraw(); return;
  }
  if (activeTool==='circle'&&dragStart) {
    const pt=getXY(e);
    const rx=Math.abs(pt.x-dragStart.x),ry=Math.abs(pt.y-dragStart.y);
    if(rx>4||ry>4) history.push({type:'circle',cx:dragStart.x,cy:dragStart.y,rx,ry,diam:getBarSize(),style:activeStyle});
    dragStart=null; redraw(); return;
  }
}

function onKeyDown(e) {
  if(e.key==='Escape'){
    if(isDrawing)cancelPath();
    if(dimPhase>0){dimPhase=0;dimPts=[];dimOrtho=false;redraw();}
    dragStart=null;
    if(activeTool==='edit-points'){editDragCmd=null;editDragIdx=null;editDragging=false;renderEditHandles();}
    if(activeTool==='delete-element'){_delHoverIdx=-1;redraw();}
  }
  if((e.key==='o'||e.key==='O')&&activeTool==='dim-aligned'){
    dimOrtho=!dimOrtho;
    const hintEl=document.getElementById('canvasHint');
    if(hintEl)hintEl.textContent=(dimOrtho?'Ortho ON (O): 2nd point snaps H/V · ':'')+'Tap 1=start · Tap 2=end · Tap 3=offset side · Esc=cancel';
    if(dimPhase>=1)renderGhostFrame(mousePos);
  }
  if(e.key==='Enter'&&(activeTool==='rebar-path'||activeTool==='ortho-bar')&&isDrawing) commitRebarPath();
  if((e.key==='f'||e.key==='F')&&(activeTool==='ortho-bar'||activeTool==='rebar-path')){
    if(_orthoFillet===0){_orthoFillet=_orthoFilletSaved||6;}else{_orthoFilletSaved=_orthoFillet;_orthoFillet=0;}
    const el=document.getElementById('drawerFillet');
    if(el)el.value=_orthoFillet;
    const valEl=document.getElementById('drawerFilletVal');
    if(valEl)valEl.textContent=String(_orthoFillet);
    if(isDrawing)renderGhostFrame(mousePos);else redraw();
  }
  if((e.key==='b'||e.key==='B')&&activeTool==='rebar-path'&&isDrawing){
    bezierMode=!bezierMode;   // affects only segments drawn from here on
    renderGhostFrame(mousePos);
  }
}

function setTool(t) {
  if(isDrawing)cancelPath();
  dimPhase=0; dimPts=[]; dimOrtho=false; dragStart=null; _delHoverIdx=-1;
  /* reset edit state when switching away */
  if(t !== 'edit-points') { editDragCmd=null; editDragIdx=null; editDragging=false; }
  activeTool=t;
  document.querySelectorAll('.drawer-tool').forEach(b=>{
    const on=b.dataset.tool===t;
    b.style.background=on?'var(--brand)':'';
    b.style.color=on?'#05131f':'';
    b.style.fontWeight=on?'700':'';
  });
  /* Reveal the settings relevant to this tool: bar size / texture / grid for the
     bar-drawing tools, annotation + font size for the text & dimension tools. */
  const barTools   = ['rebar-path','ortho-bar','rect','circle'];
  const labelTools = ['text','dim-aligned','dim-angular','dim-leader'];
  const pBar=document.getElementById('panel-bar'), pLabel=document.getElementById('panel-label');
  const pQuick=document.getElementById('panel-quick');
  const pTex=document.getElementById('panel-texture'), pGrid=document.getElementById('panel-grid');
  const pLabelPos=document.getElementById('drawerLabelPosWrap');
  const noDraw=['shapes','texture','grid'];
  if(pBar)   pBar.style.display   = barTools.includes(t)   ? 'flex' : 'none';
  if(pLabel) pLabel.style.display = labelTools.includes(t) ? 'flex' : 'none';
  if(pLabelPos) pLabelPos.style.display = t === 'text' ? 'none' : '';
  if(pQuick) pQuick.style.display = t==='shapes'           ? 'flex' : 'none';
  if(pTex)   pTex.style.display   = t==='texture'          ? 'flex' : 'none';
  if(pGrid)  pGrid.style.display  = t==='grid'             ? 'flex' : 'none';
  /* Desktop lays the tool palette out vertically, which can push the active
     tool's contextual panel below the sidebar fold — bring it into view so its
     controls (e.g. the Shape Library) aren't hidden under the chip grid. */
  const activePanel=[pBar,pLabel,pQuick,pTex,pGrid].find(p=>p&&p.style.display!=='none');
  if(activePanel&&activePanel.scrollIntoView){
    try{activePanel.scrollIntoView({block:'nearest',behavior:'smooth'});}
    catch(_){activePanel.scrollIntoView();}
  }
  const container=document.getElementById('konvaContainer');
  if(container)container.style.cursor=t==='text'?'text':t==='delete-element'?'pointer':(t==='edit-points'||noDraw.includes(t))?'default':'crosshair';
  showPathHint(false);
  const hintEl=document.getElementById('canvasHint');
  const hints={
    'ortho-bar':   'Taps snap H/V · F=toggle fillet · double-tap to finish',
    'edit-points': 'Drag handles to move points',
    'delete-element': 'Tap an element to delete it',
    'dim-aligned': 'Tap start, end, offset side',
    'dim-angular': 'Tap vertex, arm A, arm B',
    'dim-leader':  'Tap arrowhead, elbow, text',
    'shapes':      'Pick a preset, then refine',
    'texture':     'Pick a texture for new bars',
    'grid':        'Toggle the snap grid',
  };
  if(hintEl)hintEl.textContent=hints[t]||'Tap to add · B = Bézier · double-tap to finish';
  if(t === 'edit-points') renderEditHandles();
  else redraw();
}

function setStyle(s) {
  activeStyle=s; window._drawerActiveStyle=s;
  document.querySelectorAll('.rebar-style-btn').forEach(b=>{
    const on=b.dataset.style===s;
    b.style.borderColor=on?'var(--brand)':'';
    b.style.background=on?'rgba(34,197,94,.1)':'';
    b.style.color=on?'var(--brand)':'';
  });
}

/* ── Init ── */
function initDrawer() {
  const wrap = document.getElementById('svgCanvasWrap');

  // Disconnect any previous observer
  if (_stageResizeObserver) { _stageResizeObserver.disconnect(); _stageResizeObserver = null; }

  function _syncSidebarHeight() {
    // The tool sidebar now stacks below the canvas (full width) at all sizes, so
    // it must size to its content — clear any leftover height cap.
    const sidebar = document.getElementById('drawerSidebar');
    if (sidebar) sidebar.style.maxHeight = '';
  }

  // Stage size: the white wrap is given a viewport-based height by CSS at all
  // widths (56vh desktop / 62dvh phone), and the Konva stage is sized to the
  // wrap's *measured* height — so the drawable area always exactly fills the
  // visible white, with nothing undrawable at the bottom.
  function _stageSize() {
    const w = wrap.clientWidth;
    wrap.style.height = '';                    // hand height control to CSS
    return { w, h: wrap.clientHeight || Math.round(w * 3 / 4) };
  }

  function _resizeStage() {
    const { w, h } = _stageSize();
    if (!w || !h) return;
    _stageW = w;
    _stageH = h;
    _syncSidebarHeight(h);
    if (_konvaStage) {
      _konvaStage.width(w);
      _konvaStage.height(h);
      if (activeTool === 'edit-points') renderEditHandles();
      else { drawGrid(); redraw(); }
    }
  }

  const _init = _stageSize();
  _stageW = _init.w || 600;
  _stageH = _init.h || Math.round(_stageW * 3 / 4);
  _syncSidebarHeight(_stageH);

  // Boot Konva stage into #konvaContainer
  const konvaEl = document.getElementById('konvaContainer');
  initKonvaStage(konvaEl, _stageW, _stageH);

  // Keep stage in sync with flex container size
  _stageResizeObserver = new ResizeObserver(() => _resizeStage());
  _stageResizeObserver.observe(wrap);

  // Wire Konva stage events. Use unified POINTER events so a single tap = one
  // point on both mouse and touch. Binding mouse+touch together double-fires on
  // phones (a tap emits touchstart AND a synthetic mousedown ~300ms later),
  // which added two points per tap and falsely tripped double-tap-to-finish.
  // Pointer events fire exactly once per interaction and carry coords on
  // pointerup; touch-action:none (CSS) stops the browser from scrolling/zooming
  // or swallowing the double-tap-to-finish gesture.
  const stage = _konvaStage;
  stage.off('mousedown touchstart mouseup touchend mousemove touchmove pointerdown pointermove pointerup dblclick');
  stage.on('pointerdown', e => { onDown(e.evt); });
  stage.on('pointermove', e => { onMove(e.evt); });
  stage.on('pointerup',   e => { onUp(e.evt);   });

  document.removeEventListener('keydown', onKeyDown);
  document.addEventListener('keydown', onKeyDown);

  history = _pendingHistory || []; _pendingHistory = null;
  isDrawing=false; livePts=[]; segStyles=[]; dragStart=null; dimPhase=0; dimPts=[]; mousePos=null; bezierMode=false;
  editDragCmd=null; editDragIdx=null; editDragging=false; _delHoverIdx=-1;
  redraw();

  document.querySelectorAll('.drawer-tool, .rebar-style-btn, .annot-preset').forEach(b=>{
    const clone=b.cloneNode(true); b.parentNode.replaceChild(clone,b);
  });
  document.querySelectorAll('.drawer-tool').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));
  document.querySelectorAll('.rebar-style-btn').forEach(b=>b.addEventListener('click',()=>setStyle(b.dataset.style)));
  document.querySelectorAll('.annot-preset').forEach(b=>b.addEventListener('click',()=>{
    document.getElementById('drawerAnnotText').value=b.dataset.text;
    // Preserve text or any dim tool — only auto-switch if on a drawing/shape tool
    const isDimOrText = activeTool==='text'||activeTool==='dim-aligned'||activeTool==='dim-angular'||activeTool==='dim-leader';
    if(!isDimOrText) setTool('text');
  }));

  document.getElementById('drawerBarSize').addEventListener('input',e=>{
    document.getElementById('drawerBarVal').textContent=e.target.value;
    history=history.map(cmd=>cmd.type==='shape'?{...cmd,diam:parseInt(e.target.value,10)}:cmd);
    redraw();
  });
  document.getElementById('drawerFontSize').addEventListener('input',e=>{
    document.getElementById('drawerFontVal').textContent=e.target.value;
    // Live-preview the new size on a dimension that's currently being placed
    if(dimPhase>=1) renderGhostFrame(mousePos);
  });
  document.querySelectorAll('#drawerLabelPos .lblpos').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('#drawerLabelPos .lblpos').forEach(x=>{ x.classList.remove('primary'); x.classList.add('ghost'); });
    b.classList.remove('ghost'); b.classList.add('primary');
    // Live-preview placement on an aligned dim that's currently being placed
    if(dimPhase>=1) renderGhostFrame(mousePos);
  }));
  document.getElementById('drawerFillet').addEventListener('input',e=>{
    const v=parseInt(e.target.value,10);
    document.getElementById('drawerFilletVal').textContent=v;
    _orthoFillet=v;
    if(isDrawing) renderGhostFrame(mousePos); else redraw();
  });
  document.getElementById('drawerUndo').onclick=()=>{
    if(isDrawing&&livePts.length>1){livePts.pop();segStyles.pop();renderGhostFrame(mousePos);return;}
    if(isDrawing){cancelPath();return;}
    history.pop(); redraw();
  };
  document.getElementById('drawerClear').onclick=()=>{cancelPath();history=[];redraw();};
  document.getElementById('drawerExport').onclick=()=>{if(isDrawing)commitRebarPath();exportDrawnShape();};

  /* ── Grid controls ── */
  const gridToggleBtn   = document.getElementById('drawerGridToggle');
  const gridSpacingRow  = document.getElementById('drawerGridSpacingRow');
  const gridSpacingEl   = document.getElementById('drawerGridSpacing');
  const gridSpacingVal  = document.getElementById('drawerGridSpacingVal');

  function _syncGridBtn() {
    gridToggleBtn.textContent = _gridVisible ? '▦ Hide Grid' : '▦ Show Grid';
    gridToggleBtn.style.background    = _gridVisible ? 'var(--brand)' : '';
    gridToggleBtn.style.color         = _gridVisible ? '#05131f' : '';
    gridToggleBtn.style.fontWeight    = _gridVisible ? '700' : '';
    gridToggleBtn.style.borderColor   = _gridVisible ? 'var(--brand)' : '';
    gridSpacingRow.style.display      = _gridVisible ? 'flex' : 'none';
  }

  gridToggleBtn.onclick = () => {
    _gridVisible = !_gridVisible;
    _syncGridBtn();
    redraw();
  };

  gridSpacingEl.value = String(_gridSpacing);
  if (gridSpacingVal) gridSpacingVal.textContent = String(_gridSpacing);
  gridSpacingEl.addEventListener('input', () => {
    _gridSpacing = parseInt(gridSpacingEl.value, 10);
    if (gridSpacingVal) gridSpacingVal.textContent = String(_gridSpacing);
    if (_gridVisible) redraw();
  });

  _syncGridBtn();   // reflect current state if re-opened

  /* ── Drag-to-scroll for the tool action bar (mouse) ── */
  const _bar = document.getElementById('toolBtns');
  if (_bar) {
    let _barDrag = false, _barDragX = 0, _barDragScroll = 0;
    _bar.onmousedown = e => {
      if (e.button !== 0) return;
      _barDrag = true; _barDragX = e.pageX; _barDragScroll = _bar.scrollLeft;
      _bar.style.cursor = 'grabbing';
      e.preventDefault();
    };
    if (_bar._onmousemove) document.removeEventListener('mousemove', _bar._onmousemove);
    if (_bar._onmouseup)   document.removeEventListener('mouseup',   _bar._onmouseup);
    _bar._onmousemove = e => {
      if (!_barDrag) return;
      _bar.scrollLeft = _barDragScroll - (e.pageX - _barDragX);
    };
    _bar._onmouseup = () => { _barDrag = false; _bar.style.cursor = ''; };
    document.addEventListener('mousemove', _bar._onmousemove);
    document.addEventListener('mouseup',   _bar._onmouseup);
  }

  setTool('rebar-path'); setStyle('none');
}

/* Responsive layout for phones/tablets: stack the toolbar under a full-width
   canvas (instead of a 192px side rail that squeezes the canvas to a sliver),
   and let the body scroll. Injected once; overrides the desktop inline styles. */
const drawerResponsiveCSS = `
/* ── Canvas: own all touch gestures so tap=add-point, double-tap=finish and
   drags draw, instead of the browser scrolling / zooming / selecting. ── */
#konvaContainer, #konvaContainer canvas {
  touch-action:none; -ms-touch-action:none;
  -webkit-user-select:none; user-select:none; -webkit-touch-callout:none;
}

/* ── Scrollable tool action bar · CAD blueprint palette ───────────────────
   A horizontal rail of icon chips, clustered into labelled groups (Draw /
   Note / Edit) split by dashed dimension-line dividers. Scrolls with snap and
   soft edge fades when the clusters overflow the rail. */
.tool-bar-wrap { position:relative; width:100%; min-width:0; }
.tool-bar-wrap::before, .tool-bar-wrap::after {
  content:""; position:absolute; top:0; bottom:0; width:24px; z-index:3; pointer-events:none;
  transition:opacity .15s ease;
}
.tool-bar-wrap::before { left:0;  background:linear-gradient(90deg, var(--panel) 30%, transparent); }
.tool-bar-wrap::after  { right:0; background:linear-gradient(270deg, var(--panel) 30%, transparent); }
.tool-action-bar {
  display:flex; flex-wrap:nowrap; align-items:stretch; gap:0;
  overflow-x:auto; overflow-y:hidden;
  scroll-snap-type:x proximity; -webkit-overflow-scrolling:touch;
  padding:5px 2px 6px; margin:0; scrollbar-width:none;
}
.tool-action-bar::-webkit-scrollbar { height:0; display:none; }

/* ── Tool cluster: a vertical blueprint label tab + its chip rail ── */
.tool-action-bar .tool-group {
  flex:0 0 auto; display:flex; align-items:stretch; gap:7px;
  padding-right:11px; position:relative;
}
/* Dashed dimension-line divider between clusters (not after the last). */
.tool-action-bar .tool-group + .tool-group { padding-left:11px; }
.tool-action-bar .tool-group:not(:last-child)::after {
  content:""; position:absolute; right:0; top:4px; bottom:4px;
  border-right:1.5px dashed color-mix(in srgb, var(--border) 80%, var(--brand));
  opacity:.7;
}
/* Rotated, monospaced cluster caption — reads like a drawing-sheet tab. */
.tool-action-bar .tg-label {
  flex:0 0 auto; align-self:center;
  writing-mode:vertical-rl; transform:rotate(180deg);
  font-family:ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;
  font-size:8px; font-weight:800; letter-spacing:.22em; text-transform:uppercase;
  color:var(--muted); user-select:none; padding:1px 0;
  border-left:2px solid color-mix(in srgb, var(--brand) 55%, transparent);
}
.tool-action-bar .tool-group-rail { display:flex; gap:6px; }

.tool-action-bar .drawer-tool {
  flex:0 0 auto; scroll-snap-align:start; position:relative; overflow:hidden;
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px;
  width:54px; height:52px; padding:5px 3px;
  border:1px solid var(--border); border-radius:11px;
  background:linear-gradient(180deg, color-mix(in srgb, var(--panel) 100%, #fff 4%), var(--panel));
  color:var(--text); font-family:inherit;
  cursor:pointer; -webkit-tap-highlight-color:transparent;
  box-shadow:0 1px 2px rgba(0,0,0,.06), inset 0 1px 0 rgba(255,255,255,.04);
  transition:transform .12s ease, border-color .12s ease, background .12s ease, box-shadow .12s ease;
}
/* Faint blueprint corner node on every chip — fills in when active. */
.tool-action-bar .drawer-tool::before {
  content:""; position:absolute; top:5px; right:5px; width:4px; height:4px;
  border-radius:50%; border:1px solid var(--border); background:transparent;
  transition:background .12s ease, border-color .12s ease, box-shadow .12s ease;
}
.tool-action-bar .drawer-tool:hover {
  border-color:var(--brand);
  background:linear-gradient(180deg, color-mix(in srgb, var(--brand) 9%, var(--panel)), var(--panel));
  transform:translateY(-1px); box-shadow:0 3px 9px rgba(0,0,0,.12);
}
.tool-action-bar .drawer-tool:active { transform:scale(.95); }
.tool-action-bar .drawer-tool:focus-visible { outline:2px solid var(--brand); outline-offset:2px; }
.tool-action-bar .t-ico { font-size:17px; line-height:1; }
.tool-action-bar .t-lbl {
  font-size:8.5px; font-weight:800; letter-spacing:.03em; text-transform:uppercase;
  color:var(--muted); line-height:1;
}
/* Active tool: setTool() assigns inline background:var(--brand); lift + tint it. */
.tool-action-bar .drawer-tool[style*="var(--brand)"] {
  border-color:var(--brand);
  box-shadow:0 0 0 2px var(--brand), 0 4px 14px color-mix(in srgb, var(--brand) 45%, transparent);
  transform:translateY(-1px);
}
.tool-action-bar .drawer-tool[style*="var(--brand)"]::before {
  background:#05131f; border-color:#05131f; box-shadow:0 0 0 2px color-mix(in srgb, var(--brand) 60%, #fff);
}
.tool-action-bar .drawer-tool[style*="var(--brand)"] .t-lbl { color:#05131f; }

/* ── Tool-contextual control panels (shown by setTool for the active tool) ── */
.drawer-panel {
  display:flex; flex-direction:column; gap:8px;
  border:1px solid var(--border); border-radius:13px;
  background:var(--panel); padding:11px 11px 12px;
  box-shadow:0 10px 26px rgba(0,0,0,.20);
  animation:dpIn .16s cubic-bezier(.2,.7,.3,1);
}
@keyframes dpIn { from { opacity:0; transform:translateY(-7px) scale(.99); } to { opacity:1; transform:none; } }
.drawer-panel-title {
  display:flex; align-items:center; gap:6px;
  font-size:11px; font-weight:800; letter-spacing:.05em; text-transform:uppercase;
  color:var(--brand); padding-bottom:7px; border-bottom:1px solid var(--border);
}
.drawer-panel .dp-sub {
  font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:.1em; font-weight:700;
}
.drawer-panel .dp-divider { height:1px; background:var(--border); margin:2px 0; }
.drawer-panel .dp-hint {
  font-size:9.5px; line-height:1.5; color:var(--muted);
  background:color-mix(in srgb, var(--brand) 7%, transparent);
  border:1px dashed color-mix(in srgb, var(--brand) 35%, var(--border));
  border-radius:7px; padding:6px 8px;
}

/* ── Quick-shape library grid (Shapes tool panel) ──
   minmax(0,1fr) (not bare 1fr) lets the tracks shrink below their content's
   min-width so long shape names ellipsis-clip instead of overflowing the
   panel horizontally. */
.quick-shape-grid {
  display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:5px;
  max-height:230px; overflow-y:auto; overflow-x:hidden; padding-right:2px;
}
.quick-shape-grid .shape-prev-btn {
  display:flex; align-items:center; gap:6px; text-align:left;
  padding:7px 8px; border:1px solid var(--border); border-radius:9px;
  background:linear-gradient(180deg, color-mix(in srgb, var(--panel) 100%, #fff 4%), var(--panel));
  color:var(--text); font-family:inherit; font-size:10.5px; font-weight:600;
  cursor:pointer; -webkit-tap-highlight-color:transparent;
  transition:transform .1s ease, border-color .1s ease, background .1s ease, box-shadow .1s ease;
}
.quick-shape-grid .shape-prev-btn:hover {
  border-color:var(--brand); transform:translateY(-1px);
  background:linear-gradient(180deg, color-mix(in srgb, var(--brand) 10%, var(--panel)), var(--panel));
  box-shadow:0 3px 8px rgba(0,0,0,.12);
}
.quick-shape-grid .shape-prev-btn:active { transform:scale(.96); }
.quick-shape-grid .qs-mark {
  flex:0 0 auto; font-size:12px; color:var(--brand); line-height:1;
}
.quick-shape-grid .qs-name {
  flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}

/* ── Rebar texture swatch grid (Texture tool panel) ── */
.rebar-style-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:5px; }
.rebar-style-grid .rebar-style-btn {
  display:flex; align-items:center; gap:7px; text-align:left;
  padding:7px 9px; border:1px solid var(--border); border-radius:9px;
  background:linear-gradient(180deg, color-mix(in srgb, var(--panel) 100%, #fff 4%), var(--panel));
  color:var(--text); font-family:inherit; font-size:10.5px; font-weight:600;
  cursor:pointer; -webkit-tap-highlight-color:transparent;
  transition:transform .1s ease, border-color .1s ease, background .1s ease, box-shadow .1s ease;
}
.rebar-style-grid .rebar-style-btn:hover {
  border-color:var(--brand); transform:translateY(-1px); box-shadow:0 3px 8px rgba(0,0,0,.12);
}
.rebar-style-grid .rebar-style-btn:active { transform:scale(.96); }
.rebar-style-grid .rs-ico { flex:0 0 auto; font-size:16px; line-height:1; }
.rebar-style-grid .rs-lbl {
  flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}

/* ── Stacked layout at ALL widths — full-width canvas on top, the tool rail and
   contextual panels stacked below it (no left side rail; the user found the
   desktop side rail got in the way). The base .tool-action-bar is already a
   horizontal scrolling rail, so this just stacks the drawer row. ── */
#drawerRow { flex-direction:column !important; overflow:auto !important; flex:0 1 auto; min-height:0; }
#drawerCanvasCol { order:-1; flex:0 0 auto !important; }
/* Definite, CSS-driven canvas height; the Konva stage is sized to match it
   (see _stageSize), so the whole white area is drawable. */
#svgCanvasWrap { height:56vh; }
#drawerSidebar {
  width:100% !important; max-height:none !important;
  border-right:none !important; border-top:1px solid var(--border);
  flex-direction:row !important; flex-wrap:wrap; align-items:flex-start;
  row-gap:10px; column-gap:14px;
}
/* The "Tool" caption leads the stack (above the order:-1 rail/panels). */
#drawerSidebar > div[style*="text-transform:uppercase"] { width:100%; order:-2; }
#drawerSidebar > div[style*="height:1px"] { display:none; }
.tool-bar-wrap { order:-1; width:100%; }
.drawer-panel { width:100%; order:-1; }
#quickShapeList { width:100%; }
.quick-shape-grid, .rebar-style-grid { grid-template-columns:repeat(3,minmax(0,1fr)); max-height:none; }

@media (max-width: 760px) {
  /* Phone: full-screen dialog, taller canvas, bigger touch targets. */
  #shapeDrawerDlg { width:100vw !important; max-width:100vw !important; max-height:100dvh !important; border-radius:0 !important; }
  #shapeDrawerDlg > div { max-height:100dvh !important; }
  #svgCanvasWrap { height:62dvh !important; }
  .tool-action-bar .drawer-tool { width:62px; height:58px; }
  .tool-action-bar .t-ico { font-size:20px; }
  .tool-action-bar .t-lbl { font-size:9.5px; }
  .tool-action-bar .tg-label { font-size:9px; letter-spacing:.18em; }
  .tool-action-bar .tool-group { padding-right:13px; }
  .tool-action-bar .tool-group + .tool-group { padding-left:13px; }
  #drawerSidebar .annot-preset { padding:6px 10px !important; font-size:12px !important; }
  #drawerAnnotText { flex:1 1 160px; }
  .quick-shape-grid .shape-prev-btn, .rebar-style-grid .rebar-style-btn { font-size:11.5px; padding:9px 9px; }
}`;

function ensureDrawerModal() {
  if(!document.getElementById('shapeDrawerStyle')) {
    const st = document.createElement('style');
    st.id = 'shapeDrawerStyle';
    st.textContent = drawerResponsiveCSS;
    document.head.appendChild(st);
  }
  if(!document.getElementById('shapeDrawerDlg'))
    document.body.insertAdjacentHTML('beforeend',drawerHTML);
}

/* ── Shape library ── */
window.SHAPE_LIB      = window.SHAPE_LIB || {};
window.SHAPE_LIB_LIST = window.SHAPE_LIB_LIST || [];

async function loadShapeLibrary() {
  if(window.SHAPE_LIB_LIST.length)return;
  let list=[];
  try{
    const res=await fetch('bbs/shapes.json',{cache:'no-cache'});
    if(res.ok){
      const data=await res.json();
      const fl=(data.shapes||[]).filter(s=>{
        if(!s||!s.id) return false;
        if(s.generator||s.iso) return true;  // parametric/isometric shapes skip segment validation
        if(!Array.isArray(s.segments)||!s.segments.length) return false;
        return s.segments.every(seg=>{
          if(!Array.isArray(seg.pts)||seg.pts.length<2) return false;
          return seg.pts.every(p=>Array.isArray(p)&&p.length>=2&&isFinite(p[0])&&isFinite(p[1]));
        });
      });
      if(fl.length) list=fl;
    }
  }catch(err){console.info('shapes.json not auto-fetched (using built-in fallback).');}
  if(!list.length)list=[{id:'straight',label:'Straight',group:'quick',segments:[{pts:[[0,0.5],[1,0.5]],style:'straight'}]}];
  window.SHAPE_LIB_LIST=list; window.SHAPE_LIB={};
  list.forEach(s=>{window.SHAPE_LIB[s.id]=s;});
}

function applyShapeList(list,sourceLabel){
  const clean=(list||[]).filter(s=>{
    if(!s||!s.id) return false;
    if(s.generator||s.iso) return true;
    if(!Array.isArray(s.segments)||!s.segments.length) return false;
    return s.segments.every(seg=>{
      if(!Array.isArray(seg.pts)||seg.pts.length<2) return false;
      return seg.pts.every(p=>Array.isArray(p)&&p.length>=2&&isFinite(p[0])&&isFinite(p[1]));
    });
  });
  if(!clean.length){alert('No valid shapes found in '+(sourceLabel||'file')+'.');return false;}
  // Merge into existing library: update matching IDs, append new ones
  const merged=[...(window.SHAPE_LIB_LIST||[])];
  clean.forEach(s=>{const i=merged.findIndex(e=>e.id===s.id);if(i>=0)merged[i]=s;else merged.push(s);});
  window.SHAPE_LIB_LIST=merged; window.SHAPE_LIB={};
  merged.forEach(s=>{window.SHAPE_LIB[s.id]=s;}); populateQuickShapes(); return true;
}

function manualLoadShapesJson(){
  const inp=document.createElement('input'); inp.type='file'; inp.accept='.json,application/json';
  inp.onchange=()=>{
    const file=inp.files&&inp.files[0]; if(!file)return;
    const reader=new FileReader();
    reader.onload=()=>{
      try{
        const data=JSON.parse(reader.result);
        const list=Array.isArray(data)?data:Array.isArray(data.shapes)?data.shapes:(data.id?[data]:[]);
        if(applyShapeList(list,file.name)){const btn=document.getElementById('loadShapesBtn');if(btn){const t=btn.textContent;btn.textContent='✓ Loaded';setTimeout(()=>(btn.textContent=t),1500);}}
      }catch(err){alert('Could not parse JSON: '+err.message);}
    };
    reader.onerror=()=>alert('Could not read file.'); reader.readAsText(file);
  };
  inp.click();
}

/* Expand a library shape definition into editable history commands (the same
   command types the drawing tools produce). This lets quick shapes be edited,
   dimensioned and annotated, and makes them export with correct proportions
   (computeHistoryBounds can crop them tightly).
   Returns null for generator/iso defs, which stay as a baked `shape` command. */
function shapeDefToCommands(def, diam, style){
  if(!def || def.generator || def.iso || !def.segments || !def.segments.length) return null;

  // Fit the shape's actual bounding box to the canvas (preserving aspect ratio)
  // rather than stretching the whole 0..1 box across min(w,h). Saved coords only
  // occupy ~84% of that box (export margin) and the canvas is wide, so the old
  // mapping made loaded shapes look small/compressed vs. freshly drawn ones.
  let nMinX=Infinity,nMinY=Infinity,nMaxX=-Infinity,nMaxY=-Infinity;
  const consider=(x,y)=>{if(x<nMinX)nMinX=x;if(x>nMaxX)nMaxX=x;if(y<nMinY)nMinY=y;if(y>nMaxY)nMaxY=y;};
  def.segments.forEach(s=>(s.pts||[]).forEach(p=>consider(p[0],p[1])));
  (def.dims||[]).forEach(dm=>[dm.from,dm.to,dm.vertex,dm.a,dm.b,dm.origin,dm.elbow,dm.text]
    .forEach(p=>{ if(p) consider(p[0],p[1]); }));
  (def.texts||[]).forEach(t=>{ if(t.x!=null) consider(t.x,t.y); });
  if(!isFinite(nMinX)) return null;

  const pad=44, cx=_stageW/2, cy=_stageH/2;
  const availW=_stageW-pad*2, availH=_stageH-pad*2;
  const nbw=(nMaxX-nMinX)||1e-6, nbh=(nMaxY-nMinY)||1e-6;
  const FILL=0.85;   // leave room for dimension lines/labels that sit outside the bbox
  const scale=Math.min(availW/nbw, availH/nbh)*FILL;
  const scx=(nMinX+nMaxX)/2, scy=(nMinY+nMaxY)/2;
  const mapPt=p=>({ x:cx+(p[0]-scx)*scale, y:cy+(p[1]-scy)*scale });

  const cmds=[];
  def.segments.forEach(seg=>{
    if(!seg.pts || seg.pts.length<2) return;
    cmds.push({ type:'rebar-path', points:seg.pts.map(mapPt), bezier:seg.style==='curve', closed:!!seg.closed, diam, style });
  });
  if(!cmds.length) return null;
  (def.dims||[]).forEach(dm=>{
    const sizePx = dm.size!=null ? dm.size*scale : undefined;
    const sizePt = sizePx != null ? Math.round(sizePx / PT_TO_PX) : undefined;
    if(dm.type==='angular'){
      cmds.push({ type:'dim-angular', vertex:mapPt(dm.vertex), ptA:mapPt(dm.a), ptB:mapPt(dm.b), label:dm.label||'', size:sizePt });
    } else if(dm.type==='leader'){
      cmds.push({ type:'dim-leader', origin:mapPt(dm.origin), elbow:mapPt(dm.elbow), textPt:dm.text?mapPt(dm.text):null, label:dm.label||'', size:sizePt });
    } else {
      const a=mapPt(dm.from), b=mapPt(dm.to);
      let offset;
      if(dm.perp!=null){
        offset=dm.perp*scale;
      } else {
        // Legacy [dx,dy] label nudge → signed perpendicular offset (matches _alignedOffset's normal)
        const off=dm.off||[0,0], dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy)||1;
        offset=off[0]*(-dy/len)+off[1]*(dx/len);
      }
      cmds.push({ type:'dim-aligned', p1:a, p2:b, offset, label:dm.label||'', size:sizePt, pos:dm.pos });
    }
  });
  (def.texts||[]).forEach(t=>{
    if(t.x==null) return;
    const p=mapPt([t.x,t.y]);
    cmds.push({ type:'text', x:p.x, y:p.y, text:t.label||'', size: t.size!=null ? Math.round(t.size*scale/PT_TO_PX) : getFontSize() });
  });
  return cmds;
}

function populateQuickShapes(){
  const host=document.getElementById('quickShapeList'); if(!host)return;
  const quick=window.SHAPE_LIB_LIST.filter(s=>(s.group||'quick')==='quick');
  if(!quick.length){host.innerHTML='<span style="font-size:10px;color:var(--muted)">No shapes</span>';return;}
  host.innerHTML=quick.map(s=>`<button class="shape-prev-btn" data-shape="${s.id}" title="${s.label||s.id}"><span class="qs-mark">❖</span><span class="qs-name">${s.label||s.id}</span></button>`).join('');
  host.querySelectorAll('.shape-prev-btn').forEach(b=>b.addEventListener('click',()=>{
    const def=(window.SHAPE_LIB||{})[b.dataset.shape];
    const cmds=shapeDefToCommands(def, getBarSize(), activeStyle);
    history = cmds || [{type:'shape',shape:b.dataset.shape,diam:getBarSize(),style:activeStyle}];
    redraw();
  }));
  const loadBtn=document.getElementById('loadShapesBtn');
  if(loadBtn)loadBtn.onclick=manualLoadShapesJson;
}

/* ── Export canvas as PNG (for "Use Shape") — grid excluded ──
   Crops tightly to the drawn geometry using history-based bounds
   (Konva.getClientRect is unreliable for sceneFunc shapes without
   explicit width/height — they all report {0,0,0,0}).
   Target longest side ~600px; pixelRatio 2–4 keeps files small. */
const EXPORT_TARGET_PX = 600;

function computeHistoryBounds(hist = history) {
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  const grow=(x,y)=>{if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;};
  const pad=(x,y,r)=>{grow(x-r,y-r);grow(x+r,y+r);};
  for (const cmd of hist) {
    if (cmd.type==='shape') {
      // Baked diagram (generator/iso fallback): drawShapeDiagram centres it in
      // a min(sw,sh) square. Crop to that square so the export keeps the shape's
      // proportions instead of inheriting the full (wide) canvas.
      const sp=44, su=Math.min(_stageW-sp*2, _stageH-sp*2);
      grow(_stageW/2-su/2, _stageH/2-su/2); grow(_stageW/2+su/2, _stageH/2+su/2);
      continue;
    }
    const d = cmd.diam||16;
    const r = d * 0.65; // half stroke + rib overhang
    if (cmd.type==='rebar-path'||cmd.type==='ortho-bar') {
      cmd.points.forEach(p=>pad(p.x,p.y,r));
    } else if (cmd.type==='rect') {
      const lx=Math.min(cmd.x,cmd.x+cmd.w), rx=Math.max(cmd.x,cmd.x+cmd.w);
      const ty=Math.min(cmd.y,cmd.y+cmd.h), by=Math.max(cmd.y,cmd.y+cmd.h);
      pad(lx,ty,r); pad(rx,by,r);
    } else if (cmd.type==='circle') {
      grow(cmd.cx-cmd.rx-r,cmd.cy-cmd.ry-r); grow(cmd.cx+cmd.rx+r,cmd.cy+cmd.ry+r);
    } else if (cmd.type==='text') {
      const fsPx=(cmd.size||13)*PT_TO_PX;
      grow(cmd.x-4,cmd.y-4); grow(cmd.x+(cmd.text||'').length*fsPx*0.65+8,cmd.y+fsPx*1.6+4);
    } else if (cmd.type==='dim-aligned') {
      const off=cmd.offset!=null ? Math.abs(cmd.offset) : 28;
      const dx=cmd.p2.x-cmd.p1.x, dy=cmd.p2.y-cmd.p1.y;
      const len=Math.hypot(dx,dy)||1, nx=-dy/len, ny=dx/len;
      const sign=cmd.offset<0?-1:1;
      [cmd.p1,cmd.p2].forEach(p=>{ pad(p.x,p.y,8); pad(p.x+nx*sign*off,p.y+ny*sign*off,8); });
      const mx=(cmd.p1.x+cmd.p2.x)/2+nx*sign*off, my=(cmd.p1.y+cmd.p2.y)/2+ny*sign*off;
      pad(mx,my,50);
    } else if (cmd.type==='dim-angular') {
      const rA = Math.hypot((cmd.ptA||{}).x-(cmd.vertex||{}).x, (cmd.ptA||{}).y-(cmd.vertex||{}).y);
      const rB = Math.hypot((cmd.ptB||{}).x-(cmd.vertex||{}).x, (cmd.ptB||{}).y-(cmd.vertex||{}).y);
      const arcR = Math.min(rA||60, rB||60, 60) * 0.72 + 30;
      [cmd.vertex,cmd.ptA,cmd.ptB].filter(Boolean).forEach(p=>pad(p.x,p.y,arcR));
    } else if (cmd.type==='dim-leader') {
      [cmd.origin,cmd.elbow,cmd.textPt].filter(Boolean).forEach(p=>pad(p.x,p.y,70));
    }
  }
  if (!isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/* Bounds → padded viewBox: tight bbox plus a padding that scales with size
   (floor 20 px). Shared by the vector-model builders. */
function boundsToVb(bounds) {
  const { minX, minY, maxX, maxY } = bounds;
  const bw = maxX-minX, bh = maxY-minY;
  const p = Math.max(20, Math.round(Math.max(bw, bh) * 0.08));
  return [minX-p, minY-p, bw+p*2, bh+p*2];
}

function exportToPNG() {
  if (!_konvaStage) return '';
  const layer = getKonvaLayer();
  if (!layer) return '';

  if (_gridLayer) _gridLayer.hide();

  // Tight crop from history bounds — avoids full-canvas export caused by
  // background Rect inflating layer.getClientRect() to stage size
  let crop = null;
  const bounds = computeHistoryBounds();
  if (bounds) {
    const { minX, minY, maxX, maxY } = bounds;
    const bw = maxX-minX, bh = maxY-minY;
    const p = Math.max(20, Math.round(Math.max(bw, bh) * 0.08));
    const x = Math.max(0, Math.floor(minX-p));
    const y = Math.max(0, Math.floor(minY-p));
    const w = Math.min(_stageW-x, Math.ceil(bw+p*2));
    const h = Math.min(_stageH-y, Math.ceil(bh+p*2));
    if (w > 4 && h > 4) crop = { x, y, width:w, height:h };
  }

  const maxSide = crop ? Math.max(crop.width, crop.height) : Math.max(_stageW, _stageH);
  const pixelRatio = Math.min(4, Math.max(2, +(EXPORT_TARGET_PX / maxSide).toFixed(2)));

  // White background behind the (possibly transparent) shape
  const bg = new Konva.Rect({ x:0, y:0, width:_stageW, height:_stageH, fill:'#fff' });
  layer.add(bg); bg.moveToBottom(); layer.draw();

  const dataURL = _konvaStage.toDataURL(
    Object.assign({ mimeType:'image/png', pixelRatio }, crop || {})
  );

  bg.destroy(); layer.draw();
  if (_gridLayer) _gridLayer.show();
  drawGrid();
  return dataURL;
}

/* ── Export drawing as a compact VECTOR model (for "Use Shape") ──
   Walks `history` and emits geometry primitives consumed by ShapeVector
   (SVG on screen, native vector in the PDF). Produces a clean centreline
   rendering — the bar as a stroked polyline/curve plus dims & text — rather
   than the ribbed raster look, keeping files tiny. Returns null when the
   drawing can only be produced as a baked raster diagram (generator/iso
   library shapes), so the caller can fall back to exportToPNG(). */
const DIM_GRAY = '#000000';
const PX_PER_PT = 4 / 3; // CSS px per typographic pt (96 dpi / 72 pt per inch)

function _barLW(diam) { return Math.max(2, Math.min(6, (diam || 16) * 0.18)); }

function _arrowPoly(px, py, ax, ay, flip, size) {
  const s = (size || DIM_BASE) / DIM_BASE;
  const aw = 9 * s, ah = 3.5 * s;
  return { k:'fill', col:DIM_GRAY, d:[
    [px, py],
    [px - ax*aw*flip + ay*ah*flip, py - ay*aw*flip - ax*ah*flip],
    [px - ax*aw*flip - ay*ah*flip, py - ay*aw*flip + ax*ah*flip],
  ]};
}

/* Rotated white label box + centred text, mirroring _dimLabel() */
function _labelEls(mx, my, label, angle, size, pos) {
  const fs = size || DIM_BASE;
  const a = ((angle % (Math.PI*2)) + Math.PI*2) % (Math.PI*2);
  const rot = (a > Math.PI/2 && a < Math.PI*1.5) ? angle + Math.PI : angle;
  const tw = label.length * fs * 0.6 + fs * 0.7;
  const bh = fs * 0.82;
  // Same reading-up perpendicular offset as the on-screen _dimLabel.
  const sgn = pos === 'below' ? -1 : pos === 'above' ? 1 : 0;
  const gap = sgn * (bh + 2);
  const lx0 = mx + Math.sin(rot)*gap, ly0 = my - Math.cos(rot)*gap;
  const c = Math.cos(rot), s = Math.sin(rot);
  const corner = (lx, ly) => [lx0 + lx*c - ly*s, ly0 + lx*s + ly*c];
  return [
    { k:'fill', col:'#fff', d:[corner(-tw/2,-bh), corner(tw/2,-bh), corner(tw/2,bh), corner(-tw/2,bh)] },
    { k:'text', x:lx0, y:ly0, t:label, sz: Math.round(fs / PX_PER_PT), ang:rot, col:DIM_GRAY, anchor:'c' },
  ];
}

function _dotPoly(cx, cy, r) {
  const d = [];
  for (let i = 0; i < 10; i++) { const a = i/10*Math.PI*2; d.push([cx+Math.cos(a)*r, cy+Math.sin(a)*r]); }
  return { k:'fill', col:DIM_GRAY, d };
}

function _emitAligned(out, p1, p2, offset, label, size, pos) {
  const dx = p2.x-p1.x, dy = p2.y-p1.y, len = Math.hypot(dx, dy);
  if (len < 4) return;
  const ax = dx/len, ay = dy/len, nx = -ay, ny = ax;
  const off = offset != null ? offset : 30;
  const d1 = { x:p1.x+nx*off, y:p1.y+ny*off }, d2 = { x:p2.x+nx*off, y:p2.y+ny*off };
  const ext = 6, base = off > 1 ? 3 : 0;
  out.push({ k:'line', col:DIM_GRAY, lw:1.2, a:[p1.x+nx*base, p1.y+ny*base], b:[d1.x+nx*ext, d1.y+ny*ext] });
  out.push({ k:'line', col:DIM_GRAY, lw:1.2, a:[p2.x+nx*base, p2.y+ny*base], b:[d2.x+nx*ext, d2.y+ny*ext] });
  out.push({ k:'line', col:DIM_GRAY, lw:1.2, a:[d1.x, d1.y], b:[d2.x, d2.y] });
  out.push(_arrowPoly(d1.x, d1.y, ax, ay, -1, size));
  out.push(_arrowPoly(d2.x, d2.y, ax, ay,  1, size));
  if (label) _labelEls((d1.x+d2.x)/2, (d1.y+d2.y)/2, label, Math.atan2(dy, dx), size, pos || 'above').forEach(e => out.push(e));
}

function _emitAngular(out, vertex, ptA, ptB, label, size, pos) {
  const rA = Math.hypot(ptA.x-vertex.x, ptA.y-vertex.y);
  const rB = Math.hypot(ptB.x-vertex.x, ptB.y-vertex.y);
  const r = Math.min(rA, rB, 60) * 0.72 + 20;
  const aA = Math.atan2(ptA.y-vertex.y, ptA.x-vertex.x);
  const aB = Math.atan2(ptB.y-vertex.y, ptB.x-vertex.x);
  let sweep = aB - aA;
  while (sweep >  Math.PI) sweep -= Math.PI*2;
  while (sweep < -Math.PI) sweep += Math.PI*2;
  const aEnd = aA + sweep;
  const lbl = label || (Math.abs(sweep*180/Math.PI).toFixed(1) + '°');
  out.push({ k:'line', col:DIM_GRAY, lw:1.2, dash:true, a:[vertex.x, vertex.y], b:[vertex.x+Math.cos(aA)*r*1.25, vertex.y+Math.sin(aA)*r*1.25] });
  out.push({ k:'line', col:DIM_GRAY, lw:1.2, dash:true, a:[vertex.x, vertex.y], b:[vertex.x+Math.cos(aEnd)*r*1.25, vertex.y+Math.sin(aEnd)*r*1.25] });
  const steps = Math.max(8, Math.ceil(Math.abs(sweep)/0.18)), arc = [];
  for (let i = 0; i <= steps; i++) { const a = aA + sweep*(i/steps); arc.push([vertex.x+Math.cos(a)*r, vertex.y+Math.sin(a)*r]); }
  out.push({ k:'path', col:DIM_GRAY, lw:1.2, d:arc });
  const arrowAng = aEnd + (sweep > 0 ? Math.PI/2 : -Math.PI/2);
  out.push(_arrowPoly(vertex.x+Math.cos(aEnd)*r, vertex.y+Math.sin(aEnd)*r, Math.cos(arrowAng), Math.sin(arrowAng), 1, size));
  const aMid = aA + sweep/2;
  _labelEls(vertex.x+Math.cos(aMid)*r, vertex.y+Math.sin(aMid)*r, lbl, aMid+Math.PI/2, size, pos || 'on').forEach(e => out.push(e));
  out.push(_dotPoly(vertex.x, vertex.y, 3));
}

function _emitLeader(out, origin, elbow, textPt, label, size, pos) {
  const lbl = label || 'Label', fs = size || DIM_BASE, bh = fs*0.82;
  out.push({ k:'line', col:DIM_GRAY, lw:1.2, a:[origin.x, origin.y], b:[elbow.x, elbow.y] });
  if (textPt) out.push({ k:'line', col:DIM_GRAY, lw:1.2, a:[elbow.x, elbow.y], b:[textPt.x, textPt.y] });
  const dx = elbow.x-origin.x, dy = elbow.y-origin.y, len = Math.hypot(dx, dy);
  if (len > 4) out.push(_arrowPoly(origin.x, origin.y, dx/len, dy/len, -1, size));
  const tx = textPt ? textPt.x : elbow.x+20, ty = textPt ? textPt.y : elbow.y;
  const sgn = pos === 'above' ? 1 : pos === 'below' ? -1 : 0;
  const ety = ty - sgn * (bh + 2);
  const tw = lbl.length*fs*0.6 + fs*0.7;
  out.push({ k:'fill', col:'#fff', d:[[tx+2,ety-bh],[tx+2+tw,ety-bh],[tx+2+tw,ety+bh],[tx+2,ety+bh]] });
  out.push({ k:'text', x:tx+6, y:ety, t:lbl, sz: Math.round(fs / PX_PER_PT), col:DIM_GRAY, anchor:'l' });
  if (pos === 'below') {
    out.push({ k:'line', col:DIM_GRAY, lw:1.2, a:[tx+2, ety-bh], b:[tx+2+tw, ety-bh] });
  } else if (pos !== 'on') {
    out.push({ k:'line', col:DIM_GRAY, lw:1.2, a:[tx+2, ety+bh], b:[tx+2+tw, ety+bh] });
  }
}

function buildVectorModel() {
  // Delegates to buildVectorModelFrom() — the bodies are identical apart from
  // reading the module's live `history` rather than a caller-supplied array.
  return buildVectorModelFrom(history);
}

/* ── TEXTURED vector model ──
   Reproduces the ribbed/3D rebar look as vector primitives (no raster):
   a thick body stroke, a white sheen offset upward, evenly spaced rib
   strokes, and a hairline outline — mirroring strokeRebarPath /
   drawRibsAlongSamples exactly, traced along the same path samples used
   on screen. Bigger than the clean model (more primitives) but still
   vector, so PDFs stay far smaller than embedding PNGs. */
function _emitRibs(el, samples, diam, cfg) {
  const r = diam/2, sp = cfg.ribSpacing*(diam/16), ribH = diam*0.22, ribW = diam*cfg.ribWidth;
  const ribAngRad = cfg.ribAngle*Math.PI/180;
  let dist = sp*0.4, ribIndex = 0;
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i-1], curr = samples[i];
    const segLen = Math.hypot(curr.x-prev.x, curr.y-prev.y);
    if (segLen < 0.001) continue;
    dist += segLen;
    while (dist >= sp) {
      dist -= sp;
      const t = 1 - dist/segLen;
      const px = prev.x + (curr.x-prev.x)*t, py = prev.y + (curr.y-prev.y)*t;
      let ux = prev.ux + ((curr.ux-prev.ux)*Math.max(0,Math.min(1,t)));
      let uy = prev.uy + ((curr.uy-prev.uy)*Math.max(0,Math.min(1,t)));
      const tlen = Math.hypot(ux, uy);
      if (tlen > 0.001) { ux /= tlen; uy /= tlen; } else { ux = 1; uy = 0; }
      const flip = (cfg.alternate && ribIndex % 2 === 0) ? 1 : -1;
      const rAngle = Math.atan2(uy, ux) + (cfg.ribAngle === 90 ? Math.PI/2 : ribAngRad*flip);
      const rdx = Math.cos(rAngle), rdy = Math.sin(rAngle), halfLen = r + ribH*0.6;
      el.push({ k:'line', col:GRAY.rib, lw:ribW, a:[px-rdx*halfLen, py-rdy*halfLen], b:[px+rdx*halfLen, py+rdy*halfLen] });
      const hox = -rdy*ribW*0.35, hoy = rdx*ribW*0.35;
      el.push({ k:'line', col:GRAY.ribHi, lw:ribW*0.4, a:[px-rdx*halfLen+hox, py-rdy*halfLen+hoy], b:[px+rdx*halfLen+hox, py+rdy*halfLen+hoy] });
      ribIndex++;
    }
  }
}

/* Douglas–Peucker: drop samples that don't change the polyline shape. The
   stroked body/sheen/outline don't need 2 px resolution; ribs still use the
   full sample set for exact placement. Keeps the textured PDF light. */
function _simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length-1] = true;
  const stack = [[0, pts.length-1]];
  const t2 = tol*tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax=pts[a].x, ay=pts[a].y, bx=pts[b].x, by=pts[b].y;
    const dx=bx-ax, dy=by-ay, len2=dx*dx+dy*dy || 1;
    let maxD=-1, idx=-1;
    for (let i=a+1; i<b; i++) {
      const t=((pts[i].x-ax)*dx + (pts[i].y-ay)*dy)/len2;
      const px=ax+t*dx, py=ay+t*dy;
      const dd=(pts[i].x-px)**2 + (pts[i].y-py)**2;
      if (dd>maxD) { maxD=dd; idx=i; }
    }
    if (maxD > t2 && idx > 0) { keep[idx]=true; stack.push([a,idx],[idx,b]); }
  }
  return pts.filter((_,i)=>keep[i]);
}

function _emitTexturedBar(el, samples, diam, styleId, closed) {
  if (!samples || samples.length < 2) return;
  const cfg = REBAR_STYLES.find(s => s.id === styleId) || REBAR_STYLES[0];
  const d = Math.max(diam || 14, 4);
  const rnd = n => Math.round(n*10)/10;
  const simp = _simplify(samples, 1.5);
  const line = simp.map(s => [rnd(s.x), rnd(s.y)]);
  /* No-texture style: a single flat centreline, no body/sheen/ribs. */
  if (cfg.line) { el.push({ k:'path', d:line, cl:closed, col:'#000000', lw:_barLW(d) }); return; }
  el.push({ k:'path', d:line, cl:closed, col:GRAY.body, lw:d });                                  // body
  if (cfg.ribSpacing > 0) {
    el.push({ k:'path', d:simp.map(s => [rnd(s.x), rnd(s.y - d*0.32)]), cl:closed, col:GRAY.hi, lw:d*0.28 }); // sheen
    if (d >= 5) _emitRibs(el, samples, d, cfg);                                                     // ribs
  }
  el.push({ k:'path', d:line, cl:closed, col:GRAY.edge, lw:0.8 });                                 // outline
}

/* geometry samples for one bar command, matching how renderCmd draws it */
function _barSamples(cmd, d) {
  if (cmd.type === 'rebar-path')
    return (cmd.bezier ? buildSplineGeometry(cmd.points, cmd.closed) : buildFilletGeometry(cmd.points, d, cmd.closed)).samples;
  if (cmd.type === 'ortho-bar')
    return buildOrthoGeometry(cmd.closed ? [...cmd.points, cmd.points[0]] : cmd.points, d, cmd.fillet != null ? cmd.fillet : _orthoFillet).samples;
  if (cmd.type === 'rect') {
    const lx=Math.min(cmd.x,cmd.x+cmd.w), rx=Math.max(cmd.x,cmd.x+cmd.w), ty=Math.min(cmd.y,cmd.y+cmd.h), by=Math.max(cmd.y,cmd.y+cmd.h);
    const c=[{x:lx,y:ty},{x:rx,y:ty},{x:rx,y:by},{x:lx,y:by}];
    return buildOrthoGeometry([...c, c[0]], d).samples;
  }
  if (cmd.type === 'circle') {
    const steps=Math.max(36,Math.round((cmd.rx+cmd.ry)*0.9)), pts=[];
    for(let i=0;i<steps;i++){const a=i/steps*Math.PI*2; pts.push({x:cmd.cx+Math.cos(a)*cmd.rx, y:cmd.cy+Math.sin(a)*cmd.ry});}
    return buildSplineGeometry(pts, true).samples;
  }
  return null;
}

function buildTexturedModel(hist) {
  if (!hist || !hist.length) return null;
  if (hist.some(c => c.type === 'shape')) return null;
  const bounds = computeHistoryBounds(hist);
  if (!bounds) return null;
  const vb = boundsToVb(bounds);

  const el = [];
  for (const cmd of hist) {
    const d = cmd.diam || 16;
    if (cmd.type==='rebar-path' || cmd.type==='ortho-bar' || cmd.type==='rect' || cmd.type==='circle') {
      const samples = _barSamples(cmd, d);
      const closed = cmd.type==='rect' ? true : !!cmd.closed;
      _emitTexturedBar(el, samples, d, cmd.style || activeStyle, closed);
    } else if (cmd.type === 'text') {
      el.push({ k:'text', x:cmd.x, y:cmd.y + (cmd.size||13)*PT_TO_PX*0.5, t:cmd.text||'', sz: cmd.size||13, col:DIM_GRAY, anchor:'l' });
    } else if (cmd.type === 'dim-aligned') {
      _emitAligned(el, cmd.p1, cmd.p2, cmd.offset, cmd.label||'', (cmd.size||DIM_BASE_PT)*PT_TO_PX, cmd.pos);
    } else if (cmd.type === 'dim-angular') {
      _emitAngular(el, cmd.vertex, cmd.ptA, cmd.ptB, cmd.label||'', (cmd.size||DIM_BASE_PT)*PT_TO_PX, cmd.pos);
    } else if (cmd.type === 'dim-leader') {
      _emitLeader(el, cmd.origin, cmd.elbow, cmd.textPt||null, cmd.label||'', (cmd.size||DIM_BASE_PT)*PT_TO_PX, cmd.pos);
    }
  }
  if (!el.length) return null;
  return { vb, el };
}

/* Like buildVectorModel() but takes history as a parameter so it can be
   called from outside the drawer (e.g. to regenerate stale shapeVec on old
   saved rows whose vb was the full canvas rather than the tight bbox). */
function buildVectorModelFrom(hist) {
  if (!hist || !hist.length) return null;
  if (hist.some(c => c.type === 'shape')) return null;
  const bounds = computeHistoryBounds(hist);
  if (!bounds) return null;
  const vb = boundsToVb(bounds);

  const el = [];
  for (const cmd of hist) {
    const d = cmd.diam || 16, lw = _barLW(d);
    if (cmd.type === 'rebar-path') {
      const pts = cmd.points || [];
      if (pts.length < 2) continue;
      if (cmd.bezier) {
        const n = pts.length, T = 0.2;
        const ext = cmd.closed ? [...pts, pts[0], pts[1]] : [pts[0], ...pts, pts[n-1]];
        const segCount = cmd.closed ? n : n-1;
        const s = [];
        for (let i = 0; i < segCount; i++) {
          const P0=ext[i], P1=ext[i+1], P2=ext[i+2], P3=ext[i+3]||ext[i+2];
          s.push([P1.x+T*(P2.x-P0.x), P1.y+T*(P2.y-P0.y), P2.x-T*(P3.x-P1.x), P2.y-T*(P3.y-P1.y), P2.x, P2.y]);
        }
        el.push({ k:'bez', m:[pts[0].x, pts[0].y], s, cl:!!cmd.closed, col:'#000000', lw });
      } else {
        el.push({ k:'path', d:pts.map(q => [q.x, q.y]), cl:!!cmd.closed, col:'#000000', lw });
      }
    } else if (cmd.type === 'ortho-bar') {
      const pts = cmd.points || [];
      if (pts.length < 2) continue;
      const fillet = cmd.fillet != null ? cmd.fillet : 0;
      const barPts = cmd.closed ? [...pts, pts[0]] : pts;
      const { samples } = buildOrthoGeometry(barPts, d, fillet);
      el.push({ k:'path', d: _simplify(samples, 0.3).map(s => [s.x, s.y]), cl: !!cmd.closed, col:'#000000', lw });
    } else if (cmd.type === 'rect') {
      const x = Math.min(cmd.x, cmd.x+cmd.w), y = Math.min(cmd.y, cmd.y+cmd.h);
      el.push({ k:'rect', x, y, w:Math.abs(cmd.w), h:Math.abs(cmd.h), col:'#000000', lw });
    } else if (cmd.type === 'circle') {
      el.push({ k:'ell', cx:cmd.cx, cy:cmd.cy, rx:cmd.rx, ry:cmd.ry, col:'#000000', lw });
    } else if (cmd.type === 'text') {
      el.push({ k:'text', x:cmd.x, y:cmd.y + (cmd.size||13)*PT_TO_PX*0.5, t:cmd.text||'', sz: cmd.size||13, col:DIM_GRAY, anchor:'l' });
    } else if (cmd.type === 'dim-aligned') {
      _emitAligned(el, cmd.p1, cmd.p2, cmd.offset, cmd.label||'', (cmd.size||DIM_BASE_PT)*PT_TO_PX, cmd.pos);
    } else if (cmd.type === 'dim-angular') {
      _emitAngular(el, cmd.vertex, cmd.ptA, cmd.ptB, cmd.label||'', (cmd.size||DIM_BASE_PT)*PT_TO_PX, cmd.pos);
    } else if (cmd.type === 'dim-leader') {
      _emitLeader(el, cmd.origin, cmd.elbow, cmd.textPt||null, cmd.label||'', (cmd.size||DIM_BASE_PT)*PT_TO_PX, cmd.pos);
    }
  }
  if (!el.length) return null;
  return { vb, el };
}

window.ShapeDrawer = {
  buildTexturedModel,
  buildVectorModelFrom,
  async open(callback, opts) {
    ensureDrawerModal();
    await loadShapeLibrary();
    drawerCallback=callback;
    /* Load a previously saved drawing so it can be edited (set before
       initDrawer runs, which seeds `history` from it). */
    _pendingHistory = (opts && Array.isArray(opts.history) && opts.history.length)
      ? JSON.parse(JSON.stringify(opts.history)) : null;
    const dlg=document.getElementById('shapeDrawerDlg');
    dlg.showModal();
    setTimeout(()=>{
      initDrawer(); populateQuickShapes();
      /* Optional initial texture (e.g. cross-section sketches default to the
         flat "no texture" line style). initDrawer() ends on setStyle('tor'). */
      if (opts && opts.style) setStyle(opts.style);
    },60);
    document.getElementById('drawerDone').onclick=()=>{
      if(isDrawing)commitRebarPath();
      // Prefer a compact vector model; fall back to raster for baked diagrams.
      // Also hand back the raw geometry so a textured-vector model can be
      // rebuilt on demand at PDF-export time (without storing pixels).
      const vec = buildVectorModel();
      const result = vec
        ? { vec, hist: JSON.parse(JSON.stringify(history)) }
        : { img: exportToPNG() };
      dlg.close();
      if(_stageResizeObserver){_stageResizeObserver.disconnect();_stageResizeObserver=null;}
      if(drawerCallback)drawerCallback(result);
      document.removeEventListener('keydown',onKeyDown);
    };
    document.getElementById('drawerCancel').onclick=()=>{
      cancelPath(); dlg.close();
    };
    /* Clean up on any close path (button clicks, Escape, or programmatic).
       The dialog's 'close' event fires exactly once per close. */
    dlg.addEventListener('close', ()=>{
      document.removeEventListener('keydown',onKeyDown);
      if(_stageResizeObserver){_stageResizeObserver.disconnect();_stageResizeObserver=null;}
    }, { once:true });
  }
};
