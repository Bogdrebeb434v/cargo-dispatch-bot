import { computeQuote, defaultExtras, resolveTariff, nightWeekendForWhen } from "./pricing.js";
import { geocode, roadRoute, mapsLinks } from "./geo.js";
import { moscowNow } from "./util.js";

export async function quoteByAddresses(env, profile, input) {
  const t = resolveTariff(profile, input.vehicleId);
  const fromP = await geocode(env, input.from);
  const toP = await geocode(env, input.to);
  const stops = Array.isArray(input.stops) ? input.stops.filter(Boolean) : [];
  const stopPs = [];
  for (const s of stops) stopPs.push(await geocode(env, s));
  const base = await geocode(env, t.base_address || "Москва");
  const empty = await roadRoute([base, fromP]);
  let loaded = await roadRoute([fromP, ...stopPs, toP]);
  const extras = { ...defaultExtras(), ...input };
  if (extras.roundTrip) {
    const back = await roadRoute([toP, fromP]);
    loaded = { distanceKm: loaded.distanceKm + back.distanceKm, durationMin: loaded.durationMin + back.durationMin };
  }
  const { hour, weekday } = moscowNow();
  const nw = nightWeekendForWhen(extras.when || "today", hour, weekday);
  const result = computeQuote(t, {
    emptyKm: empty.distanceKm,
    loadedKm: extras.roundTrip ? loaded.distanceKm / 2 : loaded.distanceKm,
    extraStops: stopPs.length,
    loaders: extras.loaders,
    floor: extras.floor,
    elevator: extras.elevator,
    waitHours: extras.waitHours,
    roundTrip: extras.roundTrip,
    night: nw.night,
    weekend: nw.weekend,
    urgent: extras.urgent,
    cargo: extras.cargo
  });
  const labels = [input.from, ...stops, input.to];
  const maps = mapsLinks([fromP, ...stopPs, toP], labels);
  return {
    ...result,
    emptyKm: empty.distanceKm,
    loadedKm: loaded.distanceKm,
    durationMin: loaded.durationMin + empty.durationMin,
    maps,
    route: labels.join(" → "),
    vehicleTitle: t.vehicleTitle
  };
}
