let map, userMarker, watchId = null, autoCenter = true;
let routeLine, altRouteLine;
const TOTAL_KM = ROUTE_DATA.totalKm;
const ALL_POIS = [
  ...(ROUTE_DATA.pois || []),
  ...(typeof SHEET_POIS === 'undefined' ? [] : SHEET_POIS)
];
let showAllKm = false;
let kmLabelLayers = [];
let kmDotLayers = [];
let controlPointLayers = [];
let showControlPoints = true;
let savedNotes = [];
let noteLayers = [];
let speedSamples = [];
let compassActive = false;
let compassEventName = null;
let lastNoteEditorOpenedAt = 0;
let lastProgress = { loaded: 0, total: 0, timestamp: 0 };
let stallTimer = null;

const NOTES_STORAGE_KEY = 'carinhanha-user-notes-v1';

const TRANSPARENT_TILE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const OfflineTileLayer = L.TileLayer.extend({
  createTile: function(coords, done) {
    const tile = document.createElement('img');
    const z = String(coords.z);
    const x = String(coords.x);
    const y = coords.y;

    if (typeof TILE_INDEX !== 'undefined') {
      const zData = TILE_INDEX[z];
      if (!zData || !zData[x] || zData[x].indexOf(y) === -1) {
        tile.src = TRANSPARENT_TILE;
        setTimeout(() => done(null, tile), 0);
        return tile;
      }
    }

    L.DomEvent.on(tile, 'load', () => done(null, tile));
    L.DomEvent.on(tile, 'error', () => { tile.src = TRANSPARENT_TILE; done(null, tile); });
    tile.crossOrigin = '';
    tile.src = this.getTileUrl(coords);
    return tile;
  }
});

function initMap() {
  const routeCoords = ROUTE_DATA.route.map(p => [p[1], p[0]]);
  const routeBounds = L.latLngBounds(routeCoords);

  map = L.map('map', {
    zoomControl: true,
    attributionControl: false,
    maxZoom: 17,
    minZoom: 10,
    maxBounds: routeBounds.pad(0.3),
    maxBoundsViscosity: 0.8
  });

  new OfflineTileLayer('tiles/{z}/{x}/{y}.jpg', {
    maxZoom: 17,
    minZoom: 10,
    tileSize: 256,
    bounds: routeBounds.pad(0.15),
    keepBuffer: 6,
    updateWhenZooming: false,
    updateWhenIdle: true
  }).addTo(map);

  routeLine = L.polyline(routeCoords,
    { color: '#ff4444', weight: 3, opacity: 0.9 }
  ).addTo(map);

  if (ROUTE_DATA.altRoute.length > 0) {
    altRouteLine = L.polyline(
      ROUTE_DATA.altRoute.map(p => [p[1], p[0]]),
      { color: '#ffaa00', weight: 2, opacity: 0.7, dashArray: '8,6' }
    ).addTo(map);
  }

  addKmMarkers();
  addControlPoints();
  addPOIs();
  loadSavedNotes();
  setupNoteCreation();

  const mid = Math.floor(routeCoords.length / 2);
  map.setView(routeCoords[mid], 13);
}

function addControlPoints() {
  controlPointLayers.forEach(layer => map.removeLayer(layer));
  controlPointLayers = [];

  (ROUTE_DATA.controlPoints || []).forEach(point => {
    const marker = L.marker([point.lat, point.lon], {
      icon: L.divIcon({
        className: 'control-point-marker',
        html: `<span>${point.id}</span>`,
        iconSize: [44, 22],
        iconAnchor: [8, 11]
      }),
      zIndexOffset: 500
    }).on('click', () => {
      showInfo(
        `<h3>📍 Ponto ${point.id}</h3>` +
        `<p>Km ${point.km.toFixed(2)}</p>` +
        `<p>${point.lat.toFixed(7)}, ${point.lon.toFixed(7)}</p>`
      );
    });
    if (showControlPoints) marker.addTo(map);
    controlPointLayers.push(marker);
  });
}

function toggleControlPoints() {
  showControlPoints = !showControlPoints;
  document.getElementById('points-toggle-btn').classList.toggle('active', showControlPoints);
  controlPointLayers.forEach(marker => {
    if (showControlPoints) marker.addTo(map);
    else map.removeLayer(marker);
  });
}

function addKmMarkers() {
  kmLabelLayers.forEach(l => map.removeLayer(l));
  kmDotLayers.forEach(l => map.removeLayer(l));
  kmLabelLayers = [];
  kmDotLayers = [];

  ROUTE_DATA.kmMarkers.forEach(m => {
    const isStart = m.km === 0;
    const isEnd = Math.abs(m.km - TOTAL_KM) < 0.01;
    const isMajor = m.km % 10 === 0;
    const isMinor = m.km % 5 === 0;

    const showLabel = showAllKm
      ? true
      : (isStart || isEnd || isMajor);

    if (showLabel) {
      const label = isStart ? 'INÍCIO' : isEnd ? 'FIM' : `${m.km} km`;
      const fontSize = showAllKm ? (isMajor ? 13 : 10) : (isMajor ? 13 : 11);
      const layer = L.marker([m.lat, m.lon], {
        icon: L.divIcon({
          className: 'km-marker-label',
          html: `<span style="font-size:${fontSize}px">${label}</span>`,
          iconSize: [60, 16],
          iconAnchor: [30, 8]
        })
      }).addTo(map);
      kmLabelLayers.push(layer);
    }

    const radius = showAllKm
      ? (isMajor ? 4 : 2.5)
      : (isMajor ? 4 : isMinor ? 2.5 : 1.5);
    const opacity = showAllKm
      ? (isMajor ? 0.9 : 0.7)
      : (isMajor ? 0.9 : isMinor ? 0.6 : 0.3);

    const dot = L.circleMarker([m.lat, m.lon], {
      radius, fillColor: '#fff', fillOpacity: opacity,
      color: '#fff', weight: 0.5, opacity
    }).addTo(map).on('click', () => {
      showInfo(`<h3>Km ${m.km}</h3><p>Restam ${(TOTAL_KM - m.km).toFixed(1)} km</p>`);
    });
    kmDotLayers.push(dot);
  });
}

function toggleKmDetail() {
  showAllKm = !showAllKm;
  document.getElementById('km-toggle-btn').classList.toggle('active', showAllKm);
  addKmMarkers();
}

const poiLayers = {};
const poiVisible = { beach: false, exit: false, bridge: false, island: false, town: false, house: false, lagoon: false, health: false, airstrip: false };

function addPOIs() {
  const emojis = { beach: '🏖️', bridge: '🌉', exit: '🚗', island: '🏝️', town: '🏘️', house: '🏠', lagoon: '💧', health: '🏥', airstrip: '🛩️' };

  ALL_POIS.forEach(poi => {
    const type = poi.type || 'beach';
    if (type === 'hospital') return;
    const emoji = emojis[type] || '📍';
    const sz = [26, 26];

    const marker = L.marker([poi.lat, poi.lon], {
      icon: L.divIcon({
        className: 'poi-emoji',
        html: emoji,
        iconSize: sz,
        iconAnchor: [sz[0]/2, sz[1]/2]
      })
    }).on('click', () => {
      let html = `<h3>${emoji} ${poi.name}</h3>`;
      if (poi.info) html += `<p style="font-size:24px; margin:8px 0">${poi.info}</p>`;
      if (poi.phone) html += `<p>📞 <a href="tel:${poi.phone.replace(/[^+\d]/g,'')}" style="color:#4af">${poi.phone}</a></p>`;
      if (!poi.phone) html += `<p>${poi.lat.toFixed(5)}, ${poi.lon.toFixed(5)}</p>`;
      if (poi.sourceUrl) html += `<p><a href="${poi.sourceUrl}" target="_blank" rel="noopener" style="color:#4af">Fonte: ${poi.source}</a></p>`;
      showInfo(html);
    });

    if (poiVisible[type] !== false) marker.addTo(map);
    if (!poiLayers[type]) poiLayers[type] = [];
    poiLayers[type].push(marker);
  });
}

function configureAvailableLayers() {
  const nonHospitalPOIs = ALL_POIS.filter(p => p.type !== 'hospital');
  const hasHospitals = ALL_POIS.some(p => p.type === 'hospital');
  if (nonHospitalPOIs.length === 0 && !hasHospitals) {
    document.getElementById('poi-toggle-btn').style.display = 'none';
  }
  if (!hasHospitals) {
    document.getElementById('hospital-btn').style.display = 'none';
  }
  Object.keys(poiVisible).forEach(type => {
    if (!ALL_POIS.some(p => p.type === type)) {
      const button = document.getElementById('toggle-' + type);
      if (button) button.style.display = 'none';
    }
  });
}

function togglePOILayer(type) {
  poiVisible[type] = !poiVisible[type];
  const btn = document.getElementById('toggle-' + type);
  if (btn) btn.classList.toggle('active', poiVisible[type]);
  (poiLayers[type] || []).forEach(m => {
    if (poiVisible[type]) m.addTo(map);
    else map.removeLayer(m);
  });
}

function togglePOIDrawer() {
  document.getElementById('poi-drawer').classList.toggle('open');
  document.getElementById('poi-toggle-btn').classList.toggle('active');
}

function showHospitals() {
  const hospitals = ALL_POIS.filter(p => p.type === 'hospital');
  let userLat = null, userLon = null;
  if (userMarker) {
    const ll = userMarker.getLatLng();
    userLat = ll.lat;
    userLon = ll.lng;
  }

  let html = '<h3>🐍 Referências para acidentes com animais peçonhentos</h3>';
  hospitals.sort((a, b) => {
    if (!userLat) return 0;
    return haversine(userLat, userLon, a.lat, a.lon) - haversine(userLat, userLon, b.lat, b.lon);
  });

  hospitals.forEach(h => {
    let dist = '';
    if (userLat) {
      const km = haversine(userLat, userLon, h.lat, h.lon);
      dist = `<span style="color:#4af; font-weight:700">${km.toFixed(0)} km</span> — `;
    }
    html += `<div style="margin:12px 0; padding:10px; background:rgba(255,255,255,0.08); border-radius:8px">`;
    html += `<p style="font-weight:700; font-size:15px">${h.name}</p>`;
    html += `<p style="font-size:15px; margin:4px 0">${h.info}</p>`;
    html += `<p>${dist}📞 <a href="tel:${h.phone.replace(/[^+\d]/g,'')}" style="color:#4af">${h.phone}</a></p>`;
    if (h.sourceDate) html += `<p style="color:#aaa; font-size:11px">Fonte oficial: ${h.sourceDate.split('-').reverse().join('/')} · estoque não confirmado em tempo real</p>`;
    html += `</div>`;
  });

  if (!userLat) {
    html += '<p style="color:#888; font-size:12px; margin-top:8px">Ative o GPS para ver distâncias</p>';
  }

  showInfo(html);
}

function findNearestKm(lat, lon) {
  let minDist = Infinity, nearest = null;
  ROUTE_DATA.kmMarkers.forEach(m => {
    const d = haversine(lat, lon, m.lat, m.lon);
    if (d < minDist) { minDist = d; nearest = m; }
  });
  return nearest;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

function loadSavedNotes() {
  try {
    const stored = JSON.parse(localStorage.getItem(NOTES_STORAGE_KEY) || '[]');
    savedNotes = Array.isArray(stored) ? stored.filter(note =>
      Number.isFinite(note.lat) && Number.isFinite(note.lon) && typeof note.text === 'string'
    ) : [];
  } catch (error) {
    savedNotes = [];
  }
  renderSavedNotes();
}

function persistSavedNotes() {
  localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(savedNotes));
  renderSavedNotes();
}

function renderSavedNotes() {
  noteLayers.forEach(layer => map.removeLayer(layer));
  noteLayers = savedNotes.map(note => L.marker([note.lat, note.lon], {
    icon: L.divIcon({
      className: 'user-note-marker', html: '📌', iconSize: [30, 30], iconAnchor: [15, 28]
    }),
    zIndexOffset: 800
  }).addTo(map).on('click', () => showNoteDetails(note.id)));
  document.getElementById('notes-count').textContent = savedNotes.length;
  document.getElementById('notes-btn').classList.toggle('active', savedNotes.length > 0);
}

function setupNoteCreation() {
  let pressTimer = null;
  let pressedAt = null;
  const container = map.getContainer();

  const cancelPress = () => {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
    pressedAt = null;
  };

  L.DomEvent.on(container, 'touchstart', event => {
    if (event.touches.length !== 1) return;
    pressedAt = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    pressTimer = setTimeout(() => {
      const point = map.mouseEventToContainerPoint({ clientX: pressedAt.x, clientY: pressedAt.y });
      openNoteEditor(map.containerPointToLatLng(point));
      if (navigator.vibrate) navigator.vibrate(35);
      cancelPress();
    }, 650);
  });
  L.DomEvent.on(container, 'touchmove', event => {
    if (!pressedAt || event.touches.length !== 1) return;
    const dx = event.touches[0].clientX - pressedAt.x;
    const dy = event.touches[0].clientY - pressedAt.y;
    if (Math.hypot(dx, dy) > 12) cancelPress();
  });
  L.DomEvent.on(container, 'touchend touchcancel', cancelPress);
  map.on('contextmenu', event => openNoteEditor(event.latlng));
}

function openNoteEditor(latlng) {
  if (Date.now() - lastNoteEditorOpenedAt < 500) return;
  lastNoteEditorOpenedAt = Date.now();
  if (watchId !== null) {
    autoCenter = false;
    document.getElementById('center-btn').classList.remove('active');
  }
  showInfo(
    `<h3>📌 Nova anotação</h3>` +
    `<p>${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}</p>` +
    `<label for="note-text">O que há neste ponto?</label>` +
    `<textarea id="note-text" maxlength="240" placeholder="Ex.: Acampamento do dia 3"></textarea>` +
    `<button onclick="saveNote(${latlng.lat}, ${latlng.lng})">Salvar anotação</button>`
  );
  setTimeout(() => document.getElementById('note-text')?.focus(), 50);
}

function saveNote(lat, lon) {
  const input = document.getElementById('note-text');
  const text = input ? input.value.trim() : '';
  if (!text) {
    if (input) input.focus();
    return;
  }
  savedNotes.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    lat, lon, text, createdAt: new Date().toISOString()
  });
  persistSavedNotes();
  closeInfo();
}

function showNoteDetails(id) {
  const note = savedNotes.find(item => item.id === id);
  if (!note) return;
  const created = new Date(note.createdAt).toLocaleString('pt-BR');
  showInfo(
    `<h3>📌 Anotação</h3>` +
    `<p style="font-size:16px; color:#fff">${escapeHtml(note.text)}</p>` +
    `<p>${note.lat.toFixed(5)}, ${note.lon.toFixed(5)} · ${created}</p>` +
    `<button class="danger-action" onclick="deleteNote('${note.id}')">Excluir anotação</button>`
  );
}

function deleteNote(id) {
  savedNotes = savedNotes.filter(note => note.id !== id);
  persistSavedNotes();
  closeInfo();
}

function showSavedNotes() {
  let html = '<h3>📝 Minhas anotações</h3>';
  if (savedNotes.length === 0) {
    html += '<p>Pressione e segure qualquer ponto do mapa para criar uma anotação.</p>';
  } else {
    savedNotes.forEach(note => {
      html += `<div class="note-card" onclick="focusNote('${note.id}')">`;
      html += `<p style="color:#fff; font-weight:700">${escapeHtml(note.text)}</p>`;
      html += `<p>${note.lat.toFixed(5)}, ${note.lon.toFixed(5)}</p></div>`;
    });
    html += '<button onclick="exportNotes()">Exportar arquivo</button>';
  }
  html += '<p style="margin-top:10px">As anotações ficam somente neste aparelho até serem exportadas.</p>';
  showInfo(html);
}

function focusNote(id) {
  const note = savedNotes.find(item => item.id === id);
  if (!note) return;
  map.setView([note.lat, note.lon], Math.max(map.getZoom(), 16));
  showNoteDetails(id);
}

async function exportNotes() {
  const payload = {
    app: 'Carinhanha 2026', exportedAt: new Date().toISOString(), notes: savedNotes
  };
  const filename = `carinhanha-anotacoes-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const file = new File([blob], filename, { type: 'application/json' });
  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ title: 'Anotações Carinhanha 2026', files: [file] });
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function updateSpeed(speedMetersPerSecond) {
  const display = document.getElementById('speed-display');
  if (!Number.isFinite(speedMetersPerSecond) || speedMetersPerSecond < 0) {
    if (speedSamples.length === 0) display.textContent = '-- km/h';
    return;
  }
  speedSamples.push(speedMetersPerSecond * 3.6);
  if (speedSamples.length > 5) speedSamples.shift();
  const smoothed = speedSamples.reduce((sum, speed) => sum + speed, 0) / speedSamples.length;
  display.textContent = `${smoothed < 0.5 ? '0.0' : smoothed.toFixed(1)} km/h`;
}

function compassHeading(event) {
  if (Number.isFinite(event.webkitCompassHeading)) return event.webkitCompassHeading;
  if (Number.isFinite(event.alpha)) return (360 - event.alpha + 360) % 360;
  return null;
}

function onCompass(event) {
  const heading = compassHeading(event);
  if (heading === null) return;
  document.getElementById('compass-needle').style.transform = `rotate(${-heading}deg)`;
  document.getElementById('compass-btn').classList.add('compass-live');
}

async function enableCompass() {
  if (compassActive) return;
  if (typeof DeviceOrientationEvent === 'undefined') {
    showInfo('<h3>🧭 Bússola indisponível</h3><p>Este aparelho não oferece orientação pelo navegador. A rosa dos ventos continua indicando o norte do mapa.</p>');
    return;
  }
  try {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== 'granted') throw new Error('permission-denied');
    }
    compassEventName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(compassEventName, onCompass, true);
    compassActive = true;
    document.getElementById('compass-btn').classList.add('active');
  } catch (error) {
    showInfo('<h3>🧭 Permissão necessária</h3><p>Permita o acesso aos sensores de movimento e orientação para ativar a bússola.</p>');
  }
}

function findNearestPOI(lat, lon) {
  let minDist = Infinity, nearest = null;
  ALL_POIS.forEach(p => {
    const d = haversine(lat, lon, p.lat, p.lon);
    if (d < minDist) { minDist = d; nearest = { ...p, dist: d }; }
  });
  return nearest;
}

function toggleGPS() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    document.getElementById('gps-btn').classList.remove('active');
    document.getElementById('center-btn').style.display = 'none';
    document.getElementById('coords-display').style.display = 'none';
    if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
    document.getElementById('km-display').textContent = '-- km';
    document.getElementById('remaining-display').textContent = 'Restam -- km';
    document.getElementById('speed-display').textContent = '-- km/h';
    speedSamples = [];
    return;
  }

  if (!navigator.geolocation) {
    alert('GPS não disponível neste dispositivo');
    return;
  }

  document.getElementById('gps-btn').classList.add('active');
  document.getElementById('center-btn').style.display = 'flex';
  document.getElementById('coords-display').style.display = 'block';
  autoCenter = true;
  document.getElementById('center-btn').classList.add('active');

  watchId = navigator.geolocation.watchPosition(
    onPosition,
    onPositionError,
    { enableHighAccuracy: true, timeout: 30000, maximumAge: 5000 }
  );
}

function onPosition(pos) {
  const { latitude: lat, longitude: lon, accuracy, speed } = pos.coords;

  if (!userMarker) {
    userMarker = L.marker([lat, lon], {
      icon: L.divIcon({ className: 'user-marker', iconSize: [20, 20], iconAnchor: [10, 10] }),
      zIndexOffset: 1000
    }).addTo(map);
  } else {
    userMarker.setLatLng([lat, lon]);
  }

  if (autoCenter) {
    map.setView([lat, lon], Math.max(map.getZoom(), 15));
  }

  const nearest = findNearestKm(lat, lon);
  if (nearest) {
    document.getElementById('km-display').textContent = `${nearest.km.toFixed(1)} km`;
    document.getElementById('remaining-display').textContent = `Restam ${(TOTAL_KM - nearest.km).toFixed(1)} km`;
  }

  document.getElementById('coords-display').textContent =
    `${lat.toFixed(5)}, ${lon.toFixed(5)} | ±${accuracy.toFixed(0)}m`;
  updateSpeed(speed);
}

function onPositionError(err) {
  if (err.code === 1) {
    alert('Permissão de GPS negada. Ative a localização nas configurações.');
  } else {
    console.warn('GPS error:', err.message);
  }
}

function toggleCenter() {
  autoCenter = !autoCenter;
  document.getElementById('center-btn').classList.toggle('active', autoCenter);
  if (autoCenter && userMarker) {
    map.setView(userMarker.getLatLng(), Math.max(map.getZoom(), 15));
  }
}

function showInfo(html) {
  document.getElementById('info-content').innerHTML = html;
  document.getElementById('info-panel').style.display = 'block';
}
function closeInfo() {
  document.getElementById('info-panel').style.display = 'none';
}

function updateProgress(loaded, total, cached) {
  const pct = Math.round((loaded / total) * 100);
  document.getElementById('progress-fill').style.width = pct + '%';
  if (cached > 0 && cached === loaded) {
    document.getElementById('progress-text').textContent = `${pct}% — Já baixado!`;
  } else {
    document.getElementById('progress-text').textContent = `${pct}% — ${loaded.toLocaleString()} de ${total.toLocaleString()} imagens`;
  }

  lastProgress = { loaded, total, timestamp: Date.now() };
  resetStallDetection();
}

function resetStallDetection() {
  if (stallTimer) clearTimeout(stallTimer);
  document.getElementById('resume-btn').style.display = 'none';

  stallTimer = setTimeout(() => {
    const pct = Math.round((lastProgress.loaded / lastProgress.total) * 100);
    if (pct < 100) {
      document.getElementById('resume-btn').style.display = 'inline-block';
    }
  }, 8000);
}

function resumeDownload() {
  document.getElementById('resume-btn').style.display = 'none';
  document.getElementById('progress-text').textContent = 'Retomando download...';
  startTilePreCache();
}

function hideLoading() {
  if (stallTimer) clearTimeout(stallTimer);
  const overlay = document.getElementById('loading-overlay');
  overlay.style.transition = 'opacity 0.5s';
  overlay.style.opacity = '0';
  setTimeout(() => overlay.style.display = 'none', 500);
}

function startTilePreCache() {
  if (!navigator.serviceWorker.controller) {
    setTimeout(startTilePreCache, 200);
    return;
  }

  const tiles = getTileList();
  document.getElementById('progress-text').textContent = `0% — 0 de ${tiles.length.toLocaleString('pt-BR')} imagens`;
  resetStallDetection();

  navigator.serviceWorker.controller.postMessage({
    type: 'precache-tiles',
    tiles: tiles
  });
}

navigator.serviceWorker.addEventListener('message', event => {
  if (event.data.type === 'cache-progress') {
    updateProgress(event.data.loaded, event.data.total, event.data.cached);
  }
  if (event.data.type === 'cache-complete') {
    if (stallTimer) clearTimeout(stallTimer);
    document.getElementById('resume-btn').style.display = 'none';
    document.getElementById('progress-text').textContent = 'Mapa pronto! Funciona offline ✓';
    document.getElementById('progress-fill').style.width = '100%';
    setTimeout(hideLoading, 1500);
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    if (navigator.serviceWorker.controller) {
      startTilePreCache();
    } else {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        startTilePreCache();
      });
    }
  }).catch(() => {
    hideLoading();
  });
} else {
  hideLoading();
}

initMap();
configureAvailableLayers();

map.on('movestart', () => {
  if (watchId !== null) {
    autoCenter = false;
    document.getElementById('center-btn').classList.remove('active');
  }
});
