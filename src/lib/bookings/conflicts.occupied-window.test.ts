import { describe, expect, it } from "vitest";

import { occupiedWindow, type BookingWindow } from "./conflicts";

function booking(over: Partial<BookingWindow> = {}): BookingWindow {
  return {
    id: "b",
    venue_id: "auditorium",
    booking_date: "2026-11-16",
    end_date: null,
    setup_time: null,
    start_time: "16:00",
    end_time: "17:15",
    setdown_time: null,
    status: "approved",
    ...over,
  };
}

describe("occupiedWindow", () => {
  it("uses the event when setup and set-down are absent", () => {
    expect(occupiedWindow(booking())).toEqual({ start: 16 * 60, end: 17 * 60 + 15 });
  });

  it("keeps the earlier start when setup is after the event start", () => {
    expect(
      occupiedWindow(booking({ setup_time: "16:30", start_time: "16:00", end_time: "17:15", setdown_time: "17:00" }))
    ).toEqual({ start: 16 * 60, end: 17 * 60 + 15 });
  });

  it("runs a set-down earlier than setup through the end of the day", () => {
    expect(
      occupiedWindow(booking({ setup_time: "22:00", start_time: "22:30", end_time: "23:00", setdown_time: "01:00" }))
    ).toEqual({ start: 22 * 60, end: 24 * 60 });
  });

  it("still widens a normal booking from setup through set-down", () => {
    expect(
      occupiedWindow(booking({ setup_time: "15:30", start_time: "16:00", end_time: "17:00", setdown_time: "17:30" }))
    ).toEqual({ start: 15 * 60 + 30, end: 17 * 60 + 30 });
  });
});
