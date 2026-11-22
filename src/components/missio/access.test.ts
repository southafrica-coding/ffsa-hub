import { describe, expect, it } from "vitest";
import {
  CAMPUS_LABEL,
  canAccessMissio,
  canSeeMissioCare,
  isMissioPastor,
  classifyContactQuery,
  clampPeopleLimit,
  formatJoined,
  orgHref,
  peopleSearchParams,
  shouldShowOrgSwitcher,
  skinForOrg,
  validateNewPerson,
} from "./access";
import { MISSIO_HOUSE_ROLES } from "@/lib/missio/house-roles";
import type { MissioMe } from "./types-shim";

function me(partial: Partial<MissioMe> & Pick<MissioMe, "currentOrg" | "rolesByOrg">): MissioMe {
  return {
    orgs: partial.orgs ?? [
      { id: "org-ffsa", slug: "ffsa", name: "Fire & Fragrance SA" },
      { id: "org-missio", slug: "missio", name: "Missio Church" },
    ],
    rolesByOrg: partial.rolesByOrg,
    currentOrg: partial.currentOrg,
  };
}

describe("org switcher visibility and skin", () => {
  it("hides the switcher for one org and shows it for two", () => {
    expect(shouldShowOrgSwitcher(0)).toBe(false);
    expect(shouldShowOrgSwitcher(1)).toBe(false);
    expect(shouldShowOrgSwitcher(2)).toBe(true);
  });

  it("re-skins only when the current org is Missio", () => {
    expect(skinForOrg("ffsa")).toBe("ffsa");
    expect(skinForOrg("missio")).toBe("missio");
    expect(skinForOrg("other")).toBe("ffsa");
    expect(orgHref("missio")).toBe("/missio");
    expect(orgHref("ffsa")).toBe("/dashboard");
  });
});

describe("Missio pastor gate", () => {
  it("refuses an FFSA admin with no Missio role", () => {
    expect(
      canAccessMissio(
        me({
          orgs: [{ id: "org-ffsa", slug: "ffsa", name: "Fire & Fragrance SA" }],
          rolesByOrg: { ffsa: ["admin"] },
          currentOrg: null,
        })
      )
    ).toBe(false);
  });

  it("refuses a Missio admin, team leader and finance, and lets coaches and leaders in (not as pastors)", () => {
    // Any Missio role sets currentOrg to missio. Coaches and leaders see their own houses (M10c).
    for (const role of ["admin", "team_leader", "finance"] as const) {
      expect(
        canAccessMissio(
          me({
            orgs: [{ id: "org-missio", slug: "missio", name: "Missio" }],
            rolesByOrg: { missio: [role] },
            currentOrg: "missio",
          })
        )
      ).toBe(false);
    }
    for (const role of ["coach", "house_church_leader"] as const) {
      const viewer = me({
        orgs: [{ id: "org-missio", slug: "missio", name: "Missio" }],
        rolesByOrg: { missio: [role] },
        currentOrg: "missio",
      });
      expect(canAccessMissio(viewer)).toBe(true);
      expect(isMissioPastor(viewer)).toBe(false);
    }
  });

  it("allows a pastor, including one who is also an FFSA admin", () => {
    expect(
      canAccessMissio(
        me({
          rolesByOrg: { missio: ["pastor"], ffsa: ["admin"] },
          currentOrg: "missio",
        })
      )
    ).toBe(true);
  });

  it("refuses when currentOrg is null even if a pastor role is listed", () => {
    expect(
      canAccessMissio(
        me({
          rolesByOrg: { missio: ["pastor"] },
          currentOrg: null,
        })
      )
    ).toBe(false);
  });
});

describe("people query and contact search rules", () => {
  it("builds the people query and clamps the page size", () => {
    const params = peopleSearchParams({
      campus: "jhb",
      status: "active",
      q: " Mina ",
      limit: 500,
      offset: 50,
    });
    expect(params.get("campus")).toBe("jhb");
    expect(params.get("status")).toBe("active");
    expect(params.get("q")).toBe("Mina");
    expect(params.get("limit")).toBe("200");
    expect(params.get("offset")).toBe("50");
    expect(clampPeopleLimit(undefined)).toBe(50);
  });

  it("omits empty people filters", () => {
    const params = peopleSearchParams({ campus: "", status: "", q: "  " });
    expect(params.has("campus")).toBe(false);
    expect(params.has("status")).toBe(false);
    expect(params.has("q")).toBe(false);
    expect(params.get("limit")).toBe("50");
  });

  it("rejects a name and accepts an email or a phone", () => {
    expect(classifyContactQuery("  ")).toBe("empty");
    expect(classifyContactQuery("Mina Osei")).toBe("name");
    expect(classifyContactQuery("mina.osei@example.com")).toBe("email");
    expect(classifyContactQuery("+27 82 555 0199")).toBe("phone");
    expect(classifyContactQuery("0825550199")).toBe("phone");
  });

  it("requires a name and at least one of email or phone for a new person", () => {
    expect(validateNewPerson({ name: "", email: "", phone: "" })).toMatch(/name/i);
    expect(validateNewPerson({ name: "Mina Osei", email: "", phone: "" })).toMatch(/email|phone/i);
    expect(validateNewPerson({ name: "Mina Osei", email: "not-an-email", phone: "" })).toMatch(/email/i);
    expect(validateNewPerson({ name: "Mina Osei", email: "mina.osei@example.com", phone: "" })).toBeNull();
  });
});

describe("display", () => {
  it("labels campuses and renders a missing joined date as an em dash", () => {
    expect(CAMPUS_LABEL.potch).toBe("Missio Potch");
    expect(CAMPUS_LABEL.jhb).toBe("Missio JHB");
    expect(formatJoined(null)).toBe("—");
    expect(formatJoined("2024-03-12")).toBe("12 Mar 2024");
  });
});

describe("Care visibility", () => {
  it("matches MISSIO_HOUSE_ROLES, the GET /api/missio/care gate", () => {
    for (const role of MISSIO_HOUSE_ROLES) {
      expect(canSeeMissioCare(me({ rolesByOrg: { missio: [role] }, currentOrg: "missio" }))).toBe(true);
    }
    for (const role of ["admin", "team_leader", "finance"] as const) {
      expect(canSeeMissioCare(me({ rolesByOrg: { missio: [role] }, currentOrg: "missio" }))).toBe(false);
    }
  });

  it("refuses when currentOrg is null or only an FFSA role is held", () => {
    expect(canSeeMissioCare(me({ rolesByOrg: { missio: ["pastor"] }, currentOrg: null }))).toBe(false);
    expect(canSeeMissioCare(me({ rolesByOrg: { ffsa: ["admin"] }, currentOrg: null }))).toBe(false);
  });
});
