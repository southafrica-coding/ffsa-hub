import { describe, expect, it } from "vitest";
import { periodsForNpc, southAfricaBudgetOrg } from "./budget-scope";

const npc = { id: "npc-id", key: "npc", record_currency: "ZAR", name: "FFSA NPC", is_active: true };
const usa = { id: "usa-id", key: "usa", record_currency: "USD", name: "FF USA Inc", is_active: true };

describe("southAfricaBudgetOrg", () => {
  it("keeps active FFSA NPC in rand and ignores the US org", () => {
    expect(southAfricaBudgetOrg([usa, npc])?.id).toBe("npc-id");
  });

  it("does not fall back to a US org, another ZA key, or an inactive NPC", () => {
    expect(southAfricaBudgetOrg([usa])).toBeNull();
    expect(southAfricaBudgetOrg([])).toBeNull();
    expect(southAfricaBudgetOrg([{ id: "za-2", key: "other", region: "za", record_currency: "ZAR", is_active: true }])).toBeNull();
    expect(southAfricaBudgetOrg([{ ...npc, is_active: false }])).toBeNull();
    expect(southAfricaBudgetOrg([{ ...npc, record_currency: "USD" }])).toBeNull();
  });
});

describe("periodsForNpc", () => {
  it("keeps periods for FFSA NPC and drops a US period instead of rewriting it", () => {
    const rows = [
      { id: "sa", org_id: "npc-id", label: "2027" },
      { id: "us", org_id: "usa-id", label: "2027" },
    ];
    expect(periodsForNpc(rows, "npc-id").map((row) => row.id)).toEqual(["sa"]);
    expect(periodsForNpc(rows, null)).toEqual([]);
  });
});
