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

// ---------- Tiny IndexedDB wrapper ----------
const DB_NAME = 'wildtrail';
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('finds', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('track', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('meta');
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
const putAll = (s, v) => tx(s, 'readwrite', o => o.add(v));
const getAll = s => tx(s, 'readonly', o => o.getAll());
const metaGet = k => tx('meta', 'readonly', o => o.get(k));
const metaSet = (k, v) => tx('meta', 'readwrite', o => o.put(v, k));
const clearAll = async () => { for (const s of ['finds', 'track', 'meta']) await tx(s, 'readwrite', o => o.clear()); };

// ---------- DOM helpers ----------
const $ = id => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);

// ---------- Navigation ----------
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === name));
  $('nav').classList.toggle('hidden', name === 'welcome');
  if (name === 'collection') renderCollection();
  if (name === 'map') renderMapAndStats();
}
document.querySelectorAll('#nav button').forEach(b => b.onclick = () => showView(b.dataset.v));

// ---------- Profile (local only, no login server) ----------
async function updateTrainerChip() {
  const name = await metaGet('name');
  if (!name) return;
  const allFinds = await getAll('finds');
  $('who').innerHTML = `<span>🌿</span> ${name} · ${allFinds.length}`;
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
    b.innerHTML = `<span>${g.label}</span><span class="score-badge">${pct}%</span>`;
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
      await tx('finds', 'readwrite', o => o.delete(find.id));
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

// ---------- Location, distance and map ----------
let lastPos = null;
let track = [];       // {lat, lon, t}
let watchId = null;
let totalMeters = 0;
const CELL = 20;      // metres per explored square
let zoom = 1;

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
async function onPos(p) {
  if (p.coords.accuracy > 50) return; // too fuzzy to trust
  const pt = { lat: p.coords.latitude, lon: p.coords.longitude, t: Date.now() };
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
    cells.add(Math.floor(m.x / CELL) + ',' + Math.floor(m.y / CELL));
  });
  const species = new Set(finds.map(f => f.name.toLowerCase()));
  $('stats').innerHTML = '';
  [[(totalMeters / 1000).toFixed(2) + ' km', 'distance walked'],
   [cells.size, 'squares explored'],
   [finds.length, 'total finds'],
   [species.size, 'unique species']].forEach(([v, l]) => {
    const d = document.createElement('div'); d.className = 'stat';
    const b = document.createElement('b'); b.textContent = v;
    const s = document.createElement('span'); s.textContent = l;
    d.append(b, s); $('stats').appendChild(d);
  });

  const cv = $('map'), g = cv.getContext('2d');
  g.fillStyle = '#06110a'; g.fillRect(0, 0, cv.width, cv.height);
  if (!track.length) {
    g.fillStyle = '#8ea896'; g.font = '14px system-ui'; g.textAlign = 'center';
    g.fillText('Start tracking and walk to reveal the map', cv.width / 2, cv.height / 2);
    return;
  }
  const px = 2 * zoom; // pixels per metre
  const cx = cv.width / 2, cy = cv.height / 2;
  const toScreen = m => ({ x: cx + m.x * px, y: cy - m.y * px });
  g.fillStyle = '#1e5e33';
  cells.forEach(key => {
    const [i, j] = key.split(',').map(Number);
    const s = toScreen({ x: i * CELL, y: j * CELL });
    g.fillRect(s.x, s.y - CELL * px, CELL * px, CELL * px);
  });
  g.strokeStyle = '#4ade80'; g.lineWidth = 2.5; g.beginPath();
  track.forEach((pt, i) => { const s = toScreen(project(pt, origin)); i ? g.lineTo(s.x, s.y) : g.moveTo(s.x, s.y); });
  g.stroke();
  finds.filter(f => f.lat != null).forEach(f => {
    const s = toScreen(project(f, origin));
    g.fillStyle = '#fbbf24'; g.beginPath(); g.arc(s.x, s.y, 6, 0, 7); g.fill();
  });
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx, cy, 6, 0, 7); g.fill();
}
$('zoom-in').onclick = () => { zoom = Math.min(zoom * 1.5, 8); renderMapAndStats(); };
$('zoom-out').onclick = () => { zoom = Math.max(zoom / 1.5, 0.15); renderMapAndStats(); };

// ---------- Export and erase (you own your data) ----------
$('export-btn').onclick = async () => {
  const data = { name: await metaGet('name'), finds: await getAll('finds'), track: await getAll('track') };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'wildtrail-data.json'; a.click();
};
$('wipe-btn').onclick = async () => {
  if (!confirm('Erase all finds, tracks and your profile from this device?')) return;
  await clearAll();
  location.reload();
};

// ---------- Offline support ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

boot();
