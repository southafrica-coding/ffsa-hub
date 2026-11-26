// Small display helpers shared by the visa screens.

import type { Tone } from "@/components/ffsa";
import type { VisaStatus, VisaWaitingOn } from "./status";

export function personName(u: { first_name?: string | null; last_name?: string | null; preferred_name?: string | null } | undefined) {
  if (!u) return "Student";
  const first = u.preferred_name || u.first_name || "";
  const name = `${first} ${u.last_name ?? ""}`.trim();
  return name || "Student";
}

export const WAITING_LABEL: Record<VisaWaitingOn, string> = {
  student: "Student",
  school_leader: "School leader",
  legal: "Legal",
  embassy: "Embassy",
  nobody: "Nobody",
};

export function statusTone(status: VisaStatus): Tone {
  switch (status) {
    case "approved":
    case "granted":
    case "exempt":
    case "arrived":
      return "good";
    case "sent_back":
    case "awaiting_legal":
      return "warn";
    case "refused":
      return "bad";
    default:
      return "quiet";
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "10 Jan 2027" from "2027-01-10"; "—" for null. No time zone involved. */
export function formatDay(d: string | null | undefined): string {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  if (!y || !m || !day) return "—";
  return `${day} ${MONTHS[m - 1]} ${y}`;
}

/** Whole days from today (UTC calendar) to d; negative when past. */
export function daysUntil(d: string, today: string = new Date().toISOString().slice(0, 10)): number {
  return Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}
