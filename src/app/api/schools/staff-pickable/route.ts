import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanManageApplications } from "@/lib/auth/check-schools-access";
import { fetchAssignableContacts } from "@/lib/auth/assignable-contacts";

// Returns users eligible to be the point-of-contact for the given
// program. Eligibility lives in fetchAssignableContacts: a program-scoped
// schools.assignable_as_contact grant, a super admin, or an active leader
// of this program. Other schools permissions do not confer it.
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const hasAccess = await userCanManageApplications(supabase, authUser.id);
  if (!hasAccess) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const url = new URL(request.url);
  const programId = url.searchParams.get("program_id");
  if (!programId) {
    return NextResponse.json({ error: "program_id is required" }, { status: 400 });
  }

  const staff = await fetchAssignableContacts(createAdminClient(), programId);
  return NextResponse.json({ staff });
}
