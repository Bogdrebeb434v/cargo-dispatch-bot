import { one, run } from "./db.js";

const WINDOW_MS = 60 * 60 * 1000;

export async function isBlacklisted(env, userId) {
  const row = await one(env, "SELECT user_id FROM blacklist WHERE user_id = ?", String(userId));
  return Boolean(row);
}

export async function addBlacklist(env, userId, reason = "") {
  await run(
    env,
    "INSERT INTO blacklist (user_id, reason, created_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET reason=excluded.reason",
    String(userId), String(reason || ""), Date.now()
  );
}

export async function removeBlacklist(env, userId) {
  await run(env, "DELETE FROM blacklist WHERE user_id = ?", String(userId));
}

export async function listBlacklist(env) {
  const { all } = await import("./db.js");
  return all(env, "SELECT * FROM blacklist ORDER BY created_at DESC LIMIT 50");
}

export async function hitQuoteLimit(env, userId, limit = 10) {
  const id = String(userId);
  const now = Date.now();
  const row = await one(env, "SELECT window_start, count FROM rate_limits WHERE user_id = ?", id);
  if (!row || now - Number(row.window_start) >= WINDOW_MS) {
    await run(
      env,
      "INSERT INTO rate_limits (user_id, window_start, count) VALUES (?, ?, 1) ON CONFLICT(user_id) DO UPDATE SET window_start=excluded.window_start, count=excluded.count",
      id, now
    );
    return { allowed: true, remaining: Math.max(0, limit - 1) };
  }
  const count = Number(row.count) + 1;
  await run(env, "UPDATE rate_limits SET count = ? WHERE user_id = ?", count, id);
  if (count > limit) return { allowed: false, remaining: 0 };
  return { allowed: true, remaining: Math.max(0, limit - count) };
}
