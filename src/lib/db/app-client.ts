import { randomUUID } from 'node:crypto';
import { getSql } from '@/lib/db';

export type DbError = { message: string };
// Legacy Supabase-compatible layer (removed in P5). Rows stay loosely typed so
// existing callers keep compiling; new code should use Drizzle via getDb().
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy compat rows, see above
export type DbRow = Record<string, any>;
export type DbResult<T = DbRow[]> = { data: T; error: DbError | null; count?: number | null };

function ident(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return `"${name}"`;
}

type Filter = { type: 'eq' | 'in' | 'gte' | 'lte'; column: string; value: unknown };

type Embed = {
  alias: string;
  table: string;
  fkColumn: string;
  columns: string[];
};

const DEFAULT_FK: Record<string, Record<string, string>> = {
  purchase_requests: {
    procurement_cases: 'procurement_case_id',
    departments: 'department_id',
    employees: 'applicant_employee_id',
    budget_codes: 'budget_code_id',
  },
  purchase_orders: {
    procurement_cases: 'procurement_case_id',
    departments: 'department_id',
    employees: 'applicant_employee_id',
    suppliers: 'supplier_id',
    purchase_requests: 'purchase_request_id',
  },
  acceptances: {
    procurement_cases: 'procurement_case_id',
    departments: 'department_id',
    employees: 'applicant_employee_id',
    suppliers: 'contractor_supplier_id',
    purchase_orders: 'purchase_order_id',
  },
  expense_requests: {
    procurement_cases: 'procurement_case_id',
    departments: 'department_id',
    employees: 'applicant_employee_id',
    suppliers: 'payee_supplier_id',
    purchase_orders: 'purchase_order_id',
    budget_codes: 'budget_code_id',
    acceptances: 'acceptance_id',
  },
  purchase_request_items: { budget_codes: 'budget_code_id' },
  purchase_order_items: { budget_codes: 'budget_code_id' },
  approval_steps: { employees: 'approver_employee_id' },
  budget_codes: {
    departments: 'department_id',
    projects: 'project_id',
    employees: 'owner_employee_id',
  },
};

function parseSelectList(raw: string | undefined): { columns: string[]; embeds: Embed[] } {
  if (!raw || raw === '*') return { columns: ['*'], embeds: [] };
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of raw) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());

  const columns: string[] = [];
  const embeds: Embed[] = [];
  for (const part of parts) {
    const embedMatch = part.match(
      /^(?:(\w+):)?(\w+)(?:!(\w+))?\(([^)]+)\)$/
    );
    if (embedMatch) {
      const [, alias, table, fkColumn, inner] = embedMatch;
      embeds.push({
        alias: alias || table,
        table,
        fkColumn: fkColumn || '',
        columns: inner.split(',').map((c) => c.trim()).filter(Boolean),
      });
    } else {
      columns.push(part);
    }
  }
  return { columns: columns.length ? columns : ['*'], embeds };
}

/**
 * Database errors never reach callers verbatim: PostgreSQL messages can contain
 * SQL fragments, constraint names and parameter values. The detail is logged
 * server-side under a short reference; callers get a stable code only.
 */
export function toError(err: unknown): DbError {
  const ref = randomUUID().slice(0, 8);
  const pgCode = (err as { code?: unknown } | null)?.code;
  console.error(`[db] error ref=${ref} code=${typeof pgCode === 'string' ? pgCode : 'unknown'}`, err);
  return { message: `database_error (ref ${ref})` };
}

class TableQuery implements PromiseLike<DbResult<DbRow[]>> {
  private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  private selectRaw: string | undefined;
  private countOnly = false;
  private filters: Filter[] = [];
  private orderCol: string | null = null;
  private orderAsc = true;
  private limitN: number | null = null;
  private payload: unknown = null;
  private onConflict: string | null = null;
  private returning = false;
  private mode: 'many' | 'single' | 'maybe' = 'many';

  constructor(private readonly table: string) {}

  select(columns?: string, opts?: { count?: string; head?: boolean }): this {
    this.selectRaw = columns;
    this.returning = true;
    if (opts?.count === 'exact' && opts.head) {
      this.countOnly = true;
    }
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ type: 'eq', column, value });
    return this;
  }

  in(column: string, value: unknown[]): this {
    this.filters.push({ type: 'in', column, value });
    return this;
  }

  gte(column: string, value: unknown): this {
    this.filters.push({ type: 'gte', column, value });
    return this;
  }

  lte(column: string, value: unknown): this {
    this.filters.push({ type: 'lte', column, value });
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderCol = column;
    this.orderAsc = opts?.ascending !== false;
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  insert(row: unknown): this {
    this.op = 'insert';
    this.payload = row;
    return this;
  }

  update(row: Record<string, unknown>): this {
    this.op = 'update';
    this.payload = row;
    return this;
  }

  upsert(row: unknown, opts?: { onConflict?: string }): this {
    this.op = 'upsert';
    this.payload = row;
    this.onConflict = opts?.onConflict ?? null;
    return this;
  }

  delete(): this {
    this.op = 'delete';
    return this;
  }

  maybeSingle(): Promise<DbResult<DbRow | null>> {
    this.mode = 'maybe';
    return this.execute() as Promise<DbResult<DbRow | null>>;
  }

  single(): Promise<DbResult<DbRow>> {
    this.mode = 'single';
    return this.execute() as Promise<DbResult<DbRow>>;
  }

  then<TResult1 = DbResult<DbRow[]>, TResult2 = never>(
    onfulfilled?: ((value: DbResult<DbRow[]>) => TResult1 | PromiseLike<TResult1>) | null | undefined,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null | undefined
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute() as Promise<DbResult<DbRow[]>>).then(
      onfulfilled ?? undefined,
      onrejected ?? undefined
    );
  }

  private whereSql(alias: string, params: unknown[]): string {
    if (this.filters.length === 0) return '';
    const parts = this.filters.map((f) => {
      const col = `${alias}.${ident(f.column)}`;
      if (f.type === 'in') {
        const arr = (f.value as unknown[]) ?? [];
        if (arr.length === 0) return 'false';
        const placeholders = arr.map((v) => {
          params.push(v);
          return `$${params.length}`;
        });
        return `${col} in (${placeholders.join(', ')})`;
      }
      params.push(f.value);
      const p = `$${params.length}`;
      if (f.type === 'eq') return `${col} = ${p}`;
      if (f.type === 'gte') return `${col} >= ${p}`;
      return `${col} <= ${p}`;
    });
    return ` where ${parts.join(' and ')}`;
  }

  private async execute(): Promise<DbResult<unknown>> {
    try {
      if (this.op === 'select') return await this.execSelect();
      if (this.op === 'insert' || this.op === 'upsert') return await this.execInsert();
      if (this.op === 'update') return await this.execUpdate();
      return await this.execDelete();
    } catch (err) {
      return { data: [], error: toError(err), count: null };
    }
  }

  private async execSelect(): Promise<DbResult<unknown>> {
    const params: unknown[] = [];
    const t = ident(this.table);
    if (this.countOnly) {
      const sqlText = `select count(*)::int as count from ${t} as t${this.whereSql('t', params)}`;
      const rows = await getSql().unsafe(sqlText, params as never[]);
      return { data: [], error: null, count: rows[0]?.count ?? 0 };
    }

    const { columns, embeds } = parseSelectList(this.selectRaw);
    const selectParts: string[] = [];
    if (columns.includes('*')) {
      selectParts.push('t.*');
    } else {
      for (const c of columns) {
        selectParts.push(`t.${ident(c)} as ${ident(c)}`);
      }
    }

    const joins: string[] = [];
    embeds.forEach((embed, i) => {
      const alias = `e${i}`;
      const fk =
        embed.fkColumn ||
        DEFAULT_FK[this.table]?.[embed.table];
      if (!fk) {
        throw new Error(`Unknown relation ${embed.table} on ${this.table}`);
      }
      joins.push(
        `left join ${ident(embed.table)} as ${alias} on ${alias}.id = t.${ident(fk)}`
      );
      const jsonFields = embed.columns
        .map((c) => `'${c}', ${alias}.${ident(c)}`)
        .join(', ');
      selectParts.push(
        `case when ${alias}.id is null then null else json_build_object(${jsonFields}) end as ${ident(embed.alias)}`
      );
    });

    let sqlText = `select ${selectParts.join(', ')} from ${t} as t ${joins.join(' ')}${this.whereSql('t', params)}`;
    if (this.orderCol) {
      sqlText += ` order by t.${ident(this.orderCol)} ${this.orderAsc ? 'asc' : 'desc'}`;
    }
    if (this.limitN != null) {
      sqlText += ` limit ${Number(this.limitN)}`;
    }

    const rows = await getSql().unsafe(sqlText, params as never[]);
    return this.wrapRows(rows);
  }

  private async execInsert(): Promise<DbResult<unknown>> {
    const rowsIn = Array.isArray(this.payload) ? this.payload : [this.payload];
    if (rowsIn.length === 0) return { data: [], error: null };
    const keys = Object.keys(rowsIn[0] as Record<string, unknown>);
    const params: unknown[] = [];
    const valueGroups = rowsIn.map((row) => {
      const rec = row as Record<string, unknown>;
      const placeholders = keys.map((k) => {
        params.push(rec[k] ?? null);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    const conflict =
      this.op === 'upsert' && this.onConflict
        ? ` on conflict (${ident(this.onConflict)}) do update set ${keys
            .filter((k) => k !== this.onConflict)
            .map((k) => `${ident(k)} = excluded.${ident(k)}`)
            .join(', ')}`
        : '';
    const returning = this.returning ? ' returning *' : '';
    const sqlText = `insert into ${ident(this.table)} (${keys.map(ident).join(', ')}) values ${valueGroups.join(', ')}${conflict}${returning}`;
    const rows = await getSql().unsafe(sqlText, params as never[]);
    return this.wrapRows(this.returning ? rows : []);
  }

  private async execUpdate(): Promise<DbResult<unknown>> {
    const rec = this.payload as Record<string, unknown>;
    const keys = Object.keys(rec);
    const params: unknown[] = [];
    const sets = keys.map((k) => {
      params.push(rec[k] ?? null);
      return `${ident(k)} = $${params.length}`;
    });
    const returning = this.returning ? ' returning *' : '';
    const sqlText = `update ${ident(this.table)} as t set ${sets.join(', ')}${this.whereSql('t', params)}${returning}`;
    const rows = await getSql().unsafe(sqlText, params as never[]);
    return this.wrapRows(this.returning ? rows : []);
  }

  private async execDelete(): Promise<DbResult<unknown>> {
    const params: unknown[] = [];
    const sqlText = `delete from ${ident(this.table)} as t${this.whereSql('t', params)}`;
    await getSql().unsafe(sqlText, params as never[]);
    return { data: [], error: null };
  }

  private wrapRows(rows: DbRow[]): DbResult<unknown> {
    if (this.mode === 'maybe') {
      return { data: rows[0] ?? null, error: null };
    }
    if (this.mode === 'single') {
      if (!rows[0]) return { data: null, error: { message: 'Row not found' } };
      return { data: rows[0], error: null };
    }
    return { data: rows, error: null };
  }
}

export type AppDb = {
  from: (table: string) => TableQuery;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy compat rpc results, see DbRow
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<DbResult<any>>;
};

export function createAppDb(): AppDb {
  return {
    from(table: string) {
      return new TableQuery(table);
    },
    async rpc(fn: string, args: Record<string, unknown> = {}) {
      try {
        ident(fn);
        const sql = getSql();
        const keys = Object.keys(args);
        const params = keys.map((k) => args[k]);
        const named =
          keys.length === 0
            ? ''
            : keys.map((k, i) => `${ident(k)} := $${i + 1}`).join(', ');
        const rows = await sql.unsafe(`select ${ident(fn)}(${named}) as result`, params as never[]);
        return { data: rows[0]?.result ?? null, error: null };
      } catch (err) {
        return { data: null, error: toError(err) };
      }
    },
  };
}
