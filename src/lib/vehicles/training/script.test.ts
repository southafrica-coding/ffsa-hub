import { describe, expect, it } from "vitest";
import { NOTES, scriptSteps, isCoordinator } from "./script";

describe("the Training page's script", () => {
  const steps = scriptSteps();

  it("has words for every moment the simulation plays, and no leftovers", () => {
    expect(steps.length).toBe(Object.keys(NOTES).length);
    for (const s of steps) {
      expect(s.booker.length).toBeGreaterThan(10);
      expect(s.coordinator.length).toBeGreaterThan(10);
    }
  });

  it("runs in time order, from the request to booking B's early return", () => {
    expect(steps.map((s) => s.at)).toEqual([...steps.map((s) => s.at)].sort());
    expect(steps[0].title).toBe("Thandi sends the request");
    expect(steps.at(-1)!.title).toBe("Someone tries to book the Almera during the hold");
    expect(steps.filter((s) => s.title.startsWith("The coordinator")).map((s) => s.title)).toEqual([
      "The coordinator taps Approve",
      "The coordinator approves the early return",
      "The coordinator taps Returned",
    ]);
  });

  it("sorts each message to the coordinator's side or the booker's", () => {
    const all = steps.flatMap((s) => s.events);
    expect(all.filter(isCoordinator).every((e) => e.to.includes("Coordinator"))).toBe(true);
    expect(all.some((e) => !isCoordinator(e) && e.to === "sam@example.org")).toBe(true);
  });

  it("uses made-up people only", () => {
    const text = JSON.stringify(steps);
    expect(text).not.toMatch(/\+27\s?76/); // no real phone numbers
    for (const m of text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []) expect(m).toMatch(/@example\.org$|@ffsahub\.com$|@ffsa/);
  });
});
