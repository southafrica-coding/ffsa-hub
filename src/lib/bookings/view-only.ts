import type { BookingAccess } from "@/services/bookings";

// Everyone can see the Space Bookings calendar; only ministry leaders,
// school / program leaders and the booking admins can book a room. Someone
// who can look but not book gets a short, neutral note saying so — not an
// error, and no request-access button.

export const VIEW_ONLY_NOTE =
  "You can view all bookings here. Booking a room is available to ministry leaders and school / program leaders.";

/** The write side of the module: any of these lets you add a booking. */
export function canCreateBooking(access: BookingAccess): boolean {
  return access.canRequest || access.canApprove || access.canManage;
}

export function showViewOnlyNote(access: BookingAccess): boolean {
  return access.canView && !canCreateBooking(access);
}
