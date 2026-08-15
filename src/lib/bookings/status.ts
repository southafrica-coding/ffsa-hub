// Shared booking-status vocabulary, mirroring the green / amber / red language
// of the original spreadsheet.
//
// Colour lives with the design system now: screens map a status to a
// StatusPill tone. The dark-theme colour helpers that used to sit here were
// removed with the editorial-light redesign.

export const BOOKING_STATUSES = [
  "pending",
  "approved",
  "denied",
  "cancelled",
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

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
    default:
      return status;
  }
}



