// Department rules from users_guard_privileged_self_update (migration 315),
// term for term. The trigger trims department for every caller, and a blank
// value (NULL, '', or only the btrim edge set) is stored as NULL and is
// always allowed.
// A non-blank value requires staff — has_any_role(['staff']) OR
// signup_type IS NOT DISTINCT FROM 'staff' — and a staff_ministries row
// whose ministry_type is 'main' and whose slug is not 'leadership_team'.
//
// Unknown slugs are 400 here so a typo is not described as an admin-only
// department. The trigger raises 42501 for those ("Only an admin can set
// the department X.") because it cannot tell "missing" from "forbidden".
// This check runs before the UPDATE, so the trigger is not reached.

export const LEADERSHIP_TEAM_SLUG = "leadership_team";

export const ONLY_STAFF_DEPARTMENT = "Only staff choose a department.";

export function onlyAdminDepartmentMessage(slug: string): string {
  return `Only an admin can set the department ${slug}.`;
}

export const UNKNOWN_DEPARTMENT = "Please select a valid department.";

export type StaffMinistryRef = {
  slug: string;
  ministry_type?: string | null;
};

export type DepartmentVerdict =
  | { ok: true }
  | { ok: false; status: 400 | 403; error: string };

// Same edges as 315's btrim(..., E' \t\n\r\f\x0B\u00a0'): space, tab, LF, CR,
// form feed, vertical tab, non-breaking space. Not JavaScript's wider trim().
const DEPARTMENT_EDGE = /^[ \t\n\r\f\v\u00a0]+|[ \t\n\r\f\v\u00a0]+$/g;

/** Trim department the way the trigger does. Blank becomes NULL. */
export function normalizeDepartment(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).replace(DEPARTMENT_EDGE, "");
  return trimmed === "" ? null : trimmed;
}

/** True when normalizeDepartment would store NULL. */
export function isBlankDepartment(value: unknown): boolean {
  return normalizeDepartment(value) == null;
}

/**
 * True when two values are IS DISTINCT FROM each other. Null and undefined
 * are not distinct from each other; null is distinct from ''.
 */
export function isDistinct(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return false;
  if (left == null && right == null) return false;
  return true;
}

/**
 * has_any_role(ARRAY['staff']) OR OLD.signup_type IS NOT DISTINCT FROM 'staff'.
 * A scoped staff role does not count — has_any_role requires scope_type IS NULL.
 * Do not substitute userIsStaff(); that helper reads roles without the scope filter.
 */
export function callerMayChooseDepartment(
  signupType: unknown,
  hasUnscopedStaffRole: boolean
): boolean {
  return hasUnscopedStaffRole || signupType === "staff";
}

export function verdictForDepartment(args: {
  value: unknown;
  isStaff: boolean;
  ministry: StaffMinistryRef | null;
}): DepartmentVerdict {
  const slug = normalizeDepartment(args.value);
  if (slug == null) return { ok: true };
  if (!args.isStaff) {
    return { ok: false, status: 403, error: ONLY_STAFF_DEPARTMENT };
  }
  const ministry = args.ministry;
  if (!ministry || ministry.slug !== slug) {
    return { ok: false, status: 400, error: UNKNOWN_DEPARTMENT };
  }
  if (ministry.ministry_type !== "main" || slug === LEADERSHIP_TEAM_SLUG) {
    return { ok: false, status: 403, error: onlyAdminDepartmentMessage(slug) };
  }
  return { ok: true };
}

/**
 * Department options a person may pick on their own profile. Leadership Team
 * is omitted — only an admin sets that slug, through PATCH /api/users/[id].
 * If the row already holds it, keep the option so the select still shows the
 * current value and a save of the other personal fields does not clear it.
 */
export function selfServiceDepartmentOptions(
  ministries: Array<{ slug: string; name: string }>,
  current: unknown
): Array<{ value: string; label: string }> {
  const options = ministries
    .filter((ministry) => ministry.slug !== LEADERSHIP_TEAM_SLUG)
    .map((ministry) => ({ value: ministry.slug, label: ministry.name }));
  if (
    current === LEADERSHIP_TEAM_SLUG &&
    !options.some((option) => option.value === LEADERSHIP_TEAM_SLUG)
  ) {
    options.push({ value: LEADERSHIP_TEAM_SLUG, label: "Leadership Team" });
  }
  return options;
}
