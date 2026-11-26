import { L10_TABLES } from "@/lib/l10/types";
import { asL10ReadClient } from "./l10-read-client";

/**
 * True when this department has at least one active L10 team the viewer can
 * see (RLS on l10_teams decides). Department-agnostic. Any read error is
 * "no", so the department home never breaks over the L10 link.
 */
export async function departmentHasL10Teams(supabase: unknown, slug: string): Promise<boolean> {
  const db = asL10ReadClient(supabase);
  if (!db) return false;
  const ministry = await db.from<{ id: string }>("staff_ministries").select("id").eq("slug", slug).maybeSingle();
  if (ministry.error || !ministry.data?.id) return false;
  const teams = await db
    .from(L10_TABLES.teams)
    .select("id", { count: "exact", head: true })
    .eq("department_id", ministry.data.id)
    .eq("is_active", true);
  return !teams.error && (teams.count ?? 0) > 0;
}
