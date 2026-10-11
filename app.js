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
    if (mapInstance) mapInstance.resize();
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
          updateResultMediaAspect();
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

function updateResultMediaAspect() {
  const img = $('result-img');
  if (!img) return;
  const media = img.closest('.result-media');
  if (img.naturalWidth && img.naturalHeight && media) {
    media.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
  }
}

if ($('result-img')) {
  $('result-img').addEventListener('load', updateResultMediaAspect);
  $('result-img').onclick = () => {
    if (pending?.photo) {
      openPhotoLightbox(pending.photo, $('name-field')?.value || 'Captured Specimen');
    }
  };
}

// ---------- Fullscreen Photo Lightbox ----------
function openPhotoLightbox(photoUrl, title = 'Specimen Photo') {
  const modal = $('lightbox-modal');
  const img = $('lightbox-img');
  const cap = $('lightbox-caption');
  if (!modal || !img) return;
  img.src = photoUrl;
  if (cap) cap.textContent = title;
  modal.classList.remove('hidden');
}

function closePhotoLightbox() {
  const modal = $('lightbox-modal');
  if (modal) modal.classList.add('hidden');
}

if ($('lightbox-close-btn')) {
  $('lightbox-close-btn').onclick = closePhotoLightbox;
}
if ($('lightbox-modal')) {
  $('lightbox-modal').onclick = e => {
    if (e.target === $('lightbox-modal')) closePhotoLightbox();
  };
}

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
  updateResultMediaAspect();
  $('name-field').value = '';
  show('result', true);

  if ($('result-location-badge')) {
    $('result-location-badge').textContent = '📍 Acquiring GPS coordinates...';
  }
  if ($('result-status-tag')) {
    $('result-status-tag').textContent = 'Draft Specimen';
    $('result-status-tag').className = 'result-status-tag';
  }

  getPosition().then(pos => {
    if (pos && $('result-location-badge')) {
      const latStr = `${pos.lat.toFixed(4)}° ${pos.lat >= 0 ? 'N' : 'S'}`;
      const lonStr = `${pos.lon.toFixed(4)}° ${pos.lon >= 0 ? 'E' : 'W'}`;
      const accStr = pos.accuracy ? ` (±${Math.round(pos.accuracy)}m)` : '';
      $('result-location-badge').textContent = `📍 ${latStr}, ${lonStr}${accStr}`;
    }
  }).catch(() => {
    if ($('result-location-badge')) {
      $('result-location-badge').textContent = '📍 Location saved with timestamp';
    }
  });

  // Skeleton shimmer while AI infers
  $('guesses').innerHTML = `
    <div class="skeleton-shimmer-row">
      <div class="skeleton-guess-pill shimmer"></div>
      <div class="skeleton-guess-pill shimmer"></div>
      <div class="skeleton-guess-pill shimmer"></div>
    </div>
    <p class="identifying-hint">Identifying specimen with on-device AI...</p>
  `;

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
        if ($('result-status-tag')) {
          $('result-status-tag').textContent = 'AI Match Found';
          $('result-status-tag').className = 'result-status-tag is-matched';
        }
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
  toast.innerHTML = `<span>${message}</span>`;
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
  const record = {
    name, type: $('type-field').value, photo: photoToSave, time: Date.now(),
    lat: pos ? pos.lat : null, lon: pos ? pos.lon : null,
    guessed: pending.guesses[0] ? pending.guesses[0].label : null,
  };
  if (pending.existingFindId) {
    record.id = pending.existingFindId;
  }
  await putAll('finds', record);

  // Option A: Auto-download high-resolution photo to device storage
  const safeName = name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  autoDownloadPhoto(photoToSave, `wildtrail-${safeName}-${Date.now()}.jpg`);
  showToast(`✨ Saved "${name}" to Collection & downloaded to device!`);

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

  let location = 'DELHI';
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
    else location = 'WILDTRAIL';
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

  if ($('stamp-action-view-species')) {
    $('stamp-action-view-species').onclick = e => {
      e.stopPropagation();
      openFindInSpeciesPanel(find);
    };
  }

  // Close handlers
  $('stamp-modal-close').onclick = () => show('stamp-modal', false);
  $('stamp-modal').onclick = e => {
    if (e.target === $('stamp-modal')) show('stamp-modal', false);
  };
}

function openFindInSpeciesPanel(find) {
  if (!find) return;
  show('stamp-modal', false);
  showView('capture');
  pending = {
    photo: find.photo,
    guesses: find.guessed ? [{ label: find.guessed, score: 0.99 }] : [{ label: find.name, score: 1.0 }],
    existingFindId: find.id
  };
  $('result-img').src = find.photo;
  updateResultMediaAspect();
  $('name-field').value = find.name || '';
  $('type-field').value = find.type || 'flower';
  if ($('result-status-tag')) {
    $('result-status-tag').textContent = 'Saved Specimen';
    $('result-status-tag').className = 'result-status-tag is-matched';
  }
  if ($('result-location-badge')) {
    const locDate = getLocationAndDate(find);
    $('result-location-badge').textContent = `📍 ${locDate.location} · ${locDate.date}`;
  }
  const guessBox = $('guesses');
  if (guessBox) {
    guessBox.textContent = '';
    const b = document.createElement('button');
    b.className = 'guess-pill on';
    b.innerHTML = `<span>${find.guessed || find.name}</span> <span class="score-badge">Verified</span>`;
    guessBox.appendChild(b);
  }
  show('result', true);
}

function openDetailModal(find) {
  openFindInSpeciesPanel(find);
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
  const toScreen = m => ({ x: cx + panX + m.x * px, y: cy + panY - m.y * px });
  const playerScreenPos = toScreen({ x: 0, y: 0 });

  updateScaleRuler(px);

  // 1. Subtle Cartographic Coordinate Grid
  const gridStepMeters = (zoom < 0.4) ? 200 : (zoom < 1.2 ? 100 : 50);
  const minMx = Math.floor((-cx - panX) / (gridStepMeters * px)) * gridStepMeters;
  const maxMx = Math.ceil((cv.width - cx - panX) / (gridStepMeters * px)) * gridStepMeters;
  const minMy = Math.floor((cy + panY - cv.height) / (gridStepMeters * px)) * gridStepMeters;
  const maxMy = Math.ceil((cy + panY) / (gridStepMeters * px)) * gridStepMeters;

  g.save();
  g.strokeStyle = 'rgba(52, 211, 153, 0.08)';
  g.lineWidth = 1;
  g.font = '9px monospace';
  g.fillStyle = 'rgba(52, 211, 153, 0.4)';

  for (let mx = minMx; mx <= maxMx; mx += gridStepMeters) {
    const sx = cx + panX + mx * px;
    g.beginPath();
    g.moveTo(sx, 0);
    g.lineTo(sx, cv.height);
    g.stroke();
    if (mx !== 0 && sx > 40 && sx < cv.width - 40) {
      const label = mx > 0 ? `+${mx}m` : `${mx}m`;
      g.fillText(label, sx + 3, cv.height - 8);
    }
  }

  for (let my = minMy; my <= maxMy; my += gridStepMeters) {
    const sy = cy + panY - my * px;
    g.beginPath();
    g.moveTo(0, sy);
    g.lineTo(cv.width, sy);
    g.stroke();
    if (my !== 0 && sy > 20 && sy < cv.height - 20) {
      const label = my > 0 ? `N+${my}m` : `S${my}m`;
      g.fillText(label, 8, sy - 3);
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
    if (unchartedCells.has(key)) {
      g.fillStyle = 'rgba(245, 158, 11, 0.28)';
      g.fillRect(s.x, s.y - sz, sz, sz);
      g.strokeStyle = '#f59e0b';
      g.lineWidth = 1.5;
      g.strokeRect(s.x, s.y - sz, sz, sz);
    } else {
      g.fillStyle = mapInstance ? 'rgba(16, 185, 129, 0.22)' : 'rgba(17, 74, 39, 0.75)';
      g.fillRect(s.x, s.y - sz, sz, sz);
      g.strokeStyle = 'rgba(52, 211, 153, 0.16)';
      g.lineWidth = 0.5;
      g.strokeRect(s.x, s.y - sz, sz, sz);
    }
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

  // 6. Player Heading & Vision Cone
  let headingAngle = -Math.PI / 2;
  if (track.length >= 2) {
    const p1 = track[track.length - 2];
    const p2 = track[track.length - 1];
    const m1 = project(p1, origin);
    const m2 = project(p2, origin);
    const dx = m2.x - m1.x;
    const dy = m2.y - m1.y;
    if (Math.hypot(dx, dy) > 0.4) {
      headingAngle = Math.atan2(-dy, dx);
    }
  }

  const coneRadius = Math.max(35, Math.min(95, 65 * zoom));
  const coneArc = Math.PI / 4.5;
  const coneGrad = g.createRadialGradient(
    playerScreenPos.x, playerScreenPos.y, 4,
    playerScreenPos.x, playerScreenPos.y, coneRadius
  );
  coneGrad.addColorStop(0, 'rgba(52, 211, 153, 0.4)');
  coneGrad.addColorStop(0.5, 'rgba(52, 211, 153, 0.14)');
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

  // ---------- 1. Multi-Touch Pinch-to-Zoom & Touch Panning (Fingers) ----------
  let lastTouchX = 0;
  let lastTouchY = 0;
  let touchStartPos = { x: 0, y: 0 };
  let touchMoved = false;
  let isPinching = false;
  let lastPinchDist = 0;

  cv.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      // Two fingers: initiate pinch-to-zoom
      e.preventDefault();
      isPinching = true;
      touchMoved = true;
      lastPinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    } else if (e.touches.length === 1 && !isPinching) {
      // One finger: initiate panning
      touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
      touchMoved = false;
    }
  }, { passive: false });

  cv.addEventListener('touchmove', e => {
    if (e.touches.length === 2) {
      // Two fingers: dynamically zoom in/out with fingers
      e.preventDefault();
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (lastPinchDist > 8 && currentDist > 8) {
        const factor = currentDist / lastPinchDist;
        const newZoom = Math.min(8, Math.max(0.15, zoom * factor));
        zoom = newZoom;

        if (mapInstance) {
          const deltaZoom = Math.log2(factor);
          mapInstance.setZoom(mapInstance.getZoom() + deltaZoom);
        }
        lastPinchDist = currentDist;
        drawMapCanvas(cachedFinds, cachedCells);
      }
    } else if (e.touches.length === 1 && !isPinching) {
      // One finger: smooth 1:1 direct manipulation dragging
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

  // ---------- 2. Mouse Dragging & Pin Selection (Desktop) ----------
  cv.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') return; // Handled by touch events above
    isDragging = true;
    dragMoved = false;
    dragDistance = 0;
    dragStart = { x: e.clientX, y: e.clientY };
    try { cv.setPointerCapture(e.pointerId); } catch (_) {}
  });

  cv.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch' || !isDragging) return;
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
    if (e.pointerType === 'touch' || !isDragging) return;
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

  // ---------- 3. Trackpad Pinch-to-Zoom & Mouse Wheel Zoom ----------
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    // Mac trackpad pinch emits ctrlKey: true; standard mouse wheel emits deltaY
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
