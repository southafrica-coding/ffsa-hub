// "Mark as fixed" (Gideon, 23 Nov 2026).

import { describe, expect, it } from "vitest";
import { wasLine, fixEntry, keepFixes } from "./fixes";
import type { ConditionEntry } from "./rules/types";

const TODAY = "2026-11-23";
const bushes: ConditionEntry = { s: "fix", d: "2026-11-19", n: "4x lower control arm bushes worn", i: "ins-1", t: "Ball joints and control arms", p: [] };
const input = { itemId: "m25-balljoints", date: "2026-11-22", by: "Motech", work: "Replaced all four lower control arm bushes." };

describe("fixEntry", () => {
  it("puts the point back to OK on the day it was fixed, with who and what, and what it was before", () => {
    const r = fixEntry(bushes, input, TODAY, "u1", "2026-11-23T10:00:00Z");
    expect(r).toEqual({
      entry: {
        s: "ok",
        d: "2026-11-22",
        n: "Fixed by Motech: Replaced all four lower control arm bushes.",
        p: [],
        t: "Ball joints and control arms",
        f: {
          by: "Motech",
          work: "Replaced all four lower control arm bushes.",
          recordedBy: "u1",
          recordedAt: "2026-11-23T10:00:00Z",
          was: { s: "fix", d: "2026-11-19", n: "4x lower control arm bushes worn", i: "ins-1" },
        },
      },
    });
  });

  it("for a point marked Fix now or Monitor (Gideon, 25 Nov 2026), not OK or N/A", () => {
    const mon = fixEntry({ ...bushes, s: "mon" }, input, TODAY, null);
    expect("entry" in mon && mon.entry).toMatchObject({ s: "ok", f: { was: { s: "mon" } } });
    const err = { error: "That point isn’t marked Fix now or Monitor." };
    expect(fixEntry({ ...bushes, s: "ok" }, input, TODAY, null)).toEqual(err);
    expect(fixEntry({ ...bushes, s: "na" }, input, TODAY, null)).toEqual(err);
    expect(fixEntry(undefined, input, TODAY, null)).toEqual(err);
  });

  it("says what the point was", () => {
    const f = (d: string) => d;
    expect(wasLine({ s: "fix", d: "2026-11-19", n: "Bushes worn" }, f)).toBe("Was Fix now (2026-11-19): Bushes worn");
    expect(wasLine({ s: "mon", d: "2026-11-19", n: "Rattle" }, f)).toBe("Was Monitor (2026-11-19): Rattle");
    expect(wasLine({ n: "Old fix" }, f)).toBe("Was Fix now: Old fix");
  });

  it("not in the future, and not before it was found", () => {
    expect(fixEntry(bushes, { ...input, date: "2026-11-24" }, TODAY, null)).toEqual({ error: "The date it was fixed can’t be in the future." });
    expect(fixEntry(bushes, { ...input, date: "2026-11-18" }, TODAY, null)).toEqual({ error: "It was found on 2026-11-19, so it can’t have been fixed before then." });
    expect("entry" in fixEntry(bushes, { ...input, date: "2026-11-19" }, TODAY, null)).toBe(true);
    expect(fixEntry(bushes, { ...input, date: "" }, TODAY, null)).toEqual({ error: "Enter the date it was fixed." });
  });

  it("needs who and what", () => {
    expect(fixEntry(bushes, { ...input, by: "  " }, TODAY, null)).toEqual({ error: "Say who fixed it." });
    expect(fixEntry(bushes, { ...input, work: "" }, TODAY, null)).toEqual({ error: "Say what was done." });
    expect(fixEntry(bushes, { ...input, work: "x".repeat(301) }, TODAY, null)).toEqual({ error: "Keep it short." });
  });
});

describe("keepFixes (after an inspection is deleted)", () => {
  const fixed = (fixEntry(bushes, input, TODAY, "u1") as { entry: ConditionEntry }).entry;

  it("keeps a fix the remaining inspections don't know about", () => {
    expect(keepFixes({ "m25-balljoints": bushes }, { "m25-balljoints": fixed })["m25-balljoints"]).toBe(fixed);
    expect(keepFixes({}, { "m25-balljoints": fixed })["m25-balljoints"]).toBe(fixed);
  });

  it("a later inspection still wins", () => {
    const later: ConditionEntry = { s: "mon", d: "2026-11-30", n: "Bush starting to perish", i: "ins-2" };
    expect(keepFixes({ "m25-balljoints": later }, { "m25-balljoints": fixed })["m25-balljoints"]).toBe(later);
  });

  it("leaves everything else as rebuilt", () => {
    const other: ConditionEntry = { s: "ok", d: "2026-11-19", i: "ins-1" };
    expect(keepFixes({ "m25-oil": other }, { "m25-oil": { s: "fix", d: "2026-11-01" } })).toEqual({ "m25-oil": other });
  });
});
