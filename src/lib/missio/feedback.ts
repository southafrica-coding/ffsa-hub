import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OrgAccess } from "@/lib/missio/access";
import { requireAvailabilityTokenSecret } from "@/lib/missio/availability/token";
import type { HouseScope } from "@/lib/missio/house-churches";

/**
 * Weekly house feedback (boards M4a, M4b). Migration 339.
 *
 * One link per house. The raw link is an HMAC of the house id and a stored
 * nonce, so a pastor can copy it again later; only its SHA-256 hash is
 * stored for lookup. Rotating replaces the nonce and kills the old link.
 * The HMAC key is the Missio link secret with a "feedback" prefix, so a
 * feedback link can never be read as an availability link.
 */

export const FEEDBACK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const MOODS = ["hard", "okay", "good", "great"] as const;
export type Mood = (typeof MOODS)[number];

export type FeedbackEntry = {
  meetingDate: string;
  attendance: number;
  mood: Mood;
  newNames: string[];
  prayer: string | null;
  notes: string | null;
  submittedAt: string;
};

export type PublicFeedbackView = {
  houseTitle: string;
  meetingDate: string;
  lastAttendance: number | null;
  existing: FeedbackEntry | null;
};

export type HouseFeedbackRow = {
  houseId: string;
  number: number;
  name: string | null;
  meetingDay: string | null;
  coaches: string[];
  /** Newest first. Missed weeks have no entry. */
  entries: FeedbackEntry[];
};

type Fail = { ok: false; status: number; code: string; error: string };
const fail = (status: number, code: string, error: string): Fail => ({ ok: false, status, code, error });

// The generated types don't know the 339 tables yet; same loose client as the other Missio services.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export function feedbackAdmin(): Admin {
  return createAdminClient();
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function deriveToken(secret: string, houseId: string, nonce: string): string {
  return createHmac("sha256", secret).update(`feedback|${houseId}|${nonce}`).digest("base64url");
}

export function feedbackPath(raw: string): string {
  return `/serve/missio/feedback/${raw}`;
}

/** YYYY-MM-DD in Johannesburg. */
export function joburgDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** The house's most recent meeting on or before today. Today when the day is unknown. */
export function meetingDateFor(meetingDay: string | null | undefined, now = new Date()): string {
  const today = joburgDate(now);
  const target = DAYS.indexOf((meetingDay ?? "").toLowerCase());
  if (target < 0) return today;
  const date = new Date(`${today}T12:00:00Z`);
  const back = (date.getUTCDay() - target + 7) % 7;
  date.setUTCDate(date.getUTCDate() - back);
  return date.toISOString().slice(0, 10);
}

function toEntry(row: Record<string, unknown>): FeedbackEntry {
  return {
    meetingDate: String(row.meeting_date),
    attendance: Number(row.attendance),
    mood: (MOODS as readonly string[]).includes(String(row.mood)) ? (row.mood as Mood) : "okay",
    newNames: Array.isArray(row.new_names) ? (row.new_names as unknown[]).map(String) : [],
    prayer: typeof row.prayer === "string" && row.prayer ? row.prayer : null,
    notes: typeof row.notes === "string" && row.notes ? row.notes : null,
    submittedAt: String(row.submitted_at ?? ""),
  };
}

const ENTRY_COLUMNS = "house_church_id, meeting_date, attendance, mood, new_names, prayer, notes, submitted_at";

/**
 * The house's link, made on first use. rotate=true replaces it. The caller
 * has already checked who may see or rotate it.
 */
export async function houseFeedbackLink(
  db: Admin,
  houseId: string,
  userId: string,
  rotate = false
): Promise<{ ok: true; path: string } | Fail> {
  let secret: string;
  try {
    secret = requireAvailabilityTokenSecret();
  } catch {
    console.error("[missio] feedback link secret missing");
    return fail(500, "server_error", "Something went wrong.");
  }
  const found = await db.from("missio_feedback_links").select("id, nonce").eq("house_church_id", houseId).maybeSingle();
  if (found.error) {
    console.error("[missio] feedback link read failed", found.error.message);
    return fail(500, "server_error", "Something went wrong.");
  }
  const existing = found.data as { id: string; nonce: string } | null;
  if (existing && !rotate) return { ok: true, path: feedbackPath(deriveToken(secret, houseId, existing.nonce)) };

  const nonce = randomBytes(32).toString("base64url");
  const raw = deriveToken(secret, houseId, nonce);
  const write = existing
    ? await db.from("missio_feedback_links").update({ nonce, token_hash: hashToken(raw), created_by: userId }).eq("id", existing.id)
    : await db.from("missio_feedback_links").insert({ house_church_id: houseId, nonce, token_hash: hashToken(raw), created_by: userId });
  if (write.error) {
    console.error("[missio] feedback link write failed", write.error.message);
    return fail(500, "server_error", "Something went wrong.");
  }
  return { ok: true, path: feedbackPath(raw) };
}

async function linkFor(db: Admin, raw: string): Promise<{ ok: true; linkId: string; houseId: string } | Fail> {
  if (!FEEDBACK_TOKEN_PATTERN.test(raw)) return fail(404, "invalid_token", "This link isn’t right.");
  const tokenHash = hashToken(raw);
  const found = await db.from("missio_feedback_links").select("id, house_church_id, token_hash").eq("token_hash", tokenHash).maybeSingle();
  if (found.error) {
    console.error("[missio] feedback link lookup failed", found.error.message);
    return fail(500, "server_error", "Something went wrong.");
  }
  const row = found.data as { id: string; house_church_id: string; token_hash: string } | null;
  if (!row || !timingSafeEqual(Buffer.from(row.token_hash), Buffer.from(tokenHash))) {
    return fail(404, "invalid_token", "This link isn’t right.");
  }
  return { ok: true, linkId: row.id, houseId: row.house_church_id };
}

async function houseFor(db: Admin, houseId: string) {
  const house = await db.from("house_churches").select("id, number, name, meeting_day").eq("id", houseId).maybeSingle();
  if (house.error || !house.data) return null;
  return house.data as { id: string; number: number; name: string | null; meeting_day: string | null };
}

export async function loadPublicFeedback(db: Admin, raw: string, now = new Date()): Promise<{ ok: true; view: PublicFeedbackView } | Fail> {
  const link = await linkFor(db, raw);
  if (!link.ok) return link;
  const house = await houseFor(db, link.houseId);
  if (!house) return fail(404, "invalid_token", "This link isn’t right.");
  const meetingDate = meetingDateFor(house.meeting_day, now);
  const recent = await db
    .from("missio_house_feedback")
    .select(ENTRY_COLUMNS)
    .eq("house_church_id", house.id)
    .lte("meeting_date", meetingDate)
    .order("meeting_date", { ascending: false })
    .limit(2);
  if (recent.error) {
    console.error("[missio] feedback read failed", recent.error.message);
    return fail(500, "server_error", "Something went wrong.");
  }
  const rows = ((recent.data ?? []) as Record<string, unknown>[]).map(toEntry);
  const existing = rows.find((row) => row.meetingDate === meetingDate) ?? null;
  const previous = rows.find((row) => row.meetingDate !== meetingDate) ?? null;
  return {
    ok: true,
    view: {
      houseTitle: house.name?.trim() || `House ${house.number}`,
      meetingDate,
      lastAttendance: previous?.attendance ?? null,
      existing,
    },
  };
}

const optionalText = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((value) => (value ? value : null));

const submitSchema = z
  .object({
    attendance: z.number().int().min(0).max(500),
    mood: z.enum(MOODS),
    newNames: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
    prayer: optionalText,
    notes: optionalText,
  })
  .strict();

/** Save this week's answers. Sending again the same week updates the row. */
export async function savePublicFeedback(
  db: Admin,
  raw: string,
  body: unknown,
  now = new Date()
): Promise<{ ok: true; entry: FeedbackEntry } | Fail> {
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) return fail(400, "invalid_input", "Check the answers and try again.");
  const link = await linkFor(db, raw);
  if (!link.ok) return link;
  const house = await houseFor(db, link.houseId);
  if (!house) return fail(404, "invalid_token", "This link isn’t right.");
  const meetingDate = meetingDateFor(house.meeting_day, now);
  const saved = await db
    .from("missio_house_feedback")
    .upsert(
      {
        house_church_id: house.id,
        meeting_date: meetingDate,
        attendance: parsed.data.attendance,
        mood: parsed.data.mood,
        new_names: [...new Set(parsed.data.newNames ?? [])],
        prayer: parsed.data.prayer,
        notes: parsed.data.notes,
        link_id: link.linkId,
        submitted_at: now.toISOString(),
      },
      { onConflict: "house_church_id,meeting_date" }
    )
    .select(ENTRY_COLUMNS)
    .single();
  if (saved.error || !saved.data) {
    console.error("[missio] feedback save failed", saved.error?.message ?? "no row");
    return fail(500, "server_error", "Something went wrong.");
  }
  return { ok: true, entry: toEntry(saved.data as Record<string, unknown>) };
}

/**
 * Feedback for the houses this user may see, newest first, for the last
 * `weeks` weeks. Runs on the user's client, so RLS (339) is the wall.
 */
export async function listHouseFeedback(
  auth: OrgAccess,
  scope: HouseScope,
  weeks: number,
  now = new Date()
): Promise<{ ok: true; houses: HouseFeedbackRow[]; since: string } | Fail> {
  let houses = auth.supabase.from("house_churches").select("id, number, name, meeting_day").eq("org_id", auth.orgId);
  if (scope.mode === "houses") {
    if (scope.ids.length === 0) return { ok: true, houses: [], since: joburgDate(now) };
    houses = houses.in("id", [...scope.ids]);
  }
  const houseRows = await houses.order("number", { ascending: true });
  if (houseRows.error) {
    console.error("[missio] house list failed", houseRows.error.message);
    return fail(500, "server_error", "Something went wrong.");
  }
  const list = (houseRows.data ?? []) as Array<{ id: string; number: number; name: string | null; meeting_day: string | null }>;
  const sinceDate = new Date(`${joburgDate(now)}T12:00:00Z`);
  sinceDate.setUTCDate(sinceDate.getUTCDate() - weeks * 7);
  const since = sinceDate.toISOString().slice(0, 10);
  const ids = list.map((house) => house.id);
  const byHouse = new Map<string, FeedbackEntry[]>();
  const coachNames = new Map<string, string[]>();
  if (ids.length > 0) {
    const rows = await auth.supabase
      .from("missio_house_feedback")
      .select(ENTRY_COLUMNS)
      .in("house_church_id", ids)
      .gt("meeting_date", since)
      .order("meeting_date", { ascending: false });
    if (rows.error) {
      if (rows.error.code === "42P01" || rows.error.code === "PGRST205") return { ok: true, houses: list.map((house) => blank(house)), since };
      console.error("[missio] feedback list failed", rows.error.message);
      return fail(500, "server_error", "Something went wrong.");
    }
    for (const row of (rows.data ?? []) as Record<string, unknown>[]) {
      const id = String(row.house_church_id);
      const entries = byHouse.get(id) ?? [];
      entries.push(toEntry(row));
      byHouse.set(id, entries);
    }
    const coaches = await auth.supabase
      .from("missio_coach_assignments")
      .select("house_church_id, coach_contact_id")
      .in("house_church_id", ids)
      .is("ended_at", null);
    if (!coaches.error && (coaches.data ?? []).length > 0) {
      const contactIds = [...new Set((coaches.data as Array<{ coach_contact_id: string }>).map((row) => row.coach_contact_id))];
      const names = await auth.supabase
        .from("org_people_directory")
        .select("contact_id, first_name, last_name, preferred_name")
        .eq("org_id", auth.orgId)
        .in("contact_id", contactIds);
      const nameOf = new Map<string, string>();
      for (const row of (names.data ?? []) as Array<{ contact_id: string; first_name: string | null; last_name: string | null; preferred_name: string | null }>) {
        nameOf.set(row.contact_id, [row.preferred_name || row.first_name, row.last_name].filter(Boolean).join(" "));
      }
      for (const row of coaches.data as Array<{ house_church_id: string; coach_contact_id: string }>) {
        const listFor = coachNames.get(row.house_church_id) ?? [];
        const name = nameOf.get(row.coach_contact_id);
        if (name) listFor.push(name);
        coachNames.set(row.house_church_id, listFor);
      }
    }
  }
  function blank(house: { id: string; number: number; name: string | null; meeting_day: string | null }): HouseFeedbackRow {
    return { houseId: house.id, number: house.number, name: house.name, meetingDay: house.meeting_day, coaches: [], entries: [] };
  }
  return {
    ok: true,
    since,
    houses: list.map((house) => ({
      ...blank(house),
      coaches: (coachNames.get(house.id) ?? []).sort(),
      entries: byHouse.get(house.id) ?? [],
    })),
  };
}
