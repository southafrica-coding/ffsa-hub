// Test data for the Tickets slice (imported by tests only).

import { meSchema, type Me } from "@/lib/api";

import { myTicketsSchema, type MyTickets } from "../api";

export const NOW = new Date(2026, 10, 3, 9, 0, 0); // Tue 3 Nov 2026, 09:00 local

export function makeMe(over: { roles?: string[]; direct?: string[]; viaRole?: string[] } = {}): Me {
  return meSchema.parse({
    user: { id: "u1", email: "jo@example.org" },
    profile: { firstName: "Sample", lastName: "Person", preferredName: null, avatarUrl: null, isActive: true },
    roles: (over.roles ?? []).map((name) => ({ name, scopeType: null, scopeId: null })),
    permissions: [
      ...(over.direct ?? []).map((key) => ({ key, scopeType: null, scopeId: null, source: "direct" })),
      ...(over.viaRole ?? []).map((key) => ({ key, scopeType: null, scopeId: null, source: "role" })),
    ],
    serverTime: NOW.toISOString(),
  });
}

const event = (id: string, title: string, startDate: string, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  startDate,
  startTime: "18:00:00",
  endDate: null,
  endTime: null,
  location: "Cape Town",
  status: "published",
  ...extra,
});

export function makeTickets(over: Partial<{ tickets: unknown[]; registrations: unknown[] }> = {}): MyTickets {
  return myTicketsSchema.parse({
    tickets: over.tickets ?? [
      {
        id: "t-up",
        code: "AbCdEfGhIjK",
        status: "valid",
        checkedInAt: null,
        ticketTypeName: "General",
        holderName: "Sample Person 199",
        waiver: { required: false, signed: false, signedAt: null, title: null, hasDocument: false },
        event: event("e1", "Send Night", "2026-11-20"),
      },
      {
        id: "t-past",
        code: "PastCode123",
        status: "checked_in",
        checkedInAt: "2026-10-01T16:05:00.000Z",
        ticketTypeName: "General",
        holderName: "Sample Person 199",
        waiver: { required: false, signed: false, signedAt: null, title: null, hasDocument: false },
        event: event("e0", "Ministry Night", "2026-10-01"),
      },
    ],
    registrations: over.registrations ?? [],
    serverTime: NOW.toISOString(),
  });
}

export const ticketEvent = event;
