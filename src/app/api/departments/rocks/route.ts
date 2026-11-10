import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api-auth";
import { accountIsActive } from "@/lib/auth/grant-scope";
import { loadDepartmentGate, viewLeadershipRocks } from "@/lib/departments/access";
import { badRequest, notAuthenticated, notFound, serverError } from "@/lib/departments/http";
import { personName } from "@/lib/departments/names";
import { parseQuarter } from "@/lib/departments/quarter";
import { listDepartmentRows, listRocksForQuarter, loadPeopleById } from "@/lib/departments/repository";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return notAuthenticated();
  const gate = await loadDepartmentGate(supabase, user.id);
  if (!gate) {
    if (await accountIsActive(supabase, user.id)) return serverError("access lookup failed");
    return notFound("Department not found");
  }
  if (!viewLeadershipRocks(gate)) return notFound("Department not found");
  const quarter = parseQuarter(new URL(request.url).searchParams.get("quarter"));
  if (!quarter.ok) return badRequest(quarter.error);
  const admin = createAdminClient();
  const [ministries, rocks] = await Promise.all([
    listDepartmentRows(admin),
    listRocksForQuarter(admin, quarter.quarter),
  ]);
  if (ministries.error || rocks.error) return serverError(ministries.error ?? rocks.error);
  const people = await loadPeopleById(admin, rocks.data.flatMap((rock) => (rock.owner_user_id ? [rock.owner_user_id] : [])));
  if (people.error) return serverError(people.error);
  const active = ministries.data.filter((row) => row.is_active).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  return NextResponse.json({
    quarter: quarter.quarter,
    departments: active.map((department) => ({
      id: department.id,
      slug: department.slug,
      name: department.name,
      rocks: rocks.data
        .filter((rock) => rock.staff_ministry_id === department.id)
        .map((rock) => ({
          ...rock,
          dueOn: rock.due_on,
          owner_name: rock.owner_user_id ? personName(people.data.get(rock.owner_user_id)) : null,
        })),
    })),
  });
}
