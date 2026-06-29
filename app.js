(function () {
  'use strict';

  const MILES_TO_METERS = 1609.344;
  const SEARCH_COOLDOWN_SEC = 15;
  const COOLDOWN_STORAGE_KEY = 'b2w_cooldown_end';
  const CACHE_STORAGE_KEY = 'b2w_search_cache';
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const CACHE_MAX_ENTRIES = 10;
  const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
  const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
  const APP_EMAIL = 'bike-to-work@example.com';
  const OVERPASS_HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded' };

  const TEEN_EMPLOYMENT = {
    likely: {
      label: 'Likely OK for teens',
      className: 'ok',
      note: 'This type of business commonly hires 14–15 year olds in Texas for roles like cashier, stocking, or customer service — with hour limits.',
    },
    maybe: {
      label: 'Ask the employer',
      className: 'warn',
      note: 'May hire teens depending on the specific job duties. Confirm age, hours, and work permit requirements before applying.',
    },
    unlikely: {
      label: 'Unlikely / restricted',
      className: 'no',
      note: 'This category is often restricted for 14–15 year olds under Texas and federal child labor rules, or involves hazardous duties.',
    },
  };

  const CATEGORY_RULES = [
    { match: (tags) => tags.shop === 'supermarket' || tags.shop === 'grocery' || tags.shop === 'convenience', category: 'Grocery / convenience', eligibility: 'likely' },
    { match: (tags) => ['clothes', 'shoes', 'department_store', 'mall', 'gift', 'books', 'pet', 'toys', 'electronics', 'hardware', 'bicycle', 'sports'].includes(tags.shop), category: 'Retail', eligibility: 'likely' },
    { match: (tags) => tags.amenity === 'fast_food', category: 'Fast food', eligibility: 'likely' },
    { match: (tags) => tags.amenity === 'restaurant' || tags.amenity === 'cafe' || tags.amenity === 'ice_cream', category: 'Restaurant / cafe', eligibility: 'likely' },
    { match: (tags) => tags.amenity === 'cinema' || tags.amenity === 'theatre', category: 'Movie / theater', eligibility: 'likely' },
    { match: (tags) => tags.leisure === 'bowling_alley' || tags.amenity === 'amusement_arcade', category: 'Entertainment', eligibility: 'likely' },
    { match: (tags) => tags.amenity === 'library', category: 'Library', eligibility: 'maybe' },
    { match: (tags) => tags.amenity === 'community_centre' || tags.amenity === 'social_facility', category: 'Community / social', eligibility: 'maybe' },
    { match: (tags) => tags.shop === 'bakery', category: 'Bakery', eligibility: 'maybe' },
    { match: (tags) => tags.amenity === 'pharmacy' || tags.shop === 'chemist', category: 'Pharmacy', eligibility: 'maybe' },
    { match: (tags) => tags.tourism === 'hotel' || tags.tourism === 'motel', category: 'Hotel', eligibility: 'maybe' },
    { match: (tags) => tags.leisure === 'fitness_centre' || tags.leisure === 'sports_centre', category: 'Gym / recreation', eligibility: 'maybe' },
    { match: (tags) => tags.amenity === 'fuel' || tags.shop === 'gas', category: 'Gas station', eligibility: 'unlikely' },
    { match: (tags) => tags.amenity === 'bar' || tags.amenity === 'pub' || tags.amenity === 'nightclub', category: 'Bar / nightlife', eligibility: 'unlikely' },
    { match: (tags) => tags.industrial || tags.man_made === 'works' || tags.landuse === 'industrial', category: 'Industrial', eligibility: 'unlikely' },
    { match: (tags) => tags.amenity === 'construction' || tags.office === 'construction', category: 'Construction', eligibility: 'unlikely' },
    { match: (tags) => tags.amenity === 'warehouse' || tags.building === 'warehouse', category: 'Warehouse', eligibility: 'unlikely' },
    { match: (tags) => tags.shop === 'car' || tags.shop === 'car_repair', category: 'Auto / repair', eligibility: 'unlikely' },
  ];

  const form = document.getElementById('search-form');
  const statusEl = document.getElementById('status');
  const resultsSection = document.getElementById('results');
  const resultsTitle = document.getElementById('results-title');
  const resultsMeta = document.getElementById('results-meta');
  const placeList = document.getElementById('place-list');
  const sortSelect = document.getElementById('sort-select');
  const eligibleOnly = document.getElementById('eligible-only');
  const detailPanel = document.getElementById('detail-panel');
  const detailContent = document.getElementById('detail-content');
  const detailClose = document.getElementById('detail-close');
  const searchBtn = document.getElementById('search-btn');
  const cooldownMsg = document.getElementById('cooldown-msg');
  const distanceInput = document.getElementById('distance');
  const distanceBubbles = document.querySelectorAll('.distance-bubble');

  let map = null;
  let homeMarker = null;
  let radiusCircle = null;
  let placeMarkers = [];
  let allPlaces = [];
  let homeCoords = null;
  let selectedPlaceId = null;
  let searchAge = 15;
  let cooldownTimer = null;
  let cooldownEnd = 0;
  let searchInProgress = false;

  form.addEventListener('submit', onSearch);
  sortSelect.addEventListener('change', renderList);
  eligibleOnly.addEventListener('change', renderList);
  detailClose.addEventListener('click', hideDetail);
  distanceBubbles.forEach((bubble) => {
    bubble.addEventListener('click', () => selectDistance(bubble));
  });
  initCooldown();

  function setStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = 'status' + (type ? ' ' + type : '');
  }

  function selectDistance(selectedBubble) {
    distanceBubbles.forEach((bubble) => {
      const isSelected = bubble === selectedBubble;
      bubble.classList.toggle('is-selected', isSelected);
      bubble.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    });
    distanceInput.value = selectedBubble.dataset.miles;
  }

  function getSelectedMiles() {
    return parseFloat(distanceInput.value) || 1;
  }

  function getCooldownRemaining() {
    return Math.max(0, Math.ceil((cooldownEnd - Date.now()) / 1000));
  }

  function updateSearchButtonState() {
    searchBtn.disabled = searchInProgress || getCooldownRemaining() > 0;
  }

  function updateCooldownUI() {
    const remaining = getCooldownRemaining();

    if (remaining > 0) {
      cooldownMsg.classList.remove('hidden');
      cooldownMsg.textContent = `Wait ${remaining}s before searching again (keeps free map APIs happy).`;
    } else {
      cooldownMsg.classList.add('hidden');
      cooldownMsg.textContent = '';
      clearInterval(cooldownTimer);
      cooldownTimer = null;
    }

    updateSearchButtonState();
  }

  function startCooldown() {
    cooldownEnd = Date.now() + SEARCH_COOLDOWN_SEC * 1000;
    localStorage.setItem(COOLDOWN_STORAGE_KEY, String(cooldownEnd));
    updateCooldownUI();

    if (!cooldownTimer) {
      cooldownTimer = setInterval(updateCooldownUI, 1000);
    }
  }

  function initCooldown() {
    const stored = localStorage.getItem(COOLDOWN_STORAGE_KEY);
    cooldownEnd = stored ? parseInt(stored, 10) || 0 : 0;

    if (getCooldownRemaining() > 0) {
      updateCooldownUI();
      cooldownTimer = setInterval(updateCooldownUI, 1000);
    } else {
      updateSearchButtonState();
    }
  }

  function buildCacheKey(address, age, miles) {
    return `${address.toLowerCase().trim()}|${age}|${miles}`;
  }

  function readSearchCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function getCachedSearch(address, age, miles) {
    const entry = readSearchCache()[buildCacheKey(address, age, miles)];
    if (!entry) return null;
    if (Date.now() - entry.savedAt > CACHE_TTL_MS) return null;
    return entry;
  }

  function saveSearchCache(address, age, miles, payload) {
    const cache = readSearchCache();
    cache[buildCacheKey(address, age, miles)] = {
      home: payload.home,
      allPlaces: payload.allPlaces,
      miles: payload.miles,
      savedAt: Date.now(),
    };

    const keys = Object.keys(cache).sort((a, b) => cache[b].savedAt - cache[a].savedAt);
    while (keys.length > CACHE_MAX_ENTRIES) {
      delete cache[keys.pop()];
    }

    try {
      localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(cache));
    } catch (err) {
      console.warn('Could not save search cache:', err);
    }
  }

  function showSearchResults(home, age, miles, fromCache) {
    homeCoords = home;
    searchAge = age;
    const radiusMeters = miles * MILES_TO_METERS;

    ensureMap(home, radiusMeters);
    const visible = filteredPlaces();
    addPlaceMarkers(visible);

    resultsSection.classList.remove('hidden');
    resultsTitle.textContent = visible.length ? `${visible.length} places within ${miles} mi` : 'No places found';
    resultsMeta.textContent = `From ${home.displayName.split(',').slice(0, 3).join(',')} · Showing businesses likely to hire age ${age}`;
    renderList();

    const cacheNote = fromCache ? ' (saved on this device)' : '';
    if (!visible.length) {
      setStatus(`No teen-friendly businesses found within ${miles} miles. Try a longer distance or uncheck the age filter.${cacheNote}`, 'error');
    } else {
      setStatus(`Found ${allPlaces.length} businesses; showing ${visible.length} that match your age filter.${cacheNote}`);
    }

    setTimeout(() => map.invalidateSize(), 200);
  }

  function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function metersToMiles(m) {
    return m / MILES_TO_METERS;
  }

  function formatDistance(meters) {
    const miles = metersToMiles(meters);
    if (miles < 0.1) return `${Math.round(meters)} m`;
    return `${miles.toFixed(1)} mi`;
  }

  function estimateBikeMinutes(meters) {
    const mph = 10;
    const miles = metersToMiles(meters);
    return Math.max(1, Math.round((miles / mph) * 60));
  }

  function classifyPlace(tags, age) {
    for (const rule of CATEGORY_RULES) {
      if (rule.match(tags)) {
        const info = TEEN_EMPLOYMENT[rule.eligibility];
        return {
          category: rule.category,
          eligibility: rule.eligibility,
          badge: info,
          hiresAge: age >= 14 && rule.eligibility !== 'unlikely',
        };
      }
    }

    if (tags.shop || tags.amenity || tags.leisure || tags.office) {
      return {
        category: 'Other business',
        eligibility: 'maybe',
        badge: TEEN_EMPLOYMENT.maybe,
        hiresAge: age >= 14,
      };
    }

    return {
      category: 'Unknown',
      eligibility: 'maybe',
      badge: TEEN_EMPLOYMENT.maybe,
      hiresAge: age >= 14,
    };
  }

  function getPlaceName(tags) {
    return tags.name || tags.brand || tags.operator || 'Unnamed place';
  }

  function buildAddress(tags) {
    const parts = [
      tags['addr:housenumber'],
      tags['addr:street'],
      tags['addr:city'] || tags['addr:town'] || tags['addr:village'],
      tags['addr:state'],
      tags['addr:postcode'],
    ].filter(Boolean);
    return parts.join(', ') || tags['addr:full'] || '';
  }

  function getLatLon(element) {
    if (element.lat != null && element.lon != null) {
      return { lat: parseFloat(element.lat), lon: parseFloat(element.lon) };
    }
    if (element.center) {
      return { lat: parseFloat(element.center.lat), lon: parseFloat(element.center.lon) };
    }
    if (element.geometry && element.geometry.length) {
      const pt = element.geometry[0];
      return { lat: parseFloat(pt.lat), lon: parseFloat(pt.lon) };
    }
    return null;
  }

  function isTexasLocation(hit) {
    const state = String(hit.address?.state || '').toLowerCase();
    if (state.includes('texas')) return true;

    const display = String(hit.display_name || '').toLowerCase();
    return /,\s*texas\b/.test(display);
  }

  function friendlyError(err) {
    const msg = String(err?.message || err || '');
    if (!msg || msg === 'Failed to fetch' || msg === 'Load failed' || msg.includes('NetworkError')) {
      return 'Network error — check your connection and try again in a few seconds.';
    }
    return msg;
  }

  async function readApiError(res) {
    try {
      const data = await res.json();
      return data.error || `Request failed (${res.status})`;
    } catch {
      return `Request failed (${res.status})`;
    }
  }

  function buildOverpassQueries(lat, lon, radiusMeters) {
    const r = Math.round(radiusMeters);
    const wide = r > 6437;

    if (wide) {
      return [
        `[out:json][timeout:25];
(
  nwr(around:${r},${lat},${lon})["name"]["shop"~"supermarket|grocery|convenience|clothes|department_store|mall|books|bakery|chemist"];
  nwr(around:${r},${lat},${lon})["name"]["amenity"~"fast_food|restaurant|cafe|ice_cream|cinema|pharmacy|library|amusement_arcade"];
  nwr(around:${r},${lat},${lon})["name"]["leisure"~"bowling_alley|fitness_centre|sports_centre"];
  nwr(around:${r},${lat},${lon})["name"]["tourism"~"hotel|motel"];
  nwr(around:${r},${lat},${lon})["name"]["shop"~"shoes|gift|pet|toys|electronics|hardware|bicycle|sports"];
);
out center tags;`,
      ];
    }

    return [
      `[out:json][timeout:25];
(
  nwr(around:${r},${lat},${lon})["name"]["shop"~"supermarket|grocery|convenience|clothes|shoes|department_store|mall|gift|books|pet|toys|electronics|hardware|bicycle|sports|bakery|chemist"];
  nwr(around:${r},${lat},${lon})["name"]["amenity"~"fast_food|restaurant|cafe|ice_cream|pharmacy"];
);
out center tags;`,
      `[out:json][timeout:25];
(
  nwr(around:${r},${lat},${lon})["name"]["amenity"~"cinema|theatre|library|community_centre|social_facility|amusement_arcade"];
  nwr(around:${r},${lat},${lon})["name"]["leisure"~"bowling_alley|fitness_centre|sports_centre"];
  nwr(around:${r},${lat},${lon})["name"]["tourism"~"hotel|motel"];
);
out center tags;`,
    ];
  }

  async function runOverpassQuery(query) {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: OVERPASS_HEADERS,
      body: 'data=' + encodeURIComponent(query),
    });

    if (!res.ok) {
      throw new Error(`Overpass returned ${res.status}`);
    }

    const data = await res.json();
    return data.elements || [];
  }

  async function geocodeDirect(address) {
    const params = new URLSearchParams({
      q: address.includes('Texas') || address.includes(', TX') ? address : `${address}, Texas, USA`,
      format: 'jsonv2',
      addressdetails: '1',
      limit: '1',
      countrycodes: 'us',
      email: APP_EMAIL,
    });

    const res = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) throw new Error('Could not look up that address. Try adding city and ZIP.');
    return res.json();
  }

  async function geocodeAddress(address) {
    let data;

    try {
      const res = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`);
      if (res.ok) {
        data = await res.json();
      } else {
        data = await geocodeDirect(address);
      }
    } catch {
      data = await geocodeDirect(address);
    }

    if (!data.length) throw new Error('Address not found. Include street, city, and ZIP code.');

    const hit = data[0];
    if (!isTexasLocation(hit)) {
      throw new Error('This app is for Texas only. Please enter a Texas address.');
    }

    return {
      lat: parseFloat(hit.lat),
      lon: parseFloat(hit.lon),
      displayName: hit.display_name,
    };
  }

  async function fetchNearbyPlacesDirect(lat, lon, radiusMeters) {
    const queries = buildOverpassQueries(lat, lon, radiusMeters);
    const elements = [];
    let failures = 0;

    for (let i = 0; i < queries.length; i += 1) {
      try {
        elements.push(...await runOverpassQuery(queries[i]));
      } catch {
        failures += 1;
      }

      if (i < queries.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    }

    if (!elements.length && failures === queries.length) {
      throw new Error('Nearby search timed out. Try a shorter bike distance or wait a moment.');
    }

    return elements;
  }

  async function fetchNearbyPlaces(lat, lon, radiusMeters) {
    try {
      const res = await fetch('/api/places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lon, radiusMeters }),
      });

      if (res.status === 404) {
        return fetchNearbyPlacesDirect(lat, lon, radiusMeters);
      }

      if (!res.ok) {
        throw new Error(await readApiError(res));
      }

      const data = await res.json();
      return data.elements || [];
    } catch (err) {
      if (err.message && !['Failed to fetch', 'Load failed'].includes(err.message)) {
        throw err;
      }
      return fetchNearbyPlacesDirect(lat, lon, radiusMeters);
    }
  }

  function normalizePlaces(elements, home, age) {
    const seen = new Set();
    const places = [];

    for (const el of elements) {
      const coords = getLatLon(el);
      if (!coords) continue;

      const tags = el.tags || {};
      if (!tags.name) continue;

      const key = `${tags.name}|${coords.lat.toFixed(5)}|${coords.lon.toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const distance = haversineMeters(home.lat, home.lon, coords.lat, coords.lon);
      const classification = classifyPlace(tags, age);

      places.push({
        id: `${el.type}/${el.id}`,
        osmType: el.type,
        osmId: el.id,
        name: getPlaceName(tags),
        tags,
        lat: coords.lat,
        lon: coords.lon,
        distance,
        address: buildAddress(tags),
        phone: tags.phone || tags['contact:phone'] || '',
        website: tags.website || tags['contact:website'] || '',
        openingHours: tags.opening_hours || '',
        category: classification.category,
        eligibility: classification.eligibility,
        badge: classification.badge,
        hiresAge: classification.hiresAge,
      });
    }

    return places;
  }

  function ensureMap(center, radiusMeters) {
    if (!map) {
      map = L.map('map').setView([center.lat, center.lon], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);
    } else {
      map.setView([center.lat, center.lon], 14);
    }

    if (homeMarker) homeMarker.remove();
    if (radiusCircle) radiusCircle.remove();
    placeMarkers.forEach((m) => m.remove());
    placeMarkers = [];

    homeMarker = L.marker([center.lat, center.lon], { title: 'Your home' })
      .addTo(map)
      .bindPopup('<strong>Your address</strong>');

    radiusCircle = L.circle([center.lat, center.lon], {
      radius: radiusMeters,
      color: '#0d7a5f',
      fillColor: '#0d7a5f',
      fillOpacity: 0.08,
      weight: 2,
    }).addTo(map);
  }

  function markerColor(eligibility) {
    if (eligibility === 'likely') return '#15803d';
    if (eligibility === 'maybe') return '#b45309';
    return '#b91c1c';
  }

  function addPlaceMarkers(places) {
    places.forEach((place) => {
      const icon = L.divIcon({
        className: 'place-dot',
        html: `<span style="background:${markerColor(place.eligibility)};width:14px;height:14px;border:2px solid #fff;border-radius:50%;display:block;box-shadow:0 1px 4px rgba(0,0,0,.35);"></span>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

      const marker = L.marker([place.lat, place.lon], { icon })
        .addTo(map)
        .bindPopup(`<strong>${escapeHtml(place.name)}</strong><br>${escapeHtml(place.category)} · ${formatDistance(place.distance)}`)
        .on('click', () => selectPlace(place.id));

      marker.placeId = place.id;
      placeMarkers.push(marker);
    });

    const bounds = L.latLngBounds([[homeCoords.lat, homeCoords.lon]]);
    places.forEach((p) => bounds.extend([p.lat, p.lon]));
    if (places.length) map.fitBounds(bounds.pad(0.12));
  }

  function filteredPlaces() {
    let list = [...allPlaces];
    if (eligibleOnly.checked) {
      list = list.filter((p) => p.hiresAge && p.eligibility !== 'unlikely');
    }

    if (sortSelect.value === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      list.sort((a, b) => a.distance - b.distance);
    }

    return list;
  }

  function renderList() {
    const places = filteredPlaces();
    placeList.innerHTML = '';

    if (!places.length) {
      placeList.innerHTML = '<li class="place-meta" style="padding:1rem;">No matching places. Try a longer bike distance or uncheck the age filter.</li>';
      return;
    }

    places.forEach((place) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'place-item' + (place.id === selectedPlaceId ? ' active' : '');
      btn.dataset.id = place.id;
      btn.innerHTML = `
        <span class="place-name">${escapeHtml(place.name)}</span>
        <span class="place-meta">${escapeHtml(place.category)} · ${formatDistance(place.distance)} · ~${estimateBikeMinutes(place.distance)} min bike</span>
        <span class="badge ${place.badge.className}">${escapeHtml(place.badge.label)}</span>
      `;
      btn.addEventListener('click', () => selectPlace(place.id));
      li.appendChild(btn);
      placeList.appendChild(li);
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function selectPlace(id) {
    selectedPlaceId = id;
    const place = allPlaces.find((p) => p.id === id);
    if (!place) return;

    renderList();
    showDetail(place);

    const marker = placeMarkers.find((m) => m.placeId === id);
    if (marker) {
      marker.openPopup();
      map.panTo([place.lat, place.lon]);
    }
  }

  function showDetail(place) {
    const phoneLink = place.phone
      ? `<a class="primary" href="tel:${place.phone.replace(/[^\d+]/g, '')}">Call ${escapeHtml(place.phone)}</a>`
      : '';

    const websiteLink = place.website
      ? `<a href="${escapeHtml(normalizeUrl(place.website))}" target="_blank" rel="noopener">Website</a>`
      : '';

    const mapsLink = `<a href="https://www.openstreetmap.org/${place.osmType}/${place.osmId}" target="_blank" rel="noopener">OpenStreetMap</a>`;
    const directionsLink = `<a href="https://www.openstreetmap.org/directions?engine=fossgis_osrm_bike&route=${homeCoords.lat}%2C${homeCoords.lon}%3B${place.lat}%2C${place.lon}" target="_blank" rel="noopener">Bike directions</a>`;

    const ageTips = searchAge <= 15
      ? `<div class="tips-box"><strong>Before you apply (age ${searchAge}):</strong> Ask about a Texas work permit, confirm they hire at your age, and verify your schedule fits school-hour limits (max 3 hrs on school days, no work during school hours).</div>`
      : '';

    detailContent.innerHTML = `
      <h3>${escapeHtml(place.name)}</h3>
      <span class="badge ${place.badge.className}">${escapeHtml(place.badge.label)}</span>
      <p>${escapeHtml(place.badge.note)}</p>
      <div class="detail-grid">
        <div class="detail-row">
          <span class="detail-label">Category</span>
          <span>${escapeHtml(place.category)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Distance</span>
          <span>${formatDistance(place.distance)} straight-line · ~${estimateBikeMinutes(place.distance)} min at 10 mph</span>
        </div>
        ${place.address ? `<div class="detail-row"><span class="detail-label">Address</span><span>${escapeHtml(place.address)}</span></div>` : ''}
        ${place.phone ? `<div class="detail-row"><span class="detail-label">Phone</span><span>${escapeHtml(place.phone)}</span></div>` : ''}
        ${place.openingHours ? `<div class="detail-row"><span class="detail-label">Hours (OSM)</span><span>${escapeHtml(place.openingHours)}</span></div>` : ''}
      </div>
      <div class="detail-actions">
        ${phoneLink}
        ${websiteLink}
        ${directionsLink}
        ${mapsLink}
      </div>
      ${ageTips}
      <p class="place-meta" style="margin-top:1rem;">Contact info comes from OpenStreetMap and may be outdated. Call or visit to ask if they are hiring.</p>
    `;

    detailPanel.classList.remove('hidden');
  }

  function hideDetail() {
    detailPanel.classList.add('hidden');
    selectedPlaceId = null;
    renderList();
  }

  function normalizeUrl(url) {
    if (/^https?:\/\//i.test(url)) return url;
    return 'https://' + url;
  }

  async function onSearch(event) {
    event.preventDefault();

    const address = document.getElementById('address').value.trim();
    const age = parseInt(document.getElementById('age').value, 10);
    const miles = getSelectedMiles();

    if (age < 14) {
      setStatus('Texas law generally requires you to be at least 14 for most jobs. Talk to a parent and TWC about exceptions.', 'error');
      return;
    }

    searchAge = age;
    hideDetail();
    resultsSection.classList.add('hidden');

    const cached = getCachedSearch(address, age, miles);
    if (cached) {
      allPlaces = cached.allPlaces;
      showSearchResults(cached.home, age, miles, true);
      return;
    }

    const remaining = getCooldownRemaining();
    if (remaining > 0) {
      setStatus(`Please wait ${remaining}s before searching again.`, 'error');
      updateCooldownUI();
      return;
    }

    searchInProgress = true;
    updateSearchButtonState();

    setStatus('Looking up your address…', 'loading');

    try {
      const home = await geocodeAddress(address);
      const radiusMeters = miles * MILES_TO_METERS;

      setStatus('Searching for nearby businesses…', 'loading');
      const elements = await fetchNearbyPlaces(home.lat, home.lon, radiusMeters);
      allPlaces = normalizePlaces(elements, home, age);

      saveSearchCache(address, age, miles, { home, allPlaces, miles });
      showSearchResults(home, age, miles, false);
    } catch (err) {
      console.error(err);
      setStatus(friendlyError(err), 'error');
    } finally {
      searchInProgress = false;
      startCooldown();
    }
  }
})();
