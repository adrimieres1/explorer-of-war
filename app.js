// ============================================================
// Explorer of War — app.js  (v5 — zoom fix + fog scaling)
// ============================================================

const TILE_SIZE   = 256;
const MIN_DIST_M  = 3;
const STORAGE_KEY = 'eow_v5';
const MAX_TRAIL   = 5000;
const OSM_CACHE_R = 0.0008;
const FALLBACK_R_M = 30;

let zoom      = 15;
let centerLat = 43.3619, centerLon = -5.8494;
let offsetX   = 0, offsetY = 0;
let lastPos   = null;
let totalDist = 0;
let trailPts  = [];
let streetSegs = [];
let autoCenter = true;
let watchId   = null;
let demoTimer = null;
let isDragging = false, dragStart = null, pinchDist = null;
const osmQueried = new Set();

const baseCanvas  = document.getElementById('base-map');
const trailCanvas = document.getElementById('trail-canvas');
const fogCanvas   = document.getElementById('fog-canvas');
const baseCtx  = baseCanvas.getContext('2d');
const trailCtx = trailCanvas.getContext('2d');
const fogCtx   = fogCanvas.getContext('2d');
const playerMarker = document.getElementById('player-marker');
const accuracyRing = document.getElementById('accuracy-ring');
const coordTag     = document.getElementById('coord-tag');

const tileCache = {};
function getTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (tileCache[key]) return tileCache[key];
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  img.onload = () => { tileCache[key] = img; drawBase(); };
  tileCache[key] = null;
  return null;
}

function mercY(lat) {
  const c = Math.max(-85.051129, Math.min(85.051129, lat));
  const r = c * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
}

// latLonToPixel usa SIEMPRE el zoom global — garantiza que
// base + fog + trail usan el mismo sistema de coordenadas
function latLonToPixel(lat, lon) {
  const n  = Math.pow(2, zoom);
  const cx = ((centerLon + 180) / 360) * n * TILE_SIZE;
  const cy = mercY(centerLat) * n * TILE_SIZE;
  const px = ((lon + 180) / 360) * n * TILE_SIZE;
  const py = mercY(lat) * n * TILE_SIZE;
  const w = fogCanvas.width, h = fogCanvas.height;
  return { x: w/2 + (px-cx) + offsetX, y: h/2 + (py-cy) + offsetY };
}

// metros reales → píxeles en pantalla (escala automáticamente con zoom)
function metersToPixels(meters, lat) {
  const mpp = (156543.03392 * Math.cos(lat * Math.PI / 180)) / Math.pow(2, zoom);
  return meters / mpp;
}

function drawBase() {
  const w = baseCanvas.width, h = baseCanvas.height;
  baseCtx.fillStyle = '#101a10';
  baseCtx.fillRect(0, 0, w, h);

  // OSM sirve tiles 0-19; si zoom>19 escalamos el tile
  const tileZ    = Math.max(0, Math.min(19, Math.round(zoom)));
  const scale    = Math.pow(2, zoom - tileZ);
  const tileSize = TILE_SIZE * scale;
  const n  = Math.pow(2, tileZ);
  const cx = ((centerLon + 180) / 360) * n * tileSize;
  const cy = mercY(centerLat) * n * tileSize;

  const x0 = Math.floor((cx - w/2 - offsetX) / tileSize) - 1;
  const y0 = Math.floor((cy - h/2 - offsetY) / tileSize) - 1;
  const x1 = Math.ceil((cx  + w/2 - offsetX) / tileSize) + 1;
  const y1 = Math.ceil((cy  + h/2 - offsetY) / tileSize) + 1;

  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      if (ty < 0 || ty >= n) continue;
      const px = Math.round(w/2 + tx*tileSize - cx + offsetX);
      const py = Math.round(h/2 + ty*tileSize - cy + offsetY);
      const ts = Math.ceil(tileSize) + 1;
      const wx = ((tx % n) + n) % n;
      const img = getTile(tileZ, wx, ty);
      if (img && img.complete && img.naturalWidth > 0) {
        baseCtx.drawImage(img, px, py, ts, ts);
      } else {
        baseCtx.fillStyle = '#0e1810';
        baseCtx.fillRect(px, py, ts, ts);
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

// FIX PRINCIPAL: el ancho se expresa en METROS y se convierte a px
// en cada frame → escala correctamente con cualquier nivel de zoom
function redrawFog() {
  const w = fogCanvas.width, h = fogCanvas.height;
  fogCtx.clearRect(0, 0, w, h);
  fogCtx.fillStyle = 'rgba(5,10,5,0.94)';
  fogCtx.fillRect(0, 0, w, h);
  if (streetSegs.length === 0 && trailPts.length === 0) return;

  fogCtx.globalCompositeOperation = 'destination-out';

  for (const seg of streetSegs) {
    if (!seg.nodes || seg.nodes.length < 2) continue;
    const refLat = seg.nodes[0].lat;
    const halfPx = metersToPixels((seg.width || 8) / 2, refLat);
    const pts    = seg.nodes.map(nd => latLonToPixel(nd.lat, nd.lon));
    fogCtx.save();
    fogCtx.lineWidth   = Math.max(2, halfPx * 2);
    fogCtx.lineCap     = 'round';
    fogCtx.lineJoin    = 'round';
    fogCtx.strokeStyle = 'rgba(0,0,0,1)';
    fogCtx.beginPath();
    pts.forEach((p, i) => i === 0 ? fogCtx.moveTo(p.x, p.y) : fogCtx.lineTo(p.x, p.y));
    fogCtx.stroke();
    fogCtx.restore();
  }

  for (const pt of trailPts) {
    if (pt.hasStreet) continue;
    const { x, y } = latLonToPixel(pt.lat, pt.lon);
    const r = metersToPixels(FALLBACK_R_M, pt.lat);
    const g = fogCtx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    fogCtx.fillStyle = g;
    fogCtx.beginPath();
    fogCtx.arc(x, y, r, 0, Math.PI * 2);
    fogCtx.fill();
  }

  fogCtx.globalCompositeOperation = 'source-over';
}

function redrawAll() { drawBase(); redrawTrail(); redrawFog(); }

function resizeCanvases() {
  const c = document.getElementById('map-container');
  const w = c.clientWidth, h = c.clientHeight;
  [baseCanvas, trailCanvas, fogCanvas].forEach(cv => { cv.width = w; cv.height = h; });
  redrawAll();
  if (lastPos) updateMarker(lastPos.lat, lastPos.lon);
}

function updateMarker(lat, lon, accuracy) {
  const { x, y } = latLonToPixel(lat, lon);
  playerMarker.style.left    = x + 'px';
  playerMarker.style.top     = y + 'px';
  playerMarker.style.display = 'block';
  coordTag.textContent = `LAT ${lat.toFixed(5)}  LON ${lon.toFixed(5)}`;
  if (accuracy && accuracy < 500) {
    const rpx  = metersToPixels(accuracy, lat);
    const size = Math.max(20, Math.min(300, rpx * 2));
    accuracyRing.style.width   = size + 'px';
    accuracyRing.style.height  = size + 'px';
    accuracyRing.style.left    = x + 'px';
    accuracyRing.style.top     = y + 'px';
    accuracyRing.style.display = 'block';
  }
}

function updateStats() {
  document.getElementById('tile-count').textContent = trailPts.length;
  document.getElementById('dist-val').textContent   = (totalDist / 1000).toFixed(2);
  const n   = Math.pow(2, Math.round(zoom));
  document.getElementById('pct-val').textContent    = (trailPts.length / (n*n) * 100).toFixed(4);
}

function haversine(la1, lo1, la2, lo2) {
  const R = 6371000, d = v => v * Math.PI / 180;
  const a = Math.sin(d(la2-la1)/2)**2 + Math.cos(d(la1))*Math.cos(d(la2))*Math.sin(d(lo2-lo1)/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

let notifTimer = null;
function showNotif(msg) {
  const el = document.getElementById('notif');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(notifTimer);
  notifTimer = setTimeout(() => el.classList.remove('show'), 2500);
}
function setStatus(msg) { document.getElementById('status-msg').textContent = msg; }

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      pts: trailPts.slice(-MAX_TRAIL), segs: streetSegs.slice(-800),
      dist: totalDist, lat: lastPos ? lastPos.lat : centerLat,
      lon: lastPos ? lastPos.lon : centerLon, zoom
    }));
  } catch(e) {}
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (d.pts)  trailPts   = d.pts;
    if (d.segs) streetSegs = d.segs;
    if (d.dist) totalDist  = d.dist;
    if (d.lat)  centerLat  = d.lat;
    if (d.lon)  centerLon  = d.lon;
    if (d.zoom) zoom       = d.zoom;
    for (const pt of trailPts) osmQueried.add(osmCellKey(pt.lat, pt.lon));
    updateStats();
    return trailPts.length > 0 || streetSegs.length > 0;
  } catch(e) { return false; }
}

function osmCellKey(lat, lon) {
  return `${(lat/OSM_CACHE_R).toFixed(0)},${(lon/OSM_CACHE_R).toFixed(0)}`;
}

async function fetchStreetsNear(lat, lon) {
  const key = osmCellKey(lat, lon);
  if (osmQueried.has(key)) return;
  osmQueried.add(key);
  setStatus('Consultando calles OSM...');
  const r = 0.001;
  const query = `[out:json][timeout:10];way["highway"](${lat-r},${lon-r},${lat+r},${lon+r});(._;>;);out body;`;
  try {
    const res  = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', body: 'data=' + encodeURIComponent(query)
    });
    const data = await res.json();
    processOSMResponse(data, lat, lon);
    setStatus(`Calle detectada · ${trailPts.length} puntos`);
  } catch(e) { setStatus('Sin red, usando fallback circular'); }
}

function processOSMResponse(data, queryLat, queryLon) {
  if (!data || !data.elements) return;
  const nodes = {};
  for (const el of data.elements)
    if (el.type === 'node') nodes[el.id] = { lat: el.lat, lon: el.lon };
  for (const el of data.elements) {
    if (el.type !== 'way' || !el.nodes) continue;
    const segNodes = el.nodes.map(id => nodes[id]).filter(Boolean);
    if (segNodes.length < 2) continue;
    const width = streetWidth(el.tags && el.tags.highway);
    streetSegs.push({ nodes: segNodes, width });
    for (const pt of trailPts)
      if (haversine(pt.lat, pt.lon, queryLat, queryLon) < 120) pt.hasStreet = true;
  }
  saveData();
  redrawFog();
}

function streetWidth(hw) {
  return ({motorway:14,trunk:13,primary:12,secondary:11,tertiary:10,
           residential:9,service:6,footway:4,path:3,cycleway:4,
           living_street:8,unclassified:9,steps:3})[hw] || 8;
}

function onPosition(lat, lon, accuracy) {
  if (lastPos) {
    const d = haversine(lastPos.lat, lastPos.lon, lat, lon);
    if (d < MIN_DIST_M) return;
    totalDist += d;
  }
  trailPts.push({ lat, lon, hasStreet: false });
  if (trailPts.length > MAX_TRAIL) trailPts.shift();
  lastPos = { lat, lon };
  if (autoCenter) { centerLat = lat; centerLon = lon; }
  redrawAll();
  updateMarker(lat, lon, accuracy);
  updateStats();
  fetchStreetsNear(lat, lon);
  setStatus(`Posición actualizada · ${trailPts.length} puntos`);
  if (trailPts.length ===  10) showNotif('¡10 puntos explorados!');
  if (trailPts.length ===  50) showNotif('¡50 puntos! Vas bien 🗺️');
  if (trailPts.length === 100) showNotif('¡100 puntos! Explorer nivel 2');
  if (trailPts.length === 500) showNotif('¡500 puntos! Leyenda urbana 🏆');
}

function startGPS() {
  if (!('geolocation' in navigator)) { setStatus('GPS no disponible.'); return; }
  setStatus('Buscando señal GPS...');
  document.getElementById('gps-status').textContent = 'ON';
  document.getElementById('gps-dot').classList.add('active');
  watchId = navigator.geolocation.watchPosition(
    pos => {
      document.getElementById('gps-status').textContent = 'OK';
      onPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
    },
    err => {
      document.getElementById('gps-dot').classList.add('error');
      document.getElementById('gps-status').textContent = 'ERR';
      setStatus('Error GPS: ' + err.message);
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  );
}

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
  zoom = 16; centerLat = DEMO_ROUTE[0][0]; centerLon = DEMO_ROUTE[0][1];
  document.getElementById('gps-status').textContent = 'DEMO';
  document.getElementById('gps-dot').classList.add('active');
  setStatus('Modo demo — consultando calles de Oviedo en OSM...');
  let wpIdx = 0, t = 0;
  demoTimer = setInterval(() => {
    const a = DEMO_ROUTE[wpIdx % DEMO_ROUTE.length];
    const b = DEMO_ROUTE[(wpIdx + 1) % DEMO_ROUTE.length];
    onPosition(a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, 5);
    t += 0.06;
    if (t >= 1) { t = 0; wpIdx++; }
  }, 500);
}

// Zoom 0-21. Hace zoom hacia el punto bajo el cursor/dedo (pivotX, pivotY)
function changeZoom(delta, pivotX, pivotY) {
  const oldZoom = zoom;
  zoom = Math.min(21, Math.max(0, zoom + delta));
  if (zoom === oldZoom) return;
  const w = fogCanvas.width, h = fogCanvas.height;
  const px = (pivotX !== undefined) ? pivotX : w / 2;
  const py = (pivotY !== undefined) ? pivotY : h / 2;
  const factor = Math.pow(2, zoom - oldZoom);
  offsetX = px - (px - offsetX) * factor;
  offsetY = py - (py - offsetY) * factor;
  redrawAll();
  if (lastPos) updateMarker(lastPos.lat, lastPos.lon);
}

const mapEl = document.getElementById('map-container');

document.getElementById('zoom-in').addEventListener('click',  () => changeZoom(1));
document.getElementById('zoom-out').addEventListener('click', () => changeZoom(-1));
document.getElementById('center-btn').addEventListener('click', () => {
  autoCenter = true; offsetX = 0; offsetY = 0;
  if (lastPos) { centerLat = lastPos.lat; centerLon = lastPos.lon; }
  redrawAll();
  if (lastPos) updateMarker(lastPos.lat, lastPos.lon);
});

mapEl.addEventListener('mousedown', e => {
  isDragging = true;
  dragStart  = { x: e.clientX, y: e.clientY, ox: offsetX, oy: offsetY };
  autoCenter = false;
});
window.addEventListener('mouseup',   () => { isDragging = false; });
window.addEventListener('mousemove', e => {
  if (!isDragging) return;
  offsetX = dragStart.ox + (e.clientX - dragStart.x);
  offsetY = dragStart.oy + (e.clientY - dragStart.y);
  redrawAll();
  if (lastPos) updateMarker(lastPos.lat, lastPos.lon);
});

mapEl.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = mapEl.getBoundingClientRect();
  changeZoom(e.deltaY < 0 ? 1 : -1, e.clientX - rect.left, e.clientY - rect.top);
}, { passive: false });

mapEl.addEventListener('touchstart', e => {
  if (e.touches.length === 1) {
    isDragging = true;
    dragStart  = { x: e.touches[0].clientX, y: e.touches[0].clientY, ox: offsetX, oy: offsetY };
    autoCenter = false;
  } else if (e.touches.length === 2) {
    isDragging = false;
    pinchDist = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
  }
}, { passive: true });

mapEl.addEventListener('touchmove', e => {
  if (e.touches.length === 1 && isDragging && dragStart) {
    offsetX = dragStart.ox + (e.touches[0].clientX - dragStart.x);
    offsetY = dragStart.oy + (e.touches[0].clientY - dragStart.y);
    redrawAll();
    if (lastPos) updateMarker(lastPos.lat, lastPos.lon);
  } else if (e.touches.length === 2 && pinchDist !== null) {
    const dist = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
    if (Math.abs(dist - pinchDist) > 15) {
      const rect = mapEl.getBoundingClientRect();
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      changeZoom(dist > pinchDist ? 1 : -1, midX, midY);
      pinchDist = dist;
    }
  }
}, { passive: true });

mapEl.addEventListener('touchend', () => { isDragging = false; pinchDist = null; dragStart = null; });

document.getElementById('start-btn').addEventListener('click', () => {
  document.getElementById('start-overlay').style.display = 'none'; startGPS();
});
document.getElementById('demo-btn').addEventListener('click', () => {
  document.getElementById('start-overlay').style.display = 'none'; startDemo();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { resizeCanvases(); if (lastPos) updateMarker(lastPos.lat, lastPos.lon); }
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

window.addEventListener('resize', resizeCanvases);
const hasSaved = loadData();
if (hasSaved) {
  document.getElementById('saved-badge').style.display = 'block';
  setStatus(`Progreso cargado · ${trailPts.length} puntos explorados`);
}
resizeCanvases();
