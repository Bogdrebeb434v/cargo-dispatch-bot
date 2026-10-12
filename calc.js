import { escapeHtml, mention, moscowNow, ruNumber, displayName } from "../lib/util.js";
import { computeQuote, defaultExtras, extrasSummary, resolveTariff, cargoLabel, nightWeekendForWhen, parseKm } from "../lib/pricing.js";
import { geocode, reverseGeocode, roadRoute, mapsLinks, rememberAddress, recentAddresses } from "../lib/geo.js";
import { send, editMessage, notifyOwner, isOwner } from "../lib/telegram.js";
import { saveState } from "../lib/state.js";
import { addressKeyboard, extrasKeyboard, keyboardFor, quoteActions, cancelKb } from "../lib/keyboards.js";
import { insertQuote, lastClientQuote, getQuote } from "../lib/quotes.js";
import { hitQuoteLimit } from "../lib/rateLimit.js";

export function quoteBreakdownText(p, result, meta = {}) {
  const cur = escapeHtml(p.currency || "₽");
  const lines = result.lines
    .filter(l => l.amount || l.key === "base" || l.key === "minimum")
    .map(l => {
      const det = l.detail ? ` — ${escapeHtml(l.detail)}` : "";
      return `${escapeHtml(l.label)}${det}: ${ruNumber(Math.round(l.amount))} ${cur}`;
    });
  const dur = meta.durationMin ? `\nВ пути с грузом ≈ ${Math.round(meta.durationMin)} мин` : "";
  const route = meta.route ? `\n${escapeHtml(meta.route)}` : "";
  const maps = [
    meta.maps?.google ? `<a href="${meta.maps.google}">Google Maps</a>` : "",
    meta.maps?.yandex ? `<a href="${meta.maps.yandex}">Яндекс.Карты</a>` : ""
  ].filter(Boolean).join(" · ");
  return [
    `<b>Предварительный расчёт</b>${route}`,
    `Авто: ${escapeHtml(p.vehicleTitle || p.vehicle)}`,
    meta.extrasText ? escapeHtml(meta.extrasText) : "",
    "",
    ...lines,
    dur,
    "",
    `<b>Итого ориентировочно: ${ruNumber(result.cost)} ${cur}</b>`,
    "",
    maps,
    "Расчёт предварительный. Цена подтверждается после уточнения деталей."
  ].filter(x => x !== "").join("\n");
}

export async function startCalc(env, chatId, userId, profile, update) {
  if (profile.hide_calc_when_busy && !profile.accepting_orders && !isOwner(update, env)) {
    await send(env, chatId, profile.busy_message, keyboardFor(env, userId));
    return;
  }
  const vehicles = profile.vehicles || [];
  if (vehicles.length > 1) {
    await saveState(env, userId, { mode: "calc_vehicle", extras: defaultExtras(), stops: [] });
    await send(env, chatId, "Выберите автомобиль:", {
      inline_keyboard: vehicles.map(v => [{ text: `${v.title}`, callback_data: `veh:${v.id}` }])
    });
    return;
  }
  await askFrom(env, chatId, userId, profile, { extras: defaultExtras(), stops: [], vehicleId: vehicles[0]?.id || "van" });
}

async function askFrom(env, chatId, userId, profile, state) {
  await saveState(env, userId, { ...state, mode: "calc_from" });
  const recent = await recentAddresses(env, userId);
  await send(
    env,
    chatId,
    `Введите адрес подачи / загрузки.\nБазовый адрес: <b>${escapeHtml(profile.base_address)}</b>.\nМожно прислать геоточку Telegram.`,
    addressKeyboard(recent)
  );
}

export async function chooseVehicle(env, chatId, userId, profile, vehicleId) {
  await askFrom(env, chatId, userId, profile, { extras: defaultExtras(), stops: [], vehicleId });
}

export async function acceptPoint(env, chatId, userId, profile, state, point) {
  await rememberAddress(env, userId, point.label);
  if (state.mode === "calc_from") {
    await saveState(env, userId, { ...state, mode: "calc_to", from: point.label, fromPoint: point });
    const recent = await recentAddresses(env, userId);
    await send(env, chatId, "Введите адрес назначения. Можно прислать геоточку.", addressKeyboard(recent));
    return;
  }
  if (state.mode === "calc_to") {
    const next = { ...state, mode: "calc_extras", to: point.label, toPoint: point, extras: state.extras || defaultExtras() };
    await saveState(env, userId, next);
    await send(env, chatId, extrasPrompt(next, profile), extrasKeyboard(next));
    return;
  }
  if (state.mode === "calc_stop") {
    const stops = [...(state.stops || []), point.label];
    const stopPoints = [...(state.stopPoints || []), point];
    const next = { ...state, mode: "calc_extras", stops, stopPoints };
    await saveState(env, userId, next);
    await send(env, chatId, extrasPrompt(next, profile), extrasKeyboard(next));
  }
}

export function extrasPrompt(state, profile) {
  const route = [state.from, ...(state.stops || []), state.to].filter(Boolean).join(" → ");
  const t = resolveTariff(profile, state.vehicleId);
  return [
    "<b>Уточните условия</b>",
    `Маршрут: ${escapeHtml(route)}`,
    `Авто: ${escapeHtml(t.vehicleTitle)}`,
    extrasSummary(state.extras || defaultExtras()),
    "",
    "Нажмите «Рассчитать», когда готово. Можно добавить адрес по пути."
  ].join("\n");
}

export async function patchExtras(env, chatId, messageId, userId, profile, state, patch) {
  const extras = { ...(state.extras || defaultExtras()), ...patch };
  const next = { ...state, extras, mode: "calc_extras" };
  await saveState(env, userId, next);
  await editMessage(env, chatId, messageId, extrasPrompt(next, profile), extrasKeyboard(next));
}

export async function askMoreStop(env, chatId, userId, state) {
  await saveState(env, userId, { ...state, mode: "calc_stop" });
  const recent = await recentAddresses(env, userId);
  await send(env, chatId, "Введите промежуточный адрес (догруз / ещё одна точка).", addressKeyboard(recent));
}

export async function pointFromMessage(env, m) {
  if (m.location) {
    const { latitude, longitude } = m.location;
    try {
      return await reverseGeocode(env, latitude, longitude);
    } catch {
      return { lat: latitude, lon: longitude, label: `Точка ${latitude.toFixed(5)}, ${longitude.toFixed(5)}` };
    }
  }
  if (m.venue?.location) {
    return {
      lat: m.venue.location.latitude,
      lon: m.venue.location.longitude,
      label: m.venue.title || m.venue.address
    };
  }
  if (typeof m.text === "string" && m.text.trim() && m.text !== "❌ Отмена") {
    return { label: m.text.trim(), address: m.text.trim() };
  }
  return null;
}

export async function runCalcFromState(env, chatId, userId, profile, state, fromUser) {
  const t = resolveTariff(profile, state.vehicleId);
  const owner = String(userId) === String(env.OWNER_TELEGRAM_ID || "");
  if (!owner) {
    const lim = await hitQuoteLimit(env, userId, Number(profile.quote_rate_limit) || 10);
    if (!lim.allowed) {
      await send(env, chatId, "Слишком много расчётов за час. Попробуйте позже или напишите нам напрямую.", keyboardFor(env, userId));
      return null;
    }
  }

  const status = await send(env, chatId, "Считаю маршрут и предварительную стоимость…");
  const statusId = status?.message_id;

  try {
    const fromP = state.fromPoint?.lat ? state.fromPoint : await geocode(env, state.from);
    const toP = state.toPoint?.lat ? state.toPoint : await geocode(env, state.to);
    const stopPs = [];
    const stopLabels = state.stops || [];
    for (let i = 0; i < stopLabels.length; i++) {
      const existing = (state.stopPoints || [])[i];
      stopPs.push(existing?.lat ? existing : await geocode(env, stopLabels[i]));
    }
    const base = await geocode(env, t.base_address || "Москва");
    const empty = await roadRoute([base, fromP]);
    const loadedPts = [fromP, ...stopPs, toP];
    let loaded = await roadRoute(loadedPts);
    const extras = state.extras || defaultExtras();
    if (extras.roundTrip) {
      const back = await roadRoute([toP, fromP]);
      loaded = {
        distanceKm: loaded.distanceKm + back.distanceKm,
        durationMin: loaded.durationMin + back.durationMin
      };
    }
    const { hour, weekday } = moscowNow();
    const nw = nightWeekendForWhen(extras.when, hour, weekday);
    const result = computeQuote(t, {
      emptyKm: empty.distanceKm,
      loadedKm: extras.roundTrip ? loaded.distanceKm / 2 : loaded.distanceKm,
      extraStops: stopLabels.length,
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
    const routePts = loadedPts;
    const labels = [state.from, ...stopLabels, state.to];
    const maps = mapsLinks(routePts, labels);
    const route = labels.join(" → ");
    const text = quoteBreakdownText(t, result, {
      durationMin: loaded.durationMin + empty.durationMin,
      route,
      maps,
      extrasText: extrasSummary({ ...extras, night: nw.night, weekend: nw.weekend })
    });
    const quoteId = await insertQuote(env, {
      client_id: userId,
      client_name: displayName(fromUser),
      client_username: fromUser?.username || "",
      chat_id: chatId,
      vehicle_id: t.vehicleId,
      from_addr: state.from,
      to_addr: state.to,
      stops: stopLabels,
      empty_km: empty.distanceKm,
      loaded_km: extras.roundTrip ? loaded.distanceKm : loaded.distanceKm,
      duration_min: loaded.durationMin,
      extras: { ...extras, night: nw.night, weekend: nw.weekend },
      breakdown: result.lines,
      cost: result.cost,
      currency: t.currency,
      status: "quote",
      kind: "quote",
      maps_google: maps.google,
      maps_yandex: maps.yandex
    });
    await saveState(env, userId, { lastQuoteId: quoteId });
    const canBook = profile.accepting_orders || owner;
    const markup = quoteActions(quoteId, canBook);
    if (statusId) await editMessage(env, chatId, statusId, text, markup);
    else await send(env, chatId, text, markup);
    await send(env, chatId, canBook ? "Можно оставить заявку кнопкой под расчётом." : profile.busy_message, keyboardFor(env, userId));

    if (profile.notify_quotes && !owner) {
      await notifyOwner(
        env,
        `💬 Расчёт от ${mention(fromUser)}\n${route}\n<b>${ruNumber(result.cost)} ${escapeHtml(t.currency)}</b>`
      );
    }
    return quoteId;
  } catch (e) {
    console.error("Route calculation failed", e);
    await saveState(env, userId, { ...state, mode: "calc_manual_loaded" });
    const msg = "Не удалось автоматически построить маршрут. Продолжим вручную.\n\nВведите расстояние маршрута <b>с грузом</b> в километрах одним числом, например: 14";
    if (statusId) await editMessage(env, chatId, statusId, msg);
    else await send(env, chatId, msg);
    return null;
  }
}

export async function finishManual(env, chatId, userId, profile, state, emptyKm, loadedKm, fromUser) {
  const t = resolveTariff(profile, state.vehicleId);
  const extras = state.extras || defaultExtras();
  const { hour, weekday } = moscowNow();
  const nw = nightWeekendForWhen(extras.when, hour, weekday);
  const result = computeQuote(t, {
    emptyKm,
    loadedKm,
    extraStops: (state.stops || []).length,
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
  const route = [state.from, ...(state.stops || []), state.to].filter(Boolean).join(" → ");
  const text = quoteBreakdownText(t, result, { route, extrasText: extrasSummary(extras) });
  const quoteId = await insertQuote(env, {
    client_id: userId,
    client_name: displayName(fromUser),
    client_username: fromUser?.username || "",
    chat_id: chatId,
    vehicle_id: t.vehicleId,
    from_addr: state.from,
    to_addr: state.to,
    stops: state.stops || [],
    empty_km: emptyKm,
    loaded_km: loadedKm,
    duration_min: 0,
    extras: { ...extras, ...nw },
    breakdown: result.lines,
    cost: result.cost,
    currency: t.currency,
    status: "quote",
    kind: "quote"
  });
  await saveState(env, userId, { lastQuoteId: quoteId });
  const canBook = profile.accepting_orders || String(userId) === String(env.OWNER_TELEGRAM_ID || "");
  await send(env, chatId, text, quoteActions(quoteId, canBook));
  await send(env, chatId, "Расчёт готов.", keyboardFor(env, userId));
  return quoteId;
}

export async function repeatLast(env, chatId, userId, profile, fromUser) {
  const last = await lastClientQuote(env, userId);
  if (!last) {
    await send(env, chatId, "Пока нет сохранённого расчёта. Начнём новый.", keyboardFor(env, userId));
    return;
  }
  await saveState(env, userId, {
    mode: "calc_extras",
    vehicleId: last.vehicle_id,
    from: last.from_addr,
    to: last.to_addr,
    stops: last.stops || [],
    extras: { ...defaultExtras(), ...(last.extras || {}) }
  });
  const state = {
    vehicleId: last.vehicle_id,
    from: last.from_addr,
    to: last.to_addr,
    stops: last.stops || [],
    extras: { ...defaultExtras(), ...(last.extras || {}) }
  };
  await send(env, chatId, extrasPrompt(state, profile), extrasKeyboard(state));
}

export { parseKm, cargoLabel, cancelKb, getQuote };
