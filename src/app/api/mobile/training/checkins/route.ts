import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { NO_STORE, parseCheckinBody, saToday, weekOf } from "@/lib/mobile/training";
import { notifyNeedsCare } from "@/lib/training/care-notify";
import { saveCheckin } from "@/services/training";

// POST /api/mobile/training/checkins — save this week's check-in (48d).
// Runs migration 336's save_student_checkin as the caller, so RLS decides
// who may check in with whom; a refusal comes back as 403. A newly raised
// "needs care" tells the school leader and everyone walking with her
// (Slack + push, no note text). One check-in per person per student per
// week: saving again this week updates it.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json(
      { error: "unauthenticated", message: "Sign in to use this endpoint." },
      { status: 401, headers: NO_STORE }
    );
  }

  const parsed = parseCheckinBody(await request.json().catch(() => null));
  if (!parsed.ok) {
    return NextResponse.json({ error: "invalid", message: parsed.message }, { status: 400, headers: NO_STORE });
  }

  const now = new Date();
  const week = weekOf(now);
  const { data, error } = await saveCheckin(supabase, parsed.value, week);
  if (error) {
    if (error.code === "42501") {
      return NextResponse.json(
        { error: "forbidden", message: "You can't check in with this student." },
        { status: 403, headers: NO_STORE }
      );
    }
    return NextResponse.json({ error: "server_error", message: error.message }, { status: 500, headers: NO_STORE });
  }

  const saved = (Array.isArray(data) ? data[0] : data) as { checkin_id: string; newly_needs_care: boolean } | null;
  if (!saved) {
    return NextResponse.json({ error: "server_error", message: "The check-in wasn't saved." }, { status: 500, headers: NO_STORE });
  }
  if (saved.newly_needs_care) {
    await notifyNeedsCare({
      checkinId: saved.checkin_id,
      enrollmentId: parsed.value.enrollmentId,
      authorId: user.id,
      today: saToday(now),
    });
  }
  return NextResponse.json({ checkinId: saved.checkin_id, weekOf: week }, { headers: NO_STORE });
}
