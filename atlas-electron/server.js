require('dotenv').config({ path: process.env.ATLAS_USER_DATA ? require('path').join(process.env.ATLAS_USER_DATA, '.env') : require('path').join(__dirname, '.env') });

const express = require('express');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const sharp   = require('sharp');

const PORT    = parseInt(process.env.PORT) || 3737;
const API_KEY = process.env.MAMMOUTH_API_KEY;

const USER_DATA = process.env.ATLAS_USER_DATA || __dirname;
const ASSETS    = process.env.ATLAS_ASSETS    || path.join(__dirname, 'public', 'assets');
const PROJECTS_DIR = path.join(USER_DATA, 'projects');

const MAMMOUTH_URL   = 'https://api.mammouth.ai/v1/chat/completions';
const MAMMOUTH_MODEL = 'gpt-4.1';
const ROBOFLOW_KEY   = process.env.ROBOFLOW_API_KEY || '';

const IMAGE_EXTS = new Set(['.jpg','.jpeg','.png','.webp','.tiff','.tif','.bmp']);
const RAW_EXTS   = new Set(['.nef','.cr2','.cr3','.arw','.dng','.raf','.rw2']);
const VIDEO_EXTS = new Set(['.mov','.mp4','.avi','.mkv']);

[PROJECTS_DIR, ASSETS].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ── Project helpers ───────────────────────────────────────────────────────────
function getProjectDir(projectId) {
  const dir = path.join(PROJECTS_DIR, projectId);
  const uploads  = path.join(dir, 'uploads');
  const thumbs   = path.join(dir, 'uploads', '_thumbs');
  const previews = path.join(dir, 'uploads', '_previews');
  [dir, uploads, thumbs, previews].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
  return { dir, uploads, thumbs, previews, dataFile: path.join(dir, 'atlas_data.json'), metaFile: path.join(dir, 'project.json') };
}

function listProjects() {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  return fs.readdirSync(PROJECTS_DIR).filter(f => {
    const meta = path.join(PROJECTS_DIR, f, 'project.json');
    return fs.existsSync(meta);
  }).map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, f, 'project.json'), 'utf-8')); }
    catch { return null; }
  }).filter(Boolean).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
}

function loadProject(projectId) {
  const { dataFile } = getProjectDir(projectId);
  if (!fs.existsSync(dataFile)) return { photos:[], taxonomy:DEFAULT_TAXONOMY, clusters:[], detections:[], classement_overrides:{}, geometrie_overrides:{}, element_properties:{}, vector_drawings:{} };
  try {
    const d = JSON.parse(fs.readFileSync(dataFile,'utf-8'));
    if (!d.taxonomy)            d.taxonomy = DEFAULT_TAXONOMY;
    if (!d.clusters)            d.clusters = [];
    if (!d.detections)          d.detections = [];
    if (!d.classement_overrides) d.classement_overrides = {};
    if (!d.geometrie_overrides) d.geometrie_overrides = {};
    if (!d.element_properties) d.element_properties = {};
    if (!d.vector_drawings) d.vector_drawings = {};
    if (!d.machine_spatial) d.machine_spatial = {};
    return d;
  } catch { return { photos:[], taxonomy:DEFAULT_TAXONOMY, clusters:[], detections:[], classement_overrides:{}, geometrie_overrides:{}, element_properties:{}, vector_drawings:{} }; }
}

function saveProject(projectId, data) {
  const { dataFile } = getProjectDir(projectId);
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

// ── Default taxonomy ──────────────────────────────────────────────────────────
const DEFAULT_TAXONOMY = [
  { id:'structural', label:'Structural Elements', subs:[
    { id:'masonry', label:'Masonry', elements:['Hollow concrete block','Solid brick','Rubble stone','Dressed stone','Concrete block wall','Brick wall','Stone wall','Concrete column','Concrete beam','Concrete slab','Concrete foundation'] },
    { id:'metal_frame', label:'Metal Frame', elements:['Steel beam','Steel column','Steel truss','Steel lattice girder','Steel purlin','Steel tie rod','Cast iron column','Metal deck','Corrugated metal sheet'] },
    { id:'floor_roof', label:'Floor & Roof', elements:['Concrete floor slab','Tile floor','Brick floor','Corrugated roof sheet','Flat concrete roof','Timber roof structure','Skylight frame','Gutter'] },
  ]},
  { id:'envelope', label:'Building Envelope', subs:[
    { id:'openings', label:'Openings', elements:['Steel window frame','Wooden window frame','Broken window glass','Door frame steel','Door frame wood','Rolling shutter','Loading bay door','Vent opening','Skylight','Glass block panel'] },
    { id:'cladding', label:'Cladding & Partition', elements:['Plaster wall','Painted concrete wall','Tiled wall','Brick partition','Corrugated cladding panel','Cement board panel'] },
  ]},
  { id:'industrial', label:'Industrial Machinery', subs:[
    { id:'production', label:'Production Equipment', elements:['Rotary kiln','Cement mill','Ball mill','Crusher','Hammer mill','Bucket elevator','Belt conveyor','Screw conveyor','Vibrating screen','Cyclone separator','Electrostatic precipitator','Preheater tower'] },
    { id:'storage', label:'Storage & Silos', elements:['Cement silo','Raw material silo','Clinker silo','Storage tank','Hopper','Bin','Bunker'] },
    { id:'utilities', label:'Utilities & Distribution', elements:['Large diameter pipe','Small diameter pipe','Duct','Cable tray','Electrical panel','Transformer','Pump','Compressor','Valve','Chimney stack'] },
    { id:'transport', label:'On-site Transport', elements:['Rail track','Rail car','Bridge crane beam','Crane runway beam','Overhead conveyor structure','Loading platform'] },
  ]},
  { id:'vegetation', label:'Vegetation & Regeneration', subs:[
    { id:'trees_shrubs', label:'Trees & Shrubs', elements:['Mature tree (trunk)','Young tree','Dense shrub','Climbing plant on wall','Ivy','Wild bramble','Elder bush'] },
    { id:'ground_cover', label:'Ground Cover', elements:['Moss','Lichen on concrete','Lichen on metal','Grass tuft','Fern','Wildflowers','Leaf litter accumulation'] },
    { id:'water', label:'Water & Humidity', elements:['Stagnant water pool','Water infiltration trace','Efflorescence','Calcite deposit','Rust stain','Algae growth'] },
  ]},
  { id:'degradation', label:'Degradation & Texture', subs:[
    { id:'concrete_deg', label:'Concrete Degradation', elements:['Surface crack','Structural crack','Spalling concrete','Exposed rebar','Carbonation','Delamination'] },
    { id:'metal_deg', label:'Metal Degradation', elements:['Surface rust','Deep corrosion','Perforated metal','Deformed metal','Paint peel on metal','Welded joint','Rivet'] },
    { id:'surface_texture', label:'Surface Texture', elements:['Raw concrete texture','Shuttering imprint','Aggregate exposed concrete','Painted surface','Graffiti tag','Graffiti mural','Soot deposit'] },
  ]},
  { id:'debris_waste', label:'Debris & Waste', subs:[
    { id:'construction_debris', label:'Construction Debris', elements:['Broken concrete fragment','Brick rubble','Metal scrap piece','Timber offcut','Glass shard','Roof tile fragment','Plaster chunk'] },
    { id:'industrial_waste', label:'Industrial Waste', elements:['Clinker residue','Cement dust deposit','Oil drum','Chemical drum','Abandoned vehicle part','Electrical cable scrap'] },
    { id:'general_waste', label:'General Waste', elements:['Plastic waste','Paper waste','Abandoned personal object','Abandoned furniture','Abandoned tool'] },
  ]},
  { id:'spatial', label:'Spatial Elements', subs:[
    { id:'circulation', label:'Circulation', elements:['Staircase concrete','Staircase metal','Ramp','Catwalk','Ladder','Corridor','Passage opening'] },
    { id:'light_atmosphere', label:'Light & Atmosphere', elements:['Zenithal light','Lateral light through opening','Shadow pattern','Dust in light','Dramatic contrast'] },
    { id:'void_space', label:'Void & Space', elements:['Large interior volume','Mezzanine level','Pit','Shaft','Trench','Collapsed zone','Partially open roof'] },
  ]},
];

const STD_CATS = new Set(['escaliers','portes','debris','graffitis','metal','machines','rouille','fenetres','beton','vegetation','sol','lumiere','plafond','tubes','autre']);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Image processing ──────────────────────────────────────────────────────────
async function toJpeg(filePath, ext) {
  if (VIDEO_EXTS.has(ext)) return null;
  try {
    // Force maximum input pixels and use withMetadata for better RAW handling
    return await sharp(filePath, { limitInputPixels: false })
      .rotate() // auto-rotate based on EXIF
      .resize(1568, 1568, { fit:'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch { return null; }
}

async function makeThumb(buf, dest) {
  try { await sharp(buf).resize(400,400,{fit:'cover'}).jpeg({quality:80}).toFile(dest); } catch {}
}

async function makePreview(buf, dest) {
  try {
    // High quality preview — 2400px for NEF/RAW which can be 24MP+
    await sharp(buf, { limitInputPixels: false })
      .resize(2400, 2400, { fit:'inside', withoutEnlargement: true })
      .jpeg({ quality: 94 })
      .toFile(dest);
  } catch {}
}

// ── AI Classification ─────────────────────────────────────────────────────────
function buildPrompt(taxonomy, correction = '') {
  const list = taxonomy.map(f =>
    `  ${f.id} (${f.label}):\n` + f.subs.map(s => `    ${s.id} (${s.label}): ${s.elements.slice(0,5).join(', ')}...`).join('\n')
  ).join('\n');
  const correctionBlock = correction ? `

⚠️ USER CORRECTION FOR THIS REANALYSIS — apply this guidance carefully and use it to fix previous mistakes:
"${correction.replace(/"/g,"'")}"

The user has flagged specific issues with the previous analysis. Pay particular attention to their correction and adjust your inventory accordingly. Take it as authoritative ground-truth knowledge of the scene.

` : '';
  return correctionBlock + `You are an expert architectural surveyor for abandoned industrial sites.
Analyze this photograph of an abandoned cement factory.

INVENTORY TAXONOMY:
${list}

RULES:
- Be exhaustive: 5-15 inventory entries per photo.
- condition: "intact" | "reusable" | "degraded" | "non-reusable"
- confidence: 0.0-1.0
- NEVER use "autre" unless completely off-topic
- BE PRECISE in element naming: identify the exact subtype when visible, not generic terms.

ELEMENT NAMING — be as SPECIFIC as visual evidence allows, using EUROPEAN STANDARD references.

For every element, when visual evidence allows, choose the EXACT standard size from the catalogues below.
If the size cannot be determined precisely, give the closest plausible standard with note "estimation".
NEVER invent non-standard dimensions when a standard catalogue exists.

═══ METAL PROFILES — identify shape + standard size ═══
  IPE (I-section, narrow parallel flanges, structural beams) standard sizes:
    IPE80, IPE100, IPE120, IPE140, IPE160, IPE180, IPE200, IPE220, IPE240, IPE270, IPE300, IPE330, IPE360, IPE400, IPE450, IPE500, IPE550, IPE600
    → estimate from cross-section height in cm (IPE200 = 20cm tall, IPE400 = 40cm tall)
  HEA / HEB / HEM (wide-flange I, columns, height ≈ width):
    HEA100, HEA120, HEA140, HEA160, HEA180, HEA200, HEA220, HEA240, HEA260, HEA280, HEA300, HEA320, HEA340, HEA360, HEA400, HEA450, HEA500, HEA600
    HEB100, HEB120, HEB140, HEB160, HEB180, HEB200, HEB220, HEB240, HEB260, HEB280, HEB300, HEB320, HEB340, HEB360, HEB400, HEB450, HEB500, HEB600
    HEM100, HEM200, HEM300, HEM400, HEM500, HEM600
  UPN / UAP (U-channel):
    UPN50, UPN65, UPN80, UPN100, UPN120, UPN140, UPN160, UPN180, UPN200, UPN220, UPN240, UPN260, UPN280, UPN300, UPN320, UPN350, UPN380, UPN400
  L-cornières (equal-leg angle): L20x20x3, L25x25x3, L30x30x3, L40x40x4, L50x50x5, L60x60x6, L70x70x7, L80x80x8, L100x100x10, L120x120x12, L150x150x15, L200x200x20
  T-sections: T30x30x4, T40x40x5, T50x50x6, T60x60x7, T80x80x9, T100x100x11
  Tubes rectangulaires (RHS): "Tube 40x20x2", "Tube 50x30x3", "Tube 60x40x3", "Tube 80x40x4", "Tube 100x50x4", "Tube 120x60x5", "Tube 150x100x5", "Tube 200x100x6", "Tube 250x150x8", "Tube 300x200x10"
  Tubes carrés (SHS): "Tube 20x20x2", "Tube 30x30x2", "Tube 40x40x3", "Tube 50x50x3", "Tube 60x60x4", "Tube 80x80x4", "Tube 100x100x5", "Tube 120x120x6", "Tube 150x150x6", "Tube 200x200x8"
  Tubes ronds (CHS): "Tube Ø33.7x2.6", "Tube Ø48.3x3.2", "Tube Ø60.3x3.6", "Tube Ø88.9x4", "Tube Ø114.3x5", "Tube Ø168.3x6.3", "Tube Ø219.1x8", "Tube Ø273x10", "Tube Ø323.9x10"
  Fer plat (flat bar): "Fer plat 20x4", "Fer plat 30x5", "Fer plat 40x5", "Fer plat 50x6", "Fer plat 60x8", "Fer plat 80x10", "Fer plat 100x10", "Fer plat 120x12"
  Fer rond (round bar): "Fer rond Ø8", "Fer rond Ø10", "Fer rond Ø12", "Fer rond Ø16", "Fer rond Ø20", "Fer rond Ø25", "Fer rond Ø32"
  Steel grade if visible (rust patina, marking): S235 (mild steel), S275, S355 (high strength)

═══ MASONRY — bricks and blocks (identify exact format) ═══
  Brique pleine terre cuite (solid clay brick) standard formats (L×l×H mm):
    "Brique pleine 220x105x65" (most common, single brick), "Brique pleine 240x115x71", "Brique pleine 290x140x90"
  Brique creuse (hollow clay brick, look for holes on face):
    "Brique creuse 220x105x50", "Brique creuse 500x200x200", "Brique creuse Monomur 300x200x300", "Brique creuse Monomur 375x200x300", "Brique creuse Monomur 500x200x300"
    "Brique creuse 6 trous 200x100x50", "Brique creuse 8 trous 250x140x100", "Brique creuse 12 trous 300x200x100"
  Parpaing creux béton (hollow concrete block):
    "Parpaing creux B40 500x200x100" (10cm thick wall), "Parpaing creux B50 500x200x150", "Parpaing creux B60 500x200x200" (most common 20cm), "Parpaing creux B80 500x200x250"
  Parpaing plein béton: "Parpaing plein 500x200x100", "Parpaing plein 500x200x150", "Parpaing plein 500x200x200"
  Bloc béton cellulaire (autoclaved aerated, light grey, porous):
    "Bloc cellulaire 600x250x100", "Bloc cellulaire 600x250x150", "Bloc cellulaire 600x250x200", "Bloc cellulaire 600x250x250", "Bloc cellulaire 600x250x300"
  Carreau de plâtre: "Carreau plâtre 666x500x50", "Carreau plâtre 666x500x70", "Carreau plâtre 666x500x100"
  Moellon (rough cut stone): "Moellon calcaire ≈250x150x150", "Moellon granit ≈300x200x200" (irregular, give approximate)
  Pierre de taille (dressed stone): give visible face dimensions, "Pierre de taille calcaire 600x300x200" etc.

═══ CONCRETE STRUCTURAL ═══
  Distinguish form: "Béton coulé en place" (formwork marks visible), "Béton préfabriqué" (clean edges, possibly lifting hooks)
  Concrete grade if visible from age/quality: C20/25 (older), C25/30 (standard), C30/37, C35/45 (industrial)
  Dalle alvéolée précontrainte: "Dalle alvéolée 1200x200" (12cm wide hollow-core, 20cm thick), "Dalle alvéolée 1200x265", "Dalle alvéolée 1200x320", "Dalle alvéolée 1200x400"
  Poutre BA (reinforced concrete beam): give cross-section "Poutre BA 200x400" (20cm wide × 40cm tall) — common: 200x300, 200x400, 250x500, 300x600, 400x800
  Voile béton (concrete wall): "Voile béton 16cm", "Voile béton 18cm", "Voile béton 20cm", "Voile béton 25cm"
  Linteau préfabriqué: "Linteau 100x200" up to "Linteau 200x500"

═══ WOOD STRUCTURAL ═══
  Standard timber section sizes (L×H mm cross-section):
    Solives/joists: 60x180, 75x200, 75x225, 100x200, 100x225, 100x250, 100x300
    Chevrons: 50x75, 63x75, 75x100, 80x100
    Pannes: 75x180, 100x200, 100x225, 150x200, 200x250
    Poteaux carrés: 100x100, 120x120, 150x150, 200x200, 250x250
  Bois massif vs lamellé-collé (visible glue lines = GL): GL24h, GL28h
  Species if identifiable: épicéa/sapin (light pale, knots), chêne (dense, dark grain), douglas (red-orange tint)
  Wood grade: C18, C24, C30 (visual proxy: more knots = lower grade)

═══ DOORS ═══
  Standard door leaf dimensions (L×H mm): "Porte 730x2040", "Porte 830x2040" (standard interior), "Porte 930x2040" (PMR access), "Porte double 1600x2040", "Porte industrielle 2500x3000", "Porte de quai sectionnelle 3000x3000"
  Specify: "porte battante", "porte coulissante", "porte sectionnelle", "porte basculante", "porte vitrée", "porte métallique pleine", "porte coupe-feu EI30", "porte coupe-feu EI60"

═══ WINDOWS ═══
  Standard window opening dimensions (L×H cm): "Fenêtre 60x60", "Fenêtre 100x100", "Fenêtre 100x125", "Fenêtre 120x100", "Fenêtre 120x125", "Fenêtre 140x125", "Fenêtre châssis fixe 200x250", "Pavé de verre 19x19x8" (glass block)
  Frame: "châssis acier" (typical industrial), "châssis aluminium", "châssis bois", "châssis PVC"
  Glazing: "simple vitrage", "double vitrage", "verre armé", "polycarbonate"

═══ ROOFING ═══
  Tôle ondulée acier: "Tôle ondulée 18/76" (18mm wave height, 76mm wave pitch), "Tôle ondulée 35/177"
  Bac acier: "Bac acier 39/333" (typical), "Bac acier 45/150", "Bac acier 75/200" (deep section)
  Tuile mécanique: "Tuile mécanique 22 au m²" (large), "Tuile mécanique 16 au m²" (medium), "Tuile romane", "Tuile canal"
  Fibrociment: "Plaque fibrociment 1830x920" (standard), often asbestos-containing if pre-1997 — ADD WARNING in notes
  Polycarbonate: "Polycarbonate alvéolaire 16mm", "Polycarbonate alvéolaire 25mm", "Polycarbonate compact 6mm"

═══ MACHINES / INDUSTRIAL EQUIPMENT (cement factory specific) ═══
  Name function precisely:
    "Broyeur à boulets" (ball mill — large cylinder rotating), "Concasseur à mâchoires" (jaw crusher), "Concasseur giratoire" (gyratory)
    "Silo cylindrique" + diameter ("Silo cylindrique Ø6m × H15m")
    "Trémie pyramidale" (hopper), "Vis sans fin" (screw conveyor)
    "Convoyeur à bande" + visible width, "Élévateur à godets" (bucket elevator)
    "Four rotatif" (rotary kiln — long inclined cylinder), "Refroidisseur à grille" (grate cooler)
    "Cheminée acier" + visible height, "Filtre à manches" (baghouse), "Électrofiltre"
    "Cyclone séparateur", "Préchauffeur multi-étages"
  If function unclear: "Équipement industriel non identifié — cylindrique/rectangulaire/etc."

═══ IDENTIFICATION CONFIDENCE ═══
- If you can identify the exact standard (e.g. "the I-shape and the 20cm height clearly indicate IPE200"), set confidence 0.7-0.95
- If the type is clear but size estimated (e.g. "IPE shape visible, height ≈ 25-30cm so probably IPE270 or IPE300"), use the most likely value + confidence 0.5-0.7 + notes "size estimated"
- If only the family is identifiable (e.g. "metal I-beam, size indeterminate"), set element="Poutre IPE", element_subtype=null, confidence 0.3-0.5

For EACH inventory entry provide:
- "element": precise FAMILY name (e.g. "Poutre IPE", "Brique creuse terre cuite", "Parpaing creux béton", "Dalle alvéolée précontrainte")
- "element_subtype": the EXACT standard reference (e.g. "IPE200", "HEA160", "500x200x200", "C25/30 — 1200x265"), null if undeterminable
- "mode": "discrete" for countable individual objects OR "continuous" for material in place
- "quantity_visible": units actually visible (for "discrete"); for "continuous" estimate equivalent units in the visible surface
- "dim_l_cm","dim_w_cm","dim_h_cm": dimensions in cm of ONE UNIT — use STANDARD dimensions from catalogues above (do not invent — match the closest standard)
- "surface_m2" (only "continuous"): total surface in m² of the wall/slab visible
- Use scale references (human ~1.7m, door ~2.1m, brick=22cm) to estimate

RESPOND ONLY WITH VALID JSON:
{
  "categories": ["cat1","cat2"],
  "primary": "cat_dominant",
  "description": "2-3 precise documentary sentences describing exactly what is visible.",
  "tags": ["tag1","tag2","tag3","tag4"],
  "materiaux": ["m1","m2"],
  "etat": "intact|degraded|heavily degraded|ruined",
  "interest": 3,
  "inventory": [
    { "family_id":"structural","subfamily_id":"metal","element":"Poutre IPE","element_subtype":"IPE200","mode":"discrete","quantity_visible":3,"unit":"units","dim_l_cm":400,"dim_w_cm":10,"dim_h_cm":20,"condition":"reusable","notes":"profile shape clearly visible at beam end, height ≈ 20cm","confidence":0.8 },
    { "family_id":"structural","subfamily_id":"masonry","element":"Parpaing creux béton","element_subtype":"500x200x200 (B60)","mode":"continuous","quantity_visible":120,"unit":"units","dim_l_cm":50,"dim_w_cm":20,"dim_h_cm":20,"surface_m2":12,"condition":"reusable","notes":"standard B60 hollow concrete block, joint mortar visible","confidence":0.85 }
  ]
}
Standard categories: escaliers,portes,debris,graffitis,metal,machines,rouille,fenetres,beton,vegetation,sol,lumiere,plafond,tubes,autre`;
}

async function classify(buf, taxonomy, attempt=1, correction='') {
  const currentKey = process.env.MAMMOUTH_API_KEY;
  if (!currentKey || currentKey==='COLLE-TA-CLE-ICI') throw new Error('API key not set');
  const res = await fetch(MAMMOUTH_URL, {
    method:'POST',
    headers:{'Authorization':`Bearer ${currentKey}`,'Content-Type':'application/json'},
    body: JSON.stringify({ model:MAMMOUTH_MODEL, max_tokens:2048,
      messages:[{role:'user',content:[
        {type:'image_url',image_url:{url:`data:image/jpeg;base64,${buf.toString('base64')}`}},
        {type:'text',text:buildPrompt(taxonomy, correction)},
      ]}]
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    if (res.status===429 && attempt<=4) { await sleep(attempt*15000); return classify(buf,taxonomy,attempt+1); }
    throw new Error(`HTTP ${res.status}: ${t.slice(0,200)}`);
  }
  const data  = await res.json();
  const text  = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Empty response');
  const match = text.replace(/```json|```/gm,'').match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Non-JSON');
  const p = JSON.parse(match[0]);
  p.categories = (p.categories||[]).filter(c => STD_CATS.has(c));
  if (!p.categories.length) p.categories=['autre'];
  if (!STD_CATS.has(p.primary)) p.primary=p.categories[0];
  p.interest = Math.min(5,Math.max(1,parseInt(p.interest)||3));
  p.inventory = (p.inventory||[]).map(item=>{
    const qty = parseInt(item.quantity_visible ?? item.quantity) || 1;
    const surf = parseFloat(item.surface_m2);
    return {
      family_id: item.family_id||'autre', subfamily_id: item.subfamily_id||'',
      element: item.element||'Unknown',
      element_subtype: item.element_subtype || null,
      mode: item.mode === 'continuous' ? 'continuous' : 'discrete',
      quantity: qty,
      quantity_visible: qty,
      unit: item.unit||'units',
      dim_l_cm: parseFloat(item.dim_l_cm) || null,
      dim_w_cm: parseFloat(item.dim_w_cm) || null,
      dim_h_cm: parseFloat(item.dim_h_cm) || null,
      surface_m2: !isNaN(surf) ? surf : null,
      condition: item.condition||'degraded',
      notes: item.notes||'',
      confidence: parseFloat(item.confidence)||0.5,
    };
  });
  return p;
}

// ── Roboflow Detection ────────────────────────────────────────────────────────
// SAM3 — Roboflow universal segmentation, no model needed, text prompts only
async function runRoboflowDetection(imageBase64, modelId, keywords) {
  const key = process.env.ROBOFLOW_API_KEY;
  if (!key) throw new Error('ROBOFLOW_API_KEY not set');
  if (!keywords || keywords.length === 0) throw new Error('Entrer au moins un mot-clé à détecter');

  // Use SAM3 serverless endpoint — universal, no model ID needed
  const res = await fetch(`https://serverless.roboflow.com/sam3/concept_segment?api_key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      format: 'polygon',
      image: { type: 'base64', value: imageBase64 },
      prompts: keywords.map(t => ({ type: 'text', text: t })),
      output_prob_thresh: 0.35,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Roboflow SAM3 HTTP ${res.status}: ${t.slice(0,300)}`);
  }

  const raw = await res.json();
  const COLORS = ['#FF6384','#36A2EB','#FFCE56','#4BC0C0','#9966FF','#FF9F40','#00CED1','#9370DB','#6fbf6f','#FF6B6B','#E8A838','#45B7D1','#DDA0DD','#98D8C8','#FFA07A'];

  // Parse SAM3 response — same logic as Parisa project
  const segs = [];
  for (let pi = 0; pi < (raw.prompt_results || []).length; pi++) {
    const pr = raw.prompt_results[pi];
    const label = pr.echo?.text || keywords[pi] || `obj${pi+1}`;
    for (const pred of (pr.predictions || [])) {
      for (const mask of (pred.masks || [])) {
        let poly = null;
        if (Array.isArray(mask) && mask.length > 2) {
          if (Array.isArray(mask[0])) poly = mask.map(p => ({ x: p[0], y: p[1] }));
          else if (mask[0]?.x !== undefined) poly = mask;
        }
        segs.push({
          label,
          instance: `${label} ${segs.length + 1}`,
          confidence: Math.round((pred.confidence || 1.0) * 100),
          polygon: poly,
          bbox: null,
          color: COLORS[segs.length % COLORS.length],
        });
      }
      // Fallback to bbox if no masks
      if (!pred.masks?.length && pred.x !== undefined) {
        segs.push({
          label,
          instance: label,
          confidence: Math.round((pred.confidence || 1.0) * 100),
          polygon: null,
          bbox: { x: pred.x - pred.width/2, y: pred.y - pred.height/2, w: pred.width, h: pred.height },
          color: COLORS[segs.length % COLORS.length],
        });
      }
    }
  }

  // Aggregate by label for the table
  const aggregated = {};
  segs.forEach(seg => {
    if (!aggregated[seg.label]) aggregated[seg.label] = { label: seg.label, count: 0, confidence_sum: 0, segments: [] };
    aggregated[seg.label].count++;
    aggregated[seg.label].confidence_sum += seg.confidence;
    if (seg.polygon) aggregated[seg.label].segments.push({ type: 'polygon', points: seg.polygon, conf: seg.confidence, color: seg.color });
    else if (seg.bbox) aggregated[seg.label].segments.push({ type: 'box', ...seg.bbox, conf: seg.confidence, color: seg.color });
  });

  return Object.values(aggregated).map(a => ({
    label: a.label,
    count: a.count,
    confidence: Math.round(a.confidence_sum / a.count),
    segments: a.segments,
  }));
}

// Draw segmentation masks on image using Canvas (server-side via sharp + SVG overlay)
async function drawSegmentationOverlay(imageBuffer, detections, imgWidth, imgHeight) {
  const COLORS = ['#FF6B6B','#4ECDC4','#45B7D1','#96CEB4','#FFEAA7','#DDA0DD','#98D8C8','#F7DC6F','#BB8FCE','#85C1E9'];
  
  // Build SVG overlay with polygons/boxes
  let svgShapes = '';
  detections.forEach((det, di) => {
    const color = COLORS[di % COLORS.length];
    (det.segments || []).forEach(seg => {
      if (seg.type === 'polygon' && seg.points?.length > 2) {
        const pts = seg.points.map(p => `${p.x},${p.y}`).join(' ');
        svgShapes += `<polygon points="${pts}" fill="${color}" fill-opacity="0.35" stroke="${color}" stroke-width="2"/>`;
        // Label near first point
        const lx = seg.points[0].x + 4, ly = seg.points[0].y - 6;
        svgShapes += `<rect x="${lx-2}" y="${ly-12}" width="${det.label.length*7+8}" height="16" fill="${color}" rx="2"/>`;
        svgShapes += `<text x="${lx}" y="${ly}" font-family="Helvetica" font-size="11" font-weight="bold" fill="white">${det.label}</text>`;
      } else if (seg.type === 'box') {
        const x = seg.x - seg.w/2, y = seg.y - seg.h/2;
        svgShapes += `<rect x="${x}" y="${y}" width="${seg.w}" height="${seg.h}" fill="${color}" fill-opacity="0.25" stroke="${color}" stroke-width="2"/>`;
        svgShapes += `<rect x="${x}" y="${y-18}" width="${det.label.length*7+8}" height="18" fill="${color}" rx="2"/>`;
        svgShapes += `<text x="${x+4}" y="${y-4}" font-family="Helvetica" font-size="11" font-weight="bold" fill="white">${det.label}</text>`;
      }
    });
  });

  const svgOverlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${imgWidth}" height="${imgHeight}">${svgShapes}</svg>`);
  
  try {
    const annotated = await sharp(imageBuffer)
      .resize(imgWidth, imgHeight, { fit: 'fill' })
      .composite([{ input: svgOverlay, top: 0, left: 0 }])
      .jpeg({ quality: 92 })
      .toBuffer();
    return annotated.toString('base64');
  } catch(e) {
    console.error('Overlay error:', e.message);
    return imageBuffer.toString('base64');
  }
}

// ── Cluster helper ────────────────────────────────────────────────────────────
function findOrCreateCluster(data, x, y) {
  const RADIUS = 0.08;
  const nearby = data.photos.filter(p => p.location && Math.hypot(p.location.x-x,p.location.y-y)<RADIUS && p.cluster_id);
  if (nearby.length>0) {
    const counts={};
    nearby.forEach(p=>{counts[p.cluster_id]=(counts[p.cluster_id]||0)+1;});
    return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
  }
  const newId=`cluster_${Date.now()}`;
  data.clusters.push({id:newId,label:`Zone ${data.clusters.length+1}`,x,y});
  return newId;
}

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname,'public')));
app.use('/assets', express.static(ASSETS));

// Dynamic project file serving
app.use('/project-files/:projectId', (req, res, next) => {
  const { uploads } = getProjectDir(req.params.projectId);
  express.static(uploads)(req, res, next);
});

// ── Project APIs ──────────────────────────────────────────────────────────────
app.get('/api/projects', (_q, res) => res.json(listProjects()));

app.post('/api/projects', (req, res) => {
  const { name, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
  const { metaFile } = getProjectDir(id);
  const meta = { id, name: name.trim(), description: description||'', created_at: new Date().toISOString() };
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  res.json(meta);
});

app.put('/api/projects/:id', (req, res) => {
  const { metaFile } = getProjectDir(req.params.id);
  if (!fs.existsSync(metaFile)) return res.status(404).json({ error: 'Not found' });
  const meta = JSON.parse(fs.readFileSync(metaFile,'utf-8'));
  if (req.body.name) meta.name = req.body.name;
  if (req.body.description !== undefined) meta.description = req.body.description;
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  res.json(meta);
});

app.delete('/api/projects/:id', (req, res) => {
  const { dir } = getProjectDir(req.params.id);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Not found' });
  fs.rmSync(dir, { recursive: true, force: true });
  res.json({ ok: true });
});

// ── Categories ────────────────────────────────────────────────────────────────
app.get('/api/categories', (_q,res) => res.json([
  {id:'escaliers',label:'Escaliers'},{id:'portes',label:'Portes & Accès'},
  {id:'debris',label:'Débris & Déchets'},{id:'graffitis',label:'Graffitis & Tags'},
  {id:'metal',label:'Structure Métallique'},{id:'machines',label:'Machines & Équipements'},
  {id:'rouille',label:'Rouille & Corrosion'},{id:'fenetres',label:'Fenêtres & Ouvertures'},
  {id:'beton',label:'Béton Fissuré'},{id:'vegetation',label:'Végétation Envahissante'},
  {id:'sol',label:'Sols & Revêtements'},{id:'lumiere',label:'Lumière & Ombres'},
  {id:'plafond',label:'Plafonds & Voûtes'},{id:'tubes',label:'Tuyaux & Câblages'},
  {id:'autre',label:'Autre'},
]));

// ── Photos ────────────────────────────────────────────────────────────────────
app.get('/api/:pid/photos', (req,res) => {
  const {category,search,sort}=req.query;
  let {photos}=loadProject(req.params.pid);
  if (category&&category!=='all') photos=photos.filter(p=>p.categories?.includes(category));
  if (search) {
    const q=search.toLowerCase();
    photos=photos.filter(p=>p.description?.toLowerCase().includes(q)||p.tags?.some(t=>t.toLowerCase().includes(q))||p.manual_tags?.some(t=>t.toLowerCase().includes(q))||p.notes?.toLowerCase().includes(q)||p.original_name?.toLowerCase().includes(q));
  }
  if (sort==='interest') photos.sort((a,b)=>(b.interest||0)-(a.interest||0));
  else if (sort==='date') photos.sort((a,b)=>new Date(b.uploaded_at)-new Date(a.uploaded_at));
  else if (sort==='category') photos.sort((a,b)=>(a.primary||'').localeCompare(b.primary||''));
  res.json(photos);
});

app.get('/api/:pid/stats', (req,res) => {
  const {photos}=loadProject(req.params.pid);
  const cats=['escaliers','portes','debris','graffitis','metal','machines','rouille','fenetres','beton','vegetation','sol','lumiere','plafond','tubes','autre'];
  const stats=Object.fromEntries(cats.map(c=>[c,0]));
  photos.forEach(p=>(p.categories||[]).forEach(c=>{if(c in stats)stats[c]++;}));
  res.json({total:photos.length,byCategory:stats});
});

// Upload
const getUploadMiddleware = (projectId) => {
  const { uploads } = getProjectDir(projectId);
  return multer({
    storage: multer.diskStorage({
      destination: (_q,_f,cb) => cb(null, uploads),
      filename: (_q,f,cb) => cb(null,`${Date.now()}-${Math.random().toString(36).slice(2,8)}${path.extname(f.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: 200*1024*1024 },
    fileFilter: (_q,file,cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      (IMAGE_EXTS.has(ext)||RAW_EXTS.has(ext)||VIDEO_EXTS.has(ext)) ? cb(null,true) : cb(new Error(`Unsupported: ${ext}`));
    }
  });
};

app.post('/api/:pid/upload', async (req,res) => {
  const pid = req.params.pid;
  const uploader = getUploadMiddleware(pid);
  uploader.array('photos',200)(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const files = req.files;
    if (!files?.length) return res.status(400).json({ error: 'No files' });
    const data = loadProject(pid);
    const { thumbs, previews } = getProjectDir(pid);
    const results = [];
    for (let i=0;i<files.length;i++) {
      const file=files[i];
      const ext=path.extname(file.originalname).toLowerCase();
      const thumbName=`thumb_${file.filename}.jpg`;
      const previewName=`preview_${file.filename}.jpg`;
      console.log(`  [${i+1}/${files.length}] ${file.originalname}`);
      let jpegBuf=null, cls=null;
      try {
        jpegBuf=await toJpeg(file.path,ext);
        if(jpegBuf){
          await makeThumb(jpegBuf,path.join(thumbs,thumbName));
          await makePreview(jpegBuf,path.join(previews,previewName));
          cls=await classify(jpegBuf,data.taxonomy);
        }
      } catch(e){console.error('    ✗',e.message);}
      const photo={
        id:`p_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
        filename:file.filename, original_name:file.originalname,
        path:`/project-files/${pid}/${file.filename}`,
        thumb:jpegBuf?`/project-files/${pid}/_thumbs/${thumbName}`:null,
        preview:jpegBuf?`/project-files/${pid}/_previews/${previewName}`:null,
        file_type:VIDEO_EXTS.has(ext)?'video':RAW_EXTS.has(ext)?'raw':'image',
        ext, uploaded_at:new Date().toISOString(), size:file.size,
        categories:cls?.categories||['autre'], primary:cls?.primary||'autre',
        description:cls?.description||'', tags:cls?.tags||[], materiaux:cls?.materiaux||[],
        etat:cls?.etat||'', interest:cls?.interest||1, inventory:cls?.inventory||[],
        manual_tags:[], notes:'', location:null, cluster_id:null, ai_classified:!!cls,
        detections:[], detection_model:'', detection_keywords:[],
      };
      data.photos.push(photo); saveProject(pid,data);
      results.push({success:true,name:file.originalname});
      if (i<files.length-1) await sleep(300);
    }
    res.json({processed:results.length,results});
  });
});

app.put('/api/:pid/photos/:id', (req,res) => {
  const data=loadProject(req.params.pid), idx=data.photos.findIndex(p=>p.id===req.params.id);
  if (idx===-1) return res.status(404).json({error:'Not found'});
  ['interest','manual_tags','notes','categories','primary','description','tags','etat','materiaux','inventory','location','cluster_id','detections','detection_model','detection_keywords','detection_entries','detection_annotated_b64'].forEach(k=>{if(req.body[k]!==undefined)data.photos[idx][k]=req.body[k];});
  saveProject(req.params.pid,data); res.json(data.photos[idx]);
});

app.post('/api/:pid/photos/:id/tags', (req,res) => {
  const {tag}=req.body; if(!tag?.trim()) return res.status(400).json({error:'Empty'});
  const data=loadProject(req.params.pid), idx=data.photos.findIndex(p=>p.id===req.params.id);
  if (idx===-1) return res.status(404).json({error:'Not found'});
  if (!data.photos[idx].manual_tags) data.photos[idx].manual_tags=[];
  const t=tag.trim().toLowerCase();
  if (!data.photos[idx].manual_tags.includes(t)) data.photos[idx].manual_tags.push(t);
  saveProject(req.params.pid,data); res.json(data.photos[idx]);
});

app.delete('/api/:pid/photos/:id/tags/:tag', (req,res) => {
  const data=loadProject(req.params.pid), idx=data.photos.findIndex(p=>p.id===req.params.id);
  if (idx===-1) return res.status(404).json({error:'Not found'});
  data.photos[idx].manual_tags=(data.photos[idx].manual_tags||[]).filter(t=>t!==decodeURIComponent(req.params.tag));
  saveProject(req.params.pid,data); res.json(data.photos[idx]);
});

app.delete('/api/:pid/photos/:id', (req,res) => {
  const data=loadProject(req.params.pid), photo=data.photos.find(p=>p.id===req.params.id);
  if (!photo) return res.status(404).json({error:'Not found'});
  const {uploads,thumbs,previews}=getProjectDir(req.params.pid);
  [path.join(uploads,photo.filename),path.join(thumbs,`thumb_${photo.filename}.jpg`),path.join(previews,`preview_${photo.filename}.jpg`)].forEach(fp=>{try{if(fs.existsSync(fp))fs.unlinkSync(fp);}catch{}});
  data.photos=data.photos.filter(p=>p.id!==photo.id); saveProject(req.params.pid,data); res.json({ok:true});
});

app.post('/api/:pid/photos/:id/reclassify', express.json(), async (req,res) => {
  const data=loadProject(req.params.pid), idx=data.photos.findIndex(p=>p.id===req.params.id);
  if (idx===-1) return res.status(404).json({error:'Not found'});
  const {uploads,previews}=getProjectDir(req.params.pid);
  const correction = (req.body && typeof req.body.correction === 'string') ? req.body.correction.trim() : '';
  try {
    const buf=await toJpeg(path.join(uploads,data.photos[idx].filename),data.photos[idx].ext);
    if (!buf) return res.status(400).json({error:'Cannot process'});
    const cls=await classify(buf,data.taxonomy, 1, correction);
    const prevName=`preview_${data.photos[idx].filename}.jpg`;
    const prevPath=path.join(previews,prevName);
    if(!fs.existsSync(prevPath)) await makePreview(buf,prevPath);
    if(!data.photos[idx].preview) data.photos[idx].preview=`/project-files/${req.params.pid}/_previews/${prevName}`;
    Object.assign(data.photos[idx],cls,{ai_classified:true});
    if(correction){
      if(!data.photos[idx].correction_history) data.photos[idx].correction_history = [];
      data.photos[idx].correction_history.push({ at: new Date().toISOString(), correction });
    }
    saveProject(req.params.pid,data); res.json(data.photos[idx]);
  } catch(e){res.status(500).json({error:e.message});}
});

// ── Roboflow Detection ────────────────────────────────────────────────────────
app.post('/api/:pid/photos/:id/detect', async (req, res) => {
  const { model_id, keywords } = req.body;
  // model_id not required for SAM3
  const data=loadProject(req.params.pid), idx=data.photos.findIndex(p=>p.id===req.params.id);
  if (idx===-1) return res.status(404).json({error:'Not found'});
  const {uploads}=getProjectDir(req.params.pid);
  try {
    const buf=await toJpeg(path.join(uploads,data.photos[idx].filename),data.photos[idx].ext);
    if (!buf) return res.status(400).json({error:'Cannot process file'});
    const b64=buf.toString('base64');
    const detections=await runRoboflowDetection(b64, '', keywords||[]);
    // Get image dimensions for SVG overlay
    const meta = await sharp(buf).metadata();
    const annotatedB64 = await drawSegmentationOverlay(buf, detections, meta.width, meta.height);
    data.photos[idx].detections=detections;
    data.photos[idx].detection_model=model_id;
    data.photos[idx].detection_keywords=keywords||[];
    data.photos[idx].detection_annotated_b64=annotatedB64; // latest segmentation overlay
    // Store per-keyword detection entry so history is preserved
    if(!data.photos[idx].detection_entries) data.photos[idx].detection_entries=[];
    const entry={
      keywords: keywords||[],
      annotated_b64: annotatedB64,
      detections: detections,
      date: new Date().toISOString(),
    };
    // Replace existing entry for same keywords, or add new
    const existingIdx = data.photos[idx].detection_entries.findIndex(e=>JSON.stringify(e.keywords)===JSON.stringify(keywords||[]));
    if(existingIdx>=0) data.photos[idx].detection_entries[existingIdx]=entry;
    else data.photos[idx].detection_entries.push(entry);
    saveProject(req.params.pid,data); res.json(data.photos[idx]);
  } catch(e){res.status(500).json({error:e.message});}
});

// ── Mask isolation — returns PNG with transparent background ──
app.post('/api/:pid/photos/:id/mask-export', async (req, res) => {
  const { keyword } = req.body || {};
  const data = loadProject(req.params.pid);
  const idx = data.photos.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const photo = data.photos[idx];

  let polygons = [];
  const entries = photo.detection_entries || [];
  if (keyword && keyword.length) {
    const match = entries.find(e => (e.keywords || []).join(', ') === keyword);
    if (match) {
      (match.detections || []).forEach(det => {
        (det.segments || []).forEach(seg => {
          if (seg.type === 'polygon' && seg.points?.length > 2) polygons.push({label: det.label, points: seg.points});
          else if (seg.type === 'box') {
            const x = seg.x - seg.w/2, y = seg.y - seg.h/2;
            polygons.push({label: det.label, points: [{x,y},{x:x+seg.w,y},{x:x+seg.w,y:y+seg.h},{x,y:y+seg.h}]});
          }
        });
      });
    }
  } else {
    entries.forEach(e => (e.detections||[]).forEach(det => (det.segments||[]).forEach(seg => {
      if (seg.type === 'polygon' && seg.points?.length > 2) polygons.push({label: det.label, points: seg.points});
    })));
  }

  if (!polygons.length) return res.status(400).json({ error: 'Aucune segmentation pour cet élément' });

  try {
    const { uploads } = getProjectDir(req.params.pid);
    const buf = await toJpeg(path.join(uploads, photo.filename), photo.ext);
    if (!buf) return res.status(400).json({ error: 'Cannot read image' });
    const meta = await sharp(buf).metadata();
    const W = meta.width, H = meta.height;

    const mask_svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect width="${W}" height="${H}" fill="black"/>
      ${polygons.map(poly => {
        const pts = poly.points.map(p => `${p.x},${p.y}`).join(' ');
        return `<polygon points="${pts}" fill="white"/>`;
      }).join('')}
    </svg>`;

    const maskBuffer = await sharp(Buffer.from(mask_svg)).toBuffer();
    const result = await sharp(buf).ensureAlpha().composite([{ input: maskBuffer, blend: 'dest-in' }]).png().toBuffer();

    res.setHeader('Content-Type', 'image/png');
    const safeKw = (keyword || 'all').replace(/[^a-z0-9_-]/gi, '_').slice(0, 30);
    const safeName = (photo.original_name || 'photo').replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
    res.setHeader('Content-Disposition', `attachment; filename="masque_${safeName}_${safeKw}.png"`);
    res.send(result);
  } catch(e) {
    console.error('Mask export error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Batch detect all photos in project
app.post('/api/:pid/detect-all', async (req, res) => {
  const { model_id, keywords } = req.body;
  // model_id not required for SAM3
  const data=loadProject(req.params.pid);
  const {uploads}=getProjectDir(req.params.pid);
  const results=[];
  for (const photo of data.photos) {
    try {
      const buf=await toJpeg(path.join(uploads,photo.filename),photo.ext);
      if (!buf) { results.push({id:photo.id,error:'Cannot process'}); continue; }
      const detections=await runRoboflowDetection(buf.toString('base64'), '', keywords||[]);
      photo.detections=detections; photo.detection_model=model_id; photo.detection_keywords=keywords||[];
      results.push({id:photo.id,detections:detections.length});
    } catch(e){ results.push({id:photo.id,error:e.message}); }
    await sleep(200);
  }
  saveProject(req.params.pid,data); res.json({processed:results.length,results});
});

// ── Taxonomy ──────────────────────────────────────────────────────────────────
app.get('/api/:pid/taxonomy', (req,res) => res.json(loadProject(req.params.pid).taxonomy));
app.put('/api/:pid/taxonomy', (req,res) => { const data=loadProject(req.params.pid); data.taxonomy=req.body; saveProject(req.params.pid,data); res.json(data.taxonomy); });
app.post('/api/:pid/taxonomy/family', (req,res) => {
  const {label}=req.body; if(!label) return res.status(400).json({error:'label required'});
  const data=loadProject(req.params.pid), f={id:`fam_${Date.now()}`,label,subs:[]}; data.taxonomy.push(f); saveProject(req.params.pid,data); res.json(f);
});
app.post('/api/:pid/taxonomy/family/:fid/sub', (req,res) => {
  const {label}=req.body; const data=loadProject(req.params.pid); const fam=data.taxonomy.find(f=>f.id===req.params.fid);
  if(!fam) return res.status(404).json({error:'Not found'});
  const sub={id:`sub_${Date.now()}`,label,elements:[]}; fam.subs.push(sub); saveProject(req.params.pid,data); res.json(sub);
});
app.post('/api/:pid/taxonomy/family/:fid/sub/:sid/element', (req,res) => {
  const {element}=req.body; const data=loadProject(req.params.pid); const fam=data.taxonomy.find(f=>f.id===req.params.fid);
  if(!fam) return res.status(404).json({error:'Not found'}); const sub=fam.subs.find(s=>s.id===req.params.sid);
  if(!sub) return res.status(404).json({error:'Not found'}); if(!sub.elements.includes(element)) sub.elements.push(element);
  saveProject(req.params.pid,data); res.json(sub);
});
app.delete('/api/:pid/taxonomy/family/:fid', (req,res) => {
  const data=loadProject(req.params.pid); data.taxonomy=data.taxonomy.filter(f=>f.id!==req.params.fid); saveProject(req.params.pid,data); res.json({ok:true});
});
app.patch('/api/:pid/taxonomy/family/:fid', (req,res) => {
  const data=loadProject(req.params.pid); const fam=data.taxonomy.find(f=>f.id===req.params.fid);
  if(!fam) return res.status(404).json({error:'Not found'}); if(req.body.label) fam.label=req.body.label; saveProject(req.params.pid,data); res.json(fam);
});

// ── Inventory ─────────────────────────────────────────────────────────────────
app.get('/api/:pid/inventory', (req,res) => {
  const {photos,taxonomy}=loadProject(req.params.pid);
  const agg={};
  photos.forEach(photo=>{(photo.inventory||[]).forEach(item=>{
    if(!agg[item.family_id])agg[item.family_id]={};
    if(!agg[item.family_id][item.subfamily_id])agg[item.family_id][item.subfamily_id]={};
    const key=item.element;
    if(!agg[item.family_id][item.subfamily_id][key])agg[item.family_id][item.subfamily_id][key]={quantity:0,conditions:{},photos:[]};
    const e=agg[item.family_id][item.subfamily_id][key];
    e.quantity+=item.quantity; e.conditions[item.condition]=(e.conditions[item.condition]||0)+item.quantity;
    if(!e.photos.includes(photo.id))e.photos.push(photo.id);
  });});
  let total_items=0; Object.values(agg).forEach(s=>Object.values(s).forEach(el=>Object.values(el).forEach(e=>{total_items+=e.quantity;})));
  res.json({aggregated:agg,taxonomy,total_items,total_photos:photos.length,total_photos_with_inventory:photos.filter(p=>p.inventory?.length>0).length});
});

// ── Detection aggregated view ─────────────────────────────────────────────────
app.get('/api/:pid/detections', (req,res) => {
  const {photos}=loadProject(req.params.pid);
  const agg={};
  photos.forEach(photo=>{
    (photo.detections||[]).forEach(det=>{
      if(!agg[det.label])agg[det.label]={label:det.label,total_count:0,confidence_sum:0,det_count:0,photos:[]};
      agg[det.label].total_count+=det.count;
      agg[det.label].confidence_sum+=det.confidence;
      agg[det.label].det_count++;
      if(!agg[det.label].photos.includes(photo.id))agg[det.label].photos.push(photo.id);
    });
  });
  const result=Object.values(agg).map(a=>({...a,avg_confidence:Math.round(a.confidence_sum/a.det_count)})).sort((a,b)=>b.total_count-a.total_count);
  res.json({components:result,total_photos:photos.length,photos_with_detections:photos.filter(p=>p.detections?.length>0).length});
});

// ── Classement overrides ──────────────────────────────────────────────────────
app.get('/api/:pid/overrides', (req,res) => {
  const data = loadProject(req.params.pid);
  res.json({
    classement_overrides: data.classement_overrides || {},
    geometrie_overrides: data.geometrie_overrides || {},
    element_properties: data.element_properties || {},
    vector_drawings: data.vector_drawings || {},
    machine_spatial: data.machine_spatial || {},
  });
});

// Save machine spatial data (floor area, height, volume, connections per machine key)
app.put('/api/:pid/machine-spatial', express.json(), (req, res) => {
  const data = loadProject(req.params.pid);
  data.machine_spatial = req.body || {};
  saveProject(req.params.pid, data);
  res.json({ ok: true });
});

// Estimate machine spatial dimensions via Mammouth Vision
app.post('/api/:pid/estimate-machine', express.json(), async (req, res) => {
  const { element, subtype, photo_id } = req.body || {};
  if (!element) return res.status(400).json({ error: 'element required' });
  const key = process.env.MAMMOUTH_API_KEY;
  if (!key || key === 'COLLE-TA-CLE-ICI') return res.status(400).json({ error: 'MAMMOUTH_API_KEY not set' });

  const data = loadProject(req.params.pid);
  let imageBlock = null;
  if (photo_id) {
    const photo = data.photos.find(p => p.id === photo_id);
    if (photo) {
      try {
        const { uploads } = getProjectDir(req.params.pid);
        const buf = await toJpeg(path.join(uploads, photo.filename), photo.ext);
        if (buf) {
          const small = await sharp(buf).resize(900, 900, {fit:'inside'}).jpeg({quality:80}).toBuffer();
          imageBlock = { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${small.toString('base64')}` } };
        }
      } catch (e) {}
    }
  }

  const prompt = `Industrial machine spatial inventory for an abandoned cement factory reuse project.

MACHINE: "${element}"${subtype ? ` (${subtype})` : ''}

Estimate realistic SPATIAL FOOTPRINT for this industrial equipment based on standard catalogues for cement factory machinery. Use visual scale references in the photo if available (human ~1.7m, doors ~2.1m, structural beams ~30cm).

Reply ONLY with JSON in metric units. Use null for unknowable values:
{
  "floor_area_m2": number,        // ground footprint surface
  "height_m": number,             // total height from floor
  "volume_m3": number,            // bounding box volume (L × W × H)
  "weight_t": number,             // estimated mass in tonnes for transport / structural loading
  "connections": "string",        // required utilities: e.g. "électricité 400V triphasé · eau process · air comprimé 6 bar · évacuation poussière"
  "notes": "string"               // dismantling difficulty, hazardous content, structural requirements e.g. "démontage en 4 sections · présence amiante isolation · charge ponctuelle 8 t"
}

Typical realistic values:
- Broyeur à boulets: floor 12-40 m², height 2-4 m, weight 20-150 t
- Silo cylindrique: floor 20-100 m², height 8-30 m, weight 10-80 t
- Concasseur à mâchoires: floor 4-15 m², height 2-4 m, weight 5-50 t
- Cyclone séparateur: floor 1-5 m², height 3-8 m, weight 0.5-5 t
- Four rotatif: floor 60-200 m² (very elongated), height 4-8 m, weight 100-1000 t
- Convoyeur à bande: per linear meter, floor 0.6-1.2 m², height 1-2 m
- Trémie: floor 1-10 m², height 2-6 m, weight 0.5-10 t`;

  const messages = [{ role: 'user', content: imageBlock ? [imageBlock, { type: 'text', text: prompt }] : prompt }];
  try {
    const r = await fetch('https://api.mammouth.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4.1', max_tokens: 400, messages })
    });
    if (!r.ok) { const t = await r.text(); return res.status(500).json({ error: `API ${r.status}: ${t.slice(0,200)}` }); }
    const apiData = await r.json();
    const text = apiData.choices?.[0]?.message?.content || '{}';
    const cleaned = text.replace(/```json|```/gm, '').trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return res.status(500).json({ error: 'Non-JSON response' });
    const result = JSON.parse(m[0]);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Export a fiche as PNG via server-side SVG rendering
app.post('/api/:pid/export-fiche', express.json(), async (req, res) => {
  const { element_name } = req.body || {};
  if (!element_name) return res.status(400).json({ error: 'element_name required' });

  const data = loadProject(req.params.pid);

  // Find all inventory items matching the element name (which may contain " — subtype")
  const baseName = element_name.includes(' — ') ? element_name.split(' — ')[0] : element_name;
  const subtype = element_name.includes(' — ') ? element_name.split(' — ')[1] : '';
  const matchingPhotos = [];
  let totalQty = 0;
  let sampleItem = null;
  data.photos.forEach(p => {
    (p.inventory||[]).forEach(item => {
      const itSubtype = item.element_subtype || '';
      if (item.element === baseName && itSubtype === subtype) {
        matchingPhotos.push(p);
        totalQty += (item.quantity || 1);
        if (!sampleItem) sampleItem = item;
      }
    });
  });
  if (!sampleItem) return res.status(404).json({ error: 'Élément introuvable' });

  // Get first photo as visual
  const firstPhoto = matchingPhotos[0];
  let photoB64 = '';
  if (firstPhoto) {
    try {
      const { uploads } = getProjectDir(req.params.pid);
      const buf = await toJpeg(path.join(uploads, firstPhoto.filename), firstPhoto.ext);
      if (buf) {
        const small = await sharp(buf).resize(600, 600, {fit:'inside'}).jpeg({quality:88}).toBuffer();
        photoB64 = small.toString('base64');
      }
    } catch (e) {}
  }

  // Get vector drawing if cached
  const cacheKey = (firstPhoto ? firstPhoto.id : 'na') + '__' + baseName;
  let vectorHtml = data.vector_drawings && data.vector_drawings[cacheKey] ? data.vector_drawings[cacheKey] : '';
  // If not cached, try parametric
  if (!vectorHtml && subtype) {
    try {
      const { tryParametricAxono } = require('./profile_catalogue.js');
      const r = tryParametricAxono(baseName, subtype, sampleItem.dim_l_cm, sampleItem.dim_w_cm, sampleItem.dim_h_cm);
      if (r) vectorHtml = r.svg;
    } catch (e) {}
  }

  const props = (data.element_properties && data.element_properties[element_name]) || {};

  // Build SVG fiche (A5 ratio, 1200x1700 px)
  const W = 1200, H = 1700;
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const num = (v, suffix='') => v != null && v !== '' ? `${v}${suffix}` : '—';

  // Extract pure SVG from vectorHtml (which may be <img src='data:image/png;...'> or <svg>)
  let vectorSvgInline = '';
  if (vectorHtml) {
    if (vectorHtml.startsWith('<svg')) {
      // Inline directly, rescale to fit
      vectorSvgInline = vectorHtml.replace(/<svg[^>]*viewBox/, '<svg preserveAspectRatio="xMidYMid meet" width="560" height="560" viewBox');
    } else if (vectorHtml.includes('data:image')) {
      // It's an <img> with data URI, extract the URI
      const m = vectorHtml.match(/data:image\/[^"]+/);
      if (m) vectorSvgInline = `<image href="${m[0]}" x="20" y="20" width="520" height="520" preserveAspectRatio="xMidYMid meet"/>`;
    }
  }

  const fiche = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="#ffffff"/>
    <!-- Header bar -->
    <rect x="50" y="50" width="${W-100}" height="2" fill="#000"/>
    <text x="60" y="100" font-family="Helvetica" font-size="22" font-weight="700" fill="#000">${esc(baseName.toUpperCase())}</text>
    ${subtype ? `<rect x="60" y="115" width="${subtype.length*14+20}" height="30" fill="#000"/><text x="70" y="137" font-family="Helvetica" font-size="18" font-weight="600" fill="#fff">${esc(subtype)}</text>` : ''}
    <text x="${W-60}" y="100" font-family="Helvetica" font-size="42" font-weight="700" fill="#000" text-anchor="end">${totalQty}</text>
    <text x="${W-60}" y="125" font-family="Helvetica" font-size="14" fill="#666" text-anchor="end">UNITÉS INVENTORIÉES</text>
    <rect x="50" y="170" width="${W-100}" height="2" fill="#000"/>

    <!-- Two-side visual block -->
    <g transform="translate(60, 195)">
      <rect x="0" y="0" width="540" height="540" fill="#f6f6f6" stroke="#000" stroke-width="1.5"/>
      ${photoB64 ? `<image href="data:image/jpeg;base64,${photoB64}" x="10" y="10" width="520" height="520" preserveAspectRatio="xMidYMid slice"/>` : `<text x="270" y="280" text-anchor="middle" font-family="Helvetica" font-size="14" fill="#999">PAS DE PHOTO</text>`}
      <rect x="0" y="500" width="180" height="40" fill="rgba(255,255,255,0.92)"/>
      <text x="14" y="525" font-family="Helvetica" font-size="11" font-weight="600" fill="#000" letter-spacing="3">PHOTO IN SITU</text>
    </g>
    <g transform="translate(620, 195)">
      <rect x="0" y="0" width="540" height="540" fill="#ffffff" stroke="#000" stroke-width="1.5"/>
      <g transform="translate(10, 10)">${vectorSvgInline || `<text x="260" y="270" text-anchor="middle" font-family="Helvetica" font-size="13" fill="#999">PAS DE VECTORISATION</text>`}</g>
      <rect x="0" y="500" width="180" height="40" fill="rgba(255,255,255,0.92)"/>
      <text x="14" y="525" font-family="Helvetica" font-size="11" font-weight="600" fill="#000" letter-spacing="3">AXONOMÉTRIE</text>
    </g>

    <!-- Specs grid -->
    <g transform="translate(60, 770)" font-family="Helvetica" font-size="14">
      ${[
        ['DIM. UNITAIRES', sampleItem ? `${num(sampleItem.dim_l_cm)} × ${num(sampleItem.dim_w_cm)} × ${num(sampleItem.dim_h_cm)} cm` : '—'],
        ['DENSITÉ ρ', `${num(props.density_kg_m3)} kg/m³`],
        ['COMPRESSION σc', `${num(props.compression_mpa)} MPa`],
        ['CONDUCTIVITÉ λ', `${num(props.lambda_w_mk)} W/mK`],
        ['ACOUSTIQUE Rw', `${num(props.rw_db)} dB`],
      ].map((row,i)=>`
        <text x="0" y="${i*40+15}" fill="#666" font-size="11" letter-spacing="1">${row[0]}</text>
        <text x="540" y="${i*40+15}" fill="#000" font-weight="700" text-anchor="end">${esc(row[1])}</text>
        <line x1="0" y1="${i*40+22}" x2="540" y2="${i*40+22}" stroke="#bbb" stroke-width="0.5" stroke-dasharray="2 2"/>
      `).join('')}
    </g>
    <g transform="translate(620, 770)" font-family="Helvetica" font-size="14">
      ${[
        ['CLASSE FEU', props.fire_class || '—'],
        ['ÉTAT', sampleItem ? sampleItem.condition || '—' : '—'],
        ['TOXICITÉ', props.toxicity_risk || '—'],
        ['DURÉE RÉSID.', `${num(props.residual_life_years)} ans`],
        ['CO₂ ÉCONOMISÉ', `${num(props.co2_saved_kg_per_unit)} kg/u.`],
      ].map((row,i)=>`
        <text x="0" y="${i*40+15}" fill="#666" font-size="11" letter-spacing="1">${row[0]}</text>
        <text x="540" y="${i*40+15}" fill="#000" font-weight="700" text-anchor="end">${esc(row[1])}</text>
        <line x1="0" y1="${i*40+22}" x2="540" y2="${i*40+22}" stroke="#bbb" stroke-width="0.5" stroke-dasharray="2 2"/>
      `).join('')}
    </g>

    <!-- Reuse role banner -->
    <rect x="60" y="1010" width="${W-120}" height="60" fill="#000"/>
    <text x="80" y="1048" font-family="Helvetica" font-size="11" fill="#fff" letter-spacing="3">RÔLE RÉEMPLOI</text>
    <text x="${W-80}" y="1052" font-family="Helvetica" font-size="20" font-weight="700" fill="#fff" text-anchor="end" letter-spacing="1">${esc((props.reuse_role || 'À CARACTÉRISER').toUpperCase())}</text>

    <!-- Installation -->
    ${props.installation ? `
    <rect x="60" y="1090" width="${W-120}" height="44" fill="#f4f4f4" stroke="#000" stroke-width="1.5" stroke-dasharray="none"/>
    <rect x="60" y="1090" width="4" height="44" fill="#000"/>
    <text x="80" y="1118" font-family="Helvetica" font-size="11" fill="#000" letter-spacing="1.5">MISE EN ŒUVRE:</text>
    <text x="200" y="1118" font-family="Helvetica" font-size="13" fill="#000">${esc(props.installation).slice(0,90)}</text>
    ` : ''}

    <!-- Footer -->
    <line x1="60" y1="1620" x2="${W-60}" y2="1620" stroke="#000" stroke-width="1"/>
    <text x="60" y="1650" font-family="Helvetica" font-size="11" fill="#666" letter-spacing="2">${matchingPhotos.length} PHOTO${matchingPhotos.length>1?'S':''} RÉFÉRENCÉE${matchingPhotos.length>1?'S':''}</text>
    <text x="${W-60}" y="1650" font-family="Helvetica" font-size="11" fill="#666" text-anchor="end" letter-spacing="2">MATERIA · CIMENTERIE DU CHEVALON</text>
  </svg>`;

  try {
    const pngBuf = await sharp(Buffer.from(fiche), { density: 200 }).png().toBuffer();
    const safe = element_name.replace(/[^a-z0-9_-]/gi, '_').slice(0, 60);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="fiche_${safe}.png"`);
    res.send(pngBuf);
  } catch (e) {
    res.status(500).json({ error: 'PNG render failed: ' + e.message });
  }
});

app.post('/api/:pid/vectorize-element', express.json(), async (req, res) => {
  const { photo_id, element, keyword, cache_key, subtype, dim_l_cm, dim_w_cm, dim_h_cm } = req.body || {};
  if (!photo_id) return res.status(400).json({ error: 'photo_id required' });

  const data = loadProject(req.params.pid);
  const photo = data.photos.find(p => p.id === photo_id);
  if (!photo) return res.status(404).json({ error: 'photo not found' });

  // STEP A — Try parametric axonometric from catalogue (precise, normative)
  try {
    const { tryParametricAxono } = require('./profile_catalogue.js');
    // Look up subtype: from request first, then from photo inventory
    let resolvedSubtype = subtype;
    let resolvedL = dim_l_cm, resolvedW = dim_w_cm, resolvedH = dim_h_cm;
    if (!resolvedSubtype && element) {
      const inv = (photo.inventory||[]).find(i => i.element === element);
      if (inv) {
        resolvedSubtype = inv.element_subtype || null;
        resolvedL = resolvedL || inv.dim_l_cm;
        resolvedW = resolvedW || inv.dim_w_cm;
        resolvedH = resolvedH || inv.dim_h_cm;
      }
    }
    if (resolvedSubtype) {
      const result = tryParametricAxono(element || '', resolvedSubtype, resolvedL, resolvedW, resolvedH);
      if (result) {
        // Cache and return
        const project = loadProject(req.params.pid);
        if (!project.vector_drawings) project.vector_drawings = {};
        const drawingHtml = result.svg;
        project.vector_drawings[cache_key || (photo_id + '__' + (element || 'all'))] = drawingHtml;
        saveProject(req.params.pid, project);
        return res.json({ svg: drawingHtml, source: 'parametric', kind: result.kind, subtype: result.subtype });
      }
    }
  } catch (e) {
    console.warn('parametric axono failed', e.message);
    // Fall through to edge detection
  }

  // STEP B — Fallback: edge-detection on SAM mask (existing behaviour)
  // Find polygons to use as mask
  let polygons = [];
  const entries = photo.detection_entries || [];
  if (keyword && keyword.length) {
    const match = entries.find(e => (e.keywords || []).join(', ') === keyword);
    if (match) {
      (match.detections || []).forEach(det => {
        (det.segments || []).forEach(seg => {
          if (seg.type === 'polygon' && seg.points?.length > 2) polygons.push(seg.points);
          else if (seg.type === 'box') {
            const x = seg.x - seg.w/2, y = seg.y - seg.h/2;
            polygons.push([{x,y},{x:x+seg.w,y},{x:x+seg.w,y:y+seg.h},{x,y:y+seg.h}]);
          }
        });
      });
    }
  } else {
    // Fallback: use ALL polygons across ALL entries
    entries.forEach(e => (e.detections||[]).forEach(det => (det.segments||[]).forEach(seg => {
      if (seg.type === 'polygon' && seg.points?.length > 2) polygons.push(seg.points);
      else if (seg.type === 'box') {
        const x = seg.x - seg.w/2, y = seg.y - seg.h/2;
        polygons.push([{x,y},{x:x+seg.w,y},{x:x+seg.w,y:y+seg.h},{x,y:y+seg.h}]);
      }
    })));
  }

  try {
    const { uploads } = getProjectDir(req.params.pid);
    const buf = await toJpeg(path.join(uploads, photo.filename), photo.ext);
    if (!buf) return res.status(400).json({ error: 'Cannot read image' });

    const meta = await sharp(buf).metadata();
    const W = meta.width, H = meta.height;

    // Compute bounding box of all polygons (or full image if none)
    let minX = 0, minY = 0, maxX = W, maxY = H;
    if (polygons.length) {
      minX = W; minY = H; maxX = 0; maxY = 0;
      polygons.forEach(poly => poly.forEach(p => {
        if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
      }));
      // Padding
      const pad = Math.max((maxX - minX), (maxY - minY)) * 0.05;
      minX = Math.max(0, Math.floor(minX - pad));
      minY = Math.max(0, Math.floor(minY - pad));
      maxX = Math.min(W, Math.ceil(maxX + pad));
      maxY = Math.min(H, Math.ceil(maxY + pad));
    }
    const cropW = Math.max(2, maxX - minX);
    const cropH = Math.max(2, maxY - minY);

    // Step 1 — Crop the photo to the bbox
    const cropped = await sharp(buf).extract({ left: minX, top: minY, width: cropW, height: cropH }).toBuffer();

    // Step 2 — If we have polygons, build a mask in the cropped coordinate space
    //   White = inside object, Black = outside (background to be made white in final)
    let maskedRgba;
    if (polygons.length) {
      const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cropW}" height="${cropH}">
        <rect width="${cropW}" height="${cropH}" fill="black"/>
        ${polygons.map(poly => {
          const pts = poly.map(p => `${(p.x - minX).toFixed(1)},${(p.y - minY).toFixed(1)}`).join(' ');
          return `<polygon points="${pts}" fill="white"/>`;
        }).join('')}
      </svg>`;
      const maskBuf = await sharp(Buffer.from(maskSvg)).toBuffer();

      // Composite: keep cropped pixels where mask is white, transparent elsewhere
      maskedRgba = await sharp(cropped)
        .ensureAlpha()
        .composite([{ input: maskBuf, blend: 'dest-in' }])
        .png()
        .toBuffer();
    } else {
      maskedRgba = await sharp(cropped).ensureAlpha().png().toBuffer();
    }

    // Step 3 — Edge detection pipeline
    // Convert to grayscale, blur slightly to reduce noise, then detect edges via convolution (Sobel-like)
    // Sharp doesn't have Canny but we can approximate with: grayscale → blur → high-pass via convolve
    //
    // Strategy: use a strong gradient kernel. We do TWO passes (horizontal + vertical Sobel),
    // combine, then threshold.
    const grayBuf = await sharp(maskedRgba)
      .greyscale()
      .blur(1.0)  // light blur to reduce JPEG noise
      .toColorspace('b-w')
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { data: gray, info } = grayBuf;
    const Wc = info.width, Hc = info.height;

    // Sobel edge detection
    const edges = Buffer.alloc(Wc * Hc);
    for (let y = 1; y < Hc - 1; y++) {
      for (let x = 1; x < Wc - 1; x++) {
        const idx = y * Wc + x;
        // Sobel X
        const gx =
          -1 * gray[(y-1)*Wc + (x-1)] + 1 * gray[(y-1)*Wc + (x+1)] +
          -2 * gray[ y   *Wc + (x-1)] + 2 * gray[ y   *Wc + (x+1)] +
          -1 * gray[(y+1)*Wc + (x-1)] + 1 * gray[(y+1)*Wc + (x+1)];
        // Sobel Y
        const gy =
          -1 * gray[(y-1)*Wc + (x-1)] - 2 * gray[(y-1)*Wc +  x   ] - 1 * gray[(y-1)*Wc + (x+1)] +
           1 * gray[(y+1)*Wc + (x-1)] + 2 * gray[(y+1)*Wc +  x   ] + 1 * gray[(y+1)*Wc + (x+1)];
        const mag = Math.min(255, Math.sqrt(gx*gx + gy*gy));
        edges[idx] = mag;
      }
    }

    // Threshold: pixels above threshold become black ink, others white (background)
    const THRESH = 35;
    // Build RGBA: white background, black where edges
    const rgba = Buffer.alloc(Wc * Hc * 4);
    for (let i = 0; i < Wc * Hc; i++) {
      const v = edges[i];
      const isEdge = v > THRESH;
      // Variable thickness: stronger edges = darker
      let intensity = isEdge ? Math.max(0, 255 - v * 1.8) : 255;
      if (intensity < 0) intensity = 0;
      if (intensity > 255) intensity = 255;
      rgba[i*4]     = intensity;
      rgba[i*4 + 1] = intensity;
      rgba[i*4 + 2] = intensity;
      rgba[i*4 + 3] = 255;
    }

    // Apply mask AGAIN to whiten outside polygons (remove edge artifacts at mask boundary outside)
    let finalBuf = await sharp(rgba, { raw: { width: Wc, height: Hc, channels: 4 } }).png().toBuffer();

    if (polygons.length) {
      // Create a slightly eroded mask (we want to keep the object outline crisp inside)
      const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Wc}" height="${Hc}">
        <rect width="${Wc}" height="${Hc}" fill="white"/>
        ${polygons.map(poly => {
          const pts = poly.map(p => `${(p.x - minX).toFixed(1)},${(p.y - minY).toFixed(1)}`).join(' ');
          return `<polygon points="${pts}" fill="black"/>`;
        }).join('')}
      </svg>`;
      // Where mask is white (outside) → force final to white
      const maskBuf = await sharp(Buffer.from(maskSvg)).toBuffer();
      // Use 'lighten' so white from mask wins outside
      finalBuf = await sharp(finalBuf).composite([{ input: maskBuf, blend: 'lighten' }]).png().toBuffer();

      // Now ALSO draw the polygon outlines on top in pure black so the silhouette is crisp
      const outlineSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Wc}" height="${Hc}">
        ${polygons.map(poly => {
          const pts = poly.map(p => `${(p.x - minX).toFixed(1)},${(p.y - minY).toFixed(1)}`).join(' ');
          return `<polygon points="${pts}" fill="none" stroke="black" stroke-width="1.6" stroke-linejoin="round"/>`;
        }).join('')}
      </svg>`;
      const outlineBuf = await sharp(Buffer.from(outlineSvg)).png().toBuffer();
      finalBuf = await sharp(finalBuf).composite([{ input: outlineBuf, blend: 'multiply' }]).png().toBuffer();
    }

    // Cache as base64 PNG
    const b64 = finalBuf.toString('base64');
    const drawingHtml = `<img src="data:image/png;base64,${b64}" style="width:100%;height:100%;object-fit:contain;background:#fff" alt="">`;

    const project = loadProject(req.params.pid);
    if (!project.vector_drawings) project.vector_drawings = {};
    project.vector_drawings[cache_key || (photo_id + '__' + (element || 'all'))] = drawingHtml;
    saveProject(req.params.pid, project);

    res.json({ svg: drawingHtml });
  } catch (e) {
    console.error('vectorize error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/:pid/vector-drawings', (req,res) => {
  const data = loadProject(req.params.pid);
  res.json(data.vector_drawings || {});
});

app.put('/api/:pid/element-properties', (req,res) => {
  const data = loadProject(req.params.pid);
  data.element_properties = req.body || {};
  saveProject(req.params.pid, data);
  res.json({ok:true});
});

app.post('/api/:pid/estimate-properties', express.json(), async (req, res) => {
  const { element } = req.body || {};
  if (!element) return res.status(400).json({ error: 'element required' });
  const key = process.env.MAMMOUTH_API_KEY;
  if (!key || key === 'COLLE-TA-CLE-ICI') return res.status(400).json({ error: 'MAMMOUTH_API_KEY not set' });
  const prompt = `For an architectural reuse / réemploi inventory of an abandoned cement factory, give realistic physico-chemical properties for: "${element}".

If the element name contains a STANDARD REFERENCE (e.g. "IPE200", "HEA160", "500x200x200", "C25/30", "S235", "GL24h", "B60"), use the EXACT values from European technical standards (EN 1993 for steel, EN 1992 for concrete, EN 771 for masonry, EN 14080 for glulam, EN 12354 for acoustics, EN 1990 for carbon).
For metal profiles, density should reflect that the element is solid steel (~7850 kg/m³) and the values apply to the steel itself.
For hollow blocks (parpaing creux), density should reflect the apparent bulk density (~700-900 kg/m³ for B60) including voids.

Reply ONLY with JSON in metric units. Use null for any property that doesn't apply:
{
  "density_kg_m3": number,
  "compression_mpa": number,
  "tensile_mpa": number,
  "modulus_gpa": number,
  "lambda_w_mk": number,
  "fire_class": "A1"|"A2"|"B"|"C"|"D"|"E"|"F",
  "reuse_role": "porteur"|"remplissage"|"parement"|"isolant"|"décoratif"|"non réutilisable",
  "installation": "string",
  "impact_kj_m2": number,            // Charpy impact resistance, useful to evaluate dismantling fragility
  "wear_resistance": "haute"|"moyenne"|"faible", // qualitative scale for floor/worktop reuse
  "rw_db": number,                    // Acoustic insulation index (mass law) — for partitions between ateliers
  "alpha_w": number,                  // Acoustic absorption coefficient 0-1 — for performance hall
  "water_perm": "etanche"|"faible"|"moyenne"|"forte", // Water permeability for facade reuse
  "toxicity_risk": "aucun"|"faible"|"amiante_possible"|"plomb_possible"|"cov"|"multiple", // amiante for pre-1997 fibrociment, plomb for old paints/pipes
  "co2_saved_kg_per_unit": number,   // kgCO2eq saved by reuse vs new production
  "residual_life_years": number      // estimated remaining service life after reuse
}`;

  try {
    const r = await fetch('https://api.mammouth.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4.1', max_tokens: 600, messages: [{ role: 'user', content: prompt }] })
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(500).json({ error: `API ${r.status}: ${t.slice(0,200)}` });
    }
    const data = await r.json();
    const text = data.choices?.[0]?.message?.content || '{}';
    const cleaned = text.replace(/```json|```/gm, '').trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return res.status(500).json({ error: 'Non-JSON response' });
    const props = JSON.parse(m[0]);
    const project = loadProject(req.params.pid);
    if (!project.element_properties) project.element_properties = {};
    project.element_properties[element] = { ...(project.element_properties[element]||{}), ...props };
    saveProject(req.params.pid, project);
    res.json(props);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/:pid/geometrie-overrides', (req,res) => {
  const data = loadProject(req.params.pid);
  data.geometrie_overrides = req.body || {};
  saveProject(req.params.pid, data);
  res.json(data.geometrie_overrides);
});

app.put('/api/:pid/classement-overrides', (req,res) => {
  const data=loadProject(req.params.pid);
  data.classement_overrides=req.body;
  saveProject(req.params.pid,data); res.json(data.classement_overrides);
});

// ── Map ───────────────────────────────────────────────────────────────────────
app.get('/api/:pid/map', (req,res) => {
  const {photos,clusters}=loadProject(req.params.pid);
  res.json({photos:photos.filter(p=>p.location).map(p=>({id:p.id,thumb:p.thumb,original_name:p.original_name,location:p.location,cluster_id:p.cluster_id,primary:p.primary,interest:p.interest})),clusters});
});
app.get('/api/:pid/clusters', (req,res) => {
  const data=loadProject(req.params.pid);
  res.json(data.clusters.map(c=>({...c,photos:data.photos.filter(p=>p.cluster_id===c.id).map(p=>({id:p.id,thumb:p.thumb,original_name:p.original_name}))})));
});
app.patch('/api/:pid/clusters/:cid', (req,res) => {
  const data=loadProject(req.params.pid); const c=data.clusters.find(c=>c.id===req.params.cid);
  if(!c) return res.status(404).json({error:'Not found'}); if(req.body.label)c.label=req.body.label; saveProject(req.params.pid,data); res.json(c);
});
app.post('/api/:pid/photos/:id/location', (req,res) => {
  const {x,y}=req.body;
  if (x===undefined||y===undefined) return res.status(400).json({error:'x,y required'});
  const data=loadProject(req.params.pid), idx=data.photos.findIndex(p=>p.id===req.params.id);
  if (idx===-1) return res.status(404).json({error:'Not found'});
  data.photos[idx].location={x:parseFloat(x),y:parseFloat(y)};
  data.photos[idx].cluster_id=findOrCreateCluster(data,parseFloat(x),parseFloat(y));
  saveProject(req.params.pid,data); res.json(data.photos[idx]);
});

// ── Site map ──────────────────────────────────────────────────────────────────
const uploadMapMiddleware = multer({ storage: multer.diskStorage({
  destination:(_q,_f,cb) => cb(null,ASSETS),
  filename:(_q,_f,cb) => cb(null,'site_map.png'),
}), limits:{ fileSize:50*1024*1024 }});
app.post('/api/sitemap', uploadMapMiddleware.single('map'), (_q,res) => res.json({ok:true}));

// ── Export ────────────────────────────────────────────────────────────────────
app.get('/api/:pid/export', (req,res) => {
  res.setHeader('Content-Disposition',`attachment; filename="atlas_${req.params.pid}.json"`);
  res.json(loadProject(req.params.pid));
});

// ── API Key ───────────────────────────────────────────────────────────────────
app.post('/api/set-key', (req, res) => {
  const { key, roboflow_key } = req.body;
  const envPath = process.env.ATLAS_USER_DATA ? path.join(process.env.ATLAS_USER_DATA,'.env') : path.join(__dirname,'.env');
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath,'utf-8') : '';
  if (key?.trim()) {
    process.env.MAMMOUTH_API_KEY = key.trim();
    content = content.includes('MAMMOUTH_API_KEY=') ? content.replace(/MAMMOUTH_API_KEY=.*/,'MAMMOUTH_API_KEY='+key.trim()) : content+'\nMAMMOUTH_API_KEY='+key.trim()+'\n';
  }
  if (roboflow_key?.trim()) {
    process.env.ROBOFLOW_API_KEY = roboflow_key.trim();
    content = content.includes('ROBOFLOW_API_KEY=') ? content.replace(/ROBOFLOW_API_KEY=.*/,'ROBOFLOW_API_KEY='+roboflow_key.trim()) : content+'\nROBOFLOW_API_KEY='+roboflow_key.trim()+'\n';
  }
  fs.writeFileSync(envPath, content);
  res.json({ok:true});
});

app.get('/api/keys-status', (_q, res) => {
  res.json({
    mammouth: !!(process.env.MAMMOUTH_API_KEY && process.env.MAMMOUTH_API_KEY !== 'COLLE-TA-CLE-ICI'),
    roboflow: !!(process.env.ROBOFLOW_API_KEY && process.env.ROBOFLOW_API_KEY !== ''),
  });
});

// ── Print preview — saves HTML to temp file, served at /print/:id ─────────────
const PRINT_CACHE = {};
app.post('/api/print-preview', express.json({limit:'50mb'}), (req, res) => {
  const { html, title } = req.body;
  if (!html) return res.status(400).json({ error: 'No html' });
  const id = `print_${Date.now()}`;
  PRINT_CACHE[id] = html;
  // Auto-delete after 10 min
  setTimeout(() => delete PRINT_CACHE[id], 10 * 60 * 1000);
  res.json({ url: `http://localhost:${PORT}/print/${id}` });
});

app.get('/print/:id', (req, res) => {
  const html = PRINT_CACHE[req.params.id];
  if (!html) return res.status(404).send('Expired — regenerate from MATERIA');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.listen(PORT, () => console.log(`Atlas v9 running on http://localhost:${PORT}`));
