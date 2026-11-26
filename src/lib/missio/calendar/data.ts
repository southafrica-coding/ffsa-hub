import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { OrgAccess } from "@/lib/missio/access";
import { requireAvailabilityTokenSecret } from "@/lib/missio/availability/token";
import { calendarFeedPath, calendarWebPath, type CalendarShare } from "./share-links";
import {
  calendarTokenPrefix,
  CALENDAR_TOKEN_PATTERN,
  deriveCalendarToken,
  hashCalendarToken,
  newCalendarNonce,
} from "./token";
import { EVENT_COLUMNS, inputToRow, parseEventInput, rowToEvent, type CalendarEvent, type CalendarEventRow, type FieldErrors } from "./types";

// ============================================================
// Missio calendar data (migration 395)
// ============================================================
// Pastors read and write events on their own client, so RLS is the wall.
// The share link (nonce + token hash) lives in missio_calendar_links,
// which only the service role can touch, after the route's pastor check.
// The public feed reads through missio_calendar_feed(), a SECURITY
// DEFINER function that takes the token's hash and returns one calendar.
// Until 395 is applied, reads come back empty and writes say the
// calendar isn't available — never a 500.
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type Fail = { ok: false; status: number; code: string; error: string; fieldErrors?: FieldErrors };

const NOT_AVAILABLE: Fail = { ok: false, status: 503, code: "not_available", error: "The calendar isn’t available yet." };
const SERVER: Fail = { ok: false, status: 500, code: "server_error", error: "Something went wrong." };
const NOT_FOUND: Fail = { ok: false, status: 404, code: "not_found", error: "Not found." };
const INVALID: Fail = { ok: false, status: 400, code: "invalid_input", error: "Check the fields and try again." };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DbError = { code?: string; message?: string } | null | undefined;

/** The table or function isn't there: migration 395 hasn't been applied. */
export function isNotMigrated(error: DbError): boolean {
  const code = error?.code ?? "";
  return code === "42P01" || code === "42883" || code === "PGRST205" || code === "PGRST202";
}

function failFrom(error: DbError, what: string): Fail {
  if (isNotMigrated(error)) return NOT_AVAILABLE;
  if (error?.code === "23514" || error?.code === "22007" || error?.code === "22008") return INVALID;
  console.error(`[missio-calendar] ${what} failed`, error?.message ?? "db error");
  return SERVER;
}

export async function listCalendarEvents(
  auth: OrgAccess
): Promise<{ ok: true; available: boolean; events: CalendarEvent[] } | Fail> {
  const read = await auth.supabase
    .from("missio_calendar_events")
    .select(EVENT_COLUMNS)
    .eq("org_id", auth.orgId)
    .order("starts_on", { ascending: true })
    .limit(2000);
  if (read.error) {
    if (isNotMigrated(read.error)) return { ok: true, available: false, events: [] };
    return failFrom(read.error, "event list");
  }
  return { ok: true, available: true, events: ((read.data ?? []) as CalendarEventRow[]).map(rowToEvent) };
}

/** The org's one calendar, made the first time a pastor adds an event or shares it. */
export async function ensureCalendar(auth: OrgAccess): Promise<{ ok: true; id: string } | Fail> {
  const find = async () => auth.supabase.from("missio_calendars").select("id").eq("org_id", auth.orgId).maybeSingle();
  const found = await find();
  if (found.error) return failFrom(found.error, "calendar read");
  if (found.data?.id) return { ok: true, id: found.data.id as string };

  const made = await auth.supabase
    .from("missio_calendars")
    .insert({ org_id: auth.orgId, name: "Missio", created_by: auth.user.id, updated_by: auth.user.id })
    .select("id")
    .single();
  if (!made.error && made.data?.id) return { ok: true, id: made.data.id as string };
  // Two pastors at once: the other insert won.
  if (made.error?.code === "23505") {
    const again = await find();
    if (again.data?.id) return { ok: true, id: again.data.id as string };
  }
  return failFrom(made.error, "calendar create");
}

export async function createCalendarEvent(auth: OrgAccess, body: unknown): Promise<{ ok: true; event: CalendarEvent } | Fail> {
  const parsed = parseEventInput(body);
  if (!parsed.ok) return { ...INVALID, fieldErrors: parsed.fieldErrors };
  const calendar = await ensureCalendar(auth);
  if (!calendar.ok) return calendar;
  const write = await auth.supabase
    .from("missio_calendar_events")
    .insert({
      ...inputToRow(parsed.value),
      calendar_id: calendar.id,
      org_id: auth.orgId,
      created_by: auth.user.id,
      updated_by: auth.user.id,
    })
    .select(EVENT_COLUMNS)
    .single();
  if (write.error) return failFrom(write.error, "event create");
  return { ok: true, event: rowToEvent(write.data as CalendarEventRow) };
}

export async function updateCalendarEvent(
  auth: OrgAccess,
  id: string,
  body: unknown
): Promise<{ ok: true; event: CalendarEvent } | Fail> {
  if (!UUID_RE.test(id)) return NOT_FOUND;
  const parsed = parseEventInput(body);
  if (!parsed.ok) return { ...INVALID, fieldErrors: parsed.fieldErrors };
  const write = await auth.supabase
    .from("missio_calendar_events")
    .update({ ...inputToRow(parsed.value), updated_by: auth.user.id })
    .eq("id", id)
    .eq("org_id", auth.orgId)
    .select(EVENT_COLUMNS)
    .maybeSingle();
  if (write.error) return failFrom(write.error, "event update");
  if (!write.data) return NOT_FOUND;
  return { ok: true, event: rowToEvent(write.data as CalendarEventRow) };
}

export async function deleteCalendarEvent(auth: OrgAccess, id: string): Promise<{ ok: true } | Fail> {
  if (!UUID_RE.test(id)) return NOT_FOUND;
  const write = await auth.supabase
    .from("missio_calendar_events")
    .delete()
    .eq("id", id)
    .eq("org_id", auth.orgId)
    .select("id");
  if (write.error) return failFrom(write.error, "event delete");
  if (!write.data || write.data.length === 0) return NOT_FOUND;
  return { ok: true };
}

/**
 * The share link: made the first time, the same link after that, a new
 * one when `reset` is true (the old one stops working at once). `admin`
 * is the service-role client; call this only after the pastor check.
 * The raw token goes back to the pastor and nowhere else.
 */
export async function calendarShare(
  auth: OrgAccess,
  admin: Db,
  origin: string,
  reset: boolean,
  now = new Date()
): Promise<{ ok: true; share: CalendarShare } | Fail> {
  let secret: string;
  try {
    secret = requireAvailabilityTokenSecret();
  } catch {
    console.error("[missio-calendar] link secret missing");
    return NOT_AVAILABLE;
  }
  const calendar = await ensureCalendar(auth);
  if (!calendar.ok) return calendar;

  const found = await admin
    .from("missio_calendar_links")
    .select("id, nonce, token_prefix, rotated_at")
    .eq("calendar_id", calendar.id)
    .maybeSingle();
  if (found.error) return failFrom(found.error, "link read");
  const existing = found.data as { id: string; nonce: string; token_prefix: string; rotated_at: string | null } | null;

  let raw: string;
  let rotatedAt: string | null = existing?.rotated_at ?? null;
  if (existing && !reset) {
    raw = deriveCalendarToken(secret, calendar.id, existing.nonce);
  } else {
    const nonce = newCalendarNonce();
    raw = deriveCalendarToken(secret, calendar.id, nonce);
    const rotated = existing ? now.toISOString() : null;
    const row = {
      nonce,
      token_hash: hashCalendarToken(raw),
      token_prefix: calendarTokenPrefix(raw),
      updated_by: auth.user.id,
      ...(rotated ? { rotated_at: rotated } : {}),
    };
    const write = existing
      ? await admin.from("missio_calendar_links").update(row).eq("id", existing.id)
      : await admin.from("missio_calendar_links").insert({ ...row, calendar_id: calendar.id, created_by: auth.user.id });
    if (write.error) return failFrom(write.error, "link write");
    if (rotated) rotatedAt = rotated;
  }

  return {
    ok: true,
    share: {
      feedUrl: `${origin}${calendarFeedPath(raw)}`,
      webUrl: `${origin}${calendarWebPath(raw)}`,
      prefix: calendarTokenPrefix(raw),
      rotatedAt,
    },
  };
}

/** A client with no session: the feed function is all it can reach. */
export function publicFeedClient(): Db {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing Supabase public environment variables");
  return createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * The calendar behind a raw token, for the public feed and web view.
 * A wrong, reset or malformed token is the same plain "not found".
 * The raw token is never logged.
 */
export async function readCalendarByToken(
  db: Db,
  raw: string
): Promise<{ ok: true; name: string; events: CalendarEvent[] } | Fail> {
  if (!CALENDAR_TOKEN_PATTERN.test(raw)) return NOT_FOUND;
  const result = await db.rpc("missio_calendar_feed", { p_token_hash: hashCalendarToken(raw) });
  if (result.error) {
    if (isNotMigrated(result.error)) return NOT_FOUND;
    console.error("[missio-calendar] feed read failed", result.error.message ?? "rpc error");
    return SERVER;
  }
  const data = result.data as { name?: string; events?: CalendarEventRow[] } | null;
  if (!data || !Array.isArray(data.events)) return NOT_FOUND;
  return { ok: true, name: data.name || "Missio", events: data.events.map(rowToEvent) };
}
