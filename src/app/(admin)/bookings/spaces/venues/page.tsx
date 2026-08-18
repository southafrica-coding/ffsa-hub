import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  getVenues,
  getMinistries,
  getBookingAccess,
  type Venue,
  type Ministry,
} from "@/services/bookings";
import { Masthead } from "@/components/ffsa";
import { VenueAdmin } from "./venue-admin";

export default async function VenuesAdminPage() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) redirect("/login");

  const [, access] = await Promise.all([
    requireModuleAccess(supabase, user.id, "bookings"),
    getBookingAccess(supabase, user.id),
  ]);
  if (!access.canManage) redirect("/bookings/spaces");

  const [venuesRes, ministriesRes] = await Promise.all([
    getVenues(supabase),
    getMinistries(supabase),
  ]);

  return (
    <div className="ffsa-screen">
      <Masthead context="Venue scheduling" title="Spaces & ministries" />
      <div className="max-w-5xl px-5 py-6 md:px-8 md:py-7">
        <VenueAdmin
          venues={(venuesRes.data ?? []) as Venue[]}
          ministries={(ministriesRes.data ?? []) as Ministry[]}
        />
      </div>
    </div>
  );
}
