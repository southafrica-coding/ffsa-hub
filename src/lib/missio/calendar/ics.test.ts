import { describe, expect, it } from "vitest";
import { buildIcsInvite } from "@/lib/scheduling/ics";
import { buildMissioFeed, foldLine } from "./ics";
import { nationalEvents } from "./south-africa";
import type { CalendarEvent } from "./types";

const event = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: "11111111-1111-4111-8111-111111111111",
  title: "Sunday gathering",
  description: null,
  location: null,
  category: "sundays",
  campus: "all",
  startsOn: "2026-11-29",
  endsOn: "2026-11-29",
  startTime: "09:00",
  endTime: "11:00",
  repeat: null,
  skipDates: [],
  source: "missio",
  updatedAt: "2026-11-23T10:00:00.000Z",
  ...over,
});

const NOW = new Date("2026-11-23T13:08:00Z");
const feed = (events: CalendarEvent[]) => buildMissioFeed({ name: "Missio", events, uidDomain: "missio.ffsahub", now: NOW });
/** Unfolded lines of the one VEVENT for `id`. */
function vevent(text: string, id: string): string[] {
  const lines = text.replace(/\r\n /g, "").split("\r\n");
  const start = lines.findIndex((line) => line === `UID:${id}@missio.ffsahub`);
  const end = lines.indexOf("END:VEVENT", start);
  return lines.slice(start, end);
}

describe("buildMissioFeed", () => {
  it("is a PUBLISH calendar named Missio with a Johannesburg VTIMEZONE and CRLF lines", () => {
    const text = feed([]);
    expect(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Missio//Missio Calendar//EN\r\n")).toBe(true);
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(text).toContain("\r\nMETHOD:PUBLISH\r\n");
    expect(text).toContain("\r\nX-WR-CALNAME:Missio\r\n");
    expect(text).toContain("BEGIN:VTIMEZONE\r\nTZID:Africa/Johannesburg\r\n");
    expect(text).toContain("TZOFFSETTO:+0200");
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
    expect(text).not.toContain("METHOD:REQUEST");
  });

  it("writes timed events in Johannesburg time with TZID", () => {
    const lines = vevent(feed([event({})]), "11111111-1111-4111-8111-111111111111");
    expect(lines).toContain("DTSTART;TZID=Africa/Johannesburg:20261129T090000");
    expect(lines).toContain("DTEND;TZID=Africa/Johannesburg:20261129T110000");
    expect(lines).toContain("DTSTAMP:20261123T130800Z");
    expect(lines).toContain("LAST-MODIFIED:20261123T100000Z");
    expect(lines).toContain("SUMMARY:Sunday gathering");
  });

  it("writes all-day events as VALUE=DATE with an exclusive end", () => {
    const one = vevent(feed([event({ startTime: null, endTime: null })]), "11111111-1111-4111-8111-111111111111");
    expect(one).toContain("DTSTART;VALUE=DATE:20261129");
    expect(one).toContain("DTEND;VALUE=DATE:20261130");
    const camp = vevent(
      feed([event({ startsOn: "2026-12-30", endsOn: "2027-01-02", startTime: null, endTime: null })]),
      "11111111-1111-4111-8111-111111111111"
    );
    expect(camp).toContain("DTSTART;VALUE=DATE:20261230");
    expect(camp).toContain("DTEND;VALUE=DATE:20270103");
  });

  it("writes a weekly series as RRULE with EXDATE for skipped dates", () => {
    const timed = vevent(
      feed([event({ repeat: { every: 2, until: "2027-06-27", count: null }, skipDates: ["2026-12-27"] })]),
      "11111111-1111-4111-8111-111111111111"
    );
    expect(timed).toContain("RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20270627T215959Z");
    expect(timed).toContain("EXDATE;TZID=Africa/Johannesburg:20261227T090000");
    const allDay = vevent(
      feed([event({ startTime: null, endTime: null, repeat: { every: 1, until: null, count: 10 }, skipDates: ["2026-12-27"] })]),
      "11111111-1111-4111-8111-111111111111"
    );
    expect(allDay).toContain("RRULE:FREQ=WEEKLY;COUNT=10");
    expect(allDay).toContain("EXDATE;VALUE=DATE:20261227");
    const dateUntil = vevent(
      feed([event({ startTime: null, endTime: null, repeat: { every: 1, until: "2027-01-31", count: null } })]),
      "11111111-1111-4111-8111-111111111111"
    );
    expect(dateUntil).toContain("RRULE:FREQ=WEEKLY;UNTIL=20270131");
  });

  it("names the campus when it isn't both, and escapes text", () => {
    const lines = vevent(
      feed([event({ campus: "potch", title: "Leaders; prayer, worship", description: "Bring a Bible\nand a friend", location: "Hall, Potch" })]),
      "11111111-1111-4111-8111-111111111111"
    );
    expect(lines).toContain(String.raw`SUMMARY:Leaders\; prayer\, worship (Potch)`);
    expect(lines.find((line) => line.startsWith("DESCRIPTION:"))).toBe(
      "DESCRIPTION:Bring a Bible\\nand a friend\\nSundays & special services · Potch"
    );
    expect(lines).toContain("LOCATION:Hall\\, Potch");
  });

  it("folds every line to 75 octets, multi-byte characters intact", () => {
    const long = "Outreach — ".repeat(20);
    const text = feed([event({ title: long, description: "é".repeat(120) })]);
    for (const line of text.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(text.replace(/\r\n /g, "")).toContain(`SUMMARY:${long}`);
    expect(foldLine("short")).toBe("short");
  });

  it("includes national dates as all-day items with stable UIDs", () => {
    const text = feed(nationalEvents(2026));
    const lines = vevent(text, "za-holiday-2026-08-10");
    expect(lines).toContain("SUMMARY:National Women’s Day (observed)");
    expect(lines).toContain("DTSTART;VALUE=DATE:20260810");
    expect(lines).toContain("DTEND;VALUE=DATE:20260811");
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(nationalEvents(2026).length);
  });

  it("leaves the scheduling invite generator as it was", () => {
    const invite = buildIcsInvite({
      uid: "x@ffsa",
      summary: "Interview",
      starts_at: "2026-11-23T08:00:00Z",
      ends_at: "2026-11-23T08:30:00Z",
      organizer: { name: "FFSA", email: "noreply@example.org" },
      attendee: { name: "A", email: "a@example.org" },
    });
    expect(invite).toContain("METHOD:REQUEST");
    expect(invite).toContain("DTSTART:20261123T080000Z");
  });
});
