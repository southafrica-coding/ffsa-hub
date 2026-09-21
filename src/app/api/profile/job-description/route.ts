import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { canEditJobDescription } from "@/lib/auth/check-cv-access";
import { updateJobDescription } from "@/services/staff-cv";

// PATCH /api/profile/job-description — set a staff member's job description.
// Only a ministry leader of one of their ministries, or admin. The staff
// member themselves is deliberately never allowed to write this.
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const targetUserId = typeof body.userId === "string" ? body.userId : "";
  const jobDescription = typeof body.job_description === "string" ? body.job_description : "";
  if (!targetUserId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  if (!(await canEditJobDescription(supabase, user.id, targetUserId))) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  // Never satisfied by the self-row RLS policy for anyone but the target, and
  // the target is never the one calling this successfully — always write via
  // the service-role client.
  const { error } = await updateJobDescription(createAdminClient(), targetUserId, jobDescription);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
