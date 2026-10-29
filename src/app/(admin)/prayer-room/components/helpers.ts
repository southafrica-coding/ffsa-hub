// Shared client helpers for the Prayer Room UI.

export type Person = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
} | null;

export const ROLES = ["worship_leader", "vocals", "instrument", "prayer_leader"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<string, string> = {
  worship_leader: "Worship Leader",
  vocals: "Vocals / BGV",
  instrument: "Instrument",
  prayer_leader: "Prayer Leader",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

export function displayName(u: Person): string {
  if (!u) return "Unknown";
  return u.first_name || "Unknown";
}

export function fullName(u: Person): string {
  if (!u) return "Unknown";
  const first = u.first_name || "";
  return `${first} ${u.last_name || ""}`.trim() || "Unknown";
}

export const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function toISODate(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** Sunday that begins the week containing `date` (matches the DB convention). */
export function weekStartDate(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay()); // getDay(): 0 = Sunday
  return d;
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** "06:00" from "06:00:00". */
export function formatTime(t: string): string {
  return (t ?? "").slice(0, 5);
}

export function formatTimeRange(start: string, end: string): string {
  return `${formatTime(start)}–${formatTime(end)}`;
}

/** "Sun 22 Jun" from "YYYY-MM-DD". */
export function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${DAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/**
 * Where a set is happening when it ISN'T the prayer room — the alternate space
 * it was booked into, or where a block-out moved it. Null = the prayer room.
 */
export function offSiteLocation(s: { relocation_note?: string | null }): string | null {
  return s.relocation_note?.trim() || null;
}

export const MEMBER_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  on_break: "On a break",
  archived: "Archived",
};

export const APPLICATION_STATUS_LABELS: Record<string, string> = {
  applied: "Applied",
  assigned: "Assigned to evaluator",
  evaluated: "Evaluated",
  approved: "Approved",
  denied: "Not approved",
  withdrawn: "Withdrawn",
};
