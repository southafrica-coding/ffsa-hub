import { beforeEach, describe, expect, it, vi } from "vitest";

// The weekly feedback save path against a fake database. Nothing here
// reaches Supabase or Slack.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => null }));
const upsertContact = vi.hoisted(() => vi.fn());
vi.mock("@/services/contact-upsert", () => ({ upsertContactWithDedup: upsertContact }));
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

import { missioWeeklyFeedbackFormRow } from "@/lib/forms/templates/missio-weekly-feedback";
import { cleanAnswers, feedbackSunday, loadWeeklyFillView, saveWeeklyFeedback, type WeeklyHouse } from "./weekly-feedback";

type Query = { table: string; op: string; payload?: unknown; filters: Array<[string, string, unknown]> };

const HOUSE: WeeklyHouse = { id: "11111111-1111-4111-8111-111111111118", org_id: "org-missio", number: 18, name: "Wikus & Allyson Roestorf and Jack & Krissy", meeting_day: null };
const LINK_ID = "22222222-2222-4222-8222-222222222222";
const FORM = { id: "form-1", ...missioWeeklyFeedbackFormRow() };
// Monday 23 Nov 2026, 09:00 in Johannesburg: the Sunday is the 22nd.
const NOW = new Date("2026-11-23T07:00:00Z");
const LIVE = { VERCEL_ENV: "production" } as unknown as NodeJS.ProcessEnv;

let queries: Query[];
let formRow: Record<string, unknown> | null;
let feedbackRows: Record<string, unknown>[];

function answer(q: Query) {
  switch (q.table) {
    case "forms":
      return { data: formRow, error: null };
    case "house_churches":
      return { data: HOUSE, error: null };
    case "form_submissions":
      return { data: { id: "sub-1" }, error: null };
    case "missio_house_feedback":
      return q.op === "upsert" ? { data: { id: "fb-1" }, error: null } : { data: feedbackRows, error: null };
    default:
      return { data: null, error: null };
  }
}

function fakeDb() {
  return {
    from(table: string) {
      const q: Query = { table, op: "select", filters: [] };
      const b: Record<string, unknown> = {};
      const chain = (fn: (...a: unknown[]) => void) => (...a: unknown[]) => (fn(...a), b);
      b.select = chain(() => {});
      b.insert = chain((p) => Object.assign(q, { op: "insert", payload: p }));
      b.upsert = chain((p) => Object.assign(q, { op: "upsert", payload: p }));
      b.update = chain((p) => Object.assign(q, { op: "update", payload: p }));
      for (const op of ["eq", "is", "in", "lte", "gte", "order", "limit"]) b[op] = chain((c, v) => q.filters.push([op, c as string, v]));
      b.maybeSingle = chain(() => {});
      b.single = chain(() => {});
      b.then = (resolve: (v: unknown) => unknown) => {
        queries.push(q);
        return Promise.resolve(answer(q)).then(resolve);
      };
      return b;
    },
  };
}

const writes = (table: string) => queries.filter((q) => q.table === table && q.op !== "select");

const answers = {
  attendance: 11,
  first_time_count: 1,
  guest_count: 4,
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
  connected_score: 4,
  welcome_score: 4,
  activities: ["Worship"],
  leader_score: 4,
  training_needs: ["No help needed right now"],
};

beforeEach(() => {
  queries = [];
  formRow = { ...FORM };
  feedbackRows = [];
  upsertContact.mockReset();
  upsertContact.mockResolvedValue({ data: { action: "created", contactId: "contact-1" }, error: null });
});

describe("feedbackSunday", () => {
  it("is the last Sunday for a house with no meeting day, and the house's own day otherwise", () => {
    expect(feedbackSunday(null, NOW)).toBe("2026-11-22");
    expect(feedbackSunday("", NOW)).toBe("2026-11-22");
    expect(feedbackSunday("wednesday", NOW)).toBe("2026-11-18");
    // Sunday evening is that Sunday.
    expect(feedbackSunday(null, new Date("2026-11-22T17:00:00Z"))).toBe("2026-11-22");
  });
});

describe("saveWeeklyFeedback", () => {
  it("passes the house to the route runner: the week's row is written for that house", async () => {
    const saved = await saveWeeklyFeedback(fakeDb(), { house: HOUSE, linkId: LINK_ID, answers }, { env: LIVE, now: NOW });
    expect(saved).toMatchObject({ ok: true, meetingDate: "2026-11-22" });
    if (!saved.ok) return;
    expect(saved.routes.some((r) => r.reason === "no_house")).toBe(false);

    const [submission] = writes("form_submissions");
    expect(submission.payload).toMatchObject({ form_id: "form-1", subject_type: "house", subject_id: HOUSE.id, contact_id: null });

    const [row] = writes("missio_house_feedback");
    expect(row.op).toBe("upsert");
    expect(row.payload).toMatchObject({
      house_church_id: HOUSE.id,
      meeting_date: "2026-11-22",
      link_id: LINK_ID,
      mood: "good",
      attendance: 11,
      first_time_count: 1,
      leader_score: 4,
      training_needs: ["No help needed right now"],
      form_submission_id: "sub-1",
    });
  });

  it("takes the Sunday from the server, never the browser", async () => {
    await saveWeeklyFeedback(fakeDb(), { house: HOUSE, answers: { ...answers, meeting_date: "2026-10-04", house_church_id: "x" } }, { env: LIVE, now: NOW });
    const [row] = writes("missio_house_feedback");
    expect(row.payload).toMatchObject({ meeting_date: "2026-11-22", house_church_id: HOUSE.id });
    expect(writes("form_submissions")[0].payload).not.toHaveProperty("raw_data.meeting_date");
  });

  it("opens follow-up for a first-timer only when the leader ticked 'Yes, I can share a name'", async () => {
    // Not ticked: the name is dropped before anything is saved.
    await saveWeeklyFeedback(fakeDb(), { house: HOUSE, answers: { ...answers, first_name: "Thabo", phone: "0821234567" } }, { env: LIVE, now: NOW });
    expect(upsertContact).not.toHaveBeenCalled();
    expect(writes("missio_followups")).toHaveLength(0);
    expect(JSON.stringify(writes("form_submissions")[0].payload)).not.toContain("Thabo");

    queries = [];
    await saveWeeklyFeedback(
      fakeDb(),
      { house: HOUSE, answers: { ...answers, share_name: true, first_name: "Thabo", phone: "0821234567" } },
      { env: LIVE, now: NOW }
    );
    expect(upsertContact).toHaveBeenCalledTimes(1);
    expect(upsertContact.mock.calls[0][1].contact).toMatchObject({ first_name: "Thabo", phone: "0821234567" });
    expect(writes("missio_followups")).toHaveLength(1);
    expect(writes("missio_followups")[0].payload).toMatchObject({ org_id: "org-missio", contact_id: "contact-1" });
    // The name is never written onto the house's row.
    expect(JSON.stringify(writes("missio_house_feedback")[0].payload)).not.toContain("Thabo");
  });

  it("refuses a ticked box with no name", async () => {
    const saved = await saveWeeklyFeedback(fakeDb(), { house: HOUSE, answers: { ...answers, share_name: true } }, { env: LIVE, now: NOW });
    expect(saved).toMatchObject({ ok: false, code: "invalid_input" });
    expect(!saved.ok && Object.keys(saved.fieldErrors ?? {}).sort()).toEqual(["first_name", "phone"]);
    expect(writes("form_submissions")).toHaveLength(0);
  });

  it("saves nothing on a preview, or before the form is seeded", async () => {
    const preview = await saveWeeklyFeedback(fakeDb(), { house: HOUSE, answers }, { env: { VERCEL_ENV: "preview" } as unknown as NodeJS.ProcessEnv, now: NOW });
    expect(preview).toMatchObject({ ok: false, code: "preview_writes_disabled" });
    expect(queries).toHaveLength(0);

    formRow = null;
    expect(await saveWeeklyFeedback(fakeDb(), { house: HOUSE, answers }, { env: LIVE, now: NOW })).toMatchObject({ ok: false, code: "not_open" });
    formRow = { ...FORM, is_active: false };
    expect(await saveWeeklyFeedback(fakeDb(), { house: HOUSE, answers }, { env: LIVE, now: NOW })).toMatchObject({ ok: false, code: "not_open" });
    expect(queries.filter((q) => q.op !== "select")).toHaveLength(0);
  });

  it("refuses missing answers", async () => {
    const { attendance: _drop, ...rest } = answers;
    void _drop;
    const saved = await saveWeeklyFeedback(fakeDb(), { house: HOUSE, answers: rest }, { env: LIVE, now: NOW });
    expect(saved).toMatchObject({ ok: false, code: "invalid_input", fieldErrors: { attendance: expect.any(String) } });
  });
});

describe("cleanAnswers", () => {
  it("keeps only questions on the form, and hidden ones go", () => {
    const out = cleanAnswers(FORM.schema, { ...answers, first_name: "Thabo", extra: "x", testimonies: "  ok  " });
    expect(out).not.toHaveProperty("first_name");
    expect(out).not.toHaveProperty("extra");
    expect(out.testimonies).toBe("ok");
  });
});

describe("loadWeeklyFillView", () => {
  it("prefills this week's answers and last week's count, and reads the form row", async () => {
    feedbackRows = [
      { meeting_date: "2026-11-22", attendance: 9, leader_score: 2, prayer: null },
      { meeting_date: "2026-11-15", attendance: 12 },
    ];
    const view = await loadWeeklyFillView(fakeDb(), HOUSE, NOW);
    expect(view).toMatchObject({
      houseNumber: 18,
      leaders: HOUSE.name,
      meetingDate: "2026-11-22",
      lastAttendance: 12,
      sentBefore: true,
      open: true,
      initial: { attendance: 9, leader_score: 2 },
    });
    expect(view.initial).not.toHaveProperty("prayer");
    expect(queries.filter((q) => q.op !== "select")).toHaveLength(0);
  });

  it("renders from the template when the row is not seeded, and says it is not open", async () => {
    formRow = null;
    const view = await loadWeeklyFillView(fakeDb(), HOUSE, NOW);
    expect(view.open).toBe(false);
    expect(view.schema.steps.length).toBe(4);
  });
});
