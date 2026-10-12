import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { initSqlite } from "../src/lib/sqlite.js";
import { getProfile, saveProfile, DEFAULT_PROFILE } from "../src/lib/profile.js";
import { insertQuote, getQuote, updateQuote, stats } from "../src/lib/quotes.js";
import { hitQuoteLimit, addBlacklist, isBlacklisted } from "../src/lib/rateLimit.js";
import { getState, saveState } from "../src/lib/state.js";
import { ensureUpcomingSlots, listSlots, setSlotStatus } from "../src/lib/slots.js";

function env() {
  const raw = new Database(":memory:");
  return { DB: initSqlite(raw), OWNER_TELEGRAM_ID: "1" };
}

test("profile roundtrip", async () => {
  const e = env();
  const p = await getProfile(e);
  assert.equal(p.minimum, DEFAULT_PROFILE.minimum);
  p.name = "Тест Логистик";
  await saveProfile(e, p);
  const p2 = await getProfile(e);
  assert.equal(p2.name, "Тест Логистик");
});

test("quotes insert and status", async () => {
  const e = env();
  const id = await insertQuote(e, {
    client_id: "42",
    from_addr: "A",
    to_addr: "B",
    cost: 3000,
    status: "quote",
    kind: "quote"
  });
  assert.ok(id > 0);
  const q = await getQuote(e, id);
  assert.equal(q.from_addr, "A");
  const u = await updateQuote(e, id, { status: "new", kind: "lead", phone: "+7" });
  assert.equal(u.status, "new");
  assert.equal(u.phone, "+7");
});

test("rate limit", async () => {
  const e = env();
  for (let i = 0; i < 10; i++) {
    const r = await hitQuoteLimit(e, "u1", 10);
    assert.equal(r.allowed, true);
  }
  const blocked = await hitQuoteLimit(e, "u1", 10);
  assert.equal(blocked.allowed, false);
  const other = await hitQuoteLimit(e, "u2", 10);
  assert.equal(other.allowed, true);
});

test("blacklist", async () => {
  const e = env();
  assert.equal(await isBlacklisted(e, "9"), false);
  await addBlacklist(e, "9", "spam");
  assert.equal(await isBlacklisted(e, "9"), true);
});

test("state ttl column", async () => {
  const e = env();
  await saveState(e, "5", { mode: "calc_from" });
  const s = await getState(e, "5");
  assert.equal(s.mode, "calc_from");
  await saveState(e, "5", {});
  const s2 = await getState(e, "5");
  assert.equal(s2.mode, undefined);
});

test("slots generated", async () => {
  const e = env();
  await ensureUpcomingSlots(e, 3);
  const slots = await listSlots(e, 3);
  assert.ok(slots.length >= 8);
  const first = slots[0];
  await setSlotStatus(e, first.date, first.time, "busy");
  const again = await listSlots(e, 3);
  assert.ok(again.some(s => s.status === "busy"));
});

test("stats on empty week", async () => {
  const e = env();
  const s = await stats(e);
  assert.equal(s.today.quotes, 0);
});
