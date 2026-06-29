# Bike to Work (Texas)

A simple web app to help Texas teens find nearby employers they can bike to. Enter a home address, age, and bike distance — the app shows a map and list of businesses with contact info when available.

**Live site:** [https://bike2worktx.vercel.app](https://bike2worktx.vercel.app)

---

## What it does

1. Geocodes a **Texas** home address.
2. Searches OpenStreetMap for named businesses within **0.5–2 miles**.
3. Labels each place by whether it is **likely OK**, **ask the employer**, or **unlikely** for teen hiring (based on business type + Texas/FLSA rules — not legal advice).
4. Shows results on a **Leaflet map** and a **clickable list** with phone, website, hours (when OSM has them), and bike directions links.

---

## Project files

| File | Purpose |
|------|---------|
| `index.html` | Page structure, search form, results layout |
| `styles.css` | All styling |
| `app.js` | Front-end logic: search, map, list, cache, cooldown |
| `api/geocode.js` | Vercel serverless proxy → Nominatim (address lookup) |
| `api/places.js` | Vercel serverless proxy → Overpass (nearby businesses) |
| `lib/overpass.js` | Overpass query builder + fetch (used by `api/places.js`) |
| `vercel.json` | Vercel config (clean URLs, function timeout) |

---

## External APIs (all free)

| Service | Used for | Notes |
|---------|----------|-------|
| **Nominatim** | Address → lat/lon | ~1 req/sec limit; server geocode often blocked from Vercel → browser fallback |
| **Overpass** (`overpass-api.de`) | Nearby POIs | Can timeout or 429 under load; queries kept small (max 2 mi) |
| **OpenStreetMap tiles** | Map background | Normal map use is fine |

There is **no API key**. Reliability is best-effort. Heavy use causes temporary errors.

---

## Phone-local caching

Repeated searches with the **same address, age, and distance** load instantly from the browser’s `localStorage` — no API calls, **no 15s cooldown**.

| Setting | Value |
|---------|-------|
| Storage key | `b2w_search_cache` |
| Cache lifetime | **24 hours** per entry |
| Max saved searches | **10** (oldest dropped) |
| Cache key | `address + age + miles` (case-insensitive address) |

Status message includes **“(saved on this device)”** when results come from cache.

To clear cache manually: browser dev tools → Application → Local Storage → delete `b2w_search_cache`, or clear site data for the app URL.

---

## Search cooldown

After a **live** API search (not cache), the app enforces a **15-second** wait before the next **new** search. Cached repeats skip the wait entirely.

| Setting | Value |
|---------|-------|
| Storage key | `b2w_cooldown_end` |
| Duration | **15 seconds** |

The countdown shows under the search button and persists across page reloads until it expires.

---

## Run locally

### Static files only (no API routes)

```bash
cd Bike-to-Work
python3 -m http.server 8765
```

Open `http://localhost:8765`. Geocode/places fall back to direct OSM calls from the browser (same as production fallback).

### With Vercel API routes (matches production)

```bash
npx vercel dev
```

---

## Deploy to Vercel

Project is linked as **bike2worktx** → `bike2worktx.vercel.app`.

```bash
cd Bike-to-Work
npx vercel deploy --prod
```

Requires Vercel CLI logged in (`vercel login`). Config lives in `.vercel/project.json`.

---

## Search distance options

UI bubbles: **0.5, 1, 1.5, 2 miles** (default **1 mi**). Server rejects radius &gt; 2 miles.

---

## Texas teen employment (app behavior)

The app filters by **business type**, not live job postings. Categories like grocery, retail, and fast food are marked “likely OK” for 14–15 year olds; bars, industrial, etc. are marked restricted. Always confirm with the employer and see [TWC Child Labor](https://www.twc.texas.gov/programs/unemployment-claims-and-benefits/child-labor-laws).

---

## Troubleshooting

| Problem | Likely cause | What to try |
|---------|--------------|-------------|
| “Wait Xs before searching” | 15s cooldown after live search | Wait, or repeat **exact same** search to use cache |
| “Nearby search timed out” | Overpass busy / query heavy | Wait and retry; keep distance ≤ 2 mi |
| “Load failed” / network error | Browser or API blocked | Refresh; wait 15–20s; check connection |
| Few or no results | Sparse OSM data or age filter on | Uncheck “Likely hires my age only”; try 2 mi |
| Geocode fails on server | Nominatim blocks Vercel IP | App should fall back to browser geocode automatically |

---

## Future improvements (not built yet)

- Paid geocoding / Places API for stability
- Server-side cache (Redis/Vercel KV) shared across users
- Real job listings (Indeed, etc.)
- True bike routing instead of straight-line distance
# Bike-2-Work-TX
