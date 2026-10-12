import { chunkText, fetchTimeout, sleep } from "./util.js";

export function isOwner(update, env) {
  const id = String(update?.message?.from?.id ?? update?.callback_query?.from?.id ?? "");
  return id !== "" && id === String(env.OWNER_TELEGRAM_ID ?? "");
}

export function ownerId(env) {
  return String(env.OWNER_TELEGRAM_ID || "");
}

export async function telegram(env, method, body) {
  if (env.CAPTURE) {
    env.CAPTURE.push({ method, body });
    return { message_id: env.CAPTURE.length, ok: true };
  }
  if (!env.BOT_TOKEN) throw new Error("BOT_TOKEN is not set");
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchTimeout(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      }, 20000);
      const result = await response.json().catch(() => ({}));
      if (response.status === 429) {
        const wait = Math.min(15, Number(result?.parameters?.retry_after || 2) + 0.3);
        await sleep(wait * 1000);
        lastErr = new Error(`Telegram 429 on ${method}`);
        continue;
      }
      if (!response.ok || !result.ok) {
        throw new Error(`Telegram ${method} failed: ${response.status} ${result.description || ""}`);
      }
      return result.result;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr || new Error(`Telegram ${method} failed`);
}

export async function send(env, chatId, text, replyMarkup) {
  const parts = chunkText(text, 3900);
  let last = null;
  for (let i = 0; i < parts.length; i++) {
    const body = {
      chat_id: chatId,
      text: parts[i],
      parse_mode: "HTML",
      disable_web_page_preview: true
    };
    if (replyMarkup && i === parts.length - 1) body.reply_markup = replyMarkup;
    last = await telegram(env, "sendMessage", body);
  }
  return last;
}

export async function editMessage(env, chatId, messageId, text, replyMarkup) {
  const body = {
    chat_id: chatId,
    message_id: messageId,
    text: String(text).slice(0, 3900),
    parse_mode: "HTML",
    disable_web_page_preview: true
  };
  if (replyMarkup) body.reply_markup = replyMarkup;
  try {
    return await telegram(env, "editMessageText", body);
  } catch {
    return send(env, chatId, text, replyMarkup);
  }
}

export async function sendDocument(env, chatId, filename, bytes, caption = "") {
  if (env.CAPTURE) {
    env.CAPTURE.push({ method: "sendDocument", body: { chat_id: chatId, filename, caption } });
    return { message_id: env.CAPTURE.length, ok: true };
  }
  if (!env.BOT_TOKEN) throw new Error("BOT_TOKEN is not set");
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", new Blob([bytes], { type: "text/csv; charset=utf-8" }), filename);
  if (caption) form.append("caption", caption);
  const response = await fetchTimeout(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendDocument`, {
    method: "POST",
    body: form
  }, 20000);
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    throw new Error(`Telegram sendDocument failed: ${response.status} ${result.description || ""}`);
  }
  return result.result;
}

export async function sendPhoto(env, chatId, fileId, caption, replyMarkup) {
  const body = {
    chat_id: chatId,
    photo: fileId,
    caption: String(caption || "").slice(0, 1000),
    parse_mode: "HTML"
  };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return telegram(env, "sendPhoto", body);
}

export async function answerCallback(env, id, text, alert = false) {
  const body = { callback_query_id: id };
  if (text) {
    body.text = String(text).slice(0, 180);
    body.show_alert = Boolean(alert);
  }
  try { await telegram(env, "answerCallbackQuery", body); } catch { /* already answered */ }
}

export async function notifyOwner(env, text, replyMarkup) {
  const id = ownerId(env);
  if (!id) return;
  try { await send(env, id, text, replyMarkup); } catch (e) { console.error("notifyOwner failed", e); }
}
