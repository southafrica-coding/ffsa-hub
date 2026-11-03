import { describe, expect, it } from "vitest";
import {
  buildMyTicketsPayload,
  checkInWindowStart,
  shapeWaiver,
  type TicketRow,
} from "./my-tickets";

const NOW = new Date("2026-11-03T08:00:00.000Z");

const event = (id: string, start: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Event ${id}`,
  start_date: start,
  start_time: "18:00:00",
  end_date: null,
  end_time: null,
  location: "Cape Town",
  status: "published",
  ...extra,
});

const ticket = (over: Partial<TicketRow> = {}): TicketRow => ({
  id: "t1",
  code: "AbCdEfGhIjK",
  status: "valid",
  checked_in_at: null,
  order_id: "o1",
  waiver_signature: null,
  ticket_types: { name: "General", waiver: null },
  events: event("e1", "2026-12-01"),
  ...over,
});

const ORDERS = [{ id: "o1", buyer_first_name: "Thandi", buyer_last_name: "Mokoena" }];

describe("buildMyTicketsPayload", () => {
  it("shapes tickets with holder, tier and event, and no buyer contact details", () => {
    const out = buildMyTicketsPayload({ orders: ORDERS, tickets: [ticket()], registrations: [], now: NOW });
    expect(out.serverTime).toBe(NOW.toISOString());
    expect(out.tickets).toEqual([
      {
        id: "t1",
        code: "AbCdEfGhIjK",
        status: "valid",
        checkedInAt: null,
        ticketTypeName: "General",
        holderName: "Thandi Mokoena",
        waiver: { required: false, signed: false, signedAt: null, title: null, hasDocument: false },
        event: {
          id: "e1",
          title: "Event e1",
          startDate: "2026-12-01",
          startTime: "18:00:00",
          endDate: null,
          endTime: null,
          location: "Cape Town",
          status: "published",
        },
      },
    ]);
    expect(JSON.stringify(out)).not.toMatch(/email|phone|cents/);
  });

  it("drops tickets whose order isn't the caller's or whose event is gone", () => {
    const out = buildMyTicketsPayload({
      orders: ORDERS,
      tickets: [ticket({ id: "x", order_id: "someone-else" }), ticket({ id: "y", events: null })],
      registrations: [],
      now: NOW,
    });
    expect(out.tickets).toEqual([]);
  });

  it("sorts by event date and maps unknown statuses to void", () => {
    const out = buildMyTicketsPayload({
      orders: ORDERS,
      tickets: [
        ticket({ id: "late", events: event("e2", "2027-01-05") }),
        ticket({ id: "early", status: "weird", events: event("e3", "2026-11-10") }),
      ],
      registrations: [],
      now: NOW,
    });
    expect(out.tickets.map((t) => t.id)).toEqual(["early", "late"]);
    expect(out.tickets[0].status).toBe("void");
  });

  it("lists only ticketless registrations", () => {
    const out = buildMyTicketsPayload({
      orders: ORDERS,
      tickets: [ticket()],
      registrations: [
        { id: "r-ticketed", status: "confirmed", order_id: "o1", events: event("e1", "2026-12-01") },
        { id: "r-free", status: "pending", order_id: null, events: event("e9", "2026-11-20") },
        { id: "r-gone", status: "confirmed", order_id: null, events: null },
      ],
      now: NOW,
    });
    expect(out.registrations).toEqual([
      expect.objectContaining({ id: "r-free", status: "pending", event: expect.objectContaining({ id: "e9" }) }),
    ]);
  });
});

describe("shapeWaiver", () => {
  it("reports status only, never guardian/minor details", () => {
    const w = shapeWaiver(
      { enabled: true, title: "Camp consent" },
      {
        signed_at: "2026-10-01T10:00:00Z",
        title: "Camp consent v2",
        guardian_name: "Parent",
        minor_name: "Kid",
        ip: "1.2.3.4",
        certificate_path: "certs/x.pdf",
      }
    );
    expect(w).toEqual({
      required: true,
      signed: true,
      signedAt: "2026-10-01T10:00:00Z",
      title: "Camp consent v2",
      hasDocument: true,
    });
  });

  it("required but unsigned", () => {
    expect(shapeWaiver({ enabled: true, title: "Form" }, null)).toEqual({
      required: true,
      signed: false,
      signedAt: null,
      title: "Form",
      hasDocument: false,
    });
  });

  it("tolerates junk", () => {
    expect(shapeWaiver("nope", [1, 2])).toMatchObject({ required: false, signed: false });
  });
});

describe("checkInWindowStart", () => {
  it("is the day before, as YYYY-MM-DD", () => {
    expect(checkInWindowStart(NOW)).toBe("2026-11-02");
  });
});
