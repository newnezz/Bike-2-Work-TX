const { fetchNearbyElements } = require('../lib/overpass');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Invalid request body.' });
    }
  }

  const lat = Number(body?.lat);
  const lon = Number(body?.lon);
  const radiusMeters = Number(body?.radiusMeters);

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radiusMeters)) {
    return res.status(400).json({ error: 'lat, lon, and radiusMeters are required.' });
  }

  if (radiusMeters <= 0 || radiusMeters > 3219) {
    return res.status(400).json({ error: 'Bike distance must be between 0.5 and 2 miles.' });
  }

  try {
    const elements = await fetchNearbyElements(lat, lon, radiusMeters);
    return res.status(200).json({ elements });
  } catch (error) {
    console.error('Places error:', error);
    return res.status(502).json({
      error: error.message || 'Nearby search failed. Try a shorter distance or wait a moment.',
    });
  }
};
