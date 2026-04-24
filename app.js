// ============================================================
// Explorer of War — app.js
// ============================================================

const TILE_SIZE   = 256;
const REVEAL_R    = 70;   // radio de niebla revelada (px a zoom 15)
const MIN_DIST_M  = 3;    // metros mínimos entre puntos
const STORAGE_KEY = 'eow_v3';
const MAX_TRAIL   = 5000; // puntos máximos en memoria

// ── Estado global ──────────────────────────────────────────
let zoom       = 15;
let centerLat  = 43.3619, centerLon = -5.8494; // Oviedo por defecto
let offsetX    = 0, offsetY = 0;
let lastPos    = null;
let totalDist  = 0;
let trailPts   = [];      // [{lat, lon}]
let autoCenter = true;
let watchId    = null;
let demoTimer  = null;
let isDragging = false;
let dragStart  = null;
let pinchDist  = null;

// ── Canvas ──────────────────────────────────────────────────
const baseCanvas  = document.getElementById('base-map');
const trailCanvas = document.getElementById('trail-canvas');
const fogCanvas   = document.getElementById('fog-canvas');
const baseCtx     = baseCanvas.getContext('2d');
const trailCtx    = trailCanvas.getContext('2d');
const fogCtx      = fogCanvas.getContext('2d');

const playerMarker  = document.getElementById('player-marker');
const accuracyRing  = document.getElementById('accuracy-ring');
const coordTag      = document.getElementById('coord-tag');

// ── Tile cache ──────────────────────────────────────────────
const tileCache = {};

function tileKey(z, x, y) { return `${z}/${x}/${y}`; }

function getTile(z, x, y) {
  const key = tileKey(z, x, y);
  if (tileCache[key]) return tileCache[key];
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  img.onload = () => { tileCache[key] = img; drawBase(); };
  tileCache[key] = null; // marca "cargando"
  return null;
}

// ── Proyección Mercator ─────────────────────────────────────
function mercY(lat) {
  const r = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
}

function latLonToPixel(lat, lon) {
  const n  = Math.pow(2, zoom);
  const cx = ((centerLon + 180) / 360) * n * TILE_SIZE;
  const cy = mercY(centerLat) * n * TILE_SIZE;
  const px = ((lon + 180) / 360) * n * TILE_SIZE;
  const py = mercY(lat) * n * TILE_SIZE;
  const w  = fogCanvas.width, h = fogCanvas.height;
  return {
    x: w / 2 + (px - cx) + offsetX,
    y: h / 2 + (py - cy) + offsetY
  };
}

function mPerPixel(lat) {
  // metros por pixel a este zoom
  return (156543.03392 * Math.cos(lat * Math.PI / 180)) / Math.pow(2, zoom);
}

// ── Redibujado ──────────────────────────────────────────────
function drawBase() {
  const w = baseCanvas.width, h = baseCanvas.height;
  baseCtx.fillStyle = '#101a10';
  baseCtx.fillRect(0, 0, w, h);

  const n   = Math.pow(2, zoom);
  const cx  = ((centerLon + 180) / 360) * n * TILE_SIZE;
  const cy  = mercY(centerLat) * n * TILE_SIZE;
  const x0  = Math.floor((cx - w / 2 - offsetX) / TILE_SIZE);
  const y0  = Math.floor((cy - h / 2 - offsetY) / TILE_SIZE);
  const x1  = Math.ceil((cx + w / 2 - offsetX) / TILE_SIZE);
  const y1  = Math.ceil((cy + h / 2 - offsetY) / TILE_SIZE);

  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      const px = w / 2 + tx * TILE_SIZE - cx + offsetX;
      const py = h / 2 + ty * TILE_SIZE - cy + offsetY;
      const wrappedX = ((tx % n) + n) % n;
      if (ty < 0 || ty >= n) continue;
      const img = getTile(zoom, wrappedX, ty);
      if (img && img.complete && img.naturalWidth > 0) {
        baseCtx.drawImage(img, px, py, TILE_SIZE, TILE_SIZE);
      } else {
        baseCtx.fillStyle = '#0e1810';
        baseCtx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      }
    }
  }
}

function redrawTrail() {
  const w = trailCanvas.width, h = trailCanvas.height;
  trailCtx.clearRect(0, 0, w, h);
  if (trailPts.length < 2) return;
  trailCtx.strokeStyle = 'rgba(77,255,145,0.55)';
  trailCtx.lineWidth   = 2.5;
  trailCtx.lineJoin    = 'round';
  trailCtx.lineCap     = 'round';
  trailCtx.beginPath();
  for (let i = 0; i < trailPts.length; i++) {
    const { x, y } = latLonToPixel(trailPts[i].lat, trailPts[i].lon);
    i === 0 ? trailCtx.moveTo(x, y) : trailCtx.lineTo(x, y);
  }
  trailCtx.stroke();
}

function redrawFog() {
  const w = fogCanvas.width, h = fogCanvas.height;
  fogCtx.clearRect(0, 0, w, h);
  fogCtx.fillStyle = 'rgba(5,10,5,0.94)';
  fogCtx.fillRect(0, 0, w, h);
  if (trailPts.length === 0) return;
  fogCtx.globalCompositeOperation = 'destination-out';
  for (const pt of trailPts) {
    const { x, y } = latLonToPixel(pt.lat, pt.lon);
    const r = REVEAL_R * (zoom / 15);
    const g = fogCtx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0,   'rgba(0,0,0,1)');
    g.addColorStop(0.55,'rgba(0,0,0,0.95)');
    g.addColorStop(1,   'rgba(0,0,0,0)');
    fogCtx.fillStyle = g;
    fogCtx.beginPath();
    fogCtx.arc(x, y, r, 0, Math.PI * 2);
    fogCtx.fill();
  }
  fogCtx.globalCompositeOperation = 'source-over';
}

function redrawAll() {
  drawBase();
  redrawTrail();
  redrawFog();
}

// ── Resize ──────────────────────────────────────────────────
function resizeCanvases() {
  const c = document.getElementById('map-container');
  const w = c.clientWidth, h = c.clientHeight;
  [baseCanvas, trailCanvas, fogCanvas].forEach(cv => {
    cv.width = w; cv.height = h;
  });
  redrawAll();
  if (lastPos) updateMarker(lastPos.lat, lastPos.lon);
}

// ── Marcador jugador ────────────────────────────────────────
function updateMarker(lat, lon, accuracy) {
  const { x, y } = latLonToPixel(lat, lon);
  playerMarker.style.left    = x + 'px';
  playerMarker.style.top     = y + 'px';
  playerMarker.style.display = 'block';
  coordTag.textContent = `LAT ${lat.toFixed(5)}  LON ${lon.toFixed(5)}`;

  if (accuracy && accuracy < 500) {
    const mpp  = mPerPixel(lat);
    const rpx  = (accuracy / mpp);
    const size = Math.max(20, Math.min(200, rpx * 2));
    accuracyRing.style.width   = size + 'px';
    accuracyRing.style.height  = size + 'px';
    accuracyRing.style.left    = x + 'px';
    accuracyRing.style.top     = y + 'px';
    accuracyRing.style.display = 'block';
  }
}

// ── Estadísticas ────────────────────────────────────────────
function updateStats() {
  document.getElementById('tile-count').textContent = trailPts.length;
  const km = (totalDist / 1000).toFixed(2);
  document.getElementById('dist-val').textContent = km;
  const n   = Math.pow(2, zoom);
  const pct = (trailPts.length / (n * n) * 100).toFixed(4);
  document.getElementById('pct-val').textContent = pct;
}

// ── Haversine ───────────────────────────────────────────────
function haversine(la1, lo1, la2, lo2) {
  const R  = 6371000;
  const d  = v => v * Math.PI / 180;
  const a  = Math.sin(d(la2 - la1) / 2) ** 2
           + Math.cos(d(la1)) * Math.cos(d(la2))
           * Math.sin(d(lo2 - lo1) / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Notificaciones ───────────────────────────────────────────
let notifTimer = null;
function showNotif(msg) {
  const el = document.getElementById('notif');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(notifTimer);
  notifTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

// ── Persistencia ─────────────────────────────────────────────
function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      pts: trailPts.slice(-MAX_TRAIL),
      dist: totalDist,
      lat: lastPos ? lastPos.lat : centerLat,
      lon: lastPos ? lastPos.lon : centerLon,
      zoom
    }));
  } catch(e) {}
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (d.pts)  trailPts   = d.pts;
    if (d.dist) totalDist  = d.dist;
    if (d.lat)  centerLat  = d.lat;
    if (d.lon)  centerLon  = d.lon;
    if (d.zoom) zoom       = d.zoom;
    updateStats();
    return trailPts.length > 0;
  } catch(e) { return false; }
}

// ── Nueva posición ───────────────────────────────────────────
function onPosition(lat, lon, accuracy) {
  if (lastPos) {
    const d = haversine(lastPos.lat, lastPos.lon, lat, lon);
    if (d < MIN_DIST_M) return;
    totalDist += d;
  }
  trailPts.push({ lat, lon });
  if (trailPts.length > MAX_TRAIL) trailPts.shift();
  lastPos = { lat, lon };

  if (autoCenter) { centerLat = lat; centerLon = lon; }
  redrawAll();
  updateMarker(lat, lon, accuracy);
  updateStats();
  saveData();

  setStatus(`Posición actualizada · ${trailPts.length} puntos`);

  // hitos
  if (trailPts.length === 10)   showNotif('¡10 puntos explorados!');
  if (trailPts.length === 50)   showNotif('¡50 puntos! Vas bien 🗺️');
  if (trailPts.length === 100)  showNotif('¡100 puntos! Explorer de nivel 2');
  if (trailPts.length === 500)  showNotif('¡500 puntos! Leyenda urbana 🏆');
}

function setStatus(msg) {
  document.getElementById('status-msg').textContent = msg;
}

// ── GPS ──────────────────────────────────────────────────────
function startGPS() {
  if (!('geolocation' in navigator)) {
    setStatus('GPS no disponible en este dispositivo.');
    return;
  }
  setStatus('Buscando señal GPS...');
  document.getElementById('gps-status').textContent = 'ON';
  document.getElementById('gps-dot').classList.add('active');

  const opts = { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 };
  watchId = navigator.geolocation.watchPosition(
    pos => {
      document.getElementById('gps-status').textContent = 'OK';
      onPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
    },
    err => {
      document.getElementById('gps-dot').classList.remove('active');
      document.getElementById('gps-dot').classList.add('error');
      document.getElementById('gps-status').textContent = 'ERR';
      setStatus('Error GPS: ' + err.message);
    },
    opts
  );
}

// ── Demo ─────────────────────────────────────────────────────
const DEMO_ROUTE = [
  [43.3619,-5.8494],[43.3625,-5.8479],[43.3633,-5.8466],
  [43.3641,-5.8453],[43.3648,-5.8440],[43.3643,-5.8424],
  [43.3633,-5.8415],[43.3622,-5.8420],[43.3611,-5.8432],
  [43.3604,-5.8448],[43.3607,-5.8462],[43.3613,-5.8476],
  [43.3619,-5.8494],[43.3626,-5.8508],[43.3617,-5.8518],
  [43.3607,-5.8510],[43.3600,-5.8496],[43.3605,-5.8480],
  [43.3619,-5.8494]
];

function startDemo() {
  zoom = 15;
  centerLat = DEMO_ROUTE[0][0];
  centerLon = DEMO_ROUTE[0][1];
  document.getElementById('gps-status').textContent = 'DEMO';
  document.getElementById('gps-dot').classList.add('active');
  setStatus('Modo demo — simulando paseo por Oviedo...');

  let wpIdx = 0, t = 0;
  demoTimer = setInterval(() => {
    const a = DEMO_ROUTE[wpIdx % DEMO_ROUTE.length];
    const b = DEMO_ROUTE[(wpIdx + 1) % DEMO_ROUTE.length];
    const lat = a[0] + (b[0] - a[0]) * t;
    const lon = a[1] + (b[1] - a[1]) * t;
    t += 0.04;
    if (t >= 1) { t = 0; wpIdx++; }
    onPosition(lat, lon, 10);
  }, 350);
}

// ── Controles de mapa ─────────────────────────────────────────
function changeZoom(delta) {
  zoom = Math.min(18, Math.max(3, zoom + delta));
  offsetX = 0; offsetY = 0;
  redrawAll();
  if (lastPos) updateMarker(lastPos.lat, lastPos.lon);
}

document.getElementById('zoom-in').addEventListener('click', () => changeZoom(1));
document.getElementById('zoom-out').addEventListener('click', () => changeZoom(-1));
document.getElementById('center-btn').addEventListener('click', () => {
  autoCenter = true;
  offsetX = 0; offsetY = 0;
  if (lastPos) { centerLat = lastPos.lat; centerLon = lastPos.lon; }
  redrawAll();
  if (lastPos) updateMarker(lastPos.lat, lastPos.lon);
});

// ── Arrastrar mapa (mouse) ────────────────────────────────────
const mapEl = document.getElementById('map-container');

mapEl.addEventListener('mousedown', e => {
  isDragging = true;
  dragStart  = { x: e.clientX, y: e.clientY, ox: offsetX, oy: offsetY };
  autoCenter = false;
});
window.addEventListener('mouseup', () => { isDragging = false; });
window.addEventListener('mousemove', e => {
  if (!isDragging) return;
  offsetX = dragStart.ox + (e.clientX - dragStart.x);
  offsetY = dragStart.oy + (e.clientY - dragStart.y);
  redrawAll();
  if (lastPos) updateMarker(lastPos.lat, lastPos.lon);
});

mapEl.addEventListener('wheel', e => {
  e.preventDefault();
  changeZoom(e.deltaY < 0 ? 1 : -1);
}, { passive: false });

// ── Touch ────────────────────────────────────────────────────
mapEl.addEventListener('touchstart', e => {
  if (e.touches.length === 1) {
    isDragging = true;
    dragStart  = { x: e.touches[0].clientX, y: e.touches[0].clientY, ox: offsetX, oy: offsetY };
    autoCenter = false;
  } else if (e.touches.length === 2) {
    isDragging = false;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    pinchDist = Math.hypot(dx, dy);
  }
}, { passive: true });

mapEl.addEventListener('touchmove', e => {
  if (e.touches.length === 1 && isDragging && dragStart) {
    offsetX = dragStart.ox + (e.touches[0].clientX - dragStart.x);
    offsetY = dragStart.oy + (e.touches[0].clientY - dragStart.y);
    redrawAll();
    if (lastPos) updateMarker(lastPos.lat, lastPos.lon);
  } else if (e.touches.length === 2 && pinchDist !== null) {
    const dx   = e.touches[0].clientX - e.touches[1].clientX;
    const dy   = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.hypot(dx, dy);
    if (Math.abs(dist - pinchDist) > 20) {
      changeZoom(dist > pinchDist ? 1 : -1);
      pinchDist = dist;
    }
  }
}, { passive: true });

mapEl.addEventListener('touchend', () => {
  isDragging = false;
  pinchDist  = null;
  dragStart  = null;
});

// ── Overlay buttons ───────────────────────────────────────────
document.getElementById('start-btn').addEventListener('click', () => {
  document.getElementById('start-overlay').style.display = 'none';
  startGPS();
});

document.getElementById('demo-btn').addEventListener('click', () => {
  document.getElementById('start-overlay').style.display = 'none';
  startDemo();
});

// ── Visibilidad (segundo plano) ───────────────────────────────
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    resizeCanvases();
    if (lastPos) updateMarker(lastPos.lat, lastPos.lon);
  }
});

// ── Service Worker ────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ── Init ──────────────────────────────────────────────────────
window.addEventListener('resize', resizeCanvases);
const hasSaved = loadData();
if (hasSaved) {
  document.getElementById('saved-badge').style.display = 'block';
  setStatus(`Progreso cargado · ${trailPts.length} puntos explorados`);
}
resizeCanvases();
