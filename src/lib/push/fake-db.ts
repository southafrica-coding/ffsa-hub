// ────────────────────────────────────────────────────────────
// Test-only: a recording Supabase stand-in for the push tests
// ────────────────────────────────────────────────────────────
// Like src/lib/testing/fake-supabase.ts, but it also records writes
// (insert / upsert / update / delete) with their payloads, which the
// device and sender tests need. `resolve` decides what each call returns.
// Nothing in the app imports this.
// ────────────────────────────────────────────────────────────

export type FakeOp = {
  table: string;
  action: "select" | "insert" | "upsert" | "update" | "delete";
  payload?: unknown;
  options?: unknown;
  columns: string | null;
  filters: Array<{ op: string; args: unknown[] }>;
  single: boolean;
};

export type FakeOut = { data?: unknown; error?: unknown };

export function filterArg(op: FakeOp, kind: string, column: string): unknown {
  return op.filters.find((f) => f.op === kind && f.args[0] === column)?.args[1];
}

export function createPushFake(options: {
  userId?: string | null;
  resolve?: (op: FakeOp) => FakeOut | undefined;
}) {
  const ops: FakeOp[] = [];

  function builder(table: string) {
    const op: FakeOp = { table, action: "select", columns: null, filters: [], single: false };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select(columns?: string) {
        op.columns = columns ?? "*";
        return b;
      },
      insert(payload: unknown, opts?: unknown) {
        Object.assign(op, { action: "insert", payload, options: opts });
        return b;
      },
      upsert(payload: unknown, opts?: unknown) {
        Object.assign(op, { action: "upsert", payload, options: opts });
        return b;
      },
      update(payload: unknown) {
        Object.assign(op, { action: "update", payload });
        return b;
      },
      delete() {
        op.action = "delete";
        return b;
      },
      single() {
        op.single = true;
        return b;
      },
      maybeSingle() {
        op.single = true;
        return b;
      },
      then(ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) {
        ops.push(op);
        const out = options.resolve?.(op) ?? {};
        return Promise.resolve({ data: out.data ?? null, error: out.error ?? null }).then(ok, fail);
      },
    };
    for (const f of ["eq", "in", "is", "neq", "order", "limit"]) {
      b[f] = (...args: unknown[]) => {
        op.filters.push({ op: f, args });
        return b;
      };
    }
    return b;
  }

  const client = {
    from: (table: string) => builder(table),
    auth: {
      async getUser() {
        const id = options.userId ?? null;
        return { data: { user: id ? { id } : null }, error: null };
      },
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, ops };
}

export const MISSING_TABLE = {
  code: "PGRST205",
  message: "Could not find the table 'public.device_push_tokens' in the schema cache",
};
export const MISSING_COLUMN = {
  code: "PGRST204",
  message: "Could not find the 'push_muted_kinds' column of 'notification_preferences' in the schema cache",
};
