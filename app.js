let map, userMarker, watchId = null, autoCenter = true;
let routeLine, altRouteLine;
const TOTAL_KM = ROUTE_DATA.totalKm;
let showAllKm = false;
let kmLabelLayers = [];
let kmDotLayers = [];
let lastProgress = { loaded: 0, total: 0, timestamp: 0 };
let stallTimer = null;

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
  addPOIs();

  const mid = Math.floor(routeCoords.length / 2);
  map.setView(routeCoords[mid], 13);
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
const poiVisible = { beach: false, exit: false, bridge: false, island: false, town: false, house: false, lagoon: false, airstrip: false };

function addPOIs() {
  const emojis = { beach: '🏖️', bridge: '🌉', exit: '🚗', island: '🏝️', town: '🏘️', house: '🏠', lagoon: '💧', airstrip: '🛩️' };

  ROUTE_DATA.pois.forEach(poi => {
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
      showInfo(html);
    });

    if (poiVisible[type] !== false) marker.addTo(map);
    if (!poiLayers[type]) poiLayers[type] = [];
    poiLayers[type].push(marker);
  });
}

function configureAvailableLayers() {
  const nonHospitalPOIs = ROUTE_DATA.pois.filter(p => p.type !== 'hospital');
  const hasHospitals = ROUTE_DATA.pois.some(p => p.type === 'hospital');
  if (nonHospitalPOIs.length === 0 && !hasHospitals) {
    document.getElementById('poi-toggle-btn').style.display = 'none';
  }
  if (!hasHospitals) {
    document.getElementById('hospital-btn').style.display = 'none';
  }
  Object.keys(poiVisible).forEach(type => {
    if (!ROUTE_DATA.pois.some(p => p.type === type)) {
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
  const hospitals = ROUTE_DATA.pois.filter(p => p.type === 'hospital');
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

function findNearestPOI(lat, lon) {
  let minDist = Infinity, nearest = null;
  ROUTE_DATA.pois.forEach(p => {
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
  const { latitude: lat, longitude: lon, accuracy } = pos.coords;

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
