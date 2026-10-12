import test from "node:test";
import assert from "node:assert/strict";
import {
  manualQuote, computeQuote, roundCost, parseKm, parseDistances, parseAddressPair,
  resolveTariff, nightWeekendForWhen, cargoFee, defaultExtras
} from "../src/lib/pricing.js";
import { DEFAULT_PROFILE, DEFAULT_VEHICLES } from "../src/lib/profile.js";

const p = { ...DEFAULT_PROFILE };

test("manualQuote uses minimum", () => {
  assert.equal(manualQuote(p, 0, 0), 2200);
});

test("manualQuote rounds up to 50", () => {
  const cost = manualQuote(p, 10, 10);
  assert.equal(cost % 50, 0);
  assert.ok(cost >= 900 + 10 * 35 + 10 * 50);
});

test("roundCost honours custom step", () => {
  assert.equal(roundCost(101, 50), 150);
  assert.equal(roundCost(100, 50), 100);
  assert.equal(roundCost(1, 100), 100);
});

test("computeQuote loaders and floor without elevator", () => {
  const r = computeQuote(p, {
    emptyKm: 10,
    loadedKm: 10,
    loaders: 2,
    floor: 4,
    elevator: false
  });
  const loaderLine = r.lines.find(l => l.key === "loaders");
  const floorLine = r.lines.find(l => l.key === "floor");
  assert.equal(loaderLine.amount, 3000);
  assert.equal(floorLine.amount, 3 * 300 * 2);
  assert.ok(r.cost >= 900 + 350 + 500 + 3000 + 1800);
});

test("computeQuote elevator uses flat fee", () => {
  const r = computeQuote(p, { emptyKm: 0, loadedKm: 0, floor: 5, elevator: true, loaders: 0 });
  const floorLine = r.lines.find(l => l.key === "floor");
  assert.equal(floorLine.amount, p.elevator_fee);
});

test("computeQuote round trip doubles loaded km", () => {
  const one = computeQuote(p, { emptyKm: 20, loadedKm: 30, roundTrip: false });
  const two = computeQuote(p, { emptyKm: 20, loadedKm: 30, roundTrip: true });
  assert.equal(two.loadedKm, 60);
  assert.ok(two.cost > one.cost);
});

test("computeQuote night and urgent coefficients", () => {
  const base = computeQuote(p, { emptyKm: 20, loadedKm: 20 });
  const night = computeQuote(p, { emptyKm: 20, loadedKm: 20, night: true, urgent: true });
  assert.ok(night.coeff > 1.5);
  assert.ok(night.cost > base.cost);
});

test("computeQuote cargo piano fee", () => {
  const r = computeQuote(p, { emptyKm: 1, loadedKm: 1, cargo: "piano" });
  assert.equal(r.lines.find(l => l.key === "cargo").amount, 3000);
});

test("parseKm", () => {
  assert.equal(parseKm("14"), 14);
  assert.equal(parseKm("14.5"), 14.5);
  assert.equal(parseKm("14,5"), 14.5);
  assert.equal(parseKm("14 км"), null);
  assert.equal(parseKm("-1"), null);
});

test("parseDistances rejects phones and needs two numbers", () => {
  assert.deepEqual(parseDistances("8 14"), [8, 14]);
  assert.equal(parseDistances("8"), null);
  assert.equal(parseDistances("+7-900-111-22-33"), null);
});

test("parseAddressPair", () => {
  const a = parseAddressPair("Москва, Тверская 7 → Химки");
  assert.equal(a.from, "Москва, Тверская 7");
  assert.equal(a.to, "Химки");
  assert.ok(parseAddressPair("Арбат до Одинцово"));
  assert.equal(parseAddressPair("просто текст"), null);
});

test("resolveTariff merges vehicle rates", () => {
  const profile = { ...DEFAULT_PROFILE, vehicles: DEFAULT_VEHICLES };
  const t = resolveTariff(profile, "gazelle");
  assert.equal(t.minimum, 3500);
  assert.equal(t.vehicleTitle, "Газель до 1.5 т");
  assert.equal(t.name, profile.name);
});

test("nightWeekendForWhen", () => {
  const sunNight = nightWeekendForWhen("today", 23, 0);
  assert.equal(sunNight.night, true);
  assert.equal(sunNight.weekend, true);
  const tueMorning = nightWeekendForWhen("today", 10, 2);
  assert.equal(tueMorning.night, false);
  assert.equal(tueMorning.weekend, false);
});

test("cargoFee override", () => {
  assert.equal(cargoFee({}, "piano"), 3000);
  assert.equal(cargoFee({ cargo_fees: { piano: 1 } }, "piano"), 1);
});

test("defaultExtras shape", () => {
  const e = defaultExtras();
  assert.equal(e.loaders, 0);
  assert.equal(e.elevator, true);
});
