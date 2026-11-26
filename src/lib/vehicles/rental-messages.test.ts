// The standard booking messages (Gideon, 24 Nov 2026): the agreed wording, for any vehicle.

import { describe, expect, it } from "vitest";
import { pickupDriverMessage, pickupPointMessage, returnBeforeMessage, returnDayMessage, toSlackText, toEmailHtml, type RentalContext } from "./rental-messages";
import { dueBackFrom, lastDayFrom, driverEmail, dueBackHint } from "./return-day";
import { planRentalSends, rentalRecipients, rentalMessagesOn, type RentalBooking, type RentalUser } from "./rental-schedule";

const ctx = (over: Partial<RentalContext> = {}): RentalContext => ({
  firstName: "Sam",
  bookingName: "Outreach",
  vehicles: [{ name: "Hyundai H1", reg: "AB 1 GP", fuel: "diesel" }],
  collect: "2026-11-30",
  lastDay: "2026-12-03",
  dueBack: "2026-12-04",
  bookingUrl: "https://hub/b/1",
  coordinator: { name: "Pieter", phone: "+27 00 000 0000" },
  ...over,
});
const all = (m: ReturnType<typeof pickupDriverMessage>) => toSlackText(m);

describe("the driver's pick-up message", () => {
  const t = all(pickupDriverMessage(ctx()));
  it("has driving in SA: left side, the speed limits as guidelines", () => {
    expect(t).toContain("We drive on the LEFT side of the road.");
    expect(t).toContain("only guidelines; always follow the signs");
    for (const s of ["*60 km/h* in town", "*30–40 km/h* in neighbourhoods", "*80–100 km/h* on the open road", "*120 km/h* on national highways"]) expect(t).toContain(s);
  });
  it("fills in the vehicle's fuel; never the wrong one", () => {
    expect(t).toContain("This vehicle takes DIESEL. Never put in anything else.");
    expect(all(pickupDriverMessage(ctx({ vehicles: [{ name: "Almera", fuel: "petrol" }] })))).toContain("PETROL (unleaded)");
  });
  it("emergencies: triangle 15–20 m, then call only the coordinator", () => {
    expect(t).toContain("15–20 m behind the vehicle");
    expect(t).toContain("call the Vehicle Coordinator straight away: Pieter, +27 00 000 0000");
    expect(t).not.toMatch(/10111|112\b|police/i);
  });
  it("says nothing about tips or a locknut key, nor known damage", () => {
    expect(t).not.toMatch(/tip|locknut|already aware|known damage/i);
  });
  it("says when it's due back: the day after the last day, before 12:00, washed and refuelled", () => {
    expect(t).toContain("*Friday, 4 December, before 12:00*: washed inside and out, with a full tank");
  });
});

describe("the point person's pick-up message", () => {
  it("names drivers we couldn't reach, and includes the driver instructions", () => {
    const t = all(pickupPointMessage(ctx({ drivers: [{ name: "Sam", reached: true }, { name: "Lee", reached: false }] })));
    expect(t).toContain("*Lee* has no email on the booking");
    expect(t).toContain("We drive on the LEFT side of the road.");
    expect(t).toContain("pick-ups are between 07:00 and 17:00");
  });
});

describe("the return messages", () => {
  it("the day before: Return early for Hub users; the coordinator's number for others", () => {
    expect(returnBeforeMessage(ctx({ canReturnEarly: true })).action).toMatchObject({ label: "Return early", id: "return-early" });
    expect(all(returnBeforeMessage(ctx({ canReturnEarly: false })))).toContain("contact the Vehicle Coordinator: Pieter, +27 00 000 0000");
  });
  it("the due-back day: wash, fill up, photos, the questions, before 12:00", () => {
    const t = all(returnDayMessage(ctx()));
    for (const s of ["due back *today, before 12:00*", "*Wash the vehicle*", "*Fill the tank* with DIESEL", "km reading", "Did any warning light come on?"]) expect(t).toContain(s);
  });
  it("renders as an email", () => {
    const html = toEmailHtml(returnDayMessage(ctx()), "https://hub");
    expect(html).toContain("<strong>Wash the vehicle</strong>");
    expect(html).not.toContain("*Wash");
  });
});

describe("the return day rule", () => {
  it("due back the day after the last day", () => {
    expect(dueBackFrom("2026-12-31")).toBe("2027-01-01");
    expect(lastDayFrom("2027-01-01")).toBe("2026-12-31");
    expect(dueBackHint("2026-12-03")).toBe("Due back Fri, 4 Dec, before 12:00: washed, refuelled and checked.");
  });
  it("driver emails are optional and tidied", () => {
    expect(driverEmail(" Sam@Example.org ")).toBe("sam@example.org");
    expect(driverEmail("not an email")).toBeNull();
    expect(driverEmail(undefined)).toBeNull();
  });
});

describe("who gets what", () => {
  const users = new Map<string, RentalUser>([["u1", { id: "u1", name: "Thandi M", firstName: "Thandi", email: "t@x.org", slackUserId: "U1" }]]);
  const b = (over: Partial<RentalBooking> = {}): RentalBooking => ({
    id: "b1", booking_name: "Trip", status: "approved", checkout_date: "2026-11-30", return_date: "2026-12-04", requested_by: "u1",
    requester_name: "Thandi M", requester_email: "t@x.org", vehicles: [{ name: "Almera", fuel: "petrol" }],
    drivers: [{ name: "Thandi M", email: null, user_id: "u1" }, { name: "Sam", email: "sam@x.org", user_id: null }, { name: "Lee", email: null, user_id: null }],
    ...over,
  });
  const plan = (today: string, phase: "pickup" | "return", bk = b()) => planRentalSends({ today, phase, bookings: [bk], users, coordinator: { name: "P", phone: "1" } });

  it("the person who booked is also a driver: one message, theirs", () => {
    expect(rentalRecipients(b(), users).map((r) => `${r.role}:${r.key}`)).toEqual(["point:u1", "driver:sam@x.org"]);
  });
  it("pick-up day: point person + reachable drivers", () => {
    expect(plan("2026-11-30", "pickup").sends.map((s) => `${s.kind}→${s.to.key}`)).toEqual(["pickup-point→u1", "pickup-driver→sam@x.org"]);
  });
  it("the day before and the due-back day; Return early only for Hub users", () => {
    const before = plan("2026-12-03", "return").sends;
    expect(before.map((s) => `${s.kind}→${s.to.key}:${s.ctx.canReturnEarly}`)).toEqual(["return-before→u1:true", "return-before→sam@x.org:false"]);
    const day = plan("2026-12-04", "return");
    expect(day.sends.map((s) => s.kind)).toEqual(["return-day", "return-day"]);
    expect(day.dueBack.map((x) => x.id)).toEqual(["b1"]);
  });
  it("no reminder on the pick-up day itself (a one-day booking), nothing once returned or if not approved", () => {
    expect(plan("2026-11-30", "return", b({ return_date: "2026-12-01" })).sends).toEqual([]);
    expect(plan("2026-12-04", "return", b({ returned_at: "2026-12-04T08:00:00Z" })).sends).toEqual([]);
    expect(plan("2026-11-30", "pickup", b({ status: "pending" })).sends).toEqual([]);
  });
  it("off unless switched on, and only in production", () => {
    expect(rentalMessagesOn({})).toBe(false);
    expect(rentalMessagesOn({ VEHICLE_RENTAL_MESSAGES_ENABLED: "1" })).toBe(false);
    expect(rentalMessagesOn({ VEHICLE_RENTAL_MESSAGES_ENABLED: "1", VERCEL_ENV: "production" })).toBe(true);
  });
});
