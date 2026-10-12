// Minimal iCalendar (RFC 5545) generator for scheduling-confirmation
// emails. Hand-rolled — no dependency on an external ICS library since
// our needs are simple (single VEVENT with organizer + one attendee).
//
// Timestamps are emitted in UTC (YYYYMMDDTHHMMSSZ format). Strings are
// CRLF-joined per spec. Long lines aren't folded — single VEVENT under
// the 75-octet limit is fine for our short summaries.

export type IcsEventInput = {
  uid: string;
  summary: string;
  description?: string | null;
  starts_at: string; // ISO 8601
  ends_at: string;
  organizer: { name: string; email: string };
  attendee: { name: string; email: string };
  location?: string | null;
  url?: string | null;
};

function toIcsTimestamp(iso: string): string {
  // ISO → YYYYMMDDTHHMMSSZ (UTC)
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    String(d.getUTCFullYear()) +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function escapeText(s: string): string {
  // RFC 5545 §3.3.11 — backslashes, commas, semicolons, newlines need escaping
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export function buildIcsInvite(input: IcsEventInput): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FFSA Hub//Scheduling//EN",
    "METHOD:REQUEST",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${toIcsTimestamp(new Date().toISOString())}`,
    `DTSTART:${toIcsTimestamp(input.starts_at)}`,
    `DTEND:${toIcsTimestamp(input.ends_at)}`,
    `SUMMARY:${escapeText(input.summary)}`,
    `ORGANIZER;CN=${escapeText(input.organizer.name)}:mailto:${input.organizer.email}`,
    `ATTENDEE;CN=${escapeText(input.attendee.name)};RSVP=TRUE;PARTSTAT=NEEDS-ACTION:mailto:${input.attendee.email}`,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
  ];

  if (input.description) {
    lines.push(`DESCRIPTION:${escapeText(input.description)}`);
  }
  if (input.location) {
    lines.push(`LOCATION:${escapeText(input.location)}`);
  }
  if (input.url) {
    lines.push(`URL:${input.url}`);
  }

  lines.push("END:VEVENT", "END:VCALENDAR");

  // ICS spec mandates CRLF
  return lines.join("\r\n");
}

/**
 * Encode an ICS string into a base64 payload suitable for an email
 * attachment's content field.
 */
export function icsToBase64(ics: string): string {
  return Buffer.from(ics, "utf-8").toString("base64");
}
