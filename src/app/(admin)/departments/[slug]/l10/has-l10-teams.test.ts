import { describe, expect, it } from "vitest";
import { departmentHasL10Teams } from "./has-l10-teams";

function client(opts: { ministryId: string | null; count: number | null; error?: boolean }) {
  const calls: string[] = [];
  const chain = (table: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: opts.ministryId ? { id: opts.ministryId } : null, error: null }),
      then: (resolve: (value: unknown) => void) =>
        resolve({ count: opts.count, error: opts.error ? { message: "nope" } : null }),
    };
    calls.push(table);
    return q;
  };
  return { from: chain, calls };
}

describe("departmentHasL10Teams", () => {
  it("is true when the department has an active team", async () => {
    const c = client({ ministryId: "dept-1", count: 2 });
    expect(await departmentHasL10Teams(c, "ops")).toBe(true);
    expect(c.calls).toEqual(["staff_ministries", "l10_teams"]);
  });

  it("is false with no teams, no department, a read error, or no client", async () => {
    expect(await departmentHasL10Teams(client({ ministryId: "dept-1", count: 0 }), "ops")).toBe(false);
    expect(await departmentHasL10Teams(client({ ministryId: null, count: 3 }), "ops")).toBe(false);
    expect(await departmentHasL10Teams(client({ ministryId: "dept-1", count: 3, error: true }), "ops")).toBe(false);
    expect(await departmentHasL10Teams({ kind: "session" }, "ops")).toBe(false);
  });
});
