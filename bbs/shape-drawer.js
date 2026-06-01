/* =========================================================
   Shape Drawer — Konva-powered rebar renderer
   Replaces manual Bézier/spline/ortho geometry with Konva's
   built-in tension-based Catmull-Rom Line.
   ========================================================= */

/* ── Load Konva lazily (injected into index.html via script tag) ── */

const REBAR_STYLES = [
  { id:'tor',        label:'⟋ TOR / Diagonal Rib', ribAngle:-40, ribSpacing:22, ribWidth:0.35, alternate:false },
  { id:'horizontal', label:'⊟ Horizontal Rib',      ribAngle:90,  ribSpacing:18, ribWidth:0.25, alternate:false },
  { id:'cross',      label:'✕ Cross Rib',            ribAngle:-40, ribSpacing:20, ribWidth:0.30, alternate:true  },
  { id:'plain',      label:'▬ Plain / MS Bar',       ribAngle:0,   ribSpacing:0,  ribWidth:0,    alternate:false },
];

const GRAY = {
  body:  '#303030',
  hi:    '#ffffff',
  edge:  '#303030',
  rib:   '#303030',
  ribHi: '#ffffff',
  dim:   '#303030',
  bg:    '#ffffff',
};

const BEND_TENSION  = 0.4;   // Catmull-Rom tension for 'bend' style
const CURVE_TENSION = 0.4;   // tension for 'curve' style

/* =====================================================
   KONVA STAGE — one stage per canvas element
   ===================================================== */
let _konvaStage  = null;   // Konva.Stage (drawer)
let _konvaLayer  = null;   // Konva.Layer  (drawer)

function getKonvaLayer() { return _konvaLayer; }

function initKonvaStage(containerEl, width, height) {
  if (typeof Konva === 'undefined') throw new Error('Konva not loaded — check bbs/konva.min.js script tag.');
  if (_konvaStage) { _konvaStage.destroy(); _konvaStage = null; _konvaLayer = null; }
  _konvaStage = new Konva.Stage({ container: containerEl, width, height });
  _konvaLayer = new Konva.Layer();
  _konvaStage.add(_konvaLayer);
  return _konvaLayer;
}

/* =====================================================
   REBAR PATH — build a Konva.Group with body + highlight
   + optional ribs drawn via canvas2d on a custom shape.

   style: 'bend' | 'curve' | 'straight'
   ===================================================== */
function makeRebarGroup(points, diam, style, closed) {
  const d       = diam || 14;
  const tension = (style === 'straight') ? 0 : BEND_TENSION;
  const flatPts = points.flatMap(p => [p.x, p.y]);

  const group = new Konva.Group();

  /* ── Body ── */
  const body = new Konva.Line({
    points:   flatPts,
    stroke:   GRAY.body,
    strokeWidth: d,
    lineCap:  'round',
    lineJoin: 'round',
    tension,
    closed,
  });

  /* ── Highlight (white stripe via offset shadow trick) ── */
  const hi = new Konva.Line({
    points:    flatPts,
    stroke:    GRAY.hi,
    strokeWidth: d * 0.28,
    lineCap:   'round',
    lineJoin:  'round',
    tension,
    closed,
    shadowColor:   GRAY.hi,
    shadowOffsetX: 0,
    shadowOffsetY: -d * 0.32,
    shadowBlur:    0,
    shadowEnabled: true,
  });

  /* ── Ribs (canvas2d custom shape so we can sample along path) ── */
  const styleId = window._drawerActiveStyle || 'tor';
  const cfg     = REBAR_STYLES.find(s => s.id === styleId) || REBAR_STYLES[0];

  if (cfg.ribSpacing > 0 && d >= 5) {
    // Sample along the polyline/spline to get rib placement points + tangents.
    // For Konva tension lines we approximate by sampling the cubic Bézier
    // segments that Konva would draw (same Catmull-Rom formula).
    const samples = sampleKonvaLine(points, tension, closed);
    const ribShape = new Konva.Shape({
      sceneFunc(ctx) {
        drawRibsAlongSamples(ctx._context || ctx, samples, d, cfg);
      },
    });
    group.add(body, hi, ribShape);
  } else {
    group.add(body, hi);
  }

  /* ── Hairline outline ── */
  const outline = new Konva.Line({
    points:   flatPts,
    stroke:   GRAY.edge,
    strokeWidth: 0.8,
    lineCap:  'round',
    lineJoin: 'round',
    tension,
    closed,
  });
  group.add(outline);

  return group;
}

/* =====================================================
   SAMPLE KONVA TENSION LINE
   Reproduce Konva's Catmull-Rom → cubic Bézier conversion
   to get dense {x,y} samples for rib placement.
   ===================================================== */
function sampleKonvaLine(points, tension, closed) {
  const STEP = 2;
  const n    = points.length;
  if (n < 2) return [];
  if (tension === 0) {
    // Straight polyline — just interpolate linearly
    const samples = [];
    const pts = closed ? [...points, points[0]] : points;
    for (let i = 1; i < pts.length; i++) {
      const x0 = pts[i-1].x, y0 = pts[i-1].y;
      const x1 = pts[i].x,   y1 = pts[i].y;
      const d  = Math.hypot(x1-x0, y1-y0);
      const steps = Math.max(1, Math.ceil(d / STEP));
      for (let s = (i === 1 ? 0 : 1); s <= steps; s++) {
        const t = s / steps;
        samples.push({ x: x0 + (x1-x0)*t, y: y0 + (y1-y0)*t });
      }
    }
    return samples;
  }

  // Konva uses tension * 0.5 internally on the t parameter
  const T = tension * 0.5;
  const pts = closed
    ? [...points, points[0], points[1]]
    : [points[0], ...points, points[n-1]];

  const samples = [{ x: points[0].x, y: points[0].y }];
  const segCount = closed ? n : n - 1;

  for (let i = 0; i < segCount; i++) {
    const P0 = pts[i], P1 = pts[i+1], P2 = pts[i+2], P3 = pts[i+3] || pts[i+2];
    const cp1 = {
      x: P1.x + T * (P2.x - P0.x),
      y: P1.y + T * (P2.y - P0.y),
    };
    const cp2 = {
      x: P2.x - T * (P3.x - P1.x),
      y: P2.y - T * (P3.y - P1.y),
    };
    const segLen = Math.hypot(P2.x-P1.x, P2.y-P1.y);
    const steps  = Math.max(12, Math.ceil(segLen / STEP));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps, mt = 1 - t;
      samples.push({
        x: mt*mt*mt*P1.x + 3*mt*mt*t*cp1.x + 3*mt*t*t*cp2.x + t*t*t*P2.x,
        y: mt*mt*mt*P1.y + 3*mt*mt*t*cp1.y + 3*mt*t*t*cp2.y + t*t*t*P2.y,
      });
    }
  }
  return samples;
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
   Bend radius = ORTHO_BEND_FACTOR x bar-diameter,
   clamped so it never exceeds half of either adjacent
   segment length.  Returns { path: Path2D, samples }.
   ===================================================== */
const ORTHO_BEND_FACTOR = 3.5;

function buildOrthoGeometry(points, diam) {
  const STEP = 2;
  const n    = points.length;
  if (n < 2) return { path: new Path2D(), samples: [] };

  const R    = Math.max(6, (diam || 16) * ORTHO_BEND_FACTOR);
  const path = new Path2D();
  const samples = [];

  /* segment lengths for radius clamping */
  const segLen = [];
  for (let i = 0; i < n - 1; i++)
    segLen.push(Math.hypot(points[i+1].x - points[i].x, points[i+1].y - points[i].y));

  function sampleLineTo(x0, y0, x1, y1) {
    const d = Math.hypot(x1-x0, y1-y0);
    if (d < 0.001) return;
    const steps = Math.max(1, Math.ceil(d / STEP));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      samples.push({ x: x0 + (x1-x0)*t, y: y0 + (y1-y0)*t });
    }
  }

  function sampleArcTo(cx, cy, r, a0, a1) {
    let sweep = a1 - a0;
    while (sweep >  Math.PI) sweep -= Math.PI * 2;
    while (sweep < -Math.PI) sweep += Math.PI * 2;
    if (Math.abs(sweep) < 1e-4) return;
    const steps = Math.max(4, Math.ceil(r * Math.abs(sweep) / STEP));
    for (let s = 1; s <= steps; s++) {
      const a = a0 + sweep * (s / steps);
      samples.push({ x: cx + Math.cos(a)*r, y: cy + Math.sin(a)*r });
    }
  }

  path.moveTo(points[0].x, points[0].y);
  samples.push({ x: points[0].x, y: points[0].y });
  let curX = points[0].x, curY = points[0].y;

  for (let i = 0; i < n - 1; i++) {
    const P0 = points[i];
    const P1 = points[i + 1];

    if (i === n - 2) {
      /* last segment straight to end, no arc after */
      path.lineTo(P1.x, P1.y);
      sampleLineTo(curX, curY, P1.x, P1.y);
      break;
    }

    const P2 = points[i + 2];
    const r  = Math.min(R, segLen[i] / 2, segLen[i+1] / 2);

    const d1 = segLen[i], d2 = segLen[i+1];
    const u1x = (P1.x - P0.x) / d1, u1y = (P1.y - P0.y) / d1;
    const u2x = (P2.x - P1.x) / d2, u2y = (P2.y - P1.y) / d2;
    const T1  = { x: P1.x - u1x * r, y: P1.y - u1y * r };
    const T2  = { x: P1.x + u2x * r, y: P1.y + u2y * r };

    /* arc centre exact for 90deg ortho turns */
    const acx = T1.x + (T2.x - P1.x);
    const acy = T1.y + (T2.y - P1.y);
    const a0  = Math.atan2(T1.y - acy, T1.x - acx);
    const a1  = Math.atan2(T2.y - acy, T2.x - acx);

    path.lineTo(T1.x, T1.y);
    sampleLineTo(curX, curY, T1.x, T1.y);

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

      /* 1 body */
      c.strokeStyle = GRAY.body;
      c.lineWidth   = d;
      c.stroke(path);

      /* 2 highlight */
      c.strokeStyle   = GRAY.hi;
      c.lineWidth     = d * 0.28;
      c.shadowColor   = GRAY.hi;
      c.shadowOffsetX = 0;
      c.shadowOffsetY = -d * 0.32;
      c.shadowBlur    = 0;
      c.stroke(path);
      c.shadowColor   = 'transparent';
      c.shadowOffsetY = 0;

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

  const tangents = [];
  for (let i = 0; i < samples.length; i++) {
    const i0 = Math.max(0, i - 3), i1 = Math.min(samples.length - 1, i + 3);
    const dx = samples[i1].x - samples[i0].x, dy = samples[i1].y - samples[i0].y;
    const len = Math.hypot(dx, dy);
    tangents.push(len > 0.001 ? { ux: dx/len, uy: dy/len } : { ux: 1, uy: 0 });
  }

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
      const { ux, uy } = tangents[i];
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
   LEGACY CANVAS2D API  (used by drawShapeDiagram which
   renders to an off-screen canvas for the thumbnail)
   ===================================================== */
function drawRebarPath(ctx, points, diam, closed) {
  _drawRebarCtx(ctx, points, diam, closed, CURVE_TENSION);
}
function drawRebarStraight(ctx, points, diam, closed) {
  /* Use exact ortho geometry (straight segs + arc fillets), not tension curve */
  if (!points || points.length < 2) return;
  const d    = Math.max(diam || 14, 4);
  const style= window._drawerActiveStyle || 'tor';
  const cfg  = REBAR_STYLES.find(s => s.id === style) || REBAR_STYLES[0];
  const pts  = closed ? [...points, points[0]] : points;
  const { path, samples } = buildOrthoGeometry(pts, d);

  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = GRAY.body; ctx.lineWidth = d; ctx.stroke(path);
  ctx.strokeStyle = GRAY.hi;   ctx.lineWidth = d * 0.28;
  ctx.shadowColor = GRAY.hi;   ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = -d * 0.32; ctx.shadowBlur = 0;
  ctx.stroke(path);
  ctx.shadowColor = 'transparent'; ctx.shadowOffsetY = 0;
  if (cfg.ribSpacing > 0 && d >= 5) drawRibsAlongSamples(ctx, samples, d, cfg);
  ctx.strokeStyle = GRAY.edge; ctx.lineWidth = 0.8; ctx.stroke(path);
  ctx.restore();
}
function drawRebarStraightPolyline(ctx, points, diam, closed) {
  _drawRebarCtx(ctx, points, diam, closed, 0);
}

function _drawRebarCtx(ctx, points, diam, closed, tension) {
  if (!points || points.length < 2) return;
  const d    = Math.max(diam || 14, 4);
  const style= window._drawerActiveStyle || 'tor';
  const cfg  = REBAR_STYLES.find(s => s.id === style) || REBAR_STYLES[0];

  const path    = _buildPath2D(points, tension, closed);
  const samples = sampleKonvaLine(points, tension * 0.5 /* Konva internal */, closed);

  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  ctx.strokeStyle = GRAY.body; ctx.lineWidth = d; ctx.stroke(path);

  ctx.strokeStyle = GRAY.hi; ctx.lineWidth = d * 0.28;
  ctx.shadowColor = GRAY.hi; ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = -d * 0.32; ctx.shadowBlur = 0;
  ctx.stroke(path);
  ctx.shadowColor = 'transparent'; ctx.shadowOffsetY = 0;

  if (cfg.ribSpacing > 0 && d >= 5) drawRibsAlongSamples(ctx, samples, d, cfg);

  ctx.strokeStyle = GRAY.edge; ctx.lineWidth = 0.8; ctx.stroke(path);
  ctx.restore();
}

/* Build a Path2D from points using Catmull-Rom tension (matches Konva) */
function _buildPath2D(points, tension, closed) {
  const T = (tension || 0) * 0.5;
  const n = points.length;
  const path = new Path2D();
  path.moveTo(points[0].x, points[0].y);

  if (T === 0) {
    const pts = closed ? [...points, points[0]] : points;
    for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
    if (closed) path.closePath();
    return path;
  }

  const pts = closed
    ? [...points, points[0], points[1]]
    : [points[0], ...points, points[n-1]];
  const segCount = closed ? n : n - 1;

  for (let i = 0; i < segCount; i++) {
    const P0=pts[i], P1=pts[i+1], P2=pts[i+2], P3=pts[i+3]||pts[i+2];
    path.bezierCurveTo(
      P1.x + T*(P2.x-P0.x), P1.y + T*(P2.y-P0.y),
      P2.x - T*(P3.x-P1.x), P2.y - T*(P3.y-P1.y),
      P2.x, P2.y
    );
  }
  if (closed) path.closePath();
  return path;
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
  window._drawerActiveStyle = window._drawerActiveStyle || 'tor';

  const lib=window.SHAPE_LIB||{};
  const def=lib[shapeName];

  if (!def) {
    drawRebarStraightPolyline(ctx,[{x:pad,y:cy},{x:W-pad,y:cy}],d,false);
    drawDim(ctx,pad,cy-d-12,W-pad,cy-d-12,'A');
    return;
  }

  if (def.generator==='circle') {
    const rr=Math.min(sw,sh)/2-10, pts=[];
    for(let i=0;i<72;i++){const a=i/72*Math.PI*2; pts.push({x:cx+Math.cos(a)*rr,y:cy+Math.sin(a)*rr});}
    drawRebarPath(ctx,pts,d,true);
    (def.dims||[]).forEach(dm=>drawDim(ctx,cx,cy,cx+rr,cy,dm.label));
    return;
  }
  if (def.generator==='spiral') {
    const rr=Math.min(sw,sh)/2-12, turns=def.turns||3, pts=[];
    for(let i=0;i<=turns*72;i++){const t=i/(turns*72),a=t*Math.PI*2*turns;
      pts.push({x:cx+Math.cos(a)*rr*(0.2+0.8*t),y:cy+Math.sin(a)*rr*(0.2+0.8*t)});}
    ctx.save(); ctx.lineCap='round'; ctx.lineJoin='round';
    const stroke=(col,w,oy)=>{ctx.strokeStyle=col;ctx.lineWidth=w;if(oy){ctx.shadowOffsetY=oy;ctx.shadowColor=GRAY.hi;ctx.shadowBlur=0;}ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);pts.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.stroke();ctx.shadowOffsetY=0;ctx.shadowColor='transparent';};
    stroke(GRAY.body,d,0); stroke(GRAY.hi,d*0.28,-d*0.32); stroke(GRAY.edge,0.8,0);
    ctx.restore();
    (def.dims||[]).forEach(dm=>drawDim(ctx,cx-rr,cy,cx+rr,cy,dm.label));
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
    mapPt =p=>({ x:pad+p[0]*sw, y:pad+p[1]*sh });
    mapDim=p=>({ x:pad+p[0]*sw, y:pad+p[1]*sh });
  }

  (def.segments||[]).forEach(seg=>{
    const pts=seg.pts.map(mapPt);
    if (pts.length<2) return;
    if (seg.closed) drawRebarStraight(ctx,pts,d,true);
    else            _shapeRenderer(seg.style)(ctx,pts,d);
  });

  (def.dims||[]).forEach(dm=>{
    const a=mapDim(dm.from), b=mapDim(dm.to);
    const off=dm.off||[0,0];
    drawDim(ctx,a.x+off[0],a.y+off[1],b.x+off[0],b.y+off[1],dm.label);
  });
}

/* Dimension line helper — unchanged */
function drawDim(ctx,x1,y1,x2,y2,label) {
  const dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy);
  if(len<4)return;
  ctx.save();
  ctx.strokeStyle=GRAY.dim; ctx.fillStyle=GRAY.dim; ctx.lineWidth=1.2;
  ctx.setLineDash([5,3]);
  ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
  ctx.setLineDash([]);
  const ax=dx/len,ay=dy/len,aw=8,ah=3.5;
  for(const[px,py,flip]of[[x1,y1,-1],[x2,y2,1]]){
    ctx.beginPath();
    ctx.moveTo(px,py);
    ctx.lineTo(px-ax*aw*flip+ay*ah*flip,py-ay*aw*flip-ax*ah*flip);
    ctx.lineTo(px-ax*aw*flip-ay*ah*flip,py-ay*aw*flip+ax*ah*flip);
    ctx.closePath(); ctx.fill();
  }
  const mx=(x1+x2)/2,my=(y1+y2)/2;
  ctx.font='bold 11px ui-monospace,Consolas,monospace';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  const tw=ctx.measureText(label).width+6;
  ctx.fillStyle='#fff'; ctx.fillRect(mx-tw/2,my-9,tw,18);
  ctx.fillStyle=GRAY.dim; ctx.fillText(label,mx,my);
  ctx.restore();
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
<div style="display:flex;flex-direction:column;height:100%;max-height:96vh">
  <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border);flex-shrink:0">
    <span style="font-weight:800;font-size:15px">🔩 Rebar Shape Drawer</span>
    <span style="font-size:11px;color:var(--muted);margin-left:4px">b&w · print-safe</span>
    <div class="space"></div>
    <button id="drawerDone"   class="btn small primary">✔ Use Shape</button>
    <button id="drawerCancel" class="btn small ghost">✕</button>
  </div>
  <div style="display:flex;flex:1;min-height:0;overflow:hidden">

    <!-- ── LEFT SIDEBAR ── -->
    <div style="width:192px;flex-shrink:0;border-right:1px solid var(--border);padding:11px 10px;display:flex;flex-direction:column;gap:8px;overflow-y:auto;font-size:12px">

      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;font-weight:700">Tool</div>
      <div style="display:flex;flex-direction:column;gap:3px" id="toolBtns">
        <button class="btn small ghost drawer-tool" data-tool="rebar-path"  title="Click to add points · B=toggle Bézier · Dbl-click or Enter to finish · Esc to cancel">〽 Rebar Path</button>
        <button class="btn small ghost drawer-tool" data-tool="ortho-bar"   title="Ortho mode: clicks snap H/V · Dbl-click or Enter to finish · Esc to cancel">⊢ Ortho Bar</button>
        <button class="btn small ghost drawer-tool" data-tool="rect"        title="Click-drag to draw rectangle">▭ Rectangle</button>
        <button class="btn small ghost drawer-tool" data-tool="circle"      title="Click-drag to draw ellipse">◯ Circle / Stirrup</button>
        <button class="btn small ghost drawer-tool" data-tool="text"        title="Click canvas to place label">T Annotation</button>
        <button class="btn small ghost drawer-tool" data-tool="dim"         title="Two clicks to place dimension">↔ Dimension</button>
      </div>

      <!-- Path-tool hint -->
      <div id="pathHint" style="font-size:10px;color:var(--muted);background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:6px;padding:6px 8px;line-height:1.5;display:none">
        <b style="color:var(--brand)" id="pathHintTitle">Drawing…</b><br>
        <span id="pathHintBody">Click — add point<br>
        Dbl-click / Enter — finish<br>
        Esc — cancel</span>
      </div>

      <div style="height:1px;background:var(--border)"></div>
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;font-weight:700">Rebar Style</div>
      <div style="display:flex;flex-direction:column;gap:3px">
        ${REBAR_STYLES.map(s=>`<button class="btn small ghost rebar-style-btn" data-style="${s.id}" style="text-align:left;font-size:11px">${s.label}</button>`).join('')}
      </div>

      <div style="height:1px;background:var(--border)"></div>
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;font-weight:700">Bar Diameter</div>
      <div style="display:flex;align-items:center;gap:6px">
        <input type="range" id="drawerBarSize" min="6" max="38" value="16" style="flex:1">
        <span id="drawerBarVal" style="font-size:11px;min-width:22px;color:var(--brand);font-weight:700">16</span>
        <span style="font-size:10px;color:var(--muted)">px</span>
      </div>

      <div style="height:1px;background:var(--border)"></div>
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;font-weight:700">Annotation</div>
      <textarea id="drawerAnnotText" placeholder="Label text, then click canvas…" rows="2"
        style="font-size:11px;resize:none;border-radius:8px;padding:6px"></textarea>
      <div style="display:flex;flex-wrap:wrap;gap:3px">
        ${['A','B','C','D','Ø','90°','135°','Hook','Cover'].map(t=>`<button class="btn small ghost annot-preset" data-text="${t}" style="font-size:10px;padding:2px 5px">${t}</button>`).join('')}
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:10px;color:var(--muted)">Size</span>
        <input type="range" id="drawerFontSize" min="8" max="28" value="13" style="flex:1">
        <span id="drawerFontVal" style="font-size:11px;min-width:18px">13</span>
      </div>

      <div style="height:1px;background:var(--border)"></div>
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;font-weight:700;flex:1">Quick Shapes</span>
        <button id="loadShapesBtn" class="btn small ghost" style="font-size:9px;padding:2px 6px" title="Manually load a shapes.json file">⤓ Load JSON</button>
      </div>
      <div id="quickShapeList" style="display:flex;flex-direction:column;gap:3px">
        <span style="font-size:10px;color:var(--muted)">Loading…</span>
      </div>
    </div>

    <!-- ── CANVAS AREA ── -->
    <div style="flex:1;display:flex;flex-direction:column;min-width:0;min-height:0">
      <div id="svgCanvasWrap" style="flex:1;position:relative;overflow:hidden;background:#fff;min-height:0">
        <!-- Konva mounts here; id used by initKonvaStage -->
        <div id="konvaContainer" style="width:100%;height:100%"></div>
        <div id="nodeCounter" style="position:absolute;top:8px;left:50%;transform:translateX(-50%);
          background:rgba(34,197,94,.18);border:1px solid rgba(34,197,94,.4);border-radius:20px;
          padding:3px 12px;font-size:11px;color:#22c55e;font-weight:700;pointer-events:none;display:none">
        </div>
        <div style="position:absolute;bottom:7px;right:10px;font-size:10px;color:#bbb;pointer-events:none">
          <span id="canvasHint">Click=add point · Dbl-click=finish · Esc=cancel · white=print-safe</span>
        </div>
      </div>
      <div style="display:flex;gap:6px;padding:8px 12px;border-top:1px solid var(--border);align-items:center;flex-shrink:0;background:var(--panel)">
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
let bezierMode     = false;
let bezierStartIdx = -1;

let dragStart   = null;
let dimPhase    = 0;
let dimStart    = null;

window._drawerActiveStyle = 'tor';

/* ── Konva stage dimensions ── */
let _stageW = 700, _stageH = 460;

function getBarSize()  { return parseInt(document.getElementById('drawerBarSize').value, 10); }
function getFontSize() { return parseInt(document.getElementById('drawerFontSize').value, 10); }
function getAnnot()    { return document.getElementById('drawerAnnotText').value.trim() || 'Label'; }

function getXY(e) {
  const container = document.getElementById('konvaContainer');
  const rect = container.getBoundingClientRect();
  const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
  return {
    x: Math.max(0, Math.min(_stageW, cx)),
    y: Math.max(0, Math.min(_stageH, cy)),
  };
}

/* =====================================================
   EXPORT — same logic, reads from history
   ===================================================== */
function buildShapeDefinition(meta) {
  const rawSegments = [], rawDims = [];
  for (const cmd of history) {
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
    } else if (cmd.type === 'dim') {
      rawDims.push({x1:cmd.x1,y1:cmd.y1,x2:cmd.x2,y2:cmd.y2,label:cmd.label||''});
    }
  }
  if (!rawSegments.length) return { error:'Nothing to export — draw at least one bar segment first.' };

  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  const consider=(x,y)=>{if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;};
  rawSegments.forEach(s=>s.pts.forEach(p=>consider(p.x,p.y)));
  rawDims.forEach(d=>{consider(d.x1,d.y1);consider(d.x2,d.y2);});
  const bw=maxX-minX||1, bh=maxY-minY||1;
  const nx=x=>+(((x-minX)/bw)).toFixed(3);
  const ny=y=>+(((y-minY)/bh)).toFixed(3);

  const segments=rawSegments.map(s=>{
    const seg={pts:s.pts.map(p=>[nx(p.x),ny(p.y)]),style:s.style};
    if(s.closed)seg.closed=true;
    return seg;
  });
  const dims=rawDims.map(d=>({from:[nx(d.x1),ny(d.y1)],to:[nx(d.x2),ny(d.y2)],label:d.label||'A'}));
  const def={id:meta.id,label:meta.label||meta.id,group:'quick'};
  if(meta.bs8666)def.bs8666=meta.bs8666;
  if(meta.formula)def.formula=meta.formula;
  def.segments=segments;
  if(dims.length)def.dims=dims;
  return {def};
}

function exportDrawnShape() {
  const id=(prompt('Shape ID (unique, no spaces):','')||'').trim();
  if(!id)return;
  const safeId=id.replace(/[^a-zA-Z0-9_-]/g,'-');
  const label=(prompt('Button label:',safeId)||safeId).trim();
  const bs8666=(prompt('BS 8666 code (optional):','')||'').trim();
  const formula=(prompt('Cutting-length formula (optional):','')||'').trim();
  const result=buildShapeDefinition({id:safeId,label,bs8666,formula});
  if(result.error){alert(result.error);return;}
  showExportPanel(formatCompactShape(result.def),safeId);
}

function formatCompactShape(def) {
  const q=s=>JSON.stringify(s), ja=a=>JSON.stringify(a);
  const scalars=[];
  scalars.push(`"id": ${q(def.id)}, "label": ${q(def.label)}`);
  if(def.bs8666) scalars[scalars.length-1]+=`, "bs8666": ${q(def.bs8666)}`;
  if(def.formula) scalars.push(`"formula": ${q(def.formula)}`);
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
    const dimObjs=def.dims.map(d=>`{ "from": ${ja(d.from)}, "to": ${ja(d.to)}, "label": ${q(d.label)} }`);
    dimsBlock=`,\n      "dims": [\n        ${dimObjs.join(',\n        ')}\n      ]`;
  }
  const indent='      ';
  const fields=scalars.map(s=>indent+s).join(',\n')+',\n'+indent+segBlock+dimsBlock;
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
      Copy into the <b>"shapes"</b> array in <code>bbs/shapes.json</code>, then run <code>node bbs/build-shapes.js</code>.
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
   KONVA REDRAW — replaces canvas2d history redraw
   ===================================================== */
function redraw() {
  const layer = getKonvaLayer();
  if (!layer) return;
  layer.destroyChildren();

  // White background
  layer.add(new Konva.Rect({ x:0, y:0, width:_stageW, height:_stageH, fill:'#fff' }));

  for (const cmd of history) renderCmd(cmd, layer);
  layer.draw();
}

function renderCmd(cmd, layer) {
  window._drawerActiveStyle = cmd.style || activeStyle;
  const d = cmd.diam || getBarSize();

  if (cmd.type === 'rebar-path') {
    const tension = cmd.bezier ? CURVE_TENSION : 0;
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
      text:cmd.text, fontSize:cmd.size||13,
      fontFamily:'ui-monospace,Consolas,monospace', fontStyle:'bold',
      fill:GRAY.dim,
    }));

  } else if (cmd.type === 'dim') {
    // Render dim line via Konva custom shape (reuse canvas2d drawDim)
    layer.add(new Konva.Shape({
      sceneFunc(ctx) { drawDim(ctx._context||ctx, cmd.x1,cmd.y1,cmd.x2,cmd.y2,cmd.label); },
      listening: false,
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
    if (previewPts.length >= 2) {
      const g = makeRebarGroup(previewPts, getBarSize(), bezierMode?'curve':'straight', false);
      g.opacity(0.6); layer.add(g);
    }
    // Anchor dots
    livePts.forEach((p,i) => {
      layer.add(new Konva.Circle({
        x:p.x, y:p.y, radius:5,
        fill: i===0?'#22c55e':(bezierMode&&i===bezierStartIdx)?'#f97316':'#38bdf8',
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

  } else if (activeTool === 'dim' && dimPhase===1 && dimStart && cursorPt) {
    layer.add(new Konva.Shape({
      opacity:0.6,
      sceneFunc(ctx) { drawDim(ctx._context||ctx, dimStart.x,dimStart.y,cursorPt.x,cursorPt.y,getAnnot()); },
      listening:false,
    }));
  }

  layer.draw();
}

function updateNodeCounter(n) {
  const el=document.getElementById('nodeCounter');
  if(!el)return;
  if(n>0){el.style.display='block';el.textContent=n===1?'1 point — keep clicking to build path':`${n} points — dbl-click or Enter to finish`;}
  else el.style.display='none';
}

function showPathHint(on, isOrtho) {
  const el=document.getElementById('pathHint');
  if(!el)return;
  el.style.display=on?'block':'none';
  if(on){
    const titleEl=document.getElementById('pathHintTitle');
    const bodyEl=document.getElementById('pathHintBody');
    if(isOrtho){if(titleEl)titleEl.textContent='Ortho Drawing…';if(bodyEl)bodyEl.innerHTML='Click — snap H/V point<br>Dbl-click / Enter — finish<br>Esc — cancel';}
    else{if(titleEl)titleEl.textContent='━ Straight Mode';if(bodyEl)bodyEl.innerHTML='Click — add point<br>Dbl-click / Enter — finish<br><b>B</b> — toggle Bézier curve<br>Esc — cancel';}
  }
}

function commitRebarPath() {
  if (livePts.length<2){cancelPath();return;}
  if (activeTool==='ortho-bar') {
    history.push({type:'ortho-bar',points:[...livePts],diam:getBarSize(),style:activeStyle,closed:false});
  } else if (bezierMode&&bezierStartIdx>=1&&livePts.length>bezierStartIdx) {
    const sp=livePts.slice(0,bezierStartIdx+1);
    if(sp.length>=2) history.push({type:'rebar-path',points:sp,diam:getBarSize(),style:activeStyle,closed:false,bezier:false});
    const bp=livePts.slice(bezierStartIdx);
    if(bp.length>=2) history.push({type:'rebar-path',points:bp,diam:getBarSize(),style:activeStyle,closed:false,bezier:true});
  } else {
    history.push({type:'rebar-path',points:[...livePts],diam:getBarSize(),style:activeStyle,closed:false,bezier:false});
  }
  cancelPath(); redraw();
}

function cancelPath() {
  isDrawing=false; livePts=[]; mousePos=null; bezierMode=false; bezierStartIdx=-1;
  updateNodeCounter(0); showPathHint(false); redraw();
}

/* ── Event handlers wired to Konva stage ── */
function onDown(e) {
  if (e.button!=null&&e.button===2) return;
  const pt=getXY(e);

  if (activeTool==='text') {
    history.push({type:'text',x:pt.x,y:pt.y,text:getAnnot(),size:getFontSize()});
    redraw(); return;
  }
  if (activeTool==='dim') {
    if(dimPhase===0){dimPhase=1;dimStart=pt;}
    else{history.push({type:'dim',x1:dimStart.x,y1:dimStart.y,x2:pt.x,y2:pt.y,label:getAnnot()});dimPhase=0;dimStart=null;redraw();}
    return;
  }
  if (activeTool==='rebar-path') {
    if(!isDrawing){isDrawing=true;livePts=[pt];showPathHint(true);}
    else{
      const first=livePts[0],closeThresh=16;
      if(livePts.length>=3&&Math.hypot(pt.x-first.x,pt.y-first.y)<closeThresh){
        if(bezierMode&&bezierStartIdx>=1&&livePts.length>bezierStartIdx){
          const sp=livePts.slice(0,bezierStartIdx+1);if(sp.length>=2)history.push({type:'rebar-path',points:sp,diam:getBarSize(),style:activeStyle,closed:false,bezier:false});
          const bp=[...livePts.slice(bezierStartIdx),livePts[0]];if(bp.length>=2)history.push({type:'rebar-path',points:bp,diam:getBarSize(),style:activeStyle,closed:true,bezier:true});
        } else {
          history.push({type:'rebar-path',points:[...livePts],diam:getBarSize(),style:activeStyle,closed:true,bezier:false});
        }
        cancelPath(); return;
      }
      livePts.push(pt);
    }
    renderGhostFrame(pt); return;
  }
  if (activeTool==='ortho-bar') {
    if(!isDrawing){isDrawing=true;livePts=[pt];showPathHint(true,true);}
    else{
      const snapped=orthoSnap(pt,livePts[livePts.length-1]);
      const first=livePts[0],closeThresh=16;
      if(livePts.length>=3&&Math.hypot(snapped.x-first.x,snapped.y-first.y)<closeThresh){
        history.push({type:'ortho-bar',points:[...livePts],diam:getBarSize(),style:activeStyle,closed:true});
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
  if((activeTool==='rebar-path'||activeTool==='ortho-bar')&&isDrawing) renderGhostFrame(pt);
  else if((activeTool==='rect'||activeTool==='circle')&&dragStart) renderGhostFrame(pt);
  else if(activeTool==='dim'&&dimPhase===1) renderGhostFrame(pt);
}

function onUp(e) {
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

function onDblClick(e) {
  if((activeTool==='rebar-path'||activeTool==='ortho-bar')&&isDrawing){
    if(livePts.length>1)livePts.pop();
    commitRebarPath();
  }
}

function onKeyDown(e) {
  if(e.key==='Escape'){if(isDrawing)cancelPath();if(dimPhase===1){dimPhase=0;dimStart=null;redraw();}dragStart=null;}
  if(e.key==='Enter'&&(activeTool==='rebar-path'||activeTool==='ortho-bar')&&isDrawing) commitRebarPath();
  if((e.key==='b'||e.key==='B')&&activeTool==='rebar-path'&&isDrawing){
    bezierMode=!bezierMode;
    bezierStartIdx=bezierMode?livePts.length-1:-1;
    const titleEl=document.getElementById('pathHintTitle');
    const bodyEl=document.getElementById('pathHintBody');
    if(titleEl)titleEl.textContent=bezierMode?'〽 Bézier Mode (B)':'━ Straight Mode (B)';
    if(bodyEl)bodyEl.innerHTML=(bezierMode?'<b style="color:var(--brand)">Curve</b> — smooth Bézier spline<br>':'<b>Straight</b> — sharp straight segments<br>')+'Click — add point<br>Dbl-click / Enter — finish<br>Esc — cancel';
    renderGhostFrame(mousePos);
  }
}

function setTool(t) {
  if(isDrawing)cancelPath();
  dimPhase=0;dimStart=null;dragStart=null;activeTool=t;
  document.querySelectorAll('.drawer-tool').forEach(b=>{
    const on=b.dataset.tool===t;
    b.style.background=on?'var(--brand)':'';
    b.style.color=on?'#05131f':'';
    b.style.fontWeight=on?'700':'';
  });
  const container=document.getElementById('konvaContainer');
  if(container)container.style.cursor=t==='text'?'text':'crosshair';
  showPathHint(false);
  const hintEl=document.getElementById('canvasHint');
  if(hintEl)hintEl.textContent=t==='ortho-bar'?'Ortho mode: clicks snap H/V · Dbl-click=finish · Esc=cancel':'Click=add point · B=toggle Bézier · Dbl-click=finish · Esc=cancel · white=print-safe';
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
  _stageW = wrap.clientWidth  || 700;
  _stageH = wrap.clientHeight || 460;

  // Boot Konva stage into #konvaContainer
  const konvaEl = document.getElementById('konvaContainer');
  initKonvaStage(konvaEl, _stageW, _stageH);

  // Wire Konva stage events (pointer events — no canvas element needed)
  const stage = _konvaStage;
  stage.off('mousedown touchstart mouseup touchend mousemove touchmove dblclick');
  stage.on('mousedown touchstart', e => { onDown(e.evt); });
  stage.on('mousemove touchmove',  e => { onMove(e.evt); });
  stage.on('mouseup touchend',     e => { onUp(e.evt);   });
  stage.on('dblclick',             e => { onDblClick(e.evt); });

  document.removeEventListener('keydown', onKeyDown);
  document.addEventListener('keydown', onKeyDown);

  history=[]; isDrawing=false; livePts=[]; dragStart=null; dimPhase=0; dimStart=null; mousePos=null; bezierMode=false;
  redraw();

  document.querySelectorAll('.drawer-tool, .rebar-style-btn, .annot-preset').forEach(b=>{
    const clone=b.cloneNode(true); b.parentNode.replaceChild(clone,b);
  });
  document.querySelectorAll('.drawer-tool').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));
  document.querySelectorAll('.rebar-style-btn').forEach(b=>b.addEventListener('click',()=>setStyle(b.dataset.style)));
  document.querySelectorAll('.annot-preset').forEach(b=>b.addEventListener('click',()=>{
    document.getElementById('drawerAnnotText').value=b.dataset.text; setTool('text');
  }));

  document.getElementById('drawerBarSize').addEventListener('input',e=>{
    document.getElementById('drawerBarVal').textContent=e.target.value;
    history=history.map(cmd=>cmd.type==='shape'?{...cmd,diam:parseInt(e.target.value,10)}:cmd);
    redraw();
  });
  document.getElementById('drawerFontSize').addEventListener('input',e=>{
    document.getElementById('drawerFontVal').textContent=e.target.value;
  });
  document.getElementById('drawerUndo').onclick=()=>{
    if(isDrawing&&livePts.length>1){livePts.pop();renderGhostFrame(mousePos);return;}
    if(isDrawing){cancelPath();return;}
    history.pop(); redraw();
  };
  document.getElementById('drawerClear').onclick=()=>{cancelPath();history=[];redraw();};
  document.getElementById('drawerExport').onclick=()=>{if(isDrawing)commitRebarPath();exportDrawnShape();};

  setTool('rebar-path'); setStyle('tor');
}

function ensureDrawerModal() {
  if(!document.getElementById('shapeDrawerDlg'))
    document.body.insertAdjacentHTML('beforeend',drawerHTML);
}

/* ── Shape library ── */
window.SHAPE_LIB      = window.SHAPE_LIB || {};
window.SHAPE_LIB_LIST = window.SHAPE_LIB_LIST || [];

async function loadShapeLibrary() {
  if(window.SHAPE_LIB_LIST.length)return;
  let list=Array.isArray(window.SHAPE_LIB_DEFAULT)?window.SHAPE_LIB_DEFAULT.slice():[];
  try{
    const res=await fetch('bbs/shapes.json',{cache:'no-cache'});
    if(res.ok){const data=await res.json();const fl=(data.shapes||[]).filter(s=>s&&s.id);if(fl.length)list=fl;}
  }catch(err){console.info('shapes.json not auto-fetched (using embedded default).');}
  if(!list.length)list=[{id:'straight',label:'Straight',group:'quick',segments:[{pts:[[0,0.5],[1,0.5]],style:'straight'}],dims:[{from:[0,0.5],to:[1,0.5],label:'A',off:[0,-24]}]}];
  window.SHAPE_LIB_LIST=list; window.SHAPE_LIB={};
  list.forEach(s=>{window.SHAPE_LIB[s.id]=s;});
}

function applyShapeList(list,sourceLabel){
  const clean=(list||[]).filter(s=>s&&s.id);
  if(!clean.length){alert('No valid shapes found in '+(sourceLabel||'file')+'.');return false;}
  window.SHAPE_LIB_LIST=clean; window.SHAPE_LIB={};
  clean.forEach(s=>{window.SHAPE_LIB[s.id]=s;}); populateQuickShapes(); return true;
}

function manualLoadShapesJson(){
  const inp=document.createElement('input'); inp.type='file'; inp.accept='.json,application/json';
  inp.onchange=()=>{
    const file=inp.files&&inp.files[0]; if(!file)return;
    const reader=new FileReader();
    reader.onload=()=>{
      try{
        const data=JSON.parse(reader.result);
        const list=Array.isArray(data)?data:(data.shapes||[]);
        if(applyShapeList(list,file.name)){const btn=document.getElementById('loadShapesBtn');if(btn){const t=btn.textContent;btn.textContent='✓ Loaded';setTimeout(()=>(btn.textContent=t),1500);}}
      }catch(err){alert('Could not parse JSON: '+err.message);}
    };
    reader.onerror=()=>alert('Could not read file.'); reader.readAsText(file);
  };
  inp.click();
}

function populateQuickShapes(){
  const host=document.getElementById('quickShapeList'); if(!host)return;
  const quick=window.SHAPE_LIB_LIST.filter(s=>(s.group||'quick')==='quick');
  if(!quick.length){host.innerHTML='<span style="font-size:10px;color:var(--muted)">No shapes</span>';return;}
  host.innerHTML=quick.map(s=>`<button class="btn small ghost shape-prev-btn" data-shape="${s.id}" title="${s.bs8666?'BS 8666 shape '+s.bs8666:''}" style="font-size:10px;text-align:left;padding:3px 7px">${s.label||s.id}</button>`).join('');
  host.querySelectorAll('.shape-prev-btn').forEach(b=>b.addEventListener('click',()=>{
    history=[{type:'shape',shape:b.dataset.shape,diam:getBarSize(),style:activeStyle}]; redraw();
  }));
  const loadBtn=document.getElementById('loadShapesBtn');
  if(loadBtn)loadBtn.onclick=manualLoadShapesJson;
}

/* ── Export canvas as PNG (for "Use Shape") ── */
function exportToPNG() {
  // Use Konva's built-in toDataURL
  return _konvaStage ? _konvaStage.toDataURL({ mimeType:'image/png' }) : '';
}

window.ShapeDrawer = {
  async open(callback) {
    ensureDrawerModal();
    await loadShapeLibrary();
    drawerCallback=callback;
    const dlg=document.getElementById('shapeDrawerDlg');
    dlg.showModal();
    setTimeout(()=>{initDrawer();populateQuickShapes();},60);
    document.getElementById('drawerDone').onclick=()=>{
      if(isDrawing)commitRebarPath();
      dlg.close();
      if(drawerCallback)drawerCallback(exportToPNG());
      document.removeEventListener('keydown',onKeyDown);
    };
    document.getElementById('drawerCancel').onclick=()=>{
      cancelPath(); dlg.close();
      document.removeEventListener('keydown',onKeyDown);
    };
  }
};
