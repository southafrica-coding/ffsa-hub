import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { closureRangeTooLong, isCalendarDate } from "@/lib/prayer-room/room-closure";
import { getAuditoriumClosures } from "@/services/prayer-room-room-closures";

// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD — approved auditorium bookings as
// generic closures. Any signed-in user can read this. Titles stay on the
// booking; the payload is only the occupied window.
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const sp = new URL(request.url).searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  if (!isCalendarDate(from) || !isCalendarDate(to) || from > to) {
    return NextResponse.json({ error: "A from and to date are required" }, { status: 400 });
  }
  if (closureRangeTooLong(from, to)) {
    return NextResponse.json({ error: "Date range must be 366 days or less" }, { status: 400 });
  }

  try {
    const { data, error } = await getAuditoriumClosures(createAdminClient(), from, to);
    if (error) {
      console.error("Auditorium bookings could not be loaded for the prayer room", error.message);
      return NextResponse.json({ error: "Auditorium bookings could not be loaded" }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (e) {
    console.error("Auditorium bookings could not be loaded for the prayer room", e);
    return NextResponse.json({ error: "Auditorium bookings could not be loaded" }, { status: 500 });
  }
}
