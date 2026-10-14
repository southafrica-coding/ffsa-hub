// Prayer Room ← Space Bookings: suggested block-outs.
//
// When the prayer room's venue is booked in Space Bookings over a scheduled
// devo set, the Manage tab offers a block-out pre-filled from that booking.
// Suggestions are DERIVED on every read — approved bookings × scheduled sets ×
// existing block-outs — so a booking that's cancelled, moved or already covered
// by a block-out simply stops producing one. Stored state (migration 231) is
// only: which booking a block-out came from (+ its slot then), and dismissals.
//
// Reads use the ADMIN client (callers check isPrayerRoomStaff first); writes
// take the USER client so RLS enforces staff-only.

import { occupiedWindow, type BookingWindow } from "@/lib/bookings/conflicts";
import { sastNow } from "@/lib/prayer-room/practice";
import { shiftDays } from "@/lib/bookings/dates";
import { createBlockout, stampRelocation } from "@/services/prayer-room";
import { announceBlockout } from "@/lib/prayer-room/blockout-announce";
import type { SlackResult } from "@/lib/slack/prayer-room";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

/** The Space Bookings venue that IS the prayer room. */
export const PRAYER_ROOM_VENUE_SLUG = "auditorium";
/** How far ahead bookings are checked against the schedule. */
const HORIZON_DAYS = 180;
const PAGE = 1000; // PostgREST's silent row cap — page past it.
const DAY_END = 24 * 60;

type Person = { first_name: string | null; last_name: string | null; preferred_name: string | null } | null;

type BookingRow = {
  id: string;
  venue_id: string;
  series_id: string | null;
  title: string;
  description: string | null;
  point_person: string | null;
  requester_name: string | null;
  booking_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  setup_time: string | null;
  setdown_time: string | null;
  status: string;
  created_at: string;
  decided_at: string | null;
  ministry: { name: string } | null;
};

type SetRow = {
  id: string;
  title: string | null;
  theme: string | null;
  set_date: string;
  start_time: string;
  end_time: string;
  owner: Person;
};

type BlockoutRow = {
  id: string;
  block_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  relocation_note: string | null;
  source_booking_id: string | null;
  source_signature: string | null;
};

export type SuggestedSet = {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  owner: string | null;
};

export type SuggestionOccurrence = {
  bookingId: string;
  date: string;
  endDate: string;
  /** Null = the room is out all day (multi-day booking, or no times). */
  startTime: string | null;
  endTime: string | null;
  signature: string;
};

export type BookingSuggestion = {
  /** "series:<id>" or "booking:<id>" — one card per booking / weekly series. */
  key: string;
  title: string;
  description: string | null;
  bookedBy: string | null;
  pointPerson: string | null;
  ministry: string | null;
  /** When the booking was confirmed — for the notification timestamp. */
  at: string;
  occurrences: SuggestionOccurrence[];
  affected: SuggestedSet[];
};

export type ChangedBlockout = {
  blockout: BlockoutRow;
  bookingTitle: string;
  change: "cancelled" | "moved";
  /** The booking's slot now (moved only). */
  now: { date: string; endDate: string; startTime: string | null; endTime: string | null } | null;
};

// ── small time helpers ──────────────────────────────────────

const toMin = (t: string | null | undefined): number | null => {
  const m = (t ?? "").match(/^(\d{1,2}):(\d{2})/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
};
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function personName(p: Person): string | null {
  if (!p) return null;
  return `${p.preferred_name || p.first_name || ""} ${p.last_name || ""}`.trim() || null;
}

/** The booking's slot as the prayer room sees it: set-up → set-down, or all day. */
function bookingSlot(b: BookingRow): Omit<SuggestionOccurrence, "bookingId"> {
  const w = occupiedWindow(b as unknown as BookingWindow);
  const endDate = b.end_date && b.end_date > b.booking_date ? b.end_date : b.booking_date;
  const allDay = w.start <= 0 && w.end >= DAY_END;
  const startTime = allDay ? null : toHHMM(w.start);
  const endTime = allDay ? null : toHHMM(Math.min(w.end, DAY_END - 1));
  return {
    date: b.booking_date,
    endDate,
    startTime,
    endTime,
    signature: `${b.booking_date}|${endDate}|${startTime ?? "all"}-${endTime ?? "day"}`,
  };
}

/** Does a set fall inside a dated window (null times = the whole day)? */
function setInWindow(
  s: SetRow,
  from: string,
  to: string,
  startTime: string | null,
  endTime: string | null
): boolean {
  if (s.set_date < from || s.set_date > to) return false;
  if (!startTime || !endTime) return true;
  const ss = toMin(s.start_time) ?? 0;
  const se = toMin(s.end_time) ?? ss;
  return ss < (toMin(endTime) ?? 0) && se > (toMin(startTime) ?? 0);
}

async function pageAll<T>(build: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

const BOOKING_SELECT =
  "id, venue_id, series_id, title, description, point_person, requester_name, booking_date, end_date, start_time, end_time, setup_time, setdown_time, status, created_at, decided_at, ministry:ministries(name)";

// ── the derivation ──────────────────────────────────────────

export async function getBookingSuggestions(
  admin: Client
): Promise<{ suggestions: BookingSuggestion[]; changed: ChangedBlockout[] }> {
  const empty = { suggestions: [], changed: [] };
  const today = sastNow().slice(0, 10);
  const horizon = shiftDays(today, HORIZON_DAYS);

  const { data: venue } = await admin
    .from("venues")
    .select("id")
    .eq("slug", PRAYER_ROOM_VENUE_SLUG)
    .maybeSingle();
  if (!venue) return empty;

  const [bookings, sets, blockoutsRes, dismissalsRes] = await Promise.all([
    pageAll<BookingRow>((from, to) =>
      admin
        .from("venue_bookings")
        .select(BOOKING_SELECT)
        .eq("venue_id", venue.id)
        .eq("status", "approved")
        .lte("booking_date", horizon)
        .or(`booking_date.gte.${today},end_date.gte.${today}`)
        .order("booking_date")
        .order("id")
        .range(from, to)
    ),
    pageAll<SetRow>((from, to) =>
      admin
        .from("prayer_room_sets")
        .select("id, title, theme, set_date, start_time, end_time, owner:owner_id(first_name, last_name, preferred_name)")
        .eq("status", "scheduled")
        .gte("set_date", today)
        .lte("set_date", horizon)
        .order("set_date")
        .order("id")
        .range(from, to)
    ),
    admin
      .from("prayer_room_blockouts")
      .select("id, block_date, end_date, start_time, end_time, reason, relocation_note, source_booking_id, source_signature")
      .gte("end_date", today),
    admin.from("prayer_room_booking_dismissals").select("booking_id, signature"),
  ]);

  // Without the block-outs every booking would look uncovered — fail loudly
  // (e.g. migration 231 not applied yet) rather than suggest duplicates.
  if (blockoutsRes.error) throw blockoutsRes.error;
  const blockouts = (blockoutsRes.data ?? []) as BlockoutRow[];
  const dismissed = new Map<string, string>(
    ((dismissalsRes.data ?? []) as { booking_id: string; signature: string }[]).map((d) => [d.booking_id, d.signature])
  );

  const setsByDate = new Map<string, SetRow[]>();
  for (const s of sets) {
    const list = setsByDate.get(s.set_date) ?? [];
    list.push(s);
    setsByDate.set(s.set_date, list);
  }
  const covered = (s: SetRow) =>
    blockouts.some((b) => setInWindow(s, b.block_date, b.end_date, b.start_time, b.end_time));

  // ── suggestions: bookings that still displace an uncovered set ──
  const groups = new Map<string, BookingSuggestion>();
  for (const b of bookings) {
    const slot = bookingSlot(b);
    if (dismissed.get(b.id) === slot.signature) continue;

    const hit: SetRow[] = [];
    for (let d = slot.date; d <= slot.endDate; d = shiftDays(d, 1)) {
      for (const s of setsByDate.get(d) ?? []) {
        if (setInWindow(s, slot.date, slot.endDate, slot.startTime, slot.endTime) && !covered(s)) hit.push(s);
      }
    }
    if (hit.length === 0) continue;

    const key = b.series_id ? `series:${b.series_id}` : `booking:${b.id}`;
    const g =
      groups.get(key) ??
      ({
        key,
        title: b.title,
        description: b.description,
        bookedBy: b.requester_name,
        pointPerson: b.point_person,
        ministry: b.ministry?.name ?? null,
        at: b.decided_at ?? b.created_at,
        occurrences: [],
        affected: [],
      } as BookingSuggestion);
    g.occurrences.push({ bookingId: b.id, ...slot });
    for (const s of hit) {
      if (g.affected.some((a) => a.id === s.id)) continue;
      g.affected.push({
        id: s.id,
        title: s.title || s.theme || "Devo set",
        date: s.set_date,
        startTime: s.start_time,
        endTime: s.end_time,
        owner: personName(s.owner),
      });
    }
    groups.set(key, g);
  }
  const suggestions = [...groups.values()].sort((a, b) => a.occurrences[0].date.localeCompare(b.occurrences[0].date));
  for (const g of suggestions) {
    g.affected.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  }

  // ── changed: block-outs whose source booking moved or was called off ──
  const linked = blockouts.filter((b) => b.source_booking_id);
  const changed: ChangedBlockout[] = [];
  if (linked.length > 0) {
    const { data: srcRows } = await admin
      .from("venue_bookings")
      .select(BOOKING_SELECT)
      .in("id", [...new Set(linked.map((b) => b.source_booking_id))]);
    const src = new Map(((srcRows ?? []) as BookingRow[]).map((r) => [r.id, r]));
    for (const bo of linked) {
      const booking = src.get(bo.source_booking_id!);
      if (!booking) continue;
      if (booking.status !== "approved" || booking.venue_id !== venue.id) {
        changed.push({ blockout: bo, bookingTitle: booking.title, change: "cancelled", now: null });
        continue;
      }
      const slot = bookingSlot(booking);
      if (slot.signature !== bo.source_signature) {
        changed.push({
          blockout: bo,
          bookingTitle: booking.title,
          change: "moved",
          now: { date: slot.date, endDate: slot.endDate, startTime: slot.startTime, endTime: slot.endTime },
        });
      }
    }
  }

  return { suggestions, changed };
}

/** What the badge / dashboard count: things a manager still needs to act on. */
export async function countBookingSuggestions(admin: Client): Promise<number> {
  const { suggestions, changed } = await getBookingSuggestions(admin);
  return suggestions.length + changed.length;
}

// ── actions ─────────────────────────────────────────────────

function pickOccurrences(all: BookingSuggestion[], bookingIds: string[]) {
  const want = new Set(bookingIds);
  const hits: { suggestion: BookingSuggestion; occ: SuggestionOccurrence }[] = [];
  for (const s of all) for (const occ of s.occurrences) if (want.has(occ.bookingId)) hits.push({ suggestion: s, occ });
  return hits;
}

/**
 * Apply a suggestion: one block-out per booking date (linked back to the
 * booking), relocate the displaced sets, then ONE Slack announcement + DMs.
 */
export async function applyBookingSuggestion(
  supabase: Client,
  admin: Client,
  userId: string,
  input: { bookingIds: string[]; relocationNote: string | null; reason: string | null }
): Promise<{ created: number; affected: number; slack: SlackResult } | { error: string; status: number }> {
  const { suggestions } = await getBookingSuggestions(admin);
  const hits = pickOccurrences(suggestions, input.bookingIds);
  if (hits.length === 0) {
    return { error: "This booking no longer needs a block-out — it may have been cancelled or already handled.", status: 409 };
  }
  const first = hits[0].suggestion;
  const reason = input.reason?.trim() || first.title;

  const affectedAll: SuggestedSet[] = [];
  for (const { occ } of hits) {
    const { data: blockout, error } = await createBlockout(supabase, {
      block_date: occ.date,
      end_date: occ.endDate,
      start_time: occ.startTime,
      end_time: occ.endTime,
      reason,
      relocation_note: input.relocationNote,
      created_by: userId,
      source_booking_id: occ.bookingId,
      source_signature: occ.signature,
    });
    if (error || !blockout) {
      return { error: error?.message ?? "Failed to create block-out", status: 403 };
    }
  }
  // Only the sets the suggestion showed — a set another block-out already
  // relocated keeps its own note.
  for (const { suggestion, occ } of hits) {
    for (const a of suggestion.affected) {
      const asRow = { set_date: a.date, start_time: a.startTime, end_time: a.endTime } as SetRow;
      if (setInWindow(asRow, occ.date, occ.endDate, occ.startTime, occ.endTime) && !affectedAll.some((x) => x.id === a.id)) {
        affectedAll.push(a);
      }
    }
  }

  if (affectedAll.length > 0) {
    await stampRelocation(supabase, affectedAll.map((s) => s.id), input.relocationNote);
  }

  const dates = [...new Set(hits.map((h) => h.occ.date))].sort();
  const windows = new Set(hits.map((h) => `${h.occ.startTime}-${h.occ.endTime}`));
  const firstOcc = hits[0].occ;
  const lastOcc = hits[hits.length - 1].occ;
  const slack = await announceBlockout(
    {
      blockDate: firstOcc.date,
      endDate: hits.length > 1 ? lastOcc.endDate : firstOcc.endDate,
      startTime: windows.size === 1 ? firstOcc.startTime : null,
      endTime: windows.size === 1 ? firstOcc.endTime : null,
      timesVary: windows.size > 1,
      dates: hits.length > 1 ? dates : undefined,
      reason,
      relocationNote: input.relocationNote,
      affected: affectedAll.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime)),
    },
    userId
  );

  return { created: hits.length, affected: affectedAll.length, slack };
}

/** Dismiss: stays quiet until the booking's date / time changes. */
export async function dismissBookingSuggestion(
  supabase: Client,
  admin: Client,
  userId: string,
  bookingIds: string[]
): Promise<{ dismissed: number; error?: string }> {
  const { suggestions } = await getBookingSuggestions(admin);
  const hits = pickOccurrences(suggestions, bookingIds);
  if (hits.length === 0) return { dismissed: 0 };
  const { error } = await supabase.from("prayer_room_booking_dismissals").upsert(
    hits.map(({ occ }) => ({
      booking_id: occ.bookingId,
      signature: occ.signature,
      dismissed_by: userId,
      dismissed_at: new Date().toISOString(),
    })),
    { onConflict: "booking_id" }
  );
  return { dismissed: error ? 0 : hits.length, error: error?.message };
}

/**
 * Keep a block-out whose booking changed: a cancelled booking unlinks it, a
 * moved one re-baselines on the booking's new slot. (Any sets the new slot now
 * displaces surface as a fresh suggestion on their own.)
 */
export async function keepChangedBlockout(
  supabase: Client,
  admin: Client,
  blockoutId: string
): Promise<{ ok: boolean; error?: string }> {
  const { changed } = await getBookingSuggestions(admin);
  const c = changed.find((x) => x.blockout.id === blockoutId);
  if (!c) return { ok: true };
  const patch =
    c.change === "cancelled" || !c.now
      ? { source_booking_id: null, source_signature: null }
      : {
          source_signature: `${c.now.date}|${c.now.endDate}|${c.now.startTime ?? "all"}-${c.now.endTime ?? "day"}`,
        };
  const { error } = await supabase.from("prayer_room_blockouts").update(patch).eq("id", blockoutId);
  return { ok: !error, error: error?.message };
}
