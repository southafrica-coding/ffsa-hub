import { NextResponse } from "next/server";

// GET /api/calendar/upcoming — next N events from the public FFSA Base Calendar
// (read-only, via a Google Calendar API key restricted to the Calendar API).
// Powers the rotating "Upcoming Events" widget on the dashboard.

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
const API_KEY = process.env.GOOGLE_CALENDAR_API_KEY;
const TIME_ZONE = "Africa/Johannesburg";

export type CalendarEvent = {
  id: string;
  title: string;
  start: string; // ISO datetime, or YYYY-MM-DD for all-day
  end: string | null;
  allDay: boolean;
  location: string | null;
  htmlLink: string | null;
};

type GoogleEvent = {
  id: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

export async function GET() {
  // If the integration isn't configured, return an empty (but successful)
  // payload so the widget can simply render nothing instead of erroring.
  if (!CALENDAR_ID || !API_KEY) {
    return NextResponse.json({ events: [], configured: false });
  }

  const params = new URLSearchParams({
    key: API_KEY,
    timeMin: new Date().toISOString(),
    singleEvents: "true", // expand recurring events into individual instances
    orderBy: "startTime",
    maxResults: "10",
  });
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
    CALENDAR_ID
  )}/events?${params.toString()}`;

  try {
    // Cache for 10 minutes so a busy dashboard doesn't hammer the Calendar API.
    const res = await fetch(url, { next: { revalidate: 600 } });
    if (!res.ok) {
      return NextResponse.json({ events: [], configured: true }, { status: 200 });
    }
    const data = (await res.json()) as { items?: GoogleEvent[] };

    const events: CalendarEvent[] = (data.items ?? [])
      .map((e): CalendarEvent | null => {
        const startRaw = e.start?.dateTime ?? e.start?.date;
        if (!startRaw) return null;
        const allDay = !e.start?.dateTime;
        return {
          id: e.id,
          title: e.summary?.trim() || "Untitled event",
          start: startRaw,
          end: e.end?.dateTime ?? e.end?.date ?? null,
          allDay,
          location: e.location?.trim() || null,
          htmlLink: e.htmlLink ?? null,
        };
      })
      .filter((e): e is CalendarEvent => e !== null);

    return NextResponse.json({ events, configured: true, timeZone: TIME_ZONE });
  } catch {
    return NextResponse.json({ events: [], configured: true }, { status: 200 });
  }
}
