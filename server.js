import http from "node:http";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { initSqlite } from "./lib/sqlite.js";
import { fetchHandler, scheduledHandler } from "./app.js";
import { seedIfEmpty } from "./lib/seed.js";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));

function loadEnvFile() {
  const p = join(ROOT, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] == null) process.env[k] = v;
  }
}

loadEnvFile();

const PORT = Number(process.env.PORT || 8787);
const dbPath = process.env.DATABASE_PATH || join(ROOT, "data/cargo.db");
mkdirSync(join(ROOT, "data"), { recursive: true });
const raw = new Database(dbPath);
raw.pragma("journal_mode = WAL");
const DB = initSqlite(raw);

const env = {
  DB,
  BOT_TOKEN: process.env.BOT_TOKEN || "",
  BOT_USERNAME: process.env.BOT_USERNAME || "",
  OWNER_TELEGRAM_ID: process.env.OWNER_TELEGRAM_ID || "1",
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || "dev-secret",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  OPENAI_MODEL: process.env.OPENAI_MODEL || "gpt-4.1-mini",
  CHANNEL_ID: process.env.CHANNEL_ID || ""
};

await seedIfEmpty(env);

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || `127.0.0.1:${PORT}`;
    const url = new URL(req.url || "/", `http://${host}`);
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
    }
    const request = new Request(url, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : body
    });
    const response = await fetchHandler(request, env);
    const outHeaders = {};
    response.headers.forEach((v, k) => { outHeaders[k] = v; });
    const buf = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, outHeaders);
    res.end(buf);
  } catch (e) {
    console.error(e);
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Internal error");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Telegram bot webhook: http://0.0.0.0:${PORT}/webhook`);
  console.log(`Health: http://0.0.0.0:${PORT}/health`);
  if (!env.BOT_TOKEN) console.log("BOT_TOKEN не задан — вебхук не примет апдейты. Заполните .env");
});

setInterval(() => {
  scheduledHandler(null, env).catch(e => console.error("cron", e));
}, 60 * 1000);
