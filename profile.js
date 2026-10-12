import { parseJson } from "./util.js";

export const DEFAULT_VEHICLES = [
  {
    id: "van",
    title: "Фургон до 800 кг",
    description: "Кузов 2,50 × 1,25 × 1,23 м, объём до 5 м³",
    capacity: "800 кг / 5 м³",
    plate: "",
    hydroboard: false,
    base_fee: 900,
    per_km_empty: 35,
    per_km_loaded: 50,
    minimum: 2200,
    included_loaded_km: 0
  },
  {
    id: "gazelle",
    title: "Газель до 1.5 т",
    description: "Кузов 3,00 × 1,80 × 1,70 м, объём до 9 м³",
    capacity: "1.5 т / 9 м³",
    plate: "",
    hydroboard: true,
    base_fee: 1400,
    per_km_empty: 45,
    per_km_loaded: 65,
    minimum: 3500,
    included_loaded_km: 0
  }
];

export const DEFAULT_PROFILE = {
  name: "Ваше имя / название компании",
  phone: "+7 XXX XXX-XX-XX",
  telegram: "@your_username",
  about: "Грузоперевозки по городу и области. Аккуратно, в срок, с понятным расчётом до выезда.",
  vehicle: "Фургон до 800 кг, объём до 5 м³; кузов 2,50 × 1,25 × 1,23 м (Д × Ш × В).",
  services: "Перевозка мебели, коробок, бытовой техники, товаров и небольших грузов.",
  work_area: "Москва и Московская область",
  schedule: "По договорённости, ежедневно",
  notes: "Стоимость предварительная и подтверждается после уточнения условий.",
  base_address: "Москва",
  base_fee: 900,
  per_km_empty: 35,
  per_km_loaded: 50,
  minimum: 2200,
  included_loaded_km: 0,
  currency: "₽",
  round_step: 50,
  loader_fee: 1500,
  floor_fee: 300,
  elevator_fee: 200,
  wait_fee_per_hour: 800,
  stop_fee: 400,
  night_coeff: 1.3,
  weekend_coeff: 1.2,
  urgent_coeff: 1.5,
  cargo_fees: {},
  plate: "",
  capacity: "800 кг / 5 м³",
  hydroboard: false,
  city_pass: false,
  vat: false,
  accepting_orders: true,
  hide_calc_when_busy: false,
  busy_message: "Сегодня новые заказы не принимаю. Напишите завтра — отвечу с утра.",
  notify_quotes: true,
  quote_rate_limit: 10,
  sbp_phone: "",
  card_number: "",
  card_holder: "",
  payment_comment: "Можно оплатить переводом по СБП. Цена предварительная, остаток — после выполнения.",
  photo_file_id: "",
  channel_id: "",
  vehicles: DEFAULT_VEHICLES
};

export const PROFILE_FIELDS = [
  ["name", "Название / имя"],
  ["phone", "Телефон"],
  ["telegram", "Telegram"],
  ["about", "О перевозчике"],
  ["vehicle", "Автомобиль (текст)"],
  ["services", "Услуги"],
  ["work_area", "Зона работы"],
  ["schedule", "График"],
  ["notes", "Примечания"],
  ["base_address", "Базовый адрес"],
  ["plate", "Госномер"],
  ["capacity", "Грузоподъёмность"],
  ["sbp_phone", "СБП / телефон для оплаты"],
  ["card_number", "Номер карты"],
  ["card_holder", "Получатель"],
  ["payment_comment", "Комментарий к оплате"],
  ["busy_message", "Сообщение «не принимаю»"],
  ["channel_id", "ID канала"]
];

export const TARIFF_GROUPS = [
  {
    id: "run",
    title: "Пробег и минимум",
    fields: [
      ["base_fee", "Базовая подача"],
      ["per_km_empty", "Пробег без груза, ₽/км"],
      ["per_km_loaded", "Пробег с грузом, ₽/км"],
      ["minimum", "Минимальная стоимость"],
      ["included_loaded_km", "Включённый гружёный пробег, км"],
      ["round_step", "Округление (шаг)"]
    ]
  },
  {
    id: "extra",
    title: "Надбавки",
    fields: [
      ["loader_fee", "Грузчик, ₽/чел"],
      ["floor_fee", "Этаж без лифта, ₽"],
      ["elevator_fee", "Подача на этаж с лифтом, ₽"],
      ["wait_fee_per_hour", "Ожидание, ₽/час"],
      ["stop_fee", "Доп. точка, ₽"]
    ]
  },
  {
    id: "coeff",
    title: "Коэффициенты",
    fields: [
      ["night_coeff", "Ночь (22:00–07:00)"],
      ["weekend_coeff", "Выходной"],
      ["urgent_coeff", "Срочность"]
    ]
  }
];

export const TARIFF_KEYS = TARIFF_GROUPS.flatMap(g => g.fields.map(([k]) => k));

export async function getProfile(env) {
  const row = await env.DB.prepare("SELECT data FROM profile WHERE id = 1").first();
  if (!row) {
    await env.DB.prepare("INSERT OR IGNORE INTO profile (id, data) VALUES (1, ?)").bind(JSON.stringify(DEFAULT_PROFILE)).run();
    return { ...DEFAULT_PROFILE, vehicles: DEFAULT_VEHICLES.map(v => ({ ...v })) };
  }
  try {
    const parsed = parseJson(row.data, {});
    const merged = { ...DEFAULT_PROFILE, ...parsed };
    if (!Array.isArray(merged.vehicles) || merged.vehicles.length === 0) {
      merged.vehicles = DEFAULT_VEHICLES.map(v => ({ ...v }));
    }
    return merged;
  } catch {
    return { ...DEFAULT_PROFILE, vehicles: DEFAULT_VEHICLES.map(v => ({ ...v })) };
  }
}

export async function saveProfile(env, profile) {
  await env.DB.prepare(
    "INSERT INTO profile (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data"
  ).bind(JSON.stringify(profile)).run();
}

export async function getSetting(env, key, fallback = null) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
  if (!row) return fallback;
  return parseJson(row.value, row.value);
}

export async function setSetting(env, key, value) {
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
  ).bind(key, JSON.stringify(value)).run();
}

export function publicCard(profile) {
  const { sbp_phone, card_number, card_holder, photo_file_id, channel_id, quote_rate_limit, notify_quotes, ...rest } = profile;
  return {
    name: rest.name,
    phone: rest.phone,
    telegram: rest.telegram,
    about: rest.about,
    vehicle: rest.vehicle,
    services: rest.services,
    work_area: rest.work_area,
    schedule: rest.schedule,
    notes: rest.notes,
    capacity: rest.capacity,
    hydroboard: rest.hydroboard,
    city_pass: rest.city_pass,
    vat: rest.vat,
    plate: rest.plate,
    accepting_orders: rest.accepting_orders,
    vehicles: (rest.vehicles || []).map(v => ({
      id: v.id,
      title: v.title,
      description: v.description,
      capacity: v.capacity,
      hydroboard: v.hydroboard
    }))
  };
}
