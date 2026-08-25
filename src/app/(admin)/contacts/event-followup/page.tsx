import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  getAccessibleEventIdsForFollowups,
  userCanAccessFollowupQueue,
} from "@/lib/auth/check-followup-access";
import {
  fetchAssignableFollowupHandlers,
  type AssignableFollowupHandler,
} from "@/lib/auth/assignable-followup-handlers";
import { getFollowupQueue } from "@/services/event-followup";
import { ContactsTabsNav } from "../contacts-tabs-nav";
import { FollowupQueue } from "./followup-queue";
import { Masthead, NeedsYou } from "@/components/ffsa";

export default async function EventFollowupPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "contacts");

  // Has the user been given any access to this surface?
  const canAccess = await userCanAccessFollowupQueue(supabase, user.id);
  if (!canAccess) redirect("/contacts");

  const accessibleEventIds = await getAccessibleEventIdsForFollowups(
    supabase,
    user.id
  );

  const queue = await getFollowupQueue(supabase, { accessibleEventIds });

  // Map of event_id → assignable handlers for that event. Built once
  // for every event present in the queue so the drawer dropdowns are
  // populated without per-row fetching.
  const adminSupabase = createAdminClient();
  const uniqueEventIds = Array.from(new Set(queue.map((r) => r.event.id)));
  const handlersByEvent: Record<string, AssignableFollowupHandler[]> = {};
  await Promise.all(
    uniqueEventIds.map(async (eventId) => {
      handlersByEvent[eventId] = await fetchAssignableFollowupHandlers(
        adminSupabase,
        eventId
      );
    })
  );

  const pendingCount = queue.filter(
    (r) => !r.assigned_staff_id || r.is_unread
  ).length;

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`People & relationships \u00b7 ${queue.length} active follow-up${queue.length === 1 ? "" : "s"}`}
        title="Contacts"
      />

      <ContactsTabsNav followupPendingCount={pendingCount} />

      {/* The screen's ONE yellow band: rows nobody has picked up. */}
      {pendingCount > 0 && (
        <NeedsYou>
          {pendingCount === 1
            ? "1 follow-up is unassigned or unread"
            : `${pendingCount} follow-ups are unassigned or unread`}
        </NeedsYou>
      )}

      <div className="px-5 py-6 md:px-8 md:py-7">
        <FollowupQueue
          queue={queue}
          handlersByEvent={handlersByEvent}
          currentUserId={user.id}
        />
      </div>
    </div>
  );
}
