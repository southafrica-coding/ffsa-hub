// ────────────────────────────────────────────────────────────
// Push at the write points the dashboard feed already derives items from
// ────────────────────────────────────────────────────────────
// Each function mirrors one provider in src/services/notifications.ts (same
// recipients, same stable key) and is meant to run inside after(), once the
// response has gone. None of them throws: any failure is logged and dropped,
// so the route that called it behaves exactly as before.
// ────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import { bookingApproverIds } from "./recipients";
import { sendPush } from "./send";

type BookingForKey = {
  series_id?: string | null;
  title?: string | null;
  venue_id?: string | null;
  start_time?: string | null;
  end_time?: string | null;
};

/** Same key as bookingDecisionNotifs: "booking-decision:<group>:<status>". */
export function bookingDecisionKey(b: BookingForKey, status: string): string {
  const group = b.series_id
    ? `s:${b.series_id}`
    : `sig:${b.title}|${b.venue_id}|${b.start_time}|${b.end_time}`;
  return `booking-decision:${group}:${status}`;
}

/** A booking (or series) was approved or declined → tell whoever asked. */
export async function notifyBookingDecision(args: {
  booking: BookingForKey & { requested_by?: string | null };
  status: "approved" | "denied";
  deciderId: string;
}): Promise<void> {
  try {
    const requester = args.booking.requested_by;
    // Nobody to tell, or they decided their own request.
    if (!requester || requester === args.deciderId) return;
    await sendPush([requester], {
      kind: "booking_decision",
      key: bookingDecisionKey(args.booking, args.status),
      href: "/bookings",
    });
  } catch (err) {
    console.warn("[push] booking decision notify failed", err instanceof Error ? err.name : "error");
  }
}

/** A new booking request is pending → tell the approvers (not the requester). */
export async function notifyNewBookingRequest(args: {
  requesterId: string;
  bookingId?: string | null;
  seriesId?: string | null;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const approvers = (await bookingApproverIds(admin)).filter((id) => id !== args.requesterId);
    if (approvers.length === 0) return;
    await sendPush(
      approvers,
      {
        kind: "booking_request",
        // One-off: the feed's own key. A weekly series has one feed item per
        // occurrence, so the push carries the series instead.
        key: args.bookingId ? `booking:${args.bookingId}` : `booking-series:${args.seriesId ?? ""}`,
        href: "/bookings/requests",
      },
      { admin }
    );
  } catch (err) {
    console.warn("[push] booking request notify failed", err instanceof Error ? err.name : "error");
  }
}
