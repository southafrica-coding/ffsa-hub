// Test-only: an in-memory stand-in for the PostgREST and Storage calls the
// Song Library code makes, after lib/l10/testing/memory-db, plus row
// triggers so a world can model 419's triggers. Each statement runs in one
// go after a microtask, so calls started together interleave between
// statements (like separate requests) but one statement is atomic.

import { randomUUID } from "node:crypto";

export type Row = Record<string, unknown>;
export type DbErr = { code: string; message: string };
type Filter = { op: string; args: unknown[] };

export type Ctx = { table: string; uid: string | null; db: MemoryDb };

export type Hooks = {
  /** May change `row` in place, or refuse with an error. */
  before?: (op: "insert" | "update" | "delete", row: Row, old: Row | null, ctx: Ctx) => DbErr | void;
  after?: (op: "insert" | "update" | "delete", row: Row, old: Row | null, ctx: Ctx) => void;
};

export type Rls = {
  read: (table: string, row: Row, uid: string | null) => boolean;
  write: (table: string, row: Row, uid: string | null) => boolean;
  rpc?: (name: string, args: Record<string, unknown>, uid: string | null) => unknown;
  storageWrite?: (path: string, uid: string | null) => boolean;
  storageRead?: (path: string, uid: string | null) => boolean;
};

export type MemoryDb = {
  tables: Record<string, Row[]>;
  /** Objects in the bucket: path → size. */
  objects: Map<string, number>;
  client: (opts?: { userId?: string | null; rls?: Rls }) => unknown;
  log: { table: string; action: string; payload?: unknown; filters: Filter[]; uid: string | null }[];
  /** Run a write as a trigger would (no RLS, no hooks). */
  raw: (table: string) => Row[];
};

function valueOf(row: Row, col: string): unknown {
  const parts = col.split(/->>?/);
  let v: unknown = row[parts[0]];
  for (const key of parts.slice(1)) v = v && typeof v === "object" ? (v as Row)[key] : undefined;
  return v ?? null;
}

function matches(row: Row, filters: Filter[]): boolean {
  for (const f of filters) {
    const [col, val, val2] = f.args as [string, unknown, unknown];
    const v = typeof col === "string" ? valueOf(row, col) : null;
    if (f.op === "eq" && v !== val) return false;
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
  for (const f of filters.filter((x) => x.op === "order").reverse()) {
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
  const limit = filters.find((f) => f.op === "limit");
  if (limit) out = out.slice(0, limit.args[0] as number);
  return out;
}

export function createMemoryDb(
  seed: Record<string, Row[]> = {},
  opts: {
    defaults?: Record<string, Row>;
    /** true = fine; a string = a 23505 on that index. */
    unique?: (table: string, row: Row, all: Row[]) => true | string;
    hooks?: Record<string, Hooks>;
  } = {}
): MemoryDb {
  const tables: Record<string, Row[]> = {};
  for (const [t, rows] of Object.entries(seed)) tables[t] = rows.map((r) => ({ ...r }));
  const objects = new Map<string, number>();
  const log: MemoryDb["log"] = [];
  const rowsOf = (t: string) => (tables[t] ??= []);
  let clock = 0;
  const now = () => new Date(Date.UTC(2026, 10, 26, 18, 0, 0) + clock++ * 1000).toISOString();

  const db: MemoryDb = { tables, objects, log, client, raw: rowsOf };

  function client(c: { userId?: string | null; rls?: Rls } = {}) {
    const uid = c.userId ?? null;
    const canRead = (t: string, r: Row) => !c.rls || c.rls.read(t, r, uid);
    const canWrite = (t: string, r: Row) => !c.rls || c.rls.write(t, r, uid);

    function builder(table: string) {
      const q = { action: "select", payload: undefined as unknown, filters: [] as Filter[], single: false, returning: false };
      const ctx: Ctx = { table, uid, db };
      const hooks = opts.hooks?.[table];
      const exec = (): { data: unknown; error: unknown } => {
        log.push({ table, action: q.action, payload: q.payload, filters: q.filters, uid });
        const all = rowsOf(table);
        let result: Row[] | null = null;
        if (q.action === "select") {
          result = shape(all.filter((r) => canRead(table, r)), q.filters);
        } else if (q.action === "insert") {
          const list = (Array.isArray(q.payload) ? q.payload : [q.payload]) as Row[];
          const made: Row[] = [];
          for (const p of list) {
            const r: Row = { id: randomUUID(), created_at: now(), ...(opts.defaults?.[table] ?? {}), ...p };
            const err = hooks?.before?.("insert", r, null, ctx);
            if (err) return { data: null, error: err };
            if (!canWrite(table, r)) return { data: null, error: { code: "42501", message: "new row violates row-level security policy" } };
            const u = opts.unique ? opts.unique(table, r, all) : true;
            if (u !== true) return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint "${u}"` } };
            made.push(r);
          }
          for (const r of made) {
            all.push(r);
            hooks?.after?.("insert", r, null, ctx);
          }
          result = q.returning ? made.map((r) => ({ ...r })) : null;
        } else if (q.action === "update") {
          const hit = all.filter((r) => matches(r, q.filters) && canRead(table, r) && canWrite(table, r));
          const after: Row[] = [];
          for (const r of hit) {
            const next = { ...r, ...(q.payload as Row) };
            const err = hooks?.before?.("update", next, r, ctx);
            if (err) return { data: null, error: err };
            if (!canWrite(table, next)) return { data: null, error: { code: "42501", message: "new row violates row-level security policy" } };
            after.push(next);
          }
          hit.forEach((r, i) => {
            const old = { ...r };
            Object.assign(r, after[i]);
            hooks?.after?.("update", r, old, ctx);
          });
          result = q.returning ? hit.map((r) => ({ ...r })) : null;
        } else if (q.action === "delete") {
          const hit = all.filter((r) => matches(r, q.filters) && canRead(table, r) && canWrite(table, r));
          for (const r of hit) {
            const err = hooks?.before?.("delete", r, r, ctx);
            if (err) return { data: null, error: err };
          }
          tables[table] = rowsOf(table).filter((r) => !hit.includes(r));
          for (const r of hit) hooks?.after?.("delete", r, r, ctx);
          result = q.returning ? hit.map((r) => ({ ...r })) : null;
        }
        if (q.single) return { data: result?.[0] ?? null, error: null };
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
      for (const op of ["insert", "update", "delete"]) {
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

    const storage = {
      from: (bucket: string) => ({
        async createSignedUploadUrl(path: string) {
          log.push({ table: `storage:${bucket}`, action: "sign-upload", payload: path, filters: [], uid });
          if (c.rls?.storageWrite && !c.rls.storageWrite(path, uid)) return { data: null, error: { message: "new row violates row-level security policy" } };
          return { data: { path, token: `tok-${path}`, signedUrl: `https://storage.test/upload/${bucket}/${path}?token=tok` }, error: null };
        },
        async createSignedUrl(path: string, expiresIn: number) {
          log.push({ table: `storage:${bucket}`, action: "sign-read", payload: path, filters: [], uid });
          if (c.rls?.storageRead && !c.rls.storageRead(path, uid)) return { data: null, error: { message: "Object not found" } };
          if (!objects.has(path)) return { data: null, error: { message: "Object not found" } };
          return { data: { signedUrl: `https://storage.test/read/${bucket}/${path}?e=${expiresIn}` }, error: null };
        },
        async info(path: string) {
          return objects.has(path) ? { data: { size: objects.get(path) }, error: null } : { data: null, error: { message: "Object not found" } };
        },
        async remove(paths: string[]) {
          for (const p of paths) objects.delete(p);
          return { data: paths, error: null };
        },
      }),
    };

    return {
      from: (t: string) => builder(t),
      rpc: async (name: string, args: Record<string, unknown> = {}) => {
        log.push({ table: `rpc:${name}`, action: "rpc", payload: args, filters: [], uid });
        if (!c.rls?.rpc) return { data: true, error: null };
        return { data: c.rls.rpc(name, args, uid), error: null };
      },
      auth: { getUser: async () => ({ data: { user: uid ? { id: uid } : null }, error: null }) },
      storage,
    };
  }

  return db;
}
