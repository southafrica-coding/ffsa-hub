import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUpcomingFamilyMilestones } from "@/services/family";

// GET /api/calendar/upcoming — upcoming events for the dashboard ticker:
// the public FFSA Base Calendar (read-only, via a Google Calendar API key)
// MERGED with the signed-in user's own family milestones (anniversary +
// children's birthdays, next ~60 days). Both share the CalendarEvent shape
// so the widget renders them identically.

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

async function fetchGoogleEvents(): Promise<CalendarEvent[]> {
  if (!CALENDAR_ID || !API_KEY) return [];
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
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: GoogleEvent[] };
    return (data.items ?? [])
      .map((e): CalendarEvent | null => {
        const startRaw = e.start?.dateTime ?? e.start?.date;
        if (!startRaw) return null;
        return {
          id: e.id,
          title: e.summary?.trim() || "Untitled event",
          start: startRaw,
          end: e.end?.dateTime ?? e.end?.date ?? null,
          allDay: !e.start?.dateTime,
          location: e.location?.trim() || null,
          htmlLink: e.htmlLink ?? null,
        };
      })
      .filter((e): e is CalendarEvent => e !== null);
  } catch {
    return [];
  }
}

async function fetchFamilyEvents(userId: string): Promise<CalendarEvent[]> {
  try {
    const milestones = await getUpcomingFamilyMilestones(
      createAdminClient(),
      userId,
      60
    );
    return milestones.map((m) => ({
      id: `family-${m.kind}-${m.refId}-${m.dateISO}`,
      title: m.kind === "anniversary" ? `💍 ${m.title}` : `🎂 ${m.title}`,
      start: m.dateISO, // all-day, YYYY-MM-DD
      end: null,
      allDay: true,
      location: null,
      htmlLink: null,
    }));
  } catch {
    return [];
  }
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [google, family] = await Promise.all([
    fetchGoogleEvents(),
    user ? fetchFamilyEvents(user.id) : Promise.resolve([]),
  ]);

  // Merge and order by start; cap so the ticker stays tight.
  const events = [...google, ...family]
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 12);

  return NextResponse.json({
    events,
    configured: !!CALENDAR_ID && !!API_KEY,
    timeZone: TIME_ZONE,
  });
}
