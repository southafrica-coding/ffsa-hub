import { describe, expect, it } from "vitest";
import {
  currentMembership,
  elevatedRoleCount,
  holdsSuperAdmin,
} from "./users-table";

type Row = Parameters<typeof currentMembership>[0];

/** A list row whose role embed never arrived — the audit fixture's crash. */
function row(user_roles: unknown): Row {
  return { user_roles } as unknown as Row;
}

describe("users table role helpers", () => {
  it("treats a missing or null user_roles embed as no roles", () => {
    for (const user_roles of [undefined, null]) {
      const user = row(user_roles);
      expect(currentMembership(user)).toBe("none");
      expect(elevatedRoleCount(user)).toBe(0);
      expect(holdsSuperAdmin(user)).toBe(false);
    }
  });

  it("still reads a present embed, with staff ahead of student", () => {
    const user = row([
      { roles: { name: "student" } },
      { roles: { name: "staff" } },
      { roles: { name: "super_admin" } },
    ]);
    expect(currentMembership(user)).toBe("staff");
    expect(holdsSuperAdmin(user)).toBe(true);
    expect(elevatedRoleCount(user)).toBe(3);
  });

  it("does not count the community floor as elevated", () => {
    const user = row([
      { roles: { name: "community_member" } },
      { roles: { name: "self_service" } },
    ]);
    expect(currentMembership(user)).toBe("community");
    expect(elevatedRoleCount(user)).toBe(0);
    expect(holdsSuperAdmin(user)).toBe(false);
  });
});
