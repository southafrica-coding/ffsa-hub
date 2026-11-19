import { describe, expect, it } from "vitest";
import {
  buildReminder,
  documentUrgency,
  isOverdueDay,
  lodgeUrgency,
  reminderEmail,
  reminderSubject,
  shouldSend,
  type ReminderApp,
  type ReminderDoc,
} from "./reminders";

// 2026-11-16 Mon · 17 Tue · 18 Wed · 19 Thu · 20 Fri · 21 Sat
const MON = "2026-11-16";
const TUE = "2026-11-17";
const WED = "2026-11-18";
const folders = new Map([["f1", "FFSA legal"]]);

const doc = (id: string, expires_on: string | null, over: Partial<ReminderDoc> = {}): ReminderDoc => ({
  id, title: id, folder_id: "f1", type_id: null, expires_on, renew_lead_days: null, status: "held", superseded_by: null, ...over,
});
const app = (id: string, over: Partial<ReminderApp> = {}): ReminderApp => ({
  id, title: id, folder_id: "f1", document_id: null, status: "planned", lodge_by: null, submitted_on: null, expected_on: null, ...over,
});
const build = (today: string, documents: ReminderDoc[], applications: ReminderApp[] = []) =>
  buildReminder({ today, documents, applications, typeLeadDays: new Map(), folderNames: folders });
const ids = (lines: { id: string }[]) => lines.map((l) => l.id);

describe("colour scale", () => {
  it("documents: green at 90, yellow at 60, orange at 30, red at 7 and after", () => {
    expect(documentUrgency(91)).toBeNull();
    expect(documentUrgency(90)).toBe("green");
    expect(documentUrgency(61)).toBe("green");
    expect(documentUrgency(60)).toBe("yellow");
    expect(documentUrgency(31)).toBe("yellow");
    expect(documentUrgency(30)).toBe("orange");
    expect(documentUrgency(8)).toBe("orange");
    expect(documentUrgency(7)).toBe("red");
    expect(documentUrgency(0)).toBe("red");
    expect(documentUrgency(-40)).toBe("red");
    expect(documentUrgency(null)).toBeNull();
  });
  it("applications: the same colours at 21 / 14 / 7 / 2 days before lodge-by", () => {
    expect(lodgeUrgency(22)).toBeNull();
    expect(lodgeUrgency(21)).toBe("green");
    expect(lodgeUrgency(14)).toBe("yellow");
    expect(lodgeUrgency(7)).toBe("orange");
    expect(lodgeUrgency(2)).toBe("red");
    expect(lodgeUrgency(-3)).toBe("red");
  });
});

describe("document milestones", () => {
  it("90, 60, 30, 7 and 0 days ahead for every document, whatever its lead time", () => {
    const r = build(TUE, [
      doc("d90", "2027-02-15", { renew_lead_days: 10 }),
      doc("d60", "2027-01-16"),
      doc("d30", "2026-12-17"),
      doc("d7", "2026-11-24"),
      doc("d0", "2026-11-17"),
      doc("d59", "2027-01-15"),
    ]);
    expect(ids(r.today).sort()).toEqual(["d0", "d30", "d60", "d7", "d90"]);
    expect(r.today.find((l) => l.id === "d90")?.urgency).toBe("green");
    expect(r.today.find((l) => l.id === "d60")?.urgency).toBe("yellow");
    expect(r.today.find((l) => l.id === "d30")?.urgency).toBe("orange");
    expect(r.today.find((l) => l.id === "d7")?.urgency).toBe("red");
  });
  it("expired: Monday, Wednesday and Friday, not the days between", () => {
    expect(isOverdueDay(MON)).toBe(true);
    expect(isOverdueDay(TUE)).toBe(false);
    expect(isOverdueDay(WED)).toBe(true);
    expect(isOverdueDay("2026-11-20")).toBe(true);
    expect(isOverdueDay("2026-11-21")).toBe(false);
    expect(ids(build(WED, [doc("x", "2026-11-10")]).today)).toEqual(["x"]);
    const tue = build(TUE, [doc("x", "2026-11-10")]);
    expect(tue.today).toEqual([]);
    expect(ids(tue.open)).toEqual(["x"]);
    expect(tue.counts.expired).toBe(1);
  });
  it("renewal under way: 90/60/30 are skipped, 7 days and the day still come up", () => {
    const apps = [
      app("a30", { document_id: "d30", status: "gathering" }),
      app("a7", { document_id: "d7", status: "submitted" }),
    ];
    const r = build(TUE, [doc("d30", "2026-12-17"), doc("d7", "2026-11-24")], apps);
    expect(ids(r.today)).toEqual(["d7"]);
  });
  it("replaced documents never come up", () => {
    const r = build(WED, [doc("old", "2026-11-11", { superseded_by: "new" })]);
    expect([...r.today, ...r.open, ...r.upcoming]).toEqual([]);
  });
});

describe("application milestones", () => {
  it("21, 14, 7, 2 and 0 days before lodge-by; late ones on Mon/Wed/Fri", () => {
    const r = build(TUE, [], [
      app("l21", { lodge_by: "2026-12-08" }),
      app("l14", { lodge_by: "2026-12-01" }),
      app("l7", { lodge_by: "2026-11-24" }),
      app("l2", { lodge_by: "2026-11-19" }),
      app("l0", { lodge_by: "2026-11-17" }),
      app("l10", { lodge_by: "2026-11-27" }),
      app("late", { lodge_by: "2026-11-10" }),
    ]);
    expect(ids(r.today).sort()).toEqual(["l0", "l14", "l2", "l21", "l7"]);
    expect(ids(r.open).sort()).toEqual(["l10", "late"]);
    expect(ids(build(WED, [], [app("late", { lodge_by: "2026-11-10" })]).today)).toEqual(["late"]);
  });
  it("lodged and past the expected date: Mondays only", () => {
    const w = app("w", { status: "waiting", submitted_on: "2026-10-01", expected_on: "2026-11-11" });
    expect(ids(build(MON, [], [w]).today)).toEqual(["w"]);
    expect(build(WED, [], [w]).today).toEqual([]);
  });
});

describe("quiet days", () => {
  const far = [
    doc("a", "2027-01-10"), doc("b", "2027-01-20"), doc("c", "2027-03-01"),
    doc("d", "2027-06-01"), doc("e", "2028-01-01"), doc("f", "2029-01-01"),
  ];
  it("no milestone: the next 5 coming up, soonest first, and an email goes out", () => {
    const r = build(TUE, far);
    expect(r.today).toEqual([]);
    expect(ids(r.upcoming)).toEqual(["a", "b", "c", "d", "e"]);
    expect(shouldSend(r, TUE)).toBe(true);
    expect(reminderSubject(r, TUE)).toBe("Legal papers: nothing due today · next up in 54 days");
    const e = reminderEmail(r, TUE, "https://hub.example");
    expect(e.text).toContain("Coming up next:");
    expect(e.text).not.toContain("Today:");
  });
  it("only on quiet days: a day with a milestone has no coming-up list", () => {
    const r = build(TUE, [...far, doc("now", "2026-11-24")]);
    expect(ids(r.today)).toEqual(["now"]);
    const e = reminderEmail(r, TUE, "https://hub.example");
    expect(e.text).toContain("Today:");
    expect(e.text).not.toContain("Coming up next:");
  });
  it("a quiet Monday also lists everything still open", () => {
    const r = build(MON, [doc("soon", "2026-12-01"), doc("b", "2027-01-20")]); // 15 days: renew now, no milestone
    expect(r.today).toEqual([]);
    const e = reminderEmail(r, MON, "https://hub.example");
    expect(e.text).toContain("Still open:");
    expect(e.text).toContain("Coming up next:");
  });
  it("nothing open and nothing dated: no email", () => {
    expect(shouldSend(build(TUE, []), TUE)).toBe(false);
    expect(shouldSend(build(TUE, [doc("n", null)]), TUE)).toBe(false);
  });
});

describe("email", () => {
  it("titles and dates, escaped, with the colour key", () => {
    const r = build(TUE, [doc("<b>Lease</b>", "2026-11-17")]);
    expect(reminderSubject(r, TUE)).toBe("Legal papers: 1 thing needs you today");
    const e = reminderEmail(r, TUE, "https://hub.example/");
    expect(e.html).toContain("&lt;b&gt;Lease&lt;/b&gt;");
    expect(e.html).toContain("#B42318"); // red
    expect(e.html).toContain("7 days or less");
    expect(e.html).toContain("https://hub.example/legal-documents");
    expect(e.text).toContain("Expires today (17 Nov)");
  });
});
