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
async function boot() {
  const name = await metaGet('name');
  if (!name) { showView('welcome'); return; }
  $('who').textContent = name;
  showView('capture');
  loadTrack();
}
$('start-btn').onclick = async () => {
  const name = $('name-input').value.trim() || 'Explorer';
  await metaSet('name', name);
  $('who').textContent = name;
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
    $('cam-btn').textContent = 'Stop camera';
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
  $('cam-btn').textContent = 'Start camera';
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
    b.textContent = `${g.label} (${Math.round(g.score * 100)}%)`;
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
  const pos = lastPos || await getPosition();
  await putAll('finds', {
    name, type: $('type-field').value, photo: pending.photo, time: Date.now(),
    lat: pos ? pos.lat : null, lon: pos ? pos.lon : null,
    guessed: pending.guesses[0] ? pending.guesses[0].label : null,
  });
  pending = null;
  show('result', false);
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
  const finds = (await getAll('finds')).reverse().filter(f => filter === 'all' || f.type === filter);
  const grid = $('grid');
  grid.textContent = '';
  show('empty-msg', finds.length === 0);
  finds.forEach(f => {
    const t = document.createElement('div');
    t.className = 'tile';
    const img = document.createElement('img');
    img.src = f.photo; img.alt = f.name;
    const info = document.createElement('div');
    const n = document.createElement('b'); n.textContent = f.name;
    const s = document.createElement('small');
    s.textContent = f.type + ' · ' + new Date(f.time).toLocaleDateString();
    info.append(n, s);
    t.append(img, info);
    grid.appendChild(t);
  });
}

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
    $('track-btn').textContent = 'Start tracking';
    return;
  }
  if (!navigator.geolocation) { alert('Location is not available on this device.'); return; }
  watchId = navigator.geolocation.watchPosition(onPos, e => alert('Location error: ' + e.message),
    { enableHighAccuracy: true, maximumAge: 2000 });
  $('track-btn').textContent = 'Stop tracking';
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
   [finds.length, 'finds'],
   [species.size, 'different species']].forEach(([v, l]) => {
    const d = document.createElement('div'); d.className = 'stat';
    const b = document.createElement('b'); b.textContent = v;
    const s = document.createElement('span'); s.textContent = l;
    d.append(b, s); $('stats').appendChild(d);
  });

  const cv = $('map'), g = cv.getContext('2d');
  g.fillStyle = '#08120c'; g.fillRect(0, 0, cv.width, cv.height);
  if (!track.length) {
    g.fillStyle = '#98b8a2'; g.font = '14px system-ui'; g.textAlign = 'center';
    g.fillText('Start tracking and walk to reveal the map', cv.width / 2, cv.height / 2);
    return;
  }
  const px = 2 * zoom; // pixels per metre
  const cx = cv.width / 2, cy = cv.height / 2;
  const toScreen = m => ({ x: cx + m.x * px, y: cy - m.y * px });
  g.fillStyle = '#2f7a45';
  cells.forEach(key => {
    const [i, j] = key.split(',').map(Number);
    const s = toScreen({ x: i * CELL, y: j * CELL });
    g.fillRect(s.x, s.y - CELL * px, CELL * px, CELL * px);
  });
  g.strokeStyle = '#7bd88f'; g.lineWidth = 2; g.beginPath();
  track.forEach((pt, i) => { const s = toScreen(project(pt, origin)); i ? g.lineTo(s.x, s.y) : g.moveTo(s.x, s.y); });
  g.stroke();
  finds.filter(f => f.lat != null).forEach(f => {
    const s = toScreen(project(f, origin));
    g.fillStyle = '#ffd54f'; g.beginPath(); g.arc(s.x, s.y, 5, 0, 7); g.fill();
  });
  g.fillStyle = '#fff'; g.beginPath(); g.arc(cx, cy, 5, 0, 7); g.fill();
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
