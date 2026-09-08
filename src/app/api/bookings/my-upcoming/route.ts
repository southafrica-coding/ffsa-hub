import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { getMyUpcomingBookings } from "@/services/bookings";

// Always read live — this card is how people check what they cancelled.
export const dynamic = "force-dynamic";

// GET /api/bookings/my-upcoming — the current user's upcoming Space Bookings,
// soonest first. Reads own rows via the user client (RLS allows requested_by = self).
// Powers the dashboard "My Space Bookings" panel.
export async function GET() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const today = new Date().toISOString().split("T")[0];
  const { data, error } = await getMyUpcomingBookings(supabase, user.id, today);
  if (error) {
    return NextResponse.json({ bookings: [] }, { status: 200 });
  }
  return NextResponse.json({ bookings: data ?? [] });
}
