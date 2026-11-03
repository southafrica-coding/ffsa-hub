// API contract for the Prayer Room slice. Pure: every call takes an ApiFetch,
// so tests pass a mock and the app passes the live one (./api-client).
//
// All of these are the website's EXISTING routes, called with the bearer
// token. Names on the wall are resolved by the server with its admin client
// (RLS on `users` is own-row-only), which is why the app reads through the API
// rather than straight from Supabase.
//
//   GET    /api/prayer-room/sets?dateFrom=&dateTo=          the week's sets + lineups
//   GET    /api/prayer-room/sets?id=                        one set
//   GET    /api/prayer-room/sets?scope=invites|owned|roster my commitments
//   GET    /api/prayer-room/wall-meta                       seat vocabulary + curated bands
//   GET    /api/prayer-room/blockouts?from=&to=             room block-outs
//   PUT    /api/prayer-room/slots/[id] {action}             accept | decline an invitation
//   GET    /api/prayer-room/requests?kind=seat&setId=&state=pending
//   POST   /api/prayer-room/requests?kind=seat              ask for an open seat
//   GET    /api/prayer-room/practice?week=                  the practice week
//   POST   /api/prayer-room/practice/bookings               book a station
//   DELETE /api/prayer-room/practice/bookings/[id]          cancel a practice booking
//
// Parsed tolerantly (unknown fields ignored, optional ones may be missing) so
// the server can grow without breaking installed apps.

import { z } from "zod";

import type { ApiFetch, ApiFetchInit } from "@/lib/api";

type Init = Pick<ApiFetchInit, "signal">;

const nullableString = z.string().nullish().transform((v) => v ?? null);

/** Times come back as "HH:MM:SS" (Postgres time) or "HH:MM"; keep "HH:MM". */
const time = z.string().transform((t) => t.slice(0, 5));
const nullableTime = z
  .string()
  .nullish()
  .transform((t) => (t ? t.slice(0, 5) : null));

// ── People and seats ────────────────────────────────────────────────────────

export const personSchema = z
  .object({
    id: z.string(),
    first_name: nullableString,
    last_name: nullableString,
    preferred_name: nullableString,
  })
  .nullish()
  .transform((v) => v ?? null);

export type Person = z.infer<typeof personSchema>;

export const slotSchema = z.object({
  id: z.string(),
  role: z.string().nullish().transform((v) => v ?? ""),
  /** Canonical seat since migration 167; `role` is the legacy mirror. */
  seat_type_id: nullableString,
  status: z.enum(["open", "invited", "filled", "declined"]).catch("open"),
  filled_user_id: nullableString,
  invitee_id: nullableString,
  filled: personSchema,
  invitee: personSchema,
  required_label: z
    .object({ id: z.string(), name: z.string() })
    .nullish()
    .transform((v) => v ?? null),
});

export type Slot = z.infer<typeof slotSchema>;

export const prayerSetSchema = z.object({
  id: z.string(),
  set_date: z.string(),
  start_time: time,
  end_time: time,
  title: nullableString,
  theme: nullableString,
  scripture: nullableString,
  prayer_focus: nullableString,
  setlist: nullableString,
  status: z.string().nullish().transform((v) => v ?? "scheduled"),
  relocation_note: nullableString,
  series_id: nullableString,
  owner_id: nullableString,
  owner: personSchema,
  slots: z
    .array(slotSchema)
    .nullish()
    .transform((v) => v ?? []),
});

export type PrayerSet = z.infer<typeof prayerSetSchema>;

export const seatTypeSchema = z.object({
  id: z.string(),
  label: z.string(),
  is_lead: z.boolean().catch(false),
  category: nullableString,
  sort_order: z.number().nullish().transform((v) => v ?? 99),
});

export type SeatType = z.infer<typeof seatTypeSchema>;

export const bandSchema = z.object({
  id: z.string(),
  band_name: nullableString,
  day_of_week: z.number().nullish().transform((v) => v ?? null),
  start_time: time,
  end_time: time,
  weekly_focus: nullableString,
});

export type Band = z.infer<typeof bandSchema>;

export const wallMetaSchema = z.object({
  seatTypes: z
    .array(seatTypeSchema)
    .nullish()
    .transform((v) => v ?? []),
  bands: z
    .array(bandSchema)
    .nullish()
    .transform((v) => v ?? []),
});

export type WallMeta = z.infer<typeof wallMetaSchema>;

export const blockoutSchema = z.object({
  id: z.string(),
  block_date: z.string(),
  end_date: nullableString,
  start_time: nullableTime,
  end_time: nullableTime,
  reason: nullableString,
  relocation_note: nullableString,
});

export type Blockout = z.infer<typeof blockoutSchema>;

// ── The week ────────────────────────────────────────────────────────────────

export function getSets(apiFetch: ApiFetch, from: string, to: string, init?: Init) {
  const q = `dateFrom=${encodeURIComponent(from)}&dateTo=${encodeURIComponent(to)}`;
  return apiFetch(`/api/prayer-room/sets?${q}`, { ...init, schema: z.array(prayerSetSchema) });
}

export function getSet(apiFetch: ApiFetch, id: string, init?: Init) {
  return apiFetch(`/api/prayer-room/sets?id=${encodeURIComponent(id)}`, { ...init, schema: prayerSetSchema });
}

export function getWallMeta(apiFetch: ApiFetch, init?: Init) {
  return apiFetch("/api/prayer-room/wall-meta", { ...init, schema: wallMetaSchema });
}

export function getBlockouts(apiFetch: ApiFetch, from: string, to: string, init?: Init) {
  const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  return apiFetch(`/api/prayer-room/blockouts?${q}`, { ...init, schema: z.array(blockoutSchema) });
}

export const weekPayloadSchema = z.object({
  sets: z.array(prayerSetSchema),
  blockouts: z.array(blockoutSchema),
  meta: wallMetaSchema,
});

export type WeekPayload = z.infer<typeof weekPayloadSchema>;

/**
 * Everything the week view draws, in one go. The seat vocabulary and the
 * block-outs degrade to empty (as on the web) so a missing table never hides
 * the sets themselves; the sets call is the one that decides success.
 */
export async function getWeek(apiFetch: ApiFetch, from: string, to: string, init?: Init): Promise<WeekPayload> {
  const [sets, blockouts, meta] = await Promise.all([
    getSets(apiFetch, from, to, init),
    getBlockouts(apiFetch, from, to, init).catch(() => [] as Blockout[]),
    getWallMeta(apiFetch, init).catch(() => ({ seatTypes: [], bands: [] }) as WallMeta),
  ]);
  return { sets, blockouts, meta };
}

// ── My commitments ──────────────────────────────────────────────────────────

const setSummarySchema = z.object({
  id: z.string(),
  set_date: z.string(),
  start_time: time,
  end_time: time,
  title: nullableString,
  theme: nullableString,
  status: z.string().nullish().transform((v) => v ?? "scheduled"),
  owner: personSchema,
});

export type SetSummary = z.infer<typeof setSummarySchema>;

export const inviteSchema = z.object({
  id: z.string(),
  role: z.string().nullish().transform((v) => v ?? ""),
  status: z.string(),
  required_label: z
    .object({ id: z.string(), name: z.string() })
    .nullish()
    .transform((v) => v ?? null),
  set: setSummarySchema.nullish().transform((v) => v ?? null),
});

export type Invite = z.infer<typeof inviteSchema>;

export const rosterSchema = z.object({
  id: z.string(),
  role: z.string().nullish().transform((v) => v ?? ""),
  status: z.string(),
  set: setSummarySchema.nullish().transform((v) => v ?? null),
});

export type RosterRow = z.infer<typeof rosterSchema>;

export const ownedSchema = z.object({
  id: z.string(),
  set_date: z.string(),
  start_time: time,
  end_time: time,
  title: nullableString,
  theme: nullableString,
  status: z.string().nullish().transform((v) => v ?? "scheduled"),
  series_id: nullableString,
});

export type OwnedSet = z.infer<typeof ownedSchema>;

export type Commitments = { invites: Invite[]; owned: OwnedSet[]; roster: RosterRow[] };

export async function getCommitments(apiFetch: ApiFetch, init?: Init): Promise<Commitments> {
  const [invites, owned, roster] = await Promise.all([
    apiFetch("/api/prayer-room/sets?scope=invites", { ...init, schema: z.array(inviteSchema) }),
    apiFetch("/api/prayer-room/sets?scope=owned&upcoming=true", { ...init, schema: z.array(ownedSchema) }),
    apiFetch("/api/prayer-room/sets?scope=roster", { ...init, schema: z.array(rosterSchema) }),
  ]);
  return { invites, owned, roster };
}

// ── Seat actions ────────────────────────────────────────────────────────────

/** Accept or decline an invitation. The server emails the set's owner on accept. */
export async function respondToInvite(apiFetch: ApiFetch, slotId: string, action: "accept" | "decline") {
  await apiFetch(`/api/prayer-room/slots/${encodeURIComponent(slotId)}`, { method: "PUT", body: { action } });
}

export const seatRequestSchema = z.object({
  id: z.string(),
  set_id: nullableString,
  seat_type_id: z.string(),
  user_id: z.string(),
  state: z.string(),
});

export type SeatRequest = z.infer<typeof seatRequestSchema>;

export function getPendingSeatRequests(apiFetch: ApiFetch, setId: string, init?: Init) {
  return apiFetch(`/api/prayer-room/requests?kind=seat&setId=${encodeURIComponent(setId)}&state=pending`, {
    ...init,
    schema: z.array(seatRequestSchema),
  });
}

/** Ask the set's lead for an open seat (migration 170). Does not fill anything. */
export async function askForSeat(apiFetch: ApiFetch, setId: string, seatTypeId: string) {
  await apiFetch("/api/prayer-room/requests?kind=seat", {
    method: "POST",
    body: { set_id: setId, seat_type_id: seatTypeId },
  });
}

// ── Practice (migration 224) ────────────────────────────────────────────────

export const practiceStationSchema = z.object({
  id: z.string(),
  slug: z.string().nullish().transform((v) => v ?? ""),
  label: z.string(),
  short_label: nullableString,
  seat_type_id: nullableString,
  sort_order: z.number().nullish().transform((v) => v ?? 0),
  max_people: z.number().nullish().transform((v) => v ?? 1),
});

export type PracticeStation = z.infer<typeof practiceStationSchema>;

export const practiceBookingSchema = z.object({
  id: z.string(),
  kind: z.enum(["station", "band"]).catch("station"),
  practice_date: z.string(),
  start_time: time,
  end_time: time,
  station_id: nullableString,
  booked_by: z.string(),
  band_name: nullableString,
  people: z
    .array(
      z.object({
        user_id: z.string(),
        station_id: nullableString,
        first_name: z.string().nullish().transform((v) => v || "Someone"),
        full_name: z.string().nullish().transform((v) => v || "Someone"),
      }),
    )
    .nullish()
    .transform((v) => v ?? []),
});

export type PracticeBooking = z.infer<typeof practiceBookingSchema>;

export const practiceWeekSchema = z.object({
  settings: z.object({
    start_time: time,
    end_time: time,
    slot_minutes: z.number(),
    closed_weekdays: z
      .array(z.number())
      .nullish()
      .transform((v) => v ?? []),
    closed_label: z.string().nullish().transform((v) => v || "Closed"),
    max_minutes: z.number(),
    opens_weekday: z.number(),
    opens_time: time,
  }),
  stations: z.array(practiceStationSchema),
  bookings: z.array(practiceBookingSchema),
  days: z.array(z.string()),
  opensAt: z.string(),
  nextOpensAt: nullableString,
  now: z.string(),
  me: z.object({
    canBook: z.boolean().catch(false),
    isStaff: z.boolean().catch(false),
    defaultStationId: nullableString,
  }),
});

export type PracticeWeek = z.infer<typeof practiceWeekSchema>;
export type PracticeSettings = PracticeWeek["settings"];

export function getPracticeWeek(apiFetch: ApiFetch, anchor: string, init?: Init) {
  return apiFetch(`/api/prayer-room/practice?week=${encodeURIComponent(anchor)}`, { ...init, schema: practiceWeekSchema });
}

/** Book one station for yourself. Every rule is the database's (the route only checks shape). */
export async function bookStation(apiFetch: ApiFetch, b: { date: string; start: string; end: string; stationId: string }) {
  await apiFetch("/api/prayer-room/practice/bookings", {
    method: "POST",
    body: { kind: "station", date: b.date, start: b.start, end: b.end, stationId: b.stationId, singers: [] },
  });
}

export async function cancelPracticeBooking(apiFetch: ApiFetch, bookingId: string) {
  await apiFetch(`/api/prayer-room/practice/bookings/${encodeURIComponent(bookingId)}`, { method: "DELETE" });
}
