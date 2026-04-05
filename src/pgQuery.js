// Convert SQLite-style ? placeholders to PostgreSQL $1, $2, ...
export function toPg(sql, params = []) {
  let n = 0;
  const text = sql.replace(/\?/g, () => `$${++n}`);
  if (n !== params.length) {
    throw new Error(`SQL placeholder count (${n}) does not match params (${params.length})`);
  }
  return { text, values: params };
}

export async function q(pool, sql, params = []) {
  const { text, values } = toPg(sql, params);
  return pool.query(text, values);
}

export async function qOne(pool, sql, params = []) {
  const r = await q(pool, sql, params);
  return r.rows[0];
}

export async function qAll(pool, sql, params = []) {
  const r = await q(pool, sql, params);
  return r.rows;
}

/** INSERT/UPDATE/DELETE; optional RETURNING id in sql */
export async function qExec(pool, sql, params = []) {
  const r = await q(pool, sql, params);
  return {
    rowCount: r.rowCount,
    rows: r.rows,
    lastInsertRowid: r.rows[0]?.id
  };
}

export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  const cq = async (sql, params = []) => {
    const { text, values } = toPg(sql, params);
    return client.query(text, values);
  };
  try {
    await client.query('BEGIN');
    await fn(cq);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
