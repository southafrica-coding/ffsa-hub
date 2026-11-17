import { describe, expect, it } from "vitest";

import { PRAYER_ROOM_VENUE_SLUG } from "@/lib/prayer-room/venue";
import {
  AUDITORIUM_BOOKED_LABEL,
  auditoriumClosure,
  auditoriumClosuresToDraw,
  bandMoveLossMirror,
  blockoutClosure,
  closureCovering,
  closureRangeTooLong,
  isCalendarDate,
  johannesburgDate,
  remainderSegments,
  type RoomClosure,
} from "./room-closure";

const NOV16 = "2026-11-16";

function booking(over: Partial<Parameters<typeof auditoriumClosure>[0]> = {}) {
  return auditoriumClosure({
    id: "551d5dfb",
    venueSlug: PRAYER_ROOM_VENUE_SLUG,
    status: "approved",
    booking_date: NOV16,
    end_date: null,
    setup_time: null,
    start_time: "16:00",
    end_time: "17:15",
    setdown_time: null,
    ...over,
  });
}

function covers(c: RoomClosure | null, date: string, start: string, end: string) {
  expect(c).not.toBeNull();
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return closureCovering([c!], date, sh * 60 + sm, eh * 60 + em);
}

describe("approved auditorium bookings close the prayer room", () => {
  it("blocks the 16 Nov 2026 16:00–17:15 auditorium booking across practice rows", () => {
    const c = booking();
    expect(c).toMatchObject({
      id: "auditorium:551d5dfb",
      block_date: NOV16,
      end_date: NOV16,
      start_time: "16:00",
      end_time: "17:15",
      label: AUDITORIUM_BOOKED_LABEL,
      source: "auditorium",
    });
    expect(c).not.toHaveProperty("title");
    expect(covers(c, NOV16, "16:00", "16:30")?.label).toBe(AUDITORIUM_BOOKED_LABEL);
    expect(covers(c, NOV16, "16:30", "17:00")).not.toBeNull();
    expect(covers(c, NOV16, "17:00", "17:30")).not.toBeNull();
  });

  it("treats an edge that only touches as free", () => {
    const c = booking();
    expect(covers(c, NOV16, "17:15", "17:45")).toBeNull();
    expect(covers(c, NOV16, "15:30", "16:00")).toBeNull();
  });

  it("catches a partial overlap, a slot inside the booking, and a booking inside the slot", () => {
    const c = booking();
    expect(covers(c, NOV16, "17:00", "17:45")).not.toBeNull();
    expect(covers(c, NOV16, "16:30", "17:00")).not.toBeNull();
    expect(covers(c, NOV16, "15:00", "18:00")).not.toBeNull();
    const tiny = booking({ start_time: "16:10", end_time: "16:20" });
    expect(covers(tiny, NOV16, "16:00", "16:30")).not.toBeNull();
  });

  it("extends the window by setup and set-down", () => {
    const c = booking({
      setup_time: "15:30",
      start_time: "16:00",
      end_time: "17:00",
      setdown_time: "17:30",
    });
    expect(c).toMatchObject({ start_time: "15:30", end_time: "17:30" });
    expect(covers(c, NOV16, "15:30", "16:00")).not.toBeNull();
    expect(covers(c, NOV16, "17:00", "17:30")).not.toBeNull();
    expect(covers(c, NOV16, "15:00", "15:30")).toBeNull();
    expect(covers(c, NOV16, "17:30", "18:00")).toBeNull();
  });

  it("does not let a later setup shrink the window, and keeps the later end", () => {
    const c = booking({
      setup_time: "16:30",
      start_time: "16:00",
      end_time: "17:15",
      setdown_time: "17:00",
    });
    expect(c).toMatchObject({ start_time: "16:00", end_time: "17:15" });
    expect(covers(c, NOV16, "16:00", "16:30")).not.toBeNull();
  });

  it("runs an overnight set-down through 24:00 on that day", () => {
    const c = booking({
      setup_time: "22:00",
      start_time: "22:30",
      end_time: "23:00",
      setdown_time: "01:00",
    });
    expect(c).toMatchObject({ start_time: "22:00", end_time: "24:00" });
    expect(covers(c, NOV16, "23:00", "24:00")).not.toBeNull();
    expect(covers(c, NOV16, "16:00", "17:30")).toBeNull();
    expect(covers(c, NOV16, "21:30", "22:00")).toBeNull();
    // The teardown's 01:00 is stored on the 16th. The morning of the 17th stays open.
    expect(covers(c, "2026-11-17", "00:00", "01:00")).toBeNull();
  });

  it("overlaps a practice row the booking only partly covers", () => {
    const c = booking({ start_time: "16:45", end_time: "17:15" });
    expect(covers(c, NOV16, "16:30", "17:00")).not.toBeNull();
    expect(covers(c, NOV16, "17:15", "17:45")).toBeNull();
  });

  it("uses the event times when setup or set-down is missing", () => {
    expect(booking({ setup_time: "15:45", setdown_time: null })).toMatchObject({
      start_time: "15:45",
      end_time: "17:15",
    });
    expect(booking({ setup_time: null, setdown_time: "17:45" })).toMatchObject({
      start_time: "16:00",
      end_time: "17:45",
    });
  });

  it("does not block pending, denied, or cancelled bookings", () => {
    for (const status of ["pending", "denied", "cancelled", "declined"]) {
      expect(booking({ status })).toBeNull();
    }
  });

  it("ignores every venue except the auditorium", () => {
    expect(booking({ venueSlug: "upstairs-space" })).toBeNull();
    expect(booking({ venueSlug: "molen-st" })).toBeNull();
  });

  it("holds a multi-day booking for the whole of each day, and not the day after", () => {
    const c = booking({
      booking_date: "2026-11-16",
      end_date: "2026-11-18",
      start_time: "16:00",
      end_time: "17:15",
    });
    expect(c).toMatchObject({ start_time: null, end_time: null, end_date: "2026-11-18" });
    expect(covers(c, "2026-11-16", "05:00", "06:00")).not.toBeNull();
    expect(covers(c, "2026-11-17", "16:00", "16:30")).not.toBeNull();
    expect(covers(c, "2026-11-18", "23:00", "23:30")).not.toBeNull();
    expect(covers(c, "2026-11-15", "16:00", "17:30")).toBeNull();
    expect(covers(c, "2026-11-19", "00:00", "01:00")).toBeNull();
  });

  it("treats a booking with no times as the whole day", () => {
    const c = booking({ start_time: null, end_time: null });
    expect(c).toMatchObject({ start_time: null, end_time: null });
    expect(covers(c, NOV16, "16:00", "16:30")).not.toBeNull();
  });
});

describe("Africa/Johannesburg date boundaries", () => {
  it("reads 22:00 UTC on the 16th as the 17th in Johannesburg", () => {
    expect(johannesburgDate(new Date("2026-11-16T22:00:00Z"))).toBe("2026-11-17");
    expect(johannesburgDate(new Date("2026-11-16T21:59:00Z"))).toBe("2026-11-16");
  });

  it("keeps a stored booking on its calendar date instead of the UTC date", () => {
    // 16:00 SAST is 14:00 UTC the same calendar day. 00:30 SAST on the 17th
    // is 22:30 UTC on the 16th — the closure stays on the 17th.
    const afternoon = booking();
    expect(covers(afternoon, "2026-11-16", "16:00", "16:30")).not.toBeNull();
    expect(covers(afternoon, "2026-11-15", "16:00", "17:30")).toBeNull();

    const afterMidnight = booking({
      id: "midnight",
      booking_date: johannesburgDate(new Date("2026-11-16T22:30:00Z")),
      start_time: "00:00",
      end_time: "00:30",
    });
    expect(afterMidnight).toMatchObject({ block_date: "2026-11-17", start_time: "00:00", end_time: "00:30" });
    expect(covers(afterMidnight, "2026-11-16", "16:00", "17:30")).toBeNull();
    expect(covers(afterMidnight, "2026-11-17", "00:00", "00:30")).not.toBeNull();
    expect(covers(afterMidnight, "2026-11-17", "00:30", "01:00")).toBeNull();
  });
});

describe("band-move remainders", () => {
  const closure: RoomClosure = {
    id: "auditorium:night",
    block_date: NOV16,
    end_date: NOV16,
    start_time: "17:00",
    end_time: "17:30",
    label: AUDITORIUM_BOOKED_LABEL,
    source: "auditorium",
  };

  it("drops the leftover that sits inside a closure and keeps the free side", () => {
    expect(remainderSegments(16 * 60, 17 * 60 + 30, 16 * 60 + 30, 17 * 60, [closure], NOV16)).toEqual([
      { start: 16 * 60, end: 16 * 60 + 30 },
    ]);
  });

  it("keeps both sides when neither overlaps a closure", () => {
    expect(remainderSegments(16 * 60, 17 * 60 + 30, 16 * 60 + 30, 17 * 60, [], NOV16)).toEqual([
      { start: 16 * 60, end: 16 * 60 + 30 },
      { start: 17 * 60, end: 17 * 60 + 30 },
    ]);
  });

  it("keeps nothing when the only leftover is inside the closure", () => {
    expect(remainderSegments(16 * 60 + 30, 17 * 60 + 30, 16 * 60 + 30, 17 * 60, [closure], NOV16)).toEqual([]);
  });

  it("says the rest is closed and widens the loss to cover the dropped piece", () => {
    const loss = bandMoveLossMirror(16 * 60, 17 * 60 + 30, 16 * 60 + 30, 17 * 60, [closure], NOV16);
    expect(loss.kept).toEqual([{ start: 16 * 60, end: 16 * 60 + 30 }]);
    expect(loss.lostStart).toBe(16 * 60 + 30);
    expect(loss.lostEnd).toBe(17 * 60 + 30);
    expect(loss.closedNote).toBe("The rest is closed for an Auditorium booking.");
  });

  it("leaves the loss as the band overlap when both sides are kept", () => {
    const loss = bandMoveLossMirror(16 * 60, 17 * 60 + 30, 16 * 60 + 30, 17 * 60, [], NOV16);
    expect(loss.lostStart).toBe(16 * 60 + 30);
    expect(loss.lostEnd).toBe(17 * 60);
    expect(loss.closedNote).toBe("");
  });
});

describe("wall hatching", () => {
  it("draws an auditorium booking once when a block-out or a pending suggestion already shows it", () => {
    const rows = [{ id: "auditorium:aaa" }, { id: "auditorium:bbb" }];
    expect(auditoriumClosuresToDraw(rows, ["aaa"])).toEqual([{ id: "auditorium:bbb" }]);
    expect(auditoriumClosuresToDraw(rows, ["bbb"])).toEqual([{ id: "auditorium:aaa" }]);
    expect(auditoriumClosuresToDraw(rows, [])).toEqual(rows);
  });
});

describe("calendar dates", () => {
  it("rejects a day that is not on the calendar", () => {
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-28")).toBe(true);
    expect(isCalendarDate("2026-13-01")).toBe(false);
  });
});

describe("room-closure date cap", () => {
  it("allows 366 days and rejects a longer span", () => {
    expect(closureRangeTooLong("2026-01-01", "2027-01-02")).toBe(false);
    expect(closureRangeTooLong("2024-01-01", "2025-01-01")).toBe(false);
    expect(closureRangeTooLong("2026-01-01", "2027-01-03")).toBe(true);
    expect(closureRangeTooLong("2024-01-01", "2025-01-02")).toBe(true);
  });
});

describe("prayer room block-outs", () => {
  it("closes a timed window and leaves a touching neighbour free", () => {
    const c = blockoutClosure({
      id: "bo-1",
      block_date: NOV16,
      end_date: NOV16,
      start_time: "16:00:00",
      end_time: "17:00:00",
      reason: "Sound check",
    });
    expect(c).toMatchObject({ id: "blockout:bo-1", start_time: "16:00", end_time: "17:00", label: "Sound check" });
    expect(covers(c, NOV16, "16:30", "17:00")).not.toBeNull();
    expect(covers(c, NOV16, "17:00", "17:30")).toBeNull();
  });

  it("closes the whole day when the block-out has no times", () => {
    const c = blockoutClosure({
      id: "bo-2",
      block_date: NOV16,
      end_date: "2026-11-17",
      start_time: null,
      end_time: null,
      reason: null,
    });
    expect(c.label).toBe("Blocked");
    expect(covers(c, NOV16, "05:00", "06:00")).not.toBeNull();
    expect(covers(c, "2026-11-17", "16:00", "16:30")).not.toBeNull();
    expect(covers(c, "2026-11-18", "16:00", "16:30")).toBeNull();
  });
});
