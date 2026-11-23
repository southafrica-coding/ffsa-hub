import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Fakes only: access, Supabase and Xero are all stubbed. Nothing touches a DB.
const state = vi.hoisted(() => ({
  allow: false,
  calls: [] as Array<{ slug: string; roles: readonly string[] | undefined }>,
  adminCreated: 0,
  xeroCalls: 0,
  upsertError: null as null | { code: string; message: string },
  upserts: [] as unknown[],
}));

vi.mock("@/lib/missio/access", () => ({
  MISSIO_SLUG: "missio",
  requireOrgRole: async (slug: string, roles?: readonly string[]) => {
    state.calls.push({ slug, roles });
    if (!state.allow) return { response: NextResponse.json({ error: "Not authorized", code: "forbidden" }, { status: 403 }) };
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "lte", "order", "delete"]) chain[m] = () => chain;
    chain.upsert = (row: unknown) => {
      state.upserts.push(row);
      return chain;
    };
    chain.single = async () => ({ data: null, error: state.upsertError });
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
    return { user: { id: "u1" }, orgId: "org-missio", roles: ["pastor"], supabase: { from: () => chain } };
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    state.adminCreated += 1;
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq"]) chain[m] = () => chain;
    chain.then = (resolve: (v: unknown) => void) =>
      resolve({ data: [{ xero_account_id: "00000000-0000-4000-8000-0000000000aa", name: "MISSIO - 1234567890", code: "5110" }], error: null });
    return { from: () => chain };
  },
}));

vi.mock("@/services/xero", () => ({
  listXeroBankReceipts: async () => {
    state.xeroCalls += 1;
    return { status: "needs_scope", message: "x" };
  },
}));

import { GET } from "./route";
import { DELETE, POST } from "./entries/route";

beforeEach(() => {
  state.allow = false;
  state.calls = [];
  state.adminCreated = 0;
  state.xeroCalls = 0;
  state.upsertError = null;
  state.upserts = [];
});

function post(body: unknown) {
  return new Request("http://hub.test/api/missio/finance/entries", { method: "POST", body: JSON.stringify(body) });
}

describe("Missio finance routes: who gets in", () => {
  it("asks for the Missio pastor role on every route", async () => {
    await GET(new Request("http://hub.test/api/missio/finance"));
    await POST(post({}));
    await DELETE(new Request("http://hub.test/api/missio/finance/entries?source=cash&month=2026-08", { method: "DELETE" }));
    expect(state.calls).toEqual([
      { slug: "missio", roles: ["pastor"] },
      { slug: "missio", roles: ["pastor"] },
      { slug: "missio", roles: ["pastor"] },
    ]);
  });

  it("refuses leaders, coaches and FFSA admins before reading anything", async () => {
    const res = await GET(new Request("http://hub.test/api/missio/finance"));
    expect(res.status).toBe(403);
    expect(state.adminCreated).toBe(0);
    expect(state.xeroCalls).toBe(0);
    expect((await POST(post({ source: "cash", month: "2026-08", amount: "1" }))).status).toBe(403);
    expect(state.upserts).toHaveLength(0);
  });
});

describe("Missio finance routes: pastors", () => {
  it("returns the report with the bank reason and no account number", async () => {
    state.allow = true;
    const res = await GET(new Request("http://hub.test/api/missio/finance"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bank.state).toBe("needs_scope");
    expect(body.bank.accountLabel).toBe("MISSIO (account 5110)");
    expect(JSON.stringify(body)).not.toContain("1234567890");
    expect(body.report.fromMonth).toBe("2026-07");
  });

  it("rejects a bad range", async () => {
    state.allow = true;
    expect((await GET(new Request("http://hub.test/api/missio/finance?from=2026-13"))).status).toBe(400);
  });

  it("validates entries and answers 503 until migration 394 is applied", async () => {
    state.allow = true;
    expect((await POST(post({ source: "cash", month: "2026-08", amount: "abc" }))).status).toBe(400);
    state.upsertError = { code: "PGRST205", message: "Could not find the table 'public.missio_finance_entries' in the schema cache" };
    const res = await POST(post({ source: "cash", month: "2026-08", amount: "1900" }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("not_installed");
    expect(state.upserts[0]).toMatchObject({ org_id: "org-missio", source: "cash", month: "2026-08-01", cash_cents: 190000 });
  });
});
