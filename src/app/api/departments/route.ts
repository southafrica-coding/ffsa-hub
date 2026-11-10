import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api-auth";
import { accountIsActive } from "@/lib/auth/grant-scope";
import { notAuthenticated, notAuthorized, serverError } from "@/lib/departments/http";
import { listVisibleDepartments } from "@/lib/departments/page";
import { createClient } from "@/lib/supabase/server";

// GET /api/departments — homes the caller can open, including budget-only.
// Inactive accounts and failed access lookups are 403. A home the caller
// cannot open is omitted, not 404'd from this list.

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return notAuthenticated();
  if (!(await accountIsActive(supabase, user.id))) return notAuthorized();
  const list = await listVisibleDepartments(supabase, user.id);
  if (list.accessError) return notAuthorized();
  if (list.error) return serverError(list.error);
  return NextResponse.json(list.data);
}
