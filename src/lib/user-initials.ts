/**
 * Resolve the signed-in user's display initials for the shell rail avatar.
 * Best-effort: any failure returns "" and the rail shows a neutral glyph.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getUserInitials(supabase: any): Promise<string> {
  try {
    const { data } = await supabase.auth.getUser();
    const user = data?.user;
    if (!user) return "";

    const { data: row } = await supabase
      .from("users")
      .select("first_name, last_name, preferred_name")
      .eq("id", user.id)
      .maybeSingle();

    const first = (row?.preferred_name || row?.first_name || "").trim();
    const last = (row?.last_name || "").trim();
    const initials = `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
    if (initials) return initials;

    return (user.email?.charAt(0) || "").toUpperCase();
  } catch {
    return "";
  }
}
