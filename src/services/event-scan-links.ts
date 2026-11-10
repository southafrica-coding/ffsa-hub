// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type EventScanLink = {
  id: string;
  event_id: string;
  token: string;
  is_active: boolean;
  created_at: string;
  rotated_at: string | null;
  expires_at: string | null;
};

/** 24 bytes of URL-safe randomness — the only thing guarding the door page. */
function newScanToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * How long a link outlives its event.
 *
 * A door link is useful the night of, and a liability the week after. Two
 * weeks past the end date covers the multi-day event, the postponement and
 * the organiser who scans stragglers the next morning, then closes itself
 * without anyone having to remember.
 *
 * The close is the end of a calendar day in Africa/Johannesburg (SAST,
 * UTC+2, no daylight saving), not 23:59:59Z. A past event must not mint a
 * link that is already expired: the deadline is the later of event-end +
 * 14 days and today + 14 days, both in that calendar.
 */
const GRACE_DAYS = 14;
const JOHANNESBURG = "Africa/Johannesburg";
/** SAST is UTC+2 all year. 23:59:59 there is 21:59:59Z. */
const JOHANNESBURG_OFFSET = "+02:00";

function addCalendarDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  const yyyy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function johannesburgDay(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: JOHANNESBURG,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function expiryFor(
  event: { start_date: string; end_date: string | null },
  now: Date = new Date()
): string {
  const eventDay = (event.end_date ?? event.start_date).slice(0, 10);
  const fromEvent = addCalendarDays(eventDay, GRACE_DAYS);
  const fromNow = addCalendarDays(johannesburgDay(now), GRACE_DAYS);
  const day = fromEvent > fromNow ? fromEvent : fromNow;
  return new Date(`${day}T23:59:59${JOHANNESBURG_OFFSET}`).toISOString();
}

/**
 * The event's current door link, minting one on first ask.
 *
 * One standing token per event rather than one per volunteer: the organiser
 * pastes the same URL into their team's group chat, which is how door teams
 * actually get assembled. The trade is that revoking one person means
 * rotating for everybody — see rotateScanLink.
 */
export async function getOrCreateScanLink(
  admin: Client,
  eventId: string,
  userId: string
): Promise<EventScanLink | null> {
  const { data: existing } = await admin
    .from("event_scan_links")
    .select("*")
    .eq("event_id", eventId)
    .eq("is_active", true)
    .maybeSingle();
  if (existing) return existing as EventScanLink;

  const { data: event } = await admin
    .from("events")
    .select("start_date, end_date")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return null;

  const { data } = await admin
    .from("event_scan_links")
    .insert({
      event_id: eventId,
      token: newScanToken(),
      created_by: userId,
      expires_at: expiryFor(event),
    })
    .select()
    .single();
  return (data as EventScanLink) ?? null;
}

/** Retire this event's link and mint a new one. Every old URL dies at once. */
export async function rotateScanLink(
  admin: Client,
  eventId: string,
  userId: string
): Promise<EventScanLink | null> {
  await admin
    .from("event_scan_links")
    .update({ is_active: false, rotated_at: new Date().toISOString() })
    .eq("event_id", eventId)
    .eq("is_active", true);
  return getOrCreateScanLink(admin, eventId, userId);
}

/**
 * Switch the door off without rotating — the link is kept for next time.
 *
 * Turning it back on does not refresh expires_at. A link that has already
 * passed its expiry stays dead until someone replaces it, which mints a
 * new row. Extending the old token here would revive a URL that had
 * already stopped working.
 */
export async function setScanLinkActive(
  admin: Client,
  eventId: string,
  isActive: boolean
): Promise<void> {
  if (isActive) {
    // Re-open the most recently retired link for this event.
    const { data: last } = await admin
      .from("event_scan_links")
      .select("id")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last) {
      await admin
        .from("event_scan_links")
        .update({ is_active: true })
        .eq("id", last.id);
    }
    return;
  }
  await admin
    .from("event_scan_links")
    .update({ is_active: false })
    .eq("event_id", eventId)
    .eq("is_active", true);
}

export type ResolvedScanLink = EventScanLink & {
  event: { id: string; title: string; start_date: string };
};

/**
 * Is this token a live door link? Service-role only — never exposed to anon.
 *
 * Expiry is checked here rather than by a cron: a link that has aged out
 * should stop working the moment it ages out, whether or not a job ran.
 */
export async function resolveScanLink(
  admin: Client,
  token: string
): Promise<ResolvedScanLink | null> {
  if (!token || token.length < 16) return null;
  const { data } = await admin
    .from("event_scan_links")
    .select("*, events(id, title, start_date)")
    .eq("token", token)
    .eq("is_active", true)
    .maybeSingle();
  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const event = (data as any).events;
  if (!event) return null;
  return { ...(data as EventScanLink), event };
}
