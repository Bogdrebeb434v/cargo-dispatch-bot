import { dueReminders } from "./slots.js";
import { send, notifyOwner } from "./telegram.js";
import { ruDateTime, escapeHtml } from "./util.js";
import { run } from "./db.js";

export async function runReminders(env) {
  const rows = await dueReminders(env);
  for (const q of rows) {
    const when = ruDateTime(q.slot_at);
    const text = `⏰ Напоминание: подача по заявке #${q.id} примерно в ${escapeHtml(when)}.\n${escapeHtml(q.from_addr || "")} → ${escapeHtml(q.to_addr || "")}`;
    try { await send(env, q.chat_id, text); } catch (e) { console.error("client reminder", e); }
    try { await notifyOwner(env, text + `\nклиент id ${q.client_id}`); } catch (e) { console.error("owner reminder", e); }
    await run(env, "UPDATE quotes SET reminded = 1 WHERE id = ?", q.id);
  }
  return rows.length;
}
