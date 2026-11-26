import { describe, expect, it } from "vitest";
import {
  ACTIVE_STAGES,
  CHECKLIST,
  cleanTeamPatch,
  dueFor,
  dueSoon,
  fieldLabel,
  nextStage,
  openIn,
  stageDone,
  stepsForTeam,
  type Step,
} from "./visiting-teams";

const ARRIVE = "2027-03-12";
const LEAVE = "2027-04-09";

function steps(over: (s: Step) => Partial<Step> = () => ({})): Step[] {
  return stepsForTeam({ stage: "enquiry", arrival_on: ARRIVE, departure_on: LEAVE }).map((s, i) => {
    const base: Step = { id: `s${i}`, ...s, done_at: null, note: null } as Step;
    return { ...base, ...over(base) };
  });
}

describe("the checklist", () => {
  it("has unique keys and covers every active stage", () => {
    const keys = CHECKLIST.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const stage of ACTIVE_STAGES) expect(CHECKLIST.some((s) => s.stage === stage)).toBe(true);
  });

  it("dates airport pickup three weeks before arrival", () => {
    const pickup = CHECKLIST.find((s) => s.key === "airport_pickup")!;
    expect(dueFor(pickup, ARRIVE, LEAVE)).toBe("2027-02-19");
  });

  it("leaves a step undated when its date isn't known yet", () => {
    const pickup = CHECKLIST.find((s) => s.key === "airport_pickup")!;
    expect(dueFor(pickup, null, LEAVE)).toBeNull();
    expect(dueFor(CHECKLIST[0], ARRIVE, LEAVE)).toBeNull();
  });

  it("ticks the stages a team has already passed when it's added", () => {
    const rows = stepsForTeam({ stage: "confirmed", arrival_on: null, departure_on: null });
    expect(rows.filter((r) => r.stage === "enquiry").every((r) => r.done_at && r.note)).toBe(true);
    expect(rows.filter((r) => r.stage !== "enquiry").every((r) => r.done_at === null)).toBe(true);
  });

  it("starts an ended team (said no, postponed, cancelled) with nothing ticked", () => {
    const rows = stepsForTeam({ stage: "cancelled", arrival_on: null, departure_on: null });
    expect(rows.every((r) => r.done_at === null)).toBe(true);
  });
});

describe("reading a team's checklist", () => {
  it("lists what's open in a stage, soonest first, undated last", () => {
    const open = openIn(steps(), "preparing");
    expect(open[0].step_key).toBe("travel_form_back");
    expect(open.at(-1)!.due_on).toBeNull();
  });

  it("finds steps due within a week, including late ones", () => {
    const soon = dueSoon(steps(), "2027-02-20");
    expect(soon.map((s) => s.step_key)).toEqual(["travel_form_back", "airport_pickup"]);
  });

  it("suggests the next stage only once the current one is clear", () => {
    const all = steps();
    expect(stageDone(all, "enquiry")).toBe(false);
    const cleared = steps((s) => (s.stage === "enquiry" ? { done_at: "2026-12-01T08:00:00Z" } : {}));
    expect(stageDone(cleared, "enquiry")).toBe(true);
    expect(stageDone(cleared, "cancelled")).toBe(false);
    expect(nextStage("left")).toBeNull();
    expect(nextStage("cancelled")).toBeNull();
  });
});

describe("editing a team", () => {
  it("cleans text, clears empties and keeps numbers whole", () => {
    const r = cleanTeamPatch({ locations: "  Potch  ", rooms: "", size_count: "8", stage: "here" });
    expect(r).toEqual({ patch: { locations: "Potch", rooms: null, size_count: 8 } });
  });

  it("refuses a departure before arrival, against the saved dates too", () => {
    expect(cleanTeamPatch({ arrival_on: "2027-03-12", departure_on: "2027-03-01" })).toHaveProperty("error");
    expect(cleanTeamPatch({ departure_on: "2027-03-01" }, { arrival_on: "2027-03-12", departure_on: null })).toHaveProperty("error");
  });

  it("refuses a team without a name, and bad dates", () => {
    expect(cleanTeamPatch({ name: "" })).toHaveProperty("error");
    expect(cleanTeamPatch({ arrival_on: "12 March" })).toHaveProperty("error");
  });

  it("names history fields in words", () => {
    expect(fieldLabel("arrival_on")).toBe("Arrival");
    expect(fieldLabel("step:airport_pickup")).toBe("Airport pickup arranged");
    expect(fieldLabel("step:airport_pickup:note")).toBe("Airport pickup arranged (note)");
    expect(fieldLabel("private:medical")).toBe("Medical");
  });
});
