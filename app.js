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
  ['penguin', 'bird'], ['razorbill', 'bird'],
  // animals
  ['tiger', 'animal'], ['leopard', 'animal'], ['lion', 'animal'], ['bear', 'animal'],
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
  ['monarch butterfly', 'insect'], ['swallowtail butterfly', 'insect'],
  ['painted lady butterfly', 'insect'], ['common blue butterfly', 'insect'],
  // flowers and plants
  ['rose', 'flower'], ['hibiscus', 'flower'], ['marigold', 'flower'], ['jasmine', 'flower'],
  ['lotus', 'flower'], ['sunflower', 'flower'], ['bougainvillea', 'flower'],
  ['frangipani', 'flower'], ['daisy', 'flower'], ['orchid', 'flower'], ['tulip', 'flower'],
  ['lily', 'flower'], ['dandelion', 'flower'], ['lavender', 'flower'], ['cosmos flower', 'flower'],
  ['gulmohar flower', 'flower'], ['morning glory', 'flower'], ['zinnia', 'flower'],
  ['lantana', 'flower'], ['leaf', 'flower'], ['mushroom', 'flower'],
  ['euphorbia milii', 'flower'], ['ghost orchid', 'flower'], ['common dandelion', 'flower'],
  ['chicory flower', 'flower'], ['common poppy', 'flower'], ['wild sunflower', 'flower'],
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
const HIGH_CONTRAST_KEY = 'wildtrail_high_contrast';
const THEME_COLOR_DEFAULT = '#070e0a';
const THEME_COLOR_HIGH_CONTRAST = '#102819';

function applyHighContrast(enabled) {
  document.body.classList.toggle('high-contrast', enabled);
  const btn = $('contrast-toggle');
  if (btn) btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.setAttribute('content', enabled ? THEME_COLOR_HIGH_CONTRAST : THEME_COLOR_DEFAULT);
}

function initHighContrastToggle() {
  let enabled = false;
  try {
    enabled = localStorage.getItem(HIGH_CONTRAST_KEY) === '1';
  } catch (_) {}
  applyHighContrast(enabled);

  const btn = $('contrast-toggle');
  if (!btn) return;
  btn.onclick = () => {
    const next = !document.body.classList.contains('high-contrast');
    applyHighContrast(next);
    try {
      localStorage.setItem(HIGH_CONTRAST_KEY, next ? '1' : '0');
    } catch (_) {}
  };
}

// ---------- Navigation ----------
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === name));
  $('nav').classList.toggle('hidden', name === 'welcome');
  if (name === 'collection') renderCollection();
  if (name === 'map') {
    requestCompassPermission();
    if (mapInstance) {
      mapInstance.resize();
      mapInstance.setBearing(mapBearingDeg);
      if (lastPos && panX === 0 && panY === 0) {
        mapInstance.panTo([lastPos.lon, lastPos.lat], { duration: 0 });
      }
    }
    renderMapAndStats();
    checkActiveRegionMap();
    startMapAnim();
  } else {
    stopMapAnim();
  }
}
document.querySelectorAll('#nav button').forEach(b => b.onclick = () => showView(b.dataset.v));

window.addEventListener('resize', () => {
  if (mapInstance) mapInstance.resize();
  if ($('view-map').classList.contains('active')) renderMapAndStats();
});

// ---------- Profile (local only, no login server) ----------
async function updateTrainerChip() {
  const name = await metaGet('name');
  if (!name) return;
  const allFinds = await getAll('finds');
  $('who').textContent = `🌿 ${name} · ${allFinds.length}`;
}

async function boot() {
  initHighContrastToggle();
  initCompass();
  initMapInteractions();
  init3DCardPhysics();
  initCameraControls();
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

// ---------- Vintage Mechanical Field Audio Engine ----------
let audioCtx = null;
let shutterAudio = null;
let shutterAudioBuffer = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

async function loadShutterAudioBuffer() {
  if (shutterAudioBuffer) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const res = await fetch('shutter.wav');
    if (!res.ok) return;
    const arrayBuffer = await res.arrayBuffer();
    shutterAudioBuffer = await ctx.decodeAudioData(arrayBuffer);
  } catch (_) {}
}

function warmUpAudio() {
  if (!shutterAudio) {
    shutterAudio = $('shutter-audio') || new Audio('shutter.wav');
    try {
      shutterAudio.volume = 1.0;
      shutterAudio.preload = 'auto';
      shutterAudio.load();
    } catch (_) {}
  }
  const ctx = getAudioContext();
  if (ctx) {
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    if (!shutterAudioBuffer) {
      loadShutterAudioBuffer().catch(() => {});
    }
  }
}

// Warm up audio on first user touch anywhere to bypass mobile browser silent policies
window.addEventListener('pointerdown', warmUpAudio, { once: true });
window.addEventListener('touchstart', warmUpAudio, { once: true });
window.addEventListener('click', warmUpAudio, { once: true });

// Preload audio buffer in background
setTimeout(() => {
  loadShutterAudioBuffer().catch(() => {});
}, 300);

function playShutterSound() {
  warmUpAudio();

  let played = false;

  // 1. Web Audio API (instant 0-latency playback with AudioBufferSourceNode)
  try {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'running' && shutterAudioBuffer) {
      const source = ctx.createBufferSource();
      source.buffer = shutterAudioBuffer;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(1.0, ctx.currentTime);
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start(0);
      played = true;
    }
  } catch (_) {}

  // 2. HTML5 Audio element fallback (instant mechanical click)
  if (!played) {
    try {
      if (!shutterAudio) {
        shutterAudio = $('shutter-audio') || new Audio('shutter.wav');
      }
      if (shutterAudio) {
        shutterAudio.currentTime = 0;
        const p = shutterAudio.play();
        if (p && p.catch) p.catch(() => {});
      }
    } catch (_) {}
  }
}

function playDiscoveryChime() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const start = t + i * 0.08;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.12, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.36);
    });
  } catch (_) {}
}

// ---------- Camera (Sharp Autofocus + Hardware Front/Back Switching) ----------
let stream = null;
let currentVideoTrack = null;
let currentFacingMode = 'environment'; // 'environment' (back) or 'user' (front)
let currentCameraDeviceId = null;
let availableCameras = [];
let isCameraStarting = false;
let isCameraSwitching = false;
let isTorchOn = false;
let currentCameraZoom = 1.0;
let focusReticleTimer = null;
let isCameraPinching = false;
let touchStartPinchDist = 0;
let touchStartCameraZoom = 1.0;
let lastPinchTime = 0;

// Gesture-Attached Zoom Variables
let isSlidingZoom = false;
let zoomStartX = 0;
let zoomStartLevel = 1.0;
let zoomTotalMoved = 0;
let lastHapticStep = 1.0;

function applyVideoTransform() {
  const v = $('video');
  if (!v) return;

  if (currentCameraZoom === 1.0) {
    v.style.transform = 'none';
  } else {
    v.style.transform = `scale(${currentCameraZoom})`;
    v.style.transformOrigin = 'center center';
  }
}

async function applyContinuousAutofocus(track) {
  if (!track || typeof track.applyConstraints !== 'function') return;
  try {
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    const settings = track.getSettings ? track.getSettings() : {};

    // Check if hardware/browser supports focusMode and has continuous autofocus
    if (caps.focusMode && Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
      if (settings.focusMode !== 'continuous') {
        await track.applyConstraints({
          advanced: [{ focusMode: 'continuous' }]
        });
      }
    }
  } catch (err) {
    // If autofocus constraint fails or is unsupported, retain device's native default focus behavior
    console.warn('Continuous autofocus constraint skipped gracefully:', err);
  }
}

function setCameraZoom(z) {
  // Always strictly clamped between 1.0x and 5.0x so video ALWAYS fills viewfinder (zero black bars!)
  const clamped = Math.min(5.0, Math.max(1.0, Math.round(z * 100) / 100));
  currentCameraZoom = clamped;

  applyVideoTransform();

  if ($('zoom-badge-val')) {
    $('zoom-badge-val').textContent = clamped.toFixed(1) + 'x';
  }
  if ($('zoom-badge-btn')) {
    $('zoom-badge-btn').classList.toggle('zoomed', clamped > 1.05);
  }

  // Try applying hardware optical/digital zoom if camera sensor supports it
  if (currentVideoTrack) {
    const caps = currentVideoTrack.getCapabilities ? currentVideoTrack.getCapabilities() : {};
    if (caps && caps.zoom) {
      try {
        const hwZ = Math.max(caps.zoom.min, Math.min(caps.zoom.max, clamped));
        currentVideoTrack.applyConstraints({ advanced: [{ zoom: hwZ }] }).catch(() => {});
      } catch (_) {}
    }
  }
}

function initCameraControls() {
  const v = $('video');
  const camBox = document.querySelector('.camera');
  if (!v || v._cameraControlsInit) return;
  v._cameraControlsInit = true;

  // 1. Botanical Emerald & Gold Tap-to-Focus Reticle
  v.addEventListener('click', async e => {
    if (!stream) return;
    // Prevent focus trigger if user was just pinching, sliding zoom, or clicking controls
    if (Date.now() - lastPinchTime < 350 || isSlidingZoom) return;
    if (e.target.closest('#camera-zoom-container') || e.target.closest('.viewfinder-top-bar')) return;

    const rect = v.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const reticle = $('focus-reticle');
    if (reticle) {
      reticle.style.left = `${x}px`;
      reticle.style.top = `${y}px`;
      reticle.classList.remove('hidden', 'fade-out');

      if ('vibrate' in navigator) navigator.vibrate(15);

      if (currentVideoTrack) {
        try {
          const caps = currentVideoTrack.getCapabilities ? currentVideoTrack.getCapabilities() : {};
          const advanced = [];

          const normX = Math.max(0, Math.min(1, x / rect.width));
          const normY = Math.max(0, Math.min(1, y / rect.height));

          if (caps.pointsOfInterest) {
            advanced.push({ pointsOfInterest: [{ x: normX, y: normY }] });
          }

          if (caps.focusMode && Array.isArray(caps.focusMode)) {
            if (caps.focusMode.includes('single-shot')) {
              advanced.push({ focusMode: 'single-shot' });
            } else if (caps.focusMode.includes('continuous')) {
              advanced.push({ focusMode: 'continuous' });
            }
          }

          if (advanced.length > 0) {
            await currentVideoTrack.applyConstraints({ advanced });
          }
        } catch (_) {}
      }

      clearTimeout(focusReticleTimer);
      focusReticleTimer = setTimeout(() => {
        reticle.classList.add('fade-out');
        setTimeout(() => reticle.classList.add('hidden'), 400);

        // Resume continuous autofocus after tap-to-focus settle
        if (currentVideoTrack) {
          applyContinuousAutofocus(currentVideoTrack).catch(() => {});
        }
      }, 1800);
    }
  });

  // 2. Laptop & Desktop Mouse Wheel / Trackpad Scroller & Pinch Zoom
  if (camBox) {
    camBox.addEventListener('wheel', e => {
      if (!stream) return;
      e.preventDefault();
      lastPinchTime = Date.now();
      let delta = 0;
      if (e.ctrlKey) {
        // macOS & Windows trackpad 2-finger pinch (Ctrl+Wheel)
        delta = -e.deltaY * 0.02;
      } else {
        // Physical mouse scroll wheel or 2-finger trackpad vertical scroll
        delta = e.deltaY < 0 ? 0.2 : -0.2;
      }
      setCameraZoom(currentCameraZoom + delta);
      if ('vibrate' in navigator) navigator.vibrate(10);
    }, { passive: false });

    // Apple Safari trackpad 2-finger pinch gesture events
    let trackpadStartZoom = 1.0;
    camBox.addEventListener('gesturestart', e => {
      if (!stream) return;
      e.preventDefault();
      lastPinchTime = Date.now();
      trackpadStartZoom = currentCameraZoom;
    }, { passive: false });

    camBox.addEventListener('gesturechange', e => {
      if (!stream) return;
      e.preventDefault();
      lastPinchTime = Date.now();
      setCameraZoom(trackpadStartZoom * e.scale);
    }, { passive: false });

    camBox.addEventListener('gestureend', e => {
      if (!stream) return;
      e.preventDefault();
      lastPinchTime = Date.now();
    }, { passive: false });

    // 3. Mobile Two-Finger Pinch-to-Zoom
    camBox.addEventListener('touchstart', e => {
      if (e.touches.length === 2) {
        e.preventDefault();
        isCameraPinching = true;
        lastPinchTime = Date.now();
        touchStartPinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        touchStartCameraZoom = currentCameraZoom;
      }
    }, { passive: false });

    camBox.addEventListener('touchmove', e => {
      if (isCameraPinching && e.touches.length === 2) {
        e.preventDefault();
        lastPinchTime = Date.now();
        const currentDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        if (touchStartPinchDist > 8) {
          const factor = currentDist / touchStartPinchDist;
          setCameraZoom(touchStartCameraZoom * factor);
        }
      }
    }, { passive: false });

    camBox.addEventListener('touchend', e => {
      if (e.touches.length < 2) {
        isCameraPinching = false;
      }
    });
  }

  // 4. Modern Finger-Attached Slide Left/Right Zoom Controller
  const zoomTrack = $('zoom-gesture-track');
  if (zoomTrack) {
    const onStart = e => {
      isSlidingZoom = true;
      lastPinchTime = Date.now();
      const pt = e.touches ? e.touches[0] : e;
      zoomStartX = pt.clientX;
      zoomStartLevel = currentCameraZoom;
      zoomTotalMoved = 0;
      lastHapticStep = Math.round(currentCameraZoom * 2) / 2;
      zoomTrack.classList.add('is-sliding');
      warmUpAudio();
    };

    const onMove = e => {
      if (!isSlidingZoom) return;
      lastPinchTime = Date.now();
      const pt = e.touches ? e.touches[0] : e;
      const deltaX = pt.clientX - zoomStartX;
      zoomTotalMoved = Math.abs(deltaX);

      // Moving right increases zoom, moving left decreases zoom (~42px per 1.0x change)
      const targetZoom = zoomStartLevel + (deltaX / 42);
      setCameraZoom(targetZoom);

      // Subtle haptic tick when crossing 0.5x thresholds
      const currentStep = Math.round(currentCameraZoom * 2) / 2;
      if (currentStep !== lastHapticStep) {
        lastHapticStep = currentStep;
        if ('vibrate' in navigator) navigator.vibrate(8);
      }
    };

    const onEnd = e => {
      if (!isSlidingZoom) return;
      isSlidingZoom = false;
      lastPinchTime = Date.now();
      zoomTrack.classList.remove('is-sliding');

      // If finger moved less than 6px, treat as a quick tap to toggle 1.0x <-> 2.0x
      if (zoomTotalMoved < 6) {
        if ('vibrate' in navigator) navigator.vibrate(15);
        if (currentCameraZoom > 1.1) {
          setCameraZoom(1.0);
        } else {
          setCameraZoom(2.0);
        }
      }
    };

    // Touch events for mobile phones
    zoomTrack.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', e => {
      if (isSlidingZoom) onMove(e);
    }, { passive: true });
    window.addEventListener('touchend', e => {
      if (isSlidingZoom) onEnd(e);
    });

    // Pointer/Mouse events for desktop
    zoomTrack.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse') {
        onStart(e);
        zoomTrack.setPointerCapture?.(e.pointerId);
      }
    });
    zoomTrack.addEventListener('pointermove', e => {
      if (e.pointerType === 'mouse' && isSlidingZoom) onMove(e);
    });
    zoomTrack.addEventListener('pointerup', e => {
      if (e.pointerType === 'mouse' && isSlidingZoom) {
        try { zoomTrack.releasePointerCapture?.(e.pointerId); } catch (_) {}
        onEnd(e);
      }
    });
  }

  // 7. Hardware Camera Switch (Front <-> Back)
  if ($('flip-cam-btn')) {
    $('flip-cam-btn').onclick = async e => {
      e.stopPropagation();
      await switchCamera();
    };
  }

  // 8. Hardware Torch / Flashlight Toggle
  if ($('torch-btn')) {
    $('torch-btn').onclick = async e => {
      e.stopPropagation();
      if (!currentVideoTrack) return;
      try {
        isTorchOn = !isTorchOn;
        await currentVideoTrack.applyConstraints({ advanced: [{ torch: isTorchOn }] });
        $('torch-btn').classList.toggle('active', isTorchOn);
        if ('vibrate' in navigator) navigator.vibrate(20);
      } catch (err) {
        console.warn('Torch toggle not supported:', err);
      }
    };
  }

  // 9. Native 48MP iPhone Camera File Picker Ingestion
  if ($('native-cam-input')) {
    $('native-cam-input').onchange = async e => {
      const file = e.target.files?.[0];
      if (!file) return;

      playShutterSound();
      if ('vibrate' in navigator) navigator.vibrate([25, 20, 35]);

      const reader = new FileReader();
      reader.onload = evt => {
        const img = new Image();
        img.onload = () => {
          let w = img.width;
          let h = img.height;
          const MAX_DIM = 2560; // 2.5K high resolution preserve
          if (w > MAX_DIM || h > MAX_DIM) {
            const ratio = Math.min(MAX_DIM / w, MAX_DIM / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          const fullPhotoUrl = c.toDataURL('image/jpeg', 0.92);

          // Fast 256px crop for CLIP AI
          const thumbC = document.createElement('canvas');
          thumbC.width = 256;
          thumbC.height = 256;
          const minDim = Math.min(img.width, img.height);
          const sx = (img.width - minDim) / 2;
          const sy = (img.height - minDim) / 2;
          thumbC.getContext('2d').drawImage(img, sx, sy, minDim, minDim, 0, 0, 256, 256);
          const thumbDataUrl = thumbC.toDataURL('image/jpeg', 0.85);

          pending = { photo: fullPhotoUrl, guesses: [] };
          $('result-img').src = fullPhotoUrl;
          $('guesses').textContent = 'Identifying 48MP capture with on-device AI...';
          $('name-field').value = '';
          show('result', true);

          runIdentification(thumbDataUrl);
        };
        img.src = evt.target.result;
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    };
  }
}

async function updateAvailableCameras() {
  const flipBtn = $('flip-cam-btn');
  if (!navigator.mediaDevices?.enumerateDevices) {
    if (flipBtn) flipBtn.classList.add('hidden');
    return { frontCameras: [], backCameras: [], total: 0 };
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = devices.filter(d => d.kind === 'videoinput');

    // If only 1 camera exists, hide switch button completely
    if (videoInputs.length <= 1) {
      if (flipBtn) flipBtn.classList.add('hidden');
      availableCameras = videoInputs;
      return { frontCameras: [], backCameras: [], total: videoInputs.length };
    }

    const frontCameras = [];
    const backCameras = [];
    const otherCameras = [];

    videoInputs.forEach(device => {
      const label = (device.label || '').toLowerCase();
      const isFront = /front|user|selfie|facing front|truedepth|facetime/i.test(label);
      const isBack = /back|rear|environment|world|facing back|outward|main/i.test(label);

      if (isFront && !isBack) {
        frontCameras.push(device);
      } else if (isBack && !isFront) {
        backCameras.push(device);
      } else {
        otherCameras.push(device);
      }
    });

    // Check track capabilities and mobile defaults if labels are generic
    if (frontCameras.length === 0 && backCameras.length === 0 && videoInputs.length >= 2) {
      const trackCaps = currentVideoTrack?.getCapabilities?.() || {};
      const capsFacing = trackCaps.facingMode;
      if (Array.isArray(capsFacing) && capsFacing.includes('environment') && capsFacing.includes('user')) {
        backCameras.push(videoInputs[0]);
        frontCameras.push(videoInputs[1]);
      } else if (otherCameras.length >= 2) {
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        if (isMobile) {
          // On mobile phones, Camera 0 is almost universally rear, Camera 1 is front
          backCameras.push(videoInputs[0]);
          frontCameras.push(videoInputs[1]);
        }
      }
    }

    availableCameras = videoInputs;

    // Both front and rear must be available, AND stream must be active to show button
    const hasFrontAndBack = frontCameras.length > 0 && backCameras.length > 0;
    if (hasFrontAndBack && stream) {
      if (flipBtn) {
        flipBtn.classList.remove('hidden');
        flipBtn.removeAttribute('disabled');
      }
    } else {
      if (flipBtn) flipBtn.classList.add('hidden');
    }

    return { frontCameras, backCameras, otherCameras, total: videoInputs.length };
  } catch (err) {
    console.warn('Could not enumerate camera devices:', err);
    if (flipBtn) flipBtn.classList.add('hidden');
    return { frontCameras: [], backCameras: [], total: 0 };
  }
}

async function switchCamera() {
  if (isCameraSwitching || isCameraStarting || !stream) return;
  isCameraSwitching = true;

  const flipBtn = $('flip-cam-btn');
  const camBox = document.querySelector('.camera');
  const v = $('video');

  // Subtle loading state
  if (flipBtn) {
    flipBtn.classList.add('is-switching');
    flipBtn.setAttribute('disabled', 'true');
  }
  if (camBox) {
    camBox.classList.add('camera-switching');
  }

  warmUpAudio();
  if ('vibrate' in navigator) navigator.vibrate([15, 25]);

  const targetFacing = currentFacingMode === 'environment' ? 'user' : 'environment';
  const prevFacing = currentFacingMode;
  const prevDeviceId = currentCameraDeviceId;

  try {
    // 1. Identify target deviceId if available
    const { frontCameras, backCameras } = await updateAvailableCameras();
    let targetDeviceId = null;
    if (targetFacing === 'user' && frontCameras.length > 0) {
      targetDeviceId = frontCameras[0].deviceId;
    } else if (targetFacing === 'environment' && backCameras.length > 0) {
      targetDeviceId = backCameras[0].deviceId;
    }

    // 2. Stop previous stream tracks cleanly before acquiring new one
    if (stream) {
      stream.getTracks().forEach(t => {
        try { t.stop(); } catch (_) {}
      });
      stream = null;
    }
    currentVideoTrack = null;

    // 3. Acquire new stream with target constraints
    let newStream = null;
    const reqConstraints = {
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    };

    if (targetDeviceId) {
      reqConstraints.deviceId = { exact: targetDeviceId };
    } else {
      reqConstraints.facingMode = { ideal: targetFacing };
    }

    try {
      newStream = await navigator.mediaDevices.getUserMedia({
        video: reqConstraints,
        audio: false
      });
    } catch (err1) {
      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: targetFacing } },
          audio: false
        });
      } catch (err2) {
        newStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false
        });
      }
    }

    if (!newStream) throw new Error('No stream returned for camera switch');

    // 4. Attach new stream to video element
    stream = newStream;
    const [newTrack] = stream.getVideoTracks();
    currentVideoTrack = newTrack;

    const actualSettings = newTrack?.getSettings?.() || {};
    currentCameraDeviceId = actualSettings.deviceId || targetDeviceId || null;
    currentFacingMode = actualSettings.facingMode || targetFacing;

    v.srcObject = stream;
    await v.play();

    // 5. Apply continuous autofocus
    await applyContinuousAutofocus(newTrack);

    // 6. Reset zoom and apply non-mirrored transform
    setCameraZoom(1.0);

    // 7. Update torch button visibility
    if ($('torch-btn')) {
      $('torch-btn').classList.remove('active');
      isTorchOn = false;
      const caps = newTrack?.getCapabilities?.() || {};
      if (caps && caps.torch && currentFacingMode === 'environment') {
        $('torch-btn').classList.remove('hidden');
      } else {
        $('torch-btn').classList.add('hidden');
      }
    }

    // Refresh enumerated cameras list
    await updateAvailableCameras();

    show('cam-msg', false);
  } catch (err) {
    console.error('Camera switch failed:', err);
    $('cam-msg').textContent = 'Camera switch failed: ' + (err.message || err.name) + '. Reverting...';
    show('cam-msg', true);

    // Graceful recovery: re-open previous camera
    try {
      await startCamera(prevFacing, prevDeviceId);
    } catch (recErr) {
      console.error('Recovery failed:', recErr);
      $('cam-msg').textContent = 'Camera unavailable. Please click Start camera.';
      show('cam-msg', true);
    }
  } finally {
    isCameraSwitching = false;
    if (flipBtn) {
      flipBtn.classList.remove('is-switching');
      flipBtn.removeAttribute('disabled');
    }
    if (camBox) {
      camBox.classList.remove('camera-switching');
    }
  }
}

async function startCamera(facingMode = currentFacingMode, preferredDeviceId = null) {
  if (isCameraStarting) return;
  isCameraStarting = true;

  if (stream) {
    stream.getTracks().forEach(t => {
      try { t.stop(); } catch (_) {}
    });
    stream = null;
  }
  currentVideoTrack = null;
  currentFacingMode = facingMode;

  try {
    let newStream = null;
    const baseConstraints = {
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    };

    if (preferredDeviceId) {
      baseConstraints.deviceId = { exact: preferredDeviceId };
    } else if (facingMode) {
      baseConstraints.facingMode = { ideal: facingMode };
    }

    try {
      newStream = await navigator.mediaDevices.getUserMedia({
        video: baseConstraints,
        audio: false
      });
    } catch (err1) {
      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode } },
          audio: false
        });
      } catch (err2) {
        newStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false
        });
      }
    }

    if (!newStream) throw new Error('No video stream received');

    stream = newStream;
    const [vTrack] = stream.getVideoTracks();
    currentVideoTrack = vTrack;

    const actualSettings = vTrack?.getSettings?.() || {};
    if (actualSettings.deviceId) currentCameraDeviceId = actualSettings.deviceId;
    if (actualSettings.facingMode) currentFacingMode = actualSettings.facingMode;

    const v = $('video');
    v.srcObject = stream;
    await v.play();

    show('cam-msg', false);
    $('snap-btn').disabled = false;
    $('cam-btn-text').textContent = 'Stop camera';

    isTorchOn = false;
    setCameraZoom(1.0);

    // Apply continuous autofocus if supported
    await applyContinuousAutofocus(vTrack);

    // Update hardware torch
    if ($('torch-btn')) {
      $('torch-btn').classList.remove('active');
      const caps = vTrack?.getCapabilities?.() || {};
      if (caps && caps.torch && currentFacingMode === 'environment') {
        $('torch-btn').classList.remove('hidden');
      } else {
        $('torch-btn').classList.add('hidden');
      }
    }

    // Enumerate cameras now that permission is granted
    await updateAvailableCameras();

    warmModel();
  } catch (e) {
    console.error('startCamera error:', e);
    const isDenied = e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError';
    const msg = isDenied
      ? 'Camera access denied. Please allow camera permissions in your browser.'
      : 'Camera unavailable: ' + (e.message || e.name);
    $('cam-msg').textContent = msg;
    show('cam-msg', true);
    $('snap-btn').disabled = true;
    $('cam-btn-text').textContent = 'Start camera';

    const flipBtn = $('flip-cam-btn');
    if (flipBtn) flipBtn.classList.add('hidden');
  } finally {
    isCameraStarting = false;
  }
}

$('cam-btn').onclick = async () => {
  if (stream) { stopCamera(); return; }
  await startCamera(currentFacingMode);
};

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(t => {
      try { t.stop(); } catch (_) {}
    });
  }
  stream = null;
  currentVideoTrack = null;
  currentCameraDeviceId = null;
  isTorchOn = false;
  isCameraStarting = false;
  isCameraSwitching = false;

  const v = $('video');
  if (v) {
    v.srcObject = null;
    v.style.transform = 'none';
  }

  show('cam-msg', true);
  $('cam-msg').textContent = 'Camera is off';
  $('snap-btn').disabled = true;
  $('cam-btn-text').textContent = 'Start camera';

  if ($('torch-btn')) {
    $('torch-btn').classList.add('hidden');
    $('torch-btn').classList.remove('active');
  }
  const flipBtn = $('flip-cam-btn');
  if (flipBtn) {
    flipBtn.classList.add('hidden');
    flipBtn.classList.remove('is-switching');
  }
  const camBox = document.querySelector('.camera');
  if (camBox) {
    camBox.classList.remove('camera-switching');
  }
  const reticle = $('focus-reticle');
  if (reticle) reticle.classList.add('hidden');
}

if (navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', () => {
    if (stream) {
      updateAvailableCameras().catch(() => {});
    }
  });
}
window.addEventListener('beforeunload', stopCamera);
window.addEventListener('pagehide', stopCamera);

// ---------- On-device identification (open model, runs in the browser) ----------
let classifierP = null;
function warmModel() {
  if (classifierP) return classifierP;
  $('model-status').textContent = 'Loading the identification model (first time only)...';
  classifierP = (async () => {
    const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
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

  // 1. iPhone Shutter Flash Screen Effect
  const flash = $('shutter-flash');
  if (flash) {
    flash.classList.add('flash-active');
    setTimeout(() => flash.classList.remove('flash-active'), 80);
  }

  // 2. Crisp mechanical shutter click sound & haptic tap
  playShutterSound();
  if ('vibrate' in navigator) navigator.vibrate([25, 20, 35]);

  // 3. High-Resolution Sensor Capture
  let fullPhotoUrl = null;

  if ('ImageCapture' in window && currentVideoTrack && currentFacingMode !== 'user') {
    try {
      const capture = new ImageCapture(currentVideoTrack);
      const blob = await capture.takePhoto();
      fullPhotoUrl = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = evt => resolve(evt.target.result);
        reader.readAsDataURL(blob);
      });
    } catch (icErr) {
      // Graceful fallback to high-res canvas draw
    }
  }

  if (!fullPhotoUrl) {
    const c = document.createElement('canvas');
    let w = v.videoWidth;
    let h = v.videoHeight;
    const MAX_DIM = 2560; // 2.5K high quality retina
    if (w > MAX_DIM || h > MAX_DIM) {
      const scale = Math.min(MAX_DIM / w, MAX_DIM / h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');

    if (currentCameraZoom !== 1.0 && v.style.transform && v.style.transform !== 'none') {
      ctx.save();
      ctx.translate(c.width / 2, c.height / 2);
      ctx.scale(currentCameraZoom, currentCameraZoom);
      ctx.translate(-c.width / 2, -c.height / 2);
      ctx.drawImage(v, 0, 0, c.width, c.height);
      ctx.restore();
    } else {
      ctx.drawImage(v, 0, 0, c.width, c.height);
    }
    fullPhotoUrl = c.toDataURL('image/jpeg', 0.92);
  }

  // 4. Lightweight 256px Thumbnail strictly for on-device CLIP inference
  const thumbC = document.createElement('canvas');
  thumbC.width = 256;
  thumbC.height = 256;
  const thumbCtx = thumbC.getContext('2d');
  const minDim = Math.min(v.videoWidth || 256, v.videoHeight || 256);
  const sx = ((v.videoWidth || 256) - minDim) / 2;
  const sy = ((v.videoHeight || 256) - minDim) / 2;

  thumbCtx.drawImage(v, sx, sy, minDim, minDim, 0, 0, 256, 256);
  const thumbDataUrl = thumbC.toDataURL('image/jpeg', 0.85);

  pending = { photo: fullPhotoUrl, guesses: [] };
  $('result-img').src = fullPhotoUrl;
  $('guesses').textContent = 'Identifying specimen with on-device AI...';
  $('name-field').value = '';
  show('result', true);

  await runIdentification(thumbDataUrl);
};

async function runIdentification(thumbDataUrl) {
  const pipe = await warmModel();
  if (pipe) {
    try {
      const out = await pipe(thumbDataUrl, LABELS, { hypothesis_template: 'a photo of a {}.' });
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
}
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
// ---------- Toast Notifications & Photo Storage Handlers (Options A & C) ----------
function showToast(message) {
  let toast = $('wildtrail-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'wildtrail-toast';
    toast.className = 'uncharted-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.remove('hidden');
  if ('vibrate' in navigator) navigator.vibrate(30);
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 2800);
}

// Option A: Automatically download high-res photo to device storage / gallery
function autoDownloadPhoto(photoDataUrl, filename) {
  try {
    const a = document.createElement('a');
    a.href = photoDataUrl;
    a.download = filename || `wildtrail_photo_${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  } catch (err) {
    console.warn('Auto download error:', err);
    return false;
  }
}

// Option C: Native "Save to Photos" / Web Share API Level 2 (iOS Safari / Android Camera Roll)
async function savePhotoToPhonePhotos(photoDataUrl, specimenName = 'Specimen') {
  if (!photoDataUrl) return false;
  const safeName = (specimenName || 'specimen').toLowerCase().replace(/[^a-z0-9]/g, '_');
  const filename = `wildtrail_${safeName}_${Date.now()}.jpg`;

  try {
    const res = await fetch(photoDataUrl);
    const blob = await res.blob();
    const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: `${specimenName} · WildTrail`,
        text: `Captured in the wild: ${specimenName} 🌿`
      });
      showToast('✨ Photo ready to save to your Camera Roll!');
      return true;
    }
  } catch (err) {
    if (err.name === 'AbortError') return false; // user cancelled share sheet
    console.warn('Native photo share failed, falling back to download:', err);
  }

  // Fallback: direct high-res download
  autoDownloadPhoto(photoDataUrl, filename);
  showToast('💾 High-resolution photo downloaded to device!');
  return true;
}

$('discard-btn').onclick = () => { pending = null; show('result', false); };

if ($('save-photos-btn')) {
  $('save-photos-btn').onclick = async () => {
    if (!pending || !pending.photo) return;
    const name = $('name-field').value.trim() || 'Wild Specimen';
    await savePhotoToPhonePhotos(pending.photo, name);
  };
}

$('save-btn').onclick = async () => {
  if (!pending) return;
  const name = $('name-field').value.trim();
  if (!name) { $('name-field').focus(); return; }
  playDiscoveryChime();
  if ('vibrate' in navigator) navigator.vibrate([40, 50, 80]);
  const pos = lastPos || await getPosition();
  const photoToSave = pending.photo;
  await putAll('finds', {
    name, type: $('type-field').value, photo: photoToSave, time: Date.now(),
    lat: pos ? pos.lat : null, lon: pos ? pos.lon : null,
    guessed: pending.guesses[0] ? pending.guesses[0].label : null,
  });

  showToast(`✨ Saved "${name}" to Collection!`);

  pending = null;
  show('result', false);
  await updateTrainerChip();
  showView('collection');
};

// ---------- Collection & Living Journal ----------
let filter = 'all';
let currentSort = 'newest';

document.querySelectorAll('#filter-tabs button').forEach(b => b.onclick = () => {
  filter = b.dataset.f;
  document.querySelectorAll('#filter-tabs button').forEach(x => x.classList.toggle('on', x === b));
  renderCollection();
});

document.querySelectorAll('#sort-pills button').forEach(b => b.onclick = () => {
  currentSort = b.dataset.s;
  document.querySelectorAll('#sort-pills button').forEach(x => x.classList.toggle('on', x === b));
  renderCollection();
});

// Helper to calculate dynamic explorer points based on specimen type, confidence and rarity
function getFindPoints(find) {
  let pts = 25;
  const t = find.type || 'plant';
  if (t === 'animal') pts = 50;
  else if (t === 'bird') pts = 35;
  else if (t === 'insect') pts = 30;
  else pts = 20;

  if (find.uncharted) pts += 25;
  const salt = ((find.id || 0) + (find.name ? find.name.length * 7 : 0)) % 4;
  if (salt === 1) pts += 10;
  else if (salt === 2) pts += 15;
  else if (salt === 3) pts += 20;
  return pts;
}

// Helper to determine regional location stamp and date for the postcard
function getLocationAndDate(find) {
  const dateStr = new Date(find.time || Date.now()).toLocaleDateString([], {
    month: 'short',
    year: 'numeric'
  }).toUpperCase();

  let location = 'FIELD ENCOUNTER';
  if (find.lat != null && find.lon != null) {
    const lat = find.lat;
    const lon = find.lon;
    if (lat >= 28.2 && lat <= 28.9 && lon >= 76.8 && lon <= 77.5) location = 'DELHI';
    else if (lat >= 18.8 && lat <= 19.3 && lon >= 72.7 && lon <= 73.1) location = 'MUMBAI';
    else if (lat >= 12.8 && lat <= 13.2 && lon >= 77.4 && lon <= 77.8) location = 'BENGALURU';
    else if (lat >= 17.2 && lat <= 17.6 && lon >= 78.3 && lon <= 78.6) location = 'HYDERABAD';
    else if (lat >= 22.4 && lat <= 22.7 && lon >= 88.2 && lon <= 88.5) location = 'KOLKATA';
    else if (lat >= 12.9 && lat <= 13.3 && lon >= 80.1 && lon <= 80.4) location = 'CHENNAI';
    else if (lat >= 18.4 && lat <= 18.7 && lon >= 73.7 && lon <= 74.0) location = 'PUNE';
    else if (lat >= 26.8 && lat <= 27.1 && lon >= 75.6 && lon <= 76.0) location = 'JAIPUR';
    else if (lat >= 8.0 && lat <= 37.0 && lon >= 68.0 && lon <= 97.0) location = 'INDIA';
    else location = 'FIELD ENCOUNTER';
  }
  return { location, date: dateStr };
}

async function renderCollection() {
  const allFinds = await getAll('finds');
  let finds = allFinds.filter(f => filter === 'all' || f.type === filter);

  // Sorting / Re-arranging
  if (currentSort === 'name') {
    finds.sort((a, b) => a.name.localeCompare(b.name));
  } else if (currentSort === 'category') {
    finds.sort((a, b) => a.type.localeCompare(b.type) || (b.time - a.time));
  } else {
    // newest first
    finds.sort((a, b) => b.time - a.time);
  }

  $('collection-stats').textContent = `${allFinds.length} ${allFinds.length === 1 ? 'find' : 'finds'}`;
  const grid = $('grid');
  grid.textContent = '';
  show('empty-msg', finds.length === 0);

  finds.forEach((f, i) => {
    const t = document.createElement('div');
    t.className = 'tile stamp-tile';
    t.style.animationDelay = `${Math.min(i * 35, 400)}ms`;
    t.onclick = () => open3DStampCard(f);

    // Interactive 3D tilt & holographic sheen on the stamp
    t.onmousemove = e => {
      const rect = t.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      t.style.setProperty('--sheen-x', `${(x * 100).toFixed(1)}%`);
      t.style.setProperty('--sheen-y', `${(y * 100).toFixed(1)}%`);
      const rotX = (0.5 - y) * 16;
      const rotY = (x - 0.5) * 16;
      t.style.transform = `perspective(600px) rotateX(${rotX.toFixed(1)}deg) rotateY(${rotY.toFixed(1)}deg) scale3d(1.04, 1.04, 1.04)`;
    };
    t.onmouseleave = () => {
      t.style.transform = 'perspective(600px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
    };

    // Scalloped Perforated Stamp Edge
    const perfs = document.createElement('div');
    perfs.className = 'stamp-perforations';

    // Top Denomination & Type Symbol (Dynamic Explorer Points)
    const pts = getFindPoints(f);
    const tag = document.createElement('div');
    tag.className = 'stamp-tile-tag';
    tag.innerHTML = `<span>★ ${pts} XP</span> <span>${ICONS[f.type] || '🌿'}</span>`;

    // Inner Specimen Frame (Photo only, pristine vintage mount!)
    const frame = document.createElement('div');
    frame.className = 'stamp-tile-frame';
    const img = document.createElement('img');
    img.src = f.photo;
    img.alt = f.name;
    img.loading = 'lazy';
    frame.appendChild(img);

    // Bottom Species Name (Shows species name instead of INDIA · WT)
    const bot = document.createElement('div');
    bot.className = 'stamp-tile-bot';
    bot.textContent = (f.name || 'WILD SPECIMEN').toUpperCase();

    const sheen = document.createElement('div');
    sheen.className = 'tile-sheen';

    t.append(perfs, tag, frame, bot, sheen);
    grid.appendChild(t);
  });
}

// ---------- Feature: Interactive Floating 3D Stamp & Postcard ----------
let isCardFlipped = false;
let currentStampFind = null;
let cardTouchStartX = 0;
let cardTouchStartY = 0;
let cardTouchMoved = false;

function open3DStampCard(find) {
  currentStampFind = find;
  isCardFlipped = false;

  const card = $('stamp-3d-card');
  if (card) {
    card.classList.remove('is-flipped');
    card.style.transform = 'perspective(1200px) rotateX(0deg) rotateY(0deg) scale(1)';
  }

  const pts = getFindPoints(find);
  const locDate = getLocationAndDate(find);

  // Front Stamp Face (Photo, Dynamic XP, Species Name at bottom)
  $('stamp-front-img').src = find.photo;
  $('stamp-front-type').textContent = ICONS[find.type] || '🌿';
  if ($('stamp-front-points')) $('stamp-front-points').textContent = `★ ${pts} XP`;
  if ($('stamp-front-name')) $('stamp-front-name').textContent = (find.name || 'WILD SPECIMEN').toUpperCase();

  // Back Postcard Face (All details & location/date)
  $('stamp-back-name').textContent = find.name;
  $('stamp-back-badge').textContent = `${ICONS[find.type] || '🌿'} ${find.type.toUpperCase()}`;
  $('stamp-back-date').textContent = new Date(find.time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  $('stamp-back-guessed').textContent = find.guessed ? find.guessed : 'Manual Observation';
  
  metaGet('name').then(name => {
    if ($('stamp-back-observer')) $('stamp-back-observer').textContent = name || 'Trail Naturalist';
  });

  if ($('stamp-back-postmark-loc')) $('stamp-back-postmark-loc').textContent = locDate.location;
  if ($('stamp-back-postmark-date')) $('stamp-back-postmark-date').textContent = locDate.date;
  if ($('stamp-back-location-date')) $('stamp-back-location-date').textContent = `${locDate.location} · ${locDate.date}`;
  if ($('stamp-back-xp')) $('stamp-back-xp').textContent = `★ ${pts} EXPLORER XP`;

  const coordsText = (find.lat != null && find.lon != null)
    ? `${find.lat.toFixed(4)}°, ${find.lon.toFixed(4)}°`
    : 'No GPS logged';
  if ($('stamp-back-coords')) $('stamp-back-coords').textContent = coordsText;

  // Actions on the back of the card
  if ($('stamp-action-save-photo')) {
    $('stamp-action-save-photo').onclick = e => {
      e.stopPropagation();
      savePhotoToPhonePhotos(find.photo, find.name);
    };
  }

  $('stamp-action-postcard').onclick = e => {
    e.stopPropagation();
    openPostcardModal(find);
  };

  $('stamp-action-delete').onclick = async e => {
    e.stopPropagation();
    if (confirm(`Remove "${find.name}" from your journal?`)) {
      await delOne('finds', find.id);
      show('stamp-modal', false);
      await updateTrainerChip();
      renderCollection();
    }
  };

  show('stamp-modal', true);
}

function init3DCardPhysics() {
  const card = $('stamp-3d-card');
  if (!card || card._physicsInit) return;
  card._physicsInit = true;

  // Touch controls for mobile (Finger movement)
  card.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    cardTouchStartX = e.touches[0].clientX;
    cardTouchStartY = e.touches[0].clientY;
    cardTouchMoved = false;
  }, { passive: true });

  card.addEventListener('touchmove', e => {
    if (e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - cardTouchStartX;
    const dy = e.touches[0].clientY - cardTouchStartY;
    if (Math.hypot(dx, dy) > 6) {
      cardTouchMoved = true;
    }

    const rect = card.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const normX = Math.max(-1, Math.min(1, (e.touches[0].clientX - centerX) / (rect.width / 2)));
    const normY = Math.max(-1, Math.min(1, (e.touches[0].clientY - centerY) / (rect.height / 2)));

    const rotX = -normY * 22;
    const rotY = normX * 22 + (isCardFlipped ? 180 : 0);

    card.style.transform = `perspective(1000px) rotateX(${rotX.toFixed(1)}deg) rotateY(${rotY.toFixed(1)}deg) scale(1.05)`;
    card.style.setProperty('--glare-x', `${((normX * 0.5 + 0.5) * 100).toFixed(0)}%`);
    card.style.setProperty('--glare-y', `${((normY * 0.5 + 0.5) * 100).toFixed(0)}%`);
  }, { passive: true });

  card.addEventListener('touchend', () => {
    if (!cardTouchMoved) {
      // Tap without drag -> 3D Flip!
      toggleCardFlip();
    } else {
      // Spring back to face
      card.style.transform = isCardFlipped
        ? 'perspective(1000px) rotateY(180deg)'
        : 'perspective(1000px) rotateY(0deg)';
    }
  });

  // Mouse tilt on desktop
  card.addEventListener('mousemove', e => {
    const rect = card.getBoundingClientRect();
    const normX = Math.max(-1, Math.min(1, (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2)));
    const normY = Math.max(-1, Math.min(1, (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2)));

    const rotX = -normY * 20;
    const rotY = normX * 20 + (isCardFlipped ? 180 : 0);

    card.style.transform = `perspective(1000px) rotateX(${rotX.toFixed(1)}deg) rotateY(${rotY.toFixed(1)}deg) scale(1.05)`;
    card.style.setProperty('--glare-x', `${((normX * 0.5 + 0.5) * 100).toFixed(0)}%`);
    card.style.setProperty('--glare-y', `${((normY * 0.5 + 0.5) * 100).toFixed(0)}%`);
  });

  card.addEventListener('mouseleave', () => {
    card.style.transform = isCardFlipped
      ? 'perspective(1000px) rotateY(180deg)'
      : 'perspective(1000px) rotateY(0deg)';
  });

  card.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    toggleCardFlip();
  });

  let lastFlipTime = 0;
  function toggleCardFlip() {
    const now = Date.now();
    if (now - lastFlipTime < 450) return; // Prevent mobile double-flip from touchend + click
    lastFlipTime = now;
    isCardFlipped = !isCardFlipped;
    card.classList.toggle('is-flipped', isCardFlipped);
    card.style.transform = isCardFlipped
      ? 'perspective(1000px) rotateY(180deg)'
      : 'perspective(1000px) rotateY(0deg)';
  }

  // Close handlers
  $('stamp-modal-close').onclick = () => show('stamp-modal', false);
  $('stamp-modal').onclick = e => {
    if (e.target === $('stamp-modal')) show('stamp-modal', false);
  };
}

function openDetailModal(find) {
  open3DStampCard(find);
}

// ---------- Feature: Vintage Field Postcard & Herbarium Archive Card ----------
let activePostcardFind = null;

async function openPostcardModal(find) {
  activePostcardFind = find;
  show('postcard-modal', true);
  await renderVintagePostcard(find);
}

async function renderVintagePostcard(find) {
  const cv = $('postcard-canvas');
  if (!cv) return;
  const g = cv.getContext('2d');
  cv.width = 800;
  cv.height = 1000;

  // 1. Soft Warm Parchment Background
  const bg = g.createRadialGradient(400, 500, 150, 400, 500, 750);
  bg.addColorStop(0, '#fdfbf4');
  bg.addColorStop(0.6, '#f6eedb');
  bg.addColorStop(1, '#e8dbc0');
  g.fillStyle = bg;
  g.fillRect(0, 0, 800, 1000);

  // Subtle organic paper patina
  g.fillStyle = 'rgba(120, 95, 60, 0.035)';
  for (let i = 0; i < 350; i++) {
    const rx = (Math.sin(i * 123.45) * 0.5 + 0.5) * 800;
    const ry = (Math.cos(i * 678.9) * 0.5 + 0.5) * 1000;
    g.fillRect(rx, ry, (i % 3) + 1, (i % 2) + 1);
  }

  // 2. Vintage Double Borders & Corner Brackets
  g.strokeStyle = '#223d2b';
  g.lineWidth = 2.5;
  g.strokeRect(32, 32, 736, 936);

  g.strokeStyle = '#8c6d36';
  g.lineWidth = 1;
  g.strokeRect(40, 40, 720, 920);

  // Corner flourishes
  function drawFlourish(cx, cy) {
    g.save();
    g.strokeStyle = '#8c6d36';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(cx, cy, 6, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#223d2b';
    g.beginPath();
    g.arc(cx, cy, 2.5, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  drawFlourish(40, 40);
  drawFlourish(760, 40);
  drawFlourish(40, 960);
  drawFlourish(760, 960);

  // 3. Top Archival Header
  g.textAlign = 'center';
  g.font = 'bold 11px system-ui, sans-serif';
  g.fillStyle = '#4c5c4f';
  g.fillText('· HERBARIUM BOTANICUM & WILDLIFE SPECIMEN ARCHIVE ·', 400, 70);

  g.font = 'bold 24px Georgia, serif';
  g.fillStyle = '#142a1b';
  g.fillText('WILDTRAIL EXPEDITION JOURNAL', 400, 100);

  const specNum = String(find.id || 1).padStart(4, '0');
  g.font = '10px monospace';
  g.fillStyle = '#7a6a4d';
  g.fillText(`ARCHIVAL NO. WT-${specNum}  ·  TOUCH GRASS 2026`, 400, 118);

  // 4. Central Specimen Photo Mount
  g.save();
  g.shadowColor = 'rgba(30, 20, 10, 0.28)';
  g.shadowBlur = 18;
  g.shadowOffsetY = 8;
  g.fillStyle = '#ffffff';
  g.fillRect(108, 128, 584, 464);
  g.restore();

  // Load and draw photo
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise(resolve => {
    img.onload = resolve;
    img.onerror = resolve;
    img.src = find.photo;
  });

  if (img.width && img.height) {
    g.save();
    g.beginPath();
    g.rect(120, 140, 560, 440);
    g.clip();

    const imgRatio = img.width / img.height;
    const targetRatio = 560 / 440;
    let sw, sh, sx, sy;
    if (imgRatio > targetRatio) {
      sh = img.height;
      sw = img.height * targetRatio;
      sx = (img.width - sw) / 2;
      sy = 0;
    } else {
      sw = img.width;
      sh = img.width / targetRatio;
      sx = 0;
      sy = (img.height - sh) / 2;
    }
    g.drawImage(img, sx, sy, sw, sh, 120, 140, 560, 440);

    // Warm vintage patina layer
    g.fillStyle = 'rgba(235, 215, 175, 0.08)';
    g.fillRect(120, 140, 560, 440);
    g.restore();
  }

  // Antique Photo Corner Mounts
  function drawPhotoCorner(cx, cy, dirX, dirY) {
    g.save();
    g.fillStyle = '#223829';
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + dirX * 18, cy);
    g.lineTo(cx, cy + dirY * 18);
    g.closePath();
    g.fill();
    g.restore();
  }
  drawPhotoCorner(120, 140, 1, 1);
  drawPhotoCorner(680, 140, -1, 1);
  drawPhotoCorner(120, 580, 1, -1);
  drawPhotoCorner(680, 580, -1, -1);

  // 5. Botanical Plaque / Specimen Information Box
  g.fillStyle = 'rgba(242, 235, 218, 0.9)';
  g.strokeStyle = '#c5b593';
  g.lineWidth = 1;
  g.fillRect(90, 610, 620, 125);
  g.strokeRect(90, 610, 620, 125);

  g.textAlign = 'center';
  g.font = 'bold 30px Georgia, serif';
  g.fillStyle = '#102617';
  g.fillText(find.name.toUpperCase(), 400, 652);

  const catText = `${ICONS[find.type] || '🌿'} CLASS: ${find.type.toUpperCase()} SPECIMEN`;
  g.font = 'bold 12px system-ui, sans-serif';
  g.fillStyle = '#39533f';
  g.fillText(catText, 400, 680);

  g.font = 'italic 12px Georgia, serif';
  g.fillStyle = '#685942';
  g.fillText(find.guessed ? `Field observation verified with AI: ${find.guessed}` : 'Manual Naturalist Observation', 400, 708);

  // 6. Telemetry Details (Left)
  g.textAlign = 'left';
  g.font = 'bold 11px system-ui';
  g.fillStyle = '#3f5745';
  g.fillText('EXPEDITION TELEMETRY', 85, 765);

  g.font = '12px system-ui';
  g.fillStyle = '#1f2e24';
  const coordsText = (find.lat != null && find.lon != null)
    ? `${find.lat.toFixed(4)}° N, ${find.lon.toFixed(4)}° E`
    : 'Habitat: Local Natural Zone';
  g.fillText(`📍 ${coordsText}`, 85, 790);

  const dateStr = new Date(find.time).toLocaleDateString([], { dateStyle: 'long', timeStyle: 'short' });
  g.fillText(`📅 ${dateStr}`, 85, 814);

  const trainer = (await metaGet('name')) || 'Trail Naturalist';
  g.fillText(`👤 Observer: ${trainer}`, 85, 838);

  g.fillText(`🌿 Specimen #${(find.id || 1)}`, 85, 862);

  // 7. Vintage Red Postal Rubber Stamp (Center-Right)
  g.save();
  g.translate(490, 815);
  g.rotate(-8 * Math.PI / 180);
  g.strokeStyle = 'rgba(168, 42, 42, 0.85)';
  g.fillStyle = 'rgba(168, 42, 42, 0.85)';
  g.lineWidth = 2;
  // Outer circle
  g.beginPath();
  g.arc(0, 0, 48, 0, Math.PI * 2);
  g.stroke();
  // Inner circle
  g.beginPath();
  g.arc(0, 0, 42, 0, Math.PI * 2);
  g.stroke();
  // Text inside stamp
  g.textAlign = 'center';
  g.font = 'bold 8px system-ui';
  g.fillText('WILDTRAIL EXPEDITION', 0, -22);
  g.font = 'bold 12px system-ui';
  const stampDate = new Date(find.time).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  g.fillText(stampDate, 0, 3);
  g.font = 'bold 8px system-ui';
  g.fillText('TOUCH GRASS · FIELD', 0, 26);

  // Wavy postal cancellation lines
  g.lineWidth = 1.5;
  [-14, 0, 14].forEach(waveY => {
    g.beginPath();
    g.moveTo(56, waveY);
    g.bezierCurveTo(70, waveY - 5, 85, waveY + 5, 100, waveY);
    g.bezierCurveTo(115, waveY - 5, 130, waveY + 5, 145, waveY);
    g.stroke();
  });
  g.restore();

  // 8. Embossed Gold Wax Seal (Right)
  g.save();
  const sealX = 680, sealY = 820, sealR = 38;
  const sealGrad = g.createRadialGradient(sealX - 8, sealY - 10, 4, sealX, sealY, sealR);
  sealGrad.addColorStop(0, '#fef08a');
  sealGrad.addColorStop(0.35, '#f59e0b');
  sealGrad.addColorStop(0.8, '#b45309');
  sealGrad.addColorStop(1, '#78350f');
  g.fillStyle = sealGrad;
  g.shadowColor = 'rgba(0, 0, 0, 0.35)';
  g.shadowBlur = 10;
  g.shadowOffsetY = 4;
  g.beginPath();
  g.arc(sealX, sealY, sealR, 0, Math.PI * 2);
  g.fill();
  g.shadowColor = 'transparent';

  // Inner ring
  g.strokeStyle = 'rgba(254, 240, 138, 0.7)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(sealX, sealY, sealR - 6, 0, Math.PI * 2);
  g.stroke();

  // Seal Icon
  g.font = '22px system-ui';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(ICONS[find.type] || '🌿', sealX, sealY - 2);

  g.font = 'bold 7px system-ui';
  g.fillStyle = '#451a03';
  g.fillText('VERIFIED', sealX, sealY + 18);
  g.restore();

  // 9. Card Footer
  g.textAlign = 'center';
  g.font = '9px system-ui, sans-serif';
  g.fillStyle = '#657367';
  g.fillText('100% ON-DEVICE & PRIVACY-FIRST  ·  TOUCH GRASS 2026  ·  WILDTRAIL PWA', 400, 942);

  // 10. Pre-generate shareable File object immediately so navigator.share is 100% synchronous on iOS Safari
  pregeneratedPostcardFile = null;
  cv.toBlob(blob => {
    if (blob) {
      const safeName = (find.name || 'specimen').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
      pregeneratedPostcardFile = new File([blob], `wildtrail-${safeName}-${Date.now()}.png`, { type: 'image/png' });
    }
  }, 'image/png');
}

let pregeneratedPostcardFile = null;

async function sharePostcard() {
  const cv = $('postcard-canvas');
  if (!cv || !activePostcardFind) return;

  const file = pregeneratedPostcardFile;
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: `${activePostcardFind.name} · WildTrail Specimen Postcard`,
        text: `Collected in the wild with WildTrail 🌿 (100% on-device & private)`
      });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // User cancelled native share sheet
    }
  }

  // Fallback to direct download
  downloadPostcard();
}

function downloadPostcard() {
  const cv = $('postcard-canvas');
  if (!cv || !activePostcardFind) return;
  const safeName = activePostcardFind.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  const link = document.createElement('a');
  link.download = `wildtrail-${safeName}-${Date.now()}.png`;
  link.href = cv.toDataURL('image/png');
  link.click();
}

$('postcard-close-btn').onclick = () => show('postcard-modal', false);
$('postcard-modal').onclick = e => {
  if (e.target === $('postcard-modal')) show('postcard-modal', false);
};
$('postcard-share-btn').onclick = sharePostcard;
$('postcard-download-btn').onclick = downloadPostcard;

// ---------- Location, Distance and Map ----------
let lastPos = null;
let track = [];             // {lat, lon, t, uncharted}
let watchId = null;
let totalMeters = 0;
const CELL = 20;            // metres per explored square
let zoom = 1;
const unchartedCells = new Set();
let unchartedToastShown = false;
let panX = 0, panY = 0;
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let dragDistance = 0;
let dragMoved = false;
let renderedPins = [];
let activePopupFind = null;
let cachedFinds = [];
let cachedCells = new Set();
let mapAnimId = null;
let lastAnimTime = 0;

// Compass Orientation & Map Bearing
let currentHeadingDeg = null;  // Hardware compass heading (0 = North, clockwise 0..360)
let smoothedHeadingDeg = null; // Smoothly interpolated heading for jitter-free flashlight beam
let motionHeadingDeg = null;   // GPS speed course heading
let mapBearingDeg = 0;         // Map rotation bearing in degrees (0 = North up)
let compassListening = false;

function lerpAngleDeg(current, target, factor = 0.22) {
  if (current == null) return target;
  let diff = (target - current) % 360;
  if (diff < -180) diff += 360;
  if (diff > 180) diff -= 360;
  return (current + diff * factor + 360) % 360;
}

function initCompass() {
  if (compassListening) return;

  const handleOrientation = e => {
    let heading = null;
    // iOS Safari WebKit compass heading (0..360 magnetic North)
    if (e.webkitCompassHeading != null && !isNaN(e.webkitCompassHeading)) {
      heading = e.webkitCompassHeading;
    } else if (e.alpha != null && !isNaN(e.alpha)) {
      // Android / W3C DeviceOrientation (alpha 0..360 counter-clockwise around Z)
      let alpha = e.alpha;
      heading = (360 - alpha) % 360;
      const screenAngle = (window.screen && window.screen.orientation && window.screen.orientation.angle != null)
        ? window.screen.orientation.angle
        : (window.orientation || 0);
      heading = (heading + screenAngle + 360) % 360;
    }

    if (heading != null && !isNaN(heading)) {
      currentHeadingDeg = heading;
      if (smoothedHeadingDeg == null) smoothedHeadingDeg = heading;
    }
  };

  try {
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', handleOrientation, { passive: true });
      compassListening = true;
    }
  } catch (_) {}

  try {
    if ('DeviceOrientationEvent' in window) {
      window.addEventListener('deviceorientation', handleOrientation, { passive: true });
      compassListening = true;
    }
  } catch (_) {}
}

function requestCompassPermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then(res => {
        if (res === 'granted') initCompass();
      })
      .catch(() => {});
  } else {
    initCompass();
  }
}

function updateCompassHUD() {
  const needle = $('compass-needle');
  if (needle) {
    needle.style.transform = `rotate(${-mapBearingDeg}deg)`;
  }
  const compassBtn = $('compass-btn');
  if (compassBtn) {
    compassBtn.classList.toggle('compass-active', Math.abs(mapBearingDeg) > 1);
  }
}

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
  requestCompassPermission();
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
        $('edge-banner-text').textContent = "Uncharted Territory: Venturing beyond mapped paths. Keep exploring to reveal fog-of-war!";
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
  if (p.coords && p.coords.heading != null && !isNaN(p.coords.heading) && (p.coords.speed || 0) > 0.4) {
    motionHeadingDeg = p.coords.heading;
  }
  await putAll('track', pt);
  if (mapInstance && panX === 0 && panY === 0) {
    mapInstance.panTo([pt.lon, pt.lat], { duration: 400 });
  }
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


function project(pt, origin) { // metres east/north of origin
  const k = 111320;
  return { x: (pt.lon - origin.lon) * k * Math.cos(origin.lat * Math.PI / 180), y: (pt.lat - origin.lat) * k };
}



function updateScaleRuler(px) {
  const rawMeters = 50 / px;
  const niceSteps = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  let chosenStep = niceSteps[0];
  for (const step of niceSteps) {
    if (rawMeters <= step * 1.5) {
      chosenStep = step;
      break;
    }
    chosenStep = step;
  }
  const lineWidthPx = Math.max(30, Math.min(100, Math.round(chosenStep * px)));
  const lineEl = document.querySelector('.scale-bar-line');
  if (lineEl) lineEl.style.width = `${lineWidthPx}px`;
  const labelEl = $('scale-label');
  if (labelEl) labelEl.textContent = chosenStep >= 1000 ? `${(chosenStep / 1000).toFixed(0)} km` : `${chosenStep} m`;
}

function drawMapCanvas(finds = cachedFinds, cells = cachedCells) {
  const cv = $('map');
  if (!cv) return;
  const g = cv.getContext('2d');
  const highContrast = document.body.classList.contains('high-contrast');
  const rect = cv.getBoundingClientRect();
  if (rect.width && rect.height) {
    const rw = Math.round(rect.width);
    const rh = Math.round(rect.height);
    if (cv.width !== rw || cv.height !== rh) {
      cv.width = rw;
      cv.height = rh;
    }
  }

  if (mapInstance) {
    g.clearRect(0, 0, cv.width, cv.height);
  } else {
    g.fillStyle = '#061009';
    g.fillRect(0, 0, cv.width, cv.height);
  }

  const px = 2 * zoom; // pixels per metre
  const cx = cv.width / 2, cy = cv.height / 2;
  const origin = lastPos || (track[0]) || { lat: 0, lon: 0 };

  const cosB = Math.cos(mapBearingDeg * Math.PI / 180);
  const sinB = Math.sin(mapBearingDeg * Math.PI / 180);

  const toScreen = m => {
    const rawDx = m.x * px;
    const rawDy = -m.y * px;
    const rotDx = rawDx * cosB - rawDy * sinB;
    const rotDy = rawDx * sinB + rawDy * cosB;
    return { x: cx + panX + rotDx, y: cy + panY + rotDy };
  };
  const playerScreenPos = toScreen({ x: 0, y: 0 });

  updateScaleRuler(px);

  // 1. Subtle Cartographic Coordinate Grid
  const gridStepMeters = (zoom < 0.4) ? 200 : (zoom < 1.2 ? 100 : 50);
  const maxSpan = Math.max(cv.width, cv.height) * 1.5;
  const minM = Math.floor(-maxSpan / (gridStepMeters * px)) * gridStepMeters;
  const maxM = Math.ceil(maxSpan / (gridStepMeters * px)) * gridStepMeters;

  g.save();
  g.translate(cx + panX, cy + panY);
  if (mapBearingDeg !== 0) {
    g.rotate(mapBearingDeg * Math.PI / 180);
  }
  g.strokeStyle = highContrast ? 'rgba(167, 243, 208, 0.28)' : 'rgba(52, 211, 153, 0.08)';
  g.lineWidth = 1;
  g.font = '9px monospace';
  g.fillStyle = highContrast ? 'rgba(236, 253, 245, 0.86)' : 'rgba(52, 211, 153, 0.4)';

  for (let mx = minM; mx <= maxM; mx += gridStepMeters) {
    const sx = mx * px;
    g.beginPath();
    g.moveTo(sx, -maxSpan);
    g.lineTo(sx, maxSpan);
    g.stroke();
    if (mx !== 0 && sx > -cv.width / 2 && sx < cv.width / 2) {
      const label = mx > 0 ? `+${mx}m` : `${mx}m`;
      g.fillText(label, sx + 3, cv.height / 2 - 8);
    }
  }

  for (let my = minM; my <= maxM; my += gridStepMeters) {
    const sy = -my * px;
    g.beginPath();
    g.moveTo(-maxSpan, sy);
    g.lineTo(maxSpan, sy);
    g.stroke();
    if (my !== 0 && sy > -cv.height / 2 && sy < cv.height / 2) {
      const label = my > 0 ? `N+${my}m` : `S${my}m`;
      g.fillText(label, -cv.width / 2 + 8, sy - 3);
    }
  }
  g.restore();

  // 2. Topographical elevation contour rings
  g.save();
  g.strokeStyle = 'rgba(52, 211, 153, 0.06)';
  g.setLineDash([5, 6]);
  g.lineWidth = 1;
  [50, 120, 220, 360, 520].forEach(r => {
    const rPx = r * px;
    if (rPx > 6 && rPx < Math.max(cv.width, cv.height) * 2) {
      g.beginPath();
      g.arc(playerScreenPos.x, playerScreenPos.y, rPx, 0, Math.PI * 2);
      g.stroke();
    }
  });
  g.restore();

  // 3. Explored squares
  cells.forEach(key => {
    const [i, j] = key.split(',').map(Number);
    const s = toScreen({ x: i * CELL, y: j * CELL });
    const sz = CELL * px;
    g.save();
    g.translate(s.x, s.y);
    if (mapBearingDeg !== 0) {
      g.rotate(mapBearingDeg * Math.PI / 180);
    }
    if (unchartedCells.has(key)) {
      g.fillStyle = 'rgba(245, 158, 11, 0.28)';
      g.fillRect(0, -sz, sz, sz);
      g.strokeStyle = '#f59e0b';
      g.lineWidth = 1.5;
      g.strokeRect(0, -sz, sz, sz);
    } else {
      g.fillStyle = mapInstance ? 'rgba(16, 185, 129, 0.22)' : 'rgba(17, 74, 39, 0.75)';
      g.fillRect(0, -sz, sz, sz);
      g.strokeStyle = 'rgba(52, 211, 153, 0.16)';
      g.lineWidth = 0.5;
      g.strokeRect(0, -sz, sz, sz);
    }
    g.restore();
  });

  // 4. GPS Trail with neon dual-stroke
  if (track.length > 1) {
    g.save();
    g.strokeStyle = 'rgba(16, 185, 129, 0.35)';
    g.lineWidth = 5;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    track.forEach((pt, i) => {
      const s = toScreen(project(pt, origin));
      i ? g.lineTo(s.x, s.y) : g.moveTo(s.x, s.y);
    });
    g.stroke();

    g.strokeStyle = '#34d399';
    g.lineWidth = 2.5;
    g.stroke();
    g.restore();
  }

  // 5. Interactive Discovery Pins
  renderedPins = [];
  (finds || []).filter(f => f.lat != null && f.lon != null).forEach(f => {
    const s = toScreen(project(f, origin));
    renderedPins.push({ find: f, x: s.x, y: s.y, r: 13 });

    g.save();
    // Drop shadow
    g.fillStyle = 'rgba(0, 0, 0, 0.5)';
    g.beginPath();
    g.ellipse(s.x, s.y + 12, 8, 3.5, 0, 0, Math.PI * 2);
    g.fill();

    // Pin bottom tip
    g.fillStyle = '#f59e0b';
    g.beginPath();
    g.moveTo(s.x - 5, s.y + 5);
    g.lineTo(s.x + 5, s.y + 5);
    g.lineTo(s.x, s.y + 13);
    g.closePath();
    g.fill();

    // Outer circle
    g.fillStyle = '#0a1d13';
    g.strokeStyle = '#fbbf24';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(s.x, s.y, 11, 0, Math.PI * 2);
    g.fill();
    g.stroke();

    // Emoji icon
    g.font = '12px system-ui';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(ICONS[f.type] || '🌿', s.x, s.y);
    g.restore();
  });

  // 6. Player Heading & Vision Cone ("Flashlight Beam")
  if (currentHeadingDeg != null) {
    smoothedHeadingDeg = lerpAngleDeg(smoothedHeadingDeg, currentHeadingDeg, 0.22);
  } else if (motionHeadingDeg != null) {
    smoothedHeadingDeg = lerpAngleDeg(smoothedHeadingDeg, motionHeadingDeg, 0.22);
  }

  let effectiveHeadingDeg = 0;
  if (smoothedHeadingDeg != null) {
    effectiveHeadingDeg = smoothedHeadingDeg;
  } else if (motionHeadingDeg != null) {
    effectiveHeadingDeg = motionHeadingDeg;
  } else if (track.length >= 2) {
    const p1 = track[track.length - 2];
    const p2 = track[track.length - 1];
    const m1 = project(p1, origin);
    const m2 = project(p2, origin);
    const dx = m2.x - m1.x;
    const dy = m2.y - m1.y;
    if (Math.hypot(dx, dy) > 0.4) {
      effectiveHeadingDeg = ((Math.atan2(dx, dy) * 180 / Math.PI) + 360) % 360;
    }
  }

  // Screen heading relative to map bearing (Google Maps style)
  const relativeHeadingDeg = (effectiveHeadingDeg - mapBearingDeg + 360) % 360;
  // Convert clockwise degrees from North (where North is -PI/2) to canvas angle
  const headingAngle = (relativeHeadingDeg * Math.PI / 180) - (Math.PI / 2);

  const coneRadius = Math.max(38, Math.min(105, 70 * zoom));
  const coneArc = Math.PI / 4.2; // ~43 deg beam arc
  const coneGrad = g.createRadialGradient(
    playerScreenPos.x, playerScreenPos.y, 4,
    playerScreenPos.x, playerScreenPos.y, coneRadius
  );
  coneGrad.addColorStop(0, highContrast ? 'rgba(167, 243, 208, 0.62)' : 'rgba(52, 211, 153, 0.45)');
  coneGrad.addColorStop(0.45, highContrast ? 'rgba(167, 243, 208, 0.3)' : 'rgba(52, 211, 153, 0.16)');
  coneGrad.addColorStop(1, 'rgba(52, 211, 153, 0.0)');

  g.save();
  g.fillStyle = coneGrad;
  g.beginPath();
  g.moveTo(playerScreenPos.x, playerScreenPos.y);
  g.arc(playerScreenPos.x, playerScreenPos.y, coneRadius, headingAngle - coneArc, headingAngle + coneArc);
  g.closePath();
  g.fill();
  g.restore();

  // 7. Radiant Footstep Ripples / Beacon
  const pulseTime = (Date.now() % 2000) / 2000;
  const pulseR = 8 + pulseTime * 22;
  const pulseAlpha = Math.max(0, 1 - pulseTime) * 0.7;

  g.save();
  g.strokeStyle = `rgba(52, 211, 153, ${pulseAlpha})`;
  g.lineWidth = 2;
  g.beginPath();
  g.arc(playerScreenPos.x, playerScreenPos.y, pulseR, 0, Math.PI * 2);
  g.stroke();

  const pulse2Time = ((Date.now() + 1000) % 2000) / 2000;
  const pulse2R = 8 + pulse2Time * 22;
  const pulse2Alpha = Math.max(0, 1 - pulse2Time) * 0.5;
  g.strokeStyle = `rgba(245, 158, 11, ${pulse2Alpha})`;
  g.beginPath();
  g.arc(playerScreenPos.x, playerScreenPos.y, pulse2R, 0, Math.PI * 2);
  g.stroke();

  // Player Core Avatar
  g.fillStyle = 'rgba(16, 185, 129, 0.35)';
  g.beginPath();
  g.arc(playerScreenPos.x, playerScreenPos.y, 11, 0, Math.PI * 2);
  g.fill();

  g.fillStyle = '#10b981';
  g.strokeStyle = '#ffffff';
  g.lineWidth = 2.5;
  g.beginPath();
  g.arc(playerScreenPos.x, playerScreenPos.y, 6.5, 0, Math.PI * 2);
  g.fill();
  g.stroke();

  const tipX = playerScreenPos.x + Math.cos(headingAngle) * 11;
  const tipY = playerScreenPos.y + Math.sin(headingAngle) * 11;
  g.fillStyle = '#fbbf24';
  g.beginPath();
  g.arc(tipX, tipY, 2.5, 0, Math.PI * 2);
  g.fill();
  g.restore();

  // If no track yet, show helpful hint
  if (!track.length) {
    g.fillStyle = '#92a89a';
    g.font = '13px system-ui';
    g.textAlign = 'center';
    g.fillText('Start tracking to uncover the territory', playerScreenPos.x, playerScreenPos.y + 40);
  }
}

async function renderMapAndStats() {
  const finds = await getAll('finds');
  cachedFinds = finds;
  cachedCells = new Set();
  const origin = lastPos || (track[0]) || { lat: 0, lon: 0 };

  track.forEach(pt => {
    const m = project(pt, origin);
    const key = Math.floor(m.x / CELL) + ',' + Math.floor(m.y / CELL);
    cachedCells.add(key);
    if (pt.uncharted) unchartedCells.add(key);
  });

  const species = new Set(finds.map(f => f.name.toLowerCase()));
  $('stats').innerHTML = '';
  [[(totalMeters / 1000).toFixed(2) + ' km', 'distance walked'],
   [cachedCells.size, 'squares explored'],
   [unchartedCells.size, 'uncharted squares'],
   [finds.length, 'total finds'],
   [species.size, 'unique species']].forEach(([v, l], i) => {
    const d = document.createElement('div'); d.className = 'stat';
    d.style.animationDelay = `${i * 30}ms`;
    d.onmousemove = e => {
      const rect = d.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      const rotX = (0.5 - y) * 12;
      const rotY = (x - 0.5) * 12;
      d.style.transform = `perspective(500px) rotateX(${rotX.toFixed(1)}deg) rotateY(${rotY.toFixed(1)}deg) translateY(-2px)`;
    };
    d.onmouseleave = () => {
      d.style.transform = 'none';
    };
    const b = document.createElement('b'); b.textContent = v;
    const s = document.createElement('span'); s.textContent = l;
    d.append(b, s); $('stats').appendChild(d);
  });

  drawMapCanvas(cachedFinds, cachedCells);
}

function startMapAnim() {
  if (mapAnimId) return;
  function loop(time) {
    if (!$('view-map').classList.contains('active')) {
      mapAnimId = null;
      return;
    }
    if (time - lastAnimTime >= 35) { // ~28 fps
      lastAnimTime = time;
      drawMapCanvas(cachedFinds, cachedCells);
    }
    mapAnimId = requestAnimationFrame(loop);
  }
  mapAnimId = requestAnimationFrame(loop);
}

function stopMapAnim() {
  if (mapAnimId) {
    cancelAnimationFrame(mapAnimId);
    mapAnimId = null;
  }
}

function initMapInteractions() {
  const cv = $('map');
  if (!cv || cv._interactionsInit) return;
  cv._interactionsInit = true;

  // Prevent iOS Safari page-level gesture zoom on map
  cv.addEventListener('gesturestart', e => e.preventDefault());
  cv.addEventListener('gesturechange', e => e.preventDefault());
  cv.addEventListener('gestureend', e => e.preventDefault());

  // ---------- 1. Multi-Touch Pinch-to-Zoom & Twist Rotation & Panning ----------
  let lastTouchX = 0;
  let lastTouchY = 0;
  let touchStartPos = { x: 0, y: 0 };
  let touchMoved = false;
  let isPinching = false;
  let lastPinchDist = 0;
  let lastPinchAngle = 0;
  let initialPinchAngle = 0;
  let isRotatingTouch = false;
  let touchStartBearing = 0;

  cv.addEventListener('touchstart', e => {
    requestCompassPermission();
    if (e.touches.length === 2) {
      e.preventDefault();
      isPinching = true;
      isRotatingTouch = false;
      touchMoved = true;
      lastPinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      lastPinchAngle = Math.atan2(
        e.touches[1].clientY - e.touches[0].clientY,
        e.touches[1].clientX - e.touches[0].clientX
      );
      initialPinchAngle = lastPinchAngle;
      touchStartBearing = mapBearingDeg;
    } else if (e.touches.length === 1 && !isPinching) {
      touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
      touchMoved = false;
    }
  }, { passive: false });

  cv.addEventListener('touchmove', e => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const currentAngle = Math.atan2(
        e.touches[1].clientY - e.touches[0].clientY,
        e.touches[1].clientX - e.touches[0].clientX
      );

      // Pinch zoom
      if (lastPinchDist > 8 && currentDist > 8) {
        const factor = currentDist / lastPinchDist;
        const newZoom = Math.min(8, Math.max(0.15, zoom * factor));
        zoom = newZoom;
        if (mapInstance) {
          const deltaZoom = Math.log2(factor);
          mapInstance.setZoom(mapInstance.getZoom() + deltaZoom);
        }
        lastPinchDist = currentDist;
      }

      // Two-finger twist rotation
      let deltaAngle = currentAngle - initialPinchAngle;
      if (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI;
      if (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI;

      if (Math.abs(deltaAngle) > 0.08 || isRotatingTouch) {
        isRotatingTouch = true;
        const deltaDeg = deltaAngle * (180 / Math.PI);
        mapBearingDeg = (touchStartBearing + deltaDeg + 360) % 360;
        if (mapInstance) {
          mapInstance.setBearing(mapBearingDeg);
        }
        updateCompassHUD();
      }
      drawMapCanvas(cachedFinds, cachedCells);
    } else if (e.touches.length === 1 && !isPinching) {
      const stepX = e.touches[0].clientX - lastTouchX;
      const stepY = e.touches[0].clientY - lastTouchY;
      const totalDist = Math.hypot(e.touches[0].clientX - touchStartPos.x, e.touches[0].clientY - touchStartPos.y);
      if (totalDist > 6 || touchMoved) {
        e.preventDefault();
        touchMoved = true;
        panX += stepX;
        panY += stepY;
        lastTouchX = e.touches[0].clientX;
        lastTouchY = e.touches[0].clientY;

        if (mapInstance) {
          mapInstance.panBy([-stepX, -stepY], { animate: false });
        }

        if (panX !== 0 || panY !== 0) {
          $('recenter-btn')?.classList.add('recenter-active');
        }
        drawMapCanvas(cachedFinds, cachedCells);
      }
    }
  }, { passive: false });

  cv.addEventListener('touchend', e => {
    if (e.touches.length < 2) {
      isPinching = false;
      isRotatingTouch = false;
    }
    if (e.touches.length === 1) {
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
    }

    // Single tap hit-testing on pins if finger didn't drag
    if (e.touches.length === 0) {
      if (!touchMoved) {
        const rect = cv.getBoundingClientRect();
        const touchPt = e.changedTouches[0] || touchStartPos;
        const clickX = touchPt.clientX - rect.left;
        const clickY = touchPt.clientY - rect.top;

        let hitPin = null;
        for (const p of renderedPins) {
          if (Math.hypot(clickX - p.x, clickY - p.y) <= p.r + 10) {
            hitPin = p.find;
            break;
          }
        }

        if (hitPin) {
          activePopupFind = hitPin;
          $('popup-img').src = hitPin.photo || '';
          $('popup-name').textContent = hitPin.name;
          $('popup-badge').textContent = `${ICONS[hitPin.type] || '🌿'} ${hitPin.type.toUpperCase()}`;
          $('popup-date').textContent = new Date(hitPin.time).toLocaleDateString([], {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
          });
          show('map-pin-popup', true);
        } else {
          show('map-pin-popup', false);
          activePopupFind = null;
        }
      }
    }
  });

  // ---------- 2. Mouse Dragging & Rotation (Desktop) ----------
  let isRotatingMouse = false;
  let rotateStartPos = { x: 0, y: 0 };
  let rotateStartBearing = 0;

  cv.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') return;
    requestCompassPermission();
    if (e.shiftKey || e.button === 2) {
      e.preventDefault();
      isRotatingMouse = true;
      rotateStartPos = { x: e.clientX, y: e.clientY };
      rotateStartBearing = mapBearingDeg;
      try { cv.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    isDragging = true;
    dragMoved = false;
    dragDistance = 0;
    dragStart = { x: e.clientX, y: e.clientY };
    try { cv.setPointerCapture(e.pointerId); } catch (_) {}
  });

  cv.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    if (isRotatingMouse) {
      e.preventDefault();
      const dx = e.clientX - rotateStartPos.x;
      mapBearingDeg = (rotateStartBearing + dx * 0.45 + 360) % 360;
      if (mapInstance) mapInstance.setBearing(mapBearingDeg);
      updateCompassHUD();
      drawMapCanvas(cachedFinds, cachedCells);
      return;
    }
    if (!isDragging) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    dragDistance += Math.hypot(dx, dy);
    if (dragDistance > 5) {
      dragMoved = true;
      cv.classList.add('is-dragging');
    }
    panX += dx;
    panY += dy;
    dragStart = { x: e.clientX, y: e.clientY };

    if (mapInstance) {
      mapInstance.panBy([-dx, -dy], { animate: false });
    }

    if (panX !== 0 || panY !== 0) {
      $('recenter-btn')?.classList.add('recenter-active');
    }
    drawMapCanvas(cachedFinds, cachedCells);
  });

  const onPointerEnd = e => {
    if (e.pointerType === 'touch') return;
    if (isRotatingMouse) {
      isRotatingMouse = false;
      try { cv.releasePointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    if (!isDragging) return;
    isDragging = false;
    cv.classList.remove('is-dragging');
    try { cv.releasePointerCapture(e.pointerId); } catch (_) {}

    if (!dragMoved && dragDistance <= 5) {
      const rect = cv.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      let hitPin = null;
      for (const p of renderedPins) {
        if (Math.hypot(clickX - p.x, clickY - p.y) <= p.r + 8) {
          hitPin = p.find;
          break;
        }
      }

      if (hitPin) {
        activePopupFind = hitPin;
        $('popup-img').src = hitPin.photo || '';
        $('popup-name').textContent = hitPin.name;
        $('popup-badge').textContent = `${ICONS[hitPin.type] || '🌿'} ${hitPin.type.toUpperCase()}`;
        $('popup-date').textContent = new Date(hitPin.time).toLocaleDateString([], {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        show('map-pin-popup', true);
      } else {
        show('map-pin-popup', false);
        activePopupFind = null;
      }
    }
  };

  cv.addEventListener('pointerup', onPointerEnd);
  cv.addEventListener('pointercancel', onPointerEnd);
  cv.addEventListener('contextmenu', e => e.preventDefault());

  // ---------- 3. Trackpad Pinch-to-Zoom & Mouse Wheel Zoom ----------
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.ctrlKey ? Math.exp(-e.deltaY * 0.015) : (e.deltaY < 0 ? 1.15 : 0.87);
    const oldZoom = zoom;
    zoom = Math.min(8, Math.max(0.15, zoom * factor));
    if (mapInstance) {
      const zoomDelta = Math.log2(zoom / oldZoom);
      mapInstance.setZoom(mapInstance.getZoom() + zoomDelta);
    }
    drawMapCanvas(cachedFinds, cachedCells);
  }, { passive: false });

  // Recenter button
  const recenterBtn = $('recenter-btn');
  if (recenterBtn) {
    recenterBtn.onclick = () => {
      panX = 0;
      panY = 0;
      recenterBtn.classList.remove('recenter-active');
      const origin = lastPos || (track[0]) || { lat: 0, lon: 0 };
      if (mapInstance && origin.lat !== 0) {
        mapInstance.panTo([origin.lon, origin.lat], { duration: 300 });
      }
      drawMapCanvas(cachedFinds, cachedCells);
    };
  }

  // Compass button (Reset North)
  const compassBtn = $('compass-btn');
  if (compassBtn) {
    compassBtn.onclick = () => {
      requestCompassPermission();
      mapBearingDeg = 0;
      if (mapInstance) {
        mapInstance.setBearing(0);
      }
      updateCompassHUD();
      drawMapCanvas(cachedFinds, cachedCells);
    };
  }
  updateCompassHUD();

  // Popup close button
  const closeBtn = $('popup-close-btn');
  if (closeBtn) {
    closeBtn.onclick = () => {
      show('map-pin-popup', false);
      activePopupFind = null;
    };
  }

  // Popup view in Field Guide button
  const viewBtn = $('popup-view-btn');
  if (viewBtn) {
    viewBtn.onclick = () => {
      if (activePopupFind) {
        openDetailModal(activePopupFind);
      }
    };
  }
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

// Fullscreen map toggle
function toggleMapFullscreen() {
  const wrapper = document.querySelector('.map-wrapper');
  if (!wrapper) return;
  const isFs = Boolean(document.fullscreenElement) || wrapper.classList.contains('is-fullscreen');

  if (!isFs) {
    if (wrapper.requestFullscreen) {
      wrapper.requestFullscreen().catch(() => {
        wrapper.classList.add('is-fullscreen');
        updateFullscreenUI(true);
      });
    } else {
      wrapper.classList.add('is-fullscreen');
      updateFullscreenUI(true);
    }
  } else {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      wrapper.classList.remove('is-fullscreen');
      updateFullscreenUI(false);
    }
  }
}

function updateFullscreenUI(inFs) {
  const btn = $('map-fullscreen-btn');
  if (btn) {
    btn.textContent = inFs ? '✕' : '⛶';
    btn.title = inFs ? 'Exit Fullscreen' : 'Toggle Fullscreen';
  }
  setTimeout(() => {
    if (mapInstance) mapInstance.resize();
    renderMapAndStats();
  }, 80);
}

document.addEventListener('fullscreenchange', () => {
  const inFs = Boolean(document.fullscreenElement);
  updateFullscreenUI(inFs);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const wrapper = document.querySelector('.map-wrapper');
    if (wrapper && wrapper.classList.contains('is-fullscreen')) {
      wrapper.classList.remove('is-fullscreen');
      updateFullscreenUI(false);
    }
  }
});

$('map-fullscreen-btn').onclick = toggleMapFullscreen;

// ---------- Feature A: OpenFreeMap Online Vector Map & PMTiles Offline Vector Engine ----------
const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const OPENFREEMAP_ATTR = 'Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors · Style by <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>';

let maplibreGL = null;
let pmtilesLib = null;
let mapInstance = null;
let activeProtocol = null;
let currentMapMode = null; // 'online' or 'pmtiles:<id>'
let activeRegion = null;   // Active PMTiles archive object or null

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m]);
}

function setModalStatus(text, badgeClass = 'badge-ready') {
  const badge = $('modal-status-badge');
  if (badge) {
    badge.textContent = text;
    badge.className = 'status-badge ' + badgeClass;
  }
}

function updateActiveSourcePanel() {
  const label = $('active-source-label');
  const onlineBtn = $('activate-online-btn');
  if (activeRegion) {
    if (label) label.textContent = `📦 ${activeRegion.name} (${activeRegion.tileTypeLabel || 'Offline Vector'})`;
    if (onlineBtn) onlineBtn.classList.remove('hidden');
  } else {
    if (label) label.textContent = '🌐 OpenFreeMap Liberty (Online Vector)';
    if (onlineBtn) onlineBtn.classList.add('hidden');
  }
}

function checkBoundsCoverage() {
  const banner = $('map-bounds-banner');
  if (!banner) return;
  if (!activeRegion || !mapInstance) {
    banner.classList.add('hidden');
    return;
  }
  try {
    const c = mapInstance.getCenter();
    const b = activeRegion.bbox;
    const isOut = (c.lng < b[0] || c.lat < b[1] || c.lng > b[2] || c.lat > b[3]);
    banner.classList.toggle('hidden', !isOut);
  } catch (_) {
    banner.classList.add('hidden');
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', err => reject(err));
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => { s.dataset.loaded = 'true'; resolve(); };
    s.onerror = err => reject(err);
    document.head.appendChild(s);
  });
}

async function loadMapLibraries() {
  if (maplibreGL && pmtilesLib) return { maplibregl: maplibreGL, pmtiles: pmtilesLib };
  try {
    await Promise.all([
      loadScript('https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js'),
      loadScript('https://cdn.jsdelivr.net/npm/pmtiles@3.0.7/dist/pmtiles.js')
    ]);
    if (!window.maplibregl || !window.pmtiles) {
      console.warn('MapLibre or PMTiles global not found after script load');
      return null;
    }
    maplibreGL = window.maplibregl;
    pmtilesLib = window.pmtiles;
    return { maplibregl: maplibreGL, pmtiles: pmtilesLib };
  } catch (err) {
    console.warn('MapLibre/PMTiles failed to load assets, keeping canvas fallback:', err);
    return null;
  }
}

async function checkActiveRegionMap() {
  const savedPref = await metaGet('active_map_region');
  if (savedPref && savedPref !== 'online') {
    const reg = await getOne('regions', savedPref);
    if (reg) {
      if (currentMapMode === 'pmtiles:' + reg.id && mapInstance) return;
      await initMapLibreWithRegion(reg);
      return;
    }
  }
  if (currentMapMode === 'online' && mapInstance) return;
  await initDefaultOnlineMap();
}

async function initDefaultOnlineMap() {
  const libs = await loadMapLibraries();
  if (!libs) return;
  const { maplibregl } = libs;

  const container = $('maplibre-container');
  if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
    currentMapMode = null;
  }
  activeRegion = null;

  // Determine initial coordinates: live GPS -> latest track -> saved find -> fallback
  let centerLon = 77.5946;
  let centerLat = 12.9716;
  if (lastPos && lastPos.lat && lastPos.lon) {
    centerLon = lastPos.lon;
    centerLat = lastPos.lat;
  } else if (track.length && track[track.length - 1].lat) {
    centerLon = track[track.length - 1].lon;
    centerLat = track[track.length - 1].lat;
  } else {
    try {
      const finds = await getAll('finds');
      const withGps = finds.find(f => f.lat != null && f.lon != null);
      if (withGps) {
        centerLon = withGps.lon;
        centerLat = withGps.lat;
      }
    } catch (_) {}
  }

  if (!navigator.onLine) {
    currentMapMode = null;
    setModalStatus('Not available (Offline)', 'badge-error');
    updateActiveSourcePanel();
    checkBoundsCoverage();
    renderMapAndStats();
    return;
  }

  let styleLoaded = false;
  try {
    mapInstance = new maplibregl.Map({
      container: container,
      style: OPENFREEMAP_STYLE,
      center: [centerLon, centerLat],
      zoom: 15.5,
      bearing: mapBearingDeg,
      attributionControl: false,
      interactive: false
    });
    currentMapMode = 'online';

    const attrEl = $('map-attribution');
    if (attrEl) attrEl.innerHTML = OPENFREEMAP_ATTR;

    setModalStatus('Ready', 'badge-ready');
    updateActiveSourcePanel();
    checkBoundsCoverage();

    mapInstance.on('load', () => {
      styleLoaded = true;
      renderMapAndStats();
    });

    mapInstance.on('error', err => {
      console.warn('OpenFreeMap tile/style error:', err);
      if (!styleLoaded) {
        if (mapInstance) {
          try { mapInstance.remove(); } catch (_) {}
          mapInstance = null;
        }
        currentMapMode = null;
        setModalStatus('Not available (Offline)', 'badge-error');
        updateActiveSourcePanel();
        checkBoundsCoverage();
        renderMapAndStats();
      } else if (!navigator.onLine) {
        setModalStatus('Not available (Offline)', 'badge-error');
      }
    });

    // Center map if GPS arrives after initialization
    if (!lastPos && navigator.geolocation) {
      getPosition().then(pos => {
        if (pos && mapInstance && currentMapMode === 'online' && panX === 0 && panY === 0) {
          lastPos = pos;
          mapInstance.panTo([pos.lon, pos.lat], { duration: 400 });
          renderMapAndStats();
        }
      });
    }
  } catch (err) {
    console.warn('MapLibre WebGL online initialization failed, canvas fallback active:', err);
    mapInstance = null;
    currentMapMode = null;
    setModalStatus('Not available (Offline)', 'badge-error');
    updateActiveSourcePanel();
    checkBoundsCoverage();
    renderMapAndStats();
  }
}

async function initMapLibreWithRegion(region) {
  const libs = await loadMapLibraries();
  if (!libs) return;
  const { maplibregl, pmtiles } = libs;

  if (!activeProtocol) {
    activeProtocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', activeProtocol.tile);
  }

  // Register the local IndexedDB Blob as a PMTiles source using FileSource
  const source = new pmtiles.FileSource(region.blob);
  const p = new pmtiles.PMTiles(source);
  activeProtocol.add(p);
  activeProtocol.tiles.set(region.id, p);

  const container = $('maplibre-container');
  if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
    currentMapMode = null;
  }

  // Determine center coordinates: live GPS if within bounds, else archive center
  let centerLon = (region.center && region.center[0]) || (region.bbox[0] + region.bbox[2]) / 2;
  let centerLat = (region.center && region.center[1]) || (region.bbox[1] + region.bbox[3]) / 2;
  let initialZoom = (region.center && region.center[2]) || Math.max(12, region.minZoom || 10);

  if (lastPos && lastPos.lon >= region.bbox[0] && lastPos.lon <= region.bbox[2] &&
      lastPos.lat >= region.bbox[1] && lastPos.lat <= region.bbox[3]) {
    centerLon = lastPos.lon;
    centerLat = lastPos.lat;
    initialZoom = 15;
  }

  // Support both Vector (MVT) and Raster PMTiles styles
  let offlineStyle;
  if (region.tileType === 1 || !region.tileType) {
    // Comprehensive outdoor vector style supporting both Protomaps & OpenMapTiles layer schemas
    offlineStyle = {
      version: 8,
      sources: {
        protomaps: {
          type: 'vector',
          url: 'pmtiles://' + region.id
        }
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#061009' } },
        { id: 'water', type: 'fill', source: 'protomaps', 'source-layer': 'water', paint: { 'fill-color': '#07241d' } },
        { id: 'waterway', type: 'line', source: 'protomaps', 'source-layer': 'waterway', paint: { 'line-color': '#0b352b', 'line-width': 1.5 } },
        { id: 'landuse', type: 'fill', source: 'protomaps', 'source-layer': 'landuse', paint: { 'fill-color': '#0a1d13' } },
        { id: 'landcover', type: 'fill', source: 'protomaps', 'source-layer': 'landcover', paint: { 'fill-color': '#091c12' } },
        { id: 'natural', type: 'fill', source: 'protomaps', 'source-layer': 'natural', paint: { 'fill-color': '#0c2317' } },
        { id: 'park', type: 'fill', source: 'protomaps', 'source-layer': 'park', paint: { 'fill-color': '#0e291b', 'fill-opacity': 0.7 } },
        { id: 'boundaries', type: 'line', source: 'protomaps', 'source-layer': 'boundaries', paint: { 'line-color': '#114a2c', 'line-dasharray': [3, 2] } },
        { id: 'roads-casing', type: 'line', source: 'protomaps', 'source-layer': 'roads', paint: { 'line-color': '#030805', 'line-width': 3 } },
        { id: 'roads', type: 'line', source: 'protomaps', 'source-layer': 'roads', paint: { 'line-color': '#163824', 'line-width': 1.5 } },
        { id: 'trans-casing', type: 'line', source: 'protomaps', 'source-layer': 'transportation', paint: { 'line-color': '#030805', 'line-width': 3 } },
        { id: 'trans', type: 'line', source: 'protomaps', 'source-layer': 'transportation', paint: { 'line-color': '#163824', 'line-width': 1.5 } },
        { id: 'buildings', type: 'fill', source: 'protomaps', 'source-layer': 'buildings', paint: { 'fill-color': '#0d2115', 'fill-opacity': 0.6 } },
        { id: 'building', type: 'fill', source: 'protomaps', 'source-layer': 'building', paint: { 'fill-color': '#0d2115', 'fill-opacity': 0.6 } }
      ]
    };
  } else {
    // Raster PMTiles archive style
    offlineStyle = {
      version: 8,
      sources: {
        'pmtiles-raster': {
          type: 'raster',
          tiles: ['pmtiles://' + region.id + '/{z}/{x}/{y}'],
          tileSize: 256,
          minzoom: region.minZoom || 0,
          maxzoom: region.maxZoom || 18
        }
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#061009' } },
        { id: 'raster-layer', type: 'raster', source: 'pmtiles-raster' }
      ]
    };
  }

  try {
    mapInstance = new maplibregl.Map({
      container: container,
      style: offlineStyle,
      center: [centerLon, centerLat],
      zoom: initialZoom,
      bearing: mapBearingDeg,
      attributionControl: false,
      interactive: false
    });
    currentMapMode = 'pmtiles:' + region.id;
    activeRegion = region;

    const attrEl = $('map-attribution');
    if (attrEl) attrEl.innerHTML = `© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors · Offline Archive (${escapeHtml(region.name)})`;

    setModalStatus('Available offline', 'badge-offline');
    updateActiveSourcePanel();

    mapInstance.on('load', () => renderMapAndStats());
    mapInstance.on('move', checkBoundsCoverage);
    checkBoundsCoverage();
  } catch (err) {
    console.warn('MapLibre WebGL offline initialization failed, canvas fallback active:', err);
    mapInstance = null;
    currentMapMode = null;
    activeRegion = null;
  }
}

async function activateRegion(regionId) {
  const reg = await getOne('regions', regionId);
  if (!reg) return;
  await metaSet('active_map_region', reg.id);
  await initMapLibreWithRegion(reg);
  await renderRegionsList();
  renderMapAndStats();
  showToast(`🗺️ Activated offline map: ${reg.name}`);
  show('maps-manager-modal', false);
}

async function deactivateToOnline() {
  await metaSet('active_map_region', 'online');
  activeRegion = null;
  await initDefaultOnlineMap();
  await renderRegionsList();
  await updateStorageStats();
  renderMapAndStats();
  showToast('🌐 Switched to OpenFreeMap online basemap');
  show('maps-manager-modal', false);
}

async function deleteRegion(regionId) {
  const reg = await getOne('regions', regionId);
  if (!reg) return;
  const confirmed = confirm(
    `Delete offline map archive "${reg.name}" from this device?\n\n` +
    `Your saved finds, GPS trail, and exploration statistics will NOT be deleted.`
  );
  if (!confirmed) return;

  await delOne('regions', reg.id);
  await updateStorageStats();
  if (activeRegion && activeRegion.id === reg.id) {
    await deactivateToOnline();
  } else {
    await renderRegionsList();
  }
  showToast(`🗑️ Removed offline map archive: ${reg.name}`);
}

async function inspectRegion(regionId) {
  const reg = await getOne('regions', regionId);
  if (!reg) return;

  const modal = $('archive-inspector-modal');
  const filenameEl = $('inspector-filename');
  const grid = $('inspector-grid');
  const activateBtn = $('inspector-activate-btn');

  if (filenameEl) filenameEl.textContent = `${reg.filename || reg.name + '.pmtiles'}`;

  if (grid) {
    grid.innerHTML = '';

    const sizeMb = ((reg.sizeBytes || 0) / 1024 / 1024).toFixed(2);
    const dateStr = new Date(reg.date).toLocaleDateString([], {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const boundsStr = `${reg.bbox[0].toFixed(3)}°W, ${reg.bbox[1].toFixed(3)}°S to ${reg.bbox[2].toFixed(3)}°E, ${reg.bbox[3].toFixed(3)}°N`;
    const centerStr = `${reg.center[0].toFixed(4)}°, ${reg.center[1].toFixed(4)}° (z${reg.center[2] || 13})`;
    const zoomStr = `z${reg.minZoom ?? 0} – z${reg.maxZoom ?? 14}`;

    const items = [
      ['Archive Name', reg.name],
      ['Format & Engine', reg.tileTypeLabel || (reg.tileType === 1 ? 'Vector Tile (MVT)' : 'Raster Tile')],
      ['File Size', `${sizeMb} MB (${reg.sizeBytes.toLocaleString()} bytes)`],
      ['Zoom Range', zoomStr],
      ['Geographic Bounds', boundsStr],
      ['Archive Center', centerStr],
      ['Import Date', dateStr]
    ];

    items.forEach(([label, val]) => {
      const row = document.createElement('div');
      row.className = 'inspector-row';
      row.innerHTML = `<span class="inspector-label">${escapeHtml(label)}</span><span class="inspector-val">${escapeHtml(val)}</span>`;
      grid.appendChild(row);
    });

    // Vector Layers chip breakdown if available
    if (reg.layers && reg.layers.length > 0) {
      const row = document.createElement('div');
      row.className = 'inspector-row';
      const label = document.createElement('span');
      label.className = 'inspector-label';
      label.textContent = `Vector Layers (${reg.layers.length})`;
      const wrap = document.createElement('div');
      wrap.className = 'layers-chips-wrap';
      reg.layers.forEach(lyr => {
        const chip = document.createElement('span');
        chip.className = 'layer-chip';
        chip.textContent = lyr;
        wrap.appendChild(chip);
      });
      row.append(label, wrap);
      grid.appendChild(row);
    }
  }

  if (activateBtn) {
    const isCurrent = activeRegion && activeRegion.id === reg.id;
    activateBtn.textContent = isCurrent ? '✓ Currently Active Map' : 'Activate This Archive 🗺️';
    activateBtn.disabled = isCurrent;
    activateBtn.onclick = () => {
      show('archive-inspector-modal', false);
      activateRegion(reg.id);
    };
  }

  show('archive-inspector-modal', true);
}

// ---------- Offline Maps Manager UI ----------
$('open-maps-btn').onclick = () => openMapsManagerModal();
$('maps-close-btn').onclick = () => show('maps-manager-modal', false);
$('maps-manager-modal').onclick = e => {
  if (e.target === $('maps-manager-modal')) show('maps-manager-modal', false);
};

window.addEventListener('online', () => {
  if (currentMapMode === null && !activeRegion) {
    initDefaultOnlineMap();
  } else if (currentMapMode === 'online') {
    setModalStatus('Ready', 'badge-ready');
  }
});

window.addEventListener('offline', () => {
  if (currentMapMode === 'online') {
    setModalStatus('Not available (Offline)', 'badge-error');
  }
});
$('bounds-recenter-btn').onclick = () => {
  if (activeRegion && mapInstance) {
    mapInstance.flyTo({
      center: [activeRegion.center[0], activeRegion.center[1]],
      zoom: Math.max(activeRegion.minZoom || 10, 13)
    });
    panX = 0; panY = 0;
    renderMapAndStats();
  }
};
$('bounds-switch-btn').onclick = () => deactivateToOnline();
$('activate-online-btn').onclick = () => deactivateToOnline();

$('inspector-close-btn').onclick = () => show('archive-inspector-modal', false);
$('inspector-done-btn').onclick = () => show('archive-inspector-modal', false);
$('archive-inspector-modal').onclick = e => {
  if (e.target === $('archive-inspector-modal')) show('archive-inspector-modal', false);
};

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    show('maps-manager-modal', false);
    show('archive-inspector-modal', false);
  }
});

async function openMapsManagerModal() {
  show('maps-manager-modal', true);
  await updateStorageStats();
  await renderRegionsList();
  updateActiveSourcePanel();
}

async function updateStorageStats() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      const usedMb = ((est.usage || 0) / (1024 * 1024)).toFixed(1);
      const quotaMb = ((est.quota || 0) / (1024 * 1024)).toFixed(0);
      const quotaGb = ((est.quota || 0) / (1024 * 1024 * 1024)).toFixed(1);
      const pct = est.quota ? Math.min(100, (est.usage / est.quota) * 100).toFixed(2) : 0;

      const usedEl = $('storage-used-text');
      if (usedEl) usedEl.textContent = `Storage Used: ${usedMb} MB`;

      const quotaEl = $('storage-quota-text');
      if (quotaEl) quotaEl.textContent = `Available: ${quotaGb} GB (${pct}% used)`;

      const fillEl = $('storage-meter-fill');
      if (fillEl) fillEl.style.width = Math.max(1, pct) + '%';
    }
  } catch (_) {}
}

async function renderRegionsList() {
  const regions = await getAll('regions');
  const list = $('regions-list');
  list.textContent = '';
  show('no-regions-msg', !regions.length);

  const countPill = $('archives-count-pill');
  if (countPill) countPill.textContent = `${regions.length} archive${regions.length === 1 ? '' : 's'}`;

  regions.forEach(reg => {
    const isActive = activeRegion && activeRegion.id === reg.id;
    const item = document.createElement('div');
    item.className = 'region-item' + (isActive ? ' is-active' : '');

    // Header row: Title + badges
    const headerRow = document.createElement('div');
    headerRow.className = 'region-header-row';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'region-title-wrap';

    const title = document.createElement('b');
    title.textContent = reg.name;
    const typePill = document.createElement('span');
    typePill.className = 'type-pill';
    typePill.textContent = reg.tileTypeLabel || (reg.tileType === 1 ? 'Vector (MVT)' : 'Raster');
    titleWrap.append(title, typePill);

    if (isActive) {
      const activePill = document.createElement('span');
      activePill.className = 'active-pill';
      activePill.textContent = '✓ Active';
      titleWrap.appendChild(activePill);
    }
    headerRow.appendChild(titleWrap);

    // Meta grid: size, zoom, bbox, date
    const metaGrid = document.createElement('div');
    metaGrid.className = 'region-meta-grid';
    const sizeMb = ((reg.sizeBytes || 0) / 1024 / 1024).toFixed(1);
    const dateStr = new Date(reg.date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    const zoomStr = `z${reg.minZoom ?? 0}–z${reg.maxZoom ?? 14}`;
    const bboxStr = `${reg.bbox[0].toFixed(2)}°E, ${reg.bbox[1].toFixed(2)}°N`;

    metaGrid.innerHTML = `
      <span>📦 <b>${sizeMb} MB</b> · ${zoomStr}</span>
      <span>📅 ${dateStr}</span>
      <span>🧭 Bounds: ${bboxStr}</span>
      <span>🔍 Layers: ${reg.layers ? reg.layers.length : 'std'}</span>
    `;

    // Action buttons row
    const actionsRow = document.createElement('div');
    actionsRow.className = 'region-actions-row';

    const actBtn = document.createElement('button');
    actBtn.className = 'primary small-btn';
    actBtn.textContent = isActive ? '✓ In Use' : 'Activate';
    actBtn.disabled = isActive;
    actBtn.onclick = () => activateRegion(reg.id);

    const inspectBtn = document.createElement('button');
    inspectBtn.className = 'glass-btn small-btn';
    inspectBtn.textContent = 'Inspect 🔍';
    inspectBtn.onclick = () => inspectRegion(reg.id);

    const delBtn = document.createElement('button');
    delBtn.className = 'danger-btn small-btn';
    delBtn.textContent = 'Delete 🗑️';
    delBtn.onclick = () => deleteRegion(reg.id);

    actionsRow.append(actBtn, inspectBtn, delBtn);
    item.append(headerRow, metaGrid, actionsRow);
    list.appendChild(item);
  });

  // Update Featured Packs Installed Status
  const botanicalBtn = $('pack-dl-btn-botanical');
  const botanicalCard = $('pack-card-botanical');
  const isBotanicalInstalled = regions.some(r => /botanical/i.test(r.name) || r.id.includes('botanical'));
  if (botanicalBtn) {
    if (isBotanicalInstalled) {
      botanicalBtn.textContent = '✓ Installed on Device';
      botanicalBtn.disabled = true;
      botanicalBtn.className = 'glass-btn small-btn full-width pack-action-btn';
      if (botanicalCard) botanicalCard.classList.add('is-installed');
    } else {
      botanicalBtn.textContent = '⬇️ Download to Device (Free)';
      botanicalBtn.disabled = false;
      botanicalBtn.className = 'primary small-btn full-width pack-action-btn';
      if (botanicalCard) botanicalCard.classList.remove('is-installed');
    }
  }
}

// ---------- 1-Click In-App Map Downloader Engine ----------
async function downloadMapFromUrl(url, defaultName, progressWrapEl, progressFillEl, progressTextEl, dlBtnEl) {
  if (dlBtnEl) dlBtnEl.disabled = true;
  if (progressWrapEl) progressWrapEl.classList.remove('hidden');
  if (progressFillEl) progressFillEl.style.width = '6%';
  if (progressTextEl) progressTextEl.textContent = 'Connecting to download stream...';

  setModalStatus('Downloading', 'badge-importing');

  try {
    const libs = await loadMapLibraries();
    if (!libs || !libs.pmtiles) {
      throw new Error('Map engine not ready. Check your connection.');
    }
    const pm = libs.pmtiles;

    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Download server returned HTTP ${resp.status} ${resp.statusText}`);
    }

    const totalBytes = Number(resp.headers.get('content-length')) || 0;
    const reader = resp.body.getReader();
    let receivedBytes = 0;
    const chunks = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      receivedBytes += value.length;

      if (totalBytes > 0) {
        const pct = Math.min(100, (receivedBytes / totalBytes) * 100);
        if (progressFillEl) progressFillEl.style.width = pct.toFixed(1) + '%';
        if (progressTextEl) {
          progressTextEl.textContent = `Downloading: ${pct.toFixed(0)}% (${(receivedBytes / 1024 / 1024).toFixed(1)} / ${(totalBytes / 1024 / 1024).toFixed(1)} MB)`;
        }
      } else {
        if (progressFillEl) progressFillEl.style.width = '65%';
        if (progressTextEl) {
          progressTextEl.textContent = `Downloading: ${(receivedBytes / 1024 / 1024).toFixed(1)} MB received...`;
        }
      }
    }

    if (progressTextEl) progressTextEl.textContent = 'Verifying map archive header...';
    if (progressFillEl) progressFillEl.style.width = '100%';

    const blob = new Blob(chunks, { type: 'application/octet-stream' });
    const source = new pm.FileSource(blob);
    const p = new pm.PMTiles(source);
    const header = await p.getHeader();

    if (!header || header.minLon == null || isNaN(header.minLon)) {
      throw new Error('Downloaded file is not a valid PMTiles archive');
    }

    let metadata = null;
    try {
      metadata = await p.getMetadata();
    } catch (_) {
      metadata = null;
    }

    const bbox = [header.minLon, header.minLat, header.maxLon, header.maxLat];
    const centerLon = header.centerLon || (header.minLon + header.maxLon) / 2;
    const centerLat = header.centerLat || (header.minLat + header.maxLat) / 2;
    const centerZoom = header.centerZoom || Math.round((header.minZoom + header.maxZoom) / 2);

    let layers = [];
    if (metadata && Array.isArray(metadata.vector_layers)) {
      layers = metadata.vector_layers.map(l => l.id || l.name).filter(Boolean);
    }

    const tileTypeLabel = header.tileType === 1 ? 'Vector (MVT)' : 'Raster Tiles';

    const region = {
      id: 'pmtiles-' + (defaultName.toLowerCase().replace(/[^a-z0-9]/g, '-') || Date.now()),
      name: defaultName,
      filename: defaultName + '.pmtiles',
      bbox: bbox,
      center: [centerLon, centerLat, centerZoom],
      minZoom: header.minZoom,
      maxZoom: header.maxZoom,
      tileType: header.tileType,
      tileTypeLabel: tileTypeLabel,
      layers: layers,
      sizeBytes: blob.size,
      date: Date.now(),
      blob: blob
    };

    await putAll('regions', region);
    await metaSet('active_map_region', region.id);
    await updateStorageStats();
    await renderRegionsList();
    await initMapLibreWithRegion(region);
    renderMapAndStats();

    setModalStatus('Available offline', 'badge-offline');
    showToast(`🗺️ "${region.name}" downloaded & ready offline!`);

    if (dlBtnEl) {
      dlBtnEl.textContent = '✓ Installed on Device';
      dlBtnEl.disabled = true;
      dlBtnEl.className = 'glass-btn small-btn full-width pack-action-btn';
    }
  } catch (err) {
    console.error('Download map failed:', err);
    setModalStatus('Error', 'badge-error');
    if (progressTextEl) progressTextEl.textContent = 'Download failed: ' + err.message;
    showToast(`⚠️ Could not download map: ${err.message}`);
    if (dlBtnEl) {
      dlBtnEl.disabled = false;
      dlBtnEl.textContent = 'Retry Download 🔄';
    }
  } finally {
    setTimeout(() => {
      if (progressWrapEl) progressWrapEl.classList.add('hidden');
    }, 2800);
  }
}

// 1-Click Download featured pack
const dlBotanicalBtn = $('pack-dl-btn-botanical');
if (dlBotanicalBtn) {
  dlBotanicalBtn.onclick = () => {
    downloadMapFromUrl(
      './maps/taipei-botanical-reserve.pmtiles',
      'Demo pack: Taipei Botanical Reserve (~300 m area)',
      $('pack-progress-wrap-botanical'),
      $('pack-progress-fill-botanical'),
      $('pack-progress-text-botanical'),
      dlBotanicalBtn
    );
  };
}

// Custom URL download
const customDlBtn = $('custom-url-dl-btn');
if (customDlBtn) {
  customDlBtn.onclick = async () => {
    const input = $('custom-pmtiles-url');
    const url = input ? input.value.trim() : '';
    if (!url) {
      showToast('⚠️ Please enter a valid PMTiles URL');
      return;
    }
    let defaultName = 'Custom Offline Map';
    try {
      const u = new URL(url);
      const seg = u.pathname.split('/').pop().replace(/\.pmtiles$/i, '');
      if (seg) defaultName = decodeURIComponent(seg);
    } catch (_) {}

    customDlBtn.disabled = true;
    customDlBtn.textContent = 'Fetching...';
    try {
      await downloadMapFromUrl(url, defaultName, null, null, null, customDlBtn);
      if (input) input.value = '';
    } finally {
      customDlBtn.disabled = false;
      customDlBtn.textContent = 'Fetch';
    }
  };
}

// File import for .pmtiles archives (Authentic, genuine offline vector maps)
$('import-pmtiles-input').onchange = async e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  setModalStatus('Importing...', 'badge-importing');

  const libs = await loadMapLibraries();
  if (!libs || !libs.pmtiles) {
    showToast('⚠️ Map engine not ready. Check your connection.');
    setModalStatus('Error', 'badge-error');
    e.target.value = '';
    return;
  }

  let header;
  let metadata = null;
  const pm = libs.pmtiles;

  try {
    const source = new pm.FileSource(file);
    const p = new pm.PMTiles(source);
    header = await p.getHeader();
    if (!header || header.minLon == null || isNaN(header.minLon)) {
      throw new Error('Archive header is missing valid geographic bounds.');
    }
    // Verify supported tile formats: 1 (Mvt vector) or 2..5 (Raster)
    if (header.tileType === 0) {
      throw new Error('Unrecognized tileType format. Please provide a standard Vector (MVT) or Raster PMTiles archive.');
    }

    try {
      metadata = await p.getMetadata();
    } catch (_) {
      metadata = null;
    }
  } catch (err) {
    console.warn('Invalid PMTiles archive import attempt:', err);
    setModalStatus('Error', 'badge-error');
    showToast(`⚠️ Invalid PMTiles archive: ${err.message || 'Header check failed'}`);
    e.target.value = '';
    return;
  }

  const bbox = [header.minLon, header.minLat, header.maxLon, header.maxLat];
  const centerLon = header.centerLon || (header.minLon + header.maxLon) / 2;
  const centerLat = header.centerLat || (header.minLat + header.maxLat) / 2;
  const centerZoom = header.centerZoom || Math.round((header.minZoom + header.maxZoom) / 2);

  // Extract layer names if vector layers metadata is present
  let layers = [];
  if (metadata && Array.isArray(metadata.vector_layers)) {
    layers = metadata.vector_layers.map(l => l.id || l.name).filter(Boolean);
  }

  const tileTypeLabel = header.tileType === 1 ? 'Vector (MVT)' : 'Raster Tiles';

  const region = {
    id: 'pmtiles-' + Date.now(),
    name: file.name.replace(/\.pmtiles$/i, '') || 'Backcountry Region',
    filename: file.name,
    bbox: bbox,
    center: [centerLon, centerLat, centerZoom],
    minZoom: header.minZoom,
    maxZoom: header.maxZoom,
    tileType: header.tileType,
    tileTypeLabel: tileTypeLabel,
    layers: layers,
    sizeBytes: file.size,
    date: Date.now(),
    blob: file
  };

  try {
    await putAll('regions', region);
    await metaSet('active_map_region', region.id);
    await updateStorageStats();
    await renderRegionsList();
    await initMapLibreWithRegion(region);
    renderMapAndStats();
    showToast(`🗺️ Map "${region.name}" imported and activated!`);
    setModalStatus('Available offline', 'badge-offline');
  } catch (err) {
    console.error('Failed to store PMTiles in IndexedDB:', err);
    setModalStatus('Error', 'badge-error');
    if (err.name === 'QuotaExceededError') {
      alert('Storage quota exceeded! Please delete older regions or free up browser space.');
    } else {
      alert('Could not store map: ' + err.message);
    }
  } finally {
    e.target.value = '';
  }
};

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
$('export-gpx-btn').onclick = async () => {
  const track = await getAll('track');
  if (!track.length) {
    alert('No trail track points found yet. Start tracking to record a trail first.');
    return;
  }
  const escapeXml = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
  const trkpts = track
    .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .map(p => {
      const time = Number.isFinite(p.t) ? `<time>${new Date(p.t).toISOString()}</time>` : '';
      return `      <trkpt lat="${p.lat}" lon="${p.lon}">${time}</trkpt>`;
    })
    .join('\n');
  if (!trkpts) {
    alert('No valid GPS coordinates found in your recorded trail.');
    return;
  }
  const profileName = escapeXml((await metaGet('name')) || 'WildTrail Explorer');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="WildTrail" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${profileName} Trail</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'wildtrail-trail.gpx'; a.click();
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
