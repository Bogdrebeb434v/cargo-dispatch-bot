export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

export function html(text, status = 200) {
  return new Response(text, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" }
  });
}

export function htmlPage(text, status = 200) {
  return new Response(text, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
  });
}

export function csvResponse(filename, text) {
  return new Response(text, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`
    }
  });
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function now() {
  return Date.now();
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function ruNumber(n, digits = 0) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function ruDateTime(ts) {
  if (!ts) return "—";
  return new Date(Number(ts)).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
}

export function ruDate(ts) {
  return new Date(Number(ts)).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });
}

export function moscowNow() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Moscow" })).getDay()
  };
}

export function pad(n) {
  return String(n).padStart(2, "0");
}

export function addDaysIso(isoDate, days) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function slotTimestamp(date, time) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return Date.parse(`${pad(y)}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00+03:00`);
}

export async function fetchTimeout(url, options = {}, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export function chunkText(text, max = 3900) {
  const s = String(text ?? "");
  if (s.length <= max) return [s];
  const parts = [];
  let rest = s;
  while (rest.length) {
    parts.push(rest.slice(0, max));
    rest = rest.slice(max);
  }
  return parts;
}

export function displayName(from) {
  if (!from) return "клиент";
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ").trim();
  return name || from.username || String(from.id);
}

export function mention(from) {
  if (!from) return "клиент";
  const name = escapeHtml(displayName(from));
  if (from.username) return `@${escapeHtml(from.username)} (${name}, id ${from.id})`;
  return `${name} (id ${from.id})`;
}

export function telegramChatLink(userId) {
  return `tg://user?id=${userId}`;
}

export function parseJson(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

export function isPositiveInt(n) {
  return Number.isInteger(n) && n >= 0;
}

export function asBool(v, def = false) {
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1" || v === "true") return true;
  if (v === 0 || v === "0" || v === "false") return false;
  return def;
}
