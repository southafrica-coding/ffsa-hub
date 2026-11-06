// ────────────────────────────────────────────────────────────
// In-memory Supabase client for unit tests
// ────────────────────────────────────────────────────────────
// fake-supabase.ts records reads; this one also keeps rows, so a test can
// run code that writes (insert / update) and then look at the tables.
// Supports the query shapes the Xero mirror sync uses: select / insert /
// update with eq, in, is, lt, order, limit, single, maybeSingle. Column
// lists are ignored (whole rows come back). Unique rules and generated
// columns are declared per table by the test. Test-only.
// ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MemRow = Record<string, any>;

export type MemoryOptions = {
  /** Column defaults applied on insert. */
  defaults?: Record<string, MemRow>;
  /** Generated columns, recomputed on every insert/update. */
  generated?: Record<string, (row: MemRow) => MemRow>;
  /** Unique rules: the columns, and an optional partial-index condition. */
  unique?: Record<string, Array<{ cols: string[]; where?: (row: MemRow) => boolean }>>;
};

export function createMemorySupabase(seed: Record<string, MemRow[]>, options: MemoryOptions = {}) {
  const tables: Record<string, MemRow[]> = {};
  for (const [t, rows] of Object.entries(seed)) tables[t] = rows.map((r) => ({ ...r }));
  let seq = 0;
  const log: Array<{ table: string; op: string; payload?: unknown }> = [];

  const gen = (table: string, row: MemRow) => Object.assign(row, options.generated?.[table]?.(row) ?? {});

  function violates(table: string, row: MemRow, all: MemRow[]): string | null {
    for (const rule of options.unique?.[table] ?? []) {
      if (rule.where && !rule.where(row)) continue;
      const clash = all.some(
        (o) => o !== row && (!rule.where || rule.where(o)) && rule.cols.every((c) => o[c] === row[c])
      );
      if (clash) return `duplicate key value violates unique constraint (${table}: ${rule.cols.join(", ")})`;
    }
    return null;
  }

  function builder(table: string) {
    let op: "select" | "insert" | "update" = "select";
    let payload: MemRow | MemRow[] | null = null;
    let returning = false;
    let single: "one" | "maybe" | null = null;
    const filters: Array<(r: MemRow) => boolean> = [];
    const orders: Array<{ col: string; asc: boolean }> = [];
    let limit: number | null = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select() {
        if (op !== "select") returning = true;
        return b;
      },
      insert(rows: MemRow | MemRow[]) {
        op = "insert";
        payload = rows;
        return b;
      },
      update(patch: MemRow) {
        op = "update";
        payload = patch;
        return b;
      },
      eq(c: string, v: unknown) {
        filters.push((r) => r[c] === v);
        return b;
      },
      in(c: string, vs: unknown[]) {
        filters.push((r) => vs.includes(r[c]));
        return b;
      },
      is(c: string, v: unknown) {
        filters.push((r) => (r[c] ?? null) === v);
        return b;
      },
      lt(c: string, v: string) {
        filters.push((r) => r[c] != null && r[c] < v);
        return b;
      },
      order(col: string, o?: { ascending?: boolean }) {
        orders.push({ col, asc: o?.ascending !== false });
        return b;
      },
      limit(n: number) {
        limit = n;
        return b;
      },
      single() {
        single = "one";
        return b;
      },
      maybeSingle() {
        single = "maybe";
        return b;
      },
      then(ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) {
        return Promise.resolve().then(run).then(ok, bad);
      },
    };

    function shape(rows: MemRow[]) {
      const out = rows.map((r) => ({ ...r }));
      if (single === "one") {
        return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: `expected one row, got ${out.length}` } };
      }
      if (single === "maybe") return { data: out[0] ?? null, error: null };
      return { data: out, error: null };
    }

    function run() {
      const all = (tables[table] ??= []);
      log.push({ table, op, payload });
      if (op === "insert") {
        const list = (Array.isArray(payload) ? payload : [payload!]).map((r) =>
          gen(table, { id: `${table}-${++seq}`, ...(options.defaults?.[table] ?? {}), ...r })
        );
        const staged = [...all, ...list];
        for (const r of list) {
          const v = violates(table, r, staged);
          if (v) return { data: null, error: { code: "23505", message: v } };
        }
        all.push(...list);
        return returning ? shape(list) : { data: null, error: null };
      }
      let rows = all.filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        const before = rows.map((r) => ({ ...r }));
        rows.forEach((r) => gen(table, Object.assign(r, payload)));
        for (const r of rows) {
          const v = violates(table, r, all);
          if (v) {
            rows.forEach((r2, i) => {
              for (const k of Object.keys(r2)) delete r2[k];
              Object.assign(r2, before[i]);
            });
            return { data: null, error: { code: "23505", message: v } };
          }
        }
        return returning ? shape(rows) : { data: null, error: null };
      }
      for (const o of [...orders].reverse()) {
        rows = [...rows].sort((a, z) => (a[o.col] === z[o.col] ? 0 : (a[o.col] < z[o.col]) === o.asc ? -1 : 1));
      }
      if (limit !== null) rows = rows.slice(0, limit);
      return shape(rows);
    }

    return b;
  }

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: { from: (t: string) => builder(t) } as any,
    tables,
    log,
  };
}
