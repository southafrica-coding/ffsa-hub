import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  getSeriesById,
  getSeriesOccurrences,
  getVenues,
  getMinistries,
  getBookingAccess,
  type Venue,
  type Ministry,
  type BookingSeries,
  type Booking,
} from "@/services/bookings";
import { Masthead } from "@/components/ffsa";
import { callerLeadsBookingMinistry } from "@/lib/auth/check-ministry-access";
import { SeriesEditForm } from "../series-edit-form";

export default async function EditSeriesPage({
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

  const [, access, seriesRes] = await Promise.all([
    requireModuleAccess(supabase, user.id, "bookings"),
    getBookingAccess(supabase, user.id),
    getSeriesById(supabase, id),
  ]);

  const series = seriesRes.data as BookingSeries | null;
  if (seriesRes.error || !series) notFound();

  // Same gate the API enforces: the person who set the series up, anyone
  // who looks after spaces, or an active leader of the linked ministry.
  const isMinistryLeader = await callerLeadsBookingMinistry(
    supabase,
    user.id,
    series.ministry?.staff_ministry_id
  );
  const canEdit =
    access.isAdmin ||
    access.canManage ||
    access.canApprove ||
    series.created_by === user.id ||
    isMinistryLeader;
  if (!canEdit) redirect("/bookings/spaces");

  const [venuesRes, ministriesRes, occRes] = await Promise.all([
    getVenues(supabase, { activeOnly: true }),
    getMinistries(supabase, { activeOnly: true }),
    getSeriesOccurrences(supabase, id),
  ]);

  return (
    <div className="ffsa-screen">
      <Masthead context="Venue scheduling" title="Edit weekly series" />
      <div className="max-w-2xl px-5 py-6 md:px-8 md:py-7">
        <SeriesEditForm
          series={series}
          occurrences={(occRes.data ?? []) as Booking[]}
          venues={(venuesRes.data ?? []) as Venue[]}
          ministries={(ministriesRes.data ?? []) as Ministry[]}
          canApprove={access.canApprove || access.isAdmin || access.canManage}
        />
      </div>
    </div>
  );
}
