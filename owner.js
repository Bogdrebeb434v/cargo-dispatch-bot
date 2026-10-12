import { escapeHtml, ruNumber, ruDateTime, mention } from "../lib/util.js";
import { send, sendPhoto, sendDocument, notifyOwner, telegram } from "../lib/telegram.js";
import { adminInline, keyboardFor, leadOwnerKb, statusFilterKb, reviewKb, extrasKeyboard } from "../lib/keyboards.js";
import { PROFILE_FIELDS, TARIFF_GROUPS, TARIFF_KEYS, saveProfile } from "../lib/profile.js";
import { tariffPlain } from "../lib/assistant.js";
import { listQuotes, getQuote, updateQuote, formatQuoteHtml, stats, toCsv, STATUSES } from "../lib/quotes.js";
import { listSlots, setSlotStatus, slotKeyboard, slotAtFromKey, getSlot } from "../lib/slots.js";
import { addBlacklist, removeBlacklist, listBlacklist } from "../lib/rateLimit.js";
import { saveState } from "../lib/state.js";
import { all } from "../lib/db.js";

export function tariffText(p) {
  return `<b>Текущие тарифы</b>\n${escapeHtml(tariffPlain(p))}`;
}

export async function sendAdmin(env, chatId, p) {
  await send(env, chatId, "<b>Управление</b>\nКлиенты этих кнопок не видят.", adminInline(p));
}

export async function startEdit(env, chatId) {
  const fields = PROFILE_FIELDS.map(([key, label]) => [{ text: label, callback_data: `field:${key}` }]);
  fields.push([
    { text: `Гидроборт`, callback_data: "tog:hydroboard" },
    { text: `Пропуск`, callback_data: "tog:city_pass" },
    { text: `НДС`, callback_data: "tog:vat" }
  ]);
  fields.push([{ text: "Готово", callback_data: "done" }]);
  await send(env, chatId, "Выберите поле визитки:", { inline_keyboard: fields });
}

export async function startTariffs(env, chatId, p) {
  const rows = TARIFF_GROUPS.map(g => [{ text: g.title, callback_data: `tg:${g.id}` }]);
  rows.push([{ text: "Валюта", callback_data: "tariff:currency" }]);
  await send(env, chatId, tariffText(p), { inline_keyboard: rows });
}

export async function tariffGroup(env, chatId, p, groupId) {
  const g = TARIFF_GROUPS.find(x => x.id === groupId);
  if (!g) return;
  const rows = g.fields.map(([key, label]) => [{ text: `${label}: ${p[key]}`, callback_data: `tariff:${key}` }]);
  rows.push([{ text: "← Назад", callback_data: "admin:tariffs" }]);
  await send(env, chatId, `<b>${escapeHtml(g.title)}</b>`, { inline_keyboard: rows });
}

export async function sendLeads(env, chatId, status = "new") {
  const rows = await listQuotes(env, { status: status === "all" ? undefined : status, kind: status === "all" ? undefined : undefined, limit: 12 });
  const filtered = status === "all" ? rows.filter(r => r.kind === "lead" || r.status !== "quote") : rows.filter(r => r.status === status);
  if (!filtered.length) {
    await send(env, chatId, `Заявок со статусом «${escapeHtml(STATUSES[status] || status)}» нет.`, statusFilterKb());
    return;
  }
  await send(env, chatId, `<b>Заявки</b> (${escapeHtml(STATUSES[status] || status)})`, statusFilterKb());
  for (const q of filtered.slice(0, 8)) {
    await send(env, chatId, formatQuoteHtml(q, { withClient: true }), leadOwnerKb(q.id));
  }
}

export async function sendStats(env, chatId) {
  const s = await stats(env);
  const fmt = (title, x) => [
    `<b>${title}</b>`,
    `Расчётов: ${x.quotes}`,
    `Заявок: ${x.leads}`,
    `Выполнено: ${x.done}`,
    `Средний чек: ${ruNumber(x.avg)} ₽`,
    `Конверсия в заявку: ${x.conv}%`,
    x.top.length ? "Топ направлений:\n" + x.top.map(([k, n]) => `• ${escapeHtml(k)} — ${n}`).join("\n") : "Направлений пока мало"
  ].join("\n");
  await send(env, chatId, [fmt("Сегодня", s.today), "", fmt("Неделя", s.week)].join("\n"));
}

export async function sendVehicles(env, chatId, p) {
  const lines = (p.vehicles || []).map(v =>
    `<b>${escapeHtml(v.title)}</b> (${escapeHtml(v.id)})\n${escapeHtml(v.description || "")}\nПодача ${v.base_fee}, ${v.per_km_loaded} ₽/км груж., мин. ${v.minimum}`
  );
  await send(env, chatId, "<b>Автопарк</b>\nТарифы машины перекрывают общие, если заданы.\nЧтобы изменить — правьте JSON через поле визитки или тарифы базового профиля.\n\n" + lines.join("\n\n"));
}

export async function sendSlotsAdmin(env, chatId) {
  const slots = await listSlots(env, 3);
  await send(env, chatId, "Нажмите слот, чтобы переключить свободно / занято. Синий — уже бронь.", slotKeyboard(slots, "oslot"));
}

export async function toggleOwnerSlot(env, chatId, key) {
  const parsed = slotAtFromKey(key);
  if (!parsed) return;
  const s = await getSlot(env, parsed.date, parsed.time);
  if (s?.status === "booked") {
    await send(env, chatId, "Слот уже занят заявкой. Сначала отмените заявку.");
    return;
  }
  const next = s?.status === "busy" ? "free" : "busy";
  await setSlotStatus(env, parsed.date, parsed.time, next, null);
  await send(env, chatId, `${parsed.date} ${parsed.time} → ${next === "free" ? "свободно" : "занято владельцем"}`);
}

export async function handleLeadAction(env, chatId, userId, profile, quoteId, action, fromOwner) {
  const q = await getQuote(env, quoteId);
  if (!q) {
    await send(env, chatId, "Заявка не найдена.");
    return;
  }
  if (action === "info") {
    await send(env, chatId, formatQuoteHtml(q, { withClient: true }), leadOwnerKb(q.id));
    return;
  }
  if (action === "ok") {
    await updateQuote(env, q.id, { status: "confirmed" });
    await send(env, chatId, `Заявка #${q.id} подтверждена.`);
    try { await send(env, q.chat_id, `✅ Заявку #${q.id} приняли. Свяжемся для уточнения.\n${formatQuoteHtml(q)}`); } catch { /* ignore */ }
    return;
  }
  if (action === "no") {
    await updateQuote(env, q.id, { status: "cancelled" });
    if (q.slot_at) {
      /* free slot best-effort: ignore if unknown */
    }
    await send(env, chatId, `Заявка #${q.id} отклонена.`);
    try { await send(env, q.chat_id, `Заявку #${q.id} не смогли взять. Можно сделать новый расчёт.`); } catch { /* ignore */ }
    return;
  }
  if (action === "pay") {
    await updateQuote(env, q.id, { status: "awaiting_payment" });
    const pay = [
      `<b>Предоплата по заявке #${q.id}</b>`,
      `Сумма: ${ruNumber(q.cost)} ${escapeHtml(q.currency || "₽")}`,
      profile.sbp_phone ? `СБП / телефон: ${escapeHtml(profile.sbp_phone)}` : "",
      profile.card_number ? `Карта: ${escapeHtml(profile.card_number)}` : "",
      profile.card_holder ? `Получатель: ${escapeHtml(profile.card_holder)}` : "",
      escapeHtml(profile.payment_comment || "")
    ].filter(Boolean).join("\n");
    await send(env, chatId, `Запросили предоплату по #${q.id}.`);
    try {
      await send(env, q.chat_id, pay, {
        inline_keyboard: [[{ text: "Я оплатил", callback_data: `paid:${q.id}` }]]
      });
    } catch { /* ignore */ }
    return;
  }
  if (action === "done") {
    await updateQuote(env, q.id, { status: "done" });
    await send(env, chatId, `Заявка #${q.id} закрыта.`);
    try {
      await send(env, q.chat_id, `Заявка #${q.id} выполнена. Оцените поездку от 1 до 5.`, reviewKb(q.id));
    } catch { /* ignore */ }
    return;
  }
  if (action === "bl") {
    await addBlacklist(env, q.client_id, `lead #${q.id}`);
    await send(env, chatId, `Клиент ${q.client_id} в чёрном списке.`);
  }
}

export async function sendBlacklist(env, chatId) {
  const rows = await listBlacklist(env);
  if (!rows.length) {
    await send(env, chatId, "Чёрный список пуст.\nЧтобы добавить, пришлите id пользователя после команды /ban или нажмите «В ЧС» на заявке.");
    return;
  }
  const text = rows.map(r => `• ${r.user_id} — ${escapeHtml(r.reason || "")} (${ruDateTime(r.created_at)})`).join("\n");
  await send(env, chatId, `<b>Чёрный список</b>\n${text}\n\nСнять: /unban ID`);
}

export async function channelPost(env, chatId, profile) {
  const channel = profile.channel_id || env.CHANNEL_ID;
  const bot = env.BOT_USERNAME ? `https://t.me/${env.BOT_USERNAME}?start=calc` : "";
  const post = [
    "🚚 <b>Есть свободное окно</b>",
    profile.work_area,
    profile.vehicles?.[0]?.title || profile.vehicle,
    "Пишите в бот — посчитаю и зафиксирую заявку.",
    bot
  ].filter(Boolean).join("\n");
  if (!channel) {
    await send(env, chatId, "Сначала укажите ID канала в визитке (поле «ID канала») или CHANNEL_ID.\nТекст поста:\n\n" + post);
    return;
  }
  try {
    await telegram(env, "sendMessage", { chat_id: channel, text: post, parse_mode: "HTML", disable_web_page_preview: true });
    await send(env, chatId, "Опубликовал в канал.");
  } catch (e) {
    await send(env, chatId, "Не удалось отправить в канал. Проверьте, что бот — админ канала.\n\n" + post);
  }
}

export async function sendExportHint(env, chatId) {
  const rows = await listQuotes(env, { limit: 1000 });
  if (!rows.length) {
    await send(env, chatId, "Выгружать нечего — заявок пока нет.");
    return;
  }
  const csv = toCsv(rows);
  try {
    await sendDocument(env, chatId, "leads.csv", new TextEncoder().encode(csv), `Заявок: ${rows.length}`);
  } catch (e) {
    console.error("CSV document failed", e);
    await send(env, chatId, `<code>${escapeHtml(csv.slice(0, 3400))}</code>`);
  }
}

export async function toggleAccepting(env, chatId, profile) {
  profile.accepting_orders = !profile.accepting_orders;
  await saveProfile(env, profile);
  await send(env, chatId, profile.accepting_orders ? "Приём заявок включён." : "Приём заявок выключен.\n" + profile.busy_message, adminInline(profile));
}

export async function toggleNotify(env, chatId, profile) {
  profile.notify_quotes = !profile.notify_quotes;
  await saveProfile(env, profile);
  await send(env, chatId, profile.notify_quotes ? "Буду присылать каждый расчёт." : "Расчёты без заявки больше не дублирую.", adminInline(profile));
}

export async function toggleFlag(env, chatId, profile, key) {
  profile[key] = !profile[key];
  await saveProfile(env, profile);
  await send(env, chatId, `${key}: ${profile[key] ? "да" : "нет"}`);
}

export async function askPhoto(env, chatId, userId) {
  await saveState(env, userId, { mode: "edit_photo" });
  await send(env, chatId, "Пришлите фото автомобиля одним сообщением. /cancel — отмена.");
}

export { TARIFF_KEYS, PROFILE_FIELDS, extrasKeyboard, mention, all, removeBlacklist };
