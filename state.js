import { parseJson } from "./util.js";

export const STATE_TTL_MS = 2 * 60 * 60 * 1000;

export async function getState(env, userId) {
  if (!userId && userId !== 0) return {};
  const row = await env.DB.prepare("SELECT data, updated_at FROM user_states WHERE user_id = ?").bind(String(userId)).first();
  if (!row) return {};
  if (row.updated_at && Date.now() - Number(row.updated_at) > STATE_TTL_MS) {
    await env.DB.prepare("DELETE FROM user_states WHERE user_id = ?").bind(String(userId)).run();
    return { _expired: true };
  }
  try {
    const data = parseJson(row.data, {});
    data._updated_at = Number(row.updated_at);
    return data;
  } catch {
    return {};
  }
}

export async function saveState(env, userId, state) {
  if (!userId && userId !== 0) return;
  const clean = { ...state };
  delete clean._expired;
  delete clean._updated_at;
  if (!clean || Object.keys(clean).length === 0) {
    await env.DB.prepare("DELETE FROM user_states WHERE user_id = ?").bind(String(userId)).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO user_states (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at"
    ).bind(String(userId), JSON.stringify(clean), Date.now()).run();
  }
}

export async function getAssistantHistory(env, userId) {
  const row = await env.DB.prepare("SELECT messages, updated_at FROM assistant_history WHERE user_id = ?").bind(String(userId)).first();
  if (!row) return [];
  if (row.updated_at && Date.now() - Number(row.updated_at) > STATE_TTL_MS) return [];
  const arr = parseJson(row.messages, []);
  return Array.isArray(arr) ? arr.slice(-8) : [];
}

export async function saveAssistantHistory(env, userId, messages) {
  if (!messages?.length) {
    await env.DB.prepare("DELETE FROM assistant_history WHERE user_id = ?").bind(String(userId)).run();
    return;
  }
  await env.DB.prepare(
    "INSERT INTO assistant_history (user_id, messages, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET messages=excluded.messages, updated_at=excluded.updated_at"
  ).bind(String(userId), JSON.stringify(messages.slice(-8)), Date.now()).run();
}
