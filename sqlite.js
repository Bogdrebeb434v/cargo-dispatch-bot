import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../schema.sql");

export function wrapSqlite(db) {
  return {
    prepare(sql) {
      const stmt = {
        _args: [],
        bind(...args) {
          this._args = args;
          return this;
        },
        async first() {
          try {
            return db.prepare(sql).get(...this._args) ?? null;
          } catch (e) {
            e.message = `${e.message} | SQL: ${sql}`;
            throw e;
          }
        },
        async run() {
          try {
            const info = db.prepare(sql).run(...this._args);
            return { success: true, meta: { last_row_id: info.lastInsertRowid, changes: info.changes } };
          } catch (e) {
            e.message = `${e.message} | SQL: ${sql}`;
            throw e;
          }
        },
        async all() {
          try {
            const results = db.prepare(sql).all(...this._args);
            return { results };
          } catch (e) {
            e.message = `${e.message} | SQL: ${sql}`;
            throw e;
          }
        }
      };
      return stmt;
    },
    async exec(sql) {
      db.exec(sql);
    }
  };
}

export function initSqlite(raw) {
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  raw.exec(schema);
  return wrapSqlite(raw);
}
