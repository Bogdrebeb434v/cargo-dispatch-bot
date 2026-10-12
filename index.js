import { escapeHtml, displayName } from "../lib/util.js";
import { getProfile, saveProfile, PROFILE_FIELDS, TARIFF_KEYS } from "../lib/profile.js";
import { getState, saveState, saveAssistantHistory } from "../lib/state.js";
import { isOwner, send, answerCallback, notifyOwner } from "../lib/telegram.js";
import { keyboardFor, clientKeyboard, ownerKeyboard, contactKeyboard, leadOwnerKb, reviewKb } from "../lib/keyboards.js";
import { isBlacklisted, addBlacklist, removeBlacklist } from "../lib/rateLimit.js";
import { getQuote, updateQuote, listQuotes, formatQuoteHtml } from "../lib/quotes.js";
import { listSlots, setSlotStatus, slotKeyboard, slotAtFromKey, getSlot } from "../lib/slots.js";
import { runAssistant } from "../lib/assistant.js";
import { parseKm, parseDistances, parseAddressPair, defaultExtras } from "../lib/pricing.js";
import { cardText, sendCard, sendShare, sendReviews } from "./card.js";
import { startCalc, chooseVehicle, acceptPoint, pointFromMessage, patchExtras, askMoreStop, runCalcFromState, finishManual, extrasPrompt, repeatLast } from "./calc.js";
import {
  sendAdmin, startEdit, startTariffs, tariffGroup, sendLeads, sendStats, sendVehicles,
  sendSlotsAdmin, toggleOwnerSlot, handleLeadAction, sendBlacklist, channelPost,
  sendExportHint, toggleAccepting, toggleNotify, toggleFlag, askPhoto, tariffText
} from "./owner.js";
import { extrasKeyboard } from "../lib/keyboards.js";

function kb(env, userId) {
  return keyboardFor(env, userId);
}

function isCancel(text) {
  const t = String(text || "").trim();
  return t === "/cancel" || t === "❌ Отмена" || t === "Отмена";
}

export async function handleUpdate(update, env) {
  const from = update.message?.from || update.callback_query?.from;
  const chatId = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
  const userId = from?.id;
  if (!userId || !chatId) return;

  if (await isBlacklisted(env, userId)) {
    if (update.callback_query) await answerCallback(env, update.callback_query.id, "Доступ ограничен", true);
    else await send(env, chatId, "Доступ к боту ограничен.");
    return;
  }

  let state = await getState(env, userId);
  if (state._expired) {
    state = {};
    if (update.message) await send(env, chatId, "Сессия истекла — начнём сначала. /start", kb(env, userId));
  }

  if (update.callback_query) return processCallback(update, env, state);
  if (update.message) return processMessage(update, env, state);
}

async function processMessage(update, env, state) {
  const m = update.message;
  const chatId = m.chat.id;
  const userId = m.from.id;
  const text = typeof m.text === "string" ? m.text.trim() : "";
  const p = await getProfile(env);
  const owner = isOwner(update, env);

  if (isCancel(text)) {
    await saveState(env, userId, state.lastQuoteId ? { lastQuoteId: state.lastQuoteId } : {});
    await saveAssistantHistory(env, userId, []);
    await send(env, chatId, "Действие отменено.", kb(env, userId));
    return;
  }

  if (state.mode === "edit_photo" && m.photo?.length) {
    if (!owner) return send(env, chatId, "Только владелец.", kb(env, userId));
    const fileId = m.photo[m.photo.length - 1].file_id;
    p.photo_file_id = fileId;
    await saveProfile(env, p);
    await saveState(env, userId, {});
    await send(env, chatId, "Фото сохранено. Оно уйдёт вместе с визиткой.", kb(env, userId));
    return;
  }

  if (state.mode === "edit_field" && text) {
    if (!owner) return deny(env, chatId, userId);
    const key = state.key;
    if (PROFILE_FIELDS.some(([k]) => k === key)) {
      p[key] = text.slice(0, 1000);
      await saveProfile(env, p);
      await saveState(env, userId, {});
      await send(env, chatId, "Сохранено.", kb(env, userId));
    } else {
      await saveState(env, userId, {});
      await send(env, chatId, "Не удалось определить поле.", kb(env, userId));
    }
    return;
  }

  if (state.mode === "edit_tariff" && text) {
    if (!owner) return deny(env, chatId, userId);
    const key = state.key;
    if (key === "currency") {
      p.currency = text.slice(0, 8);
      await saveProfile(env, p);
      await saveState(env, userId, {});
      await send(env, chatId, "Валюта сохранена.", kb(env, userId));
      return;
    }
    const n = Number(text.replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || !TARIFF_KEYS.includes(key)) {
      await send(env, chatId, "Введите корректное неотрицательное число. /cancel — отмена.");
      return;
    }
    p[key] = n;
    await saveProfile(env, p);
    await saveState(env, userId, {});
    await send(env, chatId, "Тариф сохранён.", kb(env, userId));
    return;
  }

  if (state.mode === "lead_phone") {
    let phone = "";
    let name = displayName(m.from);
    if (m.contact) {
      phone = m.contact.phone_number;
      name = [m.contact.first_name, m.contact.last_name].filter(Boolean).join(" ") || name;
    } else if (text) phone = text.slice(0, 40);
    if (!phone || phone.length < 5) {
      await send(env, chatId, "Пришлите контакт кнопкой или номер текстом.", contactKeyboard());
      return;
    }
    await saveState(env, userId, { ...state, mode: "lead_comment", phone, leadName: name });
    await send(env, chatId, "Короткий комментарий: что везём, с какого часа удобно. Или «—».", kb(env, userId));
    return;
  }

  if (state.mode === "lead_comment" && text) {
    await saveState(env, userId, { ...state, mode: "lead_slot", comment: text === "—" ? "" : text.slice(0, 500) });
    const slots = await listSlots(env, 3);
    await send(env, chatId, "Выберите окно подачи (🟢 свободно):", slotKeyboard(slots, "cslot"));
    return;
  }

  if (state.mode === "review_text" && text) {
    const q = await getQuote(env, state.quoteId);
    if (q && String(q.client_id) === String(userId)) {
      await updateQuote(env, q.id, { review_text: text.slice(0, 500) });
      await notifyOwner(env, `⭐ Отзыв ${q.review_score}/5 по заявке #${q.id} от ${escapeHtml(displayName(m.from))}\n${escapeHtml(text.slice(0, 400))}`);
    }
    await saveState(env, userId, {});
    await send(env, chatId, "Спасибо за отзыв!", kb(env, userId));
    return;
  }

  if (state.mode === "assistant" && text) {
    try {
      const answer = await runAssistant(env, p, userId, text);
      await send(env, chatId, escapeHtml(answer), kb(env, userId));
    } catch (e) {
      console.error("AI assistant failed", e);
      await send(env, chatId, "Помощник временно недоступен. Нажмите «🧮 Рассчитать стоимость» — тарифы работают отдельно.", kb(env, userId));
    }
    return;
  }

  if (state.mode === "calc_manual_loaded" && text) {
    const loadedKm = parseKm(text);
    if (loadedKm == null) {
      await send(env, chatId, "Введите расстояние одним числом в км, например 14 или 14.5");
      return;
    }
    await saveState(env, userId, { ...state, mode: "calc_manual_empty", loadedKm });
    await send(env, chatId, `Маршрут с грузом ${loadedKm} км.\nТеперь пустая подача от базы (${escapeHtml(p.base_address)}) до загрузки, км.`);
    return;
  }

  if (state.mode === "calc_manual_empty" && text) {
    const emptyKm = parseKm(text);
    if (emptyKm == null) {
      await send(env, chatId, "Введите расстояние одним числом в км, например 8");
      return;
    }
    await finishManual(env, chatId, userId, p, state, emptyKm, Number(state.loadedKm) || 0, m.from);
    return;
  }

  if (state.mode === "calc_manual" && text) {
    const distances = parseDistances(text);
    if (!distances) {
      await saveState(env, userId, { ...state, mode: "calc_manual_loaded" });
      await send(env, chatId, "Введите расстояние маршрута с грузом одним числом, например 14");
      return;
    }
    await finishManual(env, chatId, userId, p, state, distances[0], distances[1], m.from);
    return;
  }

  if (state.mode === "calc_from" || state.mode === "calc_to" || state.mode === "calc_stop") {
    const point = await pointFromMessage(env, m);
    if (!point) {
      await send(env, chatId, "Пришлите адрес текстом или геоточку. /cancel — отмена.");
      return;
    }
    await acceptPoint(env, chatId, userId, p, state, point);
    return;
  }

  if (text === "/start" || text === "/help" || text === "Меню") {
    await saveState(env, userId, state.lastQuoteId ? { lastQuoteId: state.lastQuoteId } : {});
    const payload = text.startsWith("/start") ? text.split(/\s+/)[1] : "";
    if (payload === "calc") {
      await startCalc(env, chatId, userId, p, update);
      return;
    }
    const hello = owner
      ? "Здравствуйте! Это диспетчер грузоперевозок. Вам доступно управление заявками и тарифами."
      : "Здравствуйте! Я бот грузоперевозок: визитка, расчёт по адресам и заявки.";
    await send(env, chatId, hello, kb(env, userId));
    return;
  }

  if (text === "/card" || text === "🚚 Визитка") {
    await sendCard(env, chatId, userId, p);
    return;
  }
  if (text === "/share" || text === "📤 Поделиться") {
    await sendShare(env, chatId, userId, p);
    return;
  }
  if (text === "/reviews" || text === "⭐ Отзывы") {
    await sendReviews(env, chatId, userId);
    return;
  }
  if (text === "/calc" || text === "🧮 Рассчитать стоимость") {
    await startCalc(env, chatId, userId, p, update);
    return;
  }
  if (text === "/assistant" || text === "🤖 ИИ-помощник") {
    await saveState(env, userId, { mode: "assistant", lastQuoteId: state.lastQuoteId });
    await send(env, chatId, "Напишите вопрос о перевозке или сразу два адреса через →\nДиалог помнит несколько реплик. /cancel — выход.");
    return;
  }
  if (text === "/orders" || text === "📝 Мои заявки") {
    const rows = (await listQuotes(env, { clientId: userId, limit: 8 })).filter(r => r.kind === "lead" || r.status !== "quote");
    if (!rows.length) {
      await send(env, chatId, "У вас пока нет заявок. Сделайте расчёт и нажмите «Оставить заявку».", kb(env, userId));
      return;
    }
    for (const q of rows) await send(env, chatId, formatQuoteHtml(q));
    return;
  }

  if (owner && (text === "/admin" || text === "⚙️ Управление")) {
    await sendAdmin(env, chatId, p);
    return;
  }
  if (owner && (text === "/leads" || text === "📋 Заявки")) {
    await sendLeads(env, chatId, "new");
    return;
  }
  if (owner && (text === "/stats" || text === "📊 Статистика")) {
    await sendStats(env, chatId);
    return;
  }
  if (owner && (text === "/tariffs" || text === "⚙️ Настроить тарифы")) {
    await startTariffs(env, chatId, p);
    return;
  }
  if (owner && (text === "/edit" || text === "✏️ Изменить визитку")) {
    await startEdit(env, chatId);
    return;
  }
  if (owner && text === "/export") {
    await sendExportHint(env, chatId);
    return;
  }
  if (owner && text.startsWith("/ban ")) {
    const id = text.slice(5).trim();
    if (id) await addBlacklist(env, id, "manual");
    await send(env, chatId, id ? `В ЧС: ${escapeHtml(id)}` : "Укажите id");
    return;
  }
  if (owner && text.startsWith("/unban ")) {
    const id = text.slice(7).trim();
    await removeBlacklist(env, id);
    await send(env, chatId, `Снял ${escapeHtml(id)}`);
    return;
  }

  const pair = parseAddressPair(text);
  if (pair) {
    await saveState(env, userId, { mode: "calc_extras", from: pair.from, to: pair.to, stops: [], extras: defaultExtras(), vehicleId: (p.vehicles || [])[0]?.id });
    const st = await getState(env, userId);
    await send(env, chatId, extrasPrompt(st, p), extrasKeyboard(st));
    return;
  }

  await send(env, chatId, "Не понял команду. Используйте меню ниже или /start, /card, /calc, /assistant.", kb(env, userId));
}

async function processCallback(update, env, state) {
  const c = update.callback_query;
  const chatId = c.message?.chat?.id;
  const messageId = c.message?.message_id;
  const userId = c.from.id;
  const data = String(c.data || "");
  const p = await getProfile(env);
  const owner = isOwner(update, env);

  if (data === "noop") {
    await answerCallback(env, c.id);
    return;
  }

  try {
    if (data.startsWith("x:") || data.startsWith("veh:") || data.startsWith("q:") || data.startsWith("cslot:")) {
      await answerCallback(env, c.id);
    } else {
      await answerCallback(env, c.id);
    }

    if (data === "menu:calc" || data === "calc") {
      await startCalc(env, chatId, userId, p, update);
      return;
    }
    if (data === "menu:card" || data === "card" || data === "card:full") {
      await sendCard(env, chatId, userId, p, { short: false });
      return;
    }
    if (data === "card:short") {
      await sendCard(env, chatId, userId, p, { short: true });
      return;
    }
    if (data === "menu:asst" || data === "assistant") {
      await saveState(env, userId, { mode: "assistant" });
      await send(env, chatId, "Напишите вопрос о перевозке или два адреса через →");
      return;
    }
    if (data.startsWith("veh:")) {
      await chooseVehicle(env, chatId, userId, p, data.slice(4));
      return;
    }
    if (data.startsWith("x:")) {
      await handleExtras(env, chatId, messageId, userId, p, state, data);
      return;
    }
    if (data === "q:redo") {
      await startCalc(env, chatId, userId, p, update);
      return;
    }
    if (data === "q:again") {
      await repeatLast(env, chatId, userId, p, c.from);
      return;
    }
    if (data.startsWith("q:") && data.endsWith(":book")) {
      const id = Number(data.split(":")[1]);
      if (!p.accepting_orders && !owner) {
        await send(env, chatId, p.busy_message, kb(env, userId));
        return;
      }
      await saveState(env, userId, { mode: "lead_phone", quoteId: id });
      await send(env, chatId, "Оставьте телефон для связи.", contactKeyboard());
      return;
    }
    if (data.startsWith("cslot:")) {
      await bookSlot(env, chatId, userId, p, state, data.slice(6), c.from);
      return;
    }
    if (data.startsWith("paid:")) {
      const id = Number(data.slice(5));
      const q = await getQuote(env, id);
      if (q && String(q.client_id) === String(userId)) {
        await notifyOwner(env, `💳 Клиент отмечает оплату по заявке #${id}. Проверьте поступление.`, leadOwnerKb(id));
        await send(env, chatId, "Сообщил владельцу. Как только перевод увидят — подтвердят.");
      }
      return;
    }
    if (data.startsWith("rev:")) {
      const [, id, score] = data.split(":");
      const q = await getQuote(env, id);
      if (q && String(q.client_id) === String(userId)) {
        await updateQuote(env, q.id, { review_score: Number(score) });
        await saveState(env, userId, { mode: "review_text", quoteId: Number(id) });
        await send(env, chatId, "Можно одним сообщением написать отзыв или /cancel.");
      }
      return;
    }

    if (data.startsWith("l:") || data.startsWith("admin:") || data.startsWith("field:") || data.startsWith("tariff:") || data.startsWith("tg:") || data.startsWith("leads:") || data.startsWith("oslot:") || data.startsWith("tog:") || data === "edit" || data === "tariffs" || data === "done") {
      if (!owner) {
        await send(env, chatId, "Эта функция доступна только владельцу.", kb(env, userId));
        return;
      }
    }

    if (data === "done") {
      await send(env, chatId, "Готово.", kb(env, userId));
      return;
    }
    if (data === "admin:edit" || data === "edit") {
      await startEdit(env, chatId);
      return;
    }
    if (data === "admin:tariffs" || data === "tariffs") {
      await startTariffs(env, chatId, p);
      return;
    }
    if (data.startsWith("tg:")) {
      await tariffGroup(env, chatId, p, data.slice(3));
      return;
    }
    if (data === "admin:vehicles") {
      await sendVehicles(env, chatId, p);
      return;
    }
    if (data === "admin:slots") {
      await sendSlotsAdmin(env, chatId);
      return;
    }
    if (data.startsWith("oslot:")) {
      await toggleOwnerSlot(env, chatId, data.slice(6));
      return;
    }
    if (data === "admin:photo") {
      await askPhoto(env, chatId, userId);
      return;
    }
    if (data === "admin:bl") {
      await sendBlacklist(env, chatId);
      return;
    }
    if (data === "admin:toggle") {
      await toggleAccepting(env, chatId, p);
      return;
    }
    if (data === "admin:notify") {
      await toggleNotify(env, chatId, p);
      return;
    }
    if (data === "admin:channel") {
      await channelPost(env, chatId, p);
      return;
    }
    if (data === "admin:export") {
      await sendExportHint(env, chatId);
      return;
    }
    if (data.startsWith("leads:")) {
      await sendLeads(env, chatId, data.slice(6));
      return;
    }
    if (data.startsWith("l:")) {
      const parts = data.split(":");
      await handleLeadAction(env, chatId, userId, p, Number(parts[1]), parts[2], true);
      return;
    }
    if (data.startsWith("field:")) {
      const key = data.slice(6);
      if (!PROFILE_FIELDS.some(([k]) => k === key)) return;
      await saveState(env, userId, { mode: "edit_field", key });
      const label = PROFILE_FIELDS.find(([k]) => k === key)[1];
      await send(env, chatId, `Введите новое значение поля «${escapeHtml(label)}». /cancel — отмена.`);
      return;
    }
    if (data.startsWith("tariff:")) {
      const key = data.slice(7);
      if (key !== "currency" && !TARIFF_KEYS.includes(key)) return;
      await saveState(env, userId, { mode: "edit_tariff", key });
      await send(env, chatId, key === "currency" ? "Введите символ валюты, например ₽" : "Введите неотрицательное число. /cancel — отмена.");
      return;
    }
    if (data.startsWith("tog:")) {
      await toggleFlag(env, chatId, p, data.slice(4));
    }
  } catch (e) {
    console.error("Callback processing failed", e);
  }
}

async function handleExtras(env, chatId, messageId, userId, profile, state, data) {
  const parts = data.split(":");
  const k = parts[1];
  const v = parts[2];
  if (k === "go") {
    await runCalcFromState(env, chatId, userId, profile, state, { id: userId });
    return;
  }
  if (k === "st") {
    await askMoreStop(env, chatId, userId, state);
    return;
  }
  const patch = {};
  if (k === "ld") patch.loaders = Number(v);
  if (k === "fl") patch.floor = Number(v);
  if (k === "el") patch.elevator = v === "1";
  if (k === "wt") patch.waitHours = Number(v);
  if (k === "wh") patch.when = v;
  if (k === "cg") patch.cargo = v;
  if (k === "rt") patch.roundTrip = !state.extras?.roundTrip;
  if (k === "ug") patch.urgent = !state.extras?.urgent;
  await patchExtras(env, chatId, messageId, userId, profile, state, patch);
}

async function bookSlot(env, chatId, userId, profile, state, key, from) {
  const parsed = slotAtFromKey(key);
  if (!parsed) return;
  const slot = await getSlot(env, parsed.date, parsed.time);
  if (!slot || slot.status !== "free") {
    await send(env, chatId, "Это окно уже занято, выберите другое.");
    const slots = await listSlots(env, 3);
    await send(env, chatId, "Свободные окна:", slotKeyboard(slots, "cslot"));
    return;
  }
  const quote = await getQuote(env, state.quoteId);
  if (!quote) {
    await send(env, chatId, "Расчёт не найден, сделайте новый.");
    return;
  }
  await setSlotStatus(env, parsed.date, parsed.time, "booked", quote.id);
  await updateQuote(env, quote.id, {
    status: "new",
    kind: "lead",
    phone: state.phone || "",
    comment: state.comment || "",
    slot_at: parsed.ts,
    extras: { ...(quote.extras || {}), leadName: state.leadName }
  });
  await saveState(env, userId, { lastQuoteId: quote.id });
  const fresh = await getQuote(env, quote.id);
  await send(env, chatId, "Заявка отправлена. Владелец получит уведомление.\n\n" + formatQuoteHtml(fresh), kb(env, userId));
  await notifyOwner(
    env,
    `📥 Новая заявка #${quote.id} от ${escapeHtml(displayName(from))}\nтел. ${escapeHtml(state.phone || "")}\n` + formatQuoteHtml(fresh, { withClient: true }),
    leadOwnerKb(quote.id)
  );
}

async function deny(env, chatId, userId) {
  await saveState(env, userId, {});
  await send(env, chatId, "Эта функция доступна только владельцу.", kb(env, userId));
}

export { clientKeyboard, ownerKeyboard, cardText };
