import type { SupabaseClient } from "@supabase/supabase-js";
import { ASSIGNABLE_FOLLOWUP_HANDLER_PERMISSION_KEY } from "./assignable-followup-handlers";
import {
  ATTENDANCE_GATE,
  REGISTRATIONS_GATE,
  eventIdScope,
  hasEventPermission,
  isUnscopedAdmin,
  hasUnscopedRole,
  loadEventAccess,
  type EventAccessSnapshot,
} from "@/lib/auth/event-access";

// Permission keys that grant queue access across all events. Anyone managing
// registrations or attendance is already doing the operational work that
// follow-ups represent, so they see the full queue.
const ALL_EVENTS_FOLLOWUP_KEYS = [
  "events.manage_registrations",
  "events.manage_attendance",
] as const;

function followupScope(snap: EventAccessSnapshot) {
  if (isUnscopedAdmin(snap) || hasUnscopedRole(snap, ["events_admin"])) return "all" as const;
  const regs = eventIdScope(snap, REGISTRATIONS_GATE);
  const door = eventIdScope(snap, ATTENDANCE_GATE);
  if (regs.kind === "all" || door.kind === "all") return "all" as const;
  const ids = new Set<string>([...regs.ids, ...door.ids]);
  if (snap.active) {
    for (const g of snap.grants) {
      if (g.via !== "direct") continue;
      if (g.key !== ASSIGNABLE_FOLLOWUP_HANDLER_PERMISSION_KEY) continue;
      if (g.scopeType === "event" && g.scopeId) ids.add(g.scopeId);
    }
  }
  return ids;
}

// Can the user view/operate on the event follow-up queue at all?
// Unscoped admin / events_admin, or an unscoped manage_registrations /
// manage_attendance grant, see every event. A grant scoped to one event
// opens only that event. The handler permission stays a direct, per-event
// grant.
export async function userCanAccessFollowupQueue(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const scope = followupScope(await loadEventAccess(supabase, userId));
  return scope === "all" || scope.size > 0;
}

// Per-event check used by row actions (assign, mark finished, view).
// Unscoped admin / events_admin pass. manage_registrations and
// manage_attendance follow has_event_permission (unscoped, this event, or
// the creator arm). Otherwise the handler permission must be a direct
// grant scoped to this event.
export async function userCanHandleFollowupForEvent(
  supabase: SupabaseClient,
  userId: string,
  eventId: string
): Promise<boolean> {
  const snap = await loadEventAccess(supabase, userId);
  if (isUnscopedAdmin(snap) || hasUnscopedRole(snap, ["events_admin"])) return true;
  const { data: event } = await supabase.from("events").select("created_by").eq("id", eventId).maybeSingle();
  const createdByCaller = event?.created_by === userId;
  if (
    ALL_EVENTS_FOLLOWUP_KEYS.some((key) =>
      hasEventPermission(snap, key, eventId, { createdByCaller })
    )
  ) {
    return true;
  }
  return snap.grants.some(
    (g) =>
      g.via === "direct" &&
      g.key === ASSIGNABLE_FOLLOWUP_HANDLER_PERMISSION_KEY &&
      g.scopeType === "event" &&
      g.scopeId === eventId
  );
}

// Returns the set of event IDs the user is permitted to handle.
// Null means every event: unscoped admin / events_admin, or an unscoped
// manage_registrations / manage_attendance / handler grant. A scoped grant
// returns only those event ids.
export async function getAccessibleEventIdsForFollowups(
  supabase: SupabaseClient,
  userId: string
): Promise<Set<string> | null> {
  const scope = followupScope(await loadEventAccess(supabase, userId));
  return scope === "all" ? null : scope;
}
