import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { getEventById } from "@/services/events";
import { canManageEvents } from "@/lib/api-auth";
import { Scanner } from "./scanner";
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
  if (!(await canManageEvents(supabase, user.id, ["events.manage_attendance"]))) {
    return (
      <div className="p-6 text-center text-sm text-destructive">
        You don&apos;t have permission to check tickets in for this event.
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
        <Scanner eventId={id} />
      </div>
    </div>
  );
}
