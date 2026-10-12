import { fetchTimeout, escapeHtml } from "./util.js";
import { getAssistantHistory, saveAssistantHistory } from "./state.js";
import { computeQuote, parseAddressPair, resolveTariff, extrasSummary, defaultExtras, cargoLabel } from "./pricing.js";
import { geocode, roadRoute, mapsLinks } from "./geo.js";
import { getProfile } from "./profile.js";

const TOOLS = [
  {
    type: "function",
    name: "create_quote",
    description: "Посчитать предварительную стоимость перевозки по адресам и условиям. Вызывай, когда есть откуда и куда.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "Адрес подачи / загрузки" },
        to: { type: "string", description: "Адрес назначения" },
        loaders: { type: "integer", description: "Число грузчиков 0-2" },
        floor: { type: "integer" },
        elevator: { type: "boolean" },
        round_trip: { type: "boolean" },
        urgent: { type: "boolean" },
        cargo: { type: "string", enum: ["boxes", "furniture", "appliances", "construction", "piano", "safe"] },
        vehicle_id: { type: "string" }
      },
      required: ["from", "to"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "get_card",
    description: "Визитка перевозчика: контакты, авто, зона, график.",
    parameters: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    type: "function",
    name: "get_tariffs",
    description: "Текущие тарифы и надбавки.",
    parameters: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    type: "function",
    name: "get_availability",
    description: "Принимает ли перевозчик заказы сейчас.",
    parameters: { type: "object", properties: {}, additionalProperties: false }
  }
];

function instructions(profile) {
  return `Ты вежливый русскоязычный диспетчер грузоперевозок. Отвечай кратко.
Говори только про услуги этой компании, тарифы и расчёт.
Не выдумывай цены, расстояния, доступность окон и условия, которых нет в инструментах.
Если клиент дал два адреса — вызови create_quote.
Если адресов нет, попроси адрес загрузки и адрес назначения.
Цена всегда предварительная.
Отказывайся от тем вне перевозок одной фразой.
Компания: ${profile.name}. Авто: ${profile.vehicle}. Зона: ${profile.work_area}. Услуги: ${profile.services}.`;
}

export async function runAssistant(env, profile, userId, question) {
  const history = await getAssistantHistory(env, userId);
  const pair = parseAddressPair(question);
  if (pair && !env.OPENAI_API_KEY) {
    const quote = await toolCreateQuote(env, profile, pair);
    const messages = [...history, { role: "user", content: question }, { role: "assistant", content: quote }];
    await saveAssistantHistory(env, userId, messages);
    return quote;
  }
  if (!env.OPENAI_API_KEY) {
    return fallbackAssistant(profile, question);
  }
  const input = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: "user", content: String(question).slice(0, 3000) }
  ];
  let answer = "";
  let guard = 0;
  let currentInput = input;
  while (guard++ < 4) {
    const response = await fetchTimeout("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-4.1-mini",
        instructions: instructions(profile),
        input: currentInput,
        tools: TOOLS,
        max_output_tokens: 500
      })
    }, 25000);
    if (!response.ok) throw new Error(`AI service returned ${response.status}`);
    const data = await response.json();
    const calls = (data.output || []).filter(i => i.type === "function_call");
    const texts = (data.output || [])
      .flatMap(item => item.content || [])
      .filter(item => item.type === "output_text")
      .map(item => item.text);
    if (calls.length) {
      const follow = [...currentInput];
      for (const call of calls) {
        const args = JSON.parse(call.arguments || "{}");
        const result = await executeTool(env, profile, call.name, args);
        follow.push(call);
        follow.push({ type: "function_call_output", call_id: call.call_id, output: result });
      }
      currentInput = follow;
      continue;
    }
    answer = texts.join("\n").trim();
    break;
  }
  if (!answer) throw new Error("AI returned an empty answer");
  const messages = [...history, { role: "user", content: question }, { role: "assistant", content: answer }];
  await saveAssistantHistory(env, userId, messages);
  return answer.slice(0, 3500);
}

async function executeTool(env, profile, name, args) {
  try {
    if (name === "get_card") {
      return `${profile.name}\n${profile.about}\nТел: ${profile.phone}\nTelegram: ${profile.telegram}\nАвто: ${profile.vehicle}\nУслуги: ${profile.services}\nЗона: ${profile.work_area}\nГрафик: ${profile.schedule}`;
    }
    if (name === "get_tariffs") {
      return tariffPlain(profile);
    }
    if (name === "get_availability") {
      return profile.accepting_orders
        ? "Сейчас заявки принимаются."
        : `Заявки сейчас не принимаются. ${profile.busy_message}`;
    }
    if (name === "create_quote") {
      return await toolCreateQuote(env, profile, args);
    }
    return "Неизвестный инструмент";
  } catch (e) {
    return `Ошибка: ${e.message}`;
  }
}

async function toolCreateQuote(env, profile, args) {
  const t = resolveTariff(profile, args.vehicle_id);
  const a = await geocode(env, args.from);
  const b = await geocode(env, args.to);
  const base = await geocode(env, t.base_address || "Москва");
  const empty = await roadRoute([base, a]);
  const loaded = await roadRoute([a, b]);
  const extras = {
    ...defaultExtras(),
    loaders: Number(args.loaders) || 0,
    floor: Number(args.floor) || 1,
    elevator: args.elevator !== false,
    roundTrip: Boolean(args.round_trip),
    urgent: Boolean(args.urgent),
    cargo: args.cargo || "furniture"
  };
  const q = computeQuote(t, {
    emptyKm: empty.distanceKm,
    loadedKm: loaded.distanceKm,
    extraStops: 0,
    ...extras
  });
  const maps = mapsLinks([a, b], [args.from, args.to]);
  return [
    `Предварительный расчёт ${a.label} → ${b.label}`,
    `Подача ${empty.distanceKm.toFixed(1)} км, с грузом ${loaded.distanceKm.toFixed(1)} км, в пути ≈ ${Math.round(loaded.durationMin)} мин.`,
    extrasSummary(extras),
    `Итого ориентировочно ${q.cost} ${t.currency}.`,
    "Цена предварительная.",
    `Карты: ${maps.yandex}`
  ].join("\n");
}

export function fallbackAssistant(profile, question) {
  const q = String(question || "").toLowerCase();
  const off = ["погода", "bitcoin", "анекдот", "стих", "код", "python", "рецепт"];
  if (off.some(w => q.includes(w))) {
    return "Я помощник только по грузоперевозкам этой компании. Напишите адреса загрузки и назначения — посчитаю.";
  }
  const pair = parseAddressPair(question);
  if (pair) {
    return `Чтобы посчитать маршрут «${pair.from} → ${pair.to}», нажмите «🧮 Рассчитать стоимость» или напишите адреса в расчёте. ИИ-ключ не задан, поэтому считаю через обычный мастер.`;
  }
  if (/цен|стоим|тариф|сколько/.test(q)) return tariffPlain(profile) + "\n\nДля точной цифры нужны два адреса. Нажмите «🧮 Рассчитать стоимость».";
  if (/график|время|когда/.test(q)) return `График: ${profile.schedule}. Зона: ${profile.work_area}.`;
  if (/авто|машин|газел|фургон/.test(q)) return `Авто: ${profile.vehicle}\nГрузоподъёмность: ${profile.capacity}`;
  if (/телефон|связ|контакт/.test(q)) return `Телефон: ${profile.phone}\nTelegram: ${profile.telegram}`;
  return "Напишите адрес загрузки и адрес назначения (можно через «→»). Посчитаю по тарифам. Либо нажмите «🧮 Рассчитать стоимость».";
}

export function tariffPlain(p) {
  return [
    `Базовая подача: ${p.base_fee} ${p.currency}`,
    `Пустой пробег: ${p.per_km_empty} ${p.currency}/км`,
    `Гружёный пробег: ${p.per_km_loaded} ${p.currency}/км`,
    `Минимум: ${p.minimum} ${p.currency}`,
    `Включено гружёных км: ${p.included_loaded_km}`,
    `Грузчик: ${p.loader_fee} ${p.currency}`,
    `Этаж без лифта: ${p.floor_fee} ${p.currency}`,
    `Ожидание: ${p.wait_fee_per_hour} ${p.currency}/ч`,
    `Доп. точка: ${p.stop_fee} ${p.currency}`,
    `Ночь ×${p.night_coeff}, выходной ×${p.weekend_coeff}, срочно ×${p.urgent_coeff}`
  ].join("\n");
}

export { escapeHtml, cargoLabel, getProfile };
