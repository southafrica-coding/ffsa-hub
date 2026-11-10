import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api-auth";
import { accountIsActive } from "@/lib/auth/grant-scope";
import { holdsUnscopedRole } from "@/lib/departments/access";
import { FOLDED_DEPARTMENTS, isBlockedHomeSlug } from "@/lib/departments/homes";
import { badRequest, notAuthenticated, notAuthorized, notFound, serverError } from "@/lib/departments/http";
import { rocksForDepartments } from "@/lib/departments/internal/page";
import { parseQuarter } from "@/lib/departments/quarter";
import { rpcFlag } from "@/lib/departments/rpc";
import { listAliases, listDepartmentRows, listUserRoleGrants } from "@/lib/departments/internal/repository";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return notAuthenticated();
  if (!(await accountIsActive(supabase, user.id))) return notAuthorized();

  const [lead, roles] = await Promise.all([
    rpcFlag(supabase, "dept_is_leadership_reader"),
    listUserRoleGrants(supabase, user.id),
  ]);
  if (!lead.ok || roles.error) return notAuthorized();
  const adminUser = holdsUnscopedRole(roles.data, ["super_admin", "admin"]);
  if (!lead.value && !adminUser) return notFound("Department not found");

  const quarter = parseQuarter(new URL(request.url).searchParams.get("quarter"));
  if (!quarter.ok) return badRequest(quarter.error);

  const admin = createAdminClient();
  const [ministries, aliases] = await Promise.all([listDepartmentRows(admin), listAliases(admin)]);
  if (ministries.error || aliases.error) return serverError(ministries.error ?? aliases.error);
  const folded = new Set(aliases.data.map((alias) => alias.staff_ministry_id));
  const homes = ministries.data
    .filter((row) => {
      if (!row.is_active || row.ministry_type === "part_time" || isBlockedHomeSlug(row.slug)) return false;
      if (folded.has(row.id) || row.slug in FOLDED_DEPARTMENTS) return false;
      return true;
    })
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  const rocks = await rocksForDepartments(admin, homes, quarter.quarter);
  if (rocks.error || !rocks.data) return serverError(rocks.error);

  return NextResponse.json({
    quarter: quarter.quarter,
    departments: homes.map((department) => ({
      slug: department.slug,
      name: department.name,
      rocks: rocks.data?.get(department.id) ?? [],
    })),
  });
}
