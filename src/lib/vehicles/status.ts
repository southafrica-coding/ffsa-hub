// Vehicle-booking status vocabulary + styling. Mirrors the Space Bookings
// language (green / amber / red / grey) and adds a 5th "completed" state from
// the original BOOKING SYSTEM sheet (Approved / Pending / Denied / Cancelled /
// Completed). Styling is inline so it never depends on a brand CSS class
// existing for the new "completed" hue.

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

/** Solid accent colour — used for left-bars, dots, stat numbers. */
export function statusColor(status: string): string {
  switch (status) {
    case "approved":
      return "hsl(142 55% 52%)";
    case "pending":
      return "hsl(42 95% 58%)";
    case "denied":
      return "hsl(0 70% 62%)";
    case "cancelled":
      return "hsl(30 6% 46%)";
    case "completed":
      return "hsl(199 75% 58%)";
    default:
      return "hsl(30 6% 46%)";
  }
}

/** Inline style for a status pill, tinted by status. */
export function statusPillStyle(status: string): {
  background: string;
  color: string;
  textDecoration?: string;
  opacity?: number;
} {
  switch (status) {
    case "approved":
      return { background: "hsl(142 50% 30% / 0.30)", color: "hsl(142 52% 74%)" };
    case "pending":
      return { background: "hsl(42 95% 55% / 0.15)", color: "hsl(42 90% 70%)" };
    case "denied":
      return {
        background: "hsl(0 70% 52% / 0.15)",
        color: "hsl(0 70% 74%)",
        textDecoration: "line-through",
        opacity: 0.85,
      };
    case "cancelled":
      return {
        background: "hsl(22 8% 16%)",
        color: "hsl(30 6% 52%)",
        textDecoration: "line-through",
        opacity: 0.7,
      };
    case "completed":
      return { background: "hsl(199 70% 32% / 0.28)", color: "hsl(199 75% 74%)" };
    default:
      return { background: "hsl(22 8% 16%)", color: "hsl(30 6% 60%)" };
  }
}
