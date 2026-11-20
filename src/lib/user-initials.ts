import { isColorScheme, type ColorScheme } from "@/lib/theme";

/**
 * What the signed-in shell needs about the person: their initials for the
 * rail avatar and their saved Light / Dark setting (users.color_scheme,
 * migration 344; null until they pick). Best-effort: any failure returns
 * "" and null, so the rail shows a neutral glyph and the device decides.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getShellProfile(supabase: any): Promise<{
  initials: string;
  colorScheme: ColorScheme | null;
}> {
  try {
    const { data } = await supabase.auth.getUser();
    const user = data?.user;
    if (!user) return { initials: "", colorScheme: null };

    const withScheme = await supabase
      .from("users")
      .select("first_name, last_name, preferred_name, color_scheme")
      .eq("id", user.id)
      .maybeSingle();
    // Before migration 344 is applied the column doesn't exist; fall back so
    // the rail still gets initials.
    const { data: row } = withScheme.error
      ? await supabase
          .from("users")
          .select("first_name, last_name, preferred_name")
          .eq("id", user.id)
          .maybeSingle()
      : withScheme;

    const colorScheme = isColorScheme(row?.color_scheme) ? row.color_scheme : null;
    const first = (row?.first_name || "").trim();
    const last = (row?.last_name || "").trim();
    const initials =
      `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() ||
      (user.email?.charAt(0) || "").toUpperCase();
    return { initials, colorScheme };
  } catch {
    return { initials: "", colorScheme: null };
  }
}
