// Fleet rule types. Field names are the FFSA Fleet app's (vehicles-module/docs/SPEC.md
// section 4), so the rules read exactly like the reference app. The database layer maps
// its snake_case columns onto these shapes (src/lib/fleet/mapping.ts).

export type ISODate = string; // "YYYY-MM-DD"

export type FleetStatus =
  | "In service"
  | "On a trip"
  | "Booked for workshop"
  | "In workshop"
  | "Off the road"
  | "For sale";

export type PointState = "ok" | "mon" | "fix" | "na";
export type InspectionType = "pre" | "post" | "weekly" | "monthly" | "workshop";
export type Sev = "crit" | "warn" | "info";

export interface KmAt {
  date?: ISODate | null;
  km?: number | null;
  provider?: string | null;
}

export interface FollowUp {
  date?: ISODate | null;
  until?: ISODate | null;
  kind?: string | null;
  km?: number | null;
  provider?: string | null;
  recId?: string | null;
}

export interface WatchNote {
  t: string;
  k?: "damage" | "repair" | "issue";
  i?: string;
  d?: ISODate;
}

export interface ConditionEntry {
  s?: PointState;
  d?: ISODate;
  v?: number | string | null;
  n?: string;
  p?: string[];
  i?: string;
  t?: string;
  /** Marked as fixed on the vehicle page, not by an inspection (Gideon, 23 Nov 2026). Not read by the rules. */
  f?: FixRecord;
}

export interface FixRecord {
  /** Who fixed it: a person or a workshop. */
  by: string;
  /** Short description of the work done. */
  work: string;
  /** Who recorded it in the Hub, and when. */
  recordedBy?: string | null;
  recordedAt: string;
  /** What it was before: the result, its date and the inspection it came from. */
  was: { s?: PointState; d?: ISODate; n?: string; i?: string };
}

export interface FleetVehicle {
  id: string;
  name: string;
  reg?: string | null;
  make?: string | null;
  model?: string | null;
  profile?: string | null;
  year?: number | null;
  colour?: string | null;
  fuel?: string | null;
  seats?: number | null;
  status?: FleetStatus | string | null;
  statusSince?: ISODate | null;
  licenceExpiry?: ISODate | null;
  odometer?: number | null;
  odometerDate?: ISODate | null;
  odoPrev?: { km: number; date: ISODate } | null;
  lastService?: KmAt | null;
  lastB2B?: KmAt | null;
  serviceKm?: number | null;
  serviceMonths?: number | null;
  tyres?: string | null;
  where?: string | null;
  watch?: WatchNote[] | null;
  condition?: Record<string, ConditionEntry> | null;
  lastInspection?: { id?: string; date?: ISODate; type?: string; counts?: Record<string, number> } | null;
  lastCheck?: { id?: string; date?: ISODate; type?: string } | null;
  lastMonthly?: { id?: string; date?: ISODate } | null;
  lastPost?: { id?: string; date?: ISODate } | null;
  cardPrinted?: { date?: ISODate; sig?: string; stale?: boolean } | null;
  followUp?: FollowUp | null;
}

/** A trip or rental. In the Hub: an approved vehicle booking. `to` is the day it's back. */
export interface Trip {
  id: string;
  vehicleId: string;
  from: ISODate;
  to: ISODate;
  label?: string | null;
  source?: string | null;
  /** Who made the booking (the 07:00 message shows who has an OUT vehicle). Not read by the rules. */
  who?: string | null;
  /** Fleet 5c: the day the booking was put on hold (its vehicle out of action). Not read by the rules. */
  onHold?: string | null;
}

/** A workshop visit (the app's `records`). */
export interface WorkshopVisit {
  id: string;
  vehicleId: string;
  status: "booked" | "done";
  kind?: string | null;
  date?: ISODate | null;
  until?: ISODate | null;
  provider?: string | null;
  description?: string | null;
  work?: { d?: string; cost?: number; chk?: string }[] | null;
}

export interface ChecklistItem {
  id: string;
  t: string;
  h?: string;
  in?: string[];
  m?: unknown;
}

export interface Checklist {
  sections: { id: string; name: string; items: ChecklistItem[] }[];
}

export interface Schedule {
  days?: number[];
  maxPerDay?: number;
  assign?: Record<string, number>;
  weeklyOnly?: ISODate[];
  budgetHours?: number;
}

export interface Notify {
  coordName?: string;
  coordPhone?: string;
  email?: string;
  slack?: boolean;
}

export interface TimeLogEntry {
  date: ISODate;
  week: ISODate;
  kind: string;
  type?: string;
  vehicleId?: string;
  mins: number;
}

/**
 * Everything the rules read, at one moment. The reference app keeps this in its global
 * state `S`; here it's passed in so every rule is a pure function of (data, today).
 */
export interface FleetData {
  today: ISODate;
  vehicles: FleetVehicle[];
  trips: Trip[];
  /** All workshop visits; the rules use the booked ones as `S.bookings`. */
  visits: WorkshopVisit[];
  checklist: Checklist;
  schedule?: Schedule | null;
  notify?: Notify | null;
  providers?: { name: string }[];
  timelog?: TimeLogEntry[];
}

export interface Alert {
  sev: Sev;
  text: string;
  svc?: boolean;
  booked?: ISODate;
  tab?: "condition" | "manual";
}
