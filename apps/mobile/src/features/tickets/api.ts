// API contract for the Tickets + check-in slice. Pure: takes an ApiFetch, so
// tests pass a mock and the app passes the live one from @/lib/api-client.
//
//   GET  /api/mobile/my-tickets                    my tickets (new, this PR)
//   GET  /api/mobile/my-tickets/[code]/waiver      link to my signed waiver (new)
//   GET  /api/mobile/check-in-events               events I can run a door for (new)
//   GET  /api/events/[id]/check-in?stats=1         door tally (existing)
//   GET  /api/events/[id]/check-in?q=name          guest lookup (existing)
//   POST /api/events/[id]/check-in {code}|{undo}   check in / undo (existing)
//
// Parsed tolerantly (unknown fields ignored, optional ones may be missing)
// so the server can grow without breaking installed apps.

import { z } from "zod";

import type { ApiFetch, ApiFetchInit } from "@/lib/api";

type Init = Pick<ApiFetchInit, "signal">;

const nullableString = z.string().nullish().transform((v) => v ?? null);

// ── My tickets ──────────────────────────────────────────────────────────────

export const ticketEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  startDate: z.string(),
  startTime: nullableString,
  endDate: nullableString,
  endTime: nullableString,
  location: nullableString,
  status: z.string().nullish().transform((v) => v ?? "published"),
});

export const myTicketSchema = z.object({
  id: z.string(),
  code: z.string(),
  status: z.enum(["valid", "checked_in", "void"]).catch("void"),
  checkedInAt: nullableString,
  ticketTypeName: z.string().nullish().transform((v) => v || "Ticket"),
  holderName: z.string().nullish().transform((v) => v ?? ""),
  waiver: z
    .object({
      required: z.boolean().catch(false),
      signed: z.boolean().catch(false),
      signedAt: nullableString,
      title: nullableString,
      hasDocument: z.boolean().catch(false),
    })
    .nullish()
    .transform((v) => v ?? { required: false, signed: false, signedAt: null, title: null, hasDocument: false }),
  event: ticketEventSchema,
});

export const myRegistrationSchema = z.object({
  id: z.string(),
  status: z.string(),
  event: ticketEventSchema,
});

export const myTicketsSchema = z.object({
  tickets: z.array(myTicketSchema),
  registrations: z
    .array(myRegistrationSchema)
    .nullish()
    .transform((v) => v ?? []),
  serverTime: nullableString,
});

export type TicketEvent = z.infer<typeof ticketEventSchema>;
export type MyTicket = z.infer<typeof myTicketSchema>;
export type MyRegistration = z.infer<typeof myRegistrationSchema>;
export type MyTickets = z.infer<typeof myTicketsSchema>;

export function getMyTickets(apiFetch: ApiFetch, init?: Init) {
  return apiFetch("/api/mobile/my-tickets", { ...init, schema: myTicketsSchema });
}

export const waiverLinkSchema = z.object({ url: z.string().url(), expiresIn: z.number().nullish() });

export function getWaiverLink(apiFetch: ApiFetch, code: string, init?: Init) {
  return apiFetch(`/api/mobile/my-tickets/${encodeURIComponent(code)}/waiver`, { ...init, schema: waiverLinkSchema });
}

// ── Door check-in ───────────────────────────────────────────────────────────

export const checkInEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  startDate: z.string(),
  startTime: nullableString,
  endDate: nullableString,
  endTime: nullableString,
  location: nullableString,
});

export const checkInEventsSchema = z.object({ events: z.array(checkInEventSchema) });

export type CheckInEvent = z.infer<typeof checkInEventSchema>;

export function getCheckInEvents(apiFetch: ApiFetch, init?: Init) {
  return apiFetch("/api/mobile/check-in-events", { ...init, schema: checkInEventsSchema });
}

export const doorStatsSchema = z.object({ checkedIn: z.number(), total: z.number() });
export type DoorStats = z.infer<typeof doorStatsSchema>;

export const guestSchema = z.object({
  ticketId: z.string(),
  code: z.string(),
  name: z.string(),
  ticketTypeName: z.string().nullish().transform((v) => v || "Ticket"),
  status: z.enum(["valid", "checked_in"]).catch("valid"),
  checkedInAt: nullableString,
});
export const guestsSchema = z.object({ guests: z.array(guestSchema) });
export type Guest = z.infer<typeof guestSchema>;

// The server's ScanOutcome (website src/services/ticket-check-in.ts).
export const scanOutcomeSchema = z.discriminatedUnion("result", [
  z.object({
    result: z.literal("ok"),
    ticketId: z.string(),
    ticketTypeName: z.string().nullish().transform((v) => v || "Ticket"),
    buyerName: z.string().nullish().transform((v) => v ?? ""),
  }),
  z.object({
    result: z.literal("already_checked_in"),
    ticketTypeName: z.string().nullish().transform((v) => v || "Ticket"),
    checkedInAt: nullableString,
  }),
  z.object({ result: z.literal("void") }),
  z.object({ result: z.literal("invalid") }),
  z.object({ result: z.literal("wrong_event") }),
]);
export type ScanOutcome = z.infer<typeof scanOutcomeSchema>;

export const undoResultSchema = z.object({ result: z.literal("undone") });

const doorPath = (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/check-in`;

/**
 * One door, whatever authorises it. The staff door below uses a Hub session;
 * the Phase 2 volunteer door (/api/scan/[token]) will be a second
 * implementation of this same interface, so the scanner, result card and
 * offline queue work unchanged.
 */
export type DoorClient = {
  stats(init?: Init): Promise<DoorStats>;
  search(query: string, init?: Init): Promise<Guest[]>;
  checkIn(code: string, init?: Init): Promise<ScanOutcome>;
  undo(ticketId: string, init?: Init): Promise<void>;
};

export function staffDoorClient(apiFetch: ApiFetch, eventId: string): DoorClient {
  const path = doorPath(eventId);
  return {
    stats: (init) => apiFetch(`${path}?stats=1`, { ...init, schema: doorStatsSchema }),
    search: async (query, init) =>
      (await apiFetch(`${path}?q=${encodeURIComponent(query)}`, { ...init, schema: guestsSchema })).guests,
    checkIn: (code, init) => apiFetch(path, { ...init, method: "POST", body: { code }, schema: scanOutcomeSchema }),
    undo: async (ticketId, init) => {
      await apiFetch(path, { ...init, method: "POST", body: { undo: ticketId }, schema: undoResultSchema });
    },
  };
}
