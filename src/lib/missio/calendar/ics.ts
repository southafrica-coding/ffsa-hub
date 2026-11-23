import { escapeText, toIcsTimestamp } from "@/lib/scheduling/ics";
import { addDays, MISSIO_TIMEZONE } from "./dates";
import { CAMPUS_LABEL, CATEGORY_LABEL, type CalendarEvent } from "./types";

// ============================================================
// Missio subscription feed (RFC 5545, METHOD:PUBLISH)
// ============================================================
// The single-invite generator in src/lib/scheduling/ics.ts sends one
// event by email. This builds the whole calendar for Google, Apple and
// Outlook to poll: a VTIMEZONE for Johannesburg, all-day events as
// VALUE=DATE with an exclusive end, weekly series as RRULE with EXDATE
// for skipped dates, and lines folded at 75 octets.
// ============================================================

export const FEED_PRODID = "-//Missio//Missio Calendar//EN";

const CRLF = "\r\n";

/** Johannesburg has had no daylight saving since 1944: one fixed offset. */
const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  `TZID:${MISSIO_TIMEZONE}`,
  "BEGIN:STANDARD",
  "DTSTART:19700101T000000",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0200",
  "TZNAME:SAST",
  "END:STANDARD",
  "END:VTIMEZONE",
];

/** RFC 5545 §3.1: no line longer than 75 octets; continuation lines start with a space. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
      limit = 74; // the leading space is one octet
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

function text(value: string): string {
  return escapeText(value.replace(/\r\n?/g, "\n"));
}

function dateValue(date: string): string {
  return date.replace(/-/g, "");
}

function localDateTime(date: string, time: string): string {
  return `${dateValue(date)}T${time.replace(":", "")}00`;
}

/** The last moment of `date` in Johannesburg, as UTC (RRULE UNTIL with a TZID start). */
function untilUtc(date: string): string {
  return toIcsTimestamp(`${date}T23:59:59+02:00`);
}

export function eventSummary(event: CalendarEvent): string {
  return event.campus === "all" ? event.title : `${event.title} (${CAMPUS_LABEL[event.campus]})`;
}

function eventDescription(event: CalendarEvent): string {
  const lines = [event.description, event.note, `${CATEGORY_LABEL[event.category]} · ${CAMPUS_LABEL[event.campus]}`];
  return lines.filter((line): line is string => Boolean(line && line.trim())).join("\n");
}

export function eventLines(event: CalendarEvent, uidDomain: string, stamp: string): string[] {
  const lines = ["BEGIN:VEVENT", `UID:${event.id}@${uidDomain}`, `DTSTAMP:${stamp}`];
  if (event.updatedAt) lines.push(`LAST-MODIFIED:${toIcsTimestamp(event.updatedAt)}`);

  const timed = Boolean(event.startTime && event.endTime);
  if (timed) {
    lines.push(`DTSTART;TZID=${MISSIO_TIMEZONE}:${localDateTime(event.startsOn, event.startTime!)}`);
    lines.push(`DTEND;TZID=${MISSIO_TIMEZONE}:${localDateTime(event.endsOn, event.endTime!)}`);
  } else {
    // All day: DTEND is the day after the last day (exclusive).
    lines.push(`DTSTART;VALUE=DATE:${dateValue(event.startsOn)}`);
    lines.push(`DTEND;VALUE=DATE:${dateValue(addDays(event.endsOn, 1))}`);
    lines.push("TRANSP:TRANSPARENT");
  }

  if (event.repeat) {
    const parts = ["FREQ=WEEKLY"];
    if (event.repeat.every > 1) parts.push(`INTERVAL=${event.repeat.every}`);
    if (event.repeat.count != null) parts.push(`COUNT=${event.repeat.count}`);
    else if (event.repeat.until) parts.push(`UNTIL=${timed ? untilUtc(event.repeat.until) : dateValue(event.repeat.until)}`);
    lines.push(`RRULE:${parts.join(";")}`);
    for (const skip of event.skipDates) {
      lines.push(
        timed
          ? `EXDATE;TZID=${MISSIO_TIMEZONE}:${localDateTime(skip, event.startTime!)}`
          : `EXDATE;VALUE=DATE:${dateValue(skip)}`
      );
    }
  }

  lines.push(`SUMMARY:${text(eventSummary(event))}`);
  const description = eventDescription(event);
  if (description) lines.push(`DESCRIPTION:${text(description)}`);
  if (event.location) lines.push(`LOCATION:${text(event.location)}`);
  lines.push(`CATEGORIES:${text(CATEGORY_LABEL[event.category])}`);
  lines.push("STATUS:CONFIRMED", "END:VEVENT");
  return lines;
}

export function buildMissioFeed(input: {
  name: string;
  events: CalendarEvent[];
  /** Host part of each UID, e.g. "missio.ffsahub.com". */
  uidDomain: string;
  now?: Date;
}): string {
  const stamp = toIcsTimestamp((input.now ?? new Date()).toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${FEED_PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${text(input.name)}`,
    `X-WR-TIMEZONE:${MISSIO_TIMEZONE}`,
    "X-WR-CALDESC:Missio church calendar. Read-only; pastors edit it in the Hub.",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
    ...VTIMEZONE,
  ];
  for (const event of input.events) lines.push(...eventLines(event, input.uidDomain, stamp));
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join(CRLF) + CRLF;
}
