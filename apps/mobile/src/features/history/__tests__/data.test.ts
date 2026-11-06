jest.mock("@/lib/supabase", () => ({ supabase: {} }));

// eslint-disable-next-line import/first
import { DataError, loadErrorMessage, loadHistory } from "../data";
// eslint-disable-next-line import/first
import { strings } from "../strings";

type Result = { data: unknown; error: { message: string; code?: string } | null };

/** A tiny PostgREST stand-in: records the chain, answers per table. */
function fakeDb(answers: Record<string, Result>) {
  const log: { table: string; calls: [string, ...unknown[]][] }[] = [];
  return {
    calls: (table: string) => log.filter((l) => l.table === table).flatMap((l) => l.calls),
    client: {
      from(table: string) {
        const entry = { table, calls: [] as [string, ...unknown[]][] };
        log.push(entry);
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "order"]) {
          chain[m] = (...args: unknown[]) => {
            entry.calls.push([m, ...args]);
            return chain;
          };
        }
        chain.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(answers[table] ?? { data: [], error: null }).then(resolve, reject);
        return chain;
      },
    } as never,
  };
}

const TABLES = ["library_applications", "library_payments", "library_enrollments", "library_documents"];
const selectOf = (calls: [string, ...unknown[]][]) => String(calls.find((c) => c[0] === "select")?.[1]);

describe("loadHistory", () => {
  it("reads the four tables for the caller only, newest first, undated last", async () => {
    const db = fakeDb({});
    await loadHistory("u1", db.client);
    const orders: Record<string, string> = {
      library_applications: "submitted_at",
      library_payments: "paid_at",
      library_enrollments: "start_date",
      library_documents: "expires_at",
    };
    for (const t of TABLES) {
      expect(db.calls(t)).toContainEqual(["eq", "user_id", "u1"]);
      expect(db.calls(t)).toContainEqual(["order", orders[t], { ascending: false, nullsFirst: false }]);
    }
  });

  it("lists columns: import bookkeeping never reaches the phone", async () => {
    const db = fakeDb({});
    await loadHistory("u1", db.client);
    for (const t of TABLES) {
      const sel = selectOf(db.calls(t));
      expect(sel).not.toContain("*");
      expect(sel).not.toMatch(/person_id|import_id|content_hash|user_id/);
      expect(sel).toContain("raw_data");
    }
  });

  it("parses rows; numeric amounts as text become numbers; odd rows are skipped, not fatal", async () => {
    const db = fakeDb({
      library_applications: { data: [{ id: "a1", program_name: "DTS", cohort: null, status: "accepted", submitted_at: null, raw_data: { x: 1 } }, { id: 7 }], error: null },
      library_payments: { data: [{ id: "p1", amount: "1500.00", currency: "ZAR", description: null, paid_at: "2019-04-02", raw_data: null }], error: null },
      library_enrollments: { data: null, error: null },
      library_documents: { data: [{ id: "d1", doc_type: "Passport", file_url: null, identifier: null, expires_at: null, raw_data: ["not", "an", "object"] }], error: null },
    });
    const out = await loadHistory("u1", db.client);
    expect(out.applications).toHaveLength(1);
    expect(out.applications[0].raw_data).toEqual({ x: 1 });
    expect(out.payments[0].amount).toBe(1500);
    expect(out.payments[0].raw_data).toEqual({});
    expect(out.enrollments).toEqual([]);
    expect(out.documents[0].raw_data).toEqual({});
  });

  it("any failed read is an error (never a half-empty history)", async () => {
    const db = fakeDb({ library_documents: { data: null, error: { message: "TypeError: Network request failed" } } });
    await expect(loadHistory("u1", db.client)).rejects.toThrow(strings.common.network);
  });

  it("a refused read says it isn't available on this account", async () => {
    const db = fakeDb({ library_payments: { data: null, error: { message: "permission denied", code: "42501" } } });
    await expect(loadHistory("u1", db.client)).rejects.toThrow(strings.common.forbidden);
  });

  it("anything else is the plain message", async () => {
    const db = fakeDb({ library_applications: { data: null, error: { message: "boom" } } });
    await expect(loadHistory("u1", db.client)).rejects.toThrow(strings.common.generic);
    expect(loadErrorMessage(new DataError("x"))).toBe("x");
    expect(loadErrorMessage(new Error("internal detail"))).toBe(strings.common.generic);
  });
});
