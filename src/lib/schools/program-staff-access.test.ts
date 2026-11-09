import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "@/lib/testing/fake-supabase";
import { userCanManageProgram } from "@/lib/auth/check-schools-access";
import {
  applicationsForViewer,
  deriveProgramViewer,
  programsVisibleOnSchoolsHome,
} from "./program-staff-access";

const PROGRAM = "5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48";

describe("deriveProgramViewer", () => {
  const base = {
    userId: "u1",
    canManage: false,
    isStaff: true,
    canManageFinance: false,
    hasSchoolsGrant: false,
  };

  it("narrows a person whose only school relationship is program staff", () => {
    expect(deriveProgramViewer(base).staffScoped).toBe(true);
  });

  it("leaves a leader, a schools grant, and a finance manager on their current access", () => {
    expect(deriveProgramViewer({ ...base, canManage: true }).staffScoped).toBe(false);
    expect(deriveProgramViewer({ ...base, hasSchoolsGrant: true }).staffScoped).toBe(false);
    expect(deriveProgramViewer({ ...base, canManageFinance: true }).staffScoped).toBe(false);
    expect(deriveProgramViewer({ ...base, isStaff: false }).staffScoped).toBe(false);
  });
});

describe("applicationsForViewer", () => {
  const rows = [
    { id: "a", assigned_staff_id: "u1" },
    { id: "b", assigned_staff_id: "u2" },
    { id: "c", assigned_staff_id: null },
  ];

  it("gives staff only the applicants assigned to them", () => {
    expect(applicationsForViewer(rows, { userId: "u1", staffScoped: true }).map((r) => r.id)).toEqual(["a"]);
  });

  it("gives a leader the full list", () => {
    expect(applicationsForViewer(rows, { userId: "u1", staffScoped: false })).toEqual(rows);
  });
});

describe("programsVisibleOnSchoolsHome", () => {
  const programs = [{ id: PROGRAM }, { id: "other" }];

  it("keeps the full list for someone who already has the schools module", () => {
    expect(
      programsVisibleOnSchoolsHome(programs, { hasModuleAccess: true, staffProgramIds: [PROGRAM] })
    ).toEqual(programs);
  });

  it("limits a staff-only viewer to the schools they staff", () => {
    expect(
      programsVisibleOnSchoolsHome(programs, { hasModuleAccess: false, staffProgramIds: [PROGRAM] })
    ).toEqual([{ id: PROGRAM }]);
  });
});

describe("userCanManageProgram", () => {
  it("does not treat a program_staff row as management", async () => {
    const f = createFakeSupabase({
      resolve: (q) => {
        if (q.table === "program_staff") return { data: [{ id: "ps" }] };
        return { data: [] };
      },
    });
    expect(await userCanManageProgram(f.client, "u1", PROGRAM)).toBe(false);
    expect(f.queries.map((q) => q.table)).not.toContain("program_staff");
  });

  it("still treats a program leader as a manager", async () => {
    const f = createFakeSupabase({
      resolve: (q) => (q.table === "program_leaders" ? { data: [{ id: "pl" }] } : { data: [] }),
    });
    expect(await userCanManageProgram(f.client, "u1", PROGRAM)).toBe(true);
  });
});
