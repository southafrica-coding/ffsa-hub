import { makeMe } from "../../../../test/fixtures";
import { dayLabel, hasTrainingAccess, isTrainingDirector, SECTIONS, sectionsFor, trainingRole } from "../logic";

const role = (name: string, scopeType: string | null = null, scopeId: string | null = null) => ({ name, scopeType, scopeId });
const perm = (key: string, scopeType: string | null = null, scopeId: string | null = null) => ({
  key,
  scopeType,
  scopeId,
  source: "role",
});

describe("training role", () => {
  it("nobody while /api/me hasn't loaded", () => {
    expect(trainingRole(null)).toBeNull();
    expect(hasTrainingAccess(null)).toBe(false);
    expect(sectionsFor(null)).toEqual([]);
  });

  it("plain staff with no school ties get no Training tab", () => {
    expect(trainingRole(makeMe())).toBeNull();
    expect(trainingRole(makeMe({ training: { walkingWith: 0, programStaff: 0 } }))).toBeNull();
  });

  it("admins and unscoped schools.manage are the director", () => {
    expect(trainingRole(makeMe({ roles: [role("admin")], permissions: [] }))).toBe("director");
    expect(trainingRole(makeMe({ permissions: [perm("schools.manage")] }))).toBe("director");
    expect(isTrainingDirector(makeMe({ permissions: [perm("schools.manage", "program", "p1")] }))).toBe(false);
  });

  it("program leaders and scoped schools.* holders are a school leader", () => {
    expect(trainingRole(makeMe({ roles: [role("program_leader", "program", "p1")], permissions: [] }))).toBe("leader");
    expect(trainingRole(makeMe({ permissions: [perm("schools.manage", "program", "p1")] }))).toBe("leader");
    expect(trainingRole(makeMe({ permissions: [perm("schools.view_applications", "program", "p1")] }))).toBe("leader");
  });

  it("named program staff and people walking with a student come from /api/me's training ties", () => {
    expect(trainingRole(makeMe({ training: { walkingWith: 0, programStaff: 1 } }))).toBe("staff");
    expect(trainingRole(makeMe({ training: { walkingWith: 3, programStaff: 0 } }))).toBe("walker");
    // staff outranks walker: Students already covers the ones they walk with
    expect(trainingRole(makeMe({ training: { walkingWith: 3, programStaff: 1 } }))).toBe("staff");
  });

  it("an older server without training ties still parses, and only the module counts", () => {
    const me = makeMe({ permissions: [] });
    expect(me.training).toBeNull();
    expect(hasTrainingAccess(me)).toBe(false);
  });
});

describe("sections", () => {
  it("follow the role, Today first (48i)", () => {
    expect(SECTIONS.director).toEqual(["today", "schools", "applicants", "people"]);
    expect(SECTIONS.leader).toEqual(["today", "students", "applicants", "grades"]);
    expect(SECTIONS.staff).toEqual(["today", "students", "grades"]);
    expect(SECTIONS.walker).toEqual(["today", "myStudents", "grades"]);
    for (const list of Object.values(SECTIONS)) expect(list[0]).toBe("today");
  });

  it("only directors and leaders see Applicants", () => {
    expect(sectionsFor(makeMe({ training: { walkingWith: 2, programStaff: 0 } }))).not.toContain("applicants");
    expect(sectionsFor(makeMe({ training: { walkingWith: 0, programStaff: 1 } }))).not.toContain("applicants");
  });
});

describe("dayLabel", () => {
  it("reads like the masthead: MON 23 NOV", () => {
    expect(dayLabel(new Date(2026, 10, 23, 9, 41))).toBe("MON 23 NOV");
  });
});
