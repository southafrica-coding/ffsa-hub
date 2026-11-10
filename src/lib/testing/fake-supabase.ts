// ────────────────────────────────────────────────────────────
// Fake Supabase client for unit tests and query-cost measurement
// ────────────────────────────────────────────────────────────
// Records every query (table, columns, filters) and simulates one network
// round trip per awaited query / auth call. Two numbers fall out of a run:
//
//   - queries: how many PostgREST requests were made
//   - roundTrips: wall time ÷ latency — i.e. how many of those requests sat
//     on the critical path one after another. Parallel requests count once.
//
// The `resolve` callback decides what each query returns, so a test can
// model a specific user's roles / permissions without a database.
// Test-only: nothing in the app imports this.
// ────────────────────────────────────────────────────────────

export type FakeQuery = {
  table: string;
  columns: string | null;
  head: boolean;
  filters: Array<{ op: string; args: unknown[] }>;
  single: boolean;
  rpc?: { name: string; args: unknown };
};

export type FakeResult = { data?: unknown; error?: unknown; count?: number | null };

export type FakeUser = { id: string; email?: string } | null;

export function filterValue(q: FakeQuery, op: string, column: string): unknown {
  const f = q.filters.find((x) => x.op === op && x.args[0] === column);
  return f ? f.args[1] : undefined;
}

export function createFakeSupabase(options: {
  user?: FakeUser;
  resolve?: (q: FakeQuery) => FakeResult | Promise<FakeResult>;
  latencyMs?: number;
}) {
  const latency = options.latencyMs ?? 0;
  const queries: FakeQuery[] = [];
  let authCalls = 0;
  const sleep = () => new Promise((r) => setTimeout(r, latency));

  async function run(q: FakeQuery): Promise<FakeResult & { data: unknown; error: unknown }> {
    queries.push(q);
    await sleep();
    const out = (await options.resolve?.(q)) ?? {};
    let data = out.data ?? null;
    if (q.single && Array.isArray(data)) data = data[0] ?? null;
    return { data, error: out.error ?? null, count: out.count ?? null };
  }

  function builder(table: string, rpc?: FakeQuery["rpc"]) {
    const q: FakeQuery = { table, columns: null, head: false, filters: [], single: false, rpc };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select(columns?: string, opts?: { head?: boolean }) {
        q.columns = columns ?? "*";
        q.head = !!opts?.head;
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
      then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
        return run(q).then(onFulfilled, onRejected);
      },
    };
    for (const op of ["eq", "neq", "in", "is", "not", "or", "gte", "lte", "gt", "lt", "ilike", "order", "limit", "range", "contains", "filter", "match"]) {
      b[op] = (...args: unknown[]) => {
        q.filters.push({ op, args });
        return b;
      };
    }
    return b;
  }

  const client = {
    from: (table: string) => builder(table),
    rpc: (name: string, args: unknown) => builder(`rpc:${name}`, { name, args }),
    auth: {
      async getUser() {
        authCalls++;
        await sleep();
        return options.user
          ? { data: { user: options.user }, error: null }
          : { data: { user: null }, error: null };
      },
      async getSession() {
        return {
          data: { session: options.user ? { access_token: "token", user: options.user } : null },
          error: null,
        };
      },
    },
  };

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: client as any,
    queries,
    get authCalls() {
      return authCalls;
    },
  };
}

// ── Permission world ───────────────────────────────────────
// Answers the user_roles / user_permissions / role_permissions query shapes
// the access helpers use, from a plain description of one user's access.

export type Perm = {
  module: string;
  key: string;
  scopeType?: string | null;
  scopeId?: string | null;
};
export type PermissionWorld = {
  roles: Array<{ id: string; name: string; scopeType?: string | null; scopeId?: string | null }>;
  direct: Perm[];
  bundles?: Record<string, Perm[]>; // role id → bundle
  /** users.is_active. Omitted means active. false is an inactive account. */
  active?: boolean;
};

function matchesEmbeddedFilters(q: FakeQuery, prefix: string, row: Record<string, unknown>) {
  for (const f of q.filters) {
    const col = f.args[0];
    if (typeof col !== "string" || !col.startsWith(`${prefix}.`)) continue;
    const field = col.slice(prefix.length + 1);
    if (f.op === "eq" && row[field] !== f.args[1]) return false;
    if (f.op === "in" && !(f.args[1] as unknown[]).includes(row[field])) return false;
  }
  return true;
}

export function permissionWorldResolver(world: PermissionWorld) {
  return (q: FakeQuery): FakeResult | null => {
    if (q.table === "users" && (q.columns ?? "").includes("is_active")) {
      return {
        data: [{ id: filterValue(q, "eq", "id") ?? null, is_active: world.active !== false }],
      };
    }
    if (q.table === "user_roles") {
      const rows = world.roles
        .filter((r) => matchesEmbeddedFilters(q, "roles", r))
        .map((r) => ({
          role_id: r.id,
          scope_type: r.scopeType ?? null,
          scope_id: r.scopeId ?? null,
          roles: { name: r.name },
        }));
      return { data: rows };
    }
    if (q.table === "user_permissions") {
      const rows = world.direct
        .filter((p) => matchesEmbeddedFilters(q, "permissions", p))
        .map((p) => ({
          scope_id: p.scopeId ?? null,
          scope_type: p.scopeType ?? null,
          permissions: p,
        }));
      return { data: rows };
    }
    if (q.table === "role_permissions") {
      const listed = filterValue(q, "in", "role_id") as string[] | undefined;
      const one = filterValue(q, "eq", "role_id");
      const roleIds = listed ?? (one != null ? [String(one)] : []);
      const rows = roleIds
        .flatMap((id) => (world.bundles?.[id] ?? []).map((p) => ({ role_id: id, permissions: p })))
        .filter((row) => matchesEmbeddedFilters(q, "permissions", row.permissions));
      return { data: rows };
    }
    return null;
  };
}

/** Run `fn`, returning its result plus elapsed round trips at the given latency. */
export async function measure<T>(latencyMs: number, fn: () => Promise<T>) {
  const start = performance.now();
  const result = await fn();
  const elapsed = performance.now() - start;
  return { result, roundTrips: Math.round(elapsed / latencyMs) };
}
