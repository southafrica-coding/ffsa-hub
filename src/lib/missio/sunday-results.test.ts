import { describe, expect, it } from "vitest";
import { andList, buildSundayResults, weekOf } from "./sunday-results";
import { FIXTURE_HOUSES, FIXTURE_ROWS, FIXTURE_SUNDAY } from "./weekly-fixtures";

const results = buildSundayResults(FIXTURE_HOUSES, FIXTURE_ROWS, FIXTURE_SUNDAY);
const kpi = (key: string) => results.kpis.find((k) => k.key === key)?.value;

describe("buildSundayResults", () => {
  it("counts sent and missing houses", () => {
    expect(results).toMatchObject({ total: 20, sentCount: 14, missing: [3, 7, 9, 12, 16, 19] });
    expect(results.houses.filter((h) => h.state === "missing").map((h) => h.number)).toEqual([3, 7, 9, 12, 16, 19]);
    expect(results.houses.find((h) => h.number === 3)?.summary).toBe("Nothing yet");
  });

  it("totals only the houses that sent, and averages the scores", () => {
    expect(kpi("attendance")).toBe(String(FIXTURE_ROWS.reduce((a, r) => a + (r.attendance ?? 0), 0)));
    expect(kpi("saved")).toBe("3");
    expect(kpi("first_time")).toBe("5");
    expect(kpi("connected")).toMatch(/^\d\.\d$/);
  });

  it("shows a dash, never a zero, when nobody has sent", () => {
    const empty = buildSundayResults(FIXTURE_HOUSES, [], FIXTURE_SUNDAY);
    expect(empty.kpis.every((k) => k.value === "—")).toBe(true);
    expect(empty.flags).toEqual([]);
    expect(empty.missing).toHaveLength(20);
  });

  it("flags leader score 1–2, conflict, training and saved for a coach", () => {
    expect(results.flags.map((f) => `${f.kind}:${f.title}`)).toEqual([
      "score:House 17 · leader wellbeing",
      "conflict:House 4 · challenge",
      "training:Houses 11 and 18",
      "saved:Houses 6, 14 and 20",
    ]);
    expect(results.flags[2].body).toBe("Asked for help with discipleship (2) and inviting new people (1).");
    expect(results.houses.find((h) => h.number === 4)?.state).toBe("flagged");
    expect(results.houses.find((h) => h.number === 17)?.state).toBe("flagged");
  });

  it("only claims Slack was used when it is on", () => {
    expect(results.flags.some((f) => /Slack/.test(f.body))).toBe(false);
    const on = buildSundayResults(FIXTURE_HOUSES, FIXTURE_ROWS, FIXTURE_SUNDAY, { slackOn: true });
    expect(on.flags.find((f) => f.kind === "score")?.body).toContain("private Slack message");
  });

  it("writes 5+ for 'more than 5'", () => {
    const r = buildSundayResults(FIXTURE_HOUSES.slice(0, 1), [{ ...FIXTURE_ROWS[0], saved_count: 6 }], FIXTURE_SUNDAY);
    expect(r.kpis.find((k) => k.key === "saved")?.value).toBe("6+");
    expect(r.houses[0].summary).toContain("5+ saved");
  });

  it("uses the week ending on the Sunday, and the later send of a house", () => {
    expect(weekOf("2026-11-22")).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    const id = FIXTURE_HOUSES[0].id;
    const r = buildSundayResults(FIXTURE_HOUSES.slice(0, 1), [
      { house_church_id: id, meeting_date: "2026-11-15", attendance: 99 },
      { house_church_id: id, meeting_date: "2026-11-18", attendance: 5 },
      { house_church_id: id, meeting_date: "2026-11-22", attendance: 7 },
    ], "2026-11-22");
    expect(r.kpis[0].value).toBe("7");
  });

  it("shows wins and testimonies as highlights", () => {
    expect(results.highlights.map((h) => h.lead)).toEqual(["House 18 win.", "House 13 testimony."]);
    expect(results.highlights[0].text).toMatch(/^Deeper friendships and community: .*\.$/);
  });

  it("lists in plain English", () => {
    expect(andList([3])).toBe("3");
    expect(andList([3, 7])).toBe("3 and 7");
    expect(andList([3, 7, 9])).toBe("3, 7 and 9");
  });
});
