import { describe, expect, it } from "vitest";

import { summariseByOwner, toOwners, totals, ownerIdOf } from "./summary";
import type { OkrObjective } from "@/types/okrs";

function objective(over: Partial<OkrObjective> = {}): OkrObjective {
  return {
    id: "o1",
    cycle_id: "c1",
    scope: "ministry",
    staff_ministry_id: null,
    okr_team_id: null,
    subcategory_id: null,
    owner_user_id: null,
    position: 1,
    title: "An objective",
    description: null,
    owner_note: null,
    timeline: null,
    is_archived: false,
    okr_key_results: [],
    ...over,
  } as OkrObjective;
}

function kr(status: OkrObjective["okr_key_results"][number]["current_status"]) {
  return { id: "k" + status, current_status: status } as never;
}

describe("ownerIdOf", () => {
  it("reads whichever owner column is set", () => {
    expect(ownerIdOf(objective({ staff_ministry_id: "m1" }))).toBe("m1");
    expect(ownerIdOf(objective({ okr_team_id: "t1" }))).toBe("t1");
    expect(ownerIdOf(objective())).toBeNull();
  });
});

describe("summariseByOwner", () => {
  const owners = toOwners(
    [{ id: "m1", name: "Operations", slug: "operations" }],
    [{ id: "t1", name: "Brave Love", slug: "brave_love" }]
  );

  it("keeps groups that have nothing written yet", () => {
    // The whole point of the wall doubling as a to-do list: a ministry with no
    // objectives must still come back, so it can be rendered as "not started".
    const rows = summariseByOwner([], owners);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.objectives === 0)).toBe(true);
  });

  it("sorts started groups ahead of empty ones, then alphabetically", () => {
    // Brave Love sorts before Operations alphabetically, so if Operations
    // leads it can only be because it has objectives.
    const rows = summariseByOwner([objective({ staff_ministry_id: "m1" })], owners);
    expect(rows.map((r) => r.name)).toEqual(["Operations", "Brave Love"]);
  });

  it("sorts alphabetically within the started and empty blocks", () => {
    const rows = summariseByOwner(
      [
        objective({ id: "o1", staff_ministry_id: "m1" }),
        objective({ id: "o2", okr_team_id: "t1" }),
      ],
      owners
    );
    expect(rows.map((r) => r.name)).toEqual(["Brave Love", "Operations"]);
  });

  it("skips an objective whose owner is not in the list", () => {
    // A ministry retired after its OKRs were written: the row still exists in
    // the database but the caller did not pass it as an owner.
    const rows = summariseByOwner([objective({ staff_ministry_id: "gone" })], owners);
    expect(rows.every((r) => r.objectives === 0)).toBe(true);
  });

  it("counts key results by status against the owning group", () => {
    const rows = summariseByOwner(
      [
        objective({
          staff_ministry_id: "m1",
          okr_key_results: [kr("complete"), kr("stuck"), kr("stuck")],
        }),
      ],
      owners
    );
    const ops = rows.find((r) => r.id === "m1")!;
    expect(ops.keyResults).toBe(3);
    expect(ops.byStatus.stuck).toBe(2);
    expect(ops.byStatus.complete).toBe(1);
    expect(ops.byStatus.not_started).toBe(0);
  });

  it("tags each owner with its kind so the wall can route correctly", () => {
    const rows = summariseByOwner([], owners);
    expect(rows.find((r) => r.id === "m1")!.kind).toBe("ministry");
    expect(rows.find((r) => r.id === "t1")!.kind).toBe("team");
  });
});

describe("totals", () => {
  it("counts every objective and key result regardless of owner", () => {
    // totals() reduces the raw rows, so it deliberately still counts an
    // objective whose owner was filtered out of the card list.
    const t = totals([
      objective({ id: "o1", staff_ministry_id: "m1", okr_key_results: [kr("complete")] }),
      objective({ id: "o2", staff_ministry_id: "gone", okr_key_results: [kr("stuck")] }),
    ]);
    expect(t.objectives).toBe(2);
    expect(t.keyResults).toBe(2);
    expect(t.byStatus.complete).toBe(1);
    expect(t.byStatus.stuck).toBe(1);
  });
});
