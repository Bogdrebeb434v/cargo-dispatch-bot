import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { initSqlite } from "../src/lib/sqlite.js";
import { handleUpdate } from "../src/bot/index.js";
import { getState } from "../src/lib/state.js";
import { getProfile } from "../src/lib/profile.js";

function env() {
  const raw = new Database(":memory:");
  return {
    DB: initSqlite(raw),
    OWNER_TELEGRAM_ID: "7",
    CAPTURE: []
  };
}

function textUpdate(userId, text) {
  return {
    message: {
      chat: { id: userId },
      from: { id: userId, first_name: "Test", username: "t" },
      text
    }
  };
}

test("/start client gets client keyboard without tariffs", async () => {
  const e = env();
  await handleUpdate(textUpdate(42, "/start"), e);
  const sent = e.CAPTURE.find(x => x.method === "sendMessage");
  assert.ok(sent);
  const kb = sent.body.reply_markup.keyboard.flat().map(b => b.text).join(" ");
  assert.match(kb, /Визитка/);
  assert.doesNotMatch(kb, /Управление/);
});

test("/start owner gets admin keys", async () => {
  const e = env();
  await handleUpdate(textUpdate(7, "/start"), e);
  const sent = e.CAPTURE.find(x => x.method === "sendMessage");
  const kb = sent.body.reply_markup.keyboard.flat().map(b => b.text).join(" ");
  assert.match(kb, /Заявки/);
  assert.match(kb, /Управление/);
});

test("/cancel during tariff edit", async () => {
  const e = env();
  e.CAPTURE = [];
  const p = await getProfile(e);
  await handleUpdate({
    callback_query: {
      id: "1",
      from: { id: 7, first_name: "O" },
      message: { chat: { id: 7 }, message_id: 1 },
      data: "tariff:base_fee"
    }
  }, e);
  const st = await getState(e, 7);
  assert.equal(st.mode, "edit_tariff");
  e.CAPTURE = [];
  await handleUpdate(textUpdate(7, "/cancel"), e);
  const st2 = await getState(e, 7);
  assert.equal(st2.mode, undefined);
  assert.match(e.CAPTURE[0].body.text, /отменено/i);
});

test("client cannot edit card", async () => {
  const e = env();
  await handleUpdate(textUpdate(42, "✏️ Изменить визитку"), e);
  const last = e.CAPTURE.at(-1);
  assert.match(last.body.text, /меню|Не понял|владельц/i);
});

test("blacklist blocks user", async () => {
  const e = env();
  const { addBlacklist } = await import("../src/lib/rateLimit.js");
  await addBlacklist(e, "42", "test");
  e.CAPTURE = [];
  await handleUpdate(textUpdate(42, "/start"), e);
  assert.match(e.CAPTURE[0].body.text, /ограничен/);
});

test("address pair jumps to extras", async () => {
  const e = env();
  await handleUpdate(textUpdate(42, "Москва, Арбат → Одинцово"), e);
  const st = await getState(e, 42);
  assert.equal(st.mode, "calc_extras");
  assert.equal(st.from, "Москва, Арбат");
});
