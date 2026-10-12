import { all, one, run } from "./db.js";
import { addDaysIso, moscowNow, slotTimestamp } from "./util.js";

export const SLOT_TIMES = ["09:00", "12:00", "15:00", "18:00"];

export async function ensureUpcomingSlots(env, days = 3) {
  const { date } = moscowNow();
  for (let d = 0; d < days; d++) {
    const day = addDaysIso(date, d);
    for (const time of SLOT_TIMES) {
      await run(
        env,
        "INSERT OR IGNORE INTO slots (date, time, status, quote_id) VALUES (?, ?, 'free', NULL)",
        day, time
      );
    }
  }
}

export async function listSlots(env, days = 3) {
  await ensureUpcomingSlots(env, days);
  const { date } = moscowNow();
  const until = addDaysIso(date, days);
  return all(env, "SELECT * FROM slots WHERE date >= ? AND date < ? ORDER BY date, time", date, until);
}

export async function setSlotStatus(env, date, time, status, quoteId = null) {
  await run(
    env,
    "INSERT INTO slots (date, time, status, quote_id) VALUES (?, ?, ?, ?) ON CONFLICT(date, time) DO UPDATE SET status=excluded.status, quote_id=excluded.quote_id",
    date, time, status, quoteId
  );
}

export async function getSlot(env, date, time) {
  return one(env, "SELECT * FROM slots WHERE date = ? AND time = ?", date, time);
}

export function slotKeyboard(slots, prefix = "slot") {
  const byDate = {};
  for (const s of slots) {
    (byDate[s.date] ||= []).push(s);
  }
  const rows = [];
  for (const [date, list] of Object.entries(byDate)) {
    rows.push([{ text: date, callback_data: "noop" }]);
    rows.push(list.map(s => {
      const icon = s.status === "free" ? "🟢" : s.status === "booked" ? "🔵" : "🔴";
      return { text: `${icon} ${s.time}`, callback_data: `${prefix}:${s.date}|${s.time}` };
    }));
  }
  return { inline_keyboard: rows };
}

export function slotAtFromKey(key) {
  const [date, time] = String(key).split("|");
  if (!date || !time) return null;
  return { date, time, ts: slotTimestamp(date, time) };
}

export async function dueReminders(env) {
  const from = Date.now() + 50 * 60 * 1000;
  const to = Date.now() + 70 * 60 * 1000;
  return all(
    env,
    "SELECT * FROM quotes WHERE reminded = 0 AND slot_at IS NOT NULL AND slot_at >= ? AND slot_at <= ? AND status IN ('confirmed', 'awaiting_payment')",
    from, to
  );
}
