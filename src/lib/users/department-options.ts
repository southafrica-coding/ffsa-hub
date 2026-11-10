// Department pickers.
//
// Active main ministries are the source (listActiveMinistries). Leadership
// Team is a real department and must keep displaying as "Leadership Team",
// but only an admin may set it, through PATCH /api/users/[id]. A self-set
// or a staff-decision "make staff" of leadership_team is refused (migration
// 315 and the make-staff route), so those pickers share one filtered list.

export const LEADERSHIP_TEAM_DEPARTMENT = "leadership_team";
export const LEADERSHIP_TEAM_DEPARTMENT_LABEL = "Leadership Team";

export type MinistryDepartment = { slug: string; name: string };
export type DepartmentOption = { value: string; label: string };

function toOptions(
  ministries: readonly MinistryDepartment[] | null | undefined
): DepartmentOption[] {
  return (ministries ?? []).map((ministry) => ({
    value: ministry.slug,
    label: ministry.name,
  }));
}

/** Admin user edit. Includes Leadership Team. */
export function adminDepartmentOptions(
  ministries: readonly MinistryDepartment[] | null | undefined
): DepartmentOption[] {
  return toOptions(ministries);
}

/**
 * Departments a non-admin picker may offer. Shared by the staff-decision
 * make-staff dropdown and the phone department list (including a self-set).
 */
export function assignableDepartmentOptions(
  ministries: readonly MinistryDepartment[] | null | undefined
): DepartmentOption[] {
  return toOptions(ministries).filter(
    (option) => option.value !== LEADERSHIP_TEAM_DEPARTMENT
  );
}

export const staffDecisionDepartmentOptions = assignableDepartmentOptions;

/** Phone department list, including when the person sets their own department. */
export const mobileDepartmentOptions = assignableDepartmentOptions;

/** Label for a stored department, including one the picker no longer offers. */
export function labelForDepartment(
  value: string | null | undefined,
  options: readonly DepartmentOption[] = []
): string | null {
  if (value == null || value === "") return null;
  const known = options.find((option) => option.value === value);
  if (known) return known.label;
  if (value === LEADERSHIP_TEAM_DEPARTMENT) return LEADERSHIP_TEAM_DEPARTMENT_LABEL;
  return value;
}

/**
 * Select value for a make-staff picker. A stored leadership_team (or any
 * slug the list does not offer) is not preselected, so saving cannot send it.
 */
export function departmentChoice(
  current: string | null | undefined,
  options: readonly { value: string }[],
  empty = ""
): string {
  if (current && options.some((option) => option.value === current)) return current;
  return empty;
}
