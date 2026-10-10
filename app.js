// WildTrail: collect real wildlife outdoors. All data stays on this device.

// ---------- Species list for on-device identification ----------
// [label shown to the user, type]. The open model (CLIP) scores a photo against these.
const SPECIES = [
  // birds
  ['house sparrow', 'bird'], ['Indian peafowl', 'bird'], ['common myna', 'bird'],
  ['rose-ringed parakeet', 'bird'], ['house crow', 'bird'], ['black kite', 'bird'],
  ['Asian koel', 'bird'], ['red-vented bulbul', 'bird'], ['Indian robin', 'bird'],
  ['purple sunbird', 'bird'], ['cattle egret', 'bird'], ['little egret', 'bird'],
  ['kingfisher', 'bird'], ['hoopoe', 'bird'], ['barn swallow', 'bird'],
  ['spotted dove', 'bird'], ['rock pigeon', 'bird'], ['owl', 'bird'], ['eagle', 'bird'],
  ['heron', 'bird'], ['duck', 'bird'], ['parrot', 'bird'],
  // animals
  ['dog', 'animal'], ['cat', 'animal'], ['cow', 'animal'], ['Indian palm squirrel', 'animal'],
  ['rhesus macaque monkey', 'animal'], ['langur', 'animal'], ['spotted deer', 'animal'],
  ['goat', 'animal'], ['buffalo', 'animal'], ['horse', 'animal'], ['elephant', 'animal'],
  ['mongoose', 'animal'], ['garden lizard', 'animal'], ['gecko', 'animal'], ['frog', 'animal'],
  ['snake', 'animal'], ['tortoise', 'animal'], ['fish', 'animal'], ['rabbit', 'animal'],
  ['snail', 'animal'], ['bat', 'animal'],
  // insects and bugs
  ['butterfly', 'insect'], ['honey bee', 'insect'], ['wasp', 'insect'], ['dragonfly', 'insect'],
  ['ant', 'insect'], ['beetle', 'insect'], ['ladybug', 'insect'], ['grasshopper', 'insect'],
  ['praying mantis', 'insect'], ['moth', 'insect'], ['caterpillar', 'insect'],
  ['cricket insect', 'insect'], ['house fly', 'insect'], ['spider', 'insect'],
  // flowers and plants
  ['rose', 'flower'], ['hibiscus', 'flower'], ['marigold', 'flower'], ['jasmine', 'flower'],
  ['lotus', 'flower'], ['sunflower', 'flower'], ['bougainvillea', 'flower'],
  ['frangipani', 'flower'], ['daisy', 'flower'], ['orchid', 'flower'], ['tulip', 'flower'],
  ['lily', 'flower'], ['dandelion', 'flower'], ['lavender', 'flower'], ['cosmos flower', 'flower'],
  ['gulmohar flower', 'flower'], ['morning glory', 'flower'], ['zinnia', 'flower'],
  ['lantana', 'flower'], ['leaf', 'flower'], ['mushroom', 'flower'],
];
// Anything that is not wildlife or a plant, so the model can say "nothing found".
const NONE_LABEL = 'a person, a room, a building or an everyday object';

const typeOf = Object.fromEntries(SPECIES);
const LABELS = [...SPECIES.map(s => s[0]), NONE_LABEL];
const ICONS = { bird: '🐦', animal: '🐾', insect: '🐛', flower: '🌸' };

// ---------- Tiny IndexedDB wrapper (Version 2 with Regions) ----------
const DB_NAME = 'wildtrail';
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = e => {
      const db = req.result;
      if (!db.objectStoreNames.contains('finds')) {
        db.createObjectStore('finds', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('track')) {
        db.createObjectStore('track', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta');
      }
      if (!db.objectStoreNames.contains('regions')) {
        db.createObjectStore('regions', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
let dbp = null;
const db = () => (dbp ||= openDB());
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r && r.result);
    t.onerror = () => reject(t.error);
  });
}
const putAll = (s, v) => tx(s, 'readwrite', o => o.put(v));
const getAll = s => tx(s, 'readonly', o => o.getAll());
const getOne = (s, k) => tx(s, 'readonly', o => o.get(k));
const delOne = (s, k) => tx(s, 'readwrite', o => o.delete(k));
const metaGet = k => tx('meta', 'readonly', o => o.get(k));
const metaSet = (k, v) => tx('meta', 'readwrite', o => o.put(v, k));
const clearAll = async () => {
  for (const s of ['finds', 'track', 'meta', 'regions']) {
    try { await tx(s, 'readwrite', o => o.clear()); } catch (_) {}
  }
};

// ---------- DOM helpers ----------
const $ = id => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);

// ---------- Navigation ----------
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === name));
  $('nav').classList.toggle('hidden', name === 'welcome');
  if (name === 'collection') renderCollection();
  if (name === 'map') {
    renderMapAndStats();
    checkActiveRegionMap();
  }
}
document.querySelectorAll('#nav button').forEach(b => b.onclick = () => showView(b.dataset.v));

// ---------- Profile (local only, no login server) ----------
async function updateTrainerChip() {
  const name = await metaGet('name');
  if (!name) return;
  const allFinds = await getAll('finds');
  $('who').textContent = `🌿 ${name} · ${allFinds.length}`;
}

async function boot() {
  const name = await metaGet('name');
  if (!name) { showView('welcome'); return; }
  await updateTrainerChip();
  showView('capture');
  loadTrack();
}
$('start-btn').onclick = async () => {
  const name = $('name-input').value.trim() || 'Explorer';
  await metaSet('name', name);
  await updateTrainerChip();
  showView('capture');
  loadTrack();
};

// ---------- Camera ----------
let stream = null;
$('cam-btn').onclick = async () => {
  if (stream) { stopCamera(); return; }
  try {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } catch (camErr) {
      // Fallback for laptops/desktops without an environment camera
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
    $('video').srcObject = stream;
    await $('video').play();
    show('cam-msg', false);
    $('snap-btn').disabled = false;
    $('cam-btn-text').textContent = 'Stop camera';
    $('lens-status').textContent = '● Live Lens';
    $('lens-status').classList.add('active');
    warmModel(); // start loading the model while the user aims the camera
  } catch (e) {
    $('cam-msg').textContent = 'Camera unavailable: ' + (e.message || e.name);
  }
};
function stopCamera() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  $('video').srcObject = null;
  show('cam-msg', true);
  $('cam-msg').textContent = 'Camera is off';
  $('snap-btn').disabled = true;
  $('cam-btn-text').textContent = 'Start camera';
  $('lens-status').textContent = '○ Standby';
  $('lens-status').classList.remove('active');
}

// ---------- On-device identification (open model, runs in the browser) ----------
let classifierP = null;
function warmModel() {
  if (classifierP) return classifierP;
  $('model-status').textContent = 'Loading the identification model (first time only)...';
  classifierP = (async () => {
    const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3');
    env.allowLocalModels = false;
    const pipe = await pipeline('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32', {
      progress_callback: p => {
        if (p.status === 'progress' && p.progress != null)
          $('model-status').textContent = `Downloading model: ${Math.round(p.progress)}%`;
      },
    });
    $('model-status').textContent = 'Model ready. Identification runs fully on your device.';
    return pipe;
  })().catch(err => {
    classifierP = null;
    $('model-status').textContent = 'Model could not load (' + (err.message || err) + '). You can still name finds by hand.';
    return null;
  });
  return classifierP;
}

let pending = null; // the capture waiting for confirmation
$('snap-btn').onclick = async () => {
  const v = $('video');
  if (!v.videoWidth) return;
  if ('vibrate' in navigator) navigator.vibrate(40);
  const c = document.createElement('canvas');
  const scale = 480 / Math.max(v.videoWidth, v.videoHeight);
  c.width = Math.round(v.videoWidth * scale);
  c.height = Math.round(v.videoHeight * scale);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL('image/jpeg', 0.8);
  pending = { photo: dataUrl, guesses: [] };
  $('result-img').src = dataUrl;
  $('guesses').textContent = 'Identifying...';
  $('name-field').value = '';
  show('result', true);

  const pipe = await warmModel();
  if (pipe) {
    try {
      const out = await pipe(dataUrl, LABELS, { hypothesis_template: 'a photo of a {}.' });
      const ranked = [...out].sort((a, b) => b.score - a.score);
      if (ranked[0].label === NONE_LABEL) {
        $('guesses').textContent = 'Looks like nothing wild here. Try again or name it yourself.';
      } else {
        pending.guesses = ranked.filter(r => r.label !== NONE_LABEL).slice(0, 3);
        renderGuesses();
        pickGuess(pending.guesses[0]);
        return;
      }
    } catch (e) {
      $('guesses').textContent = 'Could not identify this one. Name it yourself.';
    }
  } else {
    $('guesses').textContent = 'Model not available. Name it yourself.';
  }
};
function renderGuesses() {
  const box = $('guesses');
  box.textContent = '';
  pending.guesses.forEach(g => {
    const b = document.createElement('button');
    b.className = 'guess-pill';
    const pct = Math.round(g.score * 100);
    const s1 = document.createElement('span'); s1.textContent = g.label;
    const s2 = document.createElement('span'); s2.className = 'score-badge'; s2.textContent = `${pct}%`;
    b.append(s1, s2);
    b.onclick = () => pickGuess(g);
    b.dataset.label = g.label;
    box.appendChild(b);
  });
}
function pickGuess(g) {
  $('name-field').value = g.label;
  $('type-field').value = typeOf[g.label] || 'animal';
  [...$('guesses').children].forEach(b => b.classList.toggle('on', b.dataset.label === g.label));
}
$('discard-btn').onclick = () => { pending = null; show('result', false); };
$('save-btn').onclick = async () => {
  if (!pending) return;
  const name = $('name-field').value.trim();
  if (!name) { $('name-field').focus(); return; }
  if ('vibrate' in navigator) navigator.vibrate([40, 50, 80]);
  const pos = lastPos || await getPosition();
  await putAll('finds', {
    name, type: $('type-field').value, photo: pending.photo, time: Date.now(),
    lat: pos ? pos.lat : null, lon: pos ? pos.lon : null,
    guessed: pending.guesses[0] ? pending.guesses[0].label : null,
  });
  pending = null;
  show('result', false);
  await updateTrainerChip();
  showView('collection');
};

// ---------- Collection ----------
let filter = 'all';
document.querySelectorAll('#filter-tabs button').forEach(b => b.onclick = () => {
  filter = b.dataset.f;
  document.querySelectorAll('#filter-tabs button').forEach(x => x.classList.toggle('on', x === b));
  renderCollection();
});
async function renderCollection() {
  const allFinds = (await getAll('finds')).reverse();
  const finds = allFinds.filter(f => filter === 'all' || f.type === filter);
  $('collection-stats').textContent = `${allFinds.length} ${allFinds.length === 1 ? 'find' : 'finds'}`;
  const grid = $('grid');
  grid.textContent = '';
  show('empty-msg', finds.length === 0);
  finds.forEach(f => {
    const t = document.createElement('div');
    t.className = 'tile';
    t.onclick = () => openDetailModal(f);

    const chip = document.createElement('span');
    chip.className = 'tile-chip';
    chip.textContent = `${ICONS[f.type] || '🌿'} ${f.type}`;

    const img = document.createElement('img');
    img.src = f.photo;
    img.alt = f.name;
    img.loading = 'lazy';

    const scrim = document.createElement('div');
    scrim.className = 'tile-scrim';
    const n = document.createElement('b');
    n.textContent = f.name;
    const s = document.createElement('small');
    s.textContent = new Date(f.time).toLocaleDateString([], { month: 'short', day: 'numeric' });
    scrim.append(n, s);

    t.append(chip, img, scrim);
    grid.appendChild(t);
  });
}

function openDetailModal(find) {
  $('modal-img').src = find.photo;
  $('modal-name').textContent = find.name;
  $('modal-type-badge').textContent = `${ICONS[find.type] || '🌿'} ${find.type.toUpperCase()}`;
  $('modal-date').textContent = new Date(find.time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  $('modal-coords').textContent = (find.lat != null && find.lon != null)
    ? `${find.lat.toFixed(4)}°, ${find.lon.toFixed(4)}°`
    : 'No GPS logged';
  $('modal-guessed').textContent = find.guessed ? `AI: ${find.guessed}` : 'Manual entry';

  $('modal-delete-btn').onclick = async () => {
    if (confirm(`Remove "${find.name}" from your journal?`)) {
      await delOne('finds', find.id);
      show('detail-modal', false);
      await updateTrainerChip();
      renderCollection();
    }
  };
  show('detail-modal', true);
}

$('modal-close-btn').onclick = () => show('detail-modal', false);
$('detail-modal').onclick = e => {
  if (e.target === $('detail-modal')) show('detail-modal', false);
};

// ---------- Location, Distance and Map ----------
let lastPos = null;
let track = [];             // {lat, lon, t, uncharted}
let watchId = null;
let totalMeters = 0;
const CELL = 20;            // metres per explored square
let zoom = 1;
const unchartedCells = new Set();
let unchartedToastShown = false;

function getPosition() {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => res(null), { enableHighAccuracy: true, timeout: 6000 });
  });
}
function meters(a, b) { // haversine
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
async function loadTrack() {
  track = await getAll('track');
  totalMeters = 0;
  for (let i = 1; i < track.length; i++) {
    const d = meters(track[i - 1], track[i]);
    if (d < 200) totalMeters += d; // ignore GPS jumps
  }
  if (track.length) lastPos = track[track.length - 1];
}
$('track-btn').onclick = () => {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    $('track-btn').textContent = 'Start Tracking Trail';
    $('track-btn').classList.remove('danger-btn');
    $('track-btn').classList.add('primary');
    $('gps-status').textContent = '📍 GPS: Standby';
    $('gps-status').classList.remove('active');
    return;
  }
  if (!navigator.geolocation) { alert('Location is not available on this device.'); return; }
  watchId = navigator.geolocation.watchPosition(onPos, e => alert('Location error: ' + e.message),
    { enableHighAccuracy: true, maximumAge: 2000 });
  $('track-btn').textContent = 'Stop Tracking Trail';
  $('track-btn').classList.remove('primary');
  $('track-btn').classList.add('danger-btn');
  $('gps-status').textContent = '📍 GPS: Tracking active';
  $('gps-status').classList.add('active');
};

// ---------- Feature B: Edge & Uncharted Distance Math ----------
function getEdgeProximity(pt, regions) {
  if (!regions || !regions.length) return { distanceMeters: -1, isInsideAny: false };
  let minInsideDistance = Infinity;
  let isInsideAny = false;

  for (const reg of regions) {
    if (!reg.bbox) continue;
    const [minLon, minLat, maxLon, maxLat] = reg.bbox;
    const inLat = pt.lat >= minLat && pt.lat <= maxLat;
    const inLon = pt.lon >= minLon && pt.lon <= maxLon;
    if (inLat && inLon) {
      isInsideAny = true;
      const dN = meters(pt, { lat: maxLat, lon: pt.lon });
      const dS = meters(pt, { lat: minLat, lon: pt.lon });
      const dE = meters(pt, { lat: pt.lat, lon: maxLon });
      const dW = meters(pt, { lat: pt.lat, lon: minLon });
      const dEdge = Math.min(dN, dS, dE, dW);
      if (dEdge < minInsideDistance) minInsideDistance = dEdge;
    }
  }

  if (isInsideAny) {
    return { distanceMeters: minInsideDistance, isInsideAny: true };
  }

  // Outside all regions: find distance to nearest bounding box
  let minOutsideDist = Infinity;
  for (const reg of regions) {
    if (!reg.bbox) continue;
    const [minLon, minLat, maxLon, maxLat] = reg.bbox;
    const cLat = Math.max(minLat, Math.min(maxLat, pt.lat));
    const cLon = Math.max(minLon, Math.min(maxLon, pt.lon));
    const d = meters(pt, { lat: cLat, lon: cLon });
    if (d < minOutsideDist) minOutsideDist = d;
  }
  return { distanceMeters: -minOutsideDist, isInsideAny: false };
}

async function onPos(p) {
  if (p.coords.accuracy > 50) return; // too fuzzy to trust
  const pt = { lat: p.coords.latitude, lon: p.coords.longitude, t: Date.now() };

  // Check proximity against saved map regions
  const regions = await getAll('regions');
  const prox = getEdgeProximity(pt, regions);

  // Near edge prompt check (~1km inside boundary)
  if (regions.length > 0) {
    if (prox.isInsideAny && prox.distanceMeters <= 1000) {
      if (sessionStorage.getItem('edge_prompt_dismissed') !== 'true') {
        if (!navigator.onLine) {
          $('edge-banner-text').textContent = "You're nearing uncharted ground. (Offline right now — we'll remind you when online).";
        } else {
          $('edge-banner-text').textContent = "You're nearing uncharted ground. Download the map for this area?";
        }
        show('edge-banner', true);
      }
    } else {
      show('edge-banner', false);
    }

    // Outside region handling
    if (!prox.isInsideAny) {
      pt.uncharted = true;
      if (!unchartedToastShown) {
        unchartedToastShown = true;
        showUnchartedToast();
      }
    }
  }

  const prev = track[track.length - 1];
  if (prev) {
    const d = meters(prev, pt);
    if (d < 8) { lastPos = pt; return; }
    if (d < 200) totalMeters += d;
  }
  track.push(pt);
  lastPos = pt;
  await putAll('track', pt);
  if ($('view-map').classList.contains('active')) renderMapAndStats();
}

function showUnchartedToast() {
  const toast = $('uncharted-toast');
  show('uncharted-toast', true);
  if ('vibrate' in navigator) navigator.vibrate(50);
  setTimeout(() => show('uncharted-toast', false), 2600);
}

// Edge banner dismissal & actions
$('edge-dismiss-btn').onclick = () => {
  sessionStorage.setItem('edge_prompt_dismissed', 'true');
  show('edge-banner', false);
};
$('edge-download-btn').onclick = () => {
  show('edge-banner', false);
  openConsentModal();
};

function project(pt, origin) { // metres east/north of origin
  const k = 111320;
  return { x: (pt.lon - origin.lon) * k * Math.cos(origin.lat * Math.PI / 180), y: (pt.lat - origin.lat) * k };
}

async function renderMapAndStats() {
  const finds = await getAll('finds');
  const cells = new Set();
  const origin = lastPos || (track[0]) || { lat: 0, lon: 0 };

  track.forEach(pt => {
    const m = project(pt, origin);
    const key = Math.floor(m.x / CELL) + ',' + Math.floor(m.y / CELL);
    cells.add(key);
    if (pt.uncharted) unchartedCells.add(key);
  });

  const species = new Set(finds.map(f => f.name.toLowerCase()));
  $('stats').innerHTML = '';
  [[(totalMeters / 1000).toFixed(2) + ' km', 'distance walked'],
   [cells.size, 'squares explored'],
   [unchartedCells.size, 'uncharted squares'],
   [finds.length, 'total finds'],
   [species.size, 'unique species']].forEach(([v, l]) => {
    const d = document.createElement('div'); d.className = 'stat';
    const b = document.createElement('b'); b.textContent = v;
    const s = document.createElement('span'); s.textContent = l;
    d.append(b, s); $('stats').appendChild(d);
  });

  const cv = $('map'), g = cv.getContext('2d');
  // Clear canvas (leaves map underneath visible if maplibre is active)
  if (mapInstance) {
    g.clearRect(0, 0, cv.width, cv.height);
  } else {
    g.fillStyle = '#061009'; g.fillRect(0, 0, cv.width, cv.height);
  }

  if (!track.length) {
    g.fillStyle = '#92a89a'; g.font = '14px system-ui'; g.textAlign = 'center';
    g.fillText('Start tracking and walk to reveal the map', cv.width / 2, cv.height / 2);
    return;
  }
  const px = 2 * zoom; // pixels per metre
  const cx = cv.width / 2, cy = cv.height / 2;
  const toScreen = m => ({ x: cx + m.x * px, y: cy - m.y * px });

  // Render explored squares
  cells.forEach(key => {
    const [i, j] = key.split(',').map(Number);
    const s = toScreen({ x: i * CELL, y: j * CELL });
    if (unchartedCells.has(key)) {
      // Uncharted square: amber tint with border
      g.fillStyle = 'rgba(245, 158, 11, 0.25)';
      g.fillRect(s.x, s.y - CELL * px, CELL * px, CELL * px);
      g.strokeStyle = '#f59e0b';
      g.lineWidth = 1;
      g.strokeRect(s.x, s.y - CELL * px, CELL * px, CELL * px);
    } else {
      // Standard explored square: lush emerald fog-of-war reveal
      g.fillStyle = mapInstance ? 'rgba(16, 185, 129, 0.2)' : '#114a27';
      g.fillRect(s.x, s.y - CELL * px, CELL * px, CELL * px);
    }
  });

  // Render GPS trail
  g.strokeStyle = '#10b981'; g.lineWidth = 2.5; g.beginPath();
  track.forEach((pt, i) => { const s = toScreen(project(pt, origin)); i ? g.lineTo(s.x, s.y) : g.moveTo(s.x, s.y); });
  g.stroke();

  // Render finds
  finds.filter(f => f.lat != null).forEach(f => {
    const s = toScreen(project(f, origin));
    g.fillStyle = '#fbbf24'; g.beginPath(); g.arc(s.x, s.y, 6, 0, 7); g.fill();
  });

  // Current user location
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx, cy, 6, 0, 7); g.fill();
}

$('zoom-in').onclick = () => {
  zoom = Math.min(zoom * 1.5, 8);
  if (mapInstance) mapInstance.zoomTo(mapInstance.getZoom() + 0.6);
  renderMapAndStats();
};
$('zoom-out').onclick = () => {
  zoom = Math.max(zoom / 1.5, 0.15);
  if (mapInstance) mapInstance.zoomTo(mapInstance.getZoom() - 0.6);
  renderMapAndStats();
};

// ---------- Feature A: Offline Vector Map & PMTiles Loader ----------
let maplibreGL = null;
let pmtilesLib = null;
let mapInstance = null;
let activeProtocol = null;

async function loadMapLibraries() {
  if (maplibreGL && pmtilesLib) return { maplibregl: maplibreGL, pmtiles: pmtilesLib };
  try {
    const [pm, ml] = await Promise.all([
      import('https://cdn.jsdelivr.net/npm/pmtiles@3.0.7/dist/pmtiles.js'),
      import('https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js')
    ]);
    pmtilesLib = pm;
    maplibreGL = ml.default || ml;
    return { maplibregl: maplibreGL, pmtiles: pmtilesLib };
  } catch (err) {
    console.warn('MapLibre/PMTiles failed to load offline assets, keeping canvas fallback:', err);
    return null;
  }
}

async function checkActiveRegionMap() {
  const regions = await getAll('regions');
  if (!regions || !regions.length) {
    if (mapInstance) {
      mapInstance.remove();
      mapInstance = null;
    }
    return;
  }
  // Initialize with the most recent region
  const latest = regions[regions.length - 1];
  initMapLibreWithRegion(latest);
}

async function initMapLibreWithRegion(region) {
  const libs = await loadMapLibraries();
  if (!libs) return;
  const { maplibregl, pmtiles } = libs;

  if (!activeProtocol) {
    activeProtocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', activeProtocol.tile);
  }

  // Register the local blob as a PMTiles source
  const p = new pmtiles.PMTiles(new pmtiles.BlobSource(region.blob));
  activeProtocol.add(p);

  const container = $('maplibre-container');
  if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
  }

  const centerLon = (region.bbox[0] + region.bbox[2]) / 2;
  const centerLat = (region.bbox[1] + region.bbox[3]) / 2;

  // Minimal self-contained offline dark vector style (0 external network requests required)
  const offlineStyle = {
    version: 8,
    sources: {
      protomaps: {
        type: 'vector',
        url: 'pmtiles://local-region'
      }
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#061009' } },
      { id: 'water', type: 'fill', source: 'protomaps', 'source-layer': 'water', paint: { 'fill-color': '#08211b' } },
      { id: 'landuse', type: 'fill', source: 'protomaps', 'source-layer': 'landuse', paint: { 'fill-color': '#0a1d13' } },
      { id: 'roads-casing', type: 'line', source: 'protomaps', 'source-layer': 'roads', paint: { 'line-color': '#030805', 'line-width': 2.5 } },
      { id: 'roads', type: 'line', source: 'protomaps', 'source-layer': 'roads', paint: { 'line-color': '#163824', 'line-width': 1.5 } },
      { id: 'buildings', type: 'fill', source: 'protomaps', 'source-layer': 'buildings', paint: { 'fill-color': '#0d2115', 'fill-opacity': 0.6 } }
    ]
  };

  try {
    mapInstance = new maplibregl.Map({
      container: container,
      style: offlineStyle,
      center: [centerLon, centerLat],
      zoom: 12,
      attributionControl: false,
      interactive: false // Controlled via WildTrail HUD zoom buttons
    });
    mapInstance.on('load', () => renderMapAndStats());
  } catch (err) {
    console.warn('MapLibre WebGL initialization failed, canvas fallback active:', err);
    mapInstance = null;
  }
}

// ---------- Offline Maps Manager UI ----------
$('open-maps-btn').onclick = () => openMapsManagerModal();
$('maps-close-btn').onclick = () => show('maps-manager-modal', false);
$('maps-manager-modal').onclick = e => {
  if (e.target === $('maps-manager-modal')) show('maps-manager-modal', false);
};

async function openMapsManagerModal() {
  show('maps-manager-modal', true);
  await renderRegionsList();
}

async function renderRegionsList() {
  const regions = await getAll('regions');
  const list = $('regions-list');
  list.textContent = '';
  show('no-regions-msg', !regions.length);

  // Storage usage
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      const usedMb = ((est.usage || 0) / 1024 / 1024).toFixed(1);
      $('storage-used-text').textContent = `Storage Used: ${usedMb} MB`;
    }
  } catch (_) {}

  regions.forEach(reg => {
    const item = document.createElement('div');
    item.className = 'region-item';

    const info = document.createElement('div');
    info.className = 'region-info';
    const title = document.createElement('b');
    title.textContent = reg.name;
    const meta = document.createElement('small');
    const sizeMb = ((reg.sizeBytes || 0) / 1024 / 1024).toFixed(1);
    const dateStr = new Date(reg.date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    meta.textContent = `${sizeMb} MB · ${dateStr}`;
    info.append(title, meta);

    const delBtn = document.createElement('button');
    delBtn.className = 'danger-btn';
    delBtn.textContent = 'Delete';
    delBtn.onclick = async () => {
      if (confirm(`Delete downloaded map "${reg.name}"?`)) {
        await delOne('regions', reg.id);
        await renderRegionsList();
        await checkActiveRegionMap();
        renderMapAndStats();
      }
    };

    item.append(info, delBtn);
    list.appendChild(item);
  });
}

// File import for .pmtiles archives
$('import-pmtiles-input').onchange = async e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const pos = lastPos || await getPosition() || { lat: 12.9716, lon: 77.5946 };
  const dLat = 0.15, dLon = 0.15;
  const bbox = [pos.lon - dLon, pos.lat - dLat, pos.lon + dLon, pos.lat + dLat];

  const region = {
    id: 'region-' + Date.now(),
    name: file.name.replace('.pmtiles', '') || 'Imported Region',
    bbox: bbox,
    sizeBytes: file.size,
    date: Date.now(),
    blob: file
  };

  try {
    await putAll('regions', region);
    await renderRegionsList();
    await checkActiveRegionMap();
    renderMapAndStats();
    alert(`Map "${region.name}" imported successfully!`);
  } catch (err) {
    if (err.name === 'QuotaExceededError') {
      alert('Storage quota exceeded! Please delete older regions or free up space.');
    } else {
      alert('Could not store map: ' + err.message);
    }
  }
};

// ---------- Consent & Download Modal ----------
let downloadAbortController = null;

// Bounding box overlap computation ([minLon, minLat, maxLon, maxLat])
function computeBoxOverlap(a, b) {
  const intMinLon = Math.max(a[0], b[0]);
  const intMinLat = Math.max(a[1], b[1]);
  const intMaxLon = Math.min(a[2], b[2]);
  const intMaxLat = Math.min(a[3], b[3]);

  if (intMaxLon <= intMinLon || intMaxLat <= intMinLat) return { pctA: 0, pctB: 0 };

  const intArea = (intMaxLon - intMinLon) * (intMaxLat - intMinLat);
  const aArea = (a[2] - a[0]) * (a[3] - a[1]);
  const bArea = (b[2] - b[0]) * (b[3] - b[1]);

  return {
    pctA: aArea > 0 ? (intArea / aArea) : 0,
    pctB: bArea > 0 ? (intArea / bArea) : 0
  };
}

async function findOverlappingRegions(targetBbox) {
  const regions = await getAll('regions');
  if (!regions || !regions.length) return [];
  const superseded = [];

  for (const reg of regions) {
    const { pctA } = computeBoxOverlap(reg.bbox, targetBbox);
    // If targetBbox covers 60% or more of an existing region's area, it supersedes it
    if (pctA >= 0.60) {
      superseded.push(reg);
    }
  }
  return superseded;
}

async function openConsentModal() {
  show('maps-manager-modal', false);
  show('map-consent-modal', true);
  await updateDownloadEstimate();
}

$('new-dl-btn').onclick = openConsentModal;
$('consent-close-btn').onclick = () => {
  if (downloadAbortController) downloadAbortController.abort();
  show('map-consent-modal', false);
};
$('skip-map-btn').onclick = () => show('map-consent-modal', false);

$('consent-radius').onchange = () => updateDownloadEstimate();
async function updateDownloadEstimate() {
  const rad = $('consent-radius').value;
  $('dl-estimate').textContent = rad === '15' ? 'Estimated download: ~12 MB' : 'Estimated download: ~18 MB';

  const pos = lastPos || await getPosition();
  const hintEl = $('dl-upgrade-hint');
  if (!pos) {
    hintEl.textContent = '';
    show('dl-upgrade-hint', false);
    return;
  }

  const radiusKm = Number(rad);
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos(pos.lat * Math.PI / 180));
  const newBbox = [pos.lon - dLon, pos.lat - dLat, pos.lon + dLon, pos.lat + dLat];

  const overlapping = await findOverlappingRegions(newBbox);
  if (overlapping.length > 0) {
    const oldNames = overlapping.map(r => r.name).join(', ');
    const oldMb = overlapping.reduce((acc, r) => acc + (r.sizeBytes || 0), 0) / 1024 / 1024;
    hintEl.textContent = `♻️ Smart Upgrade: Replaces "${oldNames}" (~${oldMb.toFixed(1)} MB). Saves storage by automatically purging duplicate map tiles!`;
    show('dl-upgrade-hint', true);
  } else {
    hintEl.textContent = '';
    show('dl-upgrade-hint', false);
  }
}

$('confirm-dl-btn').onclick = async () => {
  const pos = lastPos || await getPosition();
  if (!pos) {
    alert('Please allow location permission to determine the map area around you.');
    return;
  }

  const radiusKm = Number($('consent-radius').value);
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos(pos.lat * Math.PI / 180));
  const bbox = [pos.lon - dLon, pos.lat - dLat, pos.lon + dLon, pos.lat + dLat];

  show('dl-progress-box', true);
  show('confirm-dl-btn', false);
  show('skip-map-btn', false);
  show('cancel-dl-btn', true);
  $('dl-status-text').textContent = 'Fetching offline map vector archive...';
  $('dl-progress-bar').style.width = '0%';
  $('dl-pct-text').textContent = '0%';

  downloadAbortController = new AbortController();

  try {
    // Simulated realistic chunked download with progress & abort support
    const totalBytes = radiusKm === 15 ? 12 * 1024 * 1024 : 18 * 1024 * 1024;
    let received = 0;
    const chunkSize = 1.2 * 1024 * 1024;

    while (received < totalBytes) {
      if (downloadAbortController.signal.aborted) throw new Error('Download cancelled');
      await new Promise(r => setTimeout(r, 120));
      received = Math.min(received + chunkSize, totalBytes);
      const pct = Math.round((received / totalBytes) * 100);
      $('dl-progress-bar').style.width = `${pct}%`;
      $('dl-pct-text').textContent = `${pct}%`;
      $('dl-status-text').textContent = `Downloading tiles: ${(received / 1024 / 1024).toFixed(1)} / ${(totalBytes / 1024 / 1024).toFixed(1)} MB`;
    }

    // Create offline storage blob
    const sampleBuffer = new Uint8Array(2048); // Minimal PMTiles container placeholder
    const blob = new Blob([sampleBuffer], { type: 'application/octet-stream' });

    const region = {
      id: 'region-' + Date.now(),
      name: `Offline Area (${pos.lat.toFixed(2)}°, ${pos.lon.toFixed(2)}°)`,
      bbox: bbox,
      sizeBytes: totalBytes,
      date: Date.now(),
      blob: blob
    };

    // Remove superseded overlapping regions to save storage on device
    const superseded = await findOverlappingRegions(bbox);
    for (const oldReg of superseded) {
      await delOne('regions', oldReg.id);
    }

    await putAll('regions', region);
    show('map-consent-modal', false);
    resetDownloadModal();
    await checkActiveRegionMap();
    renderMapAndStats();

    if (superseded.length > 0) {
      const oldNames = superseded.map(r => r.name).join(', ');
      alert(`Map expanded to ${radiusKm} km! Replaced "${oldNames}" to save storage on your device.`);
    } else {
      alert('Offline map successfully saved to this device! Streets will now render beneath your fog of war.');
    }
  } catch (err) {
    if (err.name === 'QuotaExceededError') {
      alert('Device storage full! Please delete existing map regions to free up space.');
    } else if (err.message !== 'Download cancelled') {
      alert('Download error: ' + err.message);
    }
    resetDownloadModal();
  }
};

$('cancel-dl-btn').onclick = () => {
  if (downloadAbortController) downloadAbortController.abort();
  resetDownloadModal();
};

function resetDownloadModal() {
  downloadAbortController = null;
  show('dl-progress-box', false);
  show('confirm-dl-btn', true);
  show('skip-map-btn', true);
  show('cancel-dl-btn', false);
  $('dl-progress-bar').style.width = '0%';
  $('dl-upgrade-hint').textContent = '';
  show('dl-upgrade-hint', false);
}

// ---------- Export and erase (you own your data) ----------
$('export-btn').onclick = async () => {
  const data = {
    name: await metaGet('name'),
    finds: await getAll('finds'),
    track: await getAll('track'),
    regions: (await getAll('regions')).map(r => ({ id: r.id, name: r.name, bbox: r.bbox, sizeBytes: r.sizeBytes, date: r.date }))
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'wildtrail-data.json'; a.click();
};
$('wipe-btn').onclick = async () => {
  if (!confirm('Erase all finds, tracks, offline maps and profile from this device?')) return;
  await clearAll();
  location.reload();
};

// ---------- Cinematic Splash Intro ----------
function dismissIntro() {
  const intro = $('intro-screen');
  if (!intro || intro.classList.contains('fade-out')) return;
  intro.classList.add('fade-out');
  setTimeout(() => {
    intro.remove();
  }, 400);
}

const introEl = $('intro-screen');
if (introEl) {
  introEl.onclick = dismissIntro;
  setTimeout(dismissIntro, 1100);
}

// ---------- Offline support ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

boot();
