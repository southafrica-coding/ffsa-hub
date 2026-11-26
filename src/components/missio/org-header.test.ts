import { describe, expect, it } from "vitest";
import {
  BACK_TO_FFSA_HUB,
  FFSA_ORG_NAME,
  FFSA_STAFF_ROLES,
  isFfsaStaffRole,
  missioOrgHeader,
  needsPlatformRoleLookup,
} from "./org-header";

/** Shape GET /api/missio/me returns for a pastor with no FFSA org_staff_roles row. */
const prodMissioOnly = [
  { id: "org-missio", slug: "missio", name: "Missio" },
];

describe("missio org header", () => {
  it("offers FFSA Hub and Missio when platform roles are super_admin and staff", () => {
    const header = missioOrgHeader({
      orgs: prodMissioOnly,
      ffsaRoleNames: ["staff", "super_admin"],
    });
    expect(header.kind).toBe("switcher");
    if (header.kind !== "switcher") return;
    expect(header.orgs.map((org) => org.slug)).toEqual(["ffsa", "missio"]);
    expect(header.orgs[0]).toMatchObject({ name: FFSA_ORG_NAME, href: "/dashboard" });
    expect(header.orgs[1]).toMatchObject({ name: "Missio", href: "/missio" });
    expect(header.orgs.some((org) => org.name === "Missio Church")).toBe(false);
  });

  it("treats either super_admin or staff on its own as FFSA access", () => {
    for (const role of ["super_admin", "staff"]) {
      const header = missioOrgHeader({ orgs: prodMissioOnly, ffsaRoleNames: [role] });
      expect(header.kind).toBe("switcher");
    }
  });

  it("treats leaders and other seeded staff roles as FFSA access", () => {
    for (const role of ["admin", "program_leader", "school_leader", "finance_office"]) {
      expect(isFfsaStaffRole(role)).toBe(true);
      expect(missioOrgHeader({ orgs: prodMissioOnly, ffsaRoleNames: [role] }).kind).toBe("switcher");
    }
    expect(FFSA_STAFF_ROLES.has("student")).toBe(false);
  });

  it("gives a student, community member, or self-service user no FFSA option", () => {
    for (const role of ["student", "community_member", "self_service"]) {
      expect(isFfsaStaffRole(role)).toBe(false);
      const header = missioOrgHeader({ orgs: prodMissioOnly, ffsaRoleNames: [role] });
      expect(header).toEqual({ kind: "static", name: "Missio" });
    }
    const mixed = missioOrgHeader({
      orgs: prodMissioOnly,
      ffsaRoleNames: ["student", "staff"],
    });
    expect(mixed.kind).toBe("switcher");
  });

  it("leaves a Missio-only pastor on a static label", () => {
    const header = missioOrgHeader({ orgs: prodMissioOnly, ffsaRoleNames: [] });
    expect(header).toEqual({ kind: "static", name: "Missio" });
  });

  it("does not invent FFSA from an org role that is not a platform role", () => {
    const header = missioOrgHeader({
      orgs: prodMissioOnly,
      ffsaRoleNames: [],
    });
    expect(header.kind).toBe("static");
  });

  it("keeps the switcher when the org list already has both organisations", () => {
    const header = missioOrgHeader({
      orgs: [
        { id: "org-ffsa", slug: "ffsa", name: "Fire & Fragrance SA" },
        { id: "org-missio", slug: "missio", name: "Missio Church" },
      ],
      ffsaRoleNames: null,
    });
    expect(header.kind).toBe("switcher");
    if (header.kind !== "switcher") return;
    expect(header.orgs.map((org) => org.name)).toEqual(["Fire & Fragrance SA", "Missio Church"]);
  });

  it("asks for a Back to FFSA Hub link when the org list is empty, missing, or the role read failed", () => {
    expect(missioOrgHeader({ orgs: [], ffsaRoleNames: ["super_admin"] })).toEqual({ kind: "back" });
    expect(missioOrgHeader({ orgs: null, ffsaRoleNames: null })).toEqual({ kind: "back" });
    expect(missioOrgHeader({ orgs: prodMissioOnly, ffsaRoleNames: null })).toEqual({ kind: "back" });
    expect(BACK_TO_FFSA_HUB).toBe("Back to FFSA Hub");
  });

  it("does not add FFSA from platform roles when Missio access is refused", () => {
    const header = missioOrgHeader({
      orgs: prodMissioOnly,
      ffsaRoleNames: ["super_admin", "staff"],
      allowPlatformFfsa: false,
    });
    expect(header).toEqual({ kind: "static", name: "Missio" });
  });

  it("looks up platform roles only when Missio is listed without FFSA", () => {
    expect(needsPlatformRoleLookup(prodMissioOnly)).toBe(true);
    expect(needsPlatformRoleLookup([])).toBe(false);
    expect(needsPlatformRoleLookup(null)).toBe(false);
    expect(
      needsPlatformRoleLookup([
        { slug: "ffsa" },
        { slug: "missio" },
      ]),
    ).toBe(false);
  });
});
