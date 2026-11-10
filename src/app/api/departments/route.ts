import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api-auth";
import { accountIsActive } from "@/lib/auth/grant-scope";
import { loadDepartmentGate } from "@/lib/departments/access";
import { notAuthenticated, notFound, serverError } from "@/lib/departments/http";
import { listVisibleDepartments } from "@/lib/departments/page";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// GET /api/departments — homes the caller can open, including budget-only.

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return notAuthenticated();
  const gate = await loadDepartmentGate(supabase, user.id);
  if (!gate) {
    if (await accountIsActive(supabase, user.id)) return serverError("access lookup failed");
    return notFound("Department not found");
  }
  const list = await listVisibleDepartments(createAdminClient(), gate);
  if (list.error) return serverError(list.error);
  return NextResponse.json(list.data);
}
