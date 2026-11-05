import { describe, expect, it } from "vitest";
import {
  isFinanceProjectType,
  linkProblem,
  parseFinanceProjectType,
  recordCurrencyForOrg,
  resolveFinanceOrgId,
} from "@/lib/finance/orgs";

describe("resolveFinanceOrgId", () => {
  it("the payment's override beats the event's org", () => {
    expect(resolveFinanceOrgId({ paymentOrgId: "usa-id", eventOrgId: "npc-id" })).toBe("usa-id");
  });

  it("falls back to the event's org", () => {
    expect(resolveFinanceOrgId({ paymentOrgId: null, eventOrgId: "npc-id" })).toBe("npc-id");
    expect(resolveFinanceOrgId({ eventOrgId: "npc-id" })).toBe("npc-id");
  });

  it("is null when nothing was chosen", () => {
    expect(resolveFinanceOrgId({ paymentOrgId: null, eventOrgId: null })).toBeNull();
    expect(resolveFinanceOrgId({})).toBeNull();
  });

  it("never derives the org from currency", () => {
    // Extra fields (like a currency) are ignored: rand can go to either org.
    const input = { paymentOrgId: null, eventOrgId: null, currency: "ZAR" } as Parameters<
      typeof resolveFinanceOrgId
    >[0];
    expect(resolveFinanceOrgId(input)).toBeNull();
    expect(resolveFinanceOrgId({ ...input, currency: "USD" } as typeof input)).toBeNull();
  });
});

describe("recordCurrencyForOrg", () => {
  it("FF USA Inc records in USD, FFSA NPC in ZAR", () => {
    expect(recordCurrencyForOrg("usa")).toBe("USD");
    expect(recordCurrencyForOrg("npc")).toBe("ZAR");
    expect(recordCurrencyForOrg({ key: "usa" })).toBe("USD");
    expect(recordCurrencyForOrg({ key: "npc" })).toBe("ZAR");
  });
});

describe("project type", () => {
  it("accepts the three types", () => {
    for (const t of ["ministry", "event", "asset"]) {
      expect(isFinanceProjectType(t)).toBe(true);
      expect(parseFinanceProjectType(t)).toEqual({ ok: true, value: t });
    }
  });

  it("reads null or empty as 'not set'", () => {
    expect(parseFinanceProjectType(null)).toEqual({ ok: true, value: null });
    expect(parseFinanceProjectType("")).toEqual({ ok: true, value: null });
  });

  it("rejects anything else", () => {
    for (const v of ["Ministry", "building", "vehicle", 1, undefined, {}]) {
      expect(isFinanceProjectType(v)).toBe(false);
      expect(parseFinanceProjectType(v)).toEqual({ ok: false });
    }
  });
});

describe("linkProblem", () => {
  const npc = { id: "p1", org_id: "npc" };
  it("allows a project in the other org", () => {
    expect(linkProblem(npc, { id: "p2", org_id: "usa" })).toBeNull();
  });
  it("refuses itself, the same org, or a missing project", () => {
    expect(linkProblem(npc, npc)).toMatch(/itself/);
    expect(linkProblem(npc, { id: "p3", org_id: "npc" })).toMatch(/other organisation/);
    expect(linkProblem(npc, null)).toMatch(/not found/);
  });
});
