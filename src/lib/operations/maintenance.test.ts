import { describe, expect, it } from "vitest";
import type { OpsItem } from "./areas";
import {
  MAINT_PICK,
  MAINT_RULES_VIEW,
  activeGroups,
  ageWords,
  crewListText,
  followupMessage,
  hoursFrom,
  hoursNotice,
  isOutOfHours,
  maintStatus,
  monthBounds,
  monthReport,
  requestForm,
  requestPost,
  rulesView,
  whatsappText,
  whenWords,
} from "./maintenance";

let n = 0;
function item(over: Partial<OpsItem> = {}): OpsItem {
  n += 1;
  return {
    id: `m${n}`,
    area: "maintenance",
    title: `Request ${n}`,
    details: null,
    location: "A6",
    status: "new",
    owner_user_id: null,
    owner_name: null,
    due_on: null,
    source: "slack",
    requested_by_name: "Sarah M",
    requested_by_slack_id: "U1",
    created_at: "2026-11-20T08:00:00Z",
    last_activity_at: "2026-11-20T08:00:00Z",
    closed_at: null,
    urgency: "this_week",
    photo_count: 0,
    out_of_hours: false,
    ...over,
  };
}

// SAST is UTC+2: "Fri 12:00 SAST" is 10:00Z.
const sast = (iso: string) => new Date(new Date(`${iso}Z`).getTime() - 2 * 3600_000);

describe("crew hours (Mon–Thu 08:00–16:00, Fri 08:00–15:00)", () => {
  it("is out of hours outside the crew's day, evenings and weekends included", () => {
    expect(isOutOfHours(sast("2026-11-25T07:59"))).toBe(true); // Wed early
    expect(isOutOfHours(sast("2026-11-25T08:00"))).toBe(false);
    expect(isOutOfHours(sast("2026-11-25T15:59"))).toBe(false);
    expect(isOutOfHours(sast("2026-11-25T16:00"))).toBe(true); // Wed evening
    expect(isOutOfHours(sast("2026-11-27T14:59"))).toBe(false); // Fri
    expect(isOutOfHours(sast("2026-11-27T15:00"))).toBe(true);
    expect(isOutOfHours(sast("2026-11-28T10:00"))).toBe(true); // Sat
    expect(isOutOfHours(sast("2026-11-29T10:00"))).toBe(true); // Sun
  });

  it("says when it will be handled", () => {
    expect(whenWords(sast("2026-11-25T06:30"))).toBe("later today at 08:00");
    expect(whenWords(sast("2026-11-25T20:00"))).toBe("first thing tomorrow");
    expect(whenWords(sast("2026-11-27T15:30"))).toBe("first thing on Monday");
    expect(whenWords(sast("2026-11-28T10:00"))).toBe("first thing on Monday");
    expect(whenWords(sast("2026-11-29T21:00"))).toBe("first thing tomorrow"); // Sun night
  });

  it("fills {when} in the message", () => {
    expect(hoursNotice(null, sast("2026-11-27T16:00"))).toBe(
      "Working hours for our Maintenance Crew are Monday to Thursday 08:00–16:00 and Friday 08:00–15:00. Your request will be handled first thing on Monday."
    );
    expect(hoursNotice("Back {when}.", sast("2026-11-25T20:00"))).toBe("Back first thing tomorrow.");
  });

  it("reads hours from settings, dropping anything malformed", () => {
    expect(hoursFrom({ "1": { open: "08:00:00", close: "16:00:00" }, "2": { open: "17:00", close: "09:00" }, "9": { open: "08:00", close: "16:00" } })).toEqual({
      "1": { open: "08:00", close: "16:00" },
    });
    expect(hoursFrom(null)["5"]).toEqual({ open: "08:00", close: "15:00" });
    expect(isOutOfHours(sast("2026-11-28T10:00"), {})).toBe(false); // no hours set: never
  });
});

describe("three statuses", () => {
  it("maps the six database statuses", () => {
    expect(maintStatus("new")).toBe("not_started");
    expect(maintStatus("seen")).toBe("not_started");
    expect(maintStatus("in_progress")).toBe("in_progress");
    expect(maintStatus("more_time")).toBe("in_progress");
    expect(maintStatus("done")).toBe("finished");
    expect(maintStatus("wont_do")).toBeNull();
  });
});

describe("the rules, then the form", () => {
  it("shows every rule, with I agree under the last one", () => {
    const view = rulesView("*Special request*\n\nDon't touch the geyser.\n\n• One per room\n• Crew hours 08:00–16:00");
    expect(view.callback_id).toBe(MAINT_RULES_VIEW);
    const blocks = view.blocks as { type: string; block_id?: string; text?: { text: string } }[];
    const texts = blocks.filter((b) => b.type === "section").map((b) => b.text!.text);
    expect(texts.slice(1)).toEqual(["*Special request*", "Don't touch the geyser.", "• One per room\n• Crew hours 08:00–16:00"]);
    expect(blocks[blocks.length - 1].block_id).toBe("agree");
  });

  it("the form asks the four questions, and shows the hours notice only out of hours", () => {
    const open = requestForm({ outOfHours: false, notice: "Closed" });
    const ids = (open.blocks as { block_id?: string }[]).map((b) => b.block_id).filter(Boolean);
    expect(ids).toEqual(["issue", "where", "urgency", "photo"]);
    expect(JSON.stringify(open)).not.toContain("Closed");
    expect(JSON.stringify(requestForm({ outOfHours: true, notice: "Closed" }))).toContain("⏰ Closed");
  });
});

describe("the request post and its WhatsApp copy", () => {
  const it1 = item({ title: "No hot water", details: "No hot water\nGeyser light is off", urgency: "urgent", photo_count: 2, created_at: "2026-11-26T12:10:00Z" });

  it("leads with what's wrong, then where and how urgent", () => {
    const msg = requestPost(it1);
    const first = (msg.blocks[0] as { text: { text: string } }).text.text;
    expect(first).toBe("🔧 *No hot water*\n📍 *A6*   ·   🔴 Urgent");
    expect(JSON.stringify(msg.blocks)).toContain("Asked by Sarah M · Thu 26 Nov, 14:10");
    expect(JSON.stringify(msg.blocks)).toContain("2 photos in the thread");
  });

  it("offers the two statuses it isn't in", () => {
    const actions = requestPost(it1).blocks.find((b) => b.type === "actions") as { elements: { text: { text: string } }[] };
    expect(actions.elements.map((e) => e.text.text)).toEqual(["In progress", "Finished", "Add a note", "Open in Hub"]);
  });

  it("is plain text for WhatsApp", () => {
    expect(whatsappText(it1)).toBe(
      ["🔧 MAINTENANCE – No hot water", "📍 Where: A6", "🔴 Urgent", "📝 No hot water\nGeyser light is off", "👤 Asked by Sarah M, Thu 26 Nov, 14:10", "📷 2 photos in Slack"].join("\n")
    );
  });
});

describe("the 07:00 follow-up", () => {
  const NOW = new Date("2026-11-26T05:00:00Z"); // Thu 07:00
  const old = item({ title: "Old one", created_at: "2026-11-09T08:00:00Z" });
  const fresh = item({ title: "New one", created_at: "2026-11-25T08:00:00Z" });
  const busy = item({ title: "Busy", status: "in_progress", created_at: "2026-11-20T08:00:00Z" });
  const done = item({ title: "Tap", location: "B2", status: "done", closed_at: "2026-11-25T10:00:00Z" });

  it("groups, oldest first, with ages", () => {
    const g = activeGroups([fresh, busy, old, done]);
    expect(g.notStarted.map((i) => i.title)).toEqual(["Old one", "New one"]);
    expect(g.inProgress.map((i) => i.title)).toEqual(["Busy"]);
    expect(ageWords(old.created_at, NOW)).toBe("17 days");
    expect(ageWords("2026-11-26T04:00:00Z", NOW)).toBe("today");
  });

  it("has a dropdown on every line set to its status, and lists what finished", () => {
    const msg = followupMessage([fresh, busy, old], [done], NOW);
    expect(msg.text).toBe("Maintenance: 3 active requests · 1 older than 2 weeks");
    const selects = msg.blocks.filter((b) => (b.accessory as { action_id?: string } | undefined)?.action_id === MAINT_PICK);
    expect(selects).toHaveLength(3);
    const busyLine = selects.find((b) => JSON.stringify(b).includes("Busy")) as { accessory: { initial_option: { value: string } } };
    expect(busyLine.accessory.initial_option.value).toBe(`in_progress|${busy.id}`);
    expect(JSON.stringify(msg.blocks)).toContain("Finished since the last message: Tap (B2)");
  });

  it("gives the crew a numbered list, in progress first", () => {
    expect(crewListText([fresh, busy, old], NOW)).toBe(
      ["🔧 Maintenance – Thu 26 Nov", "", "IN PROGRESS", "1. Busy – A6 (6 days)", "", "NOT STARTED", "2. Old one – A6 (17 days)", "3. New one – A6 (1 day)"].join("\n")
    );
    expect(crewListText([done], NOW)).toBeNull();
  });
});

describe("the monthly report", () => {
  it("counts what came in, what finished and where keeps coming up", () => {
    const items = [
      item({ location: "A6", created_at: "2026-11-02T08:00:00Z", status: "done", closed_at: "2026-11-04T08:00:00Z", urgency: "urgent" }),
      item({ location: "a6 ", created_at: "2026-11-10T08:00:00Z" }),
      item({ location: "Hall", created_at: "2026-10-28T08:00:00Z", status: "done", closed_at: "2026-11-01T08:00:00Z" }),
      item({ location: "Gate", created_at: "2026-10-01T08:00:00Z" }),
    ];
    const r = monthReport(items, "2026-11");
    expect(r.logged).toHaveLength(2);
    expect(r.finished).toHaveLength(2);
    expect(r.stillOpen).toHaveLength(2);
    expect(r.avgDaysToFinish).toBe(3); // 2 days and 4 days
    expect(r.repeatLocations).toEqual([{ location: "A6", count: 2, titles: [items[0].title, items[1].title] }]);
    expect(r.byUrgency.map((u) => [u.label, u.count])).toEqual([["Urgent", 1], ["This week", 1]]);
  });

  it("bounds a month in SAST", () => {
    expect(monthBounds("2026-12")).toEqual({ start: "2026-11-30T22:00:00.000Z", end: "2026-12-31T22:00:00.000Z" });
  });
});
