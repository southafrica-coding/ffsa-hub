import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  getBookingById,
  getVenues,
  getMinistries,
  getBookingAccess,
  type Venue,
  type Ministry,
} from "@/services/bookings";
import { Masthead } from "@/components/ffsa";
import { EditBookingForm } from "../../edit-booking-form";

export default async function EditBookingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) redirect("/login");

  const [, access, bookingRes] = await Promise.all([
    requireModuleAccess(supabase, user.id, "bookings"),
    getBookingAccess(supabase, user.id),
    getBookingById(supabase, id),
  ]);

  const booking = bookingRes.data;
  if (bookingRes.error || !booking) notFound();

  const isOwner = booking.requested_by === user.id;
  const canEdit =
    access.isAdmin || access.canManage || access.canApprove || isOwner;
  if (!canEdit) redirect(`/bookings/spaces/${id}`);

  const [venuesRes, ministriesRes] = await Promise.all([
    getVenues(supabase, { activeOnly: true }),
    getMinistries(supabase, { activeOnly: true }),
  ]);

  return (
    <div className="ffsa-screen">
      <Masthead context="Venue scheduling" title="Edit booking" />
      <div className="max-w-2xl px-8 py-7">
        <EditBookingForm
          booking={booking}
          venues={(venuesRes.data ?? []) as Venue[]}
          ministries={(ministriesRes.data ?? []) as Ministry[]}
        />
      </div>
    </div>
  );
}
