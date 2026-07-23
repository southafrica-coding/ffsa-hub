import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { getEventById } from "@/services/events";
import { canManageEvents } from "@/lib/api-auth";
import { Scanner } from "./scanner";

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
      <div className="p-6 text-center text-sm text-red-600">
        You don't have permission to check tickets in for this event.
      </div>
    );
  }

  const { data: event } = await getEventById(supabase, id);
  if (!event) notFound();

  return (
    <div className="space-y-6 max-w-2xl mx-auto p-6">
      <div>
        <h1 className="page-title mt-2">Check-in</h1>
        <p className="text-sm text-muted-foreground mt-1">{event.title}</p>
      </div>
      <Scanner eventId={id} eventTitle={event.title} />
    </div>
  );
}
