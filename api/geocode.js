const USER_AGENT = 'BikeToWorkTX/1.0 (https://bike2worktx.vercel.app; contact@example.com)';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const APP_EMAIL = 'bike-to-work@example.com';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const address = String(req.query.address || '').trim();
  if (!address) {
    return res.status(400).json({ error: 'Address is required.' });
  }

  const q = address.includes('Texas') || address.includes(', TX')
    ? address
    : `${address}, Texas, USA`;

  const params = new URLSearchParams({
    q,
    format: 'jsonv2',
    addressdetails: '1',
    limit: '1',
    countrycodes: 'us',
    email: APP_EMAIL,
  });

  try {
    const response = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
    });

    if (response.status === 429) {
      return res.status(429).json({ error: 'Too many address lookups. Wait a few seconds and try again.' });
    }

    if (!response.ok) {
      return res.status(502).json({ error: 'Could not look up that address. Try adding city and ZIP.' });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Geocode error:', error);
    return res.status(502).json({ error: 'Address lookup failed. Check your connection and try again.' });
  }
};
