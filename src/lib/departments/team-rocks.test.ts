import { describe, expect, it } from "vitest";
import { listRocks, listRocksForQuarter, updateRock } from "./internal/repository";
import { DEPT_ROCK, PW_ID, ROCK, makeWorld } from "@/lib/l10/testing/world";

// 416 puts L10 team rocks in public.rocks with team_id set. The department
// Rocks tab and the roll-up read with the service role, so these queries
// must keep team rocks out themselves.
describe("department rock reads skip L10 team rocks", () => {
  it("lists only rocks with no team", async () => {
    const db = makeWorld();
    const admin = db.client();
    const one = await listRocks(admin, PW_ID, "2026-Q4");
    expect(one.data?.map((r) => r.id)).toEqual([DEPT_ROCK]);
    const all = await listRocksForQuarter(admin, "2026-Q4");
    expect(all.data?.map((r) => r.id)).toEqual([DEPT_ROCK]);
  });

  it("does not let the department rock route edit a team rock", async () => {
    const db = makeWorld();
    const admin = db.client();
    const team = await updateRock(admin, PW_ID, ROCK, { title: "Changed" });
    expect(team.data).toBeNull();
    expect(db.tables.rocks.find((r) => r.id === ROCK)?.title).toBe("New stage plot");
    const dept = await updateRock(admin, PW_ID, DEPT_ROCK, { title: "Changed" });
    expect(dept.data).toMatchObject({ id: DEPT_ROCK, title: "Changed" });
  });
});
