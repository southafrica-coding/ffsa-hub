import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOpsTeam } from "@/lib/operations/access";
import { importMaintenanceRequests, sendRecap } from "@/lib/operations/slack";

// POST /api/operations/slack — operations team buttons that talk to Slack:
//   { action: "import" }  pick up new maintenance form posts now
//   { action: "recap" }   post what the meeting handed out to the ops channel
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await isOpsTeam(supabase, user.id))) {
    return NextResponse.json({ error: "Operations team only" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const admin = createAdminClient();
  try {
    if (body.action === "import") {
      const res = await importMaintenanceRequests(admin);
      if (res.error) return NextResponse.json({ error: res.error }, { status: 502 });
      return NextResponse.json({ success: true, ...res });
    }
    if (body.action === "recap") {
      const res = await sendRecap(admin);
      if (!res.sent) return NextResponse.json({ error: res.error }, { status: 400 });
      return NextResponse.json({ success: true, ...res });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Slack failed" }, { status: 502 });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
