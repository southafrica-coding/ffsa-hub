// ============================================================
// Test-only: a tiny in-memory stand-in for the Supabase query builder,
// enough of PostgREST for the Store services (eq / neq / in / is / or /
// order / limit / single / maybeSingle, insert / update / delete / upsert,
// rpc). Seeds and fixtures live in tests only — never in a migration.
// ============================================================

import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

export type MemoryDb = ReturnType<typeof createMemoryDb>;

export function createMemoryDb(
  seed: Record<string, Row[]> = {},
  opts: { rpc?: Record<string, (args: Record<string, unknown>, db: Record<string, Row[]>) => unknown>; unique?: Record<string, string[][]> } = {}
) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const t = (name: string) => (tables[name] ??= []);
  const log: Array<{ table: string; action: string }> = [];

  function parseOr(expr: string): Filter {
    const parts = expr.split(",").map((p) => {
      const [col, op, ...rest] = p.split(".");
      const val = rest.join(".");
      return (r: Row) => (op === "eq" ? String(r[col]) === val : op === "is" ? r[col] === null : false);
    });
    return (r) => parts.some((f) => f(r));
  }

  function builder(table: string) {
    let action: "select" | "insert" | "update" | "delete" | "upsert" = "select";
    let payload: Row | Row[] | null = null;
    let upsertOn: string[] | null = null;
    const filters: Filter[] = [];
    let single: "one" | "maybe" | null = null;
    let returning = false;
    let order: { col: string; asc: boolean } | null = null;
    let limit: number | null = null;
    let head = false;
    let count = false;

    const b = {
      select(_cols?: string, o?: { head?: boolean; count?: string }) {
        if (action !== "select") returning = true;
        head = !!o?.head;
        count = !!o?.count;
        return b;
      },
      insert(rows: Row | Row[]) { action = "insert"; payload = rows; return b; },
      update(patch: Row) { action = "update"; payload = patch; return b; },
      delete() { action = "delete"; return b; },
      upsert(rows: Row | Row[], o?: { onConflict?: string }) { action = "upsert"; payload = rows; upsertOn = o?.onConflict?.split(",") ?? ["id"]; return b; },
      eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return b; },
      neq(c: string, v: unknown) { filters.push((r) => r[c] !== v); return b; },
      in(c: string, v: unknown[]) { filters.push((r) => v.includes(r[c])); return b; },
      is(c: string, v: unknown) { filters.push((r) => (r[c] ?? null) === v); return b; },
      or(expr: string) { filters.push(parseOr(expr)); return b; },
      order(col: string, o?: { ascending?: boolean }) { order ??= { col, asc: o?.ascending !== false }; return b; },
      limit(n: number) { limit = n; return b; },
      single() { single = "one"; return b; },
      maybeSingle() { single = "maybe"; return b; },
      then(ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) {
        return Promise.resolve().then(run).then(ok, bad);
      },
    };

    function checkUnique(row: Row, except?: Row) {
      for (const cols of opts.unique?.[table] ?? []) {
        const clash = t(table).find((r) => r !== except && cols.every((c) => r[c] != null && r[c] === row[c]));
        if (clash) return { message: `duplicate key value violates unique constraint (${cols.join(",")})` };
      }
      return null;
    }

    function run() {
      log.push({ table, action });
      const match = (r: Row) => filters.every((f) => f(r));
      let out: Row[] = [];
      if (action === "select") {
        out = t(table).filter(match);
      } else if (action === "insert") {
        const rows = (Array.isArray(payload) ? payload : [payload!]).map((r) => ({ id: randomUUID(), created_at: new Date().toISOString(), ...r }));
        for (const r of rows) {
          const err = checkUnique(r);
          if (err) return { data: null, error: err };
          t(table).push(r);
        }
        out = rows;
      } else if (action === "update") {
        out = t(table).filter(match);
        for (const r of out) Object.assign(r, payload);
      } else if (action === "delete") {
        out = t(table).filter(match);
        tables[table] = t(table).filter((r) => !match(r));
      } else {
        const rows = Array.isArray(payload) ? payload : [payload!];
        for (const r of rows) {
          const existing = t(table).find((x) => upsertOn!.every((c) => x[c] === r[c]));
          if (existing) Object.assign(existing, r);
          else t(table).push({ ...r });
        }
        out = rows;
      }
      if (order) {
        const { col, asc } = order;
        out = [...out].sort((a, b) => (String(a[col] ?? "") < String(b[col] ?? "") ? (asc ? -1 : 1) : String(a[col] ?? "") > String(b[col] ?? "") ? (asc ? 1 : -1) : 0));
      }
      if (limit != null) out = out.slice(0, limit);
      const n = out.length;
      if (head) return { data: null, error: null, count: n };
      if (action !== "select" && !returning) return { data: null, error: null, count: count ? n : null };
      const copy = out.map((r) => ({ ...r }));
      if (single === "one") return copy.length === 1 ? { data: copy[0], error: null } : { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } };
      if (single === "maybe") return { data: copy[0] ?? null, error: null };
      return { data: copy, error: null, count: count ? n : null };
    }
    return b;
  }

  const client = {
    from: (table: string) => builder(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      const fn = opts.rpc?.[name];
      if (!fn) return { data: null, error: { message: `no rpc ${name}` } };
      return { data: fn(args, tables), error: null };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, tables, log, table: t };
}

/** The Store RPCs, as migration 412 defines them. */
export const storeRpcs = {
  store_take_stock: (args: Record<string, unknown>, db: Record<string, Row[]>) => {
    const v = (db.store_variants ?? []).find((r) => r.id === args.p_variant_id);
    if (!v) return false;
    if (v.stock === null || v.stock === undefined) return true;
    if ((v.stock as number) < (args.p_quantity as number)) return false;
    v.stock = (v.stock as number) - (args.p_quantity as number);
    return true;
  },
  store_register_device: (args: Record<string, unknown>, db: Record<string, Row[]>) => {
    const rows = (db.store_devices ??= []);
    const mine = rows.filter((r) => r.user_id === args.p_user_id && !r.removed_at);
    const same = mine.find((r) => r.device_hash === args.p_device_hash);
    if (same) {
      same.last_seen_at = new Date().toISOString();
      return "ok";
    }
    if (mine.length >= ((args.p_limit as number) ?? 3)) return "limit";
    rows.push({ id: randomUUID(), user_id: args.p_user_id, device_hash: args.p_device_hash, label: args.p_label, created_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), removed_at: null });
    return "ok";
  },
  // Only ever sets removed_at, only on the user's own active row.
  store_remove_device: (args: Record<string, unknown>, db: Record<string, Row[]>) => {
    const row = (db.store_devices ?? []).find((r) => r.id === args.p_device_id && r.user_id === args.p_user_id && !r.removed_at);
    if (!row) return false;
    row.removed_at = new Date().toISOString();
    return true;
  },
};
