import { getMinistryBySlug } from "@/services/ministries";

// Department must be a real MAIN ministry slug (staff_ministries is the
// source of truth, validated here rather than a static DB CHECK so
// admin-added ministries save without a migration). Retired ministries are
// still accepted so a user on a since-retired one isn't locked out;
// part-time ministries are not — people join those through the roster, and
// no picker offers them as a department.
//
// Returns an error message for the caller to send back as a 400, or null.

type Client = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function validateDepartment(
  supabase: Client,
  slug: string
): Promise<string | null> {
  const { data: ministry } = await getMinistryBySlug(supabase, slug);
  if (!ministry) return "Please select a valid department.";
  if ((ministry as { ministry_type?: string }).ministry_type === "part_time") {
    return "That's a part-time ministry, so it can't be a department. Pick the main ministry they serve in — part-time ministries are joined from the Ministry tab.";
  }
  return null;
}
