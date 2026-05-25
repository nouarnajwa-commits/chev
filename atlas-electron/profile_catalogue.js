// ── PROFILE CATALOGUE — parametric axonometric SVG generators ──
// Produces precise technical axonometric drawings from standardised dimensions.
// Each function returns an SVG string fitting a 240x240 viewBox.

// Axonometric projection helper: isometric-like 30° angles
// x' = x - z*cos(30)
// y' = y - x*sin(30)*0.5 + z*sin(30)*0.5  (slight foreshortening for clarity)
const COS30 = Math.cos(Math.PI/6);
const SIN30 = Math.sin(Math.PI/6);

function proj(x, y, z) {
  return {
    x: x - z * COS30,
    y: -y + z * SIN30 // SVG y is inverted
  };
}

function buildBox(L, W, H, cx, cy, scale, opts={}) {
  // Build axonometric box of dimensions L (length, along x), W (width, along z), H (height, along y)
  // centred at (cx, cy) in SVG coords. Returns array of <path>/<line> SVG strings.
  const s = scale;
  // 8 corners
  const c = [
    proj(0, 0, 0), proj(L, 0, 0), proj(L, H, 0), proj(0, H, 0), // front face
    proj(0, 0, W), proj(L, 0, W), proj(L, H, W), proj(0, H, W), // back face
  ].map(p => ({ x: cx + p.x * s, y: cy + p.y * s }));

  const strokeStyle = opts.strokeWidth || 1.4;
  const dashedStyle = opts.dashedStyle || 'stroke-dasharray="2 2" opacity="0.45"';

  // Visible faces: front (0-1-2-3), top (3-2-6-7), right (1-2-6-5)
  const lines = [];
  // Visible solid edges
  const visible = [
    [0,1],[1,2],[2,3],[3,0],   // front face
    [2,6],[3,7],[6,7],         // top edges to back
    [1,5],[5,6],                // right edges to back
  ];
  visible.forEach(([a,b]) => lines.push(`<line x1="${c[a].x.toFixed(2)}" y1="${c[a].y.toFixed(2)}" x2="${c[b].x.toFixed(2)}" y2="${c[b].y.toFixed(2)}" stroke="black" stroke-width="${strokeStyle}" stroke-linecap="round"/>`));
  // Hidden edges (dashed)
  const hidden = [
    [0,4],[4,5],[4,7],
  ];
  hidden.forEach(([a,b]) => lines.push(`<line x1="${c[a].x.toFixed(2)}" y1="${c[a].y.toFixed(2)}" x2="${c[b].x.toFixed(2)}" y2="${c[b].y.toFixed(2)}" stroke="black" stroke-width="${strokeStyle*0.7}" ${dashedStyle} stroke-linecap="round"/>`));
  return lines;
}

function fitScale(L, W, H, maxPx=180) {
  // Compute scale that fits the projected bounding box within maxPx
  const projW = L + W * COS30;
  const projH = H + W * SIN30;
  const maxDim = Math.max(projW, projH);
  return maxPx / maxDim;
}

function svgWrap(content, viewBoxSize=240) {
  return `<svg viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="black" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${content}</svg>`;
}

// ── IPE / HEA / HEB / HEM / UPN catalogue (dimensions in mm: h × b × tw × tf) ──
const IPE = {
  IPE80: {h:80, b:46, tw:3.8, tf:5.2}, IPE100: {h:100, b:55, tw:4.1, tf:5.7},
  IPE120: {h:120, b:64, tw:4.4, tf:6.3}, IPE140: {h:140, b:73, tw:4.7, tf:6.9},
  IPE160: {h:160, b:82, tw:5, tf:7.4}, IPE180: {h:180, b:91, tw:5.3, tf:8},
  IPE200: {h:200, b:100, tw:5.6, tf:8.5}, IPE220: {h:220, b:110, tw:5.9, tf:9.2},
  IPE240: {h:240, b:120, tw:6.2, tf:9.8}, IPE270: {h:270, b:135, tw:6.6, tf:10.2},
  IPE300: {h:300, b:150, tw:7.1, tf:10.7}, IPE330: {h:330, b:160, tw:7.5, tf:11.5},
  IPE360: {h:360, b:170, tw:8, tf:12.7}, IPE400: {h:400, b:180, tw:8.6, tf:13.5},
  IPE450: {h:450, b:190, tw:9.4, tf:14.6}, IPE500: {h:500, b:200, tw:10.2, tf:16},
  IPE550: {h:550, b:210, tw:11.1, tf:17.2}, IPE600: {h:600, b:220, tw:12, tf:19},
};
const HEA = {
  HEA100: {h:96, b:100, tw:5, tf:8}, HEA120: {h:114, b:120, tw:5, tf:8},
  HEA140: {h:133, b:140, tw:5.5, tf:8.5}, HEA160: {h:152, b:160, tw:6, tf:9},
  HEA180: {h:171, b:180, tw:6, tf:9.5}, HEA200: {h:190, b:200, tw:6.5, tf:10},
  HEA220: {h:210, b:220, tw:7, tf:11}, HEA240: {h:230, b:240, tw:7.5, tf:12},
  HEA260: {h:250, b:260, tw:7.5, tf:12.5}, HEA280: {h:270, b:280, tw:8, tf:13},
  HEA300: {h:290, b:300, tw:8.5, tf:14}, HEA320: {h:310, b:300, tw:9, tf:15.5},
  HEA340: {h:330, b:300, tw:9.5, tf:16.5}, HEA360: {h:350, b:300, tw:10, tf:17.5},
  HEA400: {h:390, b:300, tw:11, tf:19}, HEA450: {h:440, b:300, tw:11.5, tf:21},
  HEA500: {h:490, b:300, tw:12, tf:23}, HEA600: {h:590, b:300, tw:13, tf:25},
};
const HEB = {
  HEB100: {h:100, b:100, tw:6, tf:10}, HEB120: {h:120, b:120, tw:6.5, tf:11},
  HEB140: {h:140, b:140, tw:7, tf:12}, HEB160: {h:160, b:160, tw:8, tf:13},
  HEB180: {h:180, b:180, tw:8.5, tf:14}, HEB200: {h:200, b:200, tw:9, tf:15},
  HEB220: {h:220, b:220, tw:9.5, tf:16}, HEB240: {h:240, b:240, tw:10, tf:17},
  HEB260: {h:260, b:260, tw:10, tf:17.5}, HEB280: {h:280, b:280, tw:10.5, tf:18},
  HEB300: {h:300, b:300, tw:11, tf:19}, HEB320: {h:320, b:300, tw:11.5, tf:20.5},
  HEB340: {h:340, b:300, tw:12, tf:21.5}, HEB360: {h:360, b:300, tw:12.5, tf:22.5},
  HEB400: {h:400, b:300, tw:13.5, tf:24}, HEB450: {h:450, b:300, tw:14, tf:26},
  HEB500: {h:500, b:300, tw:14.5, tf:28}, HEB600: {h:600, b:300, tw:15.5, tf:30},
};

function genIBeamAxono(spec, defaultLength=2000) {
  // Generate axonometric view of an I-shaped profile
  // spec: {h, b, tw, tf}  // h=height, b=flange width, tw=web thickness, tf=flange thickness
  // defaultLength: length of beam in mm (for visualisation, real length is item.dim_l_cm)
  const L = defaultLength;
  const h = spec.h, b = spec.b, tw = spec.tw, tf = spec.tf;
  const scale = fitScale(L, b, h, 170);
  const cx = 35, cy = 200;
  const s = scale;

  // I-section cross-section path in 2D (centred on origin, in section plane Y-Z)
  // We'll build the 3D extrusion manually
  function ptYZ(yLocal, zLocal) {
    // Apply axonometric: full extrusion is along X axis
    return proj(0, yLocal, zLocal);
  }
  function ptXYZ(x, y, z) {
    return proj(x, y, z);
  }

  // Define 12 vertices of I-section in (y,z) at x=0 and x=L
  // I-section corners (y up, z across flange, centred)
  const halfB = b/2, halfH = h/2;
  const halfTw = tw/2;
  const flangeBottomY = -halfH + tf;
  const flangeTopY = halfH - tf;

  // 12 corners of section (start CCW from top-right outer flange corner)
  const sect = [
    {y:halfH, z:-halfB},  {y:halfH, z:halfB},        // top flange top
    {y:flangeTopY, z:halfB}, {y:flangeTopY, z:halfTw},
    {y:flangeBottomY, z:halfTw}, {y:flangeBottomY, z:halfB},
    {y:-halfH, z:halfB}, {y:-halfH, z:-halfB},        // bottom flange bottom
    {y:flangeBottomY, z:-halfB}, {y:flangeBottomY, z:-halfTw},
    {y:flangeTopY, z:-halfTw}, {y:flangeTopY, z:-halfB},
  ];
  // Project front (x=0) and back (x=L) faces
  const front = sect.map(p => { const pr = ptXYZ(0, p.y, p.z); return { x: cx + pr.x*s, y: cy + pr.y*s }; });
  const back  = sect.map(p => { const pr = ptXYZ(L, p.y, p.z); return { x: cx + pr.x*s, y: cy + pr.y*s }; });

  const lines = [];
  // Front face outline (I-section)
  const frontPath = 'M ' + front.map(p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' L ') + ' Z';
  lines.push(`<path d="${frontPath}" stroke="black" stroke-width="1.2"/>`);
  // Back face outline
  const backPath = 'M ' + back.map(p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' L ') + ' Z';
  lines.push(`<path d="${backPath}" stroke="black" stroke-width="1.0" opacity="0.75"/>`);
  // Connecting edges — only the visible ones (right side, top, bottom): outermost convex hull
  // Simpler: just connect each pair of corresponding vertices
  for (let i=0; i<sect.length; i++) {
    // Only some edges are visible from axono — outer edges of I from this view
    const visibleIndices = [0,1,2,5,6,7,8,11]; // outer corners
    if (visibleIndices.includes(i)) {
      lines.push(`<line x1="${front[i].x.toFixed(2)}" y1="${front[i].y.toFixed(2)}" x2="${back[i].x.toFixed(2)}" y2="${back[i].y.toFixed(2)}" stroke="black" stroke-width="1.0" opacity="0.85"/>`);
    }
  }
  // Dimension axes (light dashed)
  lines.push(`<line x1="${cx-10}" y1="${cy+5}" x2="${cx-10}" y2="${cy-h*s-5}" stroke="black" stroke-width="0.5" stroke-dasharray="2 2" opacity="0.5"/>`);
  lines.push(`<text x="${cx-14}" y="${cy-h*s/2}" font-size="6" fill="black" opacity="0.6" text-anchor="end">h=${h}</text>`);

  return svgWrap(lines.join(''));
}

function genUChannelAxono(spec, defaultLength=2000) {
  const L = defaultLength;
  const h = spec.h, b = spec.b, tw = spec.tw, tf = spec.tf;
  const scale = fitScale(L, b, h, 170);
  const cx = 35, cy = 200;
  const s = scale;
  // U-section: 8 vertices
  const halfH = h/2;
  const sect = [
    {y:halfH, z:0}, {y:halfH, z:b},
    {y:halfH-tf, z:b}, {y:halfH-tf, z:tw},
    {y:-halfH+tf, z:tw}, {y:-halfH+tf, z:b},
    {y:-halfH, z:b}, {y:-halfH, z:0},
  ];
  const front = sect.map(p => { const pr = proj(0, p.y, p.z); return { x: cx + pr.x*s, y: cy + pr.y*s }; });
  const back  = sect.map(p => { const pr = proj(L, p.y, p.z); return { x: cx + pr.x*s, y: cy + pr.y*s }; });
  const lines = [];
  const frontPath = 'M ' + front.map(p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' L ') + ' Z';
  lines.push(`<path d="${frontPath}" stroke="black" stroke-width="1.2"/>`);
  const backPath = 'M ' + back.map(p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' L ') + ' Z';
  lines.push(`<path d="${backPath}" stroke="black" stroke-width="1.0" opacity="0.75"/>`);
  for (let i=0; i<sect.length; i++) {
    lines.push(`<line x1="${front[i].x.toFixed(2)}" y1="${front[i].y.toFixed(2)}" x2="${back[i].x.toFixed(2)}" y2="${back[i].y.toFixed(2)}" stroke="black" stroke-width="1.0" opacity="0.85"/>`);
  }
  return svgWrap(lines.join(''));
}

function genTubeRectAxono(L_mm, W_mm, H_mm) {
  // Hollow rectangular tube — drawn as box
  const scale = fitScale(L_mm, W_mm, H_mm, 170);
  const cx = 35, cy = 200;
  const lines = buildBox(L_mm, W_mm, H_mm, cx, cy, scale);
  return svgWrap(lines.join(''));
}

function genTubeRoundAxono(L_mm, D_mm) {
  // Hollow round tube — drawn as cylinder
  const scale = fitScale(L_mm, D_mm, D_mm, 170);
  const cx = 35, cy = 200;
  const s = scale;
  const R = D_mm/2 * s;
  // Front circle
  const frontC = proj(0, 0, 0);
  const backC = proj(L_mm, 0, 0);
  const fx = cx + frontC.x * s, fy = cy + frontC.y * s;
  const bx = cx + backC.x * s, by = cy + backC.y * s;
  const lines = [];
  // Back ellipse (foreshortened)
  lines.push(`<ellipse cx="${bx.toFixed(2)}" cy="${by.toFixed(2)}" rx="${R.toFixed(2)}" ry="${(R*0.4).toFixed(2)}" stroke="black" stroke-width="1.0" opacity="0.6" fill="none"/>`);
  // Top + bottom edges connecting front and back
  lines.push(`<line x1="${fx.toFixed(2)}" y1="${(fy-R).toFixed(2)}" x2="${bx.toFixed(2)}" y2="${(by-R).toFixed(2)}" stroke="black" stroke-width="1.2"/>`);
  lines.push(`<line x1="${fx.toFixed(2)}" y1="${(fy+R).toFixed(2)}" x2="${bx.toFixed(2)}" y2="${(by+R).toFixed(2)}" stroke="black" stroke-width="1.2"/>`);
  // Front ellipse
  lines.push(`<ellipse cx="${fx.toFixed(2)}" cy="${fy.toFixed(2)}" rx="${R.toFixed(2)}" ry="${(R*0.4).toFixed(2)}" stroke="black" stroke-width="1.2" fill="none"/>`);
  // Axis dashed
  lines.push(`<line x1="${fx.toFixed(2)}" y1="${fy.toFixed(2)}" x2="${bx.toFixed(2)}" y2="${by.toFixed(2)}" stroke="black" stroke-width="0.5" stroke-dasharray="2 2" opacity="0.4"/>`);
  return svgWrap(lines.join(''));
}

function genBrickAxono(L_mm, W_mm, H_mm, hollow=false) {
  // L = length, W = depth, H = height
  const scale = fitScale(L_mm, W_mm, H_mm, 180);
  const cx = 35, cy = 200;
  const lines = buildBox(L_mm, W_mm, H_mm, cx, cy, scale);
  if (hollow) {
    // Add hollow indicator on front face (small rectangles)
    const s = scale;
    const cellW = W_mm * 0.15, cellH = H_mm * 0.6;
    for (let i=0; i<3; i++) {
      const x0 = L_mm * (0.2 + i*0.25);
      const y0 = H_mm * 0.2;
      const p1 = proj(x0, y0, 0);
      const p2 = proj(x0 + L_mm*0.15, y0 + cellH, 0);
      lines.push(`<rect x="${(cx + p1.x*s).toFixed(2)}" y="${(cy + p2.y*s).toFixed(2)}" width="${((p2.x-p1.x)*s).toFixed(2)}" height="${((p1.y-p2.y)*s).toFixed(2)}" stroke="black" stroke-width="0.7" fill="none" opacity="0.7"/>`);
    }
  }
  return svgWrap(lines.join(''));
}

function genConcreteSlab(L_mm, W_mm, H_mm, hollow_core=false) {
  const scale = fitScale(L_mm, W_mm, H_mm, 180);
  const cx = 35, cy = 200;
  const lines = buildBox(L_mm, W_mm, H_mm, cx, cy, scale);
  if (hollow_core) {
    // Draw circular voids on front face (alveolar slab)
    const s = scale;
    const voidD = H_mm * 0.6;
    const ncells = Math.max(2, Math.floor(L_mm / (voidD * 1.5)));
    for (let i=0; i<ncells; i++) {
      const x0 = L_mm * (i + 0.5) / ncells;
      const y0 = H_mm * 0.5;
      const p = proj(x0, y0, 0);
      lines.push(`<ellipse cx="${(cx + p.x*s).toFixed(2)}" cy="${(cy + p.y*s).toFixed(2)}" rx="${(voidD/2 * s).toFixed(2)}" ry="${(voidD/2 * s * 0.7).toFixed(2)}" stroke="black" stroke-width="0.7" fill="none" opacity="0.65"/>`);
    }
  }
  return svgWrap(lines.join(''));
}

function genAngleAxono(L_mm, side_mm, thickness_mm) {
  // L-cornière (equal-leg angle): 6 vertices in section
  const scale = fitScale(L_mm, side_mm, side_mm, 170);
  const cx = 35, cy = 200;
  const s = scale;
  const a = side_mm, t = thickness_mm;
  const sect = [
    {y:0, z:0}, {y:0, z:a},
    {y:t, z:a}, {y:t, z:t},
    {y:a, z:t}, {y:a, z:0},
  ];
  const front = sect.map(p => { const pr = proj(0, p.y, p.z); return { x: cx + pr.x*s, y: cy + pr.y*s }; });
  const back  = sect.map(p => { const pr = proj(L_mm, p.y, p.z); return { x: cx + pr.x*s, y: cy + pr.y*s }; });
  const lines = [];
  const frontPath = 'M ' + front.map(p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' L ') + ' Z';
  lines.push(`<path d="${frontPath}" stroke="black" stroke-width="1.2"/>`);
  const backPath = 'M ' + back.map(p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' L ') + ' Z';
  lines.push(`<path d="${backPath}" stroke="black" stroke-width="1.0" opacity="0.7"/>`);
  for (let i=0; i<sect.length; i++) {
    lines.push(`<line x1="${front[i].x.toFixed(2)}" y1="${front[i].y.toFixed(2)}" x2="${back[i].x.toFixed(2)}" y2="${back[i].y.toFixed(2)}" stroke="black" stroke-width="1.0" opacity="0.85"/>`);
  }
  return svgWrap(lines.join(''));
}

// ── MAIN DISPATCHER ──
function tryParametricAxono(element, subtype, dim_l_cm, dim_w_cm, dim_h_cm) {
  // Returns { svg } if a parametric generator matches, null otherwise
  if (!subtype) return null;
  const s = subtype.replace(/\s+/g, '').toUpperCase();

  // IPE
  if (IPE[s]) {
    const lengthMm = dim_l_cm ? dim_l_cm * 10 : 2000;
    return { svg: genIBeamAxono(IPE[s], lengthMm), kind: 'IPE', subtype: s };
  }
  // HEA/HEB
  if (HEA[s]) {
    const lengthMm = dim_l_cm ? dim_l_cm * 10 : 2000;
    return { svg: genIBeamAxono(HEA[s], lengthMm), kind: 'HEA', subtype: s };
  }
  if (HEB[s]) {
    const lengthMm = dim_l_cm ? dim_l_cm * 10 : 2000;
    return { svg: genIBeamAxono(HEB[s], lengthMm), kind: 'HEB', subtype: s };
  }
  // UPN — pattern UPN<num>
  const upnMatch = s.match(/^UPN(\d+)$/);
  if (upnMatch) {
    const n = parseInt(upnMatch[1]);
    // Standard UPN dimensions interpolated by size
    const ratios = { 50:{b:38,tw:5,tf:7}, 80:{b:45,tw:6,tf:8}, 100:{b:50,tw:6,tf:8.5}, 120:{b:55,tw:7,tf:9}, 140:{b:60,tw:7,tf:10}, 160:{b:65,tw:7.5,tf:10.5}, 200:{b:75,tw:8.5,tf:11.5}, 250:{b:80,tw:9,tf:13}, 300:{b:100,tw:10,tf:16} };
    let best = ratios[200];
    let bestDist = 999;
    for (const k in ratios) { const d = Math.abs(parseInt(k) - n); if (d < bestDist) { bestDist = d; best = ratios[k]; } }
    const lengthMm = dim_l_cm ? dim_l_cm * 10 : 2000;
    return { svg: genUChannelAxono({h:n, ...best}, lengthMm), kind: 'UPN', subtype: s };
  }
  // L-cornière — pattern L<a>x<a>x<t>
  const angleMatch = subtype.match(/^L\s*(\d+)x\s*(\d+)x\s*(\d+)/i);
  if (angleMatch) {
    const lengthMm = dim_l_cm ? dim_l_cm * 10 : 2000;
    return { svg: genAngleAxono(lengthMm, parseInt(angleMatch[1]), parseInt(angleMatch[3])), kind: 'L', subtype: s };
  }

  // BRICK/BLOCK detection priority: if element name mentions brique/parpaing/bloc/moellon/pierre,
  // pattern "LxWxH" is interpreted as block dimensions.
  const isMasonryByName = /brique|parpaing|bloc|moellon|pierre|carreau|alveol|alvéol|dalle/i.test(element || '');
  if (isMasonryByName) {
    const blockMatch = subtype.match(/(\d+)\s*x\s*(\d+)\s*x\s*(\d+)/);
    if (blockMatch) {
      const L = parseInt(blockMatch[1]);
      const W = parseInt(blockMatch[2]);
      const H = parseInt(blockMatch[3]);
      const hollow = /creus|hollow|B\d+/i.test(element) || /creus|hollow/i.test(subtype);
      return { svg: genBrickAxono(L, W, H, hollow), kind: 'BRICK', subtype: s };
    }
    // Dalle alvéolée — "1200x265" (two-number, wide-aspect)
    const dalleMatch = subtype.match(/(\d+)\s*x\s*(\d+)/);
    if (dalleMatch && /alvéol|alveol|hollow.?core/i.test(element)) {
      const L = 3000;
      const W = parseInt(dalleMatch[1]);
      const H = parseInt(dalleMatch[2]);
      return { svg: genConcreteSlab(L, W, H, true), kind: 'DALLE', subtype: s };
    }
  }

  // Tube carré/rectangulaire — explicit "Tube" prefix required to avoid colliding with masonry
  const tubeRectMatch = subtype.match(/tube[\s_-]*(\d+)\s*x\s*(\d+)\s*x\s*(\d+)/i);
  if (tubeRectMatch) {
    const lengthMm = dim_l_cm ? dim_l_cm * 10 : 2000;
    return { svg: genTubeRectAxono(lengthMm, parseInt(tubeRectMatch[1]), parseInt(tubeRectMatch[2])), kind: 'TUBE', subtype: s };
  }
  // Tube rond — "Ø<d>" or "tube Ø<d>x<t>"
  const tubeRoundMatch = subtype.match(/[ØO\u00d8]\s*(\d+(?:\.\d+)?)/i);
  if (tubeRoundMatch) {
    const lengthMm = dim_l_cm ? dim_l_cm * 10 : 2000;
    return { svg: genTubeRoundAxono(lengthMm, parseFloat(tubeRoundMatch[1])), kind: 'TUBE_ROUND', subtype: s };
  }

  // Generic block fallback — "LxWxH" without masonry name
  const blockMatch2 = subtype.match(/^(\d+)\s*x\s*(\d+)\s*x\s*(\d+)$/);
  if (blockMatch2) {
    const L = parseInt(blockMatch2[1]);
    const W = parseInt(blockMatch2[2]);
    const H = parseInt(blockMatch2[3]);
    return { svg: genBrickAxono(L, W, H, false), kind: 'GENERIC_BLOCK', subtype: s };
  }

  return null;
}

module.exports = { tryParametricAxono };
