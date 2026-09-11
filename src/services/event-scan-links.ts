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
 */
const GRACE_DAYS = 14;

function expiryFor(event: { start_date: string; end_date: string | null }): string {
  const base = new Date(`${event.end_date ?? event.start_date}T23:59:59Z`);
  base.setUTCDate(base.getUTCDate() + GRACE_DAYS);
  return base.toISOString();
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

/** Switch the door off without rotating — the link is kept for next time. */
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
