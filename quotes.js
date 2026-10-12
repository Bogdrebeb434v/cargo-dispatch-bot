import { all, lastId, one, run } from "./db.js";
import { parseJson, ruDateTime, ruNumber, escapeHtml } from "./util.js";

export const STATUSES = {
  quote: "расчёт",
  new: "новая заявка",
  confirmed: "подтверждена",
  awaiting_payment: "ожидает оплату",
  done: "выполнена",
  cancelled: "отменена"
};

export async function insertQuote(env, row) {
  const result = await env.DB.prepare(
    `INSERT INTO quotes (
      created_at, client_id, client_name, client_username, chat_id, vehicle_id,
      from_addr, to_addr, stops, empty_km, loaded_km, duration_min, extras, breakdown,
      cost, currency, status, comment, phone, slot_at, maps_google, maps_yandex, kind
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.created_at || Date.now(),
    String(row.client_id),
    row.client_name || "",
    row.client_username || "",
    String(row.chat_id || row.client_id),
    row.vehicle_id || "",
    row.from_addr || "",
    row.to_addr || "",
    JSON.stringify(row.stops || []),
    row.empty_km ?? 0,
    row.loaded_km ?? 0,
    row.duration_min ?? 0,
    JSON.stringify(row.extras || {}),
    JSON.stringify(row.breakdown || []),
    row.cost ?? 0,
    row.currency || "₽",
    row.status || "quote",
    row.comment || "",
    row.phone || "",
    row.slot_at || null,
    row.maps_google || "",
    row.maps_yandex || "",
    row.kind || "quote"
  ).run();
  return Number(lastId(result));
}

export async function getQuote(env, id) {
  const row = await one(env, "SELECT * FROM quotes WHERE id = ?", Number(id));
  if (!row) return null;
  return hydrate(row);
}

export async function updateQuote(env, id, patch) {
  const current = await getQuote(env, id);
  if (!current) return null;
  const next = { ...current, ...patch };
  await run(
    env,
    `UPDATE quotes SET status=?, comment=?, phone=?, slot_at=?, reminded=?, review_score=?, review_text=?, kind=?, extras=?, cost=? WHERE id=?`,
    next.status,
    next.comment || "",
    next.phone || "",
    next.slot_at || null,
    next.reminded ? 1 : 0,
    next.review_score ?? null,
    next.review_text || "",
    next.kind || current.kind,
    JSON.stringify(next.extras || {}),
    next.cost ?? current.cost,
    Number(id)
  );
  return getQuote(env, id);
}

function hydrate(row) {
  return {
    ...row,
    stops: parseJson(row.stops, []),
    extras: parseJson(row.extras, {}),
    breakdown: parseJson(row.breakdown, [])
  };
}

export async function listQuotes(env, { status, clientId, kind, limit = 15 } = {}) {
  let sql = "SELECT * FROM quotes WHERE 1=1";
  const args = [];
  if (status && status !== "all") {
    sql += " AND status = ?";
    args.push(status);
  }
  if (clientId) {
    sql += " AND client_id = ?";
    args.push(String(clientId));
  }
  if (kind) {
    sql += " AND kind = ?";
    args.push(kind);
  }
  sql += " ORDER BY created_at DESC LIMIT ?";
  args.push(limit);
  const rows = await all(env, sql, ...args);
  return rows.map(hydrate);
}

export async function lastClientQuote(env, clientId) {
  const row = await one(
    env,
    "SELECT * FROM quotes WHERE client_id = ? ORDER BY created_at DESC LIMIT 1",
    String(clientId)
  );
  return row ? hydrate(row) : null;
}

export async function publishedReviews(env, limit = 10) {
  const rows = await all(
    env,
    "SELECT id, client_name, review_score, review_text, created_at FROM quotes WHERE status = 'done' AND review_score IS NOT NULL AND review_text IS NOT NULL AND review_text != '' ORDER BY created_at DESC LIMIT ?",
    limit
  );
  return rows;
}

export function quoteTitle(q) {
  const stops = [q.from_addr, ...(q.stops || []), q.to_addr].filter(Boolean);
  return stops.join(" → ");
}

export function formatQuoteHtml(q, { withClient = false } = {}) {
  const e = q.extras || {};
  const lines = (q.breakdown || []).map(l => {
    if (!l.amount && l.key !== "base") return null;
    const det = l.detail ? ` (${escapeHtml(l.detail)})` : "";
    return `• ${escapeHtml(l.label)}${det}: ${ruNumber(l.amount)} ${escapeHtml(q.currency || "₽")}`;
  }).filter(Boolean);
  const parts = [
    `<b>${q.kind === "lead" || q.status === "new" ? "Заявка" : "Расчёт"} #${q.id}</b> — ${escapeHtml(STATUSES[q.status] || q.status)}`,
    escapeHtml(quoteTitle(q)),
    q.vehicle_id ? `Авто: ${escapeHtml(q.vehicle_id)}` : "",
    q.empty_km != null ? `Подача: ${Number(q.empty_km).toFixed(1)} км` : "",
    q.loaded_km != null ? `С грузом: ${Number(q.loaded_km).toFixed(1)} км` : "",
    q.duration_min ? `В пути ≈ ${Math.round(q.duration_min)} мин` : "",
    e.loaders ? `Грузчики: ${e.loaders}` : "",
    e.floor > 1 ? `Этаж: ${e.floor}${e.elevator ? ", лифт" : ", без лифта"}` : "",
    "",
    ...lines,
    "",
    `<b>Итого: ${ruNumber(q.cost)} ${escapeHtml(q.currency || "₽")}</b>`,
    q.phone ? `Телефон: ${escapeHtml(q.phone)}` : "",
    q.comment ? `Комментарий: ${escapeHtml(q.comment)}` : "",
    q.slot_at ? `Слот: ${ruDateTime(q.slot_at)}` : "",
    withClient ? `Клиент: ${escapeHtml(q.client_name || "")} ${q.client_username ? "@" + escapeHtml(q.client_username) : ""} id ${q.client_id}` : "",
    q.maps_google ? `<a href="${q.maps_google}">Google Maps</a>` : "",
    q.maps_yandex ? `<a href="${q.maps_yandex}">Яндекс.Карты</a>` : ""
  ].filter(x => x !== "");
  return parts.join("\n");
}

export async function stats(env) {
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const allRows = await all(env, "SELECT status, kind, cost, from_addr, to_addr, created_at FROM quotes WHERE created_at >= ?", weekAgo);
  const today = allRows.filter(r => r.created_at >= dayAgo);
  const week = allRows;
  const summarize = rows => {
    const calcs = rows.filter(r => r.kind === "quote" || r.kind === "lead" || true);
    const quotes = rows.length;
    const leads = rows.filter(r => r.kind === "lead" || ["new", "confirmed", "awaiting_payment", "done"].includes(r.status));
    const done = rows.filter(r => r.status === "done");
    const sums = leads.map(r => Number(r.cost) || 0);
    const avg = sums.length ? Math.round(sums.reduce((a, b) => a + b, 0) / sums.length) : 0;
    const conv = quotes ? Math.round((leads.length / quotes) * 100) : 0;
    const dirs = {};
    for (const r of rows) {
      const k = `${r.from_addr || "?"} → ${r.to_addr || "?"}`;
      dirs[k] = (dirs[k] || 0) + 1;
    }
    const top = Object.entries(dirs).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { quotes, leads: leads.length, done: done.length, avg, conv, top };
  };
  return { today: summarize(today), week: summarize(week) };
}

export function toCsv(rows) {
  const header = ["id", "created_at", "status", "kind", "client_id", "client_name", "phone", "from", "to", "stops", "empty_km", "loaded_km", "cost", "currency", "comment", "slot_at"];
  const esc = v => {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      r.id,
      new Date(r.created_at).toISOString(),
      r.status,
      r.kind,
      r.client_id,
      r.client_name,
      r.phone,
      r.from_addr,
      r.to_addr,
      Array.isArray(r.stops) ? r.stops.join(" | ") : r.stops,
      r.empty_km,
      r.loaded_km,
      r.cost,
      r.currency,
      r.comment,
      r.slot_at ? new Date(r.slot_at).toISOString() : ""
    ].map(esc).join(","));
  }
  return "\uFEFF" + lines.join("\n");
}
