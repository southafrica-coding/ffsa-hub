import { describe, expect, it } from "vitest";
import type { OpsItem } from "./areas";
import { meetingWeek } from "./dates";
import {
  morningMessage,
  personalMessage,
  reminderFor,
  requesterMessage,
  summariseWeek,
  weeklyMessage,
} from "./messages";

// Tue 24 Nov 2026, 07:00 SAST
const NOW = new Date("2026-11-24T05:00:00Z");
const SINCE = new Date("2026-11-23T05:00:00Z");

let n = 0;
function item(over: Partial<OpsItem> = {}): OpsItem {
  n += 1;
  return {
    id: `i${n}`,
    area: "maintenance",
    title: `Item ${n}`,
    details: null,
    location: "A6",
    status: "new",
    owner_user_id: null,
    owner_name: null,
    due_on: null,
    source: "slack",
    requested_by_name: "Jorja",
    requested_by_slack_id: "U1",
    created_at: "2026-11-23T08:00:00Z",
    last_activity_at: "2026-11-23T08:00:00Z",
    closed_at: null,
    ...over,
  };
}

const text = (m: { blocks: unknown[] } | null) => JSON.stringify(m?.blocks ?? []);

describe("morningMessage", () => {
  it("says nothing on a quiet day", () => {
    expect(morningMessage("maintenance", [], SINCE, NOW)).toBeNull();
  });

  it("splits new, needs a look and still open, and lists what got done", () => {
    const fresh = item({ title: "Curtain rod" });
    const old = item({ title: "Toilet leaking", created_at: "2026-11-10T08:00:00Z", last_activity_at: "2026-11-10T08:00:00Z" });
    const calm = item({ title: "Paint", status: "in_progress", created_at: "2026-11-20T08:00:00Z", last_activity_at: "2026-11-22T08:00:00Z" });
    const done = item({ title: "Gas bottle", status: "done", closed_at: "2026-11-23T12:00:00Z" });
    const m = morningMessage("maintenance", [fresh, old, calm, done], SINCE, NOW)!;
    expect(m.text).toContain("1 new · 3 open · 1 done");
    const t = text(m);
    expect(t.indexOf("*New* (1)")).toBeLessThan(t.indexOf("Curtain rod"));
    expect(t).toContain("*Needs a look* (1)");
    expect(t).toContain("*Still open* (1)");
    expect(t).toContain("✓ Done: Gas bottle");
  });

  it("stays under Slack's 50-block limit", () => {
    const many = Array.from({ length: 80 }, () => item());
    expect(morningMessage("maintenance", many, SINCE, NOW)!.blocks.length).toBeLessThanOrEqual(50);
  });
});

describe("personal reminders", () => {
  it("nudges the day before, on the day, and once after", () => {
    const base = { owner_user_id: "u1" };
    expect(reminderFor(item({ ...base, due_on: "2026-11-25" }), "2026-11-24")).toBe("day_before");
    expect(reminderFor(item({ ...base, due_on: "2026-11-24" }), "2026-11-24")).toBe("due_day");
    expect(reminderFor(item({ ...base, due_on: "2026-11-23" }), "2026-11-24")).toBe("past_due");
    expect(reminderFor(item({ ...base, due_on: "2026-11-20" }), "2026-11-24")).toBeNull();
    expect(reminderFor(item({ ...base, due_on: "2026-11-24", status: "done", closed_at: "x" }), "2026-11-24")).toBeNull();
    expect(reminderFor(item({ due_on: "2026-11-24" }), "2026-11-24")).toBeNull();
  });

  it("only DMs open items", () => {
    expect(personalMessage("Jo", [item({ status: "done", closed_at: "x" })], NOW)).toBeNull();
    expect(personalMessage("Jo", [item()], NOW)!.text).toContain("1 operations item");
  });
});

describe("requesterMessage", () => {
  it("tells the person who asked, in plain words", () => {
    const m = requesterMessage(item({ title: "No hot water" }), "done", "New element fitted", "Nythan");
    expect(m!.text).toBe("Your request No hot water (A6) is done.");
    expect(text(m)).toContain("New element fitted");
  });
  it("stays silent for a move back to new", () => {
    expect(requesterMessage(item(), "new", null, null)).toBeNull();
  });
});

describe("the week", () => {
  it("covers Wednesday to Tuesday for a Wednesday meeting", () => {
    expect(meetingWeek(new Date("2026-11-24T15:00:00Z"))).toEqual({ from: "2026-11-18", meetingOn: "2026-11-25" });
    expect(meetingWeek(new Date("2026-11-25T08:00:00Z"))).toEqual({ from: "2026-11-18", meetingOn: "2026-11-25" });
  });

  it("puts past-date and more-time items up for discussion", () => {
    const late = item({ title: "Late", owner_user_id: "u", due_on: "2026-11-20", status: "in_progress", last_activity_at: "2026-11-23T08:00:00Z" });
    const fine = item({ title: "Fine", owner_user_id: "u", status: "in_progress" });
    const weeks = summariseWeek([late, fine], "2026-11-18", NOW);
    expect(weeks).toHaveLength(1);
    expect(weeks[0].decide.map((i) => i.title)).toEqual(["Late"]);
    expect(weeklyMessage(weeks, "2026-11-18", "2026-11-25", NOW).text).toContain("2 still open");
  });
});
