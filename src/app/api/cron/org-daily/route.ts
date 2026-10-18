import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

// GET /api/cron/org-daily — daily Vercel cron at 22:30 UTC (00:30 in South
// Africa), so a ministry's last day is a whole SAST day.
//
// A ministry's end date is its LAST day. The day after, it goes inactive and
// its objectives are marked ended (not failed, not deleted): see
// org_end_due_ministries() in migration 252. Woven, ending 31 October 2026,
// is the first one this will catch. Change sets (step J3) will apply here too.
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient();
  const { data, error } = await admin.rpc("org_end_due_ministries");
  if (error) {
    console.error("[org-daily] org_end_due_ministries failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ended: data ?? 0 });
}
