import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAltVenueOptions } from "@/lib/prayer-room/alt-venue";

// GET — spaces a devo set can move to (Music Room first). Read via the admin
// client: set owners don't necessarily hold a bookings.* permission.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const venues = await getAltVenueOptions(createAdminClient());
  return NextResponse.json(venues.map(({ id, name }) => ({ id, name })));
}
