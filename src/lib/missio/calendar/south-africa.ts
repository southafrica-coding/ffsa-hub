import { addDays, formatDate } from "./dates";
import type { CalendarEvent } from "./types";

// ============================================================
// South African public holidays and public-school terms, 2026–2028
// ============================================================
// Code constants, never database rows. They show on the Missio calendar
// (category "national") so the year isn't blank, and pastors can hide
// them with the filter. These are national dates: the house-church
// calendar is Missio's own and is added by pastors.
//
// Public holidays
//   https://www.gov.za/about-sa/public-holidays
//   Public Holidays Act 36 of 1994, s2(1): a holiday on a Sunday is
//   observed on the following Monday. Both days are listed, the Monday
//   marked "observed".
//
// School terms (DBE public schools; learner days are the span shown,
// admin and educator days are in the note)
//   2026  Government Gazette 52177, https://www.gov.za/about-sa/school-calendar
//   2027  Government Gazette 52178 (25 Feb 2025). The gov.za HTML page
//         disagreed on terms 3 and 4; the gazette wins.
//   2028  Government Gazette 55619 (23 Oct 2026)
// ============================================================

export type PublicHoliday = { date: string; name: string; observed?: boolean };

export const SA_PUBLIC_HOLIDAYS: Record<2026 | 2027 | 2028, PublicHoliday[]> = {
  2026: [
    { date: "2026-01-01", name: "New Year’s Day" },
    { date: "2026-03-21", name: "Human Rights Day" },
    { date: "2026-04-03", name: "Good Friday" },
    { date: "2026-04-06", name: "Family Day" },
    { date: "2026-04-27", name: "Freedom Day" },
    { date: "2026-05-01", name: "Workers’ Day" },
    { date: "2026-06-16", name: "Youth Day" },
    { date: "2026-08-09", name: "National Women’s Day" },
    { date: "2026-08-10", name: "National Women’s Day", observed: true },
    { date: "2026-09-24", name: "Heritage Day" },
    { date: "2026-12-16", name: "Day of Reconciliation" },
    { date: "2026-12-25", name: "Christmas Day" },
    { date: "2026-12-26", name: "Day of Goodwill" },
  ],
  2027: [
    { date: "2027-01-01", name: "New Year’s Day" },
    { date: "2027-03-21", name: "Human Rights Day" },
    { date: "2027-03-22", name: "Human Rights Day", observed: true },
    { date: "2027-03-26", name: "Good Friday" },
    { date: "2027-03-29", name: "Family Day" },
    { date: "2027-04-27", name: "Freedom Day" },
    { date: "2027-05-01", name: "Workers’ Day" },
    { date: "2027-06-16", name: "Youth Day" },
    { date: "2027-08-09", name: "National Women’s Day" },
    { date: "2027-09-24", name: "Heritage Day" },
    { date: "2027-12-16", name: "Day of Reconciliation" },
    { date: "2027-12-25", name: "Christmas Day" },
    { date: "2027-12-26", name: "Day of Goodwill" },
    { date: "2027-12-27", name: "Day of Goodwill", observed: true },
  ],
  2028: [
    { date: "2028-01-01", name: "New Year’s Day" },
    { date: "2028-03-21", name: "Human Rights Day" },
    { date: "2028-04-14", name: "Good Friday" },
    { date: "2028-04-17", name: "Family Day" },
    { date: "2028-04-27", name: "Freedom Day" },
    { date: "2028-05-01", name: "Workers’ Day" },
    { date: "2028-06-16", name: "Youth Day" },
    { date: "2028-08-09", name: "National Women’s Day" },
    { date: "2028-09-24", name: "Heritage Day" },
    { date: "2028-09-25", name: "Heritage Day", observed: true },
    { date: "2028-12-16", name: "Day of Reconciliation" },
    { date: "2028-12-25", name: "Christmas Day" },
    { date: "2028-12-26", name: "Day of Goodwill" },
  ],
};

export type SchoolTerm = {
  term: 1 | 2 | 3 | 4;
  /** First day for learners. */
  start: string;
  /** Last day for learners. */
  end: string;
  /** Educators and admin start (term 1 only). */
  adminStart?: string;
  /** Last day for educators (term 4 only). */
  educatorsEnd?: string;
};

export const SA_SCHOOL_TERMS: Record<2026 | 2027 | 2028, SchoolTerm[]> = {
  2026: [
    { term: 1, start: "2026-01-14", end: "2026-03-27", adminStart: "2026-01-12" },
    { term: 2, start: "2026-04-08", end: "2026-06-26" },
    { term: 3, start: "2026-07-21", end: "2026-09-23" },
    { term: 4, start: "2026-10-06", end: "2026-12-09", educatorsEnd: "2026-12-11" },
  ],
  2027: [
    { term: 1, start: "2027-01-13", end: "2027-03-19", adminStart: "2027-01-11" },
    { term: 2, start: "2027-04-06", end: "2027-06-25" },
    { term: 3, start: "2027-07-20", end: "2027-09-22" },
    { term: 4, start: "2027-10-05", end: "2027-12-08", educatorsEnd: "2027-12-10" },
  ],
  2028: [
    { term: 1, start: "2028-01-12", end: "2028-03-17", adminStart: "2028-01-10" },
    { term: 2, start: "2028-03-28", end: "2028-06-14" },
    { term: 3, start: "2028-07-11", end: "2028-09-22" },
    { term: 4, start: "2028-10-03", end: "2028-12-06", educatorsEnd: "2028-12-08" },
  ],
};

/** One-day school holidays the gazettes add on top of the public holidays. */
export const SA_SPECIAL_SCHOOL_HOLIDAYS: Record<2026 | 2027 | 2028, string[]> = {
  2026: ["2026-06-15"],
  2027: ["2027-04-26"],
  2028: ["2028-04-28"],
};

export const NATIONAL_YEARS = [2026, 2027, 2028] as const;
export type NationalYear = (typeof NATIONAL_YEARS)[number];

export function hasNationalDates(year: number): year is NationalYear {
  return (NATIONAL_YEARS as readonly number[]).includes(year);
}

function nationalItem(id: string, title: string, startsOn: string, endsOn: string, note: string | null): CalendarEvent {
  return {
    id: `za-${id}`,
    title,
    description: null,
    location: null,
    category: "national",
    campus: "all",
    startsOn,
    endsOn,
    startTime: null,
    endTime: null,
    repeat: null,
    skipDates: [],
    source: "national",
    note,
  };
}

const SCHOOL_NOTE = "National public-school dates (DBE), not a Missio house-church term.";

/**
 * Public holidays, school terms, the breaks between them and the special
 * school holidays for one year, as all-day calendar items. Years without
 * gazetted dates return nothing.
 */
export function nationalEvents(year: number): CalendarEvent[] {
  if (!hasNationalDates(year)) return [];
  const items: CalendarEvent[] = [];

  for (const holiday of SA_PUBLIC_HOLIDAYS[year]) {
    const title = holiday.observed ? `${holiday.name} (observed)` : holiday.name;
    items.push(
      nationalItem(
        `holiday-${holiday.date}`,
        title,
        holiday.date,
        holiday.date,
        holiday.observed ? "Public holiday: the day fell on a Sunday, so Monday is off." : "Public holiday"
      )
    );
  }

  for (const date of SA_SPECIAL_SCHOOL_HOLIDAYS[year]) {
    items.push(nationalItem(`school-day-off-${date}`, "School holiday (schools closed)", date, date, SCHOOL_NOTE));
  }

  const terms = SA_SCHOOL_TERMS[year];
  for (const term of terms) {
    const extra = term.adminStart
      ? `Educators and admin from ${formatDate(term.adminStart, false)}. `
      : term.educatorsEnd
        ? `Educators until ${formatDate(term.educatorsEnd, false)}. `
        : "";
    items.push(nationalItem(`school-term-${year}-${term.term}`, `School term ${term.term}`, term.start, term.end, `${extra}${SCHOOL_NOTE}`));
  }

  // Breaks: from 1 January to term 1, between terms, and from term 4 to
  // the next year's term 1 (or 31 December when that isn't gazetted here).
  const firstStart = terms[0]!.start;
  if (firstStart > `${year}-01-01`) {
    items.push(nationalItem(`school-break-${year}-0`, "School holiday", `${year}-01-01`, addDays(firstStart, -1), SCHOOL_NOTE));
  }
  for (let i = 0; i < terms.length - 1; i += 1) {
    const from = addDays(terms[i]!.end, 1);
    const to = addDays(terms[i + 1]!.start, -1);
    if (from <= to) items.push(nationalItem(`school-break-${year}-${i + 1}`, "School holiday", from, to, SCHOOL_NOTE));
  }
  const lastEnd = addDays(terms[terms.length - 1]!.end, 1);
  if (lastEnd <= `${year}-12-31`) {
    items.push(nationalItem(`school-break-${year}-4`, "School holiday", lastEnd, `${year}-12-31`, SCHOOL_NOTE));
  }

  return items.sort((a, b) => (a.startsOn === b.startsOn ? a.endsOn.localeCompare(b.endsOn) : a.startsOn.localeCompare(b.startsOn)));
}

/** Every gazetted year, for the subscription feed. */
export function allNationalEvents(): CalendarEvent[] {
  return NATIONAL_YEARS.flatMap((year) => nationalEvents(year));
}
