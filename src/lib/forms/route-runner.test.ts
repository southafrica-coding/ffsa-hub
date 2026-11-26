import { beforeEach, describe, expect, it, vi } from "vitest";

// The route runner against a fake database and a fake Slack. Nothing here
// reaches Supabase or Slack: every query is recorded and answered by
// `answer` below, and Slack is a set of vi.fn()s.

vi.mock("server-only", () => ({}));
const upsertContact = vi.hoisted(() => vi.fn());
vi.mock("@/services/contact-upsert", () => ({ upsertContactWithDedup: upsertContact }));
// The real client must never be reached; fail loudly if it is.
vi.mock("@/lib/slack/client", () => ({
  openConversation: () => {
    throw new Error("real Slack client called");
  },
  postMessage: () => {
    throw new Error("real Slack client called");
  },
  updateMessage: () => {
    throw new Error("real Slack client called");
  },
}));

import { coerceColumnValue, HOUSE_FEEDBACK_COLUMNS, nameShared, runFormRoutes, submissionSubject } from "./route-runner";
import type { FormField, FormSchema } from "./schema";

// ── fake database ───────────────────────────────────────────

type Query = {
  table: string;
  op: "select" | "insert" | "upsert" | "update" | "delete";
  payload?: unknown;
  options?: unknown;
  filters: Array<[string, string, unknown]>;
};

const HOUSE = { id: "11111111-1111-4111-8111-111111111111", org_id: "org-missio", number: 7, name: "Ikageng", meeting_day: "sunday" };
const FEEDBACK_ID = "feedback-1";
const SUBMISSION_ID = "sub-1";

let queries: Query[];
let tracked: Array<{ id: string; recipient_user_id: string; slack_channel: string; slack_ts: string }>;
let careInsertError: { code: string; message: string } | null;
let followupInsertError: { code: string; message: string } | null;

function answer(q: Query): { data: unknown; error: unknown } {
  const eq = (col: string) => q.filters.find(([op, c]) => op === "eq" && c === col)?.[2];
  switch (q.table) {
    case "house_churches":
      return { data: eq("id") === HOUSE.id ? HOUSE : null, error: null };
    case "missio_house_feedback":
      return { data: { id: FEEDBACK_ID }, error: null };
    case "missio_care_requests":
      return q.op === "insert" ? { data: null, error: careInsertError } : { data: null, error: null };
    case "missio_followups":
      return { data: null, error: followupInsertError };
    case "missio_coach_assignments":
      return { data: [{ coach_contact_id: "coach-contact" }], error: null };
    case "org_staff_roles":
      return { data: [{ user_id: "pastor-user" }], error: null };
    case "users": {
      const ids = (q.filters.find(([op]) => op === "in")?.[2] as string[]) ?? [];
      const all = [
        { id: "coach-user", contact_id: "coach-contact", slack_user_id: "UCOACH" },
        { id: "pastor-user", contact_id: "pastor-contact", slack_user_id: "UPASTOR" },
      ];
      const col = q.filters.find(([op]) => op === "in")?.[1];
      return { data: all.filter((u) => ids.includes(col === "contact_id" ? u.contact_id : u.id)), error: null };
    }
    case "form_route_slack_messages":
      if (q.op === "select") return { data: tracked, error: null };
      if (q.op === "insert") return { data: { id: `claim-${(q.payload as { recipient_user_id: string }).recipient_user_id}` }, error: null };
      return { data: null, error: null };
    default:
      return { data: null, error: null };
  }
}

function fakeDb() {
  return {
    from(table: string) {
      const q: Query = { table, op: "select", filters: [] };
      const builder: Record<string, unknown> = {};
      const chain = (fn: (...a: unknown[]) => void) => (...a: unknown[]) => {
        fn(...a);
        return builder;
      };
      builder.select = chain(() => {});
      builder.insert = chain((p) => Object.assign(q, { op: "insert", payload: p }));
      builder.upsert = chain((p, o) => Object.assign(q, { op: "upsert", payload: p, options: o }));
      builder.update = chain((p) => Object.assign(q, { op: "update", payload: p }));
      builder.delete = chain(() => Object.assign(q, { op: "delete" }));
      for (const op of ["eq", "is", "in"]) builder[op] = chain((c, v) => q.filters.push([op, c as string, v]));
      builder.maybeSingle = chain(() => {});
      builder.single = chain(() => {});
      builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        queries.push(q);
        return Promise.resolve(answer(q)).then(resolve, reject);
      };
      return builder;
    },
  };
}

const writes = () => queries.filter((q) => q.op !== "select");
const writesTo = (table: string) => writes().filter((q) => q.table === table);

// ── fake Slack ──────────────────────────────────────────────

const slack = {
  openConversation: vi.fn(async (user: string) => ({ ok: true, channel: { id: `D-${user}` } })),
  postMessage: vi.fn(async (args: { channel: string }) => ({ ok: true, ts: "1.0001", channel: args.channel })),
  updateMessage: vi.fn(async () => ({ ok: true })),
};

const LIVE = { VERCEL_ENV: "production", HUB_FORMS_SLACK_ENABLED: "1", SLACK_BOT_TOKEN: "test-token" } as unknown as NodeJS.ProcessEnv;
const FLAG_OFF = { VERCEL_ENV: "production", SLACK_BOT_TOKEN: "test-token" } as unknown as NodeJS.ProcessEnv;
const PREVIEW = { VERCEL_ENV: "preview", HUB_FORMS_SLACK_ENABLED: "1", SLACK_BOT_TOKEN: "test-token" } as unknown as NodeJS.ProcessEnv;
const NOW = new Date("2026-11-23T16:00:00Z"); // a Monday in Johannesburg

// ── a weekly-feedback-shaped form ───────────────────────────

const CONFLICT = "Conflict or tension in the group";

function field(f: Partial<FormField> & Pick<FormField, "id" | "type" | "key">): FormField {
  return { label: f.id, required: false, ...f };
}

const schema: FormSchema = {
  version: 1,
  branding: {},
  thankYou: { heading: "Thanks", message: "" },
  steps: [
    {
      id: "s1",
      title: "This week",
      fields: [
        field({ id: "attendance", type: "stepper", key: "attendance", routes: [{ action: "write_column", target: "attendance", when: "always" }] }),
        field({
          id: "mood",
          type: "radio",
          key: "mood",
          options: ["hard", "okay", "good", "great"],
          routes: [{ action: "write_column", target: "mood", when: "always" }],
        }),
        field({
          id: "leader",
          type: "linear_scale",
          key: "leader_score",
          label: "How are you doing as a leader?",
          routes: [
            { action: "store", when: "always" },
            { action: "write_column", target: "leader_score", when: "always" },
            { action: "slack", target: "coach", when: "lt", whenValue: 3 },
          ],
        }),
        field({
          id: "saved",
          type: "stepper",
          key: "saved_count",
          label: "Saved",
          max: 6,
          routes: [
            { action: "write_column", target: "saved_count", when: "always" },
            { action: "slack", target: "pastors", when: "gt", whenValue: 0 },
            { action: "open_followup", target: "pastors", when: "gt", whenValue: 0 },
          ],
        }),
        field({
          id: "challenge",
          type: "radio",
          key: "challenge_type",
          label: "Biggest challenge",
          options: ["None", CONFLICT, "Low attendance"],
          routes: [
            { action: "write_column", target: "challenge_type", when: "always" },
            { action: "slack", target: "coach", when: "equals", whenValue: CONFLICT },
          ],
        }),
        field({
          id: "prayer",
          type: "long_text",
          key: "prayer",
          label: "Prayer",
          routes: [
            { action: "write_column", target: "prayer", when: "always" },
            { action: "care_board", target: "prayer", when: "always" },
            { action: "slack", target: "pastors", when: "always" },
          ],
        }),
        field({ id: "share", type: "yes_no", key: "share_name", label: "Can you share a name?" }),
        field({
          id: "saved_name",
          type: "text",
          key: "saved_first_name",
          parentFieldId: "share",
          showWhenValue: "Yes",
          routes: [{ action: "create_or_update_contact", target: "first_name", when: "always" }],
        }),
        field({
          id: "saved_phone",
          type: "phone",
          key: "saved_phone",
          parentFieldId: "share",
          showWhenValue: "Yes",
          routes: [{ action: "create_or_update_contact", target: "phone", when: "always" }],
        }),
      ],
    },
  ],
};

const form = { id: "form-1", name: "House feedback", slug: "house-feedback", event_id: null, department_id: null };
const quietWeek = { attendance: 12, mood: "good", leader_score: 4, saved_count: 0, challenge_type: "None" };

function run(data: Record<string, unknown>, env: NodeJS.ProcessEnv = LIVE, subject: { type: "house"; id: string } | null = { type: "house", id: HOUSE.id }) {
  return runFormRoutes(
    fakeDb(),
    { form, schema, data, submissionId: SUBMISSION_ID, contactId: null, subject },
    { env, now: NOW, slack }
  );
}

beforeEach(() => {
  queries = [];
  tracked = [];
  careInsertError = null;
  followupInsertError = null;
  slack.openConversation.mockClear();
  slack.postMessage.mockClear();
  slack.updateMessage.mockClear();
  upsertContact.mockReset();
  upsertContact.mockResolvedValue({ data: { action: "created", contactId: "saved-contact" }, error: null });
});

// ── Slack rules ─────────────────────────────────────────────

describe("slack routes", () => {
  it.each([1, 2])("leader score %i DMs the coach", async (score) => {
    const results = await run({ ...quietWeek, leader_score: score });
    expect(slack.postMessage).toHaveBeenCalledTimes(1);
    expect(slack.openConversation).toHaveBeenCalledWith("UCOACH");
    expect(results).toContainEqual(expect.objectContaining({ fieldId: "leader", action: "slack", status: "done" }));
  });

  it.each([3, 4, 5])("leader score %i sends nothing", async (score) => {
    const results = await run({ ...quietWeek, leader_score: score });
    expect(slack.postMessage).not.toHaveBeenCalled();
    expect(results.filter((r) => r.action === "slack")).toEqual([]);
  });

  it("saved > 0 DMs the pastors", async () => {
    await run({ ...quietWeek, saved_count: 2 });
    expect(slack.openConversation).toHaveBeenCalledWith("UPASTOR");
    const card = JSON.stringify(slack.postMessage.mock.calls[0][0]);
    expect(card).toContain("Saved");
    expect(card).toContain("Open in Hub");
    expect(card).toContain(`/missio/house-churches/${HOUSE.id}`);
  });

  it(`challenge "${CONFLICT}" DMs the coach; another challenge does not`, async () => {
    await run({ ...quietWeek, challenge_type: CONFLICT });
    expect(slack.openConversation).toHaveBeenCalledWith("UCOACH");
    slack.postMessage.mockClear();
    await run({ ...quietWeek, challenge_type: "Low attendance" });
    expect(slack.postMessage).not.toHaveBeenCalled();
  });

  it("a quiet week sends nothing", async () => {
    const results = await run(quietWeek);
    expect(slack.openConversation).not.toHaveBeenCalled();
    expect(slack.postMessage).not.toHaveBeenCalled();
    expect(slack.updateMessage).not.toHaveBeenCalled();
    expect(results.every((r) => r.action !== "slack")).toBe(true);
  });

  it("one card per person, with every reason for them", async () => {
    await run({ ...quietWeek, leader_score: 1, challenge_type: CONFLICT });
    expect(slack.postMessage).toHaveBeenCalledTimes(1);
    const card = JSON.stringify(slack.postMessage.mock.calls[0][0]);
    expect(card).toContain("How are you doing as a leader?");
    expect(card).toContain(CONFLICT);
  });

  it("never quotes a care need in Slack", async () => {
    await run({ ...quietWeek, prayer: "Pray for my marriage" });
    expect(slack.postMessage).toHaveBeenCalledTimes(1);
    const card = JSON.stringify(slack.postMessage.mock.calls[0][0]);
    expect(card).not.toContain("marriage");
    expect(card).toContain("on the Care board for the pastors");
  });

  it("sending again rewrites the DM in place", async () => {
    tracked = [{ id: "t1", recipient_user_id: "coach-user", slack_channel: "D-UCOACH", slack_ts: "1.0001" }];
    await run({ ...quietWeek, leader_score: 1 });
    expect(slack.postMessage).not.toHaveBeenCalled();
    expect(slack.updateMessage).toHaveBeenCalledWith(expect.objectContaining({ channel: "D-UCOACH", ts: "1.0001" }));
    expect(JSON.stringify(slack.updateMessage.mock.calls[0])).toContain("sent the form again");
  });

  it("sending again with nothing to flag rewrites the old DM and tells nobody new", async () => {
    tracked = [{ id: "t1", recipient_user_id: "coach-user", slack_channel: "D-UCOACH", slack_ts: "1.0001" }];
    await run(quietWeek);
    expect(slack.postMessage).not.toHaveBeenCalled();
    expect(slack.updateMessage).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(slack.updateMessage.mock.calls[0])).toContain("nothing needs a look now");
  });

  it("flag off: no Slack call, no tracking read, no throw", async () => {
    const results = await run({ ...quietWeek, leader_score: 1, saved_count: 3 }, FLAG_OFF);
    expect(slack.openConversation).not.toHaveBeenCalled();
    expect(slack.postMessage).not.toHaveBeenCalled();
    expect(queries.some((q) => q.table === "form_route_slack_messages")).toBe(false);
    expect(results.filter((r) => r.action === "slack").every((r) => r.status === "skipped" && r.reason === "flag_off")).toBe(true);
  });

  it("flag on but not the live site: no Slack call", async () => {
    await run({ ...quietWeek, leader_score: 1 }, { ...LIVE, VERCEL_ENV: "development" } as NodeJS.ProcessEnv);
    expect(slack.postMessage).not.toHaveBeenCalled();
  });
});

// ── preview ─────────────────────────────────────────────────

describe("preview deployments", () => {
  it("write nothing and send nothing, even with the flag on", async () => {
    const results = await run({ ...quietWeek, leader_score: 1, saved_count: 3, prayer: "x", share_name: "Yes", saved_phone: "0821234567" }, PREVIEW);
    expect(queries).toEqual([]);
    expect(upsertContact).not.toHaveBeenCalled();
    expect(slack.openConversation).not.toHaveBeenCalled();
    expect(slack.postMessage).not.toHaveBeenCalled();
    const acting = results.filter((r) => r.action !== "store");
    expect(acting.length).toBeGreaterThan(0);
    expect(acting.every((r) => r.status === "skipped" && r.reason === "preview")).toBe(true);
  });

  it("PREVIEW_WRITES_DISABLED does the same off Vercel", async () => {
    await run({ ...quietWeek, prayer: "x" }, { ...LIVE, PREVIEW_WRITES_DISABLED: "1" } as NodeJS.ProcessEnv);
    expect(queries).toEqual([]);
  });
});

// ── write_column ────────────────────────────────────────────

describe("write_column", () => {
  it("upserts the house's week on the existing unique key and links the submission", async () => {
    await run({ ...quietWeek, meeting_date: "2026-11-22" });
    const [w] = writesTo("missio_house_feedback");
    expect(w.op).toBe("upsert");
    expect(w.options).toEqual({ onConflict: "house_church_id,meeting_date" });
    expect(w.payload).toMatchObject({
      house_church_id: HOUSE.id,
      meeting_date: "2026-11-22",
      form_submission_id: SUBMISSION_ID,
      attendance: 12,
      mood: "good",
      leader_score: 4,
      saved_count: 0,
      challenge_type: "None",
      prayer: null, // asked "always", left blank: cleared on a send-again
    });
  });

  it("falls back to the house's meeting day when the date is missing or in the future", async () => {
    await run({ ...quietWeek, meeting_date: "2027-01-01" });
    expect(writesTo("missio_house_feedback")[0].payload).toMatchObject({ meeting_date: "2026-11-22" });
  });

  it("skips without a house", async () => {
    const results = await run(quietWeek, LIVE, null);
    expect(writesTo("missio_house_feedback")).toEqual([]);
    expect(results.filter((r) => r.action === "write_column").every((r) => r.reason === "no_house")).toBe(true);
  });

  it("skips an unknown column or a value that does not fit", () => {
    expect(coerceColumnValue(HOUSE_FEEDBACK_COLUMNS.leader_score, 9)).toBeUndefined();
    expect(coerceColumnValue(HOUSE_FEEDBACK_COLUMNS.saved_count, "6")).toBe(6);
    expect(coerceColumnValue(HOUSE_FEEDBACK_COLUMNS.mood, "Great")).toBe("great");
    expect(coerceColumnValue(HOUSE_FEEDBACK_COLUMNS.activities, ["a", "a", "b"])).toEqual(["a", "b"]);
  });
});

// ── follow-up and contacts ──────────────────────────────────

describe("open_followup", () => {
  it("does not open without a shared name", async () => {
    const results = await run({ ...quietWeek, saved_count: 2, share_name: "No" });
    expect(writesTo("missio_followups")).toEqual([]);
    expect(upsertContact).not.toHaveBeenCalled();
    expect(results).toContainEqual(expect.objectContaining({ action: "open_followup", status: "skipped", reason: "not_shared" }));
  });

  it("does not open when the form never asked to share", async () => {
    const noShare: FormSchema = {
      ...schema,
      steps: [{ ...schema.steps[0], fields: schema.steps[0].fields.filter((f) => f.key !== "share_name") }],
    };
    await runFormRoutes(
      fakeDb(),
      { form, schema: noShare, data: { ...quietWeek, saved_count: 2 }, submissionId: SUBMISSION_ID, contactId: "someone", subject: { type: "house", id: HOUSE.id } },
      { env: FLAG_OFF, now: NOW, slack }
    );
    expect(writesTo("missio_followups")).toEqual([]);
  });

  it("opens one with a shared name and number", async () => {
    const results = await run({ ...quietWeek, saved_count: 1, share_name: "Yes", saved_first_name: "Thabo", saved_phone: "0821234567" }, FLAG_OFF);
    expect(upsertContact).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ contact: { first_name: "Thabo", phone: "0821234567" } })
    );
    expect(writesTo("org_people")[0].payload).toMatchObject({ org_id: HOUSE.org_id, contact_id: "saved-contact" });
    expect(writesTo("missio_followups")[0].payload).toEqual({ org_id: HOUSE.org_id, contact_id: "saved-contact", stage: "new" });
    expect(results).toContainEqual(expect.objectContaining({ action: "open_followup", status: "done" }));
  });

  it("does not fire when nobody was saved", async () => {
    await run({ ...quietWeek, share_name: "Yes", saved_first_name: "Thabo", saved_phone: "0821234567" }, FLAG_OFF);
    expect(writesTo("missio_followups")).toEqual([]);
  });

  it("an already open follow-up is fine", async () => {
    followupInsertError = { code: "23505", message: "duplicate" };
    const results = await run({ ...quietWeek, saved_count: 1, share_name: "Yes", saved_first_name: "T", saved_phone: "0821234567" }, FLAG_OFF);
    expect(results).toContainEqual(expect.objectContaining({ action: "open_followup", status: "done", reason: "already_open" }));
  });

  it("a shared name with no number makes no contact and opens nothing", async () => {
    const results = await run({ ...quietWeek, saved_count: 1, share_name: "Yes", saved_first_name: "Thabo" }, FLAG_OFF);
    expect(upsertContact).not.toHaveBeenCalled();
    expect(results).toContainEqual(expect.objectContaining({ action: "open_followup", reason: "no_contact" }));
  });

  it("nameShared needs a yes on the share question", () => {
    expect(nameShared(schema, { share_name: "Yes" })).toBe(true);
    expect(nameShared(schema, { share_name: "No" })).toBe(false);
    expect(nameShared(schema, {})).toBe(false);
  });
});

// ── care board ──────────────────────────────────────────────

describe("care_board", () => {
  it("opens a pastors-only Care request tied to the week's feedback row", async () => {
    await run({ ...quietWeek, prayer: "  Pray for rain  " }, FLAG_OFF);
    const [care] = writesTo("missio_care_requests");
    expect(care.op).toBe("insert");
    expect(care.payload).toMatchObject({
      org_id: HOUSE.org_id,
      source: "house_feedback",
      source_id: FEEDBACK_ID,
      house_church_id: HOUSE.id,
      needs: ["prayer"],
      body: "Pray for rain",
      privacy: "pastors",
    });
  });

  it("sending again refreshes the words only while it is still new", async () => {
    careInsertError = { code: "23505", message: "duplicate" };
    await run({ ...quietWeek, prayer: "Updated" }, FLAG_OFF);
    const update = writesTo("missio_care_requests").find((q) => q.op === "update");
    expect(update?.payload).toEqual({ body: "Updated", needs: ["prayer"] });
    expect(update?.filters).toContainEqual(["eq", "status", "new"]);
  });

  it("no prayer, no Care request", async () => {
    await run(quietWeek, FLAG_OFF);
    expect(writesTo("missio_care_requests")).toEqual([]);
  });

  it("skips without a house", async () => {
    await run({ ...quietWeek, prayer: "x" }, FLAG_OFF, null);
    expect(writesTo("missio_care_requests")).toEqual([]);
  });
});

// ── attach, store, unfired ──────────────────────────────────

describe("attach and store", () => {
  const attachSchema: FormSchema = {
    ...schema,
    steps: [
      {
        id: "s",
        title: "",
        fields: [
          field({ id: "a", type: "text", key: "note", routes: [{ action: "attach", target: "department", when: "always" }, { action: "store", when: "always" }] }),
        ],
      },
    ],
  };
  const go = (data: Record<string, unknown>, department_id: string | null) =>
    runFormRoutes(
      fakeDb(),
      { form: { ...form, department_id }, schema: attachSchema, data, submissionId: SUBMISSION_ID, contactId: null, subject: null },
      { env: FLAG_OFF, now: NOW, slack }
    );

  it("attaches the submission to the form's department", async () => {
    const results = await go({ note: "hi" }, "dept-1");
    const [w] = writesTo("form_submissions");
    expect(w.payload).toEqual({ subject_type: "department", subject_id: "dept-1" });
    expect(w.filters).toContainEqual(["eq", "id", SUBMISSION_ID]);
    expect(results).toContainEqual(expect.objectContaining({ action: "store", status: "done" }));
  });

  it("skips when the form has no department", async () => {
    const results = await go({ note: "hi" }, null);
    expect(writesTo("form_submissions")).toEqual([]);
    expect(results).toContainEqual(expect.objectContaining({ action: "attach", status: "skipped", reason: "no_department" }));
  });

  it("an unanswered field fires nothing at all", async () => {
    expect(await go({}, "dept-1")).toEqual([]);
    expect(queries).toEqual([]);
  });
});

describe("submissionSubject", () => {
  it("is only what the server can vouch for", () => {
    expect(submissionSubject({ subject_type: "contact" }, "c1")).toEqual({ type: "contact", id: "c1" });
    expect(submissionSubject({ subject_type: "department", department_id: "d1" }, null)).toEqual({ type: "department", id: "d1" });
    expect(submissionSubject({ subject_type: "house" }, "c1")).toBeNull();
    expect(submissionSubject({}, "c1")).toBeNull();
  });
});
