import { describe, expect, it } from "vitest";
import { parseBudgetPatch, parseRockCreate, parseRockPatch } from "./validate";

const PERSON = "77777777-7777-4777-8777-777777777777";

describe("parseRockCreate", () => {
  it("requires a title and fills the defaults", () => {
    expect(parseRockCreate({}, "2026-Q4").ok).toBe(false);
    expect(parseRockCreate({ title: "   " }, "2026-Q4").ok).toBe(false);
    expect(parseRockCreate({ title: "Ship the film" }, "2026-Q4")).toEqual({
      ok: true,
      value: {
        title: "Ship the film",
        description: null,
        owner_user_id: null,
        status: "on_track",
        due_on: null,
        quarter: "2026-Q4",
      },
    });
  });

  it("rejects a bad status, date, owner or quarter", () => {
    expect(parseRockCreate({ title: "A", status: "done-ish" }, "2026-Q4").ok).toBe(false);
    expect(parseRockCreate({ title: "A", due_on: "2026-02-31" }, "2026-Q4").ok).toBe(false);
    expect(parseRockCreate({ title: "A", owner_user_id: "hanno" }, "2026-Q4").ok).toBe(false);
    expect(parseRockCreate({ title: "A", quarter: "2026-Q5" }, "2026-Q4").ok).toBe(false);
    const parsed = parseRockCreate(
      { title: "A", owner_user_id: PERSON, status: "done", due_on: "2026-11-10", quarter: "2026-Q1" },
      "2026-Q4"
    );
    expect(parsed.ok).toBe(true);
  });
});

describe("parseRockPatch", () => {
  it("requires at least one editable field", () => {
    expect(parseRockPatch({}).ok).toBe(false);
    expect(parseRockPatch({ status: "off_track" })).toEqual({
      ok: true,
      value: { status: "off_track" },
    });
  });
});

describe("parseBudgetPatch", () => {
  it("edits cents or notes and refuses spend", () => {
    expect(parseBudgetPatch({ link_id: PERSON, spend_cents: 1 }).ok).toBe(false);
    expect(parseBudgetPatch({ link_id: PERSON, budget_cents: 1.5 }).ok).toBe(false);
    expect(parseBudgetPatch({ link_id: PERSON, budget_cents: -1 }).ok).toBe(false);
    expect(parseBudgetPatch({ link_id: "nope", budget_cents: 1 }).ok).toBe(false);
    expect(parseBudgetPatch({ link_id: PERSON })).toMatchObject({ ok: false });
    expect(parseBudgetPatch({ link_id: PERSON, budget_cents: 600000, notes: "  " })).toEqual({
      ok: true,
      value: { linkId: PERSON, patch: { budget_cents: 600000, notes: null } },
    });
  });
});
