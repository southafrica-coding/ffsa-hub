// Derive a person's display "job title" from what they actually are in the Hub
// — their membership type plus, for staff, their strongest role in the Ministry
// tab, and for students, the school they're enrolled in. A manually-set
// users.job_title always wins (an admin override); otherwise the title is
// generated so it stays in sync as people are promoted/moved.
//
// Wording (confirmed with the FFSA team):
//   staff, point leader            → "{Dept} Point Leader"
//   staff, leader                  → "{Dept} Ministry Leader"
//   staff, member/none             → "{Dept} Staff"  (just "Staff" with no dept)
//   student                        → "{School} Student"  (just "Student" if none)
//   community member               → "Community Member"

export type Membership = "staff" | "student" | "community" | "none";

// Strongest role a user holds across their active staff_ministry_members rows.
// point_leader covers both ministry point leaders and category point leaders.
export type MinistryRole = "point_leader" | "leader" | "member" | null;

export type DeriveTitleInput = {
  /** users.job_title — manual override; wins whenever non-empty. */
  jobTitle?: string | null;
  membership: Membership;
  /** Resolved staff_ministries label for the user's department, e.g. "Media". */
  departmentLabel?: string | null;
  ministryRole?: MinistryRole;
  /** The student's program/school name, e.g. "DTS". */
  schoolLabel?: string | null;
};

export function deriveJobTitle({
  jobTitle,
  membership,
  departmentLabel,
  ministryRole,
  schoolLabel,
}: DeriveTitleInput): string | null {
  // 1. Manual override always wins.
  const manual = jobTitle?.trim();
  if (manual) return manual;

  const dept = departmentLabel?.trim();

  // 2. Staff — role + department suffix.
  if (membership === "staff") {
    if (!dept) return "Staff";
    if (ministryRole === "point_leader") return `${dept} Point Leader`;
    if (ministryRole === "leader") return `${dept} Ministry Leader`;
    return `${dept} Staff`;
  }

  // 3. Student — school-scoped.
  if (membership === "student") {
    const school = schoolLabel?.trim();
    return school ? `${school} Student` : "Student";
  }

  // 4. Community member — generic.
  if (membership === "community") return "Community Member";

  // 5. Unknown membership — no derived title.
  return null;
}

/**
 * Collapse a user's active staff_ministry_members rows to their single
 * strongest role. Point leadership (ministry or category) outranks leader,
 * which outranks plain membership. Returns null when the user has no active
 * ministry membership.
 */
export function strongestMinistryRole(
  rows: Array<{
    member_role?: string | null;
    is_point_leader?: boolean | null;
    is_category_point_leader?: boolean | null;
    status?: string | null;
  }>
): MinistryRole {
  let best: MinistryRole = null;
  const rank = (r: MinistryRole) =>
    r === "point_leader" ? 3 : r === "leader" ? 2 : r === "member" ? 1 : 0;
  for (const row of rows) {
    if (row.status && row.status !== "active") continue;
    let role: MinistryRole = "member";
    if (row.is_point_leader || row.is_category_point_leader) role = "point_leader";
    else if (row.member_role === "leader") role = "leader";
    if (rank(role) > rank(best)) best = role;
  }
  return best;
}
