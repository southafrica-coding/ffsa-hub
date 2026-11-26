// A small in-memory stand-in for the Supabase client, for tests and the vehicle booking
// simulation. It understands the query shapes the vehicle code uses: select with embedded
// relations ("alias:table(cols)", children by <parent>_id, parents by <table>_id), the
// common filters, insert/update/delete/upsert, maybeSingle/single. Not a database: no
// RLS, no constraints beyond upsert's onConflict.

/* eslint-disable @typescript-eslint/no-explicit-any */

type Row = Record<string, any>;
export type FakeTables = Record<string, Row[]>;

const singular = (t: string) => t.replace(/s$/, "");
let seq = 0;
const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Column defaults the real tables have (the code relies on these). */
const DEFAULTS: Record<string, Row> = {
  vehicle_booking_slack_alerts: { status: "open" },
};

export function createFakeDb(initial: FakeTables = {}) {
  const tables: FakeTables = JSON.parse(JSON.stringify(initial));
  const T = (name: string) => (tables[name] ??= []);

  function embed(from: string, row: Row, select: string): Row {
    const out: Row = { ...row };
    for (const tok of splitTop(select || "*")) {
      const m = tok.match(/^(?:(\w+):)?(\w+)(?:!\w+)?\(([\s\S]*)\)$/);
      if (!m) continue;
      const [, alias, rel, inner] = m;
      const key = alias || rel;
      const childFk = `${singular(from)}_id`;
      const parentFk = `${singular(rel)}_id`;
      if (T(rel).some((r) => childFk in r) || (rel !== from && !(parentFk in row))) {
        out[key] = T(rel)
          .filter((r) => r[childFk] === row.id)
          .map((r) => embed(rel, r, inner));
      } else {
        const p = T(rel).find((r) => r.id === row[parentFk]);
        out[key] = p ? embed(rel, p, inner) : null;
      }
    }
    return out;
  }

  function query(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
    let selectStr = "*";
    let payload: any = null;
    let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
    let returning = false;
    let single: "one" | "maybe" | null = null;
    let limitN: number | null = null;
    const orderBy: { col: string; asc: boolean }[] = [];

    const run = () => {
      let data: any = null;
      if (op === "select") {
        let rows = T(table).filter((r) => filters.every((f) => f(r)));
        for (const o of [...orderBy].reverse()) rows = [...rows].sort((a, b) => (a[o.col] < b[o.col] ? -1 : a[o.col] > b[o.col] ? 1 : 0) * (o.asc ? 1 : -1));
        if (limitN != null) rows = rows.slice(0, limitN);
        data = rows.map((r) => embed(table, r, selectStr));
      } else if (op === "insert") {
        const rows = (Array.isArray(payload) ? payload : [payload]).map((r: Row) => ({ id: newId(), created_at: new Date().toISOString(), ...DEFAULTS[table], ...r }));
        T(table).push(...rows);
        data = rows;
      } else if (op === "upsert") {
        const keys = (upsertOpts.onConflict || "id").split(",").map((k) => k.trim());
        const rows: Row[] = [];
        for (const r of Array.isArray(payload) ? payload : [payload]) {
          const hit = T(table).find((x) => keys.every((k) => x[k] === r[k]));
          if (hit) {
            if (!upsertOpts.ignoreDuplicates) {
              Object.assign(hit, r);
              rows.push(hit);
            }
          } else {
            const row = { id: newId(), created_at: new Date().toISOString(), ...DEFAULTS[table], ...r };
            T(table).push(row);
            rows.push(row);
          }
        }
        data = rows;
      } else if (op === "update") {
        const rows = T(table).filter((r) => filters.every((f) => f(r)));
        rows.forEach((r) => Object.assign(r, payload));
        data = rows;
      } else if (op === "delete") {
        const keep = T(table).filter((r) => !filters.every((f) => f(r)));
        data = T(table).filter((r) => filters.every((f) => f(r)));
        tables[table] = keep;
      }
      if (op !== "select" && !returning) data = null;
      if (single) {
        const one = Array.isArray(data) ? data[0] ?? null : data;
        if (single === "one" && !one) return { data: null, error: { message: "No rows" } };
        return { data: one, error: null };
      }
      return { data, error: null, count: Array.isArray(data) ? data.length : null };
    };

    const b: any = {
      select(s?: string) {
        if (op === "select") selectStr = s || "*";
        else returning = true;
        return b;
      },
      insert(p: any) {
        op = "insert";
        payload = p;
        return b;
      },
      update(p: any) {
        op = "update";
        payload = p;
        return b;
      },
      delete() {
        op = "delete";
        return b;
      },
      upsert(p: any, o: any = {}) {
        op = "upsert";
        payload = p;
        upsertOpts = o;
        return b;
      },
      eq: (c: string, v: any) => (filters.push((r) => r[c] === v), b),
      neq: (c: string, v: any) => (filters.push((r) => r[c] !== v), b),
      in: (c: string, v: any[]) => (filters.push((r) => v.includes(r[c])), b),
      is: (c: string, v: any) => (filters.push((r) => (v === null ? r[c] == null : r[c] === v)), b),
      not: (c: string, o: string, v: any) => (filters.push((r) => !(o === "is" && v === null ? r[c] == null : r[c] === v)), b),
      ilike: (c: string, v: string) => (filters.push((r) => String(r[c] ?? "").toLowerCase() === String(v).replace(/%/g, "").toLowerCase()), b),
      lte: (c: string, v: any) => (filters.push((r) => r[c] <= v), b),
      gte: (c: string, v: any) => (filters.push((r) => r[c] >= v), b),
      lt: (c: string, v: any) => (filters.push((r) => r[c] < v), b),
      gt: (c: string, v: any) => (filters.push((r) => r[c] > v), b),
      or: (expr: string) => {
        const parts = expr.split(",").map((p) => p.split("."));
        filters.push((r) => parts.some(([c, o, ...rest]) => o === "eq" && String(r[c]) === rest.join(".")));
        return b;
      },
      order: (col: string, o: { ascending?: boolean } = {}) => (orderBy.push({ col, asc: o.ascending !== false }), b),
      limit: (n: number) => ((limitN = n), b),
      maybeSingle: () => ((single = "maybe"), Promise.resolve(run())),
      single: () => ((single = "one"), Promise.resolve(run())),
      then: (ok: any, bad: any) => Promise.resolve(run()).then(ok, bad),
    };
    return b;
  }

  return {
    tables,
    from: (t: string) => query(t),
    rpc: async () => ({ data: null, error: null }),
  };
}
