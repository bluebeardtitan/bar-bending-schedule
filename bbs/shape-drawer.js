/* =========================================================
   Shape Drawer — Rebar textured strokes, SVG b&w color scheme
   Drawing: click-to-place polyline with auto Bézier bends
   ========================================================= */

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

/* =====================================================
   CATMULL-ROM → CUBIC BÉZIER SPLINE GEOMETRY
   Given N anchor points, produces a smooth spline where
   every interior point has a continuous tangent (Bézier bend).
   Returns: { path: Path2D, samples: [{x,y}] }

   Algorithm:
   - For each segment i→i+1, compute control points from
     Catmull-Rom parameterisation (tension = bendTension)
   - Convert each CR segment to cubic Bézier cp1/cp2
   - Sample each Bézier densely for rib placement
   ===================================================== */
function buildSplineGeometry(points, closed) {
  const STEP    = 2;    // sample every ~2px along arc length
  const TENSION = 0.4;  // 0=sharp corners, 0.5=full Catmull-Rom, lower=tighter bends

  const n = points.length;
  if (n < 2) return { path: new Path2D(), samples: [] };

  // Build extended point array for tangent computation at endpoints
  // For open paths: mirror first/last to create phantom control points
  const pts = [];
  if (closed) {
    pts.push(points[n-1]);
    pts.push(...points);
    pts.push(points[0]);
    pts.push(points[1]);
  } else {
    // Phantom points: mirror the first and last segment
    const p0 = { x: 2*points[0].x - points[1].x, y: 2*points[0].y - points[1].y };
    const pn = { x: 2*points[n-1].x - points[n-2].x, y: 2*points[n-1].y - points[n-2].y };
    pts.push(p0, ...points, pn);
  }

  const path    = new Path2D();
  const samples = [];
  const segCount = closed ? n : n - 1;

  path.moveTo(pts[1].x, pts[1].y);
  samples.push({ x: pts[1].x, y: pts[1].y });

  for (let i = 0; i < segCount; i++) {
    const P0 = pts[i];
    const P1 = pts[i+1];
    const P2 = pts[i+2];
    const P3 = pts[i+3] || pts[i+2];

    // Catmull-Rom tangents scaled by tension
    const cp1 = {
      x: P1.x + TENSION * (P2.x - P0.x) / 3,
      y: P1.y + TENSION * (P2.y - P0.y) / 3,
    };
    const cp2 = {
      x: P2.x - TENSION * (P3.x - P1.x) / 3,
      y: P2.y - TENSION * (P3.y - P1.y) / 3,
    };

    path.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, P2.x, P2.y);

    // Dense arc-length sampling of this cubic Bézier for rib placement
    const SUBSTEPS = Math.max(12, Math.ceil(
      (Math.hypot(P2.x-P1.x, P2.y-P1.y) + Math.hypot(cp1.x-P1.x,cp1.y-P1.y)*2) / STEP
    ));
    let prevSample = { x: P1.x, y: P1.y };
    let accum = 0;
    for (let s = 1; s <= SUBSTEPS; s++) {
      const t  = s / SUBSTEPS;
      const mt = 1 - t;
      // Cubic Bézier point
      const bx = mt*mt*mt*P1.x + 3*mt*mt*t*cp1.x + 3*mt*t*t*cp2.x + t*t*t*P2.x;
      const by = mt*mt*mt*P1.y + 3*mt*mt*t*cp1.y + 3*mt*t*t*cp2.y + t*t*t*P2.y;
      accum += Math.hypot(bx - prevSample.x, by - prevSample.y);
      if (accum >= STEP || s === SUBSTEPS) {
        samples.push({ x: bx, y: by });
        accum = 0;
      }
      prevSample = { x: bx, y: by };
    }
  }

  if (closed) path.closePath();
  return { path, samples };
}

/* =====================================================
   ORTHO SNAP HELPER
   Constrains a point to H or V from a previous anchor.
   If no anchor, returns pt unchanged.
   ===================================================== */
function orthoSnap(pt, anchor) {
  if (!anchor) return pt;
  const dx = Math.abs(pt.x - anchor.x);
  const dy = Math.abs(pt.y - anchor.y);
  if (dx >= dy) return { x: pt.x, y: anchor.y };   // horizontal
  return            { x: anchor.x, y: pt.y };       // vertical
}

/* =====================================================
   ORTHO-WITH-BENDS GEOMETRY
   Straight H/V segments joined by smooth circular arcs
   at every interior corner.  Uses an off-screen canvas
   + arcTo (which is geometrically exact) for the Path2D,
   then re-traces the same geometry analytically for the
   dense rib-placement sample array.

   Bend radius R = ORTHO_BEND_FACTOR × diam, clamped so
   it never exceeds half of either adjacent segment.
   ===================================================== */
const ORTHO_BEND_FACTOR = 3.5;

function buildOrthoGeometry(points, diam) {
  const STEP = 2;
  const n    = points.length;
  if (n < 2) return { path: new Path2D(), samples: [] };

  const R    = Math.max(6, (diam || 16) * ORTHO_BEND_FACTOR);
  const path = new Path2D();
  const samples = [];

  /* ---- segment lengths (needed for radius clamping) ---- */
  const segLen = [];
  for (let i = 0; i < n - 1; i++) {
    segLen.push(Math.hypot(points[i+1].x - points[i].x,
                           points[i+1].y - points[i].y));
  }

  /* ---- helpers ---- */
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
    // Compute the signed sweep that goes the SHORT way (≤ π) from a0 to a1
    let sweep = a1 - a0;
    // Normalise to (-π, π]
    while (sweep >  Math.PI) sweep -= Math.PI * 2;
    while (sweep < -Math.PI) sweep += Math.PI * 2;
    if (Math.abs(sweep) < 1e-4) return;
    const steps = Math.max(4, Math.ceil(r * Math.abs(sweep) / STEP));
    for (let s = 1; s <= steps; s++) {
      const a = a0 + sweep * (s / steps);
      samples.push({ x: cx + Math.cos(a)*r, y: cy + Math.sin(a)*r });
    }
  }

  /* ---- start ---- */
  path.moveTo(points[0].x, points[0].y);
  samples.push({ x: points[0].x, y: points[0].y });
  let curX = points[0].x, curY = points[0].y;

  for (let i = 0; i < n - 1; i++) {
    const P0 = points[i];
    const P1 = points[i + 1];

    if (i === n - 2) {
      /* Last segment — draw straight to end, no arc after */
      path.lineTo(P1.x, P1.y);
      sampleLineTo(curX, curY, P1.x, P1.y);
      break;
    }

    const P2 = points[i + 2];

    /* Clamp R so it fits in both this segment and the next */
    const r = Math.min(R, segLen[i] / 2, segLen[i+1] / 2);

    /* Unit vectors along incoming (P0→P1) and outgoing (P1→P2) */
    const d1 = segLen[i];
    const d2 = segLen[i+1];
    const u1x = (P1.x - P0.x) / d1,  u1y = (P1.y - P0.y) / d1;
    const u2x = (P2.x - P1.x) / d2,  u2y = (P2.y - P1.y) / d2;
    const T1 = { x: P1.x - u1x * r, y: P1.y - u1y * r }; // on incoming seg
    const T2 = { x: P1.x + u2x * r, y: P1.y + u2y * r }; // on outgoing seg

    /* Arc centre: for a 90° ortho turn, T1 and T2 are on perpendicular
       segments meeting at P1.  The circle tangent to both passes through
       a centre that is simply the "missing corner" of the rectangle
       formed by T1, P1, T2 — i.e. offset from T1 by the same vector
       that goes from P1 to T2.  This is exact for 90° and matches arcTo. */
    const cx = T1.x + (T2.x - P1.x);
    const cy = T1.y + (T2.y - P1.y);

    /* Angles from centre to the two tangent points */
    const a0 = Math.atan2(T1.y - cy, T1.x - cx);
    const a1 = Math.atan2(T2.y - cy, T2.x - cx);

    /* Draw: straight line to T1, then arc to T2 */
    path.lineTo(T1.x, T1.y);
    sampleLineTo(curX, curY, T1.x, T1.y);

    path.arcTo(P1.x, P1.y, P2.x, P2.y, r);
    sampleArcTo(cx, cy, r, a0, a1);

    /* Pen is now at T2 — update tracking position */
    curX = T2.x;
    curY = T2.y;
  }

  return { path, samples };
}

/* =====================================================
   STRAIGHT POLYLINE REBAR RENDERER
   Pure straight H/V/any-angle segments — no arc bends.
   Same layer stack as drawRebarPath but uses a simple
   lineTo path. This is the default mode for rebar-path.
   ===================================================== */
function drawRebarStraightPolyline(ctx, points, diam, closed) {
  if (!points || points.length < 2) return;
  const style = window._drawerActiveStyle || 'tor';
  const cfg   = REBAR_STYLES.find(s => s.id === style) || REBAR_STYLES[0];

  const pts = closed ? [...points, points[0]] : points;

  // Build Path2D and dense sample array for ribs
  const path    = new Path2D();
  const samples = [];
  const STEP    = 2;

  path.moveTo(pts[0].x, pts[0].y);
  samples.push({ x: pts[0].x, y: pts[0].y });

  for (let i = 1; i < pts.length; i++) {
    const x0 = pts[i-1].x, y0 = pts[i-1].y;
    const x1 = pts[i].x,   y1 = pts[i].y;
    path.lineTo(x1, y1);
    const d = Math.hypot(x1-x0, y1-y0);
    const steps = Math.max(1, Math.ceil(d / STEP));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      samples.push({ x: x0 + (x1-x0)*t, y: y0 + (y1-y0)*t });
    }
  }

  ctx.save();
  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';

  /* Layer 1: body */
  ctx.strokeStyle = GRAY.body;
  ctx.lineWidth   = diam;
  ctx.stroke(path);

  /* Layer 2: highlight */
  ctx.strokeStyle   = GRAY.hi;
  ctx.lineWidth     = diam * 0.28;
  ctx.shadowColor   = GRAY.hi;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = -diam * 0.32;
  ctx.shadowBlur    = 0;
  ctx.stroke(path);
  ctx.shadowColor   = 'transparent';
  ctx.shadowOffsetY = 0;

  /* Layer 3: ribs */
  if (cfg.ribSpacing > 0 && diam >= 5) {
    drawRibsAlongSamples(ctx, samples, diam, cfg);
  }

  /* Layer 4: hairline outline */
  ctx.strokeStyle = GRAY.edge;
  ctx.lineWidth   = 0.8;
  ctx.stroke(path);

  ctx.restore();
}


/* =====================================================
   ORTHO REBAR RENDERER
   Straight H/V segments with rounded bends at corners.
   Same layer stack as drawRebarPath.
   ===================================================== */
function drawRebarStraight(ctx, points, diam, closed) {
  if (!points || points.length < 2) return;
  const style = window._drawerActiveStyle || 'tor';
  const cfg   = REBAR_STYLES.find(s => s.id === style) || REBAR_STYLES[0];

  // Close the point list if needed
  const pts = closed ? [...points, points[0]] : points;
  const { path, samples } = buildOrthoGeometry(pts, diam);

  ctx.save();
  ctx.lineCap  = 'round';    // round caps look right with curved bends
  ctx.lineJoin = 'round';

  /* Layer 1: body */
  ctx.strokeStyle = GRAY.body;
  ctx.lineWidth   = diam;
  ctx.stroke(path);

  /* Layer 2: highlight */
  ctx.strokeStyle   = GRAY.hi;
  ctx.lineWidth     = diam * 0.28;
  ctx.shadowColor   = GRAY.hi;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = -diam * 0.32;
  ctx.shadowBlur    = 0;
  ctx.stroke(path);
  ctx.shadowColor   = 'transparent';
  ctx.shadowOffsetY = 0;

  /* Layer 3: ribs */
  if (cfg.ribSpacing > 0 && diam >= 5) {
    drawRibsAlongSamples(ctx, samples, diam, cfg);
  }

  /* Layer 4: hairline outline */
  ctx.strokeStyle = GRAY.edge;
  ctx.lineWidth   = 0.8;
  ctx.stroke(path);

  ctx.restore();
}

/* =====================================================
   LAYER-BASED REBAR RENDERER
   Layers:
   1. Body stroke  (#303030, full diameter)
   2. Highlight    (#fff, offset via shadow trick)
   3. Ribs         (sampled along spline, perpendicular strokes)
   4. Outline      (hairline, #303030)
   ===================================================== */
function drawRebarPath(ctx, points, diam, closed) {
  if (!points || points.length < 2) return;
  const style = window._drawerActiveStyle || 'tor';
  const cfg   = REBAR_STYLES.find(s => s.id === style) || REBAR_STYLES[0];

  const { path, samples } = buildSplineGeometry(points, closed);

  ctx.save();
  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';

  /* Layer 1: body */
  ctx.strokeStyle = GRAY.body;
  ctx.lineWidth   = diam;
  ctx.stroke(path);

  /* Layer 2: highlight strip (white, offset upward via shadow) */
  ctx.strokeStyle   = GRAY.hi;
  ctx.lineWidth     = diam * 0.28;
  ctx.shadowColor   = GRAY.hi;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = -diam * 0.32;
  ctx.shadowBlur    = 0;
  ctx.stroke(path);
  ctx.shadowColor   = 'transparent';
  ctx.shadowOffsetY = 0;

  /* Layer 3: ribs */
  if (cfg.ribSpacing > 0 && diam >= 5) {
    drawRibsAlongSamples(ctx, samples, diam, cfg);
  }

  /* Layer 4: hairline outline */
  ctx.strokeStyle = GRAY.edge;
  ctx.lineWidth   = 0.8;
  ctx.stroke(path);

  ctx.restore();
}

/* =====================================================
   RIB RENDERER
   Uses smoothed tangents from the Bézier sample array
   so ribs always follow the curve direction cleanly.
   ===================================================== */
function drawRibsAlongSamples(ctx, samples, diam, cfg) {
  if (samples.length < 2) return;

  const r         = diam / 2;
  const sp        = cfg.ribSpacing * (diam / 16);
  const ribH      = diam * 0.22;
  const ribW      = diam * cfg.ribWidth;
  const ribAngRad = cfg.ribAngle * Math.PI / 180;

  // Pre-compute smoothed tangents (±3 sample window) for clean rib angles
  const tangents = [];
  for (let i = 0; i < samples.length; i++) {
    const i0 = Math.max(0, i - 3);
    const i1 = Math.min(samples.length - 1, i + 3);
    const dx = samples[i1].x - samples[i0].x;
    const dy = samples[i1].y - samples[i0].y;
    const len = Math.hypot(dx, dy);
    tangents.push(len > 0.001 ? { ux: dx/len, uy: dy/len } : { ux: 1, uy: 0 });
  }

  let dist     = sp * 0.4;
  let ribIndex = 0;

  ctx.save();
  ctx.lineCap = 'round';

  for (let i = 1; i < samples.length; i++) {
    const prev   = samples[i-1], curr = samples[i];
    const segLen = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    if (segLen < 0.001) continue;
    dist += segLen;

    while (dist >= sp) {
      dist -= sp;
      const t  = 1 - dist / segLen;
      const px = prev.x + (curr.x - prev.x) * t;
      const py = prev.y + (curr.y - prev.y) * t;

      const { ux, uy } = tangents[i];
      const flip   = (cfg.alternate && ribIndex % 2 === 0) ? 1 : -1;
      const rAngle = Math.atan2(uy, ux) +
        (cfg.ribAngle === 90 ? Math.PI/2 : ribAngRad * flip);
      const rdx     = Math.cos(rAngle), rdy = Math.sin(rAngle);
      const halfLen = r + ribH * 0.6;

      // Dark rib body
      ctx.beginPath();
      ctx.moveTo(px - rdx*halfLen, py - rdy*halfLen);
      ctx.lineTo(px + rdx*halfLen, py + rdy*halfLen);
      ctx.strokeStyle = GRAY.rib;
      ctx.lineWidth   = ribW;
      ctx.stroke();

      // White highlight on the leading face
      const hox = -rdy * ribW * 0.35;
      const hoy =  rdx * ribW * 0.35;
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
   SHAPE DIAGRAM RENDERER
   ===================================================== */
/* =====================================================
   DATA-DRIVEN SHAPE RENDERER
   Shapes are defined declaratively in bbs/shapes.json and
   interpreted here. See window.SHAPE_LIB (loaded at startup).
   ===================================================== */

// Map a style string to the matching low-level renderer
function _shapeRenderer(style) {
  if (style === 'curve')    return (c,p,dd)=>drawRebarPath(c,p,dd,false);
  if (style === 'straight') return (c,p,dd)=>drawRebarStraightPolyline(c,p,dd,false);
  return (c,p,dd)=>drawRebarStraight(c,p,dd,false); // 'bend' (default)
}

// Build a 30-deg isometric projector that auto-centres world points
function _makeIsoProjector(allWorldPts, cx, cy) {
  const ISO = Math.PI/6, cosI = Math.cos(ISO), sinI = Math.sin(ISO);
  const raw = (x,y,z)=>({ x:(x-z)*cosI, y:-y+(x+z)*sinI });
  const proj = allWorldPts.map(p=>raw(p[0],p[1],p[2]||0));
  const minX=Math.min(...proj.map(p=>p.x)), maxX=Math.max(...proj.map(p=>p.x));
  const minY=Math.min(...proj.map(p=>p.y)), maxY=Math.max(...proj.map(p=>p.y));
  const ox=cx-(minX+maxX)/2, oy=cy-(minY+maxY)/2;
  return (x,y,z)=>{ const p=raw(x,y,z); return { x:ox+p.x, y:oy+p.y }; };
}

function drawShapeDiagram(ctx, shapeName, diam, W, H) {
  const d = Math.max(diam||14, 10);
  const cx=W/2, cy=H/2, pad=44;
  const sw=W-pad*2, sh=H-pad*2;

  ctx.clearRect(0,0,W,H);
  ctx.fillStyle=GRAY.bg; ctx.fillRect(0,0,W,H);
  window._drawerActiveStyle = window._drawerActiveStyle || 'tor';

  const lib = window.SHAPE_LIB || {};
  const def = lib[shapeName];

  // Fallback: a straight bar if shape is unknown / library not loaded
  if (!def) {
    drawRebarStraightPolyline(ctx,[{x:pad,y:cy},{x:W-pad,y:cy}],d,false);
    drawDim(ctx,pad,cy-d-12,W-pad,cy-d-12,'A');
    return;
  }

  // ---- Parametric generators (circle / spiral) ----
  if (def.generator === 'circle') {
    const rr=Math.min(sw,sh)/2-10, pts=[];
    for(let i=0;i<72;i++){const a=i/72*Math.PI*2; pts.push({x:cx+Math.cos(a)*rr,y:cy+Math.sin(a)*rr});}
    drawRebarPath(ctx,pts,d,true);
    (def.dims||[]).forEach(dm=>drawDim(ctx,cx,cy,cx+rr,cy,dm.label));
    return;
  }
  if (def.generator === 'spiral') {
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

  // ---- Coordinate mappers ----
  let mapPt;        // segment points -> screen
  let mapDim;       // dim endpoints  -> screen
  if (def.iso) {
    // Collect every world point (segments + iso dims) to auto-centre
    const all=[];
    (def.segments||[]).forEach(s=>s.pts.forEach(p=>all.push(p)));
    (def.dims||[]).forEach(dm=>{ if(dm.iso){all.push(dm.from);all.push(dm.to);} });
    const fit = def.fit || 200;
    const scale = Math.min(sw, sh) / (fit * 1.6); // keep within canvas
    const sAll = all.map(p=>[p[0]*scale,(p[1]||0)*scale,(p[2]||0)*scale]);
    const project = _makeIsoProjector(sAll, cx, cy);
    mapPt  = p => project(p[0]*scale, (p[1]||0)*scale, (p[2]||0)*scale);
    mapDim = p => project(p[0]*scale, (p[1]||0)*scale, (p[2]||0)*scale);
  } else {
    // Normalised 0..1 -> padded canvas area
    mapPt  = p => ({ x: pad + p[0]*sw, y: pad + p[1]*sh });
    mapDim = p => ({ x: pad + p[0]*sw, y: pad + p[1]*sh });
  }

  // ---- Render segments ----
  (def.segments||[]).forEach(seg=>{
    const pts = seg.pts.map(mapPt);
    if (pts.length < 2) return;
    if (seg.closed) {
      // closed loops always use bend renderer with closed=true
      drawRebarStraight(ctx, pts, d, true);
    } else {
      _shapeRenderer(seg.style)(ctx, pts, d);
    }
  });

  // ---- Render dimension lines ----
  (def.dims||[]).forEach(dm=>{
    const a = mapDim(dm.from), b = mapDim(dm.to);
    const off = dm.off || [0,0];
    drawDim(ctx, a.x+off[0], a.y+off[1], b.x+off[0], b.y+off[1], dm.label);
  });
}

/* Dimension line helper */
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
        <button id="loadShapesBtn" class="btn small ghost" style="font-size:9px;padding:2px 6px" title="Manually load a shapes.json file (use this when opened from disk / file://)">⤓ Load JSON</button>
      </div>
      <div id="quickShapeList" style="display:flex;flex-direction:column;gap:3px">
        <span style="font-size:10px;color:var(--muted)">Loading…</span>
      </div>
    </div>

    <!-- ── CANVAS AREA ── -->
    <div style="flex:1;display:flex;flex-direction:column;min-width:0;min-height:0">
      <div id="svgCanvasWrap" style="flex:1;position:relative;overflow:hidden;background:#fff;min-height:0">
        <canvas id="rebarCanvas" style="display:block;width:100%;height:100%"></canvas>
        <!-- live node count shown while drawing -->
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
let canvas, ctx2;
let activeTool  = 'rebar-path';
let activeStyle = 'tor';
let history     = [];
let drawerCallback = null;

// Polyline-drawing state
let isDrawing      = false;   // currently placing a rebar-path
let livePts        = [];      // points placed so far [{x,y}]
let mousePos       = null;    // current cursor position for ghost segment
let bezierMode     = false;   // false = straight polyline, true = bezier spline (toggle with B)
let bezierStartIdx = -1;      // index in livePts where bezier segment begins (-1 = none)

// rect / circle / dim state
let dragStart   = null;
let dimPhase    = 0;       // 0=idle 1=first-click-placed
let dimStart    = null;

window._drawerActiveStyle = 'tor';

function getBarSize()  { return parseInt(document.getElementById('drawerBarSize').value, 10); }
function getFontSize() { return parseInt(document.getElementById('drawerFontSize').value, 10); }
function getAnnot()    { return document.getElementById('drawerAnnotText').value.trim() || 'Label'; }

function getXY(e) {
  const rect = canvas.getBoundingClientRect();
  const sx   = canvas.width  / rect.width;
  const sy   = canvas.height / rect.height;
  const cx   = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  const cy   = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
  return {
    x: Math.max(0, Math.min(canvas.width,  cx * sx)),
    y: Math.max(0, Math.min(canvas.height, cy * sy)),
  };
}

/* =====================================================
   EXPORT DRAWN SHAPE  →  shapes.json definition
   Converts the current `history` (drawn segments + dims)
   into a normalised declarative shape entry that can be
   pasted into bbs/shapes.json.
   ===================================================== */
function buildShapeDefinition(meta) {
  // 1) Collect geometry segments + dim lines from history
  const rawSegments = []; // {pts:[{x,y}], style, closed}
  const rawDims     = []; // {x1,y1,x2,y2,label}

  for (const cmd of history) {
    if (cmd.type === 'rebar-path') {
      rawSegments.push({
        pts: cmd.points.map(p => ({ x: p.x, y: p.y })),
        style: cmd.bezier ? 'curve' : 'straight',
        closed: !!cmd.closed,
      });
    } else if (cmd.type === 'ortho-bar') {
      rawSegments.push({
        pts: cmd.points.map(p => ({ x: p.x, y: p.y })),
        style: 'bend',
        closed: !!cmd.closed,
      });
    } else if (cmd.type === 'rect') {
      const lx = Math.min(cmd.x, cmd.x + cmd.w), rx = Math.max(cmd.x, cmd.x + cmd.w);
      const ty = Math.min(cmd.y, cmd.y + cmd.h), by = Math.max(cmd.y, cmd.y + cmd.h);
      rawSegments.push({
        pts: [{x:lx,y:ty},{x:rx,y:ty},{x:rx,y:by},{x:lx,y:by}],
        style: 'bend',
        closed: true,
      });
    } else if (cmd.type === 'circle') {
      // Emit as a closed bend polygon approximation (keeps editable points).
      // Near-circular ones can be hand-swapped for "generator":"circle".
      const steps = 24, pts = [];
      for (let i = 0; i < steps; i++) {
        const a = i / steps * Math.PI * 2;
        pts.push({ x: cmd.cx + Math.cos(a) * cmd.rx, y: cmd.cy + Math.sin(a) * cmd.ry });
      }
      rawSegments.push({ pts, style: 'curve', closed: true });
    } else if (cmd.type === 'dim') {
      rawDims.push({ x1: cmd.x1, y1: cmd.y1, x2: cmd.x2, y2: cmd.y2, label: cmd.label || '' });
    }
    // 'text' annotations are not part of geometry — skipped
  }

  if (!rawSegments.length) return { error: 'Nothing to export — draw at least one bar segment first.' };

  // 2) Compute bounding box over ALL geometry points (segments + dim endpoints)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const consider = (x, y) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  };
  rawSegments.forEach(s => s.pts.forEach(p => consider(p.x, p.y)));
  rawDims.forEach(d => { consider(d.x1, d.y1); consider(d.x2, d.y2); });

  const bw = maxX - minX || 1, bh = maxY - minY || 1;
  // Normalise to 0..1 within the bounding box, rounded to 3 dp
  const nx = x => +(((x - minX) / bw)).toFixed(3);
  const ny = y => +(((y - minY) / bh)).toFixed(3);

  // 3) Build segments in shapes.json shape
  const segments = rawSegments.map(s => {
    const seg = { pts: s.pts.map(p => [nx(p.x), ny(p.y)]), style: s.style };
    if (s.closed) seg.closed = true;
    return seg;
  });

  // 4) Build dims — convert pixel offset back to a small px offset (kept as-is)
  const dims = rawDims.map(d => ({
    from: [nx(d.x1), ny(d.y1)],
    to:   [nx(d.x2), ny(d.y2)],
    label: d.label || 'A',
  }));

  // 5) Assemble the definition
  const def = {
    id:      meta.id,
    label:   meta.label || meta.id,
    group:   'quick',
  };
  if (meta.bs8666)  def.bs8666  = meta.bs8666;
  if (meta.formula) def.formula = meta.formula;
  def.segments = segments;
  if (dims.length) def.dims = dims;

  return { def };
}

// Show the export dialog with the generated JSON + copy/download actions
function exportDrawnShape() {
  const id = (prompt('Shape ID (unique, no spaces) — e.g. "myhook":', '') || '').trim();
  if (!id) return;
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '-');

  const label   = (prompt('Button label (shown in Quick Shapes):', safeId) || safeId).trim();
  const bs8666  = (prompt('BS 8666 code (optional, blank to skip):', '') || '').trim();
  const formula = (prompt('Cutting-length formula (optional, blank to skip):', '') || '').trim();

  const result = buildShapeDefinition({ id: safeId, label, bs8666, formula });
  if (result.error) { alert(result.error); return; }

  const jsonText = formatCompactShape(result.def);
  showExportPanel(jsonText, safeId);
}

// Format exported shape to match the compact style used in shapes.json
function formatCompactShape(def) {
  const q  = (s) => JSON.stringify(s);                 // quoted string
  const ja = (a) => JSON.stringify(a);                 // compact array (no spaces)

  // Scalar header fields — pack onto as few lines as possible (≤80 chars per line)
  const scalars = [];
  scalars.push(`"id": ${q(def.id)}, "label": ${q(def.label)}`);
  if (def.bs8666)  scalars[scalars.length-1] += `, "bs8666": ${q(def.bs8666)}`;
  if (def.formula) scalars.push(`"formula": ${q(def.formula)}`);
  scalars.push(`"group": ${q(def.group || 'quick')}`);

  // Segments — each object inline, e.g. { "pts": [...], "style": "bend" }
  const segObjs = (def.segments || []).map(s => {
    let o = `{ "pts": ${ja(s.pts)}, "style": ${q(s.style)}`;
    if (s.closed) o += ', "closed": true';
    if (s.comment) o += `, "_note": ${q(s.comment)}`;
    return o + ' }';
  });
  // If all segments fit on one line (≤120 chars) use single-line form, else one per line
  const segInline = '[ ' + segObjs.join(', ') + ' ]';
  const segBlock  = segObjs.length <= 1 || segInline.length <= 120
    ? `"segments": ${segInline}`
    : `"segments": [\n      ${segObjs.join(',\n      ')}\n      ]`;

  // Dims — always one per line for readability
  let dimsBlock = '';
  if (def.dims && def.dims.length) {
    const dimObjs = def.dims.map(d => {
      let o = `{ "from": ${ja(d.from)}, "to": ${ja(d.to)}, "label": ${q(d.label)}`;
      if (d.off) o += `, "off": ${ja(d.off)}`;
      if (d.iso) o = `{ "iso": true, "from": ${ja(d.from)}, "to": ${ja(d.to)}, "label": ${q(d.label)}${d.off ? `, "off": ${ja(d.off)}` : ''}`;
      return o + ' }';
    });
    dimsBlock = `,\n      "dims": [\n        ${dimObjs.join(',\n        ')}\n      ]`;
  }

  // Assemble: 6-space indent matches shapes.json array body indentation
  const indent = '      ';
  const fields = scalars.map(s => indent + s).join(',\n') +
    ',\n' + indent + segBlock + dimsBlock;

  return `{\n${fields}\n    }`;
}

// Build & display the export result panel (textarea + copy + download)
function showExportPanel(jsonText, id) {
  let panel = document.getElementById('shapeExportPanel');
  if (panel) panel.remove();

  // Use a <dialog> + showModal so it joins the browser top layer and renders
  // ABOVE the drawer dialog (which is also a modal dialog in the top layer).
  panel = document.createElement('dialog');
  panel.id = 'shapeExportPanel';
  panel.style.cssText =
    'background:var(--panel,#1e2535);color:var(--text,#dde3f0);border:1px solid var(--border,#2e3a52);' +
    'border-radius:16px;max-width:560px;width:92vw;max-height:88vh;padding:0;overflow:hidden;' +
    'box-shadow:0 24px 60px rgba(0,0,0,.5)';
  panel.innerHTML = `
    <div style="display:flex;flex-direction:column;max-height:88vh">
      <div style="padding:14px 18px;border-bottom:1px solid var(--border,#2e3a52);display:flex;align-items:center;gap:10px">
        <span style="font-weight:800;font-size:15px">📐 Shape exported</span>
        <span style="flex:1"></span>
        <button id="expClose" class="btn small ghost" style="font-size:12px">✕</button>
      </div>
      <div style="padding:14px 18px;font-size:12px;line-height:1.6;color:var(--muted,#8a9ab8)">
        Copy this entry into the <b>"shapes"</b> array in <code>bbs/shapes.json</code>,
        then run <code>node bbs/build-shapes.js</code> (or just serve over http).
        The new shape appears in Quick Shapes automatically.
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
      </div>
    </div>`;
  document.body.appendChild(panel);
  panel.showModal();

  const close = () => { panel.close(); panel.remove(); };
  panel.querySelector('#expClose').onclick = close;
  // Click on the ::backdrop (outside the content) closes it
  panel.addEventListener('click', e => { if (e.target === panel) close(); });

  panel.querySelector('#expCopy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(jsonText);
      const b = panel.querySelector('#expCopy');
      b.textContent = '✓ Copied'; setTimeout(() => (b.textContent = '📋 Copy'), 1500);
    } catch {
      // Fallback: select the textarea text
      const ta = panel.querySelector('#expJson');
      ta.removeAttribute('readonly'); ta.focus(); ta.select();
      document.execCommand('copy'); ta.setAttribute('readonly', '');
    }
  };

  panel.querySelector('#expDownload').onclick = () => {
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `shape-${id}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };
}

/* ── Committed history redraw ── */
function redraw() {
  ctx2.fillStyle = '#ffffff';
  ctx2.fillRect(0, 0, canvas.width, canvas.height);
  for (const cmd of history) renderCmd(cmd);
}

function renderCmd(cmd) {
  window._drawerActiveStyle = cmd.style || activeStyle;
  if (cmd.type === 'rebar-path') {
    if (cmd.bezier) {
      drawRebarPath(ctx2, cmd.points, cmd.diam, cmd.closed || false);
    } else {
      drawRebarStraightPolyline(ctx2, cmd.points, cmd.diam, cmd.closed || false);
    }
  } else if (cmd.type === 'ortho-bar') {
    drawRebarStraight(ctx2, cmd.points, cmd.diam, cmd.closed || false);
  } else if (cmd.type === 'rect') {
    const lx=Math.min(cmd.x,cmd.x+cmd.w), rx=Math.max(cmd.x,cmd.x+cmd.w);
    const ty=Math.min(cmd.y,cmd.y+cmd.h), by=Math.max(cmd.y,cmd.y+cmd.h);
    drawRebarStraight(ctx2,[{x:lx,y:ty},{x:rx,y:ty},{x:rx,y:by},{x:lx,y:by}],cmd.diam,true);
  } else if (cmd.type === 'circle') {
    const steps=Math.max(36,Math.round((cmd.rx+cmd.ry)*0.9)), pts=[];
    for(let i=0;i<steps;i++){const a=i/steps*Math.PI*2; pts.push({x:cmd.cx+Math.cos(a)*cmd.rx,y:cmd.cy+Math.sin(a)*cmd.ry});}
    drawRebarPath(ctx2, pts, cmd.diam, true);
  } else if (cmd.type === 'text') {
    ctx2.save();
    ctx2.font = `bold ${cmd.size}px ui-monospace,Consolas,monospace`;
    ctx2.fillStyle = GRAY.dim; ctx2.textAlign = 'left'; ctx2.textBaseline = 'top';
    ctx2.fillText(cmd.text, cmd.x, cmd.y);
    ctx2.restore();
  } else if (cmd.type === 'dim') {
    drawDim(ctx2, cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.label);
  } else if (cmd.type === 'shape') {
    window._drawerActiveStyle = cmd.style || activeStyle;
    drawShapeDiagram(ctx2, cmd.shape, cmd.diam, canvas.width, canvas.height);
  }
}

/* ── Ghost overlay: committed history + in-progress drawing ── */
function renderGhostFrame(cursorPt) {
  redraw();
  window._drawerActiveStyle = activeStyle;

  if (activeTool === 'rebar-path' && isDrawing && livePts.length >= 1) {
    // Build preview point list: placed points + cursor
    const previewPts = cursorPt ? [...livePts, cursorPt] : livePts;

    ctx2.globalAlpha = 0.6;
    if (bezierMode && bezierStartIdx >= 1 && previewPts.length > bezierStartIdx) {
      // Draw straight portion: pts[0..bezierStartIdx]
      const straightPts = previewPts.slice(0, bezierStartIdx + 1);
      if (straightPts.length >= 2) {
        drawRebarStraightPolyline(ctx2, straightPts, getBarSize());
      }
      // Draw bezier portion: pts[bezierStartIdx..end] (shares junction node)
      const bezierPts = previewPts.slice(bezierStartIdx);
      if (bezierPts.length >= 2) {
        drawRebarPath(ctx2, bezierPts, getBarSize(), false);
      }
    } else {
      // All straight
      if (previewPts.length >= 2) {
        drawRebarStraightPolyline(ctx2, previewPts, getBarSize());
      }
    }
    ctx2.globalAlpha = 1;

    // Draw placed anchor nodes as small circles
    for (let i = 0; i < livePts.length; i++) {
      const p = livePts[i];
      ctx2.save();
      ctx2.beginPath();
      ctx2.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx2.fillStyle   = i === 0 ? '#22c55e'
                       : (bezierMode && i === bezierStartIdx) ? '#f97316'
                       : '#38bdf8';
      ctx2.strokeStyle = '#fff';
      ctx2.lineWidth   = 1.5;
      ctx2.fill();
      ctx2.stroke();
      ctx2.restore();
    }

    // Highlight cursor snap point
    if (cursorPt) {
      ctx2.save();
      ctx2.beginPath();
      ctx2.arc(cursorPt.x, cursorPt.y, 4, 0, Math.PI * 2);
      ctx2.fillStyle   = 'rgba(251,191,36,0.85)';
      ctx2.strokeStyle = '#fff';
      ctx2.lineWidth   = 1.5;
      ctx2.fill();
      ctx2.stroke();
      ctx2.restore();
    }

    // Node counter badge
    updateNodeCounter(livePts.length);

  } else if (activeTool === 'ortho-bar' && isDrawing && livePts.length >= 1) {
    // Snap cursor to H/V from last placed point
    const anchor   = livePts[livePts.length - 1];
    const snappedPt = cursorPt ? orthoSnap(cursorPt, anchor) : null;
    const previewPts = snappedPt ? [...livePts, snappedPt] : livePts;

    // Draw straight-segment preview (semi-transparent)
    if (previewPts.length >= 2) {
      ctx2.globalAlpha = 0.6;
      drawRebarStraight(ctx2, previewPts, getBarSize(), false);
      ctx2.globalAlpha = 1;
    }

    // Draw placed anchor nodes
    for (let i = 0; i < livePts.length; i++) {
      const p = livePts[i];
      ctx2.save();
      ctx2.beginPath();
      ctx2.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx2.fillStyle   = i === 0 ? '#22c55e' : '#38bdf8';
      ctx2.strokeStyle = '#fff';
      ctx2.lineWidth   = 1.5;
      ctx2.fill();
      ctx2.stroke();
      ctx2.restore();
    }

    // Show snapped cursor
    if (snappedPt) {
      // Dotted guide line from anchor to snapped point
      ctx2.save();
      ctx2.setLineDash([4, 4]);
      ctx2.strokeStyle = 'rgba(251,191,36,0.5)';
      ctx2.lineWidth   = 1;
      ctx2.beginPath();
      ctx2.moveTo(anchor.x, anchor.y);
      ctx2.lineTo(snappedPt.x, snappedPt.y);
      ctx2.stroke();
      ctx2.setLineDash([]);
      ctx2.restore();

      ctx2.save();
      ctx2.beginPath();
      ctx2.arc(snappedPt.x, snappedPt.y, 4, 0, Math.PI * 2);
      ctx2.fillStyle   = 'rgba(251,191,36,0.9)';
      ctx2.strokeStyle = '#fff';
      ctx2.lineWidth   = 1.5;
      ctx2.fill();
      ctx2.stroke();
      ctx2.restore();
    }

    updateNodeCounter(livePts.length);

  } else if (activeTool === 'rect' && dragStart && cursorPt) {
    const lx=Math.min(dragStart.x,cursorPt.x), rx=Math.max(dragStart.x,cursorPt.x);
    const ty=Math.min(dragStart.y,cursorPt.y), by=Math.max(dragStart.y,cursorPt.y);
    ctx2.globalAlpha = 0.6;
    drawRebarPath(ctx2,[{x:lx,y:ty},{x:rx,y:ty},{x:rx,y:by},{x:lx,y:by}],getBarSize(),true);
    ctx2.globalAlpha = 1;

  } else if (activeTool === 'circle' && dragStart && cursorPt) {
    const rxv=Math.abs(cursorPt.x-dragStart.x), ryv=Math.abs(cursorPt.y-dragStart.y);
    if (rxv > 4 || ryv > 4) {
      const steps=Math.max(36,Math.round((rxv+ryv)*0.9)), pts=[];
      for(let i=0;i<steps;i++){const a=i/steps*Math.PI*2; pts.push({x:dragStart.x+Math.cos(a)*rxv,y:dragStart.y+Math.sin(a)*ryv});}
      ctx2.globalAlpha = 0.6;
      drawRebarPath(ctx2, pts, getBarSize(), true);
      ctx2.globalAlpha = 1;
    }
  } else if (activeTool === 'dim' && dimPhase === 1 && dimStart && cursorPt) {
    ctx2.globalAlpha = 0.6;
    drawDim(ctx2, dimStart.x, dimStart.y, cursorPt.x, cursorPt.y, getAnnot());
    ctx2.globalAlpha = 1;
  }
}

function updateNodeCounter(n) {
  const el = document.getElementById('nodeCounter');
  if (!el) return;
  if (n > 0) {
    el.style.display = 'block';
    el.textContent   = n === 1
      ? '1 point — keep clicking to build path'
      : `${n} points — dbl-click or Enter to finish`;
  } else {
    el.style.display = 'none';
  }
}

function showPathHint(on, isOrtho) {
  const el = document.getElementById('pathHint');
  if (!el) return;
  el.style.display = on ? 'block' : 'none';
  if (on) {
    const titleEl = document.getElementById('pathHintTitle');
    const bodyEl  = document.getElementById('pathHintBody');
    if (isOrtho) {
      if (titleEl) titleEl.textContent = 'Ortho Drawing…';
      if (bodyEl)  bodyEl.innerHTML = 'Click — snap H/V point<br>Dbl-click / Enter — finish<br>Esc — cancel';
    } else {
      if (titleEl) titleEl.textContent = '━ Straight Mode';
      if (bodyEl)  bodyEl.innerHTML = 'Click — add point<br>Dbl-click / Enter — finish<br><b>B</b> — toggle Bézier curve<br>Esc — cancel';
    }
  }
}

/* ── Commit finished rebar/ortho path ── */
function commitRebarPath() {
  if (livePts.length < 2) { cancelPath(); return; }

  if (activeTool === 'ortho-bar') {
    history.push({ type:'ortho-bar', points:[...livePts], diam:getBarSize(), style:activeStyle, closed:false });
  } else if (bezierMode && bezierStartIdx >= 1 && livePts.length > bezierStartIdx) {
    // Straight portion: pts[0..bezierStartIdx]
    const straightPts = livePts.slice(0, bezierStartIdx + 1);
    if (straightPts.length >= 2) {
      history.push({ type:'rebar-path', points:straightPts, diam:getBarSize(), style:activeStyle, closed:false, bezier:false });
    }
    // Bezier portion: pts[bezierStartIdx..end]
    const bezierPts = livePts.slice(bezierStartIdx);
    if (bezierPts.length >= 2) {
      history.push({ type:'rebar-path', points:bezierPts, diam:getBarSize(), style:activeStyle, closed:false, bezier:true });
    }
  } else {
    // All straight
    history.push({ type:'rebar-path', points:[...livePts], diam:getBarSize(), style:activeStyle, closed:false, bezier:false });
  }

  cancelPath();
  redraw();
}

function cancelPath() {
  isDrawing      = false;
  livePts        = [];
  mousePos       = null;
  bezierMode     = false;
  bezierStartIdx = -1;
  updateNodeCounter(0);
  showPathHint(false);
  redraw();
}

/* ── Mouse / touch event handlers ── */
function onDown(e) {
  // Prevent right-click (e.button is undefined on touch events)
  if (e.button != null && e.button === 2) return;

  const pt = getXY(e);

  if (activeTool === 'text') {
    history.push({ type:'text', x:pt.x, y:pt.y, text:getAnnot(), size:getFontSize() });
    redraw();
    return;
  }

  if (activeTool === 'dim') {
    if (dimPhase === 0) {
      dimPhase = 1;
      dimStart = pt;
    } else {
      history.push({ type:'dim', x1:dimStart.x, y1:dimStart.y, x2:pt.x, y2:pt.y, label:getAnnot() });
      dimPhase = 0; dimStart = null;
      redraw();
    }
    return;
  }

  if (activeTool === 'rebar-path') {
    if (!isDrawing) {
      isDrawing = true;
      livePts   = [pt];
      showPathHint(true);
    } else {
      // Check if clicking near the first point to close the path
      const first = livePts[0];
      const closeThresh = 16;
      if (livePts.length >= 3 && Math.hypot(pt.x - first.x, pt.y - first.y) < closeThresh) {
        // Commit as closed path — split if bezier mode active
        if (bezierMode && bezierStartIdx >= 1 && livePts.length > bezierStartIdx) {
          const straightPts = livePts.slice(0, bezierStartIdx + 1);
          if (straightPts.length >= 2)
            history.push({ type:'rebar-path', points:straightPts, diam:getBarSize(), style:activeStyle, closed:false, bezier:false });
          const bezierPts = [...livePts.slice(bezierStartIdx), livePts[0]];
          if (bezierPts.length >= 2)
            history.push({ type:'rebar-path', points:bezierPts, diam:getBarSize(), style:activeStyle, closed:true, bezier:true });
        } else {
          history.push({ type:'rebar-path', points:[...livePts], diam:getBarSize(), style:activeStyle, closed:true, bezier:false });
        }
        cancelPath();
        return;
      }
      livePts.push(pt);
    }
    renderGhostFrame(pt);
    return;
  }

  if (activeTool === 'ortho-bar') {
    if (!isDrawing) {
      isDrawing = true;
      livePts   = [pt];
      showPathHint(true, true);
    } else {
      // Snap new point to H or V from previous
      const snapped = orthoSnap(pt, livePts[livePts.length - 1]);
      // Close path if near first point
      const first = livePts[0];
      const closeThresh = 16;
      if (livePts.length >= 3 && Math.hypot(snapped.x - first.x, snapped.y - first.y) < closeThresh) {
        history.push({ type:'ortho-bar', points:[...livePts], diam:getBarSize(), style:activeStyle, closed:true });
        cancelPath();
        return;
      }
      livePts.push(snapped);
    }
    renderGhostFrame(pt);
    return;
  }

  // rect / circle: drag start
  if (activeTool === 'rect' || activeTool === 'circle') {
    dragStart = pt;
  }
}

function onMove(e) {
  const pt = getXY(e);
  mousePos = pt;

  if (activeTool === 'rebar-path' && isDrawing) {
    renderGhostFrame(pt);
    return;
  }
  if (activeTool === 'ortho-bar' && isDrawing) {
    renderGhostFrame(pt);
    return;
  }
  if ((activeTool === 'rect' || activeTool === 'circle') && dragStart) {
    renderGhostFrame(pt);
    return;
  }
  if (activeTool === 'dim' && dimPhase === 1) {
    renderGhostFrame(pt);
    return;
  }
}

function onUp(e) {
  if (activeTool === 'rect' && dragStart) {
    const pt = getXY(e);
    history.push({ type:'rect', x:dragStart.x, y:dragStart.y, w:pt.x-dragStart.x, h:pt.y-dragStart.y, diam:getBarSize(), style:activeStyle });
    dragStart = null;
    redraw();
    return;
  }
  if (activeTool === 'circle' && dragStart) {
    const pt = getXY(e);
    const rx = Math.abs(pt.x - dragStart.x), ry = Math.abs(pt.y - dragStart.y);
    if (rx > 4 || ry > 4) {
      history.push({ type:'circle', cx:dragStart.x, cy:dragStart.y, rx, ry, diam:getBarSize(), style:activeStyle });
    }
    dragStart = null;
    redraw();
    return;
  }
}

function onDblClick(e) {
  if ((activeTool === 'rebar-path' || activeTool === 'ortho-bar') && isDrawing) {
    // Remove the extra point added by the second click of the double-click
    if (livePts.length > 1) livePts.pop();
    commitRebarPath();
  }
}

function onKeyDown(e) {
  if (e.key === 'Escape') {
    if (isDrawing) cancelPath();
    if (dimPhase === 1) { dimPhase = 0; dimStart = null; redraw(); }
    dragStart = null;
  }
  if ((e.key === 'Enter') && (activeTool === 'rebar-path' || activeTool === 'ortho-bar') && isDrawing) {
    commitRebarPath();
  }
  // B key: toggle bezier curve mode while drawing a rebar-path
  if ((e.key === 'b' || e.key === 'B') && activeTool === 'rebar-path' && isDrawing) {
    bezierMode = !bezierMode;
    if (bezierMode) {
      // Mark where the bezier segment starts — the last placed node
      bezierStartIdx = livePts.length - 1;
    } else {
      bezierStartIdx = -1;
    }
    // Update the hint title to show current mode
    const titleEl = document.getElementById('pathHintTitle');
    const bodyEl  = document.getElementById('pathHintBody');
    if (titleEl) titleEl.textContent = bezierMode ? '〽 Bézier Mode (B)' : '━ Straight Mode (B)';
    if (bodyEl) bodyEl.innerHTML =
      (bezierMode
        ? '<b style="color:var(--brand)">Curve</b> — smooth Bézier spline<br>'
        : '<b>Straight</b> — sharp straight segments<br>') +
      'Click — add point<br>Dbl-click / Enter — finish<br>Esc — cancel';
    renderGhostFrame(mousePos);
  }
}

/* ── Tool / style setters ── */
function setTool(t) {
  // Cancel any in-progress draw when switching tools
  if (isDrawing) cancelPath();
  dimPhase = 0; dimStart = null; dragStart = null;

  activeTool = t;
  document.querySelectorAll('.drawer-tool').forEach(b => {
    const on = b.dataset.tool === t;
    b.style.background  = on ? 'var(--brand)' : '';
    b.style.color       = on ? '#05131f' : '';
    b.style.fontWeight  = on ? '700' : '';
  });
  canvas.style.cursor = t === 'text' ? 'text' : 'crosshair';
  showPathHint(false);
  // Update canvas footer hint
  const hintEl = document.getElementById('canvasHint');
  if (hintEl) {
    if (t === 'ortho-bar') {
      hintEl.textContent = 'Ortho mode: clicks snap H/V · Dbl-click=finish · Esc=cancel';
    } else {
      hintEl.textContent = 'Click=add point · B=toggle Bézier · Dbl-click=finish · Esc=cancel · white=print-safe';
    }
  }
}

function setStyle(s) {
  activeStyle = s;
  window._drawerActiveStyle = s;
  document.querySelectorAll('.rebar-style-btn').forEach(b => {
    const on = b.dataset.style === s;
    b.style.borderColor = on ? 'var(--brand)' : '';
    b.style.background  = on ? 'rgba(34,197,94,.1)' : '';
    b.style.color       = on ? 'var(--brand)' : '';
  });
}

/* ── Init ── */
let _canvasListenersAttached = false;

function initDrawer() {
  canvas = document.getElementById('rebarCanvas');
  const wrap = document.getElementById('svgCanvasWrap');
  canvas.width  = wrap.clientWidth  || 700;
  canvas.height = wrap.clientHeight || 460;
  ctx2 = canvas.getContext('2d');

  history   = [];
  isDrawing = false;
  livePts   = [];
  dragStart = null;
  dimPhase  = 0;
  dimStart  = null;
  mousePos  = null;
  bezierMode = false;
  redraw();

  // Remove old listeners before re-attaching to prevent stacking
  canvas.removeEventListener('mousedown',  onDown);
  canvas.removeEventListener('mousemove',  onMove);
  canvas.removeEventListener('mouseup',    onUp);
  canvas.removeEventListener('dblclick',   onDblClick);
  document.removeEventListener('keydown',  onKeyDown);

  canvas.addEventListener('mousedown',  onDown);
  canvas.addEventListener('mousemove',  onMove);
  canvas.addEventListener('mouseup',    onUp);
  canvas.addEventListener('dblclick',   onDblClick);
  canvas.addEventListener('touchstart', e => { e.preventDefault(); onDown(e); }, { passive:false });
  canvas.addEventListener('touchmove',  e => { e.preventDefault(); onMove(e); }, { passive:false });
  canvas.addEventListener('touchend',   e => { e.preventDefault(); onUp(e);   }, { passive:false });
  document.addEventListener('keydown',  onKeyDown);

  // Strip any previously-attached button listeners by replacing each button with a fresh clone
  // (quick-shape buttons are rebuilt separately by populateQuickShapes)
  document.querySelectorAll('.drawer-tool, .rebar-style-btn, .annot-preset').forEach(b => {
    const clone = b.cloneNode(true);
    b.parentNode.replaceChild(clone, b);
  });

  document.querySelectorAll('.drawer-tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
  document.querySelectorAll('.rebar-style-btn').forEach(b => b.addEventListener('click', () => setStyle(b.dataset.style)));
  document.querySelectorAll('.annot-preset').forEach(b => b.addEventListener('click', () => {
    document.getElementById('drawerAnnotText').value = b.dataset.text;
    setTool('text');
  }));

  document.getElementById('drawerBarSize').addEventListener('input', e => {
    document.getElementById('drawerBarVal').textContent = e.target.value;
    history = history.map(cmd => cmd.type === 'shape' ? { ...cmd, diam:parseInt(e.target.value,10) } : cmd);
    redraw();
  });
  document.getElementById('drawerFontSize').addEventListener('input', e => {
    document.getElementById('drawerFontVal').textContent = e.target.value;
  });
  document.getElementById('drawerUndo').onclick = () => {
    if (isDrawing && livePts.length > 1) { livePts.pop(); renderGhostFrame(mousePos); return; }
    if (isDrawing)                        { cancelPath(); return; }
    history.pop(); redraw();
  };
  document.getElementById('drawerClear').onclick = () => {
    cancelPath(); history = []; redraw();
  };
  document.getElementById('drawerExport').onclick = () => {
    if (isDrawing) commitRebarPath();  // finalise any in-progress path first
    exportDrawnShape();
  };

  setTool('rebar-path');
  setStyle('tor');
}

function ensureDrawerModal() {
  if (!document.getElementById('shapeDrawerDlg'))
    document.body.insertAdjacentHTML('beforeend', drawerHTML);
}

/* ── Shape library loading (bbs/shapes.json) ── */
window.SHAPE_LIB      = window.SHAPE_LIB || {};      // id -> definition
window.SHAPE_LIB_LIST = window.SHAPE_LIB_LIST || []; // ordered array

async function loadShapeLibrary() {
  if (window.SHAPE_LIB_LIST.length) return; // already loaded

  // 1) Start from the embedded default library (always works, even on file://)
  let list = Array.isArray(window.SHAPE_LIB_DEFAULT) ? window.SHAPE_LIB_DEFAULT.slice() : [];

  // 2) Try to override/extend from the editable bbs/shapes.json (works over http)
  try {
    const res = await fetch('bbs/shapes.json', { cache: 'no-cache' });
    if (res.ok) {
      const data = await res.json();
      const fileList = (data.shapes || []).filter(s => s && s.id);
      if (fileList.length) list = fileList;   // JSON file wins when present & valid
    }
  } catch (err) {
    // fetch fails on file:// (CORS) or offline — keep the embedded default.
    // The user can also use the "⤓ Load JSON" button to load shapes.json manually.
    console.info('shapes.json not auto-fetched (using embedded default). On file:// use the "Load JSON" button to load it manually.');
  }

  // 3) Last-resort fallback so the drawer never breaks
  if (!list.length) {
    list = [{ id:'straight', label:'Straight', group:'quick',
      segments:[{pts:[[0,0.5],[1,0.5]],style:'straight'}],
      dims:[{from:[0,0.5],to:[1,0.5],label:'A',off:[0,-24]}] }];
  }

  window.SHAPE_LIB_LIST = list;
  window.SHAPE_LIB = {};
  list.forEach(s => { window.SHAPE_LIB[s.id] = s; });
}

// Apply a parsed shapes-list to the live library and refresh the UI
function applyShapeList(list, sourceLabel) {
  const clean = (list || []).filter(s => s && s.id);
  if (!clean.length) { alert('No valid shapes found in ' + (sourceLabel || 'file') + '.'); return false; }
  window.SHAPE_LIB_LIST = clean;
  window.SHAPE_LIB = {};
  clean.forEach(s => { window.SHAPE_LIB[s.id] = s; });
  populateQuickShapes();
  return true;
}

// Manually load a shapes.json file chosen by the user (works on file://)
function manualLoadShapesJson() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json,application/json';
  inp.onchange = () => {
    const file = inp.files && inp.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        // Accept either {shapes:[...]} or a bare array of shapes
        const list = Array.isArray(data) ? data : (data.shapes || []);
        if (applyShapeList(list, file.name)) {
          const btn = document.getElementById('loadShapesBtn');
          if (btn) { const t = btn.textContent; btn.textContent = '✓ Loaded'; setTimeout(() => (btn.textContent = t), 1500); }
        }
      } catch (err) {
        alert('Could not parse JSON: ' + err.message);
      }
    };
    reader.onerror = () => alert('Could not read file.');
    reader.readAsText(file);
  };
  inp.click();
}

function populateQuickShapes() {
  const host = document.getElementById('quickShapeList');
  if (!host) return;
  const quick = window.SHAPE_LIB_LIST.filter(s => (s.group || 'quick') === 'quick');
  if (!quick.length) { host.innerHTML = '<span style="font-size:10px;color:var(--muted)">No shapes</span>'; return; }
  host.innerHTML = quick.map(s =>
    `<button class="btn small ghost shape-prev-btn" data-shape="${s.id}" title="${s.bs8666 ? 'BS 8666 shape ' + s.bs8666 : ''}" style="font-size:10px;text-align:left;padding:3px 7px">${s.label || s.id}</button>`
  ).join('');
  // Wire clicks (cloned-fresh elements, so bind here)
  host.querySelectorAll('.shape-prev-btn').forEach(b => b.addEventListener('click', () => {
    history = [{ type:'shape', shape:b.dataset.shape, diam:getBarSize(), style:activeStyle }];
    redraw();
  }));

  // Wire the manual JSON loader button (idempotent via onclick)
  const loadBtn = document.getElementById('loadShapesBtn');
  if (loadBtn) loadBtn.onclick = manualLoadShapesJson;
}

window.ShapeDrawer = {
  async open(callback) {
    ensureDrawerModal();
    await loadShapeLibrary();
    drawerCallback = callback;
    const dlg = document.getElementById('shapeDrawerDlg');
    dlg.showModal();
    setTimeout(() => { initDrawer(); populateQuickShapes(); }, 60);
    document.getElementById('drawerDone').onclick   = () => {
      if (isDrawing) commitRebarPath();
      dlg.close();
      if (drawerCallback) drawerCallback(canvas.toDataURL('image/png'));
      document.removeEventListener('keydown', onKeyDown);
    };
    document.getElementById('drawerCancel').onclick = () => {
      cancelPath();
      dlg.close();
      document.removeEventListener('keydown', onKeyDown);
    };
  }
};
