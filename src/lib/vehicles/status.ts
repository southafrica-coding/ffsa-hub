// Vehicle-booking status vocabulary. Mirrors the Space Bookings language and
// adds a 5th "completed" state from the original BOOKING SYSTEM sheet
// (Approved / Pending / Denied / Cancelled / Completed).
//
// Colour lives with the design system now: screens map a status to a
// StatusPill tone. The dark-theme colour helpers that used to sit here were
// removed with the editorial-light redesign.

export const VEHICLE_STATUSES = [
  "pending",
  "approved",
  "denied",
  "cancelled",
  "completed",
] as const;

export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export function statusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "approved":
      return "Approved";
    case "denied":
      return "Denied";
    case "cancelled":
      return "Cancelled";
    case "completed":
      return "Completed";
    default:
      return status;
  }
}


