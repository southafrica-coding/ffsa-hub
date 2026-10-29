// True if the user counts as staff — either their self-signup type is
// 'staff' or they hold the 'staff' role. Invited staff have no signup_type,
// so the role check matters: it is what puts the NDA in front of them.
// Fail-closed (not staff) on a role-read error so students/community are
// never wrongly prompted.
//
// Shared by the profile-completion gate and GET /api/consent/required so
// the onboarding wizard and the gate always ask the same people for the
// same policies.
export async function userIsStaff(
  supabase: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  userId: string,
  row: { signup_type?: unknown }
): Promise<boolean> {
  if (row.signup_type === "staff") return true;
  const { data, error } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", userId)
    .eq("roles.name", "staff")
    .limit(1);
  if (error) return false;
  return (data?.length ?? 0) > 0;
}
