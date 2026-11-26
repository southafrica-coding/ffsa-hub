import { SONGWRITING_DEPARTMENT_SLUG } from "@/components/departments/songwriting/header";

/**
 * True when this department is the Songwriting owner and has at least one
 * nation or training the viewer can see (RLS on the 417 tables decides).
 * 417 has no department_id, so other slugs are always false. Any read
 * error is "no", so the department home never breaks over the link.
 */
export async function departmentHasSongwriting(supabase: unknown, slug: string): Promise<boolean> {
  if (slug !== SONGWRITING_DEPARTMENT_SLUG) return false;
  // 417 tables are not in the generated Database type yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  if (typeof db?.from !== "function") return false;
  const nations = await db.from("pw_nations").select("id", { count: "exact", head: true });
  if (nations.error) return false;
  if ((nations.count ?? 0) > 0) return true;
  const trainings = await db.from("pw_songwriting_trainings").select("id", { count: "exact", head: true });
  return !trainings.error && (trainings.count ?? 0) > 0;
}
