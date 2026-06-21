import Link from "next/link";
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
import { ArrowLeft } from "lucide-react";
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
    <div className="max-w-2xl space-y-6">
      <Link
        href={`/bookings/spaces/${id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to booking
      </Link>
      <div>
        <p className="page-eyebrow">VENUE SCHEDULING</p>
        <h1 className="page-title">Edit booking</h1>
      </div>
      <EditBookingForm
        booking={booking}
        venues={(venuesRes.data ?? []) as Venue[]}
        ministries={(ministriesRes.data ?? []) as Ministry[]}
      />
    </div>
  );
}
