import { escapeHtml } from "../lib/util.js";
import { send, sendPhoto } from "../lib/telegram.js";
import { keyboardFor } from "../lib/keyboards.js";
import { publishedReviews } from "../lib/quotes.js";
import { ruDate } from "../lib/util.js";

export function cardText(p, { short = false } = {}) {
  if (short) {
    return [
      `<b>${escapeHtml(p.name)}</b>`,
      escapeHtml(p.about),
      "",
      `☎ ${escapeHtml(p.phone)}`,
      `Telegram: ${escapeHtml(p.telegram)}`,
      escapeHtml(p.vehicle)
    ].join("\n");
  }
  const extras = [
    p.plate ? `<b>Госномер:</b> ${escapeHtml(p.plate)}` : "",
    p.capacity ? `<b>Грузоподъёмность:</b> ${escapeHtml(p.capacity)}` : "",
    `<b>Гидроборт:</b> ${p.hydroboard ? "есть" : "нет"}`,
    `<b>Пропуск в центр:</b> ${p.city_pass ? "есть" : "нет"}`,
    `<b>НДС:</b> ${p.vat ? "с НДС" : "без НДС"}`
  ].filter(Boolean);
  const fleet = (p.vehicles || []).map(v => `• ${escapeHtml(v.title)}${v.capacity ? " — " + escapeHtml(v.capacity) : ""}`).join("\n");
  return [
    `<b>${escapeHtml(p.name)}</b>`,
    escapeHtml(p.about),
    "",
    `<b>Телефон:</b> ${escapeHtml(p.phone)}`,
    `<b>Telegram:</b> ${escapeHtml(p.telegram)}`,
    `<b>Автомобиль:</b> ${escapeHtml(p.vehicle)}`,
    fleet ? `<b>Автопарк:</b>\n${fleet}` : "",
    `<b>Услуги:</b> ${escapeHtml(p.services)}`,
    `<b>Зона работы:</b> ${escapeHtml(p.work_area)}`,
    `<b>График:</b> ${escapeHtml(p.schedule)}`,
    extras.join("\n"),
    "",
    escapeHtml(p.notes)
  ].filter(x => x !== "").join("\n");
}

export function shareText(p) {
  return [
    p.name,
    p.about,
    `Телефон: ${p.phone}`,
    `Telegram: ${p.telegram}`,
    p.vehicle,
    p.work_area,
    p.notes
  ].filter(Boolean).join("\n");
}

export function cardButtons(p, env) {
  const tg = String(p.telegram || "").replace(/^@/, "");
  const rows = [];
  const top = [];
  if (tg && /^[A-Za-z0-9_]{4,}$/.test(tg)) top.push({ text: "💬 Написать", url: `https://t.me/${tg}` });
  if (top.length) rows.push(top);
  rows.push([
    { text: "Краткая", callback_data: "card:short" },
    { text: "Полная", callback_data: "card:full" }
  ]);
  rows.push([{ text: "🧮 Рассчитать стоимость", callback_data: "menu:calc" }]);
  return { inline_keyboard: rows };
}

export async function sendCard(env, chatId, userId, p, { short = false } = {}) {
  const text = cardText(p, { short });
  const markup = cardButtons(p, env);
  if (p.photo_file_id && !env.CAPTURE) {
    try {
      await sendPhoto(env, chatId, p.photo_file_id, text, markup);
      return;
    } catch (e) {
      console.error("sendPhoto failed", e);
    }
  }
  await send(env, chatId, text, markup);
}

export async function sendShare(env, chatId, userId, p) {
  const kb = keyboardFor(env, userId);
  await send(env, chatId, "Перешлите сообщение ниже — это короткая визитка без кнопок меню.");
  await send(env, chatId, escapeHtml(shareText(p)), kb);
}

export async function sendReviews(env, chatId, userId) {
  const rows = await publishedReviews(env, 8);
  const kb = keyboardFor(env, userId);
  if (!rows.length) {
    await send(env, chatId, "Пока нет опубликованных отзывов. После выполненной заявки бот сам попросит оценку.", kb);
    return;
  }
  const stars = n => "★".repeat(n) + "☆".repeat(5 - n);
  const text = ["<b>Отзывы клиентов</b>", ""].concat(rows.map(r => {
    const name = escapeHtml((r.client_name || "Клиент").split(" ")[0]);
    return `${stars(Number(r.review_score) || 0)} ${name}, ${ruDate(r.created_at)}\n${escapeHtml(r.review_text)}`;
  })).join("\n\n");
  await send(env, chatId, text, kb);
}
