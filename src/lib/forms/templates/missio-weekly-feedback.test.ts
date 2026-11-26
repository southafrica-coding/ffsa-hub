import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { HOUSE_FEEDBACK_COLUMNS, nameShared } from "../route-runner";
import { fieldKey, firedRoutes, validateFormSchema, validateSubmission, type FormField } from "../schema";
import {
  CHALLENGE_TYPES,
  CONFLICT_CHALLENGE,
  missioWeeklyFeedbackFormRow,
  missioWeeklyFeedbackSchema,
  moodFromConnected,
  NO_HELP_NEEDED,
} from "./missio-weekly-feedback";

const schema = missioWeeklyFeedbackSchema();
const fields: FormField[] = schema.steps.flatMap((s) => s.fields);
const byKey = (key: string) => fields.find((f) => fieldKey(f) === key) as FormField;

/** A full, quiet week: nothing for a coach or pastor to hear about. */
const quiet: Record<string, unknown> = {
  attendance: 11,
  first_time_count: 1,
  guest_count: 4,
  share_name: false,
  member_count: 12,
  invited_count: 3,
  saved_count: 0,
  recommitted_count: 1,
  prophetic_count: 2,
  healing_count: 0,
  deliverance_count: 0,
  win_type: "Deeper friendships and community",
  win_notes: "Two quieter people stayed to talk.",
  challenge_type: "Keeping people connected during the week",
  challenge_notes: "Midweek chat is quiet.",
  connected_score: 3,
  welcome_score: 4,
  activities: ["Worship", "Prayer"],
  leader_score: 4,
  training_needs: [NO_HELP_NEEDED],
};

const slackFired = (data: Record<string, unknown>) =>
  firedRoutes(schema, data)
    .filter((f) => f.route.action === "slack")
    .map((f) => `${fieldKey(f.field)}→${f.route.target}`);

describe("Missio weekly feedback template", () => {
  it("is a valid schema with fixed ids", () => {
    expect(validateFormSchema(schema)).toEqual({});
    const ids = fields.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith("wf_"))).toBe(true);
    // Same output every time: the seeded row and this file line up.
    expect(missioWeeklyFeedbackSchema()).toEqual(schema);
  });

  it("asks Marlon's questions 4–23 and Jack's extras, not house, leaders or Sunday", () => {
    const marlon = [
      "attendance", "first_time_count", "member_count", "guest_count", "invited_count",
      "saved_count", "recommitted_count", "prophetic_count", "healing_count", "deliverance_count",
      "win_type", "win_notes", "challenge_type", "challenge_notes", "testimonies",
      "connected_score", "welcome_score", "activities", "leader_score", "training_needs",
    ];
    const keys = fields.map(fieldKey);
    for (const k of marlon) expect(keys).toContain(k);
    expect(keys).toEqual(expect.arrayContaining(["share_name", "first_name", "phone", "prayer"]));
    expect(keys).not.toEqual(expect.arrayContaining(["house", "house_number", "leaders", "meeting_date", "mood", "new_names"]));
    expect(fields[fields.length - 1].key).toBe("prayer");
    expect(byKey("prayer").required).toBe(false);
    expect(byKey("testimonies").required).toBe(false);
  });

  it("uses steppers and 1–5 scales, with the counts of fruit 0–6", () => {
    for (const k of ["attendance", "first_time_count", "member_count", "guest_count", "invited_count"]) {
      expect(byKey(k)).toMatchObject({ type: "stepper", min: 0, max: 500 });
    }
    for (const k of ["saved_count", "recommitted_count", "prophetic_count", "healing_count", "deliverance_count"]) {
      expect(byKey(k)).toMatchObject({ type: "stepper", min: 0, max: 6, maxLabel: "More than 5" });
    }
    for (const k of ["connected_score", "welcome_score", "leader_score"]) {
      expect(byKey(k)).toMatchObject({ type: "linear_scale", min: 1, max: 5 });
    }
    expect(fields.some((f) => f.type === "dropdown" && (f.options?.length ?? 0) > 12)).toBe(false);
  });

  it("writes every column answer to a real missio_house_feedback column", () => {
    const targets = fields.flatMap((f) => (f.routes ?? []).filter((r) => r.action === "write_column").map((r) => r.target as string));
    expect(targets.length).toBeGreaterThanOrEqual(21);
    for (const t of targets) expect(HOUSE_FEEDBACK_COLUMNS[t]).toBeDefined();
    // The name never lands on the feedback row.
    expect(targets).not.toContain("first_name");
    expect(targets).not.toContain("new_names");
  });

  it("passes a full quiet week and tells nobody", () => {
    expect(validateSubmission(schema, quiet, { requireContactField: false })).toEqual({ valid: true, errors: {} });
    expect(slackFired(quiet)).toEqual([]);
    expect(firedRoutes(schema, quiet).some((f) => f.route.action === "open_followup")).toBe(false);
  });

  it("tells the coach for a leader score of 1 or 2, not 3", () => {
    expect(slackFired({ ...quiet, leader_score: 1 })).toEqual(["leader_score→coach"]);
    expect(slackFired({ ...quiet, leader_score: 2 })).toEqual(["leader_score→coach"]);
    expect(slackFired({ ...quiet, leader_score: 3 })).toEqual([]);
  });

  it("tells the coach only for exactly 'Conflict or tension in the group'", () => {
    expect(CHALLENGE_TYPES).toContain(CONFLICT_CHALLENGE);
    expect(slackFired({ ...quiet, challenge_type: CONFLICT_CHALLENGE })).toEqual(["challenge_type→coach"]);
    expect(slackFired({ ...quiet, challenge_type: "Leader capacity or tiredness" })).toEqual([]);
    expect(slackFired({ ...quiet, challenge_type: "conflict or tension in the group " })).toEqual([]);
  });

  it("tells the coach when training is asked for, not for 'No help needed'", () => {
    expect(slackFired({ ...quiet, training_needs: ["Discipleship"] })).toEqual(["training_needs→coach"]);
    expect(slackFired({ ...quiet, training_needs: [NO_HELP_NEEDED, "Hospitality"] })).toEqual(["training_needs→coach"]);
    expect(slackFired({ ...quiet, training_needs: [NO_HELP_NEEDED] })).toEqual([]);
  });

  it("tells the pastors when someone got saved", () => {
    expect(slackFired({ ...quiet, saved_count: 1 })).toEqual(["saved_count→pastors"]);
    expect(slackFired({ ...quiet, saved_count: 0 })).toEqual([]);
  });

  it("sends prayer to the Care board, never to Slack", () => {
    const fired = firedRoutes(schema, { ...quiet, prayer: "Pray for a job" });
    expect(fired.filter((f) => f.field.key === "prayer").map((f) => f.route.action).sort()).toEqual(["care_board", "write_column"]);
  });

  describe("first-timers", () => {
    it("stay a count: no name questions unless the box is ticked", () => {
      expect(byKey("share_name")).toMatchObject({ type: "checkbox", required: false });
      const withNameButNoTick = { ...quiet, first_name: "Thabo", phone: "0821234567" };
      expect(nameShared(schema, withNameButNoTick)).toBe(false);
      expect(firedRoutes(schema, withNameButNoTick).filter((f) => f.field.key === "first_name")).toEqual([]);
    });

    it("ask for a name and phone, and open follow-up, only when ticked", () => {
      const ticked = { ...quiet, share_name: true };
      const v = validateSubmission(schema, ticked, { requireContactField: false });
      expect(Object.keys(v.errors).sort()).toEqual(["first_name", "phone"]);

      const shared = { ...ticked, first_name: "Thabo", phone: "0821234567" };
      expect(nameShared(schema, shared)).toBe(true);
      const actions = firedRoutes(schema, shared)
        .filter((f) => ["first_name", "phone"].includes(f.field.key))
        .map((f) => `${f.field.key}:${f.route.action}`);
      expect(actions).toEqual(["first_name:create_or_update_contact", "first_name:open_followup", "phone:create_or_update_contact"]);
    });
  });

  it("seeds as a token form about a house", () => {
    expect(missioWeeklyFeedbackFormRow()).toMatchObject({
      slug: "missio-weekly-feedback",
      kind: "missio_weekly_feedback",
      access_mode: "token",
      subject_type: "house",
      event_id: null,
      label_id: null,
    });
  });

  it("reads the history board's mood off the connected score", () => {
    expect([1, 2, 3, 4, 5].map(moodFromConnected)).toEqual(["hard", "hard", "okay", "good", "great"]);
    expect(moodFromConnected(undefined)).toBe("okay");
  });
});
