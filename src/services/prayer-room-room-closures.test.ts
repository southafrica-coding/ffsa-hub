import { describe, expect, it, vi } from "vitest";

import { createFakeSupabase, filterValue, type FakeQuery } from "@/lib/testing/fake-supabase";
import { AUDITORIUM_BOOKED_LABEL } from "@/lib/prayer-room/room-closure";
import { getPracticeWeek } from "@/services/prayer-room-practice";
import { getAuditoriumClosures } from "@/services/prayer-room-room-closures";

const APPROVED = {
  id: "551d5dfb",
  booking_date: "2026-11-16",
  end_date: null,
  setup_time: "15:45:00",
  start_time: "16:00:00",
  end_time: "17:15:00",
  setdown_time: "17:30:00",
  status: "approved",
  title: "Send Night",
  requester_name: "Hidden",
};

function world(bookings: unknown[] | { message: string }, blockouts: unknown[] = []) {
  return (q: FakeQuery) => {
    if (q.table === "practice_settings") return { data: null };
    if (q.table === "practice_stations") return { data: [] };
    if (q.table === "practice_bookings") return { data: [] };
    if (q.table === "prayer_room_qualifications") return { data: [] };
    if (q.table === "users") return { data: [] };
    if (q.table === "venues") return { data: { id: "venue-auditorium" } };
    if (q.table === "venue_bookings") {
      expect(q.columns ?? "").not.toMatch(/title|description|requester_name|point_person/);
      expect(filterValue(q, "eq", "status")).toBe("approved");
      if (!Array.isArray(bookings)) return { data: null, error: bookings };
      return { data: bookings };
    }
    if (q.table === "prayer_room_blockouts") return { data: blockouts };
    return { data: [] };
  };
}

describe("getAuditoriumClosures", () => {
  it("widens the window by setup and set-down and drops the title", async () => {
    const fake = createFakeSupabase({ resolve: world([APPROVED]) });
    const { data, error } = await getAuditoriumClosures(fake.client, "2026-11-16", "2026-11-20");
    expect(error).toBeNull();
    expect(data).toEqual([
      {
        id: "auditorium:551d5dfb",
        block_date: "2026-11-16",
        end_date: "2026-11-16",
        start_time: "15:45",
        end_time: "17:30",
        label: AUDITORIUM_BOOKED_LABEL,
        source: "auditorium",
      },
    ]);
    expect(JSON.stringify(data)).not.toMatch(/Send Night|Hidden/);
  });

  it("drops a pending row that the query failed to filter", async () => {
    const fake = createFakeSupabase({ resolve: world([{ ...APPROVED, status: "pending" }]) });
    const { data, error } = await getAuditoriumClosures(fake.client, "2026-11-16", "2026-11-20");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("returns the error instead of throwing when the booking read fails", async () => {
    const fake = createFakeSupabase({ resolve: world({ message: "permission denied for table venue_bookings" }) });
    const { data, error } = await getAuditoriumClosures(fake.client, "2026-11-16", "2026-11-20");
    expect(data).toEqual([]);
    expect(error?.message).toMatch(/permission denied/);
  });
});

describe("getPracticeWeek closures", () => {
  it("reads bookings on the admin client and block-outs on the caller's client", async () => {
    const user = createFakeSupabase({
      resolve: (q) => {
        if (q.table === "venues" || q.table === "venue_bookings") {
          throw new Error("practice user read venue bookings directly");
        }
        return world([], [
          {
            id: "bo-1",
            block_date: "2026-11-18",
            end_date: "2026-11-18",
            start_time: "16:00:00",
            end_time: "17:00:00",
            reason: "Sound check",
          },
        ])(q);
      },
    });
    const admin = createFakeSupabase({ resolve: world([APPROVED]) });
    const week = await getPracticeWeek(user.client, admin.client, {
      anchor: "2026-11-16",
      userId: "me",
      canBook: true,
      isStaff: false,
    });
    expect(week.days[0]).toBe("2026-11-16");
    expect(week.closures.map((c) => [c.source, c.label, c.start_time, c.end_time])).toEqual([
      ["auditorium", AUDITORIUM_BOOKED_LABEL, "15:45", "17:30"],
      ["blockout", "Sound check", "16:00", "17:00"],
    ]);
    expect(admin.queries.some((q) => q.table === "venue_bookings")).toBe(true);
    expect(user.queries.some((q) => q.table === "venue_bookings")).toBe(false);
  });

  it("logs a booking-read failure and still returns the week", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = createFakeSupabase({ resolve: world({ message: "connection reset" }) });
    const week = await getPracticeWeek(fake.client, fake.client, {
      anchor: "2026-11-16",
      userId: "me",
      canBook: true,
      isStaff: false,
    });
    expect(week.closures).toEqual([]);
    expect(week.days).toHaveLength(5);
    expect(spy).toHaveBeenCalledWith(
      "Auditorium bookings could not be loaded for practice",
      "connection reset"
    );
    spy.mockRestore();
  });
});
