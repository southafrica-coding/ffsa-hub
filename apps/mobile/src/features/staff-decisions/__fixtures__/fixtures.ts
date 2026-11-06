// Test data for Staff decisions (shaped like the parsed API responses).

import type { School, SchoolDetail, SchoolList, StaffDecisionRow } from "../api";

export const LT_2026 = "11111111-1111-4111-8111-111111111111";
export const LT_2025 = "22222222-2222-4222-8222-222222222222";

export function school(over: Partial<School> = {}): School {
  return { id: LT_2026, name: "Leadership Track 2026", status: "active", archived: false, total: 3, yes: 1, no: 1, undecided: 1, ...over };
}

export function schoolList(over: Partial<SchoolList> = {}): SchoolList {
  return { schools: [school(), school({ id: LT_2025, name: "Leadership Track 2025", status: "archived", archived: true, total: 1, yes: 0, no: 0, undecided: 1 })], ...over };
}

export function student(over: Partial<StaffDecisionRow> = {}): StaffDecisionRow {
  return {
    enrollmentId: "e1",
    userId: "s1",
    name: "Ann Bell",
    email: "ann@example.org",
    status: "arrived",
    isStaff: false,
    department: null,
    decision: null,
    ...over,
  };
}

export const yesDecision = { accepted: true, note: null, decidedAt: "2026-10-01T10:00:00Z", decidedByName: "Lee Team" };
export const noDecision = { accepted: false, note: "Not this year", decidedAt: "2026-10-02T10:00:00Z", decidedByName: "Lee Team" };

export function detail(over: Partial<SchoolDetail> = {}): SchoolDetail {
  return {
    school: school(),
    rows: [
      student({ enrollmentId: "e1", name: "Ann Bell", decision: yesDecision }),
      student({ enrollmentId: "e2", userId: "s2", name: "Ben Cole", email: "ben@example.org", isStaff: true, department: "media", decision: noDecision }),
      student({ enrollmentId: "e3", userId: null, name: "Cara Lee", email: null }),
    ],
    departmentOptions: [
      { value: "media", label: "Media" },
      { value: "worship", label: "Worship" },
    ],
    ...over,
  };
}
