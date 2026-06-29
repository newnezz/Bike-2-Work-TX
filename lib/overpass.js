const USER_AGENT = 'BikeToWorkTX/1.0 (https://bike2worktx.vercel.app; contact@example.com)';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const WIDE_RADIUS_METERS = 6437; // Overpass struggles above ~4 miles in one shot

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildOverpassQueries(lat, lon, radiusMeters) {
  const r = Math.round(radiusMeters);

  if (r > WIDE_RADIUS_METERS) {
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

async function runOverpassQuery(query, attempt) {
  if (attempt === undefined) attempt = 0;

  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: 'data=' + encodeURIComponent(query),
  });

  if ((response.status === 429 || response.status === 504) && attempt < 1) {
    await sleep(2000);
    return runOverpassQuery(query, attempt + 1);
  }

  if (!response.ok) {
    throw new Error(`Overpass returned ${response.status}`);
  }

  const data = await response.json();
  return data.elements || [];
}

async function fetchNearbyElements(lat, lon, radiusMeters) {
  const queries = buildOverpassQueries(lat, lon, radiusMeters);
  const elements = [];
  let failures = 0;

  for (let i = 0; i < queries.length; i += 1) {
    try {
      elements.push(...await runOverpassQuery(queries[i]));
    } catch (error) {
      failures += 1;
      console.error('Overpass batch failed:', error.message);
    }

    if (i < queries.length - 1) {
      await sleep(1200);
    }
  }

  if (!elements.length && failures === queries.length) {
    throw new Error('Nearby search timed out. Try a shorter bike distance or wait a moment.');
  }

  return elements;
}

module.exports = {
  buildOverpassQueries,
  fetchNearbyElements,
};
