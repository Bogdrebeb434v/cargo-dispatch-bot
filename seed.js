import { one } from "./db.js";
import { insertQuote } from "./quotes.js";
import { ensureUpcomingSlots } from "./slots.js";
import { DEFAULT_PROFILE, getProfile, saveProfile } from "./profile.js";

export async function seedIfEmpty(env) {
  const p = await getProfile(env);
  if (p.name === DEFAULT_PROFILE.name) {
    Object.assign(p, {
      name: "Северный Кузов",
      phone: "+7 495 000-12-12",
      telegram: "@sever_kuzov",
      about: "Грузоперевозки по Москве и области. Фургон и газель, грузчики, понятная смета до выезда.",
      vehicle: "Фургон до 800 кг и газель 1.5 т с гидробортом.",
      sbp_phone: "+7 495 000-12-12",
      card_holder: "Иван Иванов",
      city_pass: true
    });
    await saveProfile(env, p);
  }
  await ensureUpcomingSlots(env, 3);
  const row = await one(env, "SELECT COUNT(*) AS c FROM quotes");
  if (Number(row?.c || 0) > 0) return;
  const now = Date.now();
  await insertQuote(env, {
    created_at: now - 86400000 * 3,
    client_id: "90001",
    client_name: "Анна К.",
    from_addr: "Москва, Тверская 7",
    to_addr: "Химки, Ленинградская 1",
    empty_km: 6,
    loaded_km: 22,
    cost: 4200,
    currency: "₽",
    status: "done",
    kind: "lead",
    comment: "шкаф и холодильник",
    extras: { loaders: 2, cargo: "furniture" },
    breakdown: []
  });
  const q1 = await one(env, "SELECT id FROM quotes ORDER BY id DESC LIMIT 1");
  if (q1) {
    await env.DB.prepare("UPDATE quotes SET review_score=5, review_text=? WHERE id=?")
      .bind("Приехал вовремя, аккуратно перевез шкаф и холодильник.", q1.id).run();
  }
  await insertQuote(env, {
    created_at: now - 86400000 * 2,
    client_id: "90002",
    client_name: "Игорь П.",
    from_addr: "Мытищи",
    to_addr: "Москва, Павелецкая",
    empty_km: 12,
    loaded_km: 18,
    cost: 3800,
    currency: "₽",
    status: "done",
    kind: "lead",
    extras: { loaders: 1, cargo: "appliances" },
    breakdown: []
  });
  const q2 = await one(env, "SELECT id FROM quotes ORDER BY id DESC LIMIT 1");
  if (q2) {
    await env.DB.prepare("UPDATE quotes SET review_score=5, review_text=? WHERE id=?")
      .bind("Газель с гидробортом — то, что нужно было для стиралок.", q2.id).run();
  }
  await insertQuote(env, {
    created_at: now - 3600000,
    client_id: "90003",
    client_name: "Мария",
    client_username: "demo_client",
    from_addr: "Москва, Арбат 12",
    to_addr: "Одинцово",
    empty_km: 4.2,
    loaded_km: 24.5,
    cost: 5100,
    currency: "₽",
    status: "new",
    kind: "lead",
    phone: "+7 900 000-00-00",
    comment: "диван и 12 коробок, 3 этаж без лифта",
    extras: { loaders: 2, floor: 3, elevator: false, cargo: "furniture" },
    breakdown: []
  });
}
