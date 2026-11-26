import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { getVehicleAccess } from "@/services/vehicles";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

/** The signed-in user, and whether they manage vehicles or are on this booking
 *  (who booked it, or a driver who is a Hub user). */
export async function rentalAuth(bookingId: string): Promise<
  { ok: true; userId: string; isManager: boolean; isMember: boolean; supabase: Client } | { ok: false; response: NextResponse }
> {
  const supabase: Client = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const access = await getVehicleAccess(supabase, user.id);
  const isManager = !!(access.isAdmin || access.canApprove || access.canManage);
  const { data: b } = await supabase.from("vehicle_bookings").select("requested_by, vehicle_booking_drivers(user_id)").eq("id", bookingId).maybeSingle();
  if (!b && !isManager) return { ok: false, response: NextResponse.json({ error: "Booking not found" }, { status: 404 }) };
  const isMember = !!b && (b.requested_by === user.id || ((b.vehicle_booking_drivers ?? []) as { user_id: string | null }[]).some((d) => d.user_id === user.id));
  return { ok: true, userId: user.id, isManager, isMember, supabase };
}

export const sastToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());
