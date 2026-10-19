// Pure helpers for the asset register (frames 45b / 45c / 47e). Everything
// shown as "needs attention" is read off the units themselves, never made up.

import type { EquipmentLiveStatus, EquipmentUnitState } from "@/services/equipment";

type UnitLike = Pick<
  EquipmentUnitState,
  "status" | "live_status" | "serial" | "condition" | "last_checked_on"
>;

/** The sheet writes "Nil" where there is no serial. */
export function hasNoSerial(u: Pick<UnitLike, "serial">): boolean {
  const s = (u.serial ?? "").trim();
  return s === "" || s.toLowerCase() === "nil";
}

/** Still bookable, but the condition notes a fault ("Internal wifi busted"). */
export function hasFault(u: Pick<UnitLike, "status" | "condition">): boolean {
  return u.status === "available" && /busted|fault/i.test(u.condition ?? "");
}

export type ProductSummary = {
  total: number;
  /** Stored status 'available' — the only units that count for booking. */
  bookable: number;
  maintenance: number;
  fault: number;
  noSerial: number;
  out: number;
  reserved: number;
  /** Units never checked on the sheet. */
  never: number;
  /** The oldest check date among the units that were checked. */
  oldestChecked: string | null;
};

export function summariseUnits(units: UnitLike[]): ProductSummary {
  const checked = units
    .map((u) => u.last_checked_on)
    .filter((d): d is string => !!d)
    .sort();
  return {
    total: units.length,
    bookable: units.filter((u) => u.status === "available").length,
    maintenance: units.filter((u) => u.status === "maintenance").length,
    fault: units.filter(hasFault).length,
    noSerial: units.filter(hasNoSerial).length,
    out: units.filter((u) => u.live_status === "out").length,
    reserved: units.filter((u) => u.live_status === "reserved").length,
    never: units.length - checked.length,
    oldestChecked: checked[0] ?? null,
  };
}

/** "5 in maintenance · 1 fault · 2 no serial", or "" when nothing needs a look. */
export function attentionText(s: ProductSummary): string {
  return [
    s.maintenance && `${s.maintenance} in maintenance`,
    s.fault && `${s.fault} fault`,
    s.noSerial && `${s.noSerial} no serial`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function needsAttention(s: ProductSummary): boolean {
  return s.maintenance + s.fault + s.noSerial > 0;
}

/** "30 Apr 2026", "30 Apr 2026 · 2 never", or "Never". */
export function checkedText(s: ProductSummary): string {
  if (!s.oldestChecked) return "Never";
  const d = shortDate(s.oldestChecked);
  return s.never ? `${d} · ${s.never} never` : d;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "30 Apr 2026" from an ISO date or timestamp. Reads the date part as written,
 * so a server in UTC and a phone in SAST print the same day for a date column.
 */
export function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

// en-CA gives YYYY-MM-DD; the month name then comes from MONTHS so every
// date in the module reads the same ("Sep", never "Sept").
const SAST_YMD = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Africa/Johannesburg",
});

/** "30 Apr 2026" for a timestamp, on the South African calendar. */
export function sastDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : shortDate(SAST_YMD.format(d));
}

export const LIVE_STATUS_LABEL: Record<EquipmentLiveStatus, string> = {
  available: "Available",
  reserved: "Reserved",
  out: "Out",
  maintenance: "Maintenance",
  retired: "Retired",
};

/** Plain words for an equipment_events.kind. */
export function eventLabel(kind: string): string {
  const labels: Record<string, string> = {
    imported: "Imported",
    packed: "Packed for an order",
    out: "Handed over",
    returned: "Returned",
    damaged: "Came back damaged",
    missing: "Reported missing",
    repair_opened: "Repair logged",
    repair_closed: "Repair done",
    moved: "Moved",
    edited: "Edited",
    retired: "Retired",
  };
  return labels[kind] ?? kind.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
