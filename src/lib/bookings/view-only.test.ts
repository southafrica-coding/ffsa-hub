import { describe, expect, it } from "vitest";
import type { BookingAccess } from "@/services/bookings";
import { VIEW_ONLY_NOTE, canCreateBooking, showViewOnlyNote } from "./view-only";

const base: BookingAccess = {
  isAdmin: false,
  canView: true,
  canRequest: false,
  canApprove: false,
  canManage: false,
};

describe("view-only note on Space Bookings", () => {
  it("shows for someone who can see the calendar but not book", () => {
    expect(canCreateBooking(base)).toBe(false);
    expect(showViewOnlyNote(base)).toBe(true);
  });

  it.each(["canRequest", "canApprove", "canManage"] as const)(
    "hides once %s lets them book",
    (key) => {
      const access = { ...base, [key]: true };
      expect(canCreateBooking(access)).toBe(true);
      expect(showViewOnlyNote(access)).toBe(false);
    }
  );

  it("hides for someone who cannot see the calendar at all", () => {
    expect(showViewOnlyNote({ ...base, canView: false })).toBe(false);
  });

  it("names who can book, without telling them they did something wrong", () => {
    expect(VIEW_ONLY_NOTE).toMatch(/ministry leaders and school \/ program leaders/);
    expect(VIEW_ONLY_NOTE).not.toMatch(/not allowed|denied|permission|request access/i);
  });
});
