import { describe, expect, it } from "vitest";
import { switchFailure } from "./program-staff";

describe("switchFailure", () => {
  it("refuses a super admin with 400", () => {
    expect(switchFailure("Refusing to switch a super admin").status).toBe(400);
  });

  it("tells a leader that an admin is needed", () => {
    const result = switchFailure(
      "An admin is needed to move this person to staff. They have other school permissions on this program (schools.manage)."
    );
    expect(result.status).toBe(403);
    expect(result.error).toMatch(/An admin is needed/);
    expect(result.error).toMatch(/schools\.manage/);
  });

  it("hides a database failure that is not an authorization decision", () => {
    expect(switchFailure("connection reset").status).toBe(500);
  });
});
