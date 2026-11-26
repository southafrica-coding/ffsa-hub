import { describe, expect, it } from "vitest";

import { bookingsConflict, type BookingWindow } from "./conflicts";
import { approveLead, blockLead, describeConflict } from "./conflict-messages";

// The clash rule the API and the database (migration 403) both enforce.

function b(over: Partial<BookingWindow> = {}): BookingWindow {
  return {
    id: "a",
    venue_id: "office-2",
    booking_date: "2026-12-01",
    end_date: null,
    setup_time: null,
    start_time: "11:30",
    end_time: "13:00",
    setdown_time: null,
    status: "approved",
    ...over,
  };
}
const other = (over: Partial<BookingWindow>) => b({ id: "b", ...over });

describe("clash window edges", () => {
  it("allows back-to-back, either side", () => {
    expect(bookingsConflict(b(), other({ start_time: "13:00", end_time: "14:00" }))).toBe(false);
    expect(bookingsConflict(b(), other({ start_time: "10:00", end_time: "11:30" }))).toBe(false);
  });

  it("blocks a partial overlap", () => {
    expect(bookingsConflict(b(), other({ start_time: "12:30", end_time: "14:00" }))).toBe(true);
  });

  it("blocks one booking contained in another", () => {
    expect(bookingsConflict(b(), other({ start_time: "12:00", end_time: "12:30" }))).toBe(true);
    expect(bookingsConflict(b(), other({ start_time: "08:00", end_time: "17:00" }))).toBe(true);
  });

  it("widens by set-up and set-down", () => {
    expect(bookingsConflict(b(), other({ setup_time: "12:45", start_time: "13:15", end_time: "14:00" }))).toBe(true);
    expect(bookingsConflict(b({ setdown_time: "13:30" }), other({ start_time: "13:15", end_time: "14:00" }))).toBe(true);
    expect(bookingsConflict(b({ setdown_time: "13:30" }), other({ start_time: "13:30", end_time: "14:00" }))).toBe(false);
  });

  it("treats a multi-day booking as every whole day it spans", () => {
    const span = other({ booking_date: "2026-11-30", end_date: "2026-12-02", start_time: "08:00", end_time: "09:00" });
    expect(bookingsConflict(b(), span)).toBe(true);
    expect(bookingsConflict(b({ booking_date: "2026-12-03" }), span)).toBe(false);
  });

  it("treats a booking with no times as the whole day", () => {
    expect(bookingsConflict(b(), other({ start_time: null, end_time: null }))).toBe(true);
    expect(bookingsConflict(b(), other({ start_time: null, end_time: null, booking_date: "2026-12-02" }))).toBe(false);
  });

  it("runs an overnight booking to midnight on its own day only", () => {
    const late = other({ start_time: "22:00", end_time: "02:00" });
    expect(bookingsConflict(b({ start_time: "23:30", end_time: "23:45" }), late)).toBe(true);
    expect(bookingsConflict(b({ booking_date: "2026-12-02", start_time: "00:30", end_time: "01:30" }), late)).toBe(false);
  });

  it("ignores another space", () => {
    expect(bookingsConflict(b(), other({ venue_id: "auditorium" }))).toBe(false);
  });
});

describe("clash statuses", () => {
  it("never counts cancelled or denied bookings", () => {
    expect(bookingsConflict(b(), other({ status: "cancelled" }))).toBe(false);
    expect(bookingsConflict(b(), other({ status: "denied" }))).toBe(false);
  });

  it("counts a pending booking", () => {
    expect(bookingsConflict(b(), other({ status: "pending" }))).toBe(true);
  });
});

describe("clash message", () => {
  it("names who holds the space and when, and nothing else", () => {
    const c = describeConflict("2026-12-01", {
      ...b(),
      title: "SBS Staff Mtg",
      requester_name: "Riley Botha",
    });
    expect(blockLead([c], "Office 2")).toBe(
      'Office 2 is already booked by Riley Botha ("SBS Staff Mtg") on Tue 1 Dec 2026, 11:30 – 13:00. Talk to them, or pick another time.'
    );
  });

  it("shows the set-up-to-set-down window the space is actually held", () => {
    const c = describeConflict("2026-12-01", { ...b({ setup_time: "11:00", setdown_time: "13:30" }), title: "X" });
    expect(c.existingWindow).toBe("11:00 – 13:30");
    expect(describeConflict("2026-12-01", { ...b({ start_time: "22:00", end_time: "02:00" }), title: "X" }).existingWindow).toBe(
      "22:00 – midnight"
    );
    expect(describeConflict("2026-12-01", { ...b({ start_time: null, end_time: null }), title: "X" }).existingWindow).toBe("all day");
  });

  it("stays calm with no name and with several clashes", () => {
    const c = describeConflict("2026-12-01", { ...b(), title: "Prayer" });
    expect(blockLead([c], "Office 2")).toBe(
      'Office 2 is already booked ("Prayer") on Tue 1 Dec 2026, 11:30 – 13:00. Pick another time, or check with whoever looks after the space.'
    );
    expect(blockLead([c, c], "Office 2")).toMatch(/^Office 2 is already booked at 2 of those times\./);
    expect(blockLead([c], "Office 2")).not.toContain("!");
  });

  it("uses approval wording, not pick-another-time, for an approver", () => {
    const c = describeConflict("2026-12-01", {
      ...b(),
      title: "SBS Staff Mtg",
      requester_name: "Riley Botha",
    });
    expect(approveLead([c], "Office 2")).toBe(
      'Office 2 is already booked by Riley Botha ("SBS Staff Mtg") on Tue 1 Dec 2026, 11:30 – 13:00, so it can\'t be approved as it stands.'
    );
    expect(approveLead([c], "Office 2")).not.toContain("pick another time");
    expect(approveLead([c, c], "Office 2")).toBe(
      "Office 2 is already booked at 2 of those times, so they can't be approved as they stand. Each one is listed below."
    );
    expect(approveLead([c, c], "Office 2")).not.toContain("!");
  });
});
