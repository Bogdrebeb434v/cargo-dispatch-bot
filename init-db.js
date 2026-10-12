import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { initSqlite } from "../src/lib/sqlite.js";
import { seedIfEmpty } from "../src/lib/seed.js";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
mkdirSync(join(ROOT, "data"), { recursive: true });
const path = process.env.DATABASE_PATH || join(ROOT, "data/cargo.db");
const raw = new Database(path);
const DB = initSqlite(raw);
await seedIfEmpty({ DB });
console.log("DB ready:", path);
