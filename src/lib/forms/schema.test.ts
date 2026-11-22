import { describe, expect, it } from "vitest";
import {
  firedRoutes,
  numericBounds,
  routeMatches,
  validateFormSchema,
  validateSubmission,
  type FormField,
  type FormRoute,
  type FormSchema,
} from "./schema";

function schemaOf(fields: FormField[]): FormSchema {
  return {
    version: 1,
    branding: {},
    steps: [{ id: "s1", title: "This week", fields }],
    thankYou: { heading: "Thanks", message: "Sent." },
  };
}

const leaderScore: FormField = {
  id: "f_leader",
  type: "linear_scale",
  label: "How are you doing as a leader?",
  key: "leader_score",
  required: true,
  routes: [
    { action: "write_column", target: "leader_score", when: "always" },
    { action: "open_followup", target: "coach", when: "lt", whenValue: 3 },
  ],
};

const saved: FormField = {
  id: "f_saved",
  type: "stepper",
  label: "Saved",
  key: "saved_count",
  required: false,
  max: 6,
  maxLabel: "More than 5",
  routes: [{ action: "slack", target: "pastors", when: "gt", whenValue: 0 }],
};

const challenge: FormField = {
  id: "f_challenge",
  type: "radio",
  label: "Biggest challenge",
  key: "challenge_type",
  required: false,
  options: ["Conflict", "Attendance", "Time", "Other"],
  routes: [{ action: "care_board", target: "conflict", when: "equals", whenValue: "Conflict" }],
};

const weekly = schemaOf([leaderScore, saved, challenge]);

// ────────────────────────────────────────────────────────────
// New field types
// ────────────────────────────────────────────────────────────

describe("linear_scale and stepper", () => {
  it("defaults a scale to 1–5 and a stepper to 0 with no top", () => {
    expect(numericBounds({ type: "linear_scale" })).toEqual({ min: 1, max: 5 });
    expect(numericBounds({ type: "stepper" })).toEqual({ min: 0, max: null });
    expect(numericBounds({ type: "stepper", max: 6 })).toEqual({ min: 0, max: 6 });
  });

  it("accepts answers inside the bounds, as numbers or numeric strings", () => {
    const r = validateSubmission(
      weekly,
      { leader_score: "4", saved_count: 6 },
      { requireContactField: false }
    );
    expect(r).toEqual({ valid: true, errors: {} });
  });

  it("rejects a score outside 1–5", () => {
    for (const bad of [0, 6, "9"]) {
      const r = validateSubmission(weekly, { leader_score: bad }, { requireContactField: false });
      expect(r.errors.leader_score).toBe("Pick a number from 1 to 5");
    }
  });

  it("rejects a stepper above its top or below zero", () => {
    expect(
      validateSubmission(weekly, { leader_score: 3, saved_count: 7 }, { requireContactField: false })
        .errors.saved_count
    ).toBe("Pick a number from 0 to 6");
    expect(
      validateSubmission(weekly, { leader_score: 3, saved_count: -1 }, { requireContactField: false })
        .errors.saved_count
    ).toBe("Pick a number from 0 to 6");
  });

  it("rejects fractions and words", () => {
    for (const bad of [2.5, "two"]) {
      const r = validateSubmission(weekly, { leader_score: bad }, { requireContactField: false });
      expect(r.errors.leader_score).toBe("Enter a whole number");
    }
  });

  it("an unbounded stepper only checks the bottom", () => {
    const s = schemaOf([{ id: "g", type: "stepper", label: "Guests", key: "guest_count", required: false }]);
    expect(validateSubmission(s, { guest_count: 120 }, { requireContactField: false }).valid).toBe(true);
    expect(validateSubmission(s, { guest_count: -2 }, { requireContactField: false }).errors.guest_count).toBe(
      "Enter 0 or more"
    );
  });

  it("a required scale left empty is required", () => {
    const r = validateSubmission(weekly, {}, { requireContactField: false });
    expect(r.errors.leader_score).toBe("How are you doing as a leader? is required");
  });

  it("still asks generic forms for an email or phone", () => {
    expect(validateSubmission(weekly, { leader_score: 3 }).errors._form).toBe(
      "Form must collect an email or phone field"
    );
  });
});

// ────────────────────────────────────────────────────────────
// Schema checks
// ────────────────────────────────────────────────────────────

describe("validateFormSchema", () => {
  it("passes the weekly feedback fields", () => {
    expect(validateFormSchema(weekly)).toEqual({});
  });

  it("catches bad scale bounds", () => {
    const s = schemaOf([
      { id: "a", type: "linear_scale", label: "A", key: "a", required: false, min: 5, max: 5 },
      { id: "b", type: "linear_scale", label: "B", key: "b", required: false, min: 0, max: 20 },
      { id: "c", type: "stepper", label: "C", key: "c", required: false, min: 0.5 },
    ]);
    expect(validateFormSchema(s)).toEqual({
      a: "The highest value must be above the lowest",
      b: "A scale can have at most 11 points",
      c: "The lowest value must be a whole number",
    });
  });

  it("catches route rules that could never run", () => {
    const withRoute = (id: string, route: FormRoute): FormField => ({
      id,
      type: "text",
      label: id,
      key: id,
      required: false,
      routes: [route],
    });
    const s = schemaOf([
      withRoute("noTarget", { action: "write_column", when: "always" }),
      withRoute("noList", { action: "store", when: "in", whenValue: "1" }),
      withRoute("noNumber", { action: "store", when: "gt", whenValue: "lots" }),
      withRoute("noValue", { action: "store", when: "equals" }),
      withRoute("badAction", { action: "email" as FormRoute["action"], when: "always" }),
      withRoute("badWhen", { action: "store", when: "maybe" as FormRoute["when"] }),
      withRoute("ok", { action: "attach", when: "always" }),
    ]);
    expect(validateFormSchema(s)).toEqual({
      noTarget: "A write_column route needs a target",
      noList: 'An "in" rule needs a list of values',
      noNumber: 'A "gt" rule needs a number',
      noValue: 'A "equals" rule needs a value',
      badAction: 'Unknown route action "email"',
      badWhen: 'Unknown route rule "maybe"',
    });
  });
});

// ────────────────────────────────────────────────────────────
// Route matching
// ────────────────────────────────────────────────────────────

describe("routeMatches", () => {
  const low: FormRoute = { action: "open_followup", when: "lt", whenValue: 3 };
  const lowIn: FormRoute = { action: "open_followup", when: "in", whenValue: [1, 2] };

  it("a score of 1–2 fires, 3–5 does not (lt and in)", () => {
    for (const v of [1, 2, "1", "2"]) {
      expect(routeMatches(low, v)).toBe(true);
      expect(routeMatches(lowIn, v)).toBe(true);
    }
    for (const v of [3, 4, 5, "3", "5"]) {
      expect(routeMatches(low, v)).toBe(false);
      expect(routeMatches(lowIn, v)).toBe(false);
    }
  });

  it("saved > 0 fires; 0 does not", () => {
    const r: FormRoute = { action: "slack", target: "pastors", when: "gt", whenValue: 0 };
    expect(routeMatches(r, 1)).toBe(true);
    expect(routeMatches(r, "6")).toBe(true);
    expect(routeMatches(r, 0)).toBe(false);
    expect(routeMatches(r, "0")).toBe(false);
  });

  it("equals and not_equals compare answers as text", () => {
    const eq: FormRoute = { action: "care_board", when: "equals", whenValue: "Conflict" };
    const ne: FormRoute = { action: "store", when: "not_equals", whenValue: "Other" };
    expect(routeMatches(eq, "Conflict")).toBe(true);
    expect(routeMatches(eq, "conflict")).toBe(false);
    expect(routeMatches(eq, "Time")).toBe(false);
    expect(routeMatches(ne, "Time")).toBe(true);
    expect(routeMatches(ne, "Other")).toBe(false);
    expect(routeMatches({ action: "store", when: "equals", whenValue: 3 }, "3")).toBe(true);
  });

  it("includes and in match multi-pick answers by membership", () => {
    const inc: FormRoute = { action: "open_followup", when: "includes", whenValue: "Pastoral care" };
    expect(routeMatches(inc, ["Worship", "Pastoral care"])).toBe(true);
    expect(routeMatches(inc, ["Worship"])).toBe(false);
    expect(routeMatches(inc, "Pastoral care")).toBe(true);
    const any: FormRoute = { action: "store", when: "in", whenValue: ["Conflict", "Burnout"] };
    expect(routeMatches(any, ["Time", "Burnout"])).toBe(true);
    expect(routeMatches(any, ["Time"])).toBe(false);
    expect(routeMatches({ action: "store", when: "equals", whenValue: "Worship" }, ["Worship"])).toBe(false);
  });

  it("an unanswered field fires nothing, not even always", () => {
    const always: FormRoute = { action: "store", when: "always" };
    for (const v of [undefined, null, "", [], false]) expect(routeMatches(always, v)).toBe(false);
    expect(routeMatches(always, 0)).toBe(true);
    expect(routeMatches({ action: "store", when: "not_equals", whenValue: "x" }, "")).toBe(false);
  });

  it("gt / lt ignore answers that are not numbers", () => {
    expect(routeMatches({ action: "store", when: "gt", whenValue: 0 }, "lots")).toBe(false);
    expect(routeMatches({ action: "store", when: "lt", whenValue: "x" }, 1)).toBe(false);
  });
});

describe("firedRoutes", () => {
  const fired = (data: Record<string, unknown>) =>
    firedRoutes(weekly, data).map((f) => `${f.field.key}:${f.route.action}`);

  it("a low leader score, a salvation and a conflict all fire", () => {
    expect(fired({ leader_score: 2, saved_count: 1, challenge_type: "Conflict" })).toEqual([
      "leader_score:write_column",
      "leader_score:open_followup",
      "saved_count:slack",
      "challenge_type:care_board",
    ]);
  });

  it("an ordinary week fires only the column write", () => {
    expect(fired({ leader_score: 4, saved_count: 0, challenge_type: "Time" })).toEqual([
      "leader_score:write_column",
    ]);
  });

  it("a field hidden by showWhen fires nothing", () => {
    const followUp: FormField = {
      id: "f_detail",
      type: "long_text",
      label: "Tell us more",
      key: "challenge_notes",
      required: false,
      parentFieldId: "f_challenge",
      showWhenValue: "Conflict",
      routes: [{ action: "care_board", when: "always" }],
    };
    const s = schemaOf([challenge, followUp]);
    const keys = (data: Record<string, unknown>) => firedRoutes(s, data).map((f) => f.field.key);
    expect(keys({ challenge_type: "Time", challenge_notes: "Busy month" })).toEqual([]);
    expect(keys({ challenge_type: "Conflict", challenge_notes: "Two members" })).toEqual([
      "challenge_type",
      "challenge_notes",
    ]);
  });
});
