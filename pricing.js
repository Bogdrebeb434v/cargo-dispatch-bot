/** Чистые функции расчёта. Без сети и БД — удобно тестировать. */

export const CARGO_TYPES = [
  { id: "boxes", label: "Коробки / мелкий груз", fee: 0 },
  { id: "furniture", label: "Мебель", fee: 0 },
  { id: "appliances", label: "Бытовая техника", fee: 500 },
  { id: "construction", label: "Стройматериалы", fee: 1000 },
  { id: "piano", label: "Пианино / рояль", fee: 3000 },
  { id: "safe", label: "Сейф", fee: 2500 }
];

export const WHEN_OPTIONS = [
  { id: "today", label: "Сегодня" },
  { id: "tomorrow", label: "Завтра" },
  { id: "later", label: "Другой день" }
];

const NUM_KEYS = [
  "base_fee", "per_km_empty", "per_km_loaded", "minimum", "included_loaded_km",
  "round_step", "loader_fee", "floor_fee", "elevator_fee", "wait_fee_per_hour",
  "stop_fee", "night_coeff", "weekend_coeff", "urgent_coeff"
];

export function cargoLabel(id) {
  return CARGO_TYPES.find(c => c.id === id)?.label || "груз";
}

export function cargoFee(profile, id) {
  const custom = profile?.cargo_fees?.[id];
  if (Number.isFinite(Number(custom))) return Number(custom);
  return CARGO_TYPES.find(c => c.id === id)?.fee || 0;
}

export function resolveTariff(profile, vehicleId) {
  const list = Array.isArray(profile?.vehicles) ? profile.vehicles : [];
  const v = list.find(x => x.id === vehicleId) || list[0] || null;
  if (!v) {
    return {
      ...profile,
      vehicleId: list[0]?.id || "van",
      vehicleTitle: profile.vehicle || "Автомобиль"
    };
  }
  const merged = { ...profile };
  for (const key of NUM_KEYS) {
    if (v[key] != null && v[key] !== "") merged[key] = v[key];
  }
  if (v.cargo_fees) merged.cargo_fees = { ...(profile.cargo_fees || {}), ...v.cargo_fees };
  merged.vehicleId = v.id;
  merged.vehicleTitle = v.title || v.name || profile.vehicle;
  merged.vehicle = v.title || v.name || profile.vehicle;
  if (v.capacity) merged.capacity = v.capacity;
  if (v.plate) merged.plate = v.plate;
  if (v.hydroboard != null) merged.hydroboard = v.hydroboard;
  if (v.description) merged.vehicle_description = v.description;
  return merged;
}

export function roundCost(cost, step = 50) {
  const s = Number(step) > 0 ? Number(step) : 50;
  return Math.ceil(Math.max(0, Number(cost) || 0) / s) * s;
}

/**
 * Базовая формула без надбавок — совместима с исходным ботом.
 */
export function manualQuote(profile, emptyKm, loadedKm) {
  const cost = Math.max(
    Number(profile.minimum) || 0,
    (Number(profile.base_fee) || 0)
      + emptyKm * (Number(profile.per_km_empty) || 0)
      + Math.max(0, loadedKm - (Number(profile.included_loaded_km) || 0)) * (Number(profile.per_km_loaded) || 0)
  );
  return roundCost(cost, profile.round_step || 50);
}

/**
 * Полный расчёт с надбавками.
 * @returns {{ cost: number, lines: object[], coeff: number, beforeCoeff: number, beforeMin: number }}
 */
export function computeQuote(profile, input = {}) {
  const t = profile;
  const emptyKm = Math.max(0, Number(input.emptyKm) || 0);
  const loadedKmRaw = Math.max(0, Number(input.loadedKm) || 0);
  const extraStops = Math.max(0, Number(input.extraStops) || 0);
  const loaders = Math.max(0, Math.min(4, Number(input.loaders) || 0));
  const floor = Math.max(1, Math.min(25, Number(input.floor) || 1));
  const elevator = Boolean(input.elevator);
  const waitHours = Math.max(0, Number(input.waitHours) || 0);
  const roundTrip = Boolean(input.roundTrip);
  const night = Boolean(input.night);
  const weekend = Boolean(input.weekend);
  const urgent = Boolean(input.urgent);
  const cargo = input.cargo || "furniture";
  const currency = t.currency || "₽";

  const loadedKm = roundTrip ? loadedKmRaw * 2 : loadedKmRaw;
  const included = Number(t.included_loaded_km) || 0;
  const loadedBillable = Math.max(0, loadedKm - included);

  const lines = [];
  const baseFee = Number(t.base_fee) || 0;
  const emptyCost = emptyKm * (Number(t.per_km_empty) || 0);
  const loadedCost = loadedBillable * (Number(t.per_km_loaded) || 0);

  lines.push({ key: "base", label: "Базовая подача", amount: baseFee, detail: "" });
  lines.push({
    key: "empty",
    label: "Подача без груза",
    amount: emptyCost,
    detail: `${emptyKm.toFixed(1)} км × ${t.per_km_empty} ${currency}/км`
  });
  lines.push({
    key: "loaded",
    label: roundTrip ? "Маршрут с грузом (туда-обратно)" : "Маршрут с грузом",
    amount: loadedCost,
    detail: `${loadedKm.toFixed(1)} км × ${t.per_km_loaded} ${currency}/км`
      + (included ? ` (включено ${included} км)` : "")
  });

  const loaderFee = loaders * (Number(t.loader_fee) || 0);
  if (loaders) {
    lines.push({
      key: "loaders",
      label: `Грузчики (${loaders})`,
      amount: loaderFee,
      detail: `${loaders} × ${t.loader_fee} ${currency}`
    });
  }

  let floorFee = 0;
  if (floor > 1) {
    if (elevator) {
      floorFee = Number(t.elevator_fee) || 0;
      if (floorFee) {
        lines.push({ key: "floor", label: `Этаж ${floor}, лифт`, amount: floorFee, detail: "" });
      }
    } else {
      const hands = Math.max(loaders, 1);
      floorFee = (floor - 1) * (Number(t.floor_fee) || 0) * hands;
      lines.push({
        key: "floor",
        label: `Этаж ${floor}, без лифта`,
        amount: floorFee,
        detail: `${floor - 1} эт. × ${t.floor_fee} ${currency} × ${hands}`
      });
    }
  }

  const waitFee = waitHours * (Number(t.wait_fee_per_hour) || 0);
  if (waitHours) {
    lines.push({
      key: "wait",
      label: "Ожидание / простой",
      amount: waitFee,
      detail: `${waitHours} ч × ${t.wait_fee_per_hour} ${currency}`
    });
  }

  const stopFee = extraStops * (Number(t.stop_fee) || 0);
  if (extraStops) {
    lines.push({
      key: "stops",
      label: `Доп. точки (${extraStops})`,
      amount: stopFee,
      detail: `${extraStops} × ${t.stop_fee} ${currency}`
    });
  }

  const cFee = cargoFee(t, cargo);
  if (cFee) {
    lines.push({ key: "cargo", label: cargoLabel(cargo), amount: cFee, detail: "" });
  }

  const beforeCoeff = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  let coeff = 1;
  const coeffNotes = [];
  if (night) {
    coeff *= Number(t.night_coeff) || 1;
    coeffNotes.push(`ночь ×${t.night_coeff}`);
  }
  if (weekend) {
    coeff *= Number(t.weekend_coeff) || 1;
    coeffNotes.push(`выходной ×${t.weekend_coeff}`);
  }
  if (urgent) {
    coeff *= Number(t.urgent_coeff) || 1;
    coeffNotes.push(`срочно ×${t.urgent_coeff}`);
  }
  if (coeff !== 1) {
    lines.push({
      key: "coeff",
      label: "Коэффициент",
      amount: beforeCoeff * (coeff - 1),
      detail: coeffNotes.join(", ")
    });
  }

  const afterCoeff = beforeCoeff * coeff;
  const minimum = Number(t.minimum) || 0;
  let cost = Math.max(minimum, afterCoeff);
  if (cost === minimum && afterCoeff < minimum) {
    lines.push({ key: "minimum", label: "Минимальная стоимость", amount: minimum - afterCoeff, detail: `${minimum} ${currency}` });
  }
  const rounded = roundCost(cost, t.round_step || 50);
  if (rounded !== cost) {
    lines.push({ key: "round", label: "Округление", amount: rounded - cost, detail: `шаг ${t.round_step || 50} ${currency}` });
  }

  return {
    cost: rounded,
    lines,
    coeff,
    beforeCoeff,
    beforeMin: afterCoeff,
    emptyKm,
    loadedKm,
    loadedKmOneWay: loadedKmRaw,
    currency
  };
}

export function parseKm(text) {
  const clean = String(text).trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const n = Number(clean);
  if (!Number.isFinite(n) || n < 0 || n > 10000) return null;
  return n;
}

export function parseDistances(text) {
  if (/-\s*\d/.test(String(text))) return null;
  const matches = String(text).match(/\d+(?:[.,]\d+)?/g);
  if (!matches || matches.length !== 2) return null;
  const values = matches.map(v => Number(v.replace(",", ".")));
  if (values.some(v => !Number.isFinite(v) || v < 0 || v > 10000)) return null;
  return values;
}

export function parseAddressPair(text) {
  const s = String(text || "").trim();
  const m = s.match(/^(.{3,180}?)\s*(?:->|→|—+|–+|\sдо\s)\s*(.{3,180})$/i);
  if (!m) return null;
  const from = m[1].trim();
  const to = m[2].trim();
  if (!from || !to || from.length < 3 || to.length < 3) return null;
  if (/^\d/.test(from) && parseKm(from) != null) return null;
  return { from, to };
}

export function nightWeekendForWhen(when, hourNow, weekdayNow) {
  const nightHours = { start: 22, end: 7 };
  let night = false;
  let weekend = false;
  if (when === "today") {
    night = hourNow >= nightHours.start || hourNow < nightHours.end;
    weekend = weekdayNow === 0 || weekdayNow === 6;
  } else if (when === "tomorrow") {
    const wd = (weekdayNow + 1) % 7;
    weekend = wd === 0 || wd === 6;
    night = false;
  } else if (when === "later") {
    weekend = false;
    night = false;
  }
  return { night, weekend };
}

export function defaultExtras() {
  return {
    loaders: 0,
    floor: 1,
    elevator: true,
    waitHours: 0,
    when: "today",
    cargo: "furniture",
    roundTrip: false,
    urgent: false
  };
}

export function extrasSummary(extras) {
  const e = { ...defaultExtras(), ...extras };
  const bits = [];
  bits.push(e.loaders ? `грузчики: ${e.loaders}` : "без грузчиков");
  if (e.floor > 1) bits.push(`этаж ${e.floor}${e.elevator ? ", лифт" : ", без лифта"}`);
  if (e.waitHours) bits.push(`ожидание ${e.waitHours} ч`);
  bits.push(cargoLabel(e.cargo));
  if (e.roundTrip) bits.push("туда-обратно");
  if (e.urgent) bits.push("срочно");
  const when = WHEN_OPTIONS.find(w => w.id === e.when)?.label || e.when;
  bits.push(when);
  return bits.join(" · ");
}
