import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { getEventById } from "@/services/events";
import { canManageEvent, ATTENDANCE_GATE } from "@/lib/auth/event-access";
import { Scanner } from "@/components/ticket-scanner";
import { Masthead } from "@/components/ffsa";

export const dynamic = "force-dynamic";

export default async function CheckInPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await canManageEvent(supabase, user.id, ATTENDANCE_GATE.keys, id, ATTENDANCE_GATE))) {
    return (
      <div className="ffsa-screen">
        <p className="px-5 py-8 text-sm text-destructive md:px-8">
          You don&apos;t have permission to check tickets in for this event.
        </p>
      </div>
    );
  }

  const { data: event } = await getEventById(supabase, id);
  if (!event) notFound();

  return (
    <div className="ffsa-screen">
      <Masthead context={event.title} title="Check-in" />
      {/* Tight gutters on a phone — the viewfinder wants the width. */}
      <div className="mx-auto max-w-2xl px-3 py-4 md:px-8 md:py-7">
        <Scanner endpoint={`/api/events/${id}/check-in`} />
      </div>
    </div>
  );
}
