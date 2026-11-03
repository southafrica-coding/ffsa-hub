import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser, canManageEvents } from "@/lib/api-auth";
import { listCheckInEvents } from "@/services/my-tickets";
import { checkInWindowStart } from "@/lib/mobile/my-tickets";

// GET /api/mobile/check-in-events — the events the phone app offers for
// door check-in. Same gate as /api/events/[id]/check-in (a managing events
// role, or events.manage_attendance), so the list never offers a door the
// caller then can't run. Read with the service-role client because a
// manage_attendance-only user can't see unpublished/private events under
// RLS — but it returns titles, dates and places only.

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

type EventRow = {
  id: string;
  title: string;
  start_date: string;
  start_time: string | null;
  end_date: string | null;
  end_time: string | null;
  location: string | null;
};

export async function GET() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json(
      { error: "unauthenticated", message: "Sign in to use this endpoint." },
      { status: 401, headers: NO_STORE }
    );
  }
  if (!(await canManageEvents(supabase, user.id, ["events.manage_attendance"]))) {
    return NextResponse.json(
      { error: "Not authorized" },
      { status: 403, headers: NO_STORE }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await listCheckInEvents(admin, checkInWindowStart(new Date()));
  if (error) {
    return NextResponse.json(
      { error: "server_error", message: error.message },
      { status: 500, headers: NO_STORE }
    );
  }

  const events = ((data ?? []) as EventRow[]).map((e) => ({
    id: e.id,
    title: e.title,
    startDate: e.start_date,
    startTime: e.start_time,
    endDate: e.end_date,
    endTime: e.end_time,
    location: e.location,
  }));
  return NextResponse.json({ events }, { headers: NO_STORE });
}
