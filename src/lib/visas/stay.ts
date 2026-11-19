// Visa stay rules: pure functions, no I/O.
//
// A visa covers exactly the time a student is at FFSA's schools: from the
// arrival day of their first school to the departure day of their last
// (see the FFSA Visa Process Guide, "How long the visa covers"). Every
// date here is an ISO calendar date string ("YYYY-MM-DD") and all maths is
// done in UTC days, so no time zone can shift a date by one.

export type IsoDate = string;

/** One school (or FFX segment) a case covers. */
export interface SchoolDates {
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  /** Arrival day, when it differs from the start (billing_courses.arrival_date). */
  arrivalDate?: IsoDate | null;
  /** Departure day, when it differs from the end. Not stored anywhere yet. */
  departureDate?: IsoDate | null;
}

export interface Stay {
  from: IsoDate;
  to: IsoDate;
  /** Days in South Africa, counting both the arrival and the departure day. */
  days: number;
}

/** Up to this many days is a short stay (visitor's visa or exemption). */
export const SHORT_STAY_MAX_DAYS = 90;
/** A stay this close to the exempt limit is flagged for a decision. */
export const NEAR_LIMIT_DAYS = 7;
/** Passports must stay valid this long after the last departure day. */
export const PASSPORT_MARGIN_DAYS = 30;
/** Default buffer between lodging and the embassy's usual decision. */
export const LODGE_MARGIN_DAYS = 14;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function toDay(d: IsoDate): number {
  if (!ISO.test(d)) throw new Error(`Not an ISO date: ${d}`);
  const t = Date.parse(`${d}T00:00:00Z`);
  if (Number.isNaN(t)) throw new Error(`Not a valid date: ${d}`);
  return Math.round(t / DAY_MS);
}

function fromDay(n: number): IsoDate {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(d: IsoDate, n: number): IsoDate {
  return fromDay(toDay(d) + n);
}

/** Calendar months, clamped to the month's last day (31 Jan + 1 → 28/29 Feb). */
export function addMonths(d: IsoDate, n: number): IsoDate {
  const [y, m, day] = d.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return fromDay(Math.round(Date.UTC(ny, nm, Math.min(day, last)) / DAY_MS));
}

/** Days between two dates, counting both ends. */
export function daysInclusive(from: IsoDate, to: IsoDate): number {
  return toDay(to) - toDay(from) + 1;
}

/**
 * The stay a case covers: earliest arrival (or start) to latest departure
 * (or end) across its schools. Null when no school has both dates yet.
 */
export function computeStay(schools: SchoolDates[]): Stay | null {
  let from: number | null = null;
  let to: number | null = null;
  for (const s of schools) {
    const arrive = s.arrivalDate ?? s.startDate;
    const leave = s.departureDate ?? s.endDate;
    if (!arrive || !leave) continue;
    const a = toDay(arrive);
    const l = toDay(leave);
    if (l < a) throw new Error(`School leaves (${leave}) before it arrives (${arrive})`);
    from = from === null ? a : Math.min(from, a);
    to = to === null ? l : Math.max(to, l);
  }
  if (from === null || to === null) return null;
  return { from: fromDay(from), to: fromDay(to), days: to - from + 1 };
}

export type VisaType = "exempt" | "visitor" | "volunteer";

export interface VisaNeed {
  needed: boolean;
  type: VisaType;
  /** The stay is within NEAR_LIMIT_DAYS of the exempt limit (either side). */
  nearLimit: boolean;
}

/**
 * Which visa a stay needs, given the passport's exempt days (0, 30 or 90;
 * from visa_country_rules). Over 90 days always needs the visitor's visa
 * for voluntary activities, exemption or not. DRAFT rule, legal to confirm.
 */
export function visaNeed(stayDays: number, exemptDays: number): VisaNeed {
  const nearLimit = exemptDays > 0 && Math.abs(stayDays - exemptDays) <= NEAR_LIMIT_DAYS;
  if (stayDays > SHORT_STAY_MAX_DAYS) return { needed: true, type: "volunteer", nearLimit };
  if (stayDays <= exemptDays) return { needed: false, type: "exempt", nearLimit };
  return { needed: true, type: "visitor", nearLimit };
}

export interface Deadlines {
  lodgeBy: IsoDate;
  startDocumentsBy: IsoDate;
}

/**
 * Work back from the arrival day: lodge by = arrival − embassy processing
 * time − margin; start documents by = lodge by − the slowest document's
 * lead time. Null when the embassy's processing time isn't known yet.
 */
export function deadlines(
  arrival: IsoDate,
  processingWeeks: number | null,
  slowestLeadWeeks: number,
  marginDays: number = LODGE_MARGIN_DAYS
): Deadlines | null {
  if (processingWeeks == null) return null;
  const lodgeBy = addDays(arrival, -(processingWeeks * 7 + marginDays));
  return { lodgeBy, startDocumentsBy: addDays(lodgeBy, -(slowestLeadWeeks * 7)) };
}

/** Too old by the given day (e.g. the lodge-by date)? Null age limit = never. */
export function isTooOld(issuedOn: IsoDate, maxAgeMonths: number | null, onDay: IsoDate): boolean {
  if (maxAgeMonths == null) return false;
  return toDay(addMonths(issuedOn, maxAgeMonths)) < toDay(onDay);
}

/** Passport valid at least PASSPORT_MARGIN_DAYS after the last departure day? */
export function passportValidForStay(passportExpiry: IsoDate, stayTo: IsoDate): boolean {
  return toDay(passportExpiry) >= toDay(stayTo) + PASSPORT_MARGIN_DAYS;
}

export interface DocumentRequirement {
  code: string;
  needed_up_to_90: boolean;
  needed_over_90: boolean;
  is_active: boolean;
}

/** The checklist for a stay: short list up to 90 days, long list beyond. */
export function requiredDocuments<T extends DocumentRequirement>(types: T[], stayDays: number): T[] {
  const long = stayDays > SHORT_STAY_MAX_DAYS;
  return types.filter((t) => t.is_active && (long ? t.needed_over_90 : t.needed_up_to_90));
}
