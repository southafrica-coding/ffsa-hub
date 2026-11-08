/**
 * Next route handlers and the workbook service against disposable PostgREST.
 *
 * The cookie/session boundary is replaced: createClient() returns a
 * supabase-js client whose JWT is a local HMAC token, and auth.getUser()
 * is stubbed with that token's sub. There is no GoTrue and no browser.
 * Queries and RPCs are the real client against local PostgREST and Postgres.
 *
 * Skipped unless FFSA_PGRST_URL is set (scripts/finance-workbook-db/integrate.sh).
 */
import { createHmac } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

const enabled = Boolean(process.env.FFSA_PGRST_URL);
const gate = vi.hoisted(() => ({ client: null as SupabaseClient | null }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    if (!gate.client) throw new Error("integration client was not set");
    return gate.client;
  },
}));

import { GET as listGet, POST } from "@/app/api/finance/budgets/route";
import { GET as oneGet, PUT } from "@/app/api/finance/budgets/[id]/route";

const FINANCE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const EDITOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const APPROVER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const LEADER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
const MINISTRY = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";

function token(sub: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ role: "authenticated", sub, exp: 1893456000 })).toString("base64url");
  const data = `${header}.${payload}`;
  const sig = createHmac("sha256", process.env.FFSA_PGRST_JWT_SECRET || "local-harness-secret-not-production")
    .update(data)
    .digest("base64url");
  return `${data}.${sig}`;
}

function asUser(url: string, sub: string): SupabaseClient {
  const client = createClient(url, token(sub), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (input, init) => {
        const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        return fetch(raw.replace("/rest/v1", ""), init);
      },
    },
  });
  client.auth.getUser = (async () => ({ data: { user: { id: sub } }, error: null })) as typeof client.auth.getUser;
  return client;
}

async function jsonOf(res: Response) {
  const body = await res.json();
  return { status: res.status, body };
}

describe.skipIf(!enabled)("workbook routes on local PostgREST", () => {
  const full = process.env.FFSA_PGRST_URL!;
  const noFn = process.env.FFSA_PGRST_NOFN_URL!;
  const noTable = process.env.FFSA_PGRST_NOTABLE_URL!;
  const finance = asUser(full, FINANCE);
  const leader = asUser(full, LEADER);
  const editor = asUser(full, EDITOR);
  const approver = asUser(full, APPROVER);
  let periodId = "";

  beforeAll(async () => {
    const org = await finance.from("finance_orgs").select("id").eq("key", "npc").maybeSingle();
    if (org.error || !org.data) throw new Error(`npc org: ${org.error?.message ?? "missing"}`);
    const period = await finance
      .from("fiscal_periods")
      .insert({
        org_id: org.data.id,
        label: `Integration ${randomUUID().slice(0, 8)}`,
        kind: "year",
        start_date: "2027-01-01",
        end_date: "2027-12-31",
      })
      .select("id")
      .single();
    if (period.error || !period.data) throw new Error(`period: ${period.error?.message ?? "missing"}`);
    periodId = period.data.id as string;
  });

  afterAll(() => {
    delete process.env.VERCEL_ENV;
  });

  it("refuses preview create and save before any write", async () => {
    const before = await finance.from("budgets").select("id", { count: "exact", head: true });
    process.env.VERCEL_ENV = "preview";
    gate.client = leader;
    try {
      const created = await jsonOf(
        await POST(
          new Request("http://127.0.0.1/api/finance/budgets", {
            method: "POST",
            body: JSON.stringify({
              name: "Preview must not create",
              ownerKind: "staff_ministry",
              ownerId: MINISTRY,
              periodId,
            }),
          })
        )
      );
      const saved = await jsonOf(
        await PUT(
          new Request("http://127.0.0.1/api/finance/budgets/x", {
            method: "PUT",
            body: JSON.stringify({ updatedAt: "2026-01-01T00:00:00.000Z", notes: "no" }),
          }),
          { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
        )
      );
      expect(created.status).toBe(403);
      expect(created.body).toEqual({
        error: "preview_writes_disabled",
        message: "This preview deployment cannot change budgets.",
      });
      expect(saved.status).toBe(403);
      expect(saved.body).toMatchObject({ error: "preview_writes_disabled" });
    } finally {
      delete process.env.VERCEL_ENV;
    }
    const after = await finance.from("budgets").select("id", { count: "exact", head: true });
    expect(after.count).toBe(before.count);
  });

  it("returns schema_not_applied when the budgets table is absent", async () => {
    gate.client = asUser(noTable, FINANCE);
    const result = await jsonOf(
      await POST(
        new Request("http://127.0.0.1/api/finance/budgets", {
          method: "POST",
          body: JSON.stringify({
            name: "Missing table",
            ownerKind: "staff_ministry",
            ownerId: MINISTRY,
            periodId: "66666666-6666-4666-8666-666666666666",
          }),
        })
      )
    );
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ code: "schema_not_applied" });
  });

  it("returns schema_not_applied when migration 303's function is absent", async () => {
    const org = await asUser(noFn, FINANCE).from("finance_orgs").select("id").eq("key", "npc").maybeSingle();
    expect(org.error).toBeNull();
    const period = await asUser(noFn, FINANCE)
      .from("fiscal_periods")
      .insert({
        org_id: org.data!.id,
        label: `NoFn ${randomUUID().slice(0, 8)}`,
        kind: "year",
        start_date: "2027-01-01",
        end_date: "2027-12-31",
      })
      .select("id")
      .single();
    expect(period.error).toBeNull();
    gate.client = asUser(noFn, FINANCE);
    const result = await jsonOf(
      await POST(
        new Request("http://127.0.0.1/api/finance/budgets", {
          method: "POST",
          body: JSON.stringify({
            name: "Missing function",
            ownerKind: "program",
            ownerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
            periodId: period.data!.id,
          }),
        })
      )
    );
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ code: "schema_not_applied" });
  });

  it("lets a ministry leader create, load, and save without reading finance_orgs", async () => {
    gate.client = leader;
    const lineId = randomUUID();
    const orgs = await leader.from("finance_orgs").select("id");
    expect(orgs.data).toEqual([]);
    const created = await jsonOf(
      await POST(
        new Request("http://127.0.0.1/api/finance/budgets", {
          method: "POST",
          body: JSON.stringify({
            name: `Leader integration ${randomUUID().slice(0, 8)}`,
            ownerKind: "staff_ministry",
            ownerId: MINISTRY,
            periodId,
            lines: [{ id: lineId, kind: "fixed", name: "Van", amountCents: 100, multiplier: 1 }],
          }),
        })
      )
    );
    expect(created.status).toBe(201);
    const budget = created.body.budget as { id: string; updatedAt: string; orgId: string; lines: { amountCents: number }[] };
    expect(budget.lines[0].amountCents).toBe(100);
    const loaded = await jsonOf(await oneGet(new Request("http://127.0.0.1/api/finance/budgets/" + budget.id), { params: Promise.resolve({ id: budget.id }) }));
    expect(loaded.status).toBe(200);
    const saved = await jsonOf(
      await PUT(
        new Request("http://127.0.0.1/api/finance/budgets/" + budget.id, {
          method: "PUT",
          body: JSON.stringify({
            updatedAt: budget.updatedAt,
            lines: [{ id: lineId, kind: "fixed", name: "Van", amountCents: 250, multiplier: 1 }],
          }),
        }),
        { params: Promise.resolve({ id: budget.id }) }
      )
    );
    expect(saved.status).toBe(200);
    expect((saved.body.budget as { lines: { amountCents: number }[] }).lines[0].amountCents).toBe(250);
    const listed = await jsonOf(await listGet(new Request("http://127.0.0.1/api/finance/budgets?ownerKind=staff_ministry&ownerId=" + MINISTRY)));
    expect(listed.status).toBe(200);
    expect((listed.body.budgets as { id: string }[]).some((row) => row.id === budget.id)).toBe(true);
  });

  it("maps a stale revision to 409 and leaves the sheet unchanged, then a reload save works", async () => {
    gate.client = leader;
    const created = await jsonOf(
      await POST(
        new Request("http://127.0.0.1/api/finance/budgets", {
          method: "POST",
          body: JSON.stringify({
            name: `Revision integration ${randomUUID().slice(0, 8)}`,
            ownerKind: "staff_ministry",
            ownerId: MINISTRY,
            periodId,
            notes: "first",
          }),
        })
      )
    );
    expect(created.status).toBe(201);
    const budget = created.body.budget as { id: string; updatedAt: string; notes: string | null };
    const firstSave = await jsonOf(
      await PUT(
        new Request("http://127.0.0.1/api/finance/budgets/" + budget.id, {
          method: "PUT",
          body: JSON.stringify({ updatedAt: budget.updatedAt, notes: "second" }),
        }),
        { params: Promise.resolve({ id: budget.id }) }
      )
    );
    expect(firstSave.status).toBe(200);
    const stale = await jsonOf(
      await PUT(
        new Request("http://127.0.0.1/api/finance/budgets/" + budget.id, {
          method: "PUT",
          body: JSON.stringify({ updatedAt: budget.updatedAt, notes: "should not stick" }),
        }),
        { params: Promise.resolve({ id: budget.id }) }
      )
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatch(/Reload/);
    const again = await jsonOf(await oneGet(new Request("http://127.0.0.1/"), { params: Promise.resolve({ id: budget.id }) }));
    expect((again.body.budget as { notes: string }).notes).toBe("second");
    const recovered = await jsonOf(
      await PUT(
        new Request("http://127.0.0.1/api/finance/budgets/" + budget.id, {
          method: "PUT",
          body: JSON.stringify({ updatedAt: (again.body.budget as { updatedAt: string }).updatedAt, notes: "third" }),
        }),
        { params: Promise.resolve({ id: budget.id }) }
      )
    );
    expect(recovered.status).toBe(200);
    expect((recovered.body.budget as { notes: string }).notes).toBe("third");
  });

  it("does not add an audit row when the saved sheet matches what is stored", async () => {
    gate.client = leader;
    const created = await jsonOf(
      await POST(
        new Request("http://127.0.0.1/api/finance/budgets", {
          method: "POST",
          body: JSON.stringify({
            name: `No-op integration ${randomUUID().slice(0, 8)}`,
            ownerKind: "staff_ministry",
            ownerId: MINISTRY,
            periodId,
            notes: "still",
            lines: [{ kind: "fixed", name: "Van", amountCents: 100, multiplier: 1 }],
          }),
        })
      )
    );
    expect(created.status).toBe(201);
    const budget = created.body.budget as {
      id: string;
      updatedAt: string;
      notes: string;
      lines: { id: string; kind: string; name: string; amountCents: number; multiplier: number }[];
    };
    const before = await finance.from("finance_audit_log").select("id", { count: "exact", head: true }).eq("budget_id", budget.id);
    expect(before.error).toBeNull();
    const saved = await jsonOf(
      await PUT(
        new Request("http://127.0.0.1/api/finance/budgets/" + budget.id, {
          method: "PUT",
          body: JSON.stringify({
            updatedAt: budget.updatedAt,
            notes: budget.notes,
            lines: budget.lines.map((line) => ({
              id: line.id,
              kind: line.kind,
              name: line.name,
              amountCents: line.amountCents,
              multiplier: line.multiplier,
            })),
          }),
        }),
        { params: Promise.resolve({ id: budget.id }) }
      )
    );
    expect(saved.status).toBe(200);
    expect((saved.body.budget as { updatedAt: string }).updatedAt).toBe(budget.updatedAt);
    const after = await finance.from("finance_audit_log").select("id", { count: "exact", head: true }).eq("budget_id", budget.id);
    expect(after.count).toBe(before.count);
  });

  it("saves tracker rows on submitted and approved budgets and rolls a forbidden line edit back", async () => {
    gate.client = finance;
    const lineId = randomUUID();
    const created = await jsonOf(
      await POST(
        new Request("http://127.0.0.1/api/finance/budgets", {
          method: "POST",
          body: JSON.stringify({
            name: `Tracker integration ${randomUUID().slice(0, 8)}`,
            ownerKind: "program",
            ownerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
            periodId,
            lines: [{ id: lineId, kind: "fixed", name: "Van", amountCents: 100, multiplier: 1 }],
          }),
        })
      )
    );
    expect(created.status).toBe(201);
    const id = (created.body.budget as { id: string }).id;
    const member = await finance.from("budget_members").insert({ budget_id: id, user_id: EDITOR, role: "editor" }).select("id");
    expect(member.error).toBeNull();
    const submitted = await finance.from("budgets").update({ status: "submitted" }).eq("id", id).select("status").single();
    expect(submitted.error).toBeNull();
    expect(submitted.data?.status).toBe("submitted");

    gate.client = editor;
    const loaded = await jsonOf(await oneGet(new Request("http://127.0.0.1/"), { params: Promise.resolve({ id }) }));
    const token0 = (loaded.body.budget as { updatedAt: string }).updatedAt;
    const expenseOk = await jsonOf(
      await PUT(
        new Request("http://127.0.0.1/api/finance/budgets/" + id, {
          method: "PUT",
          body: JSON.stringify({
            updatedAt: token0,
            lines: [{ id: lineId, kind: "fixed", name: "Van", amountCents: 100, multiplier: 1 }],
            expenses: [{ date: "2027-04-01", description: "Fuel", amountCents: 500, lineId }],
          }),
        }),
        { params: Promise.resolve({ id }) }
      )
    );
    expect(expenseOk.status).toBe(200);
    const afterExpense = expenseOk.body.budget as { updatedAt: string; expenses: { id: string; description: string }[]; lines: { amountCents: number }[] };
    expect(afterExpense.expenses.map((row) => row.description)).toContain("Fuel");
    const rejected = await jsonOf(
      await PUT(
        new Request("http://127.0.0.1/api/finance/budgets/" + id, {
          method: "PUT",
          body: JSON.stringify({
            updatedAt: afterExpense.updatedAt,
            lines: [{ id: lineId, kind: "fixed", name: "Van", amountCents: 999, multiplier: 1 }],
            expenses: [
              ...afterExpense.expenses.map((row) => ({ id: row.id, date: "2027-04-01", description: "Fuel", amountCents: 500, lineId })),
              { date: "2027-04-02", description: "Should roll back", amountCents: 50 },
            ],
          }),
        }),
        { params: Promise.resolve({ id }) }
      )
    );
    expect(rejected.status).toBe(403);
    const checked = await jsonOf(await oneGet(new Request("http://127.0.0.1/"), { params: Promise.resolve({ id }) }));
    const mid = checked.body.budget as { updatedAt: string; lines: { amountCents: number }[]; expenses: { description: string }[] };
    expect(mid.lines[0].amountCents).toBe(100);
    expect(mid.expenses.map((row) => row.description)).not.toContain("Should roll back");
    const recovered = await jsonOf(
      await PUT(
        new Request("http://127.0.0.1/api/finance/budgets/" + id, {
          method: "PUT",
          body: JSON.stringify({
            updatedAt: mid.updatedAt,
            lines: [{ id: lineId, kind: "fixed", name: "Van", amountCents: 100, multiplier: 1 }],
            expenses: [
              ...mid.expenses.map((row) => ({ ...(row as { id: string }), date: "2027-04-01", description: "Fuel", amountCents: 500, lineId })),
              { date: "2027-04-03", description: "Bread", amountCents: 200 },
            ],
          }),
        }),
        { params: Promise.resolve({ id }) }
      )
    );
    expect(recovered.status).toBe(200);

    const approved = await approver.from("budgets").update({ status: "approved" }).eq("id", id);
    expect(approved.error).toBeNull();
    const approvedRow = await finance.from("budgets").select("status").eq("id", id).single();
    expect(approvedRow.data?.status).toBe("approved");
    gate.client = editor;
    const approvedLoad = await jsonOf(await oneGet(new Request("http://127.0.0.1/"), { params: Promise.resolve({ id }) }));
    const approvedBudget = approvedLoad.body.budget as {
      updatedAt: string;
      expenses: { id: string; description: string; amountCents: number }[];
    };
    const fuel = approvedBudget.expenses.find((row) => row.description === "Fuel");
    expect(fuel).toBeTruthy();
    const approvedSave = await jsonOf(
      await PUT(
        new Request("http://127.0.0.1/api/finance/budgets/" + id, {
          method: "PUT",
          body: JSON.stringify({
            updatedAt: approvedBudget.updatedAt,
            lines: [{ id: lineId, kind: "fixed", name: "Van", amountCents: 100, multiplier: 1 }],
            expenses: approvedBudget.expenses.map((row) => ({
              id: row.id,
              date: "2027-04-01",
              description: row.description,
              amountCents: row.description === "Fuel" ? 550 : row.amountCents,
              lineId: row.description === "Fuel" ? lineId : null,
            })),
          }),
        }),
        { params: Promise.resolve({ id }) }
      )
    );
    expect(approvedSave.status).toBe(200);
    const blocked = await jsonOf(
      await PUT(
        new Request("http://127.0.0.1/api/finance/budgets/" + id, {
          method: "PUT",
          body: JSON.stringify({
            updatedAt: (approvedSave.body.budget as { updatedAt: string }).updatedAt,
            lines: [{ id: lineId, kind: "fixed", name: "Van", amountCents: 5, multiplier: 1 }],
            expenses: (approvedSave.body.budget as { expenses: { id: string; description: string; amountCents: number }[] }).expenses.map((row) => ({
              id: row.id,
              date: "2027-04-01",
              description: row.description,
              amountCents: row.amountCents,
              lineId: row.description === "Fuel" ? lineId : null,
            })),
          }),
        }),
        { params: Promise.resolve({ id }) }
      )
    );
    expect(blocked.status).toBe(403);
    const finalLoad = await jsonOf(await oneGet(new Request("http://127.0.0.1/"), { params: Promise.resolve({ id }) }));
    expect((finalLoad.body.budget as { lines: { amountCents: number }[] }).lines[0].amountCents).toBe(100);
  });
});
