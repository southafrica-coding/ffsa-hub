// Test-only: a small in-memory stand-in for the PostgREST calls the L10
// code makes. Each statement runs in one go after a microtask, so calls
// started together interleave between statements, like separate requests,
// but a single UPDATE … WHERE … is atomic, like Postgres.
//
// `rls` lets a test model 416's policies for a session client: rows a user
// cannot read are invisible, an insert they cannot write is 42501, and an
// update or delete skips rows they cannot write.

import { randomUUID } from "node:crypto";

export type Row = Record<string, unknown>;

export type Rls = {
  read: (table: string, row: Row, userId: string | null) => boolean;
  write: (table: string, row: Row, userId: string | null) => boolean;
  /** Answers supabase.rpc(name, args) for this user. */
  rpc?: (name: string, args: Record<string, unknown>, userId: string | null) => unknown;
};

type Filter = { op: string; args: unknown[] };

export type MemoryDb = {
  tables: Record<string, Row[]>;
  client: (opts?: { userId?: string | null; rls?: Rls }) => unknown;
  /** Every statement run, in order. */
  log: { table: string; action: string; payload?: unknown; filters: Filter[] }[];
};

const DEFAULTS: Record<string, Row> = {
  l10_meetings: { ended_at: null, recap_posted_at: null, followup_sent_at: null, notes: null, segment_timings: {} },
  l10_meeting_attendees: { rating: null, followup_sent_at: null },
  l10_todos: { source_meeting_id: null, owner_id: null, due_on: null, done: false, done_at: null },
  l10_issues: { source_meeting_id: null, resolved_meeting_id: null, solved_at: null, priority: null },
  l10_headlines: { is_auto: false, recap_of_meeting_id: null, dismissed_at: null, source_meeting_id: null },
  rocks: { team_id: null },
};

/** A column, or a JSON path like segment_timings->scorecard. */
function valueOf(row: Row, col: string): unknown {
  const parts = col.split(/->>?/);
  let v: unknown = row[parts[0]];
  for (const key of parts.slice(1)) v = v && typeof v === "object" ? (v as Row)[key] : undefined;
  return v ?? null;
}

/** JSON with sorted keys and undefined dropped, so two values compare like jsonb. */
function canonicalJson(v: unknown): string {
  const norm = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(norm)
      : x && typeof x === "object"
        ? Object.fromEntries(Object.keys(x as Row).sort().map((k) => [k, norm((x as Row)[k])]))
        : x;
  return JSON.stringify(norm(JSON.parse(JSON.stringify(v))));
}

/** eq: plain values by identity; a jsonb column against a JSON string (PostgREST eq.<json>) by value. */
function equalTo(v: unknown, val: unknown): boolean {
  if (v === val) return true;
  if (v !== null && typeof v === "object" && typeof val === "string") {
    try {
      return canonicalJson(v) === canonicalJson(JSON.parse(val));
    } catch {
      return false;
    }
  }
  return false;
}

function matches(row: Row, filters: Filter[]): boolean {
  for (const f of filters) {
    const [col, val, val2] = f.args as [string, unknown, unknown];
    const v = typeof col === "string" ? valueOf(row, col) : null;
    if (f.op === "eq" && !equalTo(v, val)) return false;
    if (f.op === "neq" && v === val) return false;
    if (f.op === "is" && v !== val) return false;
    if (f.op === "not" && val === "is" && v === val2) return false;
    if (f.op === "in" && !(val as unknown[]).includes(v)) return false;
    if (f.op === "gte" && !((v as string) >= (val as string))) return false;
    if (f.op === "lte" && !((v as string) <= (val as string))) return false;
  }
  return true;
}

function shape(rows: Row[], filters: Filter[]): Row[] {
  let out = rows.filter((r) => matches(r, filters));
  for (const f of filters) {
    if (f.op === "order") {
      const [col, opts] = f.args as [string, { ascending?: boolean } | undefined];
      const dir = opts?.ascending === false ? -1 : 1;
      out = [...out].sort((a, b) => {
        const x = a[col] as string | number | null;
        const y = b[col] as string | number | null;
        if (x === y) return 0;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return x < y ? -dir : dir;
      });
    }
  }
  const limit = filters.find((f) => f.op === "limit");
  if (limit) out = out.slice(0, limit.args[0] as number);
  return out;
}

export function createMemoryDb(
  seed: Record<string, Row[]> = {},
  /** false or an index name = a unique clash (23505, named like Postgres does). */
  opts: { unique?: (table: string, row: Row, all: Row[]) => boolean | string } = {}
): MemoryDb {
  const tables: Record<string, Row[]> = {};
  for (const [t, rows] of Object.entries(seed)) tables[t] = rows.map((r) => ({ ...r }));
  const log: MemoryDb["log"] = [];
  const rowsOf = (t: string) => (tables[t] ??= []);

  // 420: department_id on meetings and headlines is filled from the team and
  // overwritten if a client sends it. Same before insert, and before an
  // update that touches team_id or department_id.
  function setDepartmentFromTeam(table: string, row: Row): { code: string; message: string } | null {
    if (table !== "l10_meetings" && table !== "l10_headlines") return null;
    const team = rowsOf("l10_teams").find((t) => t.id === row.team_id);
    if (!team || typeof team.department_id !== "string") {
      return { code: "23503", message: `l10 team ${String(row.team_id)} not found` };
    }
    row.department_id = team.department_id;
    return null;
  }
  for (const table of ["l10_meetings", "l10_headlines"]) {
    for (const row of rowsOf(table)) setDepartmentFromTeam(table, row);
  }

  function client(c: { userId?: string | null; rls?: Rls } = {}) {
    const uid = c.userId ?? null;
    const canRead = (t: string, r: Row) => !c.rls || c.rls.read(t, r, uid);
    const canWrite = (t: string, r: Row) => !c.rls || c.rls.write(t, r, uid);

    function builder(table: string) {
      const q = { action: "select", payload: undefined as unknown, filters: [] as Filter[], single: false, returning: false };
      const exec = (): { data: unknown; error: unknown } => {
        log.push({ table, action: q.action, payload: q.payload, filters: q.filters });
        const all = rowsOf(table);
        let result: Row[] | null = null;
        if (q.action === "select") {
          result = shape(all.filter((r) => canRead(table, r)), q.filters);
        } else if (q.action === "insert") {
          const list = (Array.isArray(q.payload) ? q.payload : [q.payload]) as Row[];
          const made = list.map((p) => ({ id: randomUUID(), ...(DEFAULTS[table] ?? {}), ...p }));
          for (const r of made) {
            const err = setDepartmentFromTeam(table, r);
            if (err) return { data: null, error: err };
          }
          if (made.some((r) => !canWrite(table, r))) return { data: null, error: { code: "42501", message: "rls" } };
          for (const r of made) {
            const u = opts.unique ? opts.unique(table, r, all) : true;
            if (u !== true) {
              return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint "${u || "dup"}"` } };
            }
            all.push(r);
          }
          result = q.returning ? made.map((r) => ({ ...r })) : null;
        } else if (q.action === "update") {
          const hit = all.filter((r) => matches(r, q.filters) && canRead(table, r) && canWrite(table, r));
          const after = hit.map((r) => ({ ...r, ...(q.payload as Row) }));
          const payload = (q.payload ?? {}) as Row;
          if ("team_id" in payload || "department_id" in payload) {
            for (const r of after) {
              const err = setDepartmentFromTeam(table, r);
              if (err) return { data: null, error: err };
            }
          }
          if (after.some((r) => !canWrite(table, r))) return { data: null, error: { code: "42501", message: "rls" } };
          hit.forEach((r, i) => Object.assign(r, after[i]));
          result = q.returning ? hit.map((r) => ({ ...r })) : null;
        } else if (q.action === "delete") {
          const hit = all.filter((r) => matches(r, q.filters) && canRead(table, r) && canWrite(table, r));
          tables[table] = all.filter((r) => !hit.includes(r));
          result = q.returning ? hit.map((r) => ({ ...r })) : null;
        }
        if (q.single) {
          const one = result?.[0] ?? null;
          return { data: one, error: null };
        }
        return { data: result, error: null };
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select() {
          if (q.action !== "select") q.returning = true;
          return b;
        },
        single() {
          q.single = true;
          return b;
        },
        maybeSingle() {
          q.single = true;
          return b;
        },
        then(ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) {
          return Promise.resolve().then(exec).then(ok, bad);
        },
      };
      for (const op of ["insert", "update", "delete", "upsert"]) {
        b[op] = (payload?: unknown) => {
          q.action = op;
          q.payload = payload;
          return b;
        };
      }
      for (const op of ["eq", "neq", "is", "not", "in", "gte", "lte", "order", "limit"]) {
        b[op] = (...args: unknown[]) => {
          q.filters.push({ op, args });
          return b;
        };
      }
      return b;
    }

    return {
      from: (t: string) => builder(t),
      rpc: async (name: string, args: Record<string, unknown>) => {
        log.push({ table: `rpc:${name}`, action: "rpc", payload: args, filters: [] });
        if (!c.rls?.rpc) return { data: true, error: null };
        return { data: c.rls.rpc(name, args, uid), error: null };
      },
      auth: { getUser: async () => ({ data: { user: uid ? { id: uid } : null }, error: null }) },
    };
  }

  return { tables, client, log };
}
