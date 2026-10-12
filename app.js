import { json, html } from "./lib/util.js";
import { handleUpdate } from "./bot/index.js";
import { runReminders } from "./lib/reminders.js";

export async function fetchHandler(request, env) {
  const url = new URL(request.url);

  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    return json({ ok: true, service: "cargo-telegram-bot" });
  }

  if (request.method === "POST" && url.pathname === "/webhook") {
    return handleWebhook(request, env);
  }

  return html("Not found", 404);
}

async function handleWebhook(request, env) {
  if (!env.BOT_TOKEN || !env.OWNER_TELEGRAM_ID || !env.WEBHOOK_SECRET || !env.DB) {
    console.error("Missing required bot configuration");
    return json({ ok: false, error: "Bot configuration incomplete" }, 500);
  }
  const supplied = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!supplied || supplied !== env.WEBHOOK_SECRET) {
    return json({ ok: false, error: "Invalid webhook secret" }, 403);
  }
  let update;
  try { update = await request.json(); }
  catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
  try { await handleUpdate(update, env); }
  catch (e) { console.error("Webhook processing failed", e); }
  return json({ ok: true });
}

export async function scheduledHandler(_event, env) {
  try { await runReminders(env); }
  catch (e) { console.error("reminders", e); }
}
