import { describe, expect, it } from "vitest";
import { houseInScope, resolveHouseScope, restrictHouseQuery, toPersonRef } from "@/lib/missio/house-churches";

describe("resolveHouseScope", () => {
  it("gives pastors every house and does not grant a house church leader", () => {
    expect(resolveHouseScope({ roles: ["pastor"] })).toEqual({ mode: "all" });
    expect(resolveHouseScope({ roles: ["house_church_leader", "pastor"] })).toEqual({ mode: "all" });
    expect(resolveHouseScope({ roles: ["house_church_leader"] })).toBeNull();
    expect(resolveHouseScope({ roles: ["admin"] })).toBeNull();
    expect(resolveHouseScope({ roles: [] })).toBeNull();
  });

  it("leaves an all-scope query unfiltered and narrows a named-house scope", () => {
    const calls: unknown[][] = [];
    const query = {
      in(...args: unknown[]) {
        calls.push(args);
        return query;
      },
    };
    expect(restrictHouseQuery(query, { mode: "all" })).toBe(query);
    expect(calls).toEqual([]);
    expect(restrictHouseQuery(query, { mode: "houses", ids: [] })).toBeNull();
    restrictHouseQuery(query, { mode: "houses", ids: ["house-1", "house-2"] });
    expect(calls).toEqual([["id", ["house-1", "house-2"]]]);
    expect(houseInScope({ mode: "all" }, "anywhere")).toBe(true);
    expect(houseInScope({ mode: "houses", ids: ["house-1"] }, "house-1")).toBe(true);
    expect(houseInScope({ mode: "houses", ids: ["house-1"] }, "house-2")).toBe(false);
  });
});

describe("toPersonRef", () => {
  it("uses the preferred name when there is one and includes orgPersonId only then", () => {
    expect(
      toPersonRef(
        { id: "c1", first_name: "Ada", last_name: "Lovelace", preferred_name: "Addie" },
        "person-1"
      )
    ).toEqual({
      contactId: "c1",
      displayName: "Addie Lovelace",
      firstName: "Ada",
      lastName: "Lovelace",
      orgPersonId: "person-1",
    });
    expect(toPersonRef({ id: "c2", first_name: "Grace", last_name: "Hopper", preferred_name: "  " })).toEqual({
      contactId: "c2",
      displayName: "Grace Hopper",
      firstName: "Grace",
      lastName: "Hopper",
    });
  });
});
