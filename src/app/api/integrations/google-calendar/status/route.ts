import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStoredCalendarTokens } from "@/lib/google/calendar";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = createAdminClient();
  const tokens = await getStoredCalendarTokens(admin);

  return NextResponse.json({
    connected: !!tokens,
    connectedAt: tokens?.updated_at ?? null,
  });
}
