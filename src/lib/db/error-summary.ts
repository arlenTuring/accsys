const PG_FIELDS = ['code', 'severity', 'schema_name', 'table_name', 'column_name', 'constraint_name', 'routine'] as const;

/**
 * Loggable view of an error thrown around a database call. PostgreSQL messages
 * and details can carry row values (`Key (google_email)=(…)`, `invalid input
 * syntax for type uuid: "…"`), and drizzle's DrizzleQueryError message embeds
 * the SQL and every bound parameter, so only identifiers and codes are kept
 * for those; other errors keep name, message and stack.
 */
export function errorSummary(err: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const e = current as Record<string, unknown>;
    const sqlState = typeof e.code === 'string' && /^(?=.*\d)[0-9A-Z]{5}$/.test(e.code);
    if (e.name === 'PostgresError' || (typeof e.severity === 'string' && typeof e.code === 'string') || sqlState) {
      for (const f of PG_FIELDS) if (typeof e[f] === 'string') out[`pg_${f}`] = e[f];
      return out;
    }
    if ('query' in e && 'params' in e) {
      out.wrapper = typeof e.name === 'string' ? e.name : 'query error';
      current = e.cause;
      continue;
    }
    out.name = e.name;
    out.message = e.message;
    if (typeof e.stack === 'string') out.stack = e.stack.split('\n').slice(1, 8).join('\n');
    current = e.cause;
    if (current) out.causedBy = true;
  }
  if (current !== undefined && typeof current !== 'object') out.value = typeof current;
  return out;
}
