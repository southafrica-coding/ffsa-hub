import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { crowdedRuns } from "./dashboard";
import { calendarCopy, holidayCopy, projectionCopy, rangeLabel, statusLabel } from "./format";
import { nextSelection } from "./blockouts-editor";
import { monthlyDays } from "./person-view";
import { draftBody, PreviewCount } from "./request-form";
import type { PmPreview } from "./types";

const preview: PmPreview = {
  // Thu 10 – Fri 18 Dec 2026: 7 weekdays, Wed 16 Dec is a holiday, so 6 counted.
  days: 6,
  by_year: { "2026": 6 },
  calendar_days: 9,
  weekend_days: ["2026-12-12", "2026-12-13"],
  holidays: [{ day: "2026-12-16", name: "Day of Reconciliation" }],
  no_working_days: false,
  usage: [],
  also_away: [],
  cover_conflicts: [],
  goes_to: { via: "leader", people: [] },
};

describe("preview copy", () => {
  it("says a weekday holiday is in the span but not counted as leave", () => {
    const text = holidayCopy(preview.holidays)!;
    expect(text).toContain("Wed 16 Dec (Day of Reconciliation)");
    expect(text).toContain("isn't counted as leave");
    expect(text).not.toMatch(/counts as (a )?leave/i);
    expect(holidayCopy([])).toBeNull();
  });

  it("counts weekdays and names the days that aren't counted", () => {
    expect(calendarCopy(preview)).toBe("9 calendar days. Sat 12, Sun 13 and Wed 16 aren't counted.");
    const html = renderToStaticMarkup(createElement(PreviewCount, { preview }));
    expect(html).toContain(">6<");
    expect(html).toContain("weekdays");
    expect(html).toContain("PUBLIC HOLIDAY");
    expect(html).not.toMatch(/counts as (a )?leave day/i);
    expect(html).not.toMatch(/holidays? count(s)? as leave/i);
  });

  it("warns when a range has no weekdays to take off", () => {
    const html = renderToStaticMarkup(
      createElement(PreviewCount, { preview: { ...preview, days: 0, by_year: {}, no_working_days: true, holidays: [] } })
    );
    expect(html).toContain("aren&#x27;t counted as leave");
  });

  it("explains the guideline without blocking", () => {
    expect(projectionCopy({ used: 8, this_request: 7, total: 15, guideline: 15, over: 0 })).toContain("guideline exactly");
    expect(projectionCopy({ used: 3, this_request: 4, total: 7, guideline: 5, over: 2 })).toBe(
      "This goes 2 over the guideline. You can still ask; your leader sees the totals."
    );
    expect(projectionCopy({ used: 0, this_request: 2, total: 2, guideline: null, over: null })).toContain("no yearly guideline");
  });
});

describe("labels", () => {
  it("calls a declined request Declined", () => {
    expect(statusLabel("declined")).toBe("Declined");
    expect(statusLabel("cancelled")).toBe("Cancelled");
  });

  it("writes ranges like the mockups", () => {
    expect(rangeLabel("2026-12-10", "2026-12-18")).toBe("Thu 10 – Fri 18 Dec");
    expect(rangeLabel("2026-11-26", "2026-12-01")).toBe("Thu 26 Nov – Tue 1 Dec");
    expect(rangeLabel("2026-11-20", "2026-11-20")).toBe("Fri 20 Nov");
    expect(rangeLabel("2026-12-30", "2027-01-08")).toBe("Wed 30 Dec 2026 – Fri 8 Jan 2027");
  });
});

describe("draftBody", () => {
  const base = { typeId: "t", start: "2026-12-10", end: "2026-12-18", notes: " ", coverId: "", coverNote: "" };
  it("uses one part on both ends of a one-day request", () => {
    expect(draftBody({ ...base, end: base.start, startPart: "am", endPart: "full" })).toMatchObject({ start_part: "am", end_part: "am" });
  });
  it("only lets several days start pm and end am", () => {
    expect(draftBody({ ...base, startPart: "am", endPart: "pm" })).toMatchObject({ start_part: "full", end_part: "full" });
    expect(draftBody({ ...base, startPart: "pm", endPart: "am" })).toMatchObject({ start_part: "pm", end_part: "am" });
  });
  it("sends nulls for empty notes and cover", () => {
    expect(draftBody({ ...base, startPart: "full", endPart: "full" })).toMatchObject({ notes: null, covering_user_id: null, covering_note: null });
  });
});

describe("who's away warning", () => {
  it("groups consecutive weekdays at or over warn_at", () => {
    const day = (d: string, ids: string[]) => ({ day: d, away: ids.length, user_ids: ids, holiday: null });
    const days = [day("2026-12-16", ["a"]), day("2026-12-17", ["a", "b", "c"]), day("2026-12-18", ["a", "b", "d"]), day("2026-12-21", [])];
    const rows = [{ user_id: "b", source: "leave" as const, status: "pending" as const, start_date: "2026-12-14", end_date: "2026-12-18", start_part: "full" as const, end_part: "full" as const, name: "B" }];
    expect(crowdedRuns(days, rows, 3)).toEqual([{ start: "2026-12-17", end: "2026-12-18", userIds: ["a", "b", "c", "d"], pending: true }]);
  });
});

describe("person month chart", () => {
  it("counts weekdays only, skips holidays, splits sick and pending", () => {
    const req = (start: string, end: string, status: "approved" | "pending", slug: string) => ({
      start_date: start,
      end_date: end,
      start_part: "full" as const,
      end_part: "full" as const,
      status,
      type: { id: slug, slug, label: slug },
    });
    const months = monthlyDays(
      [req("2026-12-10", "2026-12-18", "approved", "annual"), req("2026-02-09", "2026-02-10", "approved", "sick"), req("2026-11-30", "2026-12-01", "pending", "sick")],
      2026
    );
    expect(months[11]).toEqual({ other: 6, sick: 0, pending: 1 });
    expect(months[10]).toEqual({ other: 0, sick: 0, pending: 1 });
    expect(months[1]).toEqual({ other: 0, sick: 2, pending: 0 });
  });
});

describe("block-out selection", () => {
  it("first tap starts a range, second ends it (in either order)", () => {
    const a = nextSelection(null, false, "2026-12-12");
    expect(a).toEqual({ sel: { start: "2026-12-12", end: "2026-12-12" }, awaitingEnd: true });
    expect(nextSelection(a.sel, true, "2026-12-13")).toEqual({ sel: { start: "2026-12-12", end: "2026-12-13" }, awaitingEnd: false });
    expect(nextSelection(a.sel, true, "2026-12-10")).toEqual({ sel: { start: "2026-12-10", end: "2026-12-12" }, awaitingEnd: false });
  });
});
