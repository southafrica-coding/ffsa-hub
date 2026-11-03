import { beforeEach, describe, expect, it, vi } from "vitest";

// Outreach receipts POST registers a file the caller already uploaded to the
// private bucket. The phone app retries with the SAME file path after a
// dropped connection, so a path that is already registered for that expense
// returns the existing row instead of a duplicate. The website builds a new
// path for every upload, so it never sees the difference.

const state = vi.hoisted(() => {
  const state = {
    callerId: "pat" as string | null,
    rows: [] as Record<string, unknown>[],
    insertError: null as { code?: string; message: string } | null,
    client() {
      const caller = state.callerId;
      return {
        auth: { getUser: async () => ({ data: { user: caller ? { id: caller } : null } }) },
        from() {
          const filters: Record<string, unknown> = {};
          let pending: Record<string, unknown> | null = null;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const q: any = {
            insert: (payload: Record<string, unknown>) => {
              pending = payload;
              return q;
            },
            select: () => q,
            eq: (col: string, v: unknown) => {
              filters[col] = v;
              return q;
            },
            limit: () => q,
            maybeSingle: async () => ({
              data:
                state.rows.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v)) ?? null,
              error: null,
            }),
            single: async () => {
              if (state.insertError) return { data: null, error: state.insertError };
              const row = { id: `r${state.rows.length + 1}`, ...pending };
              state.rows.push(row);
              return { data: row, error: null };
            },
          };
          return q;
        },
      };
    },
  };
  return state;
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const { POST } = await import("./route");

const body = {
  expense_id: "e1",
  file_path: "t1/e1/1762160000000_receipt.jpg",
  file_name: "receipt.jpg",
  file_size: 1234,
  mime_type: "image/jpeg",
};
const post = (b: unknown) =>
  POST(new Request("http://localhost/api/finance/outreach/receipts", { method: "POST", body: JSON.stringify(b) }));

beforeEach(() => {
  state.callerId = "pat";
  state.rows = [];
  state.insertError = null;
});

describe("POST /api/finance/outreach/receipts", () => {
  it("registers a receipt as its uploader", async () => {
    const res = await post({ ...body, uploaded_by: "someone-else" });
    expect(res.status).toBe(200);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].uploaded_by).toBe("pat");
  });

  it("refuses someone signed out", async () => {
    state.callerId = null;
    expect((await post(body)).status).toBe(401);
    expect(state.rows).toEqual([]);
  });

  it("still needs expense, path and name", async () => {
    expect((await post({ expense_id: "e1" })).status).toBe(400);
  });

  it("returns the existing row when the same file is registered again", async () => {
    await post(body);
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, replayed: true, data: { id: "r1" } });
    expect(state.rows).toHaveLength(1);
  });

  it("registers a different file on the same expense as a new receipt", async () => {
    await post(body);
    await post({ ...body, file_path: "t1/e1/1762160000999_second.jpg" });
    expect(state.rows).toHaveLength(2);
  });

  it("turns a row-level-security refusal into a 403", async () => {
    state.insertError = { code: "42501", message: "new row violates row-level security policy" };
    expect((await post(body)).status).toBe(403);
  });

  it("keeps other database errors as a 500", async () => {
    state.insertError = { message: "boom" };
    expect((await post(body)).status).toBe(500);
  });
});
