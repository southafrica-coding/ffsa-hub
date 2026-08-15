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
import { BookingForm } from "../booking-form";

export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  const defaultDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
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

  if (!(access.canRequest || access.canApprove || access.canManage)) {
    redirect("/bookings/spaces");
  }

  const [venuesRes, ministriesRes, userRes] = await Promise.all([
    getVenues(supabase, { activeOnly: true }),
    getMinistries(supabase, { activeOnly: true }),
    supabase.from("users").select("first_name,last_name").eq("id", user.id).single(),
  ]);

  const venues = (venuesRes.data ?? []) as Venue[];
  const ministries = (ministriesRes.data ?? []) as Ministry[];
  const u = userRes.data as { first_name: string | null; last_name: string | null } | null;
  const defaultRequesterName = u
    ? [u.first_name, u.last_name].filter(Boolean).join(" ")
    : "";

  return (
    <div className="ffsa-screen">
      <Masthead context="Venue scheduling" title="New booking request" />
      <div className="max-w-2xl px-8 py-7">
        <BookingForm
          venues={venues}
          ministries={ministries}
          defaultRequesterName={defaultRequesterName}
          defaultDate={defaultDate}
          canApprove={access.canApprove}
        />
      </div>
    </div>
  );
}
