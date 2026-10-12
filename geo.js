import { fetchTimeout, sleep, parseJson } from "./util.js";
import { one, run } from "./db.js";

const NOMINATIM_DELAY = 1100;
const CACHE_TTL = 24 * 60 * 60 * 1000;
let lastNominatim = 0;

function normQuery(address) {
  return String(address || "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function throttleNominatim() {
  const wait = NOMINATIM_DELAY - (Date.now() - lastNominatim);
  if (wait > 0) await sleep(wait);
  lastNominatim = Date.now();
}

export async function geocode(env, address) {
  const q = normQuery(address);
  if (!q) throw new Error("Address not found");
  const cached = await one(env, "SELECT lat, lon, label, cached_at FROM geocode_cache WHERE query = ?", q);
  if (cached && Date.now() - Number(cached.cached_at) < CACHE_TTL) {
    return { lat: Number(cached.lat), lon: Number(cached.lon), label: cached.label, cached: true };
  }
  await throttleNominatim();
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=ru&q=${encodeURIComponent(address)}`;
  const res = await fetchTimeout(url, {
    headers: { "user-agent": "CargoDispatchBot/2.0 (route quote; local-dev)" }
  }, 12000);
  if (!res.ok) throw new Error("Geocoding unavailable");
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) throw new Error("Address not found");
  const point = { lat: Number(data[0].lat), lon: Number(data[0].lon), label: data[0].display_name, cached: false };
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) throw new Error("Address not found");
  await run(
    env,
    "INSERT INTO geocode_cache (query, lat, lon, label, cached_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(query) DO UPDATE SET lat=excluded.lat, lon=excluded.lon, label=excluded.label, cached_at=excluded.cached_at",
    q, point.lat, point.lon, point.label, Date.now()
  );
  return point;
}

export async function reverseGeocode(env, lat, lon) {
  const q = `rev:${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}`;
  const cached = await one(env, "SELECT lat, lon, label, cached_at FROM geocode_cache WHERE query = ?", q);
  if (cached && Date.now() - Number(cached.cached_at) < CACHE_TTL) {
    return { lat: Number(cached.lat), lon: Number(cached.lon), label: cached.label, cached: true };
  }
  await throttleNominatim();
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ru&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
  const res = await fetchTimeout(url, {
    headers: { "user-agent": "CargoDispatchBot/2.0 (route quote; local-dev)" }
  }, 12000);
  if (!res.ok) {
    return { lat: Number(lat), lon: Number(lon), label: `Точка ${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}` };
  }
  const data = await res.json();
  const label = data.display_name || `Точка ${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}`;
  const point = { lat: Number(lat), lon: Number(lon), label, cached: false };
  await run(
    env,
    "INSERT INTO geocode_cache (query, lat, lon, label, cached_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(query) DO UPDATE SET lat=excluded.lat, lon=excluded.lon, label=excluded.label, cached_at=excluded.cached_at",
    q, point.lat, point.lon, point.label, Date.now()
  );
  return point;
}

export async function roadRoute(points) {
  if (!points || points.length < 2) throw new Error("Route not found");
  const path = points.map(p => `${p.lon},${p.lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${path}?overview=false`;
  const res = await fetchTimeout(url, {}, 15000);
  if (!res.ok) throw new Error("Routing unavailable");
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.length) throw new Error("Route not found");
  const route = data.routes[0];
  return {
    distanceKm: route.distance / 1000,
    durationMin: route.duration / 60,
    legs: (route.legs || []).map(l => ({ km: l.distance / 1000, min: l.duration / 60 }))
  };
}

export function mapsLinks(points, labels = []) {
  const origin = labels[0] || `${points[0].lat},${points[0].lon}`;
  const dest = labels[labels.length - 1] || `${points[points.length - 1].lat},${points[points.length - 1].lon}`;
  const wayLabels = labels.slice(1, -1);
  const gWay = wayLabels.length ? `&waypoints=${encodeURIComponent(wayLabels.join("|"))}` : "";
  const google = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(dest)}${gWay}&travelmode=driving`;
  const yandexPts = points.map(p => `${p.lat},${p.lon}`).join("~");
  const yandex = `https://yandex.ru/maps/?rtext=${encodeURIComponent(yandexPts)}&rtt=auto`;
  return { google, yandex };
}

export async function rememberAddress(env, userId, address) {
  if (!address || String(address).length < 3) return;
  await run(
    env,
    "INSERT INTO address_history (user_id, address, used_at) VALUES (?, ?, ?)",
    String(userId), String(address).slice(0, 240), Date.now()
  );
  const extra = await one(
    env,
    "SELECT id FROM address_history WHERE user_id = ? ORDER BY used_at DESC LIMIT 1 OFFSET 8",
    String(userId)
  );
  if (extra?.id) {
    await run(env, "DELETE FROM address_history WHERE user_id = ? AND used_at < (SELECT MIN(used_at) FROM (SELECT used_at FROM address_history WHERE user_id = ? ORDER BY used_at DESC LIMIT 5))", String(userId), String(userId));
  }
}

export async function recentAddresses(env, userId) {
  const rows = await (await import("./db.js")).all(
    env,
    "SELECT address, MAX(used_at) AS used_at FROM address_history WHERE user_id = ? GROUP BY address ORDER BY used_at DESC LIMIT 5",
    String(userId)
  );
  return (rows || []).map(r => r.address).filter(Boolean);
}

export { parseJson };
