export async function one(env, sql, ...args) {
  return env.DB.prepare(sql).bind(...args).first();
}

export async function run(env, sql, ...args) {
  return env.DB.prepare(sql).bind(...args).run();
}

export async function all(env, sql, ...args) {
  const r = await env.DB.prepare(sql).bind(...args).all();
  return r.results || r || [];
}

export function lastId(result) {
  return result?.meta?.last_row_id ?? result?.lastRowId ?? result?.lastInsertRowid ?? null;
}
