import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { feedbackThisWeek } from "./feedback-this-week";

// Which houses haven't sent: the same week as /missio-feedback
// (feedbackSunday + weekOf), and only id, number and name leave.

const NOW = new Date("2026-11-25T10:00:00Z"); // Wednesday; the week ends Sunday 22 Nov.

type Call = { table: string; ops: Array<[string, unknown[]]> };

function fakeDb(houses: unknown[], rows: unknown[], fail: "houses" | "rows" | null = null) {
  const calls: Call[] = [];
  return {
    calls,
    db: {
      from(table: string) {
        const call: Call = { table, ops: [] };
        calls.push(call);
        const b: Record<string, unknown> = {};
        for (const op of ["select", "eq", "in", "gte", "lte", "order"]) {
          b[op] = (...args: unknown[]) => {
            call.ops.push([op, args]);
            return b;
          };
        }
        b.then = (resolve: (v: unknown) => unknown) => {
          const failed = (fail === "houses" && table === "house_churches") || (fail === "rows" && table === "missio_house_feedback");
          return Promise.resolve(
            failed ? { data: null, error: { message: "x" } } : { data: table === "house_churches" ? houses : rows, error: null }
          ).then(resolve);
        };
        return b;
      },
    },
  };
}

const HOUSES = [
  { id: "h1", number: 1, name: "Oak" },
  { id: "h2", number: 2, name: "  " },
  { id: "h3", number: 3, name: null },
];

describe("feedbackThisWeek", () => {
  it("lists the houses with no row in the week, number order, and reads only what it needs", async () => {
    const { db, calls } = fakeDb(HOUSES, [
      { house_church_id: "h1", meeting_date: "2026-11-19" }, // mid-week, inside Mon 16 – Sun 22
      { house_church_id: "h3", meeting_date: "2026-11-15" }, // the week before: doesn't count
    ]);
    const res = await feedbackThisWeek(db, "org", { mode: "all" }, NOW);
    expect(res).toEqual({
      ok: true,
      data: {
        sunday: "2026-11-22",
        total: 3,
        sentCount: 1,
        missing: [
          { id: "h2", number: 2, name: null },
          { id: "h3", number: 3, name: null },
        ],
      },
    });
    const rowsCall = calls.find((c) => c.table === "missio_house_feedback") as Call;
    expect(rowsCall.ops).toContainEqual(["select", ["house_church_id, meeting_date"]]);
    expect(rowsCall.ops).toContainEqual(["gte", ["meeting_date", "2026-11-16"]]);
    expect(rowsCall.ops).toContainEqual(["lte", ["meeting_date", "2026-11-22"]]);
  });

  it("narrows to a coach's houses", async () => {
    const { db, calls } = fakeDb([HOUSES[0]], []);
    const res = await feedbackThisWeek(db, "org", { mode: "houses", ids: ["h1"] }, NOW);
    expect(res.ok && res.data.missing.map((h) => h.number)).toEqual([1]);
    expect(calls[0].ops).toContainEqual(["in", ["id", ["h1"]]]);
  });

  it("fails rather than calling every house missing when a read fails", async () => {
    expect((await feedbackThisWeek(fakeDb(HOUSES, [], "houses").db, "org", { mode: "all" }, NOW)).ok).toBe(false);
    expect((await feedbackThisWeek(fakeDb(HOUSES, [], "rows").db, "org", { mode: "all" }, NOW)).ok).toBe(false);
  });
});
