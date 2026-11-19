import { describe, expect, it } from "vitest";
import {
  applicationState,
  daysBetween,
  describeDays,
  documentState,
  leadDaysFor,
} from "./status";

const TODAY = "2026-11-18";
const held = (expires_on: string | null, extra: Record<string, unknown> = {}) => ({
  status: "held",
  expires_on,
  renew_lead_days: null,
  ...extra,
});

describe("daysBetween", () => {
  it("counts calendar days", () => {
    expect(daysBetween("2026-11-18", "2026-11-19")).toBe(1);
    expect(daysBetween("2026-11-18", "2026-11-17")).toBe(-1);
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2); // leap year
  });
  it("refuses bad dates rather than guessing", () => {
    expect(() => daysBetween("2026-11-18", "soon")).toThrow();
  });
});

describe("leadDaysFor", () => {
  it("uses the document's, then the type's, then 60", () => {
    expect(leadDaysFor({ renew_lead_days: 10, type_lead_days: 90 })).toBe(10);
    expect(leadDaysFor({ renew_lead_days: null, type_lead_days: 90 })).toBe(90);
    expect(leadDaysFor({ renew_lead_days: null, type_lead_days: null })).toBe(60);
    expect(leadDaysFor({ renew_lead_days: 0, type_lead_days: 90 })).toBe(0);
  });
});

describe("documentState", () => {
  it("expired: the day after the expiry date", () => {
    expect(documentState(held("2026-11-17"), TODAY)).toMatchObject({ state: "expired", daysLeft: -1 });
  });
  it("still counts on its expiry day", () => {
    expect(documentState(held("2026-11-18"), TODAY)).toMatchObject({ state: "expiring", daysLeft: 0 });
  });
  it("expiring: inside the lead window, edge included", () => {
    expect(documentState(held("2027-01-17"), TODAY).state).toBe("expiring"); // 60 days
    expect(documentState(held("2027-01-18"), TODAY).state).toBe("valid"); // 61 days
  });
  it("uses the type's lead time", () => {
    expect(documentState(held("2027-02-01", { type_lead_days: 90 }), TODAY).state).toBe("expiring");
  });
  it("in hand when an application is open or the status says applying", () => {
    expect(documentState(held("2026-12-01", { has_open_application: true }), TODAY).state).toBe("in_hand");
    expect(documentState(held("2026-12-01", { status: "applying" }), TODAY).state).toBe("in_hand");
  });
  it("an expired document stays expired with a renewal under way", () => {
    expect(documentState(held("2026-11-01", { has_open_application: true }), TODAY).state).toBe("expired");
  });
  it("no expiry date", () => {
    expect(documentState(held(null), TODAY)).toMatchObject({ state: "no_expiry", daysLeft: null });
    expect(documentState(held(null, { status: "applying" }), TODAY).state).toBe("in_hand");
  });
  it("not held is missing, unless being applied for", () => {
    expect(documentState(held(null, { status: "not_held" }), TODAY).state).toBe("missing");
    expect(documentState(held(null, { status: "not_held", has_open_application: true }), TODAY).state).toBe("in_hand");
  });
  it("replaced or cancelled documents are never flagged", () => {
    expect(documentState(held("2020-01-01", { superseded_by: "x" }), TODAY).state).toBe("inactive");
    expect(documentState(held("2020-01-01", { status: "superseded" }), TODAY).state).toBe("inactive");
    expect(documentState(held("2020-01-01", { status: "cancelled" }), TODAY).state).toBe("inactive");
  });
});

describe("applicationState", () => {
  const app = (status: string, lodge_by: string | null = null, expected_on: string | null = null) => ({
    status,
    lodge_by,
    expected_on,
  });
  it("closed", () => {
    for (const s of ["approved", "refused", "withdrawn"]) expect(applicationState(app(s, "2020-01-01"), TODAY)).toBe("closed");
  });
  it("late, due soon, open before lodging", () => {
    expect(applicationState(app("planned", "2026-11-17"), TODAY)).toBe("late");
    expect(applicationState(app("gathering", "2026-12-02"), TODAY)).toBe("due_soon"); // 14 days
    expect(applicationState(app("gathering", "2026-12-03"), TODAY)).toBe("open");
    expect(applicationState(app("planned"), TODAY)).toBe("open");
  });
  it("after lodging: waiting, then overdue past the expected date", () => {
    expect(applicationState(app("submitted", "2026-01-01", "2026-12-01"), TODAY)).toBe("waiting");
    expect(applicationState(app("waiting", null, "2026-11-17"), TODAY)).toBe("overdue");
    expect(applicationState(app("waiting", null, "2026-11-18"), TODAY)).toBe("waiting");
  });
});

describe("describeDays", () => {
  it("says it plainly", () => {
    expect(describeDays(null)).toBe("No expiry date");
    expect(describeDays(0)).toBe("Expires today");
    expect(describeDays(1)).toBe("Expires tomorrow");
    expect(describeDays(-1)).toBe("Expired yesterday");
    expect(describeDays(-12)).toBe("Expired 12 days ago");
    expect(describeDays(45)).toBe("45 days left");
  });
});
